/**
 * scripts/test_live_submit.mjs
 * Explicit live submission test script on confirmed assignment cmid.
 * Performs actual mutation (POST savesubmission) and verifies status.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

// Load environment variables from .dev.vars
const devVarsPath = path.join(rootDir, '.dev.vars');
if (fs.existsSync(devVarsPath)) {
  const content = fs.readFileSync(devVarsPath, 'utf8');
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const idx = trimmed.indexOf('=');
    if (idx > 0) {
      const k = trimmed.slice(0, idx).trim();
      const v = trimmed.slice(idx + 1).trim();
      if (!process.env[k]) {
        process.env[k] = v;
      }
    }
  }
}

const MOODLE_BASE = process.env.MOODLE_BASE || 'https://hebat.elearning.unair.ac.id';
const MOODLE_USER = process.env.MOODLE_USER;
const MOODLE_PASS = process.env.MOODLE_PASS;
const TARGET_CMID = process.env.LIVE_CMID || '167430';
const TARGET_NAME = process.env.LIVE_NAME || 'Tugas 2 - BPR - Kelompok';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';

class CookieJar {
  constructor() { this.map = new Map(); }
  ingest(res) {
    const raw = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
    for (const sc of raw) {
      const [pair] = sc.split(';');
      const i = pair.indexOf('=');
      if (i > 0) {
        const k = pair.slice(0, i).trim(), v = pair.slice(i + 1).trim();
        if (/max-age=0|expires=[^;]*1970/i.test(sc) || v === '') this.map.delete(k);
        else this.map.set(k, v);
      }
    }
  }
  header() { return [...this.map].map(([k, v]) => `${k}=${v}`).join('; '); }
}

async function mfetch(jar, url, init = {}, maxHops = 6) {
  let targetUrl = url;
  let method = init.method || 'GET';
  let body = init.body;
  const headers = { 'user-agent': UA, 'accept-language': 'en-US,en;q=0.9,id;q=0.8', ...(init.headers || {}) };

  for (let hop = 0; hop <= maxHops; hop++) {
    const reqHeaders = { ...headers };
    const cookieHeader = jar.header();
    if (cookieHeader) reqHeaders['cookie'] = cookieHeader;

    const res = await fetch(targetUrl, { method, body, redirect: 'manual', headers: reqHeaders });
    jar.ingest(res);

    const loc = res.headers.get('location');
    if (res.status >= 300 && res.status < 400 && loc) {
      targetUrl = new URL(loc, targetUrl).toString();
      method = 'GET';
      body = undefined;
      delete headers['content-type'];
      delete headers['Content-Type'];
      continue;
    }
    return { res, url: targetUrl, hops: hop };
  }
  throw new Error(`Too many redirects (hops exceeded ${maxHops})`);
}

async function main() {
  console.log('='.repeat(65));
  console.log('  LIVE SUBMISSION TEST: AKSI MUTASI NYATA');
  console.log('='.repeat(65));
  console.log(`Target Assignment : ${TARGET_NAME}`);
  console.log(`Target CMID       : ${TARGET_CMID}`);
  console.log(`Moodle Base       : ${MOODLE_BASE}`);
  console.log('-'.repeat(65));

  if (!MOODLE_USER || !MOODLE_PASS) {
    console.error('[FAIL] Kredensial tidak ditemukan di .dev.vars!');
    process.exit(1);
  }

  const jar = new CookieJar();

  // 1. Login
  console.log('[1/5] Melakukan login HTTP...');
  const loginPage = await mfetch(jar, `${MOODLE_BASE}/login/index.php`);
  const loginHtml = await loginPage.res.text();
  const tokenMatch = loginHtml.match(/<input[^>]+name=["']logintoken["'][^>]*value=["']([a-zA-Z0-9]+)["']/i);
  const logintoken = tokenMatch ? tokenMatch[1] : '';

  const params = new URLSearchParams();
  params.set('username', MOODLE_USER);
  params.set('password', MOODLE_PASS);
  if (logintoken) params.set('logintoken', logintoken);
  params.set('anchor', '');

  await mfetch(jar, `${MOODLE_BASE}/login/index.php`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: params.toString(),
  });

  const myPage = await mfetch(jar, `${MOODLE_BASE}/my/`);
  const myHtml = await myPage.res.text();
  const sessMatch = myHtml.match(/["']?sesskey["']?\s*:\s*["']([a-zA-Z0-9]+)["']/i);
  const sesskey = sessMatch ? sessMatch[1] : null;

  if (!sesskey) {
    console.error('[FAIL] Gagal mendapatkan sesskey setelah login!');
    process.exit(1);
  }
  console.log('[PASS] Login sukses! Cookie sesi dan sesskey terpasang.');

  // 2. Upload file draft PDF
  console.log('[2/5] Mengunggah file PDF ke draft area...');
  const draftItemId = Math.floor(100000000 + Math.random() * 900000000);
  const fileName = 'tugas_test_autosubmit.pdf';
  const dummyPdf = Buffer.from('%PDF-1.4\n1 0 obj\n<< /Title (Uji Coba AutoSubmit) >>\nendobj\ntrailer\n<<>>\n%%EOF');
  const dummyBlob = new Blob([dummyPdf], { type: 'application/pdf' });

  const uploadForm = new FormData();
  uploadForm.append('repo_upload_file', dummyBlob, fileName);
  uploadForm.append('sesskey', sesskey);
  uploadForm.append('repo_id', '5');
  uploadForm.append('itemid', String(draftItemId));
  uploadForm.append('author', 'Mahasiswa');
  uploadForm.append('title', fileName);
  uploadForm.append('savepath', '/');
  uploadForm.append('ctx_id', '1');
  uploadForm.append('client_id', Math.random().toString(36).substring(2, 10));
  uploadForm.append('maxbytes', '104857600');
  uploadForm.append('areamaxbytes', '-1');
  uploadForm.append('env', 'filemanager');
  uploadForm.append('license', 'unknown');

  const uploadRes = await mfetch(jar, `${MOODLE_BASE}/repository/repository_ajax.php?action=upload`, {
    method: 'POST',
    body: uploadForm,
  });
  const uploadJson = await uploadRes.res.json();

  if (uploadJson.error) {
    console.error(`[FAIL] Upload draft gagal: ${JSON.stringify(uploadJson)}`);
    process.exit(1);
  }
  console.log(`[PASS] File PDF terunggah ke draft area (itemid: ${draftItemId}).`);

  // 3. Buka form editsubmission
  console.log(`[3/5] Mengambil form submission untuk cmid ${TARGET_CMID}...`);
  const formPage = await mfetch(jar, `${MOODLE_BASE}/mod/assign/view.php?id=${TARGET_CMID}&action=editsubmission`);
  const formHtml = await formPage.res.text();

  const hiddenInputs = {};
  const inputRegex = /<input[^>]+type=["']hidden["'][^>]*>/gi;
  let m;
  while ((m = inputRegex.exec(formHtml)) !== null) {
    const tag = m[0];
    const nameMatch = tag.match(/name=["']([^"']+)["']/i);
    const valMatch = tag.match(/value=["']([^"']*)["']/i);
    if (nameMatch) {
      hiddenInputs[nameMatch[1]] = valMatch ? valMatch[1] : '';
    }
  }

  if (!hiddenInputs.lastmodified || !hiddenInputs.id || !hiddenInputs.sesskey) {
    console.error(`[FAIL] Field form tidak lengkap! Ditemukan: ${Object.keys(hiddenInputs).join(', ')}`);
    process.exit(1);
  }
  console.log(`[PASS] Form submission siap! lastmodified=${hiddenInputs.lastmodified}, id=${hiddenInputs.id}`);

  // 4. POST savesubmission (Mutasi Nyata)
  console.log('[4/5] Mengirim request POST savesubmission (MUTASI NYATA)...');
  const submitBody = new URLSearchParams();
  for (const [k, v] of Object.entries(hiddenInputs)) {
    submitBody.set(k, v);
  }
  submitBody.set('files_filemanager', String(draftItemId));
  submitBody.set('submitbutton', 'Save changes');

  const t0 = performance.now();
  const postRes = await mfetch(jar, `${MOODLE_BASE}/mod/assign/view.php`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: submitBody.toString(),
  });
  const tSubmitMs = Math.round(performance.now() - t0);
  console.log(`[PASS] POST savesubmission terkirim! Waktu respons server: ${tSubmitMs} ms.`);

  // 5. Verifikasi di halaman assignment view
  console.log('[5/5] Memverifikasi status pengumpulan di Moodle...');
  const viewRes = await mfetch(jar, `${MOODLE_BASE}/mod/assign/view.php?id=${TARGET_CMID}`);
  const viewHtml = await viewRes.res.text();

  const isSubmitted = viewHtml.includes('Submitted for grading') ||
                      viewHtml.includes('Sudah dikumpulkan untuk dinilai') ||
                      viewHtml.includes('submissionstatussubmitted');

  const hasFileName = viewHtml.includes(fileName);

  console.log('='.repeat(65));
  if (isSubmitted) {
    console.log(`🎉 [SUCCESS] SUBMIT LIVE BERHASIL DI MOODLE!`);
    console.log(`Status        : Submitted for grading`);
    console.log(`Nama File     : ${fileName} ${hasFileName ? '(Terverifikasi tampil di Moodle)' : ''}`);
    console.log(`Durasi Submit : ${tSubmitMs} ms`);
    console.log(`Silakan refresh browser Anda di halaman tugas tersebut untuk melihat hasilnya!`);
  } else {
    console.log(`⚠️ Status belum berlabel "Submitted for grading". URL: ${viewRes.url}`);
    if (viewHtml.includes('Draft (not submitted)')) {
      console.log(`Catatan: Status saat ini adalah "Draft (not submitted)". Perlu konfirmasi Submit assignment.`);
    }
  }
  console.log('='.repeat(65));
}

main().catch(err => {
  console.error('[FATAL]', err);
  process.exit(1);
});
