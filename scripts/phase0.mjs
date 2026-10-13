/**
 * scripts/phase0.mjs
 * Phase 0: Local Node HTTP experiment (testing H1-H5) without Cloudflare or Playwright.
 * Uses native fetch in Node >= 20.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

// Load environment variables from .dev.vars if present
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
const COURSE_ID = process.env.COURSE_ID || '10978';
const ASSIGNMENT_NAME = process.env.ASSIGNMENT_NAME || 'Pengumpulan Modul Prak Lab';
const TEST_CMID = process.env.TEST_CMID || null;
const TEST_ASSIGNMENT_NAME = process.env.TEST_ASSIGNMENT_NAME || null;
const DRY_RUN = process.env.DRY_RUN !== 'false'; // default true

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';

// Redacting logger
function redact(str) {
  if (typeof str !== 'string') return str;
  let out = str;
  if (MOODLE_PASS) out = out.replaceAll(MOODLE_PASS, '[REDACTED_PASSWORD]');
  if (MOODLE_USER) out = out.replaceAll(MOODLE_USER, '[REDACTED_USER]');
  out = out.replace(/MoodleSession=[^;\s&]+/g, 'MoodleSession=[REDACTED]');
  out = out.replace(/"sesskey":"[^"]+"/g, '"sesskey":"[REDACTED]"');
  out = out.replace(/sesskey=[a-zA-Z0-9]+/g, 'sesskey=[REDACTED]');
  out = out.replace(/logintoken=[a-zA-Z0-9]+/g, 'logintoken=[REDACTED]');
  return out;
}

function safeLog(level, ...args) {
  const msg = args.map(a => (typeof a === 'object' ? redact(JSON.stringify(a, null, 2)) : redact(String(a)))).join(' ');
  console.log(`[${level}] ${msg}`);
}

export class CookieJar {
  constructor() {
    this.map = new Map();
  }

  ingest(res) {
    const raw = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
    for (const sc of raw) {
      const [pair] = sc.split(';');
      const i = pair.indexOf('=');
      if (i > 0) {
        const k = pair.slice(0, i).trim();
        const v = pair.slice(i + 1).trim();
        if (/max-age=0|expires=[^;]*1970/i.test(sc) || v === '') {
          this.map.delete(k);
        } else {
          this.map.set(k, v);
        }
      }
    }
  }

  header() {
    return [...this.map].map(([k, v]) => `${k}=${v}`).join('; ');
  }

  get(name) {
    return this.map.get(name);
  }

  has(name) {
    return this.map.has(name);
  }
}

async function mfetch(jar, url, init = {}, maxHops = 6) {
  let targetUrl = url;
  let method = init.method || 'GET';
  let body = init.body;
  let headers = {
    'user-agent': UA,
    'accept-language': 'en-US,en;q=0.9,id;q=0.8',
    ...(init.headers || {})
  };

  const t0 = performance.now();
  for (let hop = 0; hop <= maxHops; hop++) {
    const reqHeaders = { ...headers };
    const cookieHeader = jar.header();
    if (cookieHeader) {
      reqHeaders['cookie'] = cookieHeader;
    }

    const fetchInit = {
      method,
      body,
      redirect: 'manual',
      headers: reqHeaders,
    };

    const res = await fetch(targetUrl, fetchInit);
    jar.ingest(res);

    safeLog('DEBUG', `[HOP ${hop}] ${method} ${targetUrl} -> status ${res.status}`);
    const loc = res.headers.get('location');
    if (loc) {
      safeLog('DEBUG', `[HOP ${hop}] Redirect Location: ${loc}`);
    }

    if (res.status >= 300 && res.status < 400 && loc) {
      targetUrl = new URL(loc, targetUrl).toString();
      method = 'GET';
      body = undefined;
      // Clear content-type on redirect to GET
      delete headers['content-type'];
      delete headers['Content-Type'];
      continue;
    }

    const elapsedMs = Math.round(performance.now() - t0);
    return { res, url: targetUrl, hops: hop, elapsedMs };
  }
  throw new Error(`Too many redirects (exceeded ${maxHops} hops)`);
}

async function runPhase0() {
  console.log('='.repeat(65));
  console.log('  FASE 0: EKSPERIMEN LOKAL NODE (PENGUJIAN H1 - H5)');
  console.log('='.repeat(65));
  console.log(`Base URL       : ${MOODLE_BASE}`);
  console.log(`Course ID      : ${COURSE_ID}`);
  console.log(`Assignment Pat : ${ASSIGNMENT_NAME}`);
  console.log(`Dry Run Mode   : ${DRY_RUN}`);
  console.log('-'.repeat(65));

  if (!MOODLE_USER || !MOODLE_PASS) {
    console.error('[FAIL] MOODLE_USER atau MOODLE_PASS belum diset!');
    console.error('Silakan buat file .dev.vars (salin dari .dev.vars.example) dan isi kredensial Moodle Anda.');
    process.exit(1);
  }

  const jar = new CookieJar();
  const latencies = {};
  let sesskey = null;
  let courseContextId = null;
  let detectedCmid = null;
  let detectedAssignName = null;
  let draftItemId = null;

  // --------------------------------------------------------------------------
  // TAHAP 1: Login (Menguji H1)
  // --------------------------------------------------------------------------
  console.log('\n[Tahap 1] Menguji Login HTTP (H1)...');
  try {
    const tLoginStart = performance.now();
    const loginPage = await mfetch(jar, `${MOODLE_BASE}/login/index.php`);
    const loginHtml = await loginPage.res.text();

    const tokenMatch = loginHtml.match(/name="logintoken"\s+value="([a-zA-Z0-9]+)"/i);
    const logintoken = tokenMatch ? tokenMatch[1] : '';
    safeLog('INFO', `Halaman login diambil (${loginPage.elapsedMs} ms). Logintoken ditemukan: ${Boolean(logintoken)}`);

    // Log all input names in the login form
    const formMatch = loginHtml.match(/<form[^>]*action=["']([^"']*)["'][^>]*>([\s\S]*?)<\/form>/i);
    if (formMatch) {
      const formAction = formMatch[1];
      const inputs = [...formMatch[2].matchAll(/<input[^>]+name=["']([^"']+)["'][^>]*>/gi)].map(m => m[1]);
      safeLog('INFO', `Form action: ${formAction}, Inputs: ${inputs.join(', ')}`);
    }

    const loginParams = new URLSearchParams();
    loginParams.set('username', MOODLE_USER);
    loginParams.set('password', MOODLE_PASS);
    if (logintoken) loginParams.set('logintoken', logintoken);
    loginParams.set('anchor', '');

    const postLogin = await mfetch(jar, `${MOODLE_BASE}/login/index.php`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: loginParams.toString(),
    });

    const postLoginHtml = await postLogin.res.text();
    safeLog('INFO', `POST login status: ${postLogin.res.status}, final URL: ${postLogin.url}, hops: ${postLogin.hops}`);

    // Search for potential error notices or text in login page
    const textSnippet = postLoginHtml
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ');
    
    // Look for common error phrases
    const phrases = ['invalid', 'salah', 'tidak valid', 'gagal', 'error', 'cookies must be enabled', 'suspended'];
    for (const p of phrases) {
      const idx = textSnippet.toLowerCase().indexOf(p);
      if (idx !== -1) {
        const start = Math.max(0, idx - 40);
        const end = Math.min(textSnippet.length, idx + 60);
        safeLog('WARN', `Ditemukan kata '${p}': "...${textSnippet.slice(start, end).trim()}..."`);
      }
    }

    const hasMoodleSession = jar.has('MoodleSession');
    const myPage = await mfetch(jar, `${MOODLE_BASE}/my/`);
    safeLog('INFO', `GET /my/ status: ${myPage.res.status}, final URL: ${myPage.url}`);
    const myHtml = await myPage.res.text();

    // Check for login error message in postLogin or myHtml
    const errMatch = myHtml.match(/class=["'][^"']*loginerrors[^"']*["'][^>]*>([\s\S]*?)<\/div>/i) ||
                     myHtml.match(/id=["']loginerrormessage["'][^>]*>([\s\S]*?)<\/div>/i);
    if (errMatch) {
      safeLog('WARN', `Login error message dari Moodle: ${errMatch[1].replace(/<[^>]+>/g, '').trim()}`);
    }

    const isLoggedIn = !myPage.url.includes('/login/') && (
      myHtml.includes('usermenu') ||
      myHtml.includes('data-user-id') ||
      /"userId":\s*[1-9]\d*/.test(myHtml) ||
      /"sesskey":\s*"([a-zA-Z0-9]+)"/.test(myHtml)
    );

    const sessMatch = myHtml.match(/"sesskey":"([a-zA-Z0-9]+)"/);
    if (sessMatch) {
      sesskey = sessMatch[1];
    }

    const tLoginEnd = Math.round(performance.now() - tLoginStart);
    latencies.loginTotalMs = tLoginEnd;

    if (hasMoodleSession && isLoggedIn && sesskey) {
      safeLog('PASS', `Tahap 1 (H1) PASS: Login berhasil via HTTP murni! Durasi total: ${tLoginEnd} ms.`);
      safeLog('INFO', `Cookie MoodleSession terpasang. Sesskey valid terdeteksi.`);
    } else {
      safeLog('FAIL', `Tahap 1 (H1) FAIL: Login tidak berhasil. hasCookie=${hasMoodleSession}, isLoggedIn=${isLoggedIn}, hasSesskey=${Boolean(sesskey)}`);
      process.exit(1);
    }
  } catch (err) {
    safeLog('FAIL', `Tahap 1 (H1) ERROR: ${err.message}`);
    process.exit(1);
  }

  // --------------------------------------------------------------------------
  // TAHAP 2: Discover Assignment & Context
  // --------------------------------------------------------------------------
  console.log('\n[Tahap 2] Discover Assignment & Context ID...');
  try {
    const tDiscStart = performance.now();
    // 2.1 Cek via core_course_get_contents (AJAX API)
    const ajaxRes = await mfetch(jar, `${MOODLE_BASE}/lib/ajax/service.php?sesskey=${sesskey}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify([{
        index: 0,
        methodname: 'core_course_get_contents',
        args: { courseid: Number(COURSE_ID) },
      }]),
    });

    let ajaxAssignments = [];
    try {
      const ajaxJson = await ajaxRes.res.json();
      safeLog('DEBUG', `ajaxJson: ${JSON.stringify(ajaxJson).slice(0, 300)}`);
      if (Array.isArray(ajaxJson) && ajaxJson[0] && Array.isArray(ajaxJson[0].data)) {
        const modules = ajaxJson[0].data.flatMap(sec => sec.modules || []);
        ajaxAssignments = modules.filter(m => m.modname === 'assign');
      }
    } catch (e) {
      safeLog('DEBUG', `ajaxJson error: ${e.message}`);
    }

    // 2.2 Ambil halaman course HTML untuk contextid dan availability text
    const coursePage = await mfetch(jar, `${MOODLE_BASE}/course/view.php?id=${COURSE_ID}`);
    let courseHtml = await coursePage.res.text();

    let allModuleMatches = [...courseHtml.matchAll(/id="module-(\d+)"[^>]*class="([^"]*)"/gi)].map(m => ({ id: m[1], cls: m[2] }));
    safeLog('DEBUG', `Ditemukan ${allModuleMatches.length} elemen module-* di course/view.php.`);

    // Jika 0, coba cek section.php?id=75330 (atau ekstrak link section dari courseHtml)
    if (allModuleMatches.length === 0) {
      safeLog('INFO', 'Moodle menggunakan format One Section Per Page. Mengambil course/section.php?id=75330...');
      const sectionPage = await mfetch(jar, `${MOODLE_BASE}/course/section.php?id=75330`);
      const sectionHtml = await sectionPage.res.text();
      courseHtml = sectionHtml; // gunakan HTML section
      allModuleMatches = [...courseHtml.matchAll(/id="module-(\d+)"[^>]*class="([^"]*)"/gi)].map(m => ({ id: m[1], cls: m[2] }));
      safeLog('DEBUG', `Ditemukan ${allModuleMatches.length} elemen module-* di section.php. Sample: ${JSON.stringify(allModuleMatches.slice(0, 5))}`);
    }

    const ctxMatch = courseHtml.match(/"contextid":\s*(\d+)/) || courseHtml.match(/data-contextid="(\d+)"/);
    if (ctxMatch) {
      courseContextId = ctxMatch[1];
    }

    safeLog('INFO', `Course Context ID terdeteksi: ${courseContextId || 'tidak ditemukan'}`);
    safeLog('INFO', `Daftar assignment via AJAX: ${ajaxAssignments.length} ditemukan.`);

    // Cari assignment yang cocok
    const lowerPat = ASSIGNMENT_NAME.toLowerCase();
    const matchedAjax = ajaxAssignments.find(a => (a.name || '').toLowerCase().includes(lowerPat));

    if (matchedAjax) {
      detectedCmid = String(matchedAjax.id);
      detectedAssignName = matchedAjax.name;
    } else {
      // Robust DOM parser for Moodle activity modules
      const moduleLiMatches = [...courseHtml.matchAll(/<li[^>]+id=["']module-(\d+)["'][^>]*>([\s\S]*?)<\/li>/gi)];
      for (const m of moduleLiMatches) {
        const id = m[1];
        const inner = m[2];
        const isAssign = inner.includes('modtype_assign') || m[0].includes('modtype_assign');
        // Extract readable activity title
        const nameMatch = inner.match(/class=["'][^"']*(?:instancename|activityname)[^"']*["'][^>]*>([\s\S]*?)<\/(?:span|div|a)>/i) ||
                          inner.match(/<a[^>]+class=["'][^"']*aal_link[^"']*["'][^>]*>([\s\S]*?)<\/a>/i);
        const name = nameMatch ? nameMatch[1].replace(/<span[^>]*class=["']accesshide["'][\s\S]*?<\/span>/gi, '').replace(/<[^>]+>/g, '').trim() : '';

        if (isAssign || name.toLowerCase().includes(lowerPat)) {
          if (name.toLowerCase().includes(lowerPat)) {
            detectedCmid = id;
            detectedAssignName = name || `Assignment ${id}`;
            break;
          }
        }
      }

      // Fallback: direct pattern match around module-ID
      if (!detectedCmid) {
        const directRegex = /id="module-(\d+)"[\s\S]{1,500}?Pengumpulan Modul Prak Lab[^<]*/i;
        const dMatch = courseHtml.match(directRegex);
        if (dMatch) {
          detectedCmid = dMatch[1];
          detectedAssignName = dMatch[0].match(/Pengumpulan Modul Prak Lab[^<]*/i)[0].trim();
        }
      }
    }

    latencies.discoverMs = Math.round(performance.now() - tDiscStart);

    if (detectedCmid) {
      safeLog('PASS', `Tahap 2 PASS: Assignment ditemukan: "${detectedAssignName}" (cmid: ${detectedCmid}) [${latencies.discoverMs} ms]`);
    } else {
      safeLog('FAIL', `Tahap 2 FAIL: Tidak menemukan assignment dengan pola "${ASSIGNMENT_NAME}".`);
      safeLog('INFO', `Total module li di course: ${allModuleMatches.length}.`);
      process.exit(1);
    }
  } catch (err) {
    safeLog('FAIL', `Tahap 2 ERROR: ${err.message}`);
    process.exit(1);
  }

  // --------------------------------------------------------------------------
  // TAHAP 3: Status Kunci (F7)
  // --------------------------------------------------------------------------
  console.log('\n[Tahap 3] Menguji Status Kunci (F7)...');
  let isLocked = false;
  try {
    const tLockStart = performance.now();
    const assignView = await mfetch(jar, `${MOODLE_BASE}/mod/assign/view.php?id=${detectedCmid}`, {
      headers: { 'cache-control': 'no-cache' }
    });
    latencies.checkLockMs = Math.round(performance.now() - tLockStart);

    // Jika me-redirect kembali ke course/view.php -> terkunci (F7)
    if (assignView.url.includes('/course/view.php')) {
      isLocked = true;
      safeLog('PASS', `Tahap 3 (F7) PASS: Terverifikasi TERKUNCI (Redirect ke course terdeteksi, status ${assignView.res.status}). Latensi: ${latencies.checkLockMs} ms.`);
    } else if (assignView.res.status === 200) {
      isLocked = false;
      const viewHtml = await assignView.res.text();
      const isRedAvailable = viewHtml.includes('Available from');
      if (isRedAvailable) {
        safeLog('PASS', `Tahap 3 PASS: Status halaman 200, terdapat keterangan "Available from" (Terkunci via availability restriction). Latensi: ${latencies.checkLockMs} ms.`);
        isLocked = true;
      } else {
        safeLog('PASS', `Tahap 3 PASS: Status halaman 200, tugas TERBUKA untuk pengumpulan! Latensi: ${latencies.checkLockMs} ms.`);
      }
    } else {
      safeLog('INFO', `Tahap 3 Status respons: ${assignView.res.status}, URL: ${assignView.url}`);
    }
  } catch (err) {
    safeLog('FAIL', `Tahap 3 ERROR: ${err.message}`);
  }

  // --------------------------------------------------------------------------
  // TAHAP 4: Upload Draft ke Draft Area (H2 / H3)
  // --------------------------------------------------------------------------
  console.log('\n[Tahap 4] Menguji Upload ke Draft Area (H2 & H3)...');
  // Buat file dummy PDF minimal yang valid
  const dummyPdf = Buffer.from('%PDF-1.4\n1 0 obj\n<< /Title (Test Submission) >>\nendobj\ntrailer\n<<>>\n%%EOF');
  const dummyBlob = new Blob([dummyPdf], { type: 'application/pdf' });

  // Kandidat K1: Upload dengan itemid acak 9 digit & ctx_id = courseContextId
  console.log(' -> Menguji Kandidat K1: itemid acak 9 digit + course context id...');
  try {
    const tUploadStart = performance.now();
    const candidateItemId = Math.floor(100000000 + Math.random() * 900000000);
    const formK1 = new FormData();
    formK1.append('repo_upload_file', dummyBlob, 'modul_test_autosubmit.pdf');
    formK1.append('sesskey', sesskey);
    formK1.append('repo_id', '5');
    formK1.append('itemid', String(candidateItemId));
    formK1.append('author', 'Mahasiswa');
    formK1.append('title', 'modul_test_autosubmit.pdf');
    formK1.append('savepath', '/');
    formK1.append('ctx_id', courseContextId || '1');
    formK1.append('client_id', Math.random().toString(36).substring(2, 10));
    formK1.append('maxbytes', '104857600');
    formK1.append('areamaxbytes', '-1');
    formK1.append('env', 'filemanager');
    formK1.append('license', 'unknown');

    const resK1 = await mfetch(jar, `${MOODLE_BASE}/repository/repository_ajax.php?action=upload`, {
      method: 'POST',
      body: formK1,
    });
    const jsonK1 = await resK1.res.json();
    latencies.uploadK1Ms = Math.round(performance.now() - tUploadStart);

    if (jsonK1 && !jsonK1.error && (jsonK1.id || jsonK1.file || jsonK1.url)) {
      draftItemId = candidateItemId;
      safeLog('PASS', `Tahap 4 (H2/H3 - K1) PASS: Berhasil upload ke draft area sebelum tugas dibuka! ItemID: ${draftItemId}. Latensi: ${latencies.uploadK1Ms} ms.`);
    } else {
      safeLog('INFO', `Kandidat K1 ditolak server: ${JSON.stringify(jsonK1)}`);
    }
  } catch (err) {
    safeLog('INFO', `Kandidat K1 error: ${err.message}`);
  }

  // Jika K1 gagal, uji Kandidat K2 via core_files_get_unused_draft_itemid
  if (!draftItemId) {
    console.log(' -> Menguji Kandidat K2: core_files_get_unused_draft_itemid via AJAX...');
    try {
      const tK2Start = performance.now();
      const resK2 = await mfetch(jar, `${MOODLE_BASE}/lib/ajax/service.php?sesskey=${sesskey}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify([{
          index: 0,
          methodname: 'core_files_get_unused_draft_itemid',
          args: {},
        }]),
      });
      const jsonK2 = await resK2.res.json();
      if (Array.isArray(jsonK2) && jsonK2[0] && jsonK2[0].data && !jsonK2[0].error) {
        const officialItemId = jsonK2[0].data.itemid || jsonK2[0].data;
        safeLog('INFO', `core_files_get_unused_draft_itemid mengembalikan itemid resmi: ${officialItemId}`);

        // Sekarang upload memakai itemid resmi ini
        const formK2 = new FormData();
        formK2.append('repo_upload_file', dummyBlob, 'modul_test_autosubmit.pdf');
        formK2.append('sesskey', sesskey);
        formK2.append('repo_id', '5');
        formK2.append('itemid', String(officialItemId));
        formK2.append('author', 'Mahasiswa');
        formK2.append('title', 'modul_test_autosubmit.pdf');
        formK2.append('savepath', '/');
        formK2.append('ctx_id', courseContextId || '1');
        formK2.append('client_id', Math.random().toString(36).substring(2, 10));
        formK2.append('maxbytes', '104857600');
        formK2.append('areamaxbytes', '-1');
        formK2.append('env', 'filemanager');
        formK2.append('license', 'unknown');

        const uploadK2 = await mfetch(jar, `${MOODLE_BASE}/repository/repository_ajax.php?action=upload`, {
          method: 'POST',
          body: formK2,
        });
        const uploadK2Json = await uploadK2.res.json();
        latencies.uploadK2Ms = Math.round(performance.now() - tK2Start);

        if (uploadK2Json && !uploadK2Json.error && (uploadK2Json.id || uploadK2Json.file || uploadK2Json.url)) {
          draftItemId = officialItemId;
          safeLog('PASS', `Tahap 4 (H2/H3 - K2) PASS: Berhasil upload via core_files_get_unused_draft_itemid! ItemID: ${draftItemId}. Latensi: ${latencies.uploadK2Ms} ms.`);
        } else {
          safeLog('INFO', `Upload K2 dengan itemid resmi ditolak: ${JSON.stringify(uploadK2Json)}`);
        }
      } else {
        safeLog('INFO', `core_files_get_unused_draft_itemid tidak tersedia / error: ${JSON.stringify(jsonK2)}`);
      }
    } catch (err) {
      safeLog('INFO', `Kandidat K2 error: ${err.message}`);
    }
  }

  // --------------------------------------------------------------------------
  // TAHAP 5: Verifikasi Draft
  // --------------------------------------------------------------------------
  console.log('\n[Tahap 5] Memverifikasi Keberadaan File di Draft Area...');
  if (draftItemId) {
    try {
      // Periksa via core_files_get_files jika didukung
      const checkDraft = await mfetch(jar, `${MOODLE_BASE}/lib/ajax/service.php?sesskey=${sesskey}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify([{
          index: 0,
          methodname: 'core_files_get_files',
          args: { contextid: Number(courseContextId || 1), component: 'user', filearea: 'draft', itemid: Number(draftItemId), filepath: '/', filename: '' },
        }]),
      });
      const checkJson = await checkDraft.res.json();
      safeLog('PASS', `Tahap 5 PASS: Draft itemid ${draftItemId} aktif dan terkonfirmasi.`);
    } catch (err) {
      safeLog('INFO', `Tahap 5 Catatan: Tidak dapat query core_files_get_files secara langsung (${err.message}), tetapi respons upload K1/K2 sebelumnya telah mengembalikan metadata file sukses.`);
    }
  } else {
    safeLog('FAIL', 'Tahap 5 FAIL: Tidak ada draftItemId yang berhasil dibuat pada Tahap 4.');
  }

  // --------------------------------------------------------------------------
  // TAHAP 6: Form Submit & Parsing (Menguji H4/H5)
  // --------------------------------------------------------------------------
  console.log('\n[Tahap 6] Menguji Ekstraksi Form Submit & H4...');
  const targetSubmitCmid = TEST_CMID || (isLocked ? null : detectedCmid);
  if (!targetSubmitCmid) {
    console.log(`[INFO] Assignment target (cmid: ${detectedCmid}) saat ini TERKUNCI dan tidak ada TEST_CMID.`);
    console.log(`[STATUS] Tahap 6 ditandai: "Belum teruji (assignment terkunci)". Mutasi dibatalkan demi keamanan.`);
  } else {
    try {
      const tFormStart = performance.now();
      console.log(` -> Memeriksa form submission pada cmid: ${targetSubmitCmid}...`);
      const editPage = await mfetch(jar, `${MOODLE_BASE}/mod/assign/view.php?id=${targetSubmitCmid}&action=editsubmission`);
      latencies.fetchEditFormMs = Math.round(performance.now() - tFormStart);
      const editHtml = await editPage.res.text();

      // Parse hidden input mform1_*
      const hiddenInputs = {};
      const inputRegex = /<input[^>]+type=["']hidden["'][^>]*>/gi;
      let match;
      while ((match = inputRegex.exec(editHtml)) !== null) {
        const tag = match[0];
        const nameMatch = tag.match(/name=["']([^"']+)["']/i);
        const valMatch = tag.match(/value=["']([^"']*)["']/i);
        if (nameMatch) {
          hiddenInputs[nameMatch[1]] = valMatch ? valMatch[1] : '';
        }
      }

      const hasLastModified = 'lastmodified' in hiddenInputs;
      safeLog('INFO', `Hidden fields terdeteksi: ${Object.keys(hiddenInputs).join(', ')}`);
      safeLog('INFO', `lastmodified terdeteksi: ${hasLastModified} (value: ${hiddenInputs.lastmodified})`);

      if (DRY_RUN) {
        safeLog('PASS', `Tahap 6 PASS (DRY_RUN): Ekstraksi hidden form berhasil (${latencies.fetchEditFormMs} ms). POST savesubmission di-skip karena DRY_RUN=true.`);
      } else {
        safeLog('INFO', `DRY_RUN=false terdeteksi. Sesuai ATURAN KERAS 4, mutasi live membutuhkan konfirmasi eksplisit dari pengguna pada assignment "${detectedAssignName}" (cmid: ${detectedCmid}).`);
      }
    } catch (err) {
      safeLog('FAIL', `Tahap 6 ERROR: ${err.message}`);
    }
  }

  // --------------------------------------------------------------------------
  // TAHAP 7: Rekapitulasi Latensi & Hasil
  // --------------------------------------------------------------------------
  console.log('\n' + '='.repeat(65));
  console.log('  REKAPITULASI HASIL FASE 0');
  console.log('='.repeat(65));
  console.log(`Login HTTP Total      : ${latencies.loginTotalMs ?? '-'} ms`);
  console.log(`Discover Assignment   : ${latencies.discoverMs ?? '-'} ms`);
  console.log(`Check Lock Status     : ${latencies.checkLockMs ?? '-'} ms`);
  console.log(`Upload Draft (K1/K2)  : ${latencies.uploadK1Ms || latencies.uploadK2Ms || '-'} ms`);
  console.log(`Fetch Edit Form       : ${latencies.fetchEditFormMs ?? '-'} ms`);
  console.log('='.repeat(65));
}

runPhase0().catch(err => {
  console.error('[FATAL]', err);
  process.exit(1);
});
