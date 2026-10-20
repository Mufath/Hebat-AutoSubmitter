import { DurableObject } from 'cloudflare:workers';
import {
  renderLandingHtml,
  renderLoginHtml,
  renderDashboardHtml,
  renderMyCoursesHtml,
  renderCourseViewHtml,
  renderAssignmentViewHtml,
  renderEditSubmissionHtml,
  MockAppState,
} from './ui';

interface Env {
  MOCK_DO: DurableObjectNamespace<MockMoodleDO>;
  ASSETS?: Fetcher;
}

interface DraftFile {
  itemId: number;
  fileName: string;
  size: number;
  author: string;
  createdAt: number;
  fileBase64?: string;
}

interface SubmissionRecord {
  rank: number;
  cmid: number;
  fileName: string;
  size: number;
  draftItemId: number;
  submittedAt: number;
  timeFromUnlockMs: number;
  status: string;
  botName?: string;
  userAgent?: string;
}

interface TrafficLog {
  id: string;
  timestamp: number;
  method: string;
  path: string;
  query: string;
  status: number;
  note: string;
  elapsedMs: number;
}

export class MockMoodleDO extends DurableObject<Env> {
  private unlockTimestampMs: number = Date.now() + 120_000; // default 2 minutes from now
  private lagMs: number = 0;
  private offsetMs: number = 0;
  private drafts: DraftFile[] = [];
  private submissions: SubmissionRecord[] = [];
  private trafficLogs: TrafficLog[] = [];

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.ctx.blockConcurrencyWhile(async () => {
      this.unlockTimestampMs = (await this.ctx.storage.get<number>('unlockTimestampMs')) || Date.now() + 120_000;
      this.lagMs = (await this.ctx.storage.get<number>('lagMs')) || 0;
      this.offsetMs = (await this.ctx.storage.get<number>('offsetMs')) || 0;
      this.drafts = (await this.ctx.storage.get<DraftFile[]>('drafts')) || [];
      this.submissions = (await this.ctx.storage.get<SubmissionRecord[]>('submissions')) || [];
      this.trafficLogs = (await this.ctx.storage.get<TrafficLog[]>('trafficLogs')) || [];
    });
  }

  private async persist() {
    await this.ctx.storage.put('unlockTimestampMs', this.unlockTimestampMs);
    await this.ctx.storage.put('lagMs', this.lagMs);
    await this.ctx.storage.put('offsetMs', this.offsetMs);
    await this.ctx.storage.put('drafts', this.drafts.slice(-15));
    await this.ctx.storage.put('submissions', this.submissions.slice(-15));
    await this.ctx.storage.put('trafficLogs', this.trafficLogs.slice(-60));
  }

  private logTraffic(method: string, path: string, query: string, status: number, note: string, elapsedMs: number) {
    const entry: TrafficLog = {
      id: Math.random().toString(36).substring(2, 9),
      timestamp: Date.now(),
      method,
      path,
      query,
      status,
      note,
      elapsedMs,
    };
    this.trafficLogs.push(entry);
    if (this.trafficLogs.length > 60) this.trafficLogs.shift();
  }

  private getState(): MockAppState {
    return {
      unlockTimestampMs: this.unlockTimestampMs,
      lagMs: this.lagMs,
      offsetMs: this.offsetMs,
      drafts: this.drafts,
      submissions: this.submissions,
      trafficLogs: this.trafficLogs,
    };
  }

  async fetch(req: Request): Promise<Response> {
    const t0 = Date.now();
    const url = new URL(req.url);

    // Apply simulated lag if configured (except control APIs)
    if (this.lagMs > 0 && !url.pathname.startsWith('/mock-api/')) {
      await new Promise(resolve => setTimeout(resolve, this.lagMs));
    }

    // Helper to wrap responses with Moodle Date header and simulated offset
    const makeRes = (body: BodyInit | null, status = 200, headersInit: Record<string, string> = {}) => {
      const serverDate = new Date(Date.now() + this.offsetMs).toUTCString();
      const headers = new Headers({
        'Date': serverDate,
        'Server': 'Apache/2.4.52 (Ubuntu)',
        'X-Powered-By': 'PHP/8.1.2',
        ...headersInit,
      });
      const res = new Response(body, { status, headers });
      this.logTraffic(req.method, url.pathname, url.search, status, headersInit['X-Note'] || '', Date.now() - t0);
      return res;
    };

    // ------------------------------------------------------------------------
    // Static Assets Fallback
    // ------------------------------------------------------------------------
    if (url.pathname.startsWith('/assets/')) {
      if (this.env.ASSETS) {
        const assetRes = await this.env.ASSETS.fetch(req);
        if (assetRes.status !== 404) return assetRes;
      }
    }

    // ------------------------------------------------------------------------
    // Control API for Sandbox & Neutral Referee
    // ------------------------------------------------------------------------
    if (url.pathname === '/mock-api/state' && req.method === 'GET') {
      return Response.json(this.getState());
    }

    if (url.pathname === '/mock-api/set-unlock' && req.method === 'POST') {
      const body = (await req.json().catch(() => ({}))) as { seconds?: number };
      const seconds = typeof body.seconds === 'number' ? body.seconds : 120;
      this.unlockTimestampMs = Date.now() + seconds * 1000;
      await this.persist();
      return Response.json({ ok: true, unlockTimestampMs: this.unlockTimestampMs });
    }

    if (url.pathname === '/mock-api/set-lag' && req.method === 'POST') {
      const body = (await req.json().catch(() => ({}))) as { lagMs?: number };
      this.lagMs = body.lagMs || 0;
      await this.persist();
      return Response.json({ ok: true, lagMs: this.lagMs });
    }

    if (url.pathname === '/mock-api/reset' && req.method === 'POST') {
      this.drafts = [];
      this.submissions = [];
      this.trafficLogs = [];
      this.unlockTimestampMs = Date.now() + 120_000;
      await this.persist();
      return Response.json({ ok: true });
    }

    if (url.pathname === '/mock-api/download-file' && req.method === 'GET') {
      const id = parseInt(url.searchParams.get('id') || '0', 10);
      const draft = this.drafts.find(d => d.itemId === id);
      if (!draft || !draft.fileBase64) {
        return new Response('File not found', { status: 404 });
      }
      const bin = Uint8Array.from(atob(draft.fileBase64), c => c.charCodeAt(0));
      return new Response(bin, {
        headers: {
          'Content-Type': 'application/pdf',
          'Content-Disposition': `attachment; filename="${draft.fileName}"`,
        },
      });
    }

    // ------------------------------------------------------------------------
    // Moodle Protocol Routes (1:1 HEBAT Unair Realism)
    // ------------------------------------------------------------------------

    // 1. Root / Landing Page Hebat Gen 2
    if (url.pathname === '/' || url.pathname === '/index.php') {
      if (req.method === 'HEAD') {
        return makeRes(null, 200);
      }
      return makeRes(renderLandingHtml(url.origin), 200, {
        'Content-Type': 'text/html; charset=utf-8',
        'X-Note': 'Landing Page Hebat Gen 2 Disajikan',
      });
    }

    // 2. Login Form HEAD (Clock Sync Probe) / GET / POST
    if (url.pathname === '/login/' || url.pathname === '/login/index.php') {
      if (req.method === 'HEAD') {
        return makeRes(null, 200, { 'X-Note': 'Clock Sync HEAD Probe (Server Time Disajikan)' });
      }

      if (req.method === 'GET') {
        return makeRes(renderLoginHtml(url.origin), 200, {
          'Content-Type': 'text/html; charset=utf-8',
          'X-Note': 'Form Login Hebat disajikan',
        });
      }

      if (req.method === 'POST') {
        const sessCookie = `mock_session_${Date.now()}`;
        return makeRes(null, 303, {
          'Location': `${url.origin}/my/`,
          'Set-Cookie': `MoodleSession=${sessCookie}; Path=/; HttpOnly; SameSite=Lax`,
          'X-Note': 'Login Berhasil, Redirect ke Dashboard /my/',
        });
      }
    }

    // 3. Student Dashboard: /my/ or /my
    if (url.pathname === '/my/' || url.pathname === '/my' || url.pathname === '/my/index.php') {
      return makeRes(renderDashboardHtml(url.origin, this.getState()), 200, {
        'Content-Type': 'text/html; charset=utf-8',
        'X-Note': 'Dashboard Mahasiswa disajikan',
      });
    }

    // 4. My Courses Page: /my/courses.php
    if (url.pathname === '/my/courses.php') {
      return makeRes(renderMyCoursesHtml(url.origin), 200, {
        'Content-Type': 'text/html; charset=utf-8',
        'X-Note': 'Daftar Kursus Mahasiswa disajikan',
      });
    }

    // 5. Course Page: /course/view.php or /course/section.php
    if (url.pathname === '/course/view.php' || url.pathname === '/course/section.php') {
      const courseId = url.searchParams.get('id') || '10978';
      return makeRes(renderCourseViewHtml(url.origin, courseId, this.getState()), 200, {
        'Content-Type': 'text/html; charset=utf-8',
        'X-Note': `Halaman Kursus ${courseId} disajikan`,
      });
    }

    // 6. Discovery API for SubSecond / Moodle Ajax: /lib/ajax/service.php
    if (url.pathname === '/lib/ajax/service.php') {
      const unlockSec = Math.floor(this.unlockTimestampMs / 1000);
      const resData = [
        {
          index: 0,
          data: [
            {
              id: 75330,
              name: 'Week 8 - NDG Linux Essentials',
              modules: [
                {
                  id: 101761,
                  name: 'Pengumpulan Modul Prak Lab 8 NDG Linux Essential',
                  modname: 'assign',
                  url: `${url.origin}/mod/assign/view.php?id=101761`,
                  dates: [
                    { label: 'Available from:', timestamp: unlockSec },
                    { label: 'Due date:', timestamp: unlockSec + 144000 },
                  ],
                },
              ],
            },
          ],
        },
      ];
      return makeRes(JSON.stringify(resData), 200, {
        'Content-Type': 'application/json',
        'X-Note': `Discovery Course 10978 (Buka: ${new Date(this.unlockTimestampMs).toISOString()})`,
      });
    }

    // 7. Draft Pre-Upload: /repository/repository_ajax.php?action=upload
    if (url.pathname === '/repository/repository_ajax.php' && url.searchParams.get('action') === 'upload') {
      try {
        const formData = await req.formData();
        const file = formData.get('repo_upload_file');
        const author = String(formData.get('author') || 'Mahasiswa UNAIR');
        let itemId = parseInt(String(formData.get('itemid') || '0'), 10);
        if (!itemId || itemId === 0) {
          itemId = Math.floor(100000000 + Math.random() * 900000000);
        }

        let fileName = 'laporan.pdf';
        let fileSize = 0;
        let fileBase64 = '';

        if (file && typeof file === 'object' && 'arrayBuffer' in file) {
          const blob = file as Blob;
          fileName = (file as File).name || 'laporan.pdf';
          fileSize = blob.size;
          const ab = await blob.arrayBuffer();
          const bytes = new Uint8Array(ab);
          let binary = '';
          for (let i = 0; i < bytes.byteLength; i++) {
            binary += String.fromCharCode(bytes[i]);
          }
          fileBase64 = btoa(binary);
        }

        const draft: DraftFile = {
          itemId,
          fileName,
          size: fileSize,
          author,
          createdAt: Date.now(),
          fileBase64,
        };

        this.drafts.push(draft);
        await this.persist();

        const json = {
          itemid: itemId,
          url: `${url.origin}/draftfile.php`,
          id: itemId,
          file: fileName,
          status: 'success',
        };

        return makeRes(JSON.stringify(json), 200, {
          'Content-Type': 'application/json',
          'X-Note': `[PRE-UPLOAD] Draft disimpan: ${fileName} (${fileSize}B) -> itemid: ${itemId}`,
        });
      } catch (err: any) {
        return makeRes(JSON.stringify({ error: err.message }), 500, { 'Content-Type': 'application/json' });
      }
    }

    // 8. Assignment View & Submit: /mod/assign/view.php
    if (url.pathname === '/mod/assign/view.php') {
      const now = Date.now() + this.offsetMs;
      const isLocked = now < this.unlockTimestampMs;
      const cmid = url.searchParams.get('id') || '101761';
      const action = url.searchParams.get('action');

      // POST: savesubmission (MUTASI NYATA PENGUMPULAN TUGAS)
      if (req.method === 'POST') {
        if (isLocked) {
          return makeRes('Assignment is locked for submission', 403, {
            'X-Note': `[SUBMIT DITOLAK] Tugas terkunci hingga ${new Date(this.unlockTimestampMs).toISOString()}`,
          });
        }

        const formText = await req.text();
        const params = new URLSearchParams(formText);
        const postAction = params.get('action');
        const draftItemId = parseInt(params.get('files_filemanager') || '0', 10);

        if (postAction === 'savesubmission') {
          const draft = this.drafts.find(d => d.itemId === draftItemId) || this.drafts[this.drafts.length - 1];
          const submitTime = now;
          const latencyMs = submitTime - this.unlockTimestampMs;
          const userAgent = req.headers.get('user-agent') || 'Unknown Agent';

          // Detect Bot Identity
          const customHeader = req.headers.get('x-bot-name') || req.headers.get('x-client-id');
          let botName = customHeader || '';
          if (!botName) {
            if (userAgent.includes('Cloudflare-Workers') || userAgent.includes('SubSecond')) {
              botName = 'SubSecond ⚡';
            } else if (userAgent.includes('python') || userAgent.includes('requests') || userAgent.includes('aiohttp')) {
              botName = 'Bot Teman (Python)';
            } else if (userAgent.includes('curl') || userAgent.includes('Wget')) {
              botName = 'Bot Teman (cURL)';
            } else if (userAgent.includes('Node') || userAgent.includes('undici') || userAgent.includes('axios')) {
              botName = 'Bot (Node.js)';
            } else {
              const count = this.submissions.length + 1;
              botName = count === 1 ? 'Peserta #1' : count === 2 ? 'Peserta #2' : `Peserta #${count}`;
            }
          }

          const rank = this.submissions.length + 1;
          const record: SubmissionRecord = {
            rank,
            cmid: parseInt(cmid, 10),
            fileName: draft ? draft.fileName : 'PrakSO_I3_Week8_187251052.pdf',
            size: draft ? draft.size : 2048,
            draftItemId: draftItemId,
            submittedAt: submitTime,
            timeFromUnlockMs: latencyMs,
            status: 'Submitted for grading',
            botName,
            userAgent,
          };

          this.submissions.push(record);
          await this.persist();

          // Real Moodle responds with 303 redirect to /mod/assign/view.php?id=cmid
          return makeRes(null, 303, {
            'Location': `${url.origin}/mod/assign/view.php?id=${cmid}`,
            'X-Note': `[PENGUMPULAN SUKSES] Juara #${rank} (${botName}) masuk +${latencyMs}ms dari jam buka!`,
          });
        }
      }

      // GET: view or editsubmission
      if (req.method === 'GET') {
        const latestDraft = this.drafts[this.drafts.length - 1];
        const draftId = latestDraft ? latestDraft.itemId : 987654321;

        // If bot probes editsubmission while locked:
        // EXACT MOODLE BEHAVIOR: 303 Redirect to course page!
        if (action === 'editsubmission') {
          if (isLocked) {
            return makeRes(null, 303, {
              'Location': `${url.origin}/course/view.php?id=10978`,
              'X-Note': `[TERKUNCI] 303 Redirect ke Course (Buka: ${new Date(this.unlockTimestampMs).toLocaleTimeString('id-ID')})`,
            });
          }
          // Unlocked: Render 1:1 Edit Submission Form
          return makeRes(renderEditSubmissionHtml(url.origin, cmid, draftId, this.getState()), 200, {
            'Content-Type': 'text/html; charset=utf-8',
            'X-Note': '[TERBUKA] Form editsubmission disajikan ke bot/mahasiswa',
          });
        }

        // Standard Assignment View (No action=editsubmission)
        return makeRes(renderAssignmentViewHtml(url.origin, cmid, this.getState()), 200, {
          'Content-Type': 'text/html; charset=utf-8',
          'X-Note': isLocked
            ? '[TERKUNCI] Halaman Tugas (Restricted) disajikan'
            : '[TERBUKA] Halaman Tugas (Siap Submit) disajikan',
        });
      }
    }

    return makeRes('Not Found', 404);
  }
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    if (env.ASSETS && url.pathname.startsWith('/assets/')) {
      const assetRes = await env.ASSETS.fetch(req);
      if (assetRes.status !== 404) return assetRes;
    }
    const id = env.MOCK_DO.idFromName('singleton_moodle_mock');
    const stub = env.MOCK_DO.get(id);
    return stub.fetch(req);
  },
};
