/**
 * scripts/deploy_secrets.mjs
 * Securely uploads secrets from .dev.vars to Cloudflare Worker via wrangler secret put.
 * Never prints secret values to stdout/logs.
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

const devVarsPath = path.join(rootDir, '.dev.vars');
if (!fs.existsSync(devVarsPath)) {
  console.error('[FAIL] File .dev.vars tidak ditemukan di root!');
  process.exit(1);
}

const vars = {};
const lines = fs.readFileSync(devVarsPath, 'utf8').split(/\r?\n/);
for (const line of lines) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith('#')) continue;
  const idx = trimmed.indexOf('=');
  if (idx > 0) {
    const k = trimmed.slice(0, idx).trim();
    const v = trimmed.slice(idx + 1).trim();
    vars[k] = v;
  }
}

// Generate secure random HMAC key if not set
if (!vars.SESSION_HMAC_KEY) {
  vars.SESSION_HMAC_KEY = crypto.randomBytes(32).toString('hex');
  fs.appendFileSync(devVarsPath, `\nSESSION_HMAC_KEY=${vars.SESSION_HMAC_KEY}\n`);
  console.log('[INFO] SESSION_HMAC_KEY acak dibuat dan disimpan ke .dev.vars');
}

// Default APP_PASSWORD if not set
if (!vars.APP_PASSWORD) {
  vars.APP_PASSWORD = 'admin';
  fs.appendFileSync(devVarsPath, `\nAPP_PASSWORD=admin\n`);
  console.log('[INFO] APP_PASSWORD default diset ke "admin" di .dev.vars (silakan ganti kapan saja)');
}

const secretsToUpload = [
  'MOODLE_USER',
  'MOODLE_PASS',
  'APP_PASSWORD',
  'SESSION_HMAC_KEY',
  'TELEGRAM_BOT_TOKEN',
  'TELEGRAM_CHAT_ID',
];

function uploadSecret(name, value) {
  return new Promise((resolve, reject) => {
    console.log(`[UPLOADING] Menyetel secret: ${name} ...`);
    const proc = spawn('npx', ['wrangler', 'secret', 'put', name], {
      cwd: rootDir,
      shell: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    proc.stdin.write(value);
    proc.stdin.end();

    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', (d) => { stdout += d.toString(); });
    proc.stderr.on('data', (d) => { stderr += d.toString(); });

    proc.on('close', (code) => {
      if (code === 0) {
        console.log(`[PASS] Secret ${name} berhasil diunggah.`);
        resolve();
      } else {
        console.error(`[FAIL] Gagal menyetel secret ${name} (exit code ${code}): ${stderr || stdout}`);
        reject(new Error(`Failed to upload ${name}`));
      }
    });
  });
}

async function main() {
  console.log('='.repeat(60));
  console.log('  UPLOADING SECRETS KE CLOUDFLARE WORKER');
  console.log('='.repeat(60));

  for (const name of secretsToUpload) {
    const val = vars[name];
    if (val && !val.includes('isi_') && val.trim() !== '') {
      await uploadSecret(name, val.trim());
    } else {
      console.log(`[SKIP] Secret ${name} dilewati (tidak ada di .dev.vars).`);
    }
  }

  console.log('='.repeat(60));
  console.log('Semua secret yang tersedia telah berhasil diunggah secara aman!');
  console.log('='.repeat(60));
}

main().catch((err) => {
  console.error('[FATAL]', err.message);
  process.exit(1);
});
