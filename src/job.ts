/**
 * src/job.ts
 * Durable Object singleton class "SubmitJob" managing the auto-submit state machine,
 * alarms, SQLite/KV persistence, and execution timing.
 */

import { CookieJar, Budget } from './moodle/http';
import { loginMoodle } from './moodle/login';
import { discoverAssignment } from './moodle/discover';
import { uploadDraftFile } from './moodle/upload';
import { checkAssignmentLock, fetchSubmissionForm, submitAssignment } from './moodle/submit';
import { getNextWednesdayUnlockUtc, sampleServerOffset, sleepUntil } from './time';
import { Logger, LogEntry } from './log';
import { sendTelegramNotification } from './notify';
import { getActivePracticalSchedule } from './schedule';
import type { DiscoveredAssignment } from './moodle/types';

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
  courseId: string;
  sectionUrl?: string;
  unlockAtOverride?: string; // ISO string
  autoWeekly: boolean;
  dryRun?: boolean;
}

export interface StoredFileMeta {
  name: string;
  size: number;
  sha256?: string;
}

export interface LastResult {
  status: 'SUCCESS' | 'FAILED' | 'DRY_RUN';
  tSubmitMs?: number;
  note?: string;
  timestamp: number;
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

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.logger = new Logger([this.env.MOODLE_PASS, this.env.MOODLE_USER, this.env.APP_PASSWORD]);
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

  private async getConfig(): Promise<JobConfig> {
    const stored = await this.ctx.storage.get<JobConfig>('config');
    const defaultDryRun = this.env.DRY_RUN !== 'false';
    if (!stored) {
      return {
        assignmentName: this.env.ASSIGNMENT_NAME || 'Pengumpulan Modul Prak Lab',
        courseId: this.env.COURSE_ID || '10978',
        autoWeekly: false,
        dryRun: defaultDryRun,
      };
    }
    if (stored.dryRun === undefined) {
      stored.dryRun = defaultDryRun;
    }
    return stored;
  }

  private async getPhase(): Promise<JobPhase> {
    return (await this.ctx.storage.get<JobPhase>('phase')) || 'IDLE';
  }

  private async setPhase(phase: JobPhase): Promise<void> {
    await this.ctx.storage.put('phase', phase);
    await this.appendLog('INFO', `Phase changed to ${phase}`);
  }

  private resolveTarget(config: JobConfig): { assignmentName: string; sectionUrl?: string } {
    let assignmentName = config.assignmentName;
    let sectionUrl = config.sectionUrl;

    if (config.courseId === '10978') {
      const activeSchedule = getActivePracticalSchedule();
      if (!config.assignmentName || config.assignmentName === 'Pengumpulan Modul Prak Lab' || config.autoWeekly) {
        assignmentName = activeSchedule.assignmentName;
      }
      if (!sectionUrl) {
        sectionUrl = `course/section.php?id=${activeSchedule.sectionId}`;
      }
    }

    return { assignmentName, sectionUrl };
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
    const activeSchedule = config.courseId === '10978' ? getActivePracticalSchedule() : null;

    return {
      phase,
      config,
      file: file || null,
      draft: draft || null,
      assignment: assignment || null,
      nextUnlockAt: nextUnlockAt || null,
      serverOffsetMs,
      lastResult: lastResult || null,
      alarmScheduledAt: alarmTime || null,
      dryRun: config.dryRun !== undefined ? config.dryRun : (this.env.DRY_RUN !== 'false'),
      activeSchedule,
    };
  }

  async setConfig(cfg: Partial<JobConfig>) {
    const current = await this.getConfig();
    const updated: JobConfig = { ...current, ...cfg };
    await this.ctx.storage.put('config', updated);
    await this.appendLog('INFO', 'Config updated', updated);
    return updated;
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
    const baseUrl = this.env.MOODLE_BASE || 'https://hebat.elearning.unair.ac.id';
    const user = this.env.MOODLE_USER;
    const pass = this.env.MOODLE_PASS;

    if (!user || !pass) {
      throw new Error('MOODLE_USER or MOODLE_PASS not set in Worker secrets');
    }

    const jar = new CookieJar();
    const bud = new Budget(48);

    await this.appendLog('INFO', 'Running checkOnly...');
    const loginRes = await loginMoodle(jar, bud, baseUrl, user, pass);
    if (!loginRes.ok) {
      await this.appendLog('ERROR', `Login failed during check: ${loginRes.error}`);
      return { ok: false, error: loginRes.error };
    }

    const target = this.resolveTarget(config);
    const discRes = await discoverAssignment(
      jar,
      bud,
      baseUrl,
      config.courseId,
      target.assignmentName,
      target.sectionUrl
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

    return {
      ok: true,
      assignment: discRes.assignment,
      isLocked,
      serverOffsetMs: offset,
      courseContextId: discRes.courseContextId,
    };
  }

  /**
   * Arm the job: schedules Alarm A (T-10 minutes).
   */
  async arm() {
    const config = await this.getConfig();
    let unlockTimeMs: number;

    if (config.unlockAtOverride) {
      unlockTimeMs = Date.parse(config.unlockAtOverride);
    } else if (config.courseId === '10978') {
      const activeSchedule = getActivePracticalSchedule();
      unlockTimeMs = activeSchedule.unlockEpochMs;
    } else {
      unlockTimeMs = getNextWednesdayUnlockUtc();
    }

    await this.ctx.storage.put('nextUnlockAt', unlockTimeMs);

    // Alarm A is set 10 minutes prior to unlock
    const alarmATime = unlockTimeMs - 10 * 60 * 1000;
    const now = Date.now();

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
    return { ok: true, nextUnlockAt: unlockTimeMs, nextUnlockIso: new Date(unlockTimeMs).toISOString() };
  }

  async disarm() {
    await this.ctx.storage.deleteAlarm();
    await this.ctx.storage.delete('alarmStep');
    const file = await this.ctx.storage.get<StoredFileMeta>('file');
    await this.setPhase(file ? 'READY' : 'IDLE');
    await this.appendLog('INFO', 'Job disarmed by user');
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
    const baseUrl = this.env.MOODLE_BASE || 'https://hebat.elearning.unair.ac.id';
    const user = this.env.MOODLE_USER;
    const pass = this.env.MOODLE_PASS;
    const config = await this.getConfig();

    if (!user || !pass) {
      await this.setPhase('FAILED');
      throw new Error('Kredensial Moodle belum diatur');
    }

    const fileBytes = await this.ctx.storage.get<Uint8Array>('file_bytes');
    const fileMeta = await this.ctx.storage.get<StoredFileMeta>('file');
    if (!fileBytes || !fileMeta) {
      await this.setPhase('FAILED');
      throw new Error('Belum ada file PDF yang diunggah di tab Berkas!');
    }

    const jar = new CookieJar();
    const bud = new Budget(48);

    // 1. Login
    const loginRes = await loginMoodle(jar, bud, baseUrl, user, pass);
    if (!loginRes.ok) {
      await this.setPhase('FAILED');
      throw new Error(`Login gagal: ${loginRes.error}`);
    }

    // 2. Discover Assignment
    const target = this.resolveTarget(config);
    const discRes = await discoverAssignment(
      jar,
      bud,
      baseUrl,
      config.courseId,
      target.assignmentName,
      target.sectionUrl
    );
    if (!discRes.assignment) {
      await this.setPhase('FAILED');
      throw new Error(`Tugas "${target.assignmentName}" tidak ditemukan`);
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
      throw new Error(`Upload draft gagal: ${uploadRes.error}`);
    }

    // 4. Fetch Form & Submit
    const formFields = await fetchSubmissionForm(jar, bud, baseUrl, assignment.cmid);
    if (!formFields) {
      await this.setPhase('FAILED');
      throw new Error('Ambil form submission gagal (form belum tersedia)');
    }

    const dryRun = config.dryRun !== undefined ? config.dryRun : (this.env.DRY_RUN !== 'false');
    const tSubmitStart = Date.now();
    const submitRes = await submitAssignment(
      jar,
      bud,
      baseUrl,
      assignment.cmid,
      formFields,
      uploadRes.itemid,
      dryRun
    );
    const tSubmitElapsed = Date.now() - tSubmitStart;

    const lastResult: LastResult = {
      status: dryRun ? 'DRY_RUN' : submitRes.ok ? 'SUCCESS' : 'FAILED',
      tSubmitMs: tSubmitElapsed,
      note: dryRun
        ? 'Dry run submission completed. No mutations applied.'
        : `Submitted for grading. Verification: ${submitRes.status.statusText}`,
      timestamp: Date.now(),
    };

    await this.ctx.storage.put('lastResult', lastResult);
    await this.setPhase(submitRes.ok || dryRun ? 'DONE' : 'FAILED');

    // Notify Telegram
    await sendTelegramNotification(
      this.env.TELEGRAM_BOT_TOKEN,
      this.env.TELEGRAM_CHAT_ID,
      `✅ <b>Hebat_Submitter ${dryRun ? '[DRY RUN] ' : ''}Sukses!</b>\nTugas: ${assignment.name}\nDurasi submit: ${tSubmitElapsed} ms\nStatus: ${submitRes.status.statusText}`
    );

    return {
      ok: submitRes.ok || dryRun,
      dryRun,
      elapsedMs: tSubmitElapsed,
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
    const baseUrl = this.env.MOODLE_BASE || 'https://hebat.elearning.unair.ac.id';
    const user = this.env.MOODLE_USER;
    const pass = this.env.MOODLE_PASS;
    const config = await this.getConfig();

    if (!user || !pass) {
      await this.appendLog('ERROR', 'Alarm A aborted: credentials not configured');
      await this.setPhase('FAILED');
      return;
    }

    const fileBytes = await this.ctx.storage.get<Uint8Array>('file_bytes');
    const fileMeta = await this.ctx.storage.get<StoredFileMeta>('file');
    if (!fileBytes || !fileMeta) {
      await this.appendLog('ERROR', 'Alarm A aborted: no PDF file stored');
      await this.setPhase('FAILED');
      return;
    }

    const jar = new CookieJar();
    const bud = new Budget(48);

    // 1. Login
    const loginRes = await loginMoodle(jar, bud, baseUrl, user, pass);
    if (!loginRes.ok) {
      await this.appendLog('ERROR', `Alarm A login failed: ${loginRes.error}`);
      await this.setPhase('FAILED');
      return;
    }

    // 2. Discover Assignment & Course Context ID
    const target = this.resolveTarget(config);
    const discRes = await discoverAssignment(
      jar,
      bud,
      baseUrl,
      config.courseId,
      target.assignmentName,
      target.sectionUrl
    );
    if (!discRes.assignment) {
      await this.appendLog('ERROR', `Alarm A failed: assignment "${target.assignmentName}" not found`);
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
      await this.setPhase('FAILED');
      return;
    }

    await this.ctx.storage.put('draft', { itemId: uploadRes.itemid, createdAt: Date.now() });
    await this.ctx.storage.put('moodle_cookies', jar.dump());

    // 4. Sample server clock offset
    const offset = await sampleServerOffset(jar, bud, baseUrl);
    await this.ctx.storage.put('serverOffsetMs', offset);

    // 5. Schedule Alarm B at T-60s
    const nextUnlockAt = (await this.ctx.storage.get<number>('nextUnlockAt')) || getNextWednesdayUnlockUtc();
    const alarmBTime = nextUnlockAt - 60 * 1000;

    await this.ctx.storage.put('alarmStep', 'ALARM_B');
    if (alarmBTime > Date.now()) {
      await this.ctx.storage.setAlarm(alarmBTime);
      await this.appendLog('INFO', `Alarm B scheduled for ${new Date(alarmBTime).toISOString()}`);
    } else {
      await this.ctx.storage.setAlarm(Date.now() + 100);
      await this.appendLog('INFO', `Alarm B scheduled immediately`);
    }

    await this.setPhase('PREPARED');
  }

  private async runAlarmB() {
    await this.setPhase('WAITING');
    const baseUrl = this.env.MOODLE_BASE || 'https://hebat.elearning.unair.ac.id';
    const config = await this.getConfig();
    const assignment = await this.ctx.storage.get<DiscoveredAssignment>('assignment');
    const draft = await this.ctx.storage.get<{ itemId: number; createdAt: number }>('draft');
    const offset = (await this.ctx.storage.get<number>('serverOffsetMs')) || 0;
    const nextUnlockAt = (await this.ctx.storage.get<number>('nextUnlockAt')) || getNextWednesdayUnlockUtc();
    const dryRun = config.dryRun !== undefined ? config.dryRun : (this.env.DRY_RUN !== 'false');

    if (!assignment || !draft) {
      await this.appendLog('ERROR', 'Alarm B aborted: missing assignment or draft data');
      await this.setPhase('FAILED');
      return;
    }

    const savedCookies = (await this.ctx.storage.get<Record<string, string>>('moodle_cookies')) || {};
    const jar = CookieJar.load(savedCookies);
    const bud = new Budget(48);

    // Sleep until T - 400ms before starting polling
    const targetPollStartMs = nextUnlockAt - 400;
    await sleepUntil(targetPollStartMs, offset);

    await this.setPhase('POLLING');
    let unlocked = false;
    const pollStart = Date.now();
    const maxPollDurationMs = 120 * 1000; // max 120 seconds

    while (Date.now() - pollStart < maxPollDurationMs) {
      if (bud.remaining <= 8) {
        // Subrequest budget running low: re-arm in new invocation to reset budget
        await this.appendLog('WARN', 'Budget low during polling; resetting in new invocation');
        await this.ctx.storage.setAlarm(Date.now() + 20);
        return;
      }

      const lockRes = await checkAssignmentLock(jar, bud, baseUrl, assignment.cmid);
      if (!lockRes.isLocked) {
        unlocked = true;
        break;
      }

      // Wait 180ms before next poll (spec 8.4)
      await new Promise(r => setTimeout(r, 180));
    }

    if (!unlocked) {
      await this.appendLog('ERROR', 'Polling timeout: assignment did not unlock within 120s');
      await this.setPhase('FAILED');
      await sendTelegramNotification(
        this.env.TELEGRAM_BOT_TOKEN,
        this.env.TELEGRAM_CHAT_ID,
        `⚠️ <b>AutoSubmit Alert</b>: Tugas "${assignment.name}" belum terbuka setelah 120 detik. Silakan submit manual!`
      );
      return;
    }

    // Step: Form Submit
    await this.setPhase('SUBMITTING');
    const tSubmit0 = Date.now();
    const formFields = await fetchSubmissionForm(jar, bud, baseUrl, assignment.cmid);

    if (!formFields) {
      await this.appendLog('ERROR', 'Failed to parse submission form fields');
      await this.setPhase('FAILED');
      return;
    }

    const submitRes = await submitAssignment(
      jar,
      bud,
      baseUrl,
      assignment.cmid,
      formFields,
      draft.itemId,
      dryRun
    );

    const tSubmitElapsed = Date.now() - tSubmit0;
    const lastResult: LastResult = {
      status: dryRun ? 'DRY_RUN' : submitRes.ok ? 'SUCCESS' : 'FAILED',
      tSubmitMs: tSubmitElapsed,
      note: dryRun
        ? 'Dry run submission completed. No mutations applied.'
        : `Submitted for grading. Verification: ${submitRes.status.statusText}`,
      timestamp: Date.now(),
    };

    await this.ctx.storage.put('lastResult', lastResult);
    await this.setPhase(submitRes.ok || dryRun ? 'DONE' : 'FAILED');

    // Notify Telegram
    await sendTelegramNotification(
      this.env.TELEGRAM_BOT_TOKEN,
      this.env.TELEGRAM_CHAT_ID,
      `✅ <b>Hebat_Submitter ${dryRun ? '[DRY RUN] ' : ''}Sukses!</b>\nTugas: ${assignment.name}\nDurasi submit: ${tSubmitElapsed} ms\nStatus: ${submitRes.status.statusText}`
    );

    // Auto-weekly rescheduling
    if (config.autoWeekly) {
      await this.arm();
    }
  }
}
