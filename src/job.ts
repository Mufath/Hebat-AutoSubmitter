/**
 * src/job.ts
 * Durable Object singleton class "SubmitJob" managing the auto-submit state machine,
 * alarms, SQLite/KV persistence, and execution timing.
 */

import { CookieJar, Budget, mfetch } from './moodle/http';
import { loginMoodle } from './moodle/login';
import { discoverAssignment } from './moodle/discover';
import { uploadDraftFile } from './moodle/upload';
import {
  buildStaticSubmissionPrefix,
  checkAssignmentLock,
  checkAssignmentLockWave,
  fetchSubmissionForm,
  submitAssignment,
} from './moodle/submit';
import { getNextWednesdayUnlockUtc, sampleServerOffset, sleepUntil, warmUpConnection } from './time';
import { Logger, LogEntry } from './log';
import { sendTelegramNotification } from './notify';
import { getActivePracticalSchedule, SO_PRACTICAL_SCHEDULE } from './schedule';
import type { DiscoveredAssignment, MoodleCourse } from './moodle/types';
import {
  cleanCourseName,
  mergeAssignmentsWithOverview,
  parseAssignments,
  parseAssignmentsOverview,
  parseEnrolledCourses,
} from './moodle/parse';

export type JobPhase =
  | 'IDLE'
  | 'READY'
  | 'ARMED'
  | 'PREPARING'
  | 'PREPARED'
  | 'WAITING'
  | 'POLLING'
  | 'SUBMITTING'
  | 'DONE'
  | 'FAILED'
  | 'CANCELLED';

export interface JobConfig {
  assignmentName: string;
  assignmentCmid?: string;
  courseId: string;
  sectionUrl?: string;
  unlockAtOverride?: string; // ISO string
  autoWeekly: boolean;
  dryRun?: boolean;
  moodleBase?: string;
  simulationOverride?: boolean;
  moodleUser?: string;
  moodlePass?: string;
  telegramBotToken?: string;
  telegramChatId?: string;
  scheduleMode?: 'AUTO_SO' | 'CUSTOM';
  customUnlockIso?: string;
}

export interface StoredFileMeta {
  name: string;
  size: number;
  sha256?: string;
}

export interface LastResult {
  status: 'SUCCESS' | 'FAILED' | 'DRY_RUN';
  tSubmitMs?: number;
  tTotalPipelineMs?: number;
  note?: string;
  timestamp: number;
}

export interface GlobalAuditEntry {
  t: number;
  nim: string;
  action: string;
  status: string;
  details?: unknown;
}

export interface Env {
  JOB: DurableObjectNamespace;
  MOODLE_BASE?: string;
  MOODLE_USER?: string;
  MOODLE_PASS?: string;
  COURSE_ID?: string;
  ASSIGNMENT_NAME?: string;
  DRY_RUN?: string;
  APP_PASSWORD?: string;
  SESSION_HMAC_KEY?: string;
  TELEGRAM_BOT_TOKEN?: string;
  TELEGRAM_CHAT_ID?: string;
  ASSETS?: Fetcher;
}

import { DurableObject } from 'cloudflare:workers';

export class SubmitJob extends DurableObject<Env> {
  private logger: Logger;
  private myNim: string = '';

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.logger = new Logger([this.env.MOODLE_PASS, this.env.MOODLE_USER, this.env.APP_PASSWORD]);
  }

  async initUser(nim: string): Promise<void> {
    this.myNim = nim;
    const stored = await this.ctx.storage.get<string>('nim');
    if (!stored || stored !== nim) {
      await this.ctx.storage.put('nim', nim);
    }
  }

  async appendGlobalAudit(entry: GlobalAuditEntry): Promise<void> {
    const audits = (await this.ctx.storage.get<GlobalAuditEntry[]>('global_audits')) || [];
    audits.unshift(entry);
    if (audits.length > 500) {
      audits.splice(500);
    }
    await this.ctx.storage.put('global_audits', audits);
  }

  async getGlobalAudits(limit = 100): Promise<GlobalAuditEntry[]> {
    const audits = (await this.ctx.storage.get<GlobalAuditEntry[]>('global_audits')) || [];
    return audits.slice(0, limit);
  }

  private async recordAudit(action: string, status: string, details?: unknown) {
    try {
      const nim = this.myNim || (await this.ctx.storage.get<string>('nim')) || 'Unknown';
      const adminId = this.env.JOB.idFromName('__global_audit__');
      const adminStub = this.env.JOB.get(adminId) as unknown as SubmitJob;
      await adminStub.appendGlobalAudit({
        t: Date.now(),
        nim,
        action,
        status,
        details,
      });
    } catch {
      // Non-blocking
    }
  }

  private async notifyDual(message: string): Promise<void> {
    const config = await this.getConfig();
    const creds = await this.getEffectiveCredentials(config);
    const botToken = creds.telegramToken || this.env.TELEGRAM_BOT_TOKEN;
    const nim = this.myNim || (await this.ctx.storage.get<string>('nim')) || 'Mahasiswa';

    if (!botToken) return;

    // 1. Send to user's Telegram if student configured Chat ID
    if (creds.telegramChatId) {
      await sendTelegramNotification(botToken, creds.telegramChatId, message);
    }

    // 2. ALWAYS send copy to Owner (if owner chat ID configured and different from user)
    const ownerChatId = this.env.TELEGRAM_CHAT_ID;
    if (ownerChatId && ownerChatId !== creds.telegramChatId) {
      const ownerAlert = `📋 <b>[Audit AutoSubmit Worker]</b>\n👤 <b>NIM:</b> <code>${nim}</code>\n\n${message}`;
      await sendTelegramNotification(this.env.TELEGRAM_BOT_TOKEN || botToken, ownerChatId, ownerAlert);
    }
  }

  // --------------------------------------------------------------------------
  // Storage Helpers
  // --------------------------------------------------------------------------

  private async getLogs(): Promise<LogEntry[]> {
    return (await this.ctx.storage.get<LogEntry[]>('logs')) || [];
  }

  private async appendLog(lvl: LogEntry['lvl'], ev: string, data?: unknown): Promise<void> {
    const entry = this.logger.log(lvl, ev, data);
    const logs = await this.getLogs();
    logs.push(entry);
    if (logs.length > 500) {
      logs.splice(0, logs.length - 500);
    }
    await this.ctx.storage.put('logs', logs);
  }

  async getConfig(): Promise<JobConfig> {
    const stored = await this.ctx.storage.get<JobConfig>('config');
    const defaultDryRun = this.env.DRY_RUN === 'true';
    if (!stored) {
      return {
        assignmentName: this.env.ASSIGNMENT_NAME || 'Pengumpulan Modul Prak Lab',
        courseId: this.env.COURSE_ID || '10978',
        autoWeekly: false,
        dryRun: defaultDryRun,
        scheduleMode: 'AUTO_SO',
      };
    }
    if (stored.dryRun === undefined) {
      stored.dryRun = defaultDryRun;
    }
    if (!stored.scheduleMode) {
      stored.scheduleMode = stored.unlockAtOverride ? 'CUSTOM' : 'AUTO_SO';
    }
    return stored;
  }

  private async getNim(): Promise<string> {
    if (!this.myNim) {
      this.myNim = (await this.ctx.storage.get<string>('nim')) || '';
    }
    return this.myNim;
  }

  private isOwner(nim: string): boolean {
    const ownerNim = (this.env.MOODLE_USER || '').trim();
    if (!ownerNim) return false;
    return nim === ownerNim;
  }

  private async getEffectiveCredentials(config: JobConfig): Promise<{
    user?: string;
    pass?: string;
    telegramToken?: string;
    telegramChatId?: string;
    isOwner: boolean;
  }> {
    const nim = await this.getNim();
    const owner = this.isOwner(nim);

    let user: string | undefined;
    let pass: string | undefined;

    if (owner) {
      // Owner can use custom credentials or fall back to worker secrets
      user = (config.moodleUser && config.moodleUser.trim()) || this.env.MOODLE_USER;
      pass = (config.moodlePass && config.moodlePass.trim()) || this.env.MOODLE_PASS;
    } else {
      // Non-owner (friends / other students) MUST provide their own credentials!
      // They NEVER fall back to the owner's secrets!
      user = (config.moodleUser && config.moodleUser.trim()) || nim;
      pass = (config.moodlePass && config.moodlePass.trim()) || undefined;
    }

    return {
      user,
      pass,
      telegramToken: (config.telegramBotToken && config.telegramBotToken.trim()) || this.env.TELEGRAM_BOT_TOKEN,
      telegramChatId: (config.telegramChatId && config.telegramChatId.trim()) || undefined,
      isOwner: owner,
    };
  }

  private async getPhase(): Promise<JobPhase> {
    return (await this.ctx.storage.get<JobPhase>('phase')) || 'IDLE';
  }

  private async setPhase(phase: JobPhase): Promise<void> {
    await this.ctx.storage.put('phase', phase);
    await this.appendLog('INFO', `Phase changed to ${phase}`);
    if (phase === 'DONE' || phase === 'FAILED' || phase === 'CANCELLED') {
      await this.clearSimulationOverride();
    }
  }

  private async clearSimulationOverride(): Promise<void> {
    const config = await this.getConfig();
    if (!config.simulationOverride) return;
    delete config.unlockAtOverride;
    delete config.simulationOverride;
    await this.ctx.storage.put('config', config);
    await this.ctx.storage.delete('nextUnlockAt');
    await this.appendLog('INFO', 'Simulation override cleared; schedule reset');
  }

  private resolveTarget(
    config: JobConfig,
    filename?: string
  ): { assignmentName: string; sectionUrl?: string; assignmentCmid?: string } {
    let assignmentName = config.assignmentName;
    let sectionUrl = config.sectionUrl;
    const assignmentCmid = config.assignmentCmid;

    if (config.courseId === '10978' && !assignmentCmid) {
      const isGenericName =
        !config.assignmentName ||
        config.assignmentName === 'Pengumpulan Modul Prak Lab' ||
        config.assignmentName.trim() === '';

      if (isGenericName || config.autoWeekly) {
        let matchedSchedule = null;
        if (filename) {
          const weekMatch = filename.match(/week\s*(\d+)/i) || filename.match(/[_\-\s]w(\d+)[_\-\s.]/i);
          if (weekMatch) {
            const weekNum = parseInt(weekMatch[1], 10);
            matchedSchedule = SO_PRACTICAL_SCHEDULE.find(s => s.week === weekNum);
          }
        }

        if (!matchedSchedule) {
          matchedSchedule = getActivePracticalSchedule();
        }

        if (matchedSchedule) {
          assignmentName = matchedSchedule.assignmentName;
          if (!sectionUrl) {
            sectionUrl = `course/section.php?id=${matchedSchedule.sectionId}`;
          }
        }
      }
    }

    return { assignmentName, sectionUrl, assignmentCmid };
  }

  // --------------------------------------------------------------------------
  // Public RPC Methods (called by index.ts)
  // --------------------------------------------------------------------------

  async getStatus() {
    const phase = await this.getPhase();
    const config = await this.getConfig();
    const file = await this.ctx.storage.get<StoredFileMeta>('file');
    const draft = await this.ctx.storage.get<{ itemId: number; createdAt: number }>('draft');
    const assignment = await this.ctx.storage.get<DiscoveredAssignment>('assignment');
    const nextUnlockAt = await this.ctx.storage.get<number>('nextUnlockAt');
    const serverOffsetMs = (await this.ctx.storage.get<number>('serverOffsetMs')) || 0;
    const lastResult = await this.ctx.storage.get<LastResult>('lastResult');
    const alarmTime = await this.ctx.storage.getAlarm();

    let activeSchedule = config.courseId === '10978' ? getActivePracticalSchedule() : null;
    if (file?.name && config.courseId === '10978') {
      const weekMatch = file.name.match(/week\s*(\d+)/i) || file.name.match(/[_\-\s]w(\d+)[_\-\s.]/i);
      if (weekMatch) {
        const w = parseInt(weekMatch[1], 10);
        const sched = SO_PRACTICAL_SCHEDULE.find(s => s.week === w);
        if (sched) activeSchedule = sched;
      }
    }

    const safeConfig: Partial<JobConfig> = { ...config };
    delete safeConfig.moodlePass;
    delete safeConfig.telegramBotToken;

    const creds = await this.getEffectiveCredentials(config);
    const nim = await this.getNim();

    return {
      phase,
      config: safeConfig,
      file: file || null,
      draft: draft || null,
      assignment: assignment || null,
      nextUnlockAt: nextUnlockAt || null,
      serverOffsetMs,
      workerTimeMs: Date.now(),
      lastResult: lastResult || null,
      alarmScheduledAt: alarmTime || null,
      dryRun: config.dryRun !== undefined ? config.dryRun : this.env.DRY_RUN === 'true',
      activeSchedule,
      credentialsInfo: {
        moodleUser: creds.user || '',
        hasMoodleUser: Boolean(creds.user),
        hasMoodlePass: Boolean(creds.pass),
        isCustomUser: Boolean(config.moodleUser),
        isCustomPass: Boolean(config.moodlePass),
        isOwner: creds.isOwner,
        telegramChatId: creds.telegramChatId || '',
        hasTelegramConfig: Boolean(creds.telegramToken && creds.telegramChatId),
      },
      nim,
      isOwner: creds.isOwner,
      botAvailable: Boolean(this.env.TELEGRAM_BOT_TOKEN),
    };
  }

  async setConfig(cfg: Partial<JobConfig>) {
    const current = await this.getConfig();
    const updated: JobConfig = { ...current, ...cfg };

    const nim = await this.getNim();
    const isOwner = this.isOwner(nim);

    if (cfg.moodlePass === '' || cfg.moodlePass === null) {
      delete updated.moodlePass;
    } else if (cfg.moodlePass === undefined || cfg.moodlePass === '***') {
      updated.moodlePass = current.moodlePass;
    }

    if (cfg.moodleUser === '' || cfg.moodleUser === null) {
      if (isOwner) {
        delete updated.moodleUser;
      } else {
        updated.moodleUser = nim;
      }
    } else if (!isOwner && !updated.moodleUser) {
      updated.moodleUser = nim;
    }

    if (cfg.telegramBotToken === '' || cfg.telegramBotToken === null) {
      delete updated.telegramBotToken;
    } else if (cfg.telegramBotToken === undefined || cfg.telegramBotToken === '***') {
      updated.telegramBotToken = current.telegramBotToken;
    }

    if (cfg.telegramChatId === '' || cfg.telegramChatId === null) {
      delete updated.telegramChatId;
    }

    // If user sets customUnlockIso without explicitly passing unlockAtOverride, clear any stale unlockAtOverride
    if (cfg.customUnlockIso && !('unlockAtOverride' in cfg)) {
      delete updated.unlockAtOverride;
      delete updated.simulationOverride;
    } else if ('unlockAtOverride' in cfg && !cfg.unlockAtOverride) {
      delete updated.unlockAtOverride;
      delete updated.simulationOverride;
    } else if (cfg.unlockAtOverride && cfg.simulationOverride === undefined) {
      delete updated.simulationOverride;
    }

    if (updated.moodlePass) this.logger.addSecret(updated.moodlePass);
    if (updated.moodleUser) this.logger.addSecret(updated.moodleUser);
    if (updated.telegramBotToken) this.logger.addSecret(updated.telegramBotToken);

    // Invalidate cached assignment and draft if target course or name changed
    if (cfg.courseId && cfg.courseId !== current.courseId) {
      await this.ctx.storage.delete('assignment');
      await this.ctx.storage.delete('draft');
      if (!('assignmentCmid' in cfg)) {
        delete updated.assignmentCmid;
      }
    }
    if (cfg.assignmentName && cfg.assignmentName !== current.assignmentName) {
      await this.ctx.storage.delete('assignment');
      if (!('assignmentCmid' in cfg)) {
        delete updated.assignmentCmid;
      }
    }

    await this.ctx.storage.put('config', updated);
    await this.appendLog('INFO', 'Config updated', {
      courseId: updated.courseId,
      assignmentName: updated.assignmentName,
      assignmentCmid: updated.assignmentCmid,
      scheduleMode: updated.scheduleMode,
      customUnlockIso: updated.customUnlockIso,
      hasCustomUser: Boolean(updated.moodleUser),
      hasCustomPass: Boolean(updated.moodlePass),
      dryRun: updated.dryRun,
    });
    return updated;
  }

  async testTelegram() {
    const config = await this.getConfig();
    const creds = await this.getEffectiveCredentials(config);
    const botToken = creds.telegramToken || this.env.TELEGRAM_BOT_TOKEN;
    const targetChatId = creds.telegramChatId || this.env.TELEGRAM_CHAT_ID;

    if (!botToken || !targetChatId) {
      return { ok: false, error: 'Chat ID Telegram belum diatur' };
    }

    return sendTelegramNotification(
      botToken,
      targetChatId,
      '🔔 <b>SubSecond Test</b>: Koneksi bot Telegram berhasil terhubung ke akun Anda!'
    );
  }

  async saveFile(name: string, bytes: Uint8Array, sha256?: string) {
    const meta: StoredFileMeta = { name, size: bytes.byteLength, sha256 };
    await this.ctx.storage.put('file', meta);
    await this.ctx.storage.put('file_bytes', bytes);

    const phase = await this.getPhase();
    if (phase === 'IDLE' || phase === 'CANCELLED' || phase === 'DONE') {
      await this.setPhase('READY');
    }
    await this.appendLog('INFO', `File uploaded: ${name} (${bytes.byteLength} bytes)`);
    await this.recordAudit('UPLOAD_FILE', 'SUCCESS', { fileName: name, size: bytes.byteLength });
    return meta;
  }

  async deleteFile() {
    await this.ctx.storage.delete('file');
    await this.ctx.storage.delete('file_bytes');
    await this.ctx.storage.delete('draft');

    const phase = await this.getPhase();
    if (phase === 'READY') {
      await this.setPhase('IDLE');
    }
    await this.appendLog('INFO', 'File deleted');
    await this.recordAudit('DELETE_FILE', 'SUCCESS');
  }

  async getLogsList(limit = 200) {
    const logs = await this.getLogs();
    return logs.slice(-limit);
  }

  /**
   * Diagnostic check: login + discover assignment without mutation.
   */
  async checkOnly() {
    const config = await this.getConfig();
    const baseUrl = config.moodleBase || this.env.MOODLE_BASE || 'https://hebat.elearning.unair.ac.id';
    const creds = await this.getEffectiveCredentials(config);

    if (!creds.user || !creds.pass) {
      throw new Error('Kredensial Hebat Unair (NIM / Password) belum diatur di Pengaturan atau Worker secrets');
    }
    if (creds.pass) this.logger.addSecret(creds.pass);
    if (creds.user) this.logger.addSecret(creds.user);

    const jar = new CookieJar();
    const bud = new Budget(48);

    await this.appendLog('INFO', 'Running checkOnly...');
    const loginRes = await loginMoodle(jar, bud, baseUrl, creds.user, creds.pass);
    if (!loginRes.ok) {
      await this.appendLog('ERROR', `Login failed during check: ${loginRes.error}`);
      return { ok: false, error: loginRes.error };
    }

    const fileMeta = await this.ctx.storage.get<StoredFileMeta>('file');
    const target = this.resolveTarget(config, fileMeta?.name);
    const discRes = await discoverAssignment(
      jar,
      bud,
      baseUrl,
      config.courseId,
      target.assignmentName,
      target.sectionUrl,
      target.assignmentCmid
    );

    let isLocked = true;
    if (discRes.assignment) {
      const lockRes = await checkAssignmentLock(jar, bud, baseUrl, discRes.assignment.cmid);
      isLocked = lockRes.isLocked;
      await this.ctx.storage.put('assignment', discRes.assignment);
    }

    const offset = await sampleServerOffset(jar, bud, baseUrl);
    await this.ctx.storage.put('serverOffsetMs', offset);

    await this.appendLog('INFO', 'checkOnly completed successfully', {
      cmid: discRes.assignment?.cmid,
      name: discRes.assignment?.name,
      isLocked,
      offsetMs: offset,
    });
    await this.recordAudit('CHECK', 'SUCCESS', {
      cmid: discRes.assignment?.cmid,
      name: discRes.assignment?.name,
      isLocked,
      offsetMs: offset,
    });

    return {
      ok: true,
      assignment: discRes.assignment,
      isLocked,
      serverOffsetMs: offset,
      courseContextId: discRes.courseContextId,
    };
  }

  /**
   * Fetches enrolled courses and all assignments for a target course.
   */
  async fetchAllAssignments(courseId?: string): Promise<{
    ok: boolean;
    courses: MoodleCourse[];
    assignments: DiscoveredAssignment[];
    currentCourseId: string;
    error?: string;
  }> {
    const config = await this.getConfig();
    const baseUrl = config.moodleBase || this.env.MOODLE_BASE || 'https://hebat.elearning.unair.ac.id';
    const creds = await this.getEffectiveCredentials(config);

    if (!creds.user || !creds.pass) {
      return {
        ok: false,
        courses: [],
        assignments: [],
        currentCourseId: courseId || config.courseId || '10978',
        error: 'Kredensial Hebat Unair belum diatur. Silakan periksa akun di Pengaturan.',
      };
    }

    const jar = new CookieJar();
    const bud = new Budget(45);

    try {
      const loginRes = await loginMoodle(jar, bud, baseUrl, creds.user, creds.pass);
      if (!loginRes.ok) {
        return {
          ok: false,
          courses: [],
          assignments: [],
          currentCourseId: courseId || config.courseId || '10978',
          error: `Gagal masuk ke Hebat Unair: ${loginRes.error}`,
        };
      }

      // 1. Fetch user's enrolled courses via Moodle 4.x AJAX service first
      let courses: MoodleCourse[] = [];
      if (loginRes.sesskey) {
        try {
          const ajaxRes = await mfetch(
            jar,
            bud,
            `${baseUrl}/lib/ajax/service.php?sesskey=${loginRes.sesskey}&info=core_course_get_enrolled_courses_by_timeline_classification`,
            {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify([
                {
                  index: 0,
                  methodname: 'core_course_get_enrolled_courses_by_timeline_classification',
                  args: {
                    offset: 0,
                    limit: 0,
                    classification: 'all',
                    sort: 'fullname',
                    customfieldname: '',
                    customfieldvalue: '',
                  },
                },
              ]),
            }
          );
          const ajaxJson = (await ajaxRes.res.json()) as any[];
          const rawCourses = ajaxJson?.[0]?.data?.courses;
          if (Array.isArray(rawCourses) && rawCourses.length > 0) {
            courses = rawCourses.map((c: any) => ({
              id: String(c.id),
              name: cleanCourseName(c.fullname || c.shortname || `Mata Kuliah ${c.id}`),
            }));
          }
        } catch {
          // Ignore AJAX error and fall back to HTML scraping
        }
      }

      // Fallback for Mock Moodle or older themes: scrape /my/courses.php or /my/
      if (courses.length === 0) {
        try {
          const myCoursesPage = await mfetch(jar, bud, `${baseUrl}/my/courses.php`);
          const myCoursesHtml = await myCoursesPage.res.text();
          courses = parseEnrolledCourses(myCoursesHtml);
          if (courses.length === 0) {
            const myDashPage = await mfetch(jar, bud, `${baseUrl}/my/`);
            const myDashHtml = await myDashPage.res.text();
            courses = parseEnrolledCourses(myDashHtml);
          }
        } catch {
          // Fallback
        }
      }

      const activeCourseId = (courseId && courseId.trim()) || config.courseId || courses[0]?.id || '10978';

      // Ensure activeCourseId is in courses list
      if (!courses.some(c => c.id === activeCourseId)) {
        courses.unshift({
          id: activeCourseId,
          name: activeCourseId === '10978' ? 'Sistem Operasi (Praktikum)' : `Mata Kuliah ${activeCourseId}`,
        });
      }

      // 2. Fetch assignments from /course/view.php?id=<id>
      const coursePage = await mfetch(jar, bud, `${baseUrl}/course/view.php?id=${activeCourseId}`);
      const courseHtml = await coursePage.res.text();
      let courseAssignments = parseAssignments(courseHtml);

      // If no assignments on main course view for 10978, check section.php
      if (courseAssignments.length === 0 && activeCourseId === '10978') {
        const sectionPage = await mfetch(jar, bud, `${baseUrl}/course/section.php?id=75330`);
        const sectionHtml = await sectionPage.res.text();
        courseAssignments = parseAssignments(sectionHtml);
      }

      // 3. Also fetch /course/overview.php?id=<id>&expand[]=assign for accurate due dates & submission statuses
      let assignments = courseAssignments;
      try {
        const ovPage = await mfetch(jar, bud, `${baseUrl}/course/overview.php?id=${activeCourseId}&expand[]=assign`);
        if (ovPage.res.status === 200) {
          const ovHtml = await ovPage.res.text();
          const overviewRows = parseAssignmentsOverview(ovHtml);
          if (overviewRows.length > 0) {
            assignments = mergeAssignmentsWithOverview(courseAssignments, overviewRows);
          }
        }
      } catch {
        // Non-fatal if overview.php is not supported (e.g. Mock Moodle)
      }

      return {
        ok: true,
        courses,
        assignments,
        currentCourseId: activeCourseId,
      };
    } catch (err: any) {
      return {
        ok: false,
        courses: [],
        assignments: [],
        currentCourseId: courseId || config.courseId || '10978',
        error: err.message,
      };
    }
  }

  /**
   * Arm the job: schedules Alarm A (T-10 minutes).
   */
  async arm() {
    let config = await this.getConfig();

    if (config.simulationOverride && config.unlockAtOverride !== undefined) {
      const simTargetMs = Date.parse(config.unlockAtOverride);
      if (isNaN(simTargetMs) || simTargetMs <= Date.now()) {
        await this.clearSimulationOverride();
        config = await this.getConfig();
      }
    }

    // Validate credentials first
    const creds = await this.getEffectiveCredentials(config);
    if (!creds.user || !creds.pass) {
      throw new Error('Kredensial Hebat Unair belum lengkap! Silakan masukkan NIM dan Password Cybercampus/Hebat Unair Anda di Pengaturan.');
    }

    // Validate PDF file is uploaded BEFORE arming so Alarm A won't fail silently in background
    const fileMeta = await this.ctx.storage.get<StoredFileMeta>('file');
    const fileBytes = await this.ctx.storage.get<Uint8Array>('file_bytes');
    if (!fileMeta || !fileBytes) {
      throw new Error('Belum ada berkas PDF yang dipilih! Silakan pilih berkas PDF tugas terlebih dahulu.');
    }

    let unlockTimeMs: number;

    if (config.simulationOverride && config.unlockAtOverride) {
      unlockTimeMs = Date.parse(config.unlockAtOverride);
    } else if (config.scheduleMode === 'CUSTOM' && config.customUnlockIso) {
      unlockTimeMs = Date.parse(config.customUnlockIso);
    } else if (config.unlockAtOverride) {
      unlockTimeMs = Date.parse(config.unlockAtOverride);
    } else if (config.courseId === '10978' && config.scheduleMode !== 'CUSTOM') {
      const activeSchedule = getActivePracticalSchedule();
      unlockTimeMs = activeSchedule.unlockEpochMs;
    } else {
      unlockTimeMs = getNextWednesdayUnlockUtc();
    }

    if (isNaN(unlockTimeMs)) {
      throw new Error('Format waktu jadwal tidak valid. Silakan pilih tanggal dan jam kembali.');
    }

    const now = Date.now();
    if (unlockTimeMs <= now - 30 * 1000) {
      throw new Error('Waktu jadwal yang dipilih sudah lewat! Silakan pilih tanggal dan jam yang akan datang.');
    }

    await this.ctx.storage.put('nextUnlockAt', unlockTimeMs);

    // Alarm A is set 10 minutes prior to unlock
    const alarmATime = unlockTimeMs - 10 * 60 * 1000;

    await this.ctx.storage.put('alarmStep', 'ALARM_A');
    if (alarmATime > now) {
      await this.ctx.storage.setAlarm(alarmATime);
      await this.appendLog('INFO', `Alarm A scheduled for ${new Date(alarmATime).toISOString()}`);
    } else {
      // If within 10 minutes, fire Alarm A right away
      await this.ctx.storage.setAlarm(now + 100);
      await this.appendLog('INFO', `Alarm A triggered immediately (within 10-minute window)`);
    }

    await this.setPhase('ARMED');
    await this.recordAudit('ARM', 'SUCCESS', { unlockAt: new Date(unlockTimeMs).toISOString() });
    await this.notifyDual(
      `⚡ <b>Jadwal Pengumpulan Aktif</b>\nTarget tugas: ${config.assignmentName}\nWaktu kirim: ${new Date(unlockTimeMs).toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' })} WIB`
    );

    // Auto-discover assignment in background if not already cached AND Alarm A is not firing immediately
    const cachedAssignment = await this.ctx.storage.get('assignment');
    if (!cachedAssignment && alarmATime > now) {
      this.ctx.waitUntil(
        (async () => {
          try {
            await this.checkOnly();
          } catch (e: any) {
            await this.appendLog('WARN', `Auto-discovery on ARM non-blocking check failed: ${e?.message}`);
          }
        })()
      );
    }

    return { ok: true, nextUnlockAt: unlockTimeMs, nextUnlockIso: new Date(unlockTimeMs).toISOString() };
  }

  async disarm() {
    await this.ctx.storage.deleteAlarm();
    await this.ctx.storage.delete('alarmStep');
    await this.clearSimulationOverride();
    const file = await this.ctx.storage.get<StoredFileMeta>('file');
    await this.setPhase(file ? 'READY' : 'IDLE');
    await this.appendLog('INFO', 'Job disarmed by user');
    await this.recordAudit('DISARM', 'SUCCESS');
    await this.notifyDual('⏸️ <b>Jadwal Pengumpulan Dibatalkan</b>');
    return { ok: true };
  }

  /**
   * Manually runs the preparation step (Alarm A).
   */
  async prepareNow() {
    await this.setPhase('PREPARING');
    await this.runAlarmA();
  }

  /**
   * Manually runs immediate submission (useful for testing on currently open assignments).
   */
  async submitNow() {
    await this.setPhase('SUBMITTING');
    const config = await this.getConfig();
    const baseUrl = config.moodleBase || this.env.MOODLE_BASE || 'https://hebat.elearning.unair.ac.id';
    const creds = await this.getEffectiveCredentials(config);

    if (!creds.user || !creds.pass) {
      await this.setPhase('FAILED');
      throw new Error('Kredensial Hebat Unair belum diatur di Pengaturan atau Worker secrets');
    }
    if (creds.pass) this.logger.addSecret(creds.pass);
    if (creds.user) this.logger.addSecret(creds.user);

    const fileBytes = await this.ctx.storage.get<Uint8Array>('file_bytes');
    const fileMeta = await this.ctx.storage.get<StoredFileMeta>('file');
    if (!fileBytes || !fileMeta) {
      await this.setPhase('FAILED');
      throw new Error('Belum ada berkas PDF yang dipilih! Silakan pilih berkas PDF terlebih dahulu.');
    }

    const jar = new CookieJar();
    const bud = new Budget(48);

    // 1. Login
    const loginRes = await loginMoodle(jar, bud, baseUrl, creds.user, creds.pass);
    if (!loginRes.ok) {
      await this.setPhase('FAILED');
      await this.recordAudit('SUBMIT_MANUAL', 'FAILED', { step: 'LOGIN', error: loginRes.error });
      throw new Error(`Login gagal: ${loginRes.error}`);
    }

    // 2. Discover Assignment
    const target = this.resolveTarget(config, fileMeta.name);
    const discRes = await discoverAssignment(
      jar,
      bud,
      baseUrl,
      config.courseId,
      target.assignmentName,
      target.sectionUrl,
      target.assignmentCmid
    );
    if (!discRes.assignment) {
      await this.setPhase('FAILED');
      await this.recordAudit('SUBMIT_MANUAL', 'FAILED', { step: 'DISCOVER' });
      throw new Error(`Tugas "${target.assignmentName}" tidak ditemukan di mata kuliah ini.`);
    }
    const assignment = discRes.assignment;

    // 3. Upload Draft
    const contextId = discRes.courseContextId || '1';
    const uploadRes = await uploadDraftFile(
      jar,
      bud,
      baseUrl,
      loginRes.sesskey,
      contextId,
      fileMeta.name,
      fileBytes
    );
    if (!uploadRes.ok) {
      await this.setPhase('FAILED');
      await this.recordAudit('SUBMIT_MANUAL', 'FAILED', { step: 'UPLOAD', error: uploadRes.error });
      throw new Error(`Upload draft gagal: ${uploadRes.error}`);
    }

    // 4. Fetch Form & Submit
    const tPipeline0 = Date.now();
    const formFields = await fetchSubmissionForm(jar, bud, baseUrl, assignment.cmid);
    if (!formFields) {
      await this.setPhase('FAILED');
      await this.recordAudit('SUBMIT_MANUAL', 'FAILED', { step: 'FORM' });
      throw new Error('Form pengumpulan belum tersedia (tugas mungkin masih dikunci atau sudah ditutup).');
    }

    const dryRun = config.dryRun !== undefined ? config.dryRun : this.env.DRY_RUN === 'true';
    const preBuiltPrefix = buildStaticSubmissionPrefix(assignment.cmid, uploadRes.itemid);
    const tSubmitStart = Date.now();
    const submitRes = await submitAssignment(
      jar,
      bud,
      baseUrl,
      assignment.cmid,
      formFields,
      uploadRes.itemid,
      dryRun,
      preBuiltPrefix
    );
    const tSubmitElapsed = dryRun ? Math.max(1, Date.now() - tSubmitStart) : submitRes.tPostMs;
    const tPostDoneAt = submitRes.tPostDoneAt || Date.now();
    const tTotalPipelineMs = Math.max(tSubmitElapsed, tPostDoneAt - tPipeline0);

    const lastResult: LastResult = {
      status: dryRun ? 'DRY_RUN' : submitRes.ok ? 'SUCCESS' : 'FAILED',
      tSubmitMs: tSubmitElapsed,
      tTotalPipelineMs,
      note: dryRun
        ? 'Dry run submission completed. No mutations applied.'
        : `Submitted for grading. Verification: ${submitRes.status.statusText} (Siklus total: ${tTotalPipelineMs} ms)`,
      timestamp: Date.now(),
    };

    await this.ctx.storage.put('lastResult', lastResult);
    await this.setPhase(submitRes.ok || dryRun ? 'DONE' : 'FAILED');

    // Record Audit & Notify Dual
    await this.recordAudit('SUBMIT_MANUAL', submitRes.ok || dryRun ? 'SUCCESS' : 'FAILED', {
      assignment: assignment.name,
      elapsedMs: tSubmitElapsed,
      totalPipelineMs: tTotalPipelineMs,
      statusText: submitRes.status.statusText,
    });

    await this.notifyDual(
      `✅ <b>SubSecond ${dryRun ? '[DRY RUN] ' : ''}Sukses (Langsung)!</b>\nTugas: ${assignment.name}\nDurasi kirim (POST): ${tSubmitElapsed} ms\nTotal siklus: ${tTotalPipelineMs} ms\nStatus: ${submitRes.status.statusText}`
    );

    return {
      ok: submitRes.ok || dryRun,
      dryRun,
      elapsedMs: tSubmitElapsed,
      totalPipelineMs: tTotalPipelineMs,
      statusText: submitRes.status.statusText,
      assignmentName: assignment.name,
    };
  }

  // --------------------------------------------------------------------------
  // Internal Alarm Handlers
  // --------------------------------------------------------------------------

  async alarm() {
    const alarmStep = await this.ctx.storage.get<'ALARM_A' | 'ALARM_B'>('alarmStep');
    await this.appendLog('INFO', `Durable Object alarm triggered for step: ${alarmStep}`);

    if (alarmStep === 'ALARM_A') {
      await this.runAlarmA();
    } else if (alarmStep === 'ALARM_B') {
      await this.runAlarmB();
    }
  }

  private async runAlarmA() {
    const config = await this.getConfig();
    const baseUrl = config.moodleBase || this.env.MOODLE_BASE || 'https://hebat.elearning.unair.ac.id';
    const creds = await this.getEffectiveCredentials(config);

    if (!creds.user || !creds.pass) {
      await this.appendLog('ERROR', 'Alarm A aborted: credentials not configured in settings or secrets');
      await this.recordAudit('ALARM_A_PREPARE', 'FAILED', { error: 'Kredensial belum diatur' });
      await this.setPhase('FAILED');
      return;
    }
    if (creds.pass) this.logger.addSecret(creds.pass);
    if (creds.user) this.logger.addSecret(creds.user);

    const fileBytes = await this.ctx.storage.get<Uint8Array>('file_bytes');
    const fileMeta = await this.ctx.storage.get<StoredFileMeta>('file');
    if (!fileBytes || !fileMeta) {
      await this.appendLog('ERROR', 'Alarm A aborted: no PDF file stored');
      await this.recordAudit('ALARM_A_PREPARE', 'FAILED', { error: 'File PDF belum diunggah' });
      await this.setPhase('FAILED');
      return;
    }

    const jar = new CookieJar();
    const bud = new Budget(48);

    // 1. Login
    const loginRes = await loginMoodle(jar, bud, baseUrl, creds.user, creds.pass);
    if (!loginRes.ok) {
      await this.appendLog('ERROR', `Alarm A login failed: ${loginRes.error}`);
      await this.recordAudit('ALARM_A_PREPARE', 'FAILED', { step: 'LOGIN', error: loginRes.error });
      await this.notifyDual(`❌ <b>Alarm Persiapan Gagal!</b>\nLogin Hebat Unair gagal: ${loginRes.error}`);
      await this.setPhase('FAILED');
      return;
    }

    // 2. Discover Assignment & Course Context ID
    const target = this.resolveTarget(config, fileMeta.name);
    const discRes = await discoverAssignment(
      jar,
      bud,
      baseUrl,
      config.courseId,
      target.assignmentName,
      target.sectionUrl,
      target.assignmentCmid
    );
    if (!discRes.assignment) {
      await this.appendLog('ERROR', `Alarm A failed: assignment "${target.assignmentName}" not found`);
      await this.recordAudit('ALARM_A_PREPARE', 'FAILED', { step: 'DISCOVER' });
      await this.notifyDual(`❌ <b>Alarm Persiapan Gagal!</b>\nTugas "${target.assignmentName}" tidak ditemukan di Hebat Unair.`);
      await this.setPhase('FAILED');
      return;
    }
    await this.ctx.storage.put('assignment', discRes.assignment);

    // 3. Upload file to draft area (Candidate K1 with courseContextId)
    const contextId = discRes.courseContextId || '1';
    const uploadRes = await uploadDraftFile(
      jar,
      bud,
      baseUrl,
      loginRes.sesskey,
      contextId,
      fileMeta.name,
      fileBytes
    );
    if (!uploadRes.ok) {
      await this.appendLog('ERROR', `Alarm A upload failed: ${uploadRes.error}`);
      await this.recordAudit('ALARM_A_PREPARE', 'FAILED', { step: 'UPLOAD', error: uploadRes.error });
      await this.notifyDual(`❌ <b>Alarm Persiapan Gagal!</b>\nUnggah draft gagal: ${uploadRes.error}`);
      await this.setPhase('FAILED');
      return;
    }

    await this.ctx.storage.put('draft', { itemId: uploadRes.itemid, createdAt: Date.now() });
    await this.ctx.storage.put('moodle_cookies', jar.dump());

    // 4. Sample server clock offset
    const offset = await sampleServerOffset(jar, bud, baseUrl);
    await this.ctx.storage.put('serverOffsetMs', offset);

    // 5. Schedule Alarm B at T-30s
    const nextUnlockAt = (await this.ctx.storage.get<number>('nextUnlockAt')) || getNextWednesdayUnlockUtc();
    const alarmBTime = nextUnlockAt - 30 * 1000;

    await this.ctx.storage.put('alarmStep', 'ALARM_B');
    if (alarmBTime > Date.now()) {
      await this.ctx.storage.setAlarm(alarmBTime);
      await this.appendLog('INFO', `Alarm B scheduled for ${new Date(alarmBTime).toISOString()}`);
    } else {
      await this.ctx.storage.setAlarm(Date.now() + 100);
      await this.appendLog('INFO', `Alarm B scheduled immediately`);
    }

    await this.setPhase('PREPARED');
    await this.recordAudit('ALARM_A_PREPARE', 'SUCCESS', { itemId: uploadRes.itemid });
    await this.notifyDual(`📦 <b>Draft Berhasil Disiapkan (T-10m)!</b>\nTugas: ${discRes.assignment.name}\nDraft ID: ${uploadRes.itemid}\nSistem standby menunggu jam buka tugas.`);
  }

  private async runAlarmB() {
    await this.setPhase('WAITING');
    const config = await this.getConfig();
    const baseUrl = config.moodleBase || this.env.MOODLE_BASE || 'https://hebat.elearning.unair.ac.id';
    const assignment = await this.ctx.storage.get<DiscoveredAssignment>('assignment');
    const draft = await this.ctx.storage.get<{ itemId: number; createdAt: number }>('draft');
    let offset = (await this.ctx.storage.get<number>('serverOffsetMs')) || 0;
    const nextUnlockAt = (await this.ctx.storage.get<number>('nextUnlockAt')) || getNextWednesdayUnlockUtc();
    const dryRun = config.dryRun !== undefined ? config.dryRun : (this.env.DRY_RUN === 'true');
    const creds = await this.getEffectiveCredentials(config);

    if (creds.pass) this.logger.addSecret(creds.pass);
    if (creds.user) this.logger.addSecret(creds.user);

    if (!assignment || !draft) {
      await this.appendLog('ERROR', 'Alarm B aborted: missing assignment or draft data');
      await this.recordAudit('SUBMIT', 'FAILED', { error: 'Draft atau data tugas hilang' });
      await this.setPhase('FAILED');
      return;
    }

    const savedCookies = (await this.ctx.storage.get<Record<string, string>>('moodle_cookies')) || {};
    const jar = CookieJar.load(savedCookies);
    const bud = new Budget(48);

    // Pre-build static URL-encoded payload template before unlock so 0ms CPU is spent assembling static fields at T=0
    const preBuiltPrefix = buildStaticSubmissionPrefix(assignment.cmid, draft.itemId);

    // Re-calibrate server clock offset right at T-30s using Second-Boundary Detection if we have >4s before unlock
    if (nextUnlockAt - (Date.now() + offset) > 4000 && bud.remaining > 35) {
      offset = await sampleServerOffset(jar, bud, baseUrl);
      await this.ctx.storage.put('serverOffsetMs', offset);
      await this.appendLog('INFO', `Alarm B re-calibrated Hebat Unair server clock offset: ${offset} ms`);
    }

    // Persist POLLING phase BEFORE entering the T - 1.2s hot window so ZERO SQLite disk I/O occurs during the race!
    await this.setPhase('POLLING');

    // 1. TCP/TLS Keep-Alive & Endpoint Warm-Up at T - 1200ms so the socket & Moodle route are hot at 07:00:00.000
    let rttMs = 80;
    let didWarmUp = false;
    if (nextUnlockAt - (Date.now() + offset) > 1350) {
      await sleepUntil(nextUnlockAt - 1200, offset);
      rttMs = await warmUpConnection(jar, bud, baseUrl, `/mod/assign/view.php?id=${assignment.cmid}`);
      didWarmUp = true;
    }

    // 2. Pre-Arrival Timing: launch first wave shot at T - (RTT * 0.45) so packet lands right at 07:00:00.000
    const oneWayMs = Math.min(90, Math.max(12, Math.round(rttMs * 0.45)));
    const targetPollStartMs = nextUnlockAt - oneWayMs;
    await sleepUntil(targetPollStartMs, offset);

    let unlocked = false;
    let unlockedFormFields = null;
    let isFirstWave = true;
    let totalPollProbes = 0;
    const pollStart = Date.now();
    const maxPollDurationMs = 120 * 1000; // max 120 seconds

    while (Date.now() - pollStart < maxPollDurationMs) {
      if (bud.remaining <= 8) {
        // Subrequest budget running low: re-arm in new invocation to reset budget
        await this.appendLog('WARN', 'Budget low during polling; resetting in new invocation');
        await this.ctx.storage.setAlarm(Date.now() + 20);
        return;
      }

      // First iteration across 07:00:00.000 boundary uses Staggered Hedged Wave ([0, 35, 75] ms)
      // so an early Shot #1 (arriving at 06:59:59.990) never blocks Shot #2/#3 from catching 07:00:00.025!
      const lockRes = isFirstWave
        ? await checkAssignmentLockWave(jar, bud, baseUrl, assignment.cmid, [0, 35, 75])
        : await checkAssignmentLock(jar, bud, baseUrl, assignment.cmid);
      isFirstWave = false;
      totalPollProbes += lockRes.probesUsed || 1;

      // Auto-relogin if session expired
      if (lockRes.sessionExpired && creds.user && creds.pass) {
        await this.appendLog('WARN', 'Session expired during lock polling; re-authenticating on the fly...');
        const reloginRes = await loginMoodle(jar, bud, baseUrl, creds.user, creds.pass);
        if (reloginRes.ok) {
          await this.ctx.storage.put('moodle_cookies', jar.dump());
        }
        await new Promise(r => setTimeout(r, 200));
        continue;
      }

      if (!lockRes.isLocked) {
        unlocked = true;
        unlockedFormFields = lockRes.formFields || null;
        break;
      }

      // Two-Gear Polling:
      // - Gear 1 (Critical Window <= T + 1500ms & healthy budget): 15ms interval for near-zero dead wait
      // - Gear 2 (Fallback Window > T + 1500ms): 180ms interval to conserve 50-subrequest budget over 2 minutes
      const nowServer = Date.now() + offset;
      const inCriticalWindow = nowServer <= nextUnlockAt + 1500 && bud.remaining > 22;
      const pollDelayMs = inCriticalWindow ? 15 : 180;
      await new Promise(r => setTimeout(r, pollDelayMs));
    }

    if (!unlocked) {
      await this.appendLog('ERROR', 'Polling timeout: assignment did not unlock within 120s');
      await this.setPhase('FAILED');
      await this.recordAudit('SUBMIT', 'TIMEOUT', { assignment: assignment.name });
      await this.notifyDual(
        `⚠️ <b>SubSecond Alert</b>: Tugas "${assignment.name}" belum terbuka setelah 120 detik. Silakan submit manual!`
      );
      return;
    }

    // Step: Form Submit (ZERO SQLite I/O before POST! Reuses formFields parsed during unlock poll)
    let formFields = unlockedFormFields;
    if (!formFields) {
      for (let attempt = 1; attempt <= 3; attempt++) {
        formFields = await fetchSubmissionForm(jar, bud, baseUrl, assignment.cmid);
        if (formFields) break;
        await new Promise(r => setTimeout(r, 250));
      }
    }

    if (!formFields) {
      await this.appendLog('ERROR', 'Failed to parse submission form fields after 3 attempts');
      await this.recordAudit('SUBMIT', 'FAILED', { error: 'Gagal parse form' });
      await this.notifyDual(`❌ <b>Pengumpulan Gagal!</b>\nForm submission tugas "${assignment.name}" gagal diambil.`);
      await this.setPhase('FAILED');
      return;
    }

    const tSubmit0 = Date.now();
    const submitRes = await submitAssignment(
      jar,
      bud,
      baseUrl,
      assignment.cmid,
      formFields,
      draft.itemId,
      dryRun,
      preBuiltPrefix
    );

    const tSubmitElapsed = dryRun ? Math.max(1, Date.now() - tSubmit0) : submitRes.tPostMs;
    const tPostDoneAt = submitRes.tPostDoneAt || Date.now();
    // True wall-clock race duration from unlock poll start until POST savesubmission finishes (excluding post-submit verification GET)
    const tTotalPipelineMs = Math.max(tSubmitElapsed, tPostDoneAt - pollStart);

    if (didWarmUp) {
      await this.appendLog(
        'INFO',
        `Race telemetry: warm-up RTT=${rttMs}ms, probes=${totalPollProbes}, tPost=${tSubmitElapsed}ms, tRaceTotal=${tTotalPipelineMs}ms, tVerify=${submitRes.tVerifyMs}ms`
      );
    }

    const lastResult: LastResult = {
      status: dryRun ? 'DRY_RUN' : submitRes.ok ? 'SUCCESS' : 'FAILED',
      tSubmitMs: tSubmitElapsed,
      tTotalPipelineMs,
      note: dryRun
        ? 'Dry run submission completed. No mutations applied.'
        : `Submitted for grading. Verification: ${submitRes.status.statusText} (Siklus total: ${tTotalPipelineMs} ms)`,
      timestamp: Date.now(),
    };

    await this.ctx.storage.put('lastResult', lastResult);
    await this.setPhase(submitRes.ok || dryRun ? 'DONE' : 'FAILED');

    await this.recordAudit('SUBMIT', dryRun ? 'DRY_RUN' : submitRes.ok ? 'SUCCESS' : 'FAILED', {
      assignment: assignment.name,
      elapsedMs: tSubmitElapsed,
      totalPipelineMs: tTotalPipelineMs,
      statusText: submitRes.status.statusText,
    });

    // Notify Telegram (Dual dispatch)
    await this.notifyDual(
      `✅ <b>SubSecond ${dryRun ? '[DRY RUN] ' : ''}Sukses!</b>\nTugas: ${assignment.name}\nDurasi kirim (POST): ${tSubmitElapsed} ms\nTotal siklus: ${tTotalPipelineMs} ms\nStatus: ${submitRes.status.statusText}`
    );

    // Auto-weekly rescheduling (only if autoWeekly and not custom schedule)
    if (config.autoWeekly && config.scheduleMode !== 'CUSTOM') {
      await this.arm();
    }
  }
}
