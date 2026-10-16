import { DurableObject } from 'cloudflare:workers';
import { renderMockMoodleHtml } from './ui';

interface Env {
  MOCK_DO: DurableObjectNamespace<MockMoodleDO>;
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
  cmid: number;
  fileName: string;
  size: number;
  draftItemId: number;
  submittedAt: number;
  timeFromUnlockMs: number;
  status: string;
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
    await this.ctx.storage.put('drafts', this.drafts.slice(-10));
    await this.ctx.storage.put('submissions', this.submissions.slice(-10));
    await this.ctx.storage.put('trafficLogs', this.trafficLogs.slice(-50));
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
    if (this.trafficLogs.length > 50) this.trafficLogs.shift();
  }

  async fetch(req: Request): Promise<Response> {
    const t0 = Date.now();
    const url = new URL(req.url);

    // Apply simulated lag if configured
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
    // Control API
    // ------------------------------------------------------------------------
    if (url.pathname === '/mock-api/state' && req.method === 'GET') {
      return Response.json({
        unlockTimestampMs: this.unlockTimestampMs,
        lagMs: this.lagMs,
        offsetMs: this.offsetMs,
        drafts: this.drafts,
        submissions: this.submissions,
        trafficLogs: this.trafficLogs,
      });
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
    // Moodle Protocol Routes
    // ------------------------------------------------------------------------

    // Root UI
    if (url.pathname === '/' || url.pathname === '/index.php') {
      if (req.method === 'HEAD') {
        return makeRes(null, 200);
      }
      return makeRes(renderMockMoodleHtml(url.origin), 200, { 'Content-Type': 'text/html; charset=utf-8' });
    }

    // Login Form GET
    if (url.pathname === '/login/index.php' && req.method === 'GET') {
      const html = `
        <!DOCTYPE html>
        <html>
        <head><title>Moodle Hebat UNAIR Login</title></head>
        <body>
          <form action="/login/index.php" method="post" id="login">
            <input type="hidden" name="logintoken" value="mock_logintoken_${Date.now()}">
            <input type="text" name="username" id="username">
            <input type="password" name="password" id="password">
            <button type="submit">Log in</button>
          </form>
        </body>
        </html>
      `;
      return makeRes(html, 200, { 'Content-Type': 'text/html; charset=utf-8', 'X-Note': 'Form Login disajikan' });
    }

    // Login POST
    if (url.pathname === '/login/index.php' && req.method === 'POST') {
      const sessCookie = `mock_session_${Date.now()}`;
      return makeRes(null, 303, {
        'Location': `${url.origin}/`,
        'Set-Cookie': `MoodleSession=${sessCookie}; Path=/; HttpOnly; SameSite=Lax`,
        'X-Note': 'Login Berhasil, MoodleSession diterbitkan',
      });
    }

    // Discovery API: /lib/ajax/service.php
    if (url.pathname === '/lib/ajax/service.php') {
      const unlockSec = Math.floor(this.unlockTimestampMs / 1000);
      const resData = [
        {
          index: 0,
          data: [
            {
              id: 75330,
              name: 'Week 8',
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

    // My Courses / Dashboard
    if (url.pathname === '/my/courses.php' || url.pathname === '/my/' || url.pathname === '/my') {
      const coursesHtml = `
        <!DOCTYPE html>
        <html>
        <head><title>Dashboard Mahasiswa - Hebat Moodle</title></head>
        <body>
          <div class="courses-view">
            <a href="/course/view.php?id=10978">Sistem Operasi (Praktikum)</a>
            <a href="/course/view.php?id=10852">Algoritma & Pemrograman II</a>
            <a href="/course/view.php?id=10733">Basis Data</a>
          </div>
        </body>
        </html>
      `;
      return makeRes(coursesHtml, 200, { 'Content-Type': 'text/html; charset=utf-8' });
    }

    // Section view: /course/section.php
    if (url.pathname === '/course/section.php') {
      const html = `
        <!DOCTYPE html>
        <html>
        <body>
          <div class="section">
            <a href="/mod/assign/view.php?id=101761">Pengumpulan Modul Prak Lab 8 NDG Linux Essential</a>
          </div>
        </body>
        </html>
      `;
      return makeRes(html, 200, { 'Content-Type': 'text/html; charset=utf-8' });
    }

    // Course view: /course/view.php
    if (url.pathname === '/course/view.php') {
      const courseId = url.searchParams.get('id') || '10978';
      const unlockDateStr = new Date(this.unlockTimestampMs).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
      const html = `
        <!DOCTYPE html>
        <html>
        <head><title>Course ${courseId}</title></head>
        <body>
          <script>M.cfg = { contextid: "288276", sesskey: "mock_sess_${Date.now()}", userId: "12345" };</script>
          <ul class="section img-text">
            <li id="module-101761" class="activity assign modtype_assign">
              <div>
                <a class="aal_link" href="/mod/assign/view.php?id=101761"><span class="instancename">Pengumpulan Modul Prak Lab 8 NDG Linux Essential</span></a>
                <div class="availabilityinfo isrestricted">Available from ${unlockDateStr}, 7:00 AM</div>
                <div class="activity-dates">Due date: 22 October 2026, 23:59</div>
              </div>
            </li>
            <li id="module-101762" class="activity assign modtype_assign">
              <div>
                <a class="aal_link" href="/mod/assign/view.php?id=101762"><span class="instancename">Tugas Analisis Penjadwalan CPU</span></a>
                <div class="activity-dates">Due date: 18 October 2026, 23:59</div>
              </div>
            </li>
            <li id="module-101763" class="activity assign modtype_assign">
              <div>
                <a class="aal_link" href="/mod/assign/view.php?id=101763"><span class="instancename">Laporan Praktikum Mandiri Pekan 7</span></a>
                <div class="submissionstatussubmitted">Submitted for grading</div>
                <div class="activity-dates">Due date: 10 October 2026, 23:59</div>
              </div>
            </li>
          </ul>
        </body>
        </html>
      `;
      return makeRes(html, 200, { 'Content-Type': 'text/html; charset=utf-8' });
    }

    // Draft Pre-Upload: /repository/repository_ajax.php?action=upload
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

    // Assignment View / Submission: /mod/assign/view.php
    if (url.pathname === '/mod/assign/view.php') {
      const now = Date.now() + this.offsetMs;
      const isLocked = now < this.unlockTimestampMs;

      // POST: savesubmission
      if (req.method === 'POST') {
        if (isLocked) {
          return makeRes('Assignment is locked for submission', 403, {
            'X-Note': `[SUBMIT REJECTED] Tugas terkunci hingga ${new Date(this.unlockTimestampMs).toISOString()}`,
          });
        }

        const formText = await req.text();
        const params = new URLSearchParams(formText);
        const action = params.get('action');
        const draftItemId = parseInt(params.get('files_filemanager') || '0', 10);

        if (action === 'savesubmission') {
          const draft = this.drafts.find(d => d.itemId === draftItemId) || this.drafts[this.drafts.length - 1];
          const submitTime = Date.now();
          const latencyMs = submitTime - this.unlockTimestampMs;

          const record: SubmissionRecord = {
            cmid: 101761,
            fileName: draft ? draft.fileName : 'submission.pdf',
            size: draft ? draft.size : 1024,
            draftItemId: draftItemId,
            submittedAt: submitTime,
            timeFromUnlockMs: latencyMs,
            status: 'Submitted for grading',
          };

          this.submissions.push(record);
          await this.persist();

          const htmlSuccess = `
            <!DOCTYPE html>
            <html>
            <body>
              <div class="submissionstatussubmitted">Submitted for grading</div>
              <div class="feedback">Submission saved.</div>
            </body>
            </html>
          `;

          return makeRes(htmlSuccess, 200, {
            'Content-Type': 'text/html; charset=utf-8',
            'X-Note': `[SUBMISSION SUCCESS] Masuk +${latencyMs}ms dari jam buka!`,
          });
        }
      }

      // GET: view or editsubmission
      if (req.method === 'GET') {
        // EXACT MOODLE BEHAVIOR: Redirect to course page if locked!
        if (isLocked) {
          return makeRes(null, 303, {
            'Location': `${url.origin}/course/view.php?id=10978`,
            'X-Note': `[LOCK ENFORCED] 303 Redirect ke Course (Buka: ${new Date(this.unlockTimestampMs).toLocaleTimeString('id-ID')})`,
          });
        }

        // UNLOCKED!
        const action = url.searchParams.get('action');
        const latestDraft = this.drafts[this.drafts.length - 1];
        const draftId = latestDraft ? latestDraft.itemId : 987654321;

        if (action === 'editsubmission') {
          const formHtml = `
            <!DOCTYPE html>
            <html>
            <head>
              <script>var M = { cfg: { sesskey: "mock_sesskey_unair_999" } };</script>
            </head>
            <body>
              <form action="/mod/assign/view.php?id=101761" method="post" id="mform1">
                <input type="hidden" name="id" value="101761">
                <input type="hidden" name="action" value="savesubmission">
                <input type="hidden" name="sesskey" value="mock_sesskey_unair_999">
                <input type="hidden" name="_qf__mod_assign_submission_form" value="1">
                <input type="hidden" name="mform_isexpanded_id_submissionheader" value="1">
                <input type="hidden" name="userid" value="99999">
                <input type="hidden" name="lastmodified" value="${Math.floor(Date.now() / 1000)}">
                <input type="hidden" name="files_filemanager" value="${draftId}">
                <input type="submit" name="submitbutton" value="Save changes">
              </form>
            </body>
            </html>
          `;
          return makeRes(formHtml, 200, {
            'Content-Type': 'text/html; charset=utf-8',
            'X-Note': '[UNLOCKED] Form Submission editsubmission disajikan ke bot',
          });
        }

        // Default view (unlocked, not editing)
        const viewHtml = `
          <!DOCTYPE html>
          <html>
          <head>
            <script>var M = { cfg: { sesskey: "mock_sesskey_unair_999" } };</script>
          </head>
          <body>
            <h2>Pengumpulan Modul Prak Lab 8 NDG Linux Essential</h2>
            <div class="submissionstatus">Draft (not submitted)</div>
            <a href="/mod/assign/view.php?id=101761&action=editsubmission">Add submission</a>
          </body>
          </html>
        `;
        return makeRes(viewHtml, 200, {
          'Content-Type': 'text/html; charset=utf-8',
          'X-Note': '[UNLOCKED] Halaman tugas terbuka (Link Add submission aktif)',
        });
      }
    }

    return makeRes('Not Found', 404);
  }
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const id = env.MOCK_DO.idFromName('singleton_moodle_mock');
    const stub = env.MOCK_DO.get(id);
    return stub.fetch(req);
  },
};
