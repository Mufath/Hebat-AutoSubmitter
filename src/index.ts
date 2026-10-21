/**
 * src/index.ts
 * Cloudflare Worker entry point:
 * - Routing & Auth middleware (HMAC session cookie, rate limit)
 * - API Endpoints for Web UI (/api/*)
 * - Cron Trigger handler
 * - Static Assets serving
 */

import { SubmitJob, Env } from './job';
import { CookieJar, Budget } from './moodle/http';
import { loginMoodle } from './moodle/login';

// Re-export Durable Object class
export { SubmitJob };

const COOKIE_NAME = 'hebat_session';
const SESSION_TTL_MS = 12 * 60 * 60 * 1000; // 12 hours

// ----------------------------------------------------------------------------
// HMAC Auth Helpers
// ----------------------------------------------------------------------------

async function getHmacKey(secret: string): Promise<CryptoKey> {
  const enc = new TextEncoder();
  return crypto.subtle.importKey(
    'raw',
    enc.encode(secret || 'hebat-submitter-unair-session-key-32b'),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify']
  );
}

async function signSessionToken(secret: string, expiryMs: number, nim: string): Promise<string> {
  const payload = `${expiryMs}:${nim}`;
  const key = await getHmacKey(secret);
  const enc = new TextEncoder();
  const sigBuf = await crypto.subtle.sign('HMAC', key, enc.encode(payload));
  const sigHex = [...new Uint8Array(sigBuf)].map(b => b.toString(16).padStart(2, '0')).join('');
  return `${payload}.${sigHex}`;
}

async function verifySessionToken(token: string, secret: string): Promise<{ valid: boolean; nim: string }> {
  const parts = token.split('.');
  if (parts.length !== 2) return { valid: false, nim: '' };
  const [payload, sigHex] = parts;
  const colonIdx = payload.indexOf(':');

  if (colonIdx === -1) {
    // Invalidate old legacy tokens without explicit NIM
    return { valid: false, nim: '' };
  }

  const expiryStr = payload.slice(0, colonIdx);
  const nim = payload.slice(colonIdx + 1);
  const expiryMs = parseInt(expiryStr, 10);
  if (isNaN(expiryMs) || Date.now() > expiryMs || !nim || nim === 'default') {
    return { valid: false, nim: '' };
  }

  const key = await getHmacKey(secret);
  const enc = new TextEncoder();
  const matchBytes = sigHex.match(/.{1,2}/g);
  if (!matchBytes) return { valid: false, nim: '' };
  const sigBytes = new Uint8Array(matchBytes.map(byte => parseInt(byte, 16)));

  const valid = await crypto.subtle.verify('HMAC', key, sigBytes, enc.encode(payload));
  return { valid, nim: valid ? nim : '' };
}

function parseCookie(req: Request, name: string): string | null {
  const cookieHeader = req.headers.get('cookie') || '';
  for (const part of cookieHeader.split(';')) {
    const [k, v] = part.trim().split('=');
    if (k === name) return v || null;
  }
  return null;
}

function jsonResponse(data: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json',
      'x-content-type-options': 'nosniff',
      'x-frame-options': 'DENY',
      'referrer-policy': 'no-referrer',
      ...headers,
    },
  });
}

// ----------------------------------------------------------------------------
// Worker Fetch Handler
// ----------------------------------------------------------------------------

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);

    // Route: /api/login (Public) - Authenticates directly against UNAIR Moodle
    if (url.pathname === '/api/login' && req.method === 'POST') {
      try {
        const body = (await req.json()) as { nim?: string; password?: string };
        const rawNim = (body.nim || '').trim();
        const password = (body.password || '').trim();

        if (!rawNim || !password) {
          return jsonResponse({ ok: false, error: 'Harap masukkan NIM dan Password Cybercampus / Hebat Unair Anda.' }, 400);
        }

        const cleanNim = rawNim.replace(/[^a-zA-Z0-9_-]/g, '');
        if (!cleanNim) {
          return jsonResponse({ ok: false, error: 'Format NIM tidak valid.' }, 400);
        }

        // Direct real-time authentication with Hebat Unair
        const moodleBase = env.MOODLE_BASE || 'https://hebat.elearning.unair.ac.id';
        const jar = new CookieJar();
        const bud = new Budget(40);
        const loginRes = await loginMoodle(jar, bud, moodleBase, cleanNim, password);

        if (!loginRes.ok) {
          let errDetail = 'NIM atau Password Hebat Unair salah. Periksa kembali akun Cybercampus Anda.';
          if (loginRes.error === 'NO_MOODLE_SESSION_COOKIE' || loginRes.error === 'LOGIN_REJECTED') {
            errDetail = 'NIM atau Password Cybercampus tidak cocok. Akses Hebat Unair ditolak.';
          }
          return jsonResponse({ ok: false, error: errDetail }, 401);
        }

        // Successfully verified with Hebat Unair
        const expiryMs = Date.now() + SESSION_TTL_MS;
        const secret = env.SESSION_HMAC_KEY || 'hebat-submitter-unair-session-key-32b';
        const token = await signSessionToken(secret, expiryMs, cleanNim);

        // Pre-save authenticated credentials into user's isolated DO storage
        const doId = env.JOB.idFromName(`user_${cleanNim}`);
        const stub = env.JOB.get(doId, { locationHint: 'apac' }) as unknown as SubmitJob;
        await stub.initUser(cleanNim);
        await stub.setConfig({ moodleUser: cleanNim, moodlePass: password });

        const ownerNim = (env.MOODLE_USER || '').trim();
        const isOwner = Boolean(ownerNim && cleanNim === ownerNim);

        const cookie = `${COOKIE_NAME}=${token}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${12 * 3600}`;
        return jsonResponse({ ok: true, nim: cleanNim, isOwner }, 200, { 'set-cookie': cookie });
      } catch (err: any) {
        return jsonResponse({ ok: false, error: `Gagal verifikasi Hebat Unair: ${err.message}` }, 500);
      }
    }

    // Route: /api/logout (Public)
    if (url.pathname === '/api/logout' && req.method === 'POST') {
      const cookie = `${COOKIE_NAME}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`;
      return jsonResponse({ ok: true }, 200, { 'set-cookie': cookie });
    }

    // All other /api/* endpoints require valid session
    if (url.pathname.startsWith('/api/')) {
      try {
        const token = parseCookie(req, COOKIE_NAME);
        const secret = env.SESSION_HMAC_KEY || env.APP_PASSWORD || 'admin';
        const auth = token ? await verifySessionToken(token, secret) : { valid: false, nim: '' };

        if (!auth.valid) {
          return jsonResponse({ ok: false, error: 'UNAUTHORIZED' }, 401);
        }

        // CSRF protection for mutations
        if (req.method !== 'GET' && req.method !== 'HEAD') {
          const xReq = req.headers.get('x-requested-with');
          if (xReq !== 'fetch') {
            return jsonResponse({ ok: false, error: 'CSRF_BLOCKED' }, 403);
          }
        }

        // Get user-isolated Durable Object instance partitioned by NIM
        const userNim = auth.nim || 'default';
        const doId = env.JOB.idFromName(`user_${userNim}`);
        const stub = env.JOB.get(doId, { locationHint: 'apac' }) as unknown as SubmitJob;
        await stub.initUser(userNim);

        // Route: GET /api/status
        if (url.pathname === '/api/status' && req.method === 'GET') {
          const status = await stub.getStatus();
          return jsonResponse(status);
        }

        // Route: POST /api/config
        if (url.pathname === '/api/config' && req.method === 'POST') {
          const body = await req.json() as Record<string, unknown>;
          const updated = await stub.setConfig(body);
          return jsonResponse({ ok: true, config: updated });
        }

        // Route: POST /api/file
        if (url.pathname === '/api/file' && req.method === 'POST') {
          const formData = await req.formData();
          const file = formData.get('file');

          if (!file || typeof file === 'string') {
            return jsonResponse({ ok: false, error: 'NO_FILE_PROVIDED' }, 400);
          }

          const fileObj = file as File;
          const bytes = new Uint8Array(await fileObj.arrayBuffer());

          // Validate PDF magic bytes: %PDF-
          if (bytes.length < 5 || bytes[0] !== 0x25 || bytes[1] !== 0x50 || bytes[2] !== 0x44 || bytes[3] !== 0x46 || bytes[4] !== 0x2d) {
            return jsonResponse({ ok: false, error: 'INVALID_PDF_MAGIC_BYTES' }, 400);
          }

          // SHA-256 hash
          const hashBuf = await crypto.subtle.digest('SHA-256', bytes);
          const sha256 = [...new Uint8Array(hashBuf)].map(b => b.toString(16).padStart(2, '0')).join('');

          const meta = await stub.saveFile(fileObj.name, bytes, sha256);
          return jsonResponse({ ok: true, file: meta });
        }

        // Route: DELETE /api/file
        if (url.pathname === '/api/file' && req.method === 'DELETE') {
          await stub.deleteFile();
          return jsonResponse({ ok: true });
        }

        // Route: POST /api/check
        if (url.pathname === '/api/check' && req.method === 'POST') {
          const res = await stub.checkOnly();
          return jsonResponse(res);
        }

        // Route: POST /api/prepare
        if (url.pathname === '/api/prepare' && req.method === 'POST') {
          await stub.prepareNow();
          return jsonResponse({ ok: true });
        }

        // Route: POST /api/submit-now
        if (url.pathname === '/api/submit-now' && req.method === 'POST') {
          const res = await stub.submitNow();
          return jsonResponse(res);
        }

        // Route: POST /api/simulate-run
        if (url.pathname === '/api/simulate-run' && req.method === 'POST') {
          const body = (await req.json().catch(() => ({}))) as { seconds?: number };
          const seconds = body.seconds || 120; // 2 minutes
          const targetIso = new Date(Date.now() + seconds * 1000).toISOString();
          await stub.setConfig({ unlockAtOverride: targetIso, simulationOverride: true });
          const res = await stub.arm();
          return jsonResponse({ ok: true, targetIso, res });
        }

        // Route: POST /api/arm
        if (url.pathname === '/api/arm' && req.method === 'POST') {
          const res = await stub.arm();
          return jsonResponse(res);
        }

        // Route: POST /api/disarm
        if (url.pathname === '/api/disarm' && req.method === 'POST') {
          const res = await stub.disarm();
          return jsonResponse(res);
        }

        // Route: GET /api/logs
        if (url.pathname === '/api/logs' && req.method === 'GET') {
          const limit = parseInt(url.searchParams.get('limit') || '200', 10);
          const logs = await stub.getLogsList(limit);
          return jsonResponse(logs);
        }

        // Route: GET /api/global-logs (Owner audit trail of all users)
        if (url.pathname === '/api/global-logs' && req.method === 'GET') {
          const ownerNim = (env.MOODLE_USER || '').trim();
          const isOwner = Boolean(ownerNim && auth.nim === ownerNim);
          if (!isOwner) {
            return jsonResponse({ ok: false, error: 'FORBIDDEN_OWNER_ONLY' }, 403);
          }
          const adminId = env.JOB.idFromName('__global_audit__');
          const adminStub = env.JOB.get(adminId) as unknown as SubmitJob;
          const limit = parseInt(url.searchParams.get('limit') || '100', 10);
          const audits = await adminStub.getGlobalAudits(limit);
          return jsonResponse({ ok: true, audits });
        }

        // Route: GET /api/ping (Fast latency measurement to Moodle)
        if (url.pathname === '/api/ping' && (req.method === 'GET' || req.method === 'HEAD')) {
          const t0 = Date.now();
          const config = await stub.getConfig();
          const baseUrl = config.moodleBase || env.MOODLE_BASE || 'https://hebat.elearning.unair.ac.id';
          try {
            await fetch(`${baseUrl}/login/index.php`, {
              method: 'HEAD',
              headers: { 'cache-control': 'no-cache' },
            });
            const latencyMs = Math.max(1, Date.now() - t0);
            return jsonResponse({ ok: true, latencyMs });
          } catch (err: any) {
            return jsonResponse({ ok: false, latencyMs: null, error: err.message }, 200);
          }
        }

        // Route: GET /api/assignments (Fetch enrolled courses and assignments)
        if (url.pathname === '/api/assignments' && req.method === 'GET') {
          const courseId = url.searchParams.get('courseId') || undefined;
          const result = await stub.fetchAllAssignments(courseId);
          return jsonResponse(result);
        }

        // Route: POST /api/select-assignment (Target a specific assignment)
        if (url.pathname === '/api/select-assignment' && req.method === 'POST') {
          const body = (await req.json()) as { courseId?: string; assignmentName?: string; cmid?: string; unlockIso?: string };
          const updates: Record<string, unknown> = {};
          if (body.courseId) updates.courseId = body.courseId;
          if (body.assignmentName) updates.assignmentName = body.assignmentName;
          if (body.cmid) updates.assignmentCmid = body.cmid;
          if (body.unlockIso) {
            updates.customUnlockIso = body.unlockIso;
            updates.scheduleMode = 'CUSTOM';
          }
          const updated = await stub.setConfig(updates);
          return jsonResponse({ ok: true, config: updated });
        }

        // Route: POST /api/test-notify
        if (url.pathname === '/api/test-notify' && req.method === 'POST') {
          const res = await stub.testTelegram();
          return jsonResponse(res);
        }

        return jsonResponse({ ok: false, error: 'NOT_FOUND' }, 404);
      } catch (err: any) {
        return jsonResponse({ ok: false, error: err.message || 'INTERNAL_ERROR' }, 500);
      }
    }

    // Serve UI static assets (index.html, style.css, app.js)
    if (env.ASSETS) {
      return env.ASSETS.fetch(req);
    }

    return new Response(
      `<!DOCTYPE html><html><head><title>SubSecond</title></head><body><h1>SubSecond Active</h1><p>UI assets not found.</p></body></html>`,
      { headers: { 'content-type': 'text/html; charset=utf-8' } }
    );
  },

  async scheduled(_event: ScheduledEvent, env: Env): Promise<void> {
    const id = env.JOB.idFromName('main');
    const stub = env.JOB.get(id) as unknown as SubmitJob;
    const status = await stub.getStatus();

    if (status.config.autoWeekly) {
      await stub.arm();
    }
  },
};
