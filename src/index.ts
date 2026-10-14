/**
 * src/index.ts
 * Cloudflare Worker entry point:
 * - Routing & Auth middleware (HMAC session cookie, rate limit)
 * - API Endpoints for Web UI (/api/*)
 * - Cron Trigger handler
 * - Static Assets serving
 */

import { SubmitJob, Env } from './job';
import { sendTelegramNotification } from './notify';

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
    enc.encode(secret || 'default-insecure-key-change-me-immediately-32b'),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify']
  );
}

async function signSessionToken(secret: string, expiryMs: number): Promise<string> {
  const payload = `${expiryMs}`;
  const key = await getHmacKey(secret);
  const enc = new TextEncoder();
  const sigBuf = await crypto.subtle.sign('HMAC', key, enc.encode(payload));
  const sigHex = [...new Uint8Array(sigBuf)].map(b => b.toString(16).padStart(2, '0')).join('');
  return `${payload}.${sigHex}`;
}

async function verifySessionToken(token: string, secret: string): Promise<boolean> {
  const parts = token.split('.');
  if (parts.length !== 2) return false;
  const [expiryStr, sigHex] = parts;
  const expiryMs = parseInt(expiryStr, 10);
  if (isNaN(expiryMs) || Date.now() > expiryMs) return false;

  const key = await getHmacKey(secret);
  const enc = new TextEncoder();
  const matchBytes = sigHex.match(/.{1,2}/g);
  if (!matchBytes) return false;
  const sigBytes = new Uint8Array(matchBytes.map(byte => parseInt(byte, 16)));

  return crypto.subtle.verify('HMAC', key, sigBytes, enc.encode(expiryStr));
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

    // Get Durable Object singleton instance
    const id = env.JOB.idFromName('main');
    const stub = env.JOB.get(id) as unknown as SubmitJob;

    // Route: /api/login (Public)
    if (url.pathname === '/api/login' && req.method === 'POST') {
      try {
        const body = (await req.json()) as { password?: string };
        const appPassword = env.APP_PASSWORD || 'admin';

        if (!body.password || body.password !== appPassword) {
          return jsonResponse({ ok: false, error: 'INVALID_PASSWORD' }, 401);
        }

        const expiryMs = Date.now() + SESSION_TTL_MS;
        const secret = env.SESSION_HMAC_KEY || appPassword;
        const token = await signSessionToken(secret, expiryMs);

        const cookie = `${COOKIE_NAME}=${token}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${12 * 3600}`;
        return jsonResponse({ ok: true }, 200, { 'set-cookie': cookie });
      } catch {
        return jsonResponse({ ok: false, error: 'BAD_REQUEST' }, 400);
      }
    }

    // Route: /api/logout (Public)
    if (url.pathname === '/api/logout' && req.method === 'POST') {
      const cookie = `${COOKIE_NAME}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`;
      return jsonResponse({ ok: true }, 200, { 'set-cookie': cookie });
    }

    // All other /api/* endpoints require valid session
    if (url.pathname.startsWith('/api/')) {
      const token = parseCookie(req, COOKIE_NAME);
      const secret = env.SESSION_HMAC_KEY || env.APP_PASSWORD || 'admin';
      const isValid = token ? await verifySessionToken(token, secret) : false;

      if (!isValid) {
        return jsonResponse({ ok: false, error: 'UNAUTHORIZED' }, 401);
      }

      // CSRF protection for mutations
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        const xReq = req.headers.get('x-requested-with');
        if (xReq !== 'fetch') {
          return jsonResponse({ ok: false, error: 'CSRF_BLOCKED' }, 403);
        }
      }

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
        await stub.setConfig({ unlockAtOverride: targetIso });
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

      // Route: POST /api/test-notify
      if (url.pathname === '/api/test-notify' && req.method === 'POST') {
        const res = await sendTelegramNotification(
          env.TELEGRAM_BOT_TOKEN,
          env.TELEGRAM_CHAT_ID,
          '🔔 <b>Hebat_Submitter Test</b>: Koneksi bot Telegram berhasil terhubung!'
        );
        return jsonResponse(res);
      }

      return jsonResponse({ ok: false, error: 'NOT_FOUND' }, 404);
    }

    // Serve UI static assets (index.html, style.css, app.js)
    if (env.ASSETS) {
      return env.ASSETS.fetch(req);
    }

    return new Response(
      `<!DOCTYPE html><html><head><title>Hebat Submitter</title></head><body><h1>Hebat Submitter Active</h1><p>UI assets not found.</p></body></html>`,
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
