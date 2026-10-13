# AGENT_SPEC — Sistem Auto-Submit Tugas Moodle UNAIR (Cloudflare Workers)

> Dokumen ini adalah instruksi lengkap untuk AI agent yang akan membangun, menguji, dan men-deploy seluruh sistem.
> Tanggal penyusunan: 13 Oktober 2026. Bahasa dokumen: Indonesia; identifier kode: Inggris.
> **Baca seluruh dokumen sebelum menulis kode.** Bagian 3 (fakta vs asumsi) dan Bagian 12 (aturan main agent) mengikat.

---

## 0. Ringkasan satu paragraf

Bangun aplikasi **Cloudflare Worker + Durable Object (SQLite)** yang, tepat saat tugas di `https://hebat.elearning.unair.ac.id` (Moodle) terbuka setiap Rabu 07:00 WIB, mengumpulkan file PDF milik pemilik akun **tanpa browser**, memakai request HTTP langsung. Pekerjaan berat (login, upload PDF ke draft area) dilakukan **sebelum** jam buka; di detik rebutan hanya tersisa polling ringan + 1–2 request. Sistem punya **UI web custom** (static assets di Worker yang sama), notifikasi Telegram, dan jalur cadangan. Semua **gratis** (paket Workers Free), **online** (tanpa standby laptop), dan **aman** (satu deployment per orang; password hanya sebagai Worker secret).

## 1. Tujuan, kriteria, dan non-tujuan

**Kriteria wajib (urut prioritas):**
1. **Aman**: password tidak pernah di-log/di-commit; satu deployment per pemilik akun; UI dilindungi login.
2. **Tepat waktu**: target selisih unlock → request submit terkirim sekecil mungkin (target kerja: < 1 detik; *belum terukur, ukur dan laporkan*).
3. **Gratis**: hanya fitur paket Cloudflare Workers Free. Jangan memakai fitur berbayar, kartu kredit, atau layanan lain yang tidak gratis.
4. **Online penuh**: setelah dikonfigurasi, tidak butuh laptop menyala.
5. **UI custom**: UI static (HTML/CSS/JS) yang mudah diubah pemilik. API-nya stabil dan terdokumentasi.

**Non-tujuan (JANGAN dilakukan):**
- Membypass kunci server-side Moodle (availability restriction tidak bisa dan tidak boleh dibypass; sistem hanya menunggu jam buka).
- Menyimpan password banyak orang dalam satu deployment. Satu deployment = satu akun.
- Memberi beban berlebihan ke server kampus (lihat batas polling di Bagian 8).
- Mengirim tugas orang lain atau memalsukan kepemilikan file.

## 2. Konteks proyek

- Platform: Moodle, host `hebat.elearning.unair.ac.id`.
- Tugas terbuka **Rabu 07:00 WIB** (UTC+7, tanpa DST), sistem rebutan, kunci di sisi server.
- ID assignment (cmid) **berubah tiap minggu**; **ID course stabil**; **nama assignment berpola stabil** (contoh: `Pengumpulan Modul Prak Lab 10`). Karena itu assignment dicari lewat **nama**.
- Login hanya username + password (tanpa 2FA/CAPTCHA, menurut pemilik).
- Cadangan manual yang sudah ada di luar dokumen ini: script Playwright lokal (`submit.js`) dan repo pihak lain berbasis Python/Playwright yang selector-nya terbukti jalan (lihat Lampiran A).

## 3. Fakta terverifikasi vs asumsi (WAJIB dibaca)

### 3.1 Terverifikasi dari artefak nyata (snapshot HTML Moodle UNAIR + investigasi pemilik)

| # | Fakta | Sumber |
|---|-------|--------|
| F1 | Form simpan submission: `POST https://hebat.elearning.unair.ac.id/mod/assign/view.php`, `method=post`. | snapshot `add_file-save-changes.htm` |
| F2 | Field hidden form: `lastmodified`, `id` (=cmid), `userid`, `action=savesubmission`, `sesskey`, `_qf__mod_assign_submission_form=1`, `mform_isexpanded_id_submissionheader=1`, `files_filemanager` (=draft itemid), tombol `submitbutton`="Save changes". | snapshot |
| F3 | Repository "Upload a file" punya `id=5`, type `upload`. Opsi filemanager: `maxbytes=104857600` (100 MB), `maxfiles=20`, `subdirs=1`. Ada `client_id`, `itemid`, `context` (id konteks assignment) di konfigurasi filepicker. | snapshot |
| F4 | `lastmodified` pada form edit bernilai epoch detik (contoh `1787185295`); belum diketahui apakah bernilai 0 atau timestamp pembuatan record submission untuk mahasiswa yang belum pernah submit. | snapshot |
| F5 | Selector UI yang terbukti dipakai bot sukses: `.fp-btn-add a`, `.fp-repo-name:has-text('Upload a file')`, `input[name='repo_upload_file']`, `button.fp-upload-btn`, `#id_submitbutton`, dialog overwrite `button:has-text('Overwrite'), .fp-dlg-butoverwrite`. | repo Python + log SUCCESS |
| F6 | Setelah Save changes pada tugas yang diuji, status halaman = "Submitted for grading" (tombol "Edit submission" dan "Remove submission" ada). Artinya untuk tugas itu **tidak ada langkah "Submit assignment" terpisah**. Tugas lain bisa berbeda; verifikasi selalu dilakukan. | snapshot `assign_*_view.html` |
| F7 | Saat tugas terkunci, mengakses `mod/assign/view.php?id=CMID` **redirect** ke `course/view.php?id=COURSE_ID`. Elemen `li.activity.assign` (id `module-CMID`) tetap ada di halaman course walau terkunci. | investigasi pemilik (13 Okt 2026) |
| F8 | Login form memakai field `#username`, `#password`, tombol `#loginbtn`. | script repo Python |

### 3.2 Terverifikasi dari dokumentasi Cloudflare (dicek 13 Okt 2026; **cek ulang saat implementasi**)

| # | Fakta |
|---|-------|
| C1 | Workers Free: **CPU 10 ms per invokasi**. Durasi wall-clock tidak dibatasi untuk request HTTP; **alarm Durable Object maksimal 15 menit wall**. |
| C2 | Workers Free: **50 subrequest (`fetch`) per invokasi** (permintaan ke layanan internal seperti DO/KV: 1.000). |
| C3 | Durable Object berbasis **SQLite tersedia di Workers Free**, termasuk alarm. |
| C4 | Cron Triggers berjalan **dalam UTC**; Free: 5 trigger per akun. |
| C5 | Batas request harian Workers Free: 100.000. Burst 1.000/menit. |

### 3.3 ASUMSI / HIPOTESIS (belum terverifikasi; harus diuji, lihat Fase 0)

| # | Hipotesis | Bila salah → |
|---|-----------|--------------|
| H1 | Login via HTTP: `GET /login/index.php` memuat hidden `logintoken`; `POST` username+password+logintoken menghasilkan cookie `MoodleSession`. | Minta pemilik tangkap request login asli (DevTools). |
| H2 | **Upload ke draft area bisa dilakukan sebelum tugas terbuka**, jika memakai konteks **course** (`ctx_id` = context course, bukan context assignment) lewat `POST /repository/repository_ajax.php?action=upload`. Pemeriksaan akses cm yang terkunci kemungkinan menolak jika memakai konteks assignment. | Coba kandidat berikutnya (Bagian 7.4). Jika semua gagal: upload dilakukan setelah unlock (lebih lambat) atau gunakan jalur browser cadangan. |
| H3 | Draft itemid baru bisa didapat/diciptakan tanpa membuka form edit (kandidat: itemid acak 9 digit; atau web service `core_files_upload`/`core_files_get_unused_draft_itemid` bila tersedia lewat `lib/ajax/service.php`). | Dapatkan itemid dari halaman lain yang punya filemanager (mis. halaman private files) dan uji apakah bisa dipakai. |
| H4 | Menyimpan submission butuh nilai `lastmodified` dari form → **harus `GET action=editsubmission` setelah unlock, lalu `POST`** (2 request). | Jika `lastmodified` bisa 0/dihilangkan, cukup 1 request. Uji. |
| H5 | Alternatif jalur cepat: AJAX `mod_assign_save_submission` via `POST /lib/ajax/service.php?sesskey=...` (butuh *instance id* assignment, bukan cmid) — apakah fungsi ini boleh dipanggil via ajax di situs ini belum diketahui. | Pakai jalur form (H4). |
| H6 | Di runtime Workers, `Date.now()` hanya maju setelah I/O (mitigasi Spectre) → **jangan busy-wait**; gunakan `setTimeout`/`await sleep()`. (Sepengetahuan penyusun; verifikasi.) | Sesuaikan algoritma tunggu. |
| H7 | Presisi alarm Durable Object cukup untuk bangun ±beberapa detik sebelum target (bukan tepat di milidetik). Karena itu alarm dijadwalkan **lebih awal** dan penantian akhir dilakukan dengan `sleepUntil`. | Majukan alarm lebih awal. |
| H8 | Parsing halaman form (~230 KB) muat dalam 10 ms CPU bila memakai ekstraksi hemat (regex terarah/`HTMLRewriter`). | Optimalkan (Bagian 8.4); opsi terakhir di luar kriteria "gratis" = paket berbayar. **Jangan pilih diam-diam; laporkan ke pemilik.** |

**Aturan:** setiap hipotesis dicatat hasilnya di `docs/FINDINGS.md` (terbukti / gugur / bukti). Jangan menganggap hipotesis benar.

---

## 4. Arsitektur

```
        ┌─────────────── Browser pemilik (UI custom) ───────────────┐
        │  login app → upload PDF → set nama tugas → ARM/DISARM    │
        └───────────────┬──────────────────────────────────────────┘
                        │ HTTPS (cookie sesi app, SameSite=Strict)
                ┌───────▼────────┐        ┌──────────────────────┐
                │ Worker (index) │───────▶│ Durable Object        │
                │ routing, auth, │  RPC   │ SubmitJob (SQLite)    │
                │ static assets  │        │ - state, log, PDF     │
                └────────────────┘        │ - cookie sesi Moodle  │
                                          │ - alarm()             │
        Cron (opsional, mingguan)────────▶│                       │
                                          └──────┬───────────────┘
                                                 │ fetch (HTTP murni)
                                   ┌─────────────▼─────────────┐
                                   │ hebat.elearning.unair.ac.id│
                                   └─────────────┬─────────────┘
                                                 │
                              Telegram Bot API ◀─┘ (notifikasi)
```

**Satu Durable Object bernama `main`** (singleton per deployment).

### 4.1 Timeline eksekusi (satu siklus mingguan)

| Waktu (WIB) | Aksi | Invokasi |
|---|---|---|
| Kapan saja sebelum Rabu | Pemilik upload PDF via UI → disimpan di DO (chunk ≤ 1 MB/row). Status `READY`. | HTTP |
| Rabu **T-10 mnt** (06:50) | Alarm A: login Moodle, cari assignment by nama, cek unlock time dari halaman, **upload PDF ke draft area baru**, hitung offset jam server, simpan state `PREPARED`. | alarm #1 |
| Rabu **T-60 dtk** (06:59:00) | Alarm B: validasi sesi (1–2 request; login ulang bila perlu), lalu `sleepUntil(T - 400ms)`. | alarm #2 |
| **T-0.4 dtk → T+120 dtk** | Polling ringan `view.php?id=CMID` (redirect manual). Begitu 200 → `GET editsubmission` → `POST savesubmission` → verifikasi → notifikasi. | alarm #2 (burst) + re-arm |
| T+2 mnt jika gagal | Notifikasi "SUBMIT MANUAL SEKARANG" + (opsional) trigger jalur cadangan. | alarm terakhir |

Jadwal ini bisa dipicu manual lewat tombol **ARM** di UI atau otomatis tiap minggu lewat **Cron Trigger** (UTC!): Selasa 23:30 UTC = Rabu 06:30 WIB.

### 4.2 Struktur repo

```
moodle-autosubmit/
├─ wrangler.jsonc
├─ package.json            # TypeScript, wrangler, vitest, @cloudflare/workers-types
├─ tsconfig.json           # strict
├─ .gitignore              # .dev.vars, node_modules, *.pdf, *.har, *.json (kecuali config), screenshots
├─ src/
│  ├─ index.ts             # Worker: routing, auth, static assets, cron handler
│  ├─ job.ts               # class SubmitJob extends DurableObject (state machine + alarm)
│  ├─ moodle/
│  │  ├─ http.ts           # CookieJar + mfetch (redirect manual, hop limit, Budget)
│  │  ├─ login.ts
│  │  ├─ discover.ts       # cari cmid, context course, unlock time dari halaman course
│  │  ├─ upload.ts         # upload ke draft area
│  │  ├─ submit.ts         # GET editsubmission, POST savesubmission, verifikasi
│  │  └─ parse.ts          # fungsi parsing murni (diuji dengan fixture)
│  ├─ time.ts              # WIB, hitung unlock default, offset server, sleepUntil
│  ├─ notify.ts            # Telegram
│  └─ log.ts               # logger dengan redaksi
├─ ui/                     # index.html, app.js, style.css (static assets)
├─ scripts/
│  └─ phase0.mjs           # eksperimen lokal Node (Fase 0)
├─ tests/
│  ├─ fixtures/            # HTML Moodle (sudah disanitasi!)
│  └─ *.test.ts
└─ docs/
   ├─ FINDINGS.md          # hasil uji hipotesis (wajib diisi agent)
   └─ RUNBOOK.md           # prosedur hari-H dan troubleshooting
```

### 4.3 Konfigurasi & secret

`wrangler.jsonc` (kerangka; sesuaikan dengan versi wrangler terbaru, **cek dokumentasi**):

```jsonc
{
  "name": "moodle-autosubmit",
  "main": "src/index.ts",
  "compatibility_date": "2026-10-01",
  "assets": { "directory": "./ui" },
  "durable_objects": { "bindings": [{ "name": "JOB", "class_name": "SubmitJob" }] },
  "migrations": [{ "tag": "v1", "new_sqlite_classes": ["SubmitJob"] }],
  "triggers": { "crons": ["30 23 * * 2"] },   // Selasa 23:30 UTC = Rabu 06:30 WIB (opsional)
  "vars": {
    "MOODLE_BASE": "https://hebat.elearning.unair.ac.id",
    "COURSE_ID": "10978",
    "DRY_RUN": "false"
  }
}
```

**Secret (via `wrangler secret put`, JANGAN di file/komit):**
`MOODLE_USER`, `MOODLE_PASS`, `APP_PASSWORD` (login UI), `SESSION_HMAC_KEY` (≥32 byte acak), `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` (opsional), `GITHUB_PAT` (opsional, jalur cadangan).
Untuk dev lokal: `.dev.vars` (wajib masuk `.gitignore`).

Setting yang diubah lewat UI (disimpan di DO): `assignmentName`, `courseId` (override), `sectionUrl` (opsional), `unlockAtOverride` (ISO dengan offset +07:00), `autoWeekly` (bool).

---

## 5. Kontrak API (UI ↔ Worker)

Semua endpoint di bawah `/api`, JSON, kecuali upload (multipart). Semua kecuali `/api/login` butuh cookie sesi app yang valid. Mutasi butuh header `X-Requested-With: fetch` (anti-CSRF tambahan di samping `SameSite=Strict`).

| Method | Path | Fungsi | Respons ringkas |
|---|---|---|---|
| POST | `/api/login` | `{password}` → set cookie HttpOnly+Secure+SameSite=Strict (token HMAC berkadaluarsa 12 jam). Rate-limit: maks 5 gagal/10 menit (hitung di DO). | `{ok:true}` |
| POST | `/api/logout` | hapus cookie | `{ok:true}` |
| GET | `/api/status` | state mesin, assignment ditemukan, unlock time, offset server, countdown, ukuran/nama PDF, status draft, hasil terakhir | lihat 5.1 |
| POST | `/api/config` | simpan setting (nama tugas, unlock override, autoWeekly) | `{ok:true}` |
| POST | `/api/file` | multipart `file` (PDF, ≤ 10 MB di sisi app; validasi magic bytes `%PDF`) → simpan chunk di DO | `{name,size,sha256}` |
| DELETE | `/api/file` | hapus PDF tersimpan | `{ok:true}` |
| POST | `/api/check` | login + cari assignment + baca unlock time (tanpa upload/submit). Setara `CHECK_ONLY`. | `{ok, cmid, name, unlockAt, locked}` |
| POST | `/api/prepare` | jalankan langkah persiapan sekarang (login, upload draft, offset) | `{ok, draftItemId?}` |
| POST | `/api/arm` | jadwalkan alarm A/B untuk unlock berikutnya | `{ok, nextUnlockAt}` |
| POST | `/api/disarm` | batalkan alarm | `{ok:true}` |
| GET | `/api/logs?limit=200` | log terstruktur (sudah diredaksi) | `[{t, lvl, ev, data}]` |
| POST | `/api/test-notify` | kirim notifikasi Telegram uji | `{ok}` |

### 5.1 State mesin (`phase`)

`IDLE → READY(file ada) → ARMED → PREPARING → PREPARED → WAITING → POLLING → SUBMITTING → DONE | FAILED | CANCELLED`

`/api/status` minimal berisi: `phase`, `assignment {cmid,name,url}`, `unlockAtIso`, `serverOffsetMs`, `file {name,size}`, `draft {itemId, createdAt}`, `lastResult {status, tSubmitMs, note}`.

---

## 6. Rencana kerja bertahap (dengan kriteria lulus)

> **Aturan fase:** jangan lanjut ke fase berikutnya sebelum kriteria lulus fase sekarang terpenuhi dan tercatat di `docs/FINDINGS.md`.

### Fase 0 — Eksperimen lokal Node (menguji H1–H5) · *tanpa Cloudflare*

Tulis `scripts/phase0.mjs` (Node ≥ 20, `fetch` bawaan, tanpa Playwright). Kredensial dari env `MOODLE_USER`, `MOODLE_PASS`. Script bertahap, tiap tahap mencetak PASS/FAIL + alasan, **tanpa mencetak password/cookie/sesskey**:

1. **Login (H1)**: GET login → ambil `logintoken` → POST → ikuti redirect manual → cookie `MoodleSession` ada → GET `/my/` berisi penanda user login. Ambil `sesskey` dari `M.cfg` (`"sesskey":"..."`) di HTML.
2. **Discover**: GET `course/view.php?id=COURSE_ID` (+ `sectionUrl` bila ada) → temukan `li.modtype_assign`/`id="module-N"` yang teks namanya cocok `ASSIGNMENT_NAME` → cmid. Ambil juga **context id course** (`contextid` di `M.cfg` atau atribut data) dan teks "Available from …" bila ada.
3. **Status kunci (F7)**: GET `view.php?id=CMID` dengan `redirect:'manual'`. Terkunci → 30x ke course; terbuka → 200. Catat.
4. **Upload draft (H2/H3)**: coba kandidat berurutan sampai ada yang berhasil (Bagian 7.4). Berhasil bila respons JSON upload memuat file dan **tanpa** kunci `error`.
5. **Verifikasi draft**: pastikan file tampil di draft area (mis. via `draftfiles_ajax`/`draftfiles_manager.php` bila bisa, atau lewat form edit pada tugas yang sedang terbuka).
6. **Submit (H4/H5)** — *hanya jika ada tugas yang sedang terbuka dan boleh diedit pemilik*: GET `editsubmission` → parse hidden fields → POST `savesubmission` dengan `files_filemanager=<draft itemid>` → verifikasi "Submitted for grading" + nama file. Jika tidak ada tugas terbuka: **lewati tahap ini dan tandai "belum teruji"**; JANGAN submit ke tugas yang salah. Flag `DRY_RUN=true` berhenti sebelum POST.
7. **Ukur latensi**: catat durasi tiap request (ms) dari tahap 3 dan 6.

**Lulus Fase 0:** tahap 1–5 PASS (atau alternatif terdokumentasi), tahap 6 PASS atau ditandai belum teruji beserta alasannya; `FINDINGS.md` memuat status H1–H5 dan angka latensi.
**Jika H2 gagal pada semua kandidat:** berhenti, tulis temuan, dan minta pemilik menangkap Network DevTools dari proses manual (instruksi di Bagian 11). Jangan menebak endpoint tanpa bukti.

### Fase 1 — Pustaka Moodle + unit test

Pindahkan logika Fase 0 ke `src/moodle/*` (TypeScript, runtime-agnostik: hanya `fetch`/`URL`/`Headers`). Tulis `parse.ts` sebagai fungsi murni dan uji dengan fixture HTML yang disanitasi (hapus `sesskey`, NIM, nama, email). Cakupan minimum: parsing logintoken, sesskey, daftar assignment by nama, hidden fields form edit, deteksi "Submitted for grading" (EN; tambahkan padanan Indonesia bila ada bukti), parsing "Available from …".

**Lulus:** `vitest` hijau; tidak ada rahasia di fixture (`grep` untuk NIM/sesskey/cookie = kosong).

### Fase 2 — Worker + Durable Object (tanpa UI)

Implementasi `index.ts`, `job.ts`, state machine, alarm A/B, logger, Telegram, endpoint `/api/*` (Bagian 5). Uji dengan `wrangler dev` lalu deploy ke akun Cloudflare pemilik.

**Lulus:**
- `/api/check` di Worker deploy berhasil (login dari IP Cloudflare **diterima** server UNAIR — ini menjawab risiko IP; catat di FINDINGS).
- Alarm A dan B terbukti terpicu pada waktu uji (jadwalkan dummy 5 menit ke depan; catat deviasi waktu alarm → H7).
- Log Workers menunjukkan **CPU time < 10 ms** untuk setiap invokasi pada alur tanpa-submit (H8) dan **tidak melewati 50 subrequest** (C2).

### Fase 3 — UI custom

Bangun `ui/` (vanilla HTML/CSS/JS tanpa build step wajib; boleh framework bila pemilik minta). Halaman: **Login**, **Dashboard** (status, countdown ke unlock memakai offset server, assignment terdeteksi, status PDF/draft, hasil terakhir), **Pengaturan** (nama tugas, unlock override, autoWeekly, uji Telegram), **Log** (tabel, auto-refresh), tombol **Check / Prepare / ARM / DISARM**, area **upload PDF** (drag-drop + validasi).
Persyaratan UI: responsif (HP ≥ 360 px), mendukung mode gelap (`prefers-color-scheme`), semua warna lewat CSS variables di `:root` agar mudah dikustom pemilik, tidak ada library eksternal wajib, tidak menyimpan rahasia di `localStorage`. Tambahkan `docs/UI_CUSTOMIZE.md` (cara mengganti tema/logo/teks).

**Lulus:** seluruh alur UI berfungsi di HP dan desktop terhadap Worker deploy, termasuk login app, upload, check, arm/disarm.

### Fase 4 — Uji hari-H bertahap

1. **Dry run penuh** (`DRY_RUN=true`) pada Rabu nyata: semua langkah berjalan sampai tepat sebelum POST final; catat waktu tiap peristiwa relatif ke unlock.
2. **Live dengan pemilik standby** (cadangan manual): sistem submit sendiri; pemilik hanya mengawasi.
3. Setelah 2 siklus sukses → aktifkan `autoWeekly`.

**Lulus:** ≥ 1 submission live sukses terverifikasi "Submitted for grading" dengan nama file benar; latensi tercatat di `FINDINGS.md`.

### Fase 5 (opsional) — Jalur cadangan otomatis

Bila `GITHUB_PAT` ada: jika jalur HTTP gagal pada T+20 dtk, Worker memicu `workflow_dispatch` ke repo pemilik (workflow Playwright; selector F5). Dokumentasikan pembuatan fine-grained PAT (hanya 1 repo, izin Actions: write).

### Fase 6 — Template untuk teman

Dokumentasikan "Deploy sendiri": fork/template repo → `wrangler login` → buat secret → deploy → buka UI. **Tidak ada backend bersama; tidak ada penyimpanan password orang lain.** README berbahasa Indonesia, ≤ 15 menit setup.

---

## 7. Spesifikasi teknis Moodle (HTTP)

### 7.1 Utilitas HTTP (wajib)

- Workers `fetch` tidak punya cookie jar → implementasikan `CookieJar` sendiri (parse `res.headers.getSetCookie()`, hapus cookie kedaluwarsa, kirim header `Cookie`).
- Selalu `redirect: 'manual'`; ikuti redirect sendiri dengan batas hop (maks 6). **Setiap hop = 1 subrequest** (lihat budget, Bagian 8.2).
- Header: `User-Agent` wajar (Chrome stabil), `Accept-Language: en-US,en;q=0.9,id;q=0.8`.
- Jangan pernah log header `Cookie`, `Set-Cookie`, body login, `sesskey`, atau password. Logger harus meredaksi pola tersebut secara otomatis.

Kerangka (verifikasi sebelum dipakai):

```ts
export class CookieJar {
  private m = new Map<string, string>();
  ingest(res: Response) {
    for (const sc of res.headers.getSetCookie()) {
      const [pair] = sc.split(';');
      const i = pair.indexOf('=');
      const k = pair.slice(0, i).trim(), v = pair.slice(i + 1).trim();
      if (/max-age=0|expires=[^;]*1970/i.test(sc) || v === '') this.m.delete(k);
      else this.m.set(k, v);
    }
  }
  header() { return [...this.m].map(([k, v]) => `${k}=${v}`).join('; '); }
  dump() { return Object.fromEntries(this.m); }           // simpan di DO storage
  static load(o: Record<string, string>) { const j = new CookieJar(); for (const k in o) j.m.set(k, o[k]); return j; }
}

export class Budget {                                      // batas 50 subrequest/invokasi (C2)
  constructor(private left = 48) {}
  take(n = 1) { if (this.left < n) throw new Error('SUBREQUEST_BUDGET'); this.left -= n; }
  get remaining() { return this.left; }
}

export async function mfetch(jar: CookieJar, bud: Budget, url: string, init: RequestInit = {}, maxHops = 6) {
  let u = url, method = init.method ?? 'GET', body = init.body;
  for (let h = 0; h <= maxHops; h++) {
    bud.take();
    const res = await fetch(u, {
      ...init, method, body, redirect: 'manual',
      headers: { ...(init.headers as Record<string, string>), cookie: jar.header(), 'user-agent': UA },
    });
    jar.ingest(res);
    const loc = res.headers.get('location');
    if (res.status >= 300 && res.status < 400 && loc) { u = new URL(loc, u).toString(); method = 'GET'; body = undefined; continue; }
    return res;
  }
  throw new Error('TOO_MANY_REDIRECTS');
}
```

### 7.2 Login (H1)

1. `GET {BASE}/login/index.php` → parse `<input type="hidden" name="logintoken" value="...">` (bila tidak ada, catat; coba tanpa).
2. `POST {BASE}/login/index.php` (`application/x-www-form-urlencoded`): `username`, `password`, `logintoken`, `anchor=`.
3. Ikuti redirect; sukses bila URL akhir bukan `/login/` dan halaman memuat penanda user login (mis. `.usermenu` / `M.cfg.userId` ≠ 0). Gagal → baca pesan `#loginerrormessage` (tanpa mencetak input).
4. Ambil `sesskey` dari `"sesskey":"<alnum>"` di HTML.

### 7.3 Discover assignment

- Sumber: halaman course (dan `sectionUrl` bila diisi). Cari `li` dengan class `modtype_assign`; ambil `id="module-<cmid>"` dan teks nama (`.instancename`). Cocokkan nama dengan normalisasi huruf kecil + spasi tunggal, mode "mengandung".
- Bila tidak ketemu: log daftar nama assignment yang terlihat (tanpa data pribadi) dan berhenti dengan galat jelas.
- Ambil context id course (dari `M.cfg.contextid` di halaman course) untuk upload (H2).
- Ambil teks "Available from …" (EN; cek varian Indonesia) bila ada, parse ke epoch; bandingkan dengan unlock hasil perhitungan. **Jika selisih > 60 detik: tampilkan peringatan di UI dan pakai nilai dari halaman** (sumber kebenaran), kecuali ada `unlockAtOverride`.

### 7.4 Upload ke draft area (H2/H3) — kandidat berurutan

Endpoint upload filepicker standar: `POST {BASE}/repository/repository_ajax.php?action=upload` (multipart). Field yang lazim (**verifikasi terhadap Network nyata**): `repo_upload_file` (file), `sesskey`, `repo_id=5` (F3), `itemid` (draft), `author`, `title`, `savepath=/`, `ctx_id`, `client_id`, `maxbytes=104857600`, `areamaxbytes=-1`, `env=filemanager`, `license=allrightsreserved` (atau `unknown`).

Kandidat (coba berurutan, berhenti saat sukses, catat di FINDINGS):

- **K1**: `ctx_id` = context **course**, `itemid` = integer acak 9 digit. Respons sukses JSON berisi `file`/`url`/`id` tanpa `error`.
- **K2**: dapatkan `itemid` valid dari halaman yang selalu punya filemanager (mis. halaman *Private files* milik user) lalu upload ke itemid itu dengan `ctx_id` = context user. Catatan: draft area private files memuat file private yang sudah ada; cek dampaknya sebelum dipakai untuk submission.
- **K3**: web service AJAX `core_files_upload` (param konteks `user`/`draft`, `itemid=0` agar server membuat draft baru) lewat `POST /lib/ajax/service.php?sesskey=...` — hanya bila fungsi ini terbukti tersedia via ajax.
- **K4**: upload **setelah unlock** memakai itemid dari form edit (lebih lambat; fallback terakhir).

Simpan hasil: `draftItemId`, waktu pembuatan, `sha256` file. **Draft area dibuang Moodle setelah ±4 hari** (sumber: dokumentasi Moodle) → karena PDF disimpan di DO, **selalu upload ulang pada Alarm A (T-10 mnt)**; jangan bergantung pada draft lama.

### 7.5 Submit (H4/H5)

**Jalur utama (form):**
1. Setelah polling mendeteksi 200: `GET {BASE}/mod/assign/view.php?id=CMID&action=editsubmission` (redirect manual; jika kembali 30x, tugas belum benar-benar terbuka → lanjut polling).
2. Ekstrak **hanya** hidden input milik form `mform1_*` (bukan form upload filepicker): `lastmodified`, `id`, `userid`, `action`, `sesskey`, `_qf__mod_assign_submission_form`, `mform_isexpanded_id_submissionheader`, dan nama field lain yang ada. **Jangan hardcode** — bangun payload dari yang di-parse, lalu **ganti** `files_filemanager` dengan `draftItemId` kita, tambahkan `submitbutton=Save changes`.
3. `POST {BASE}/mod/assign/view.php` (`application/x-www-form-urlencoded`).
4. **Verifikasi**: `GET view.php?id=CMID` → harus memuat "Submitted for grading" (cek padanan Indonesia bila ada bukti) **dan** nama file PDF. Jika status "Draft (not submitted)" → cari tombol "Submit assignment" dan lakukan konfirmasi (form `action=submit`, ikut `submissionstatement` bila ada), lalu verifikasi ulang.
5. Jika respons POST memuat pesan galat form (mis. peringatan modifikasi bersamaan terkait `lastmodified`): ambil `GET editsubmission` baru dan ulangi **sekali**.

**Jalur alternatif (H5)**: `mod_assign_save_submission` via `lib/ajax/service.php` — hanya bila Fase 0 membuktikan tersedia; butuh *assignment instance id* (bukan cmid).

---

## 8. Algoritma waktu, polling, dan batas sumber daya

### 8.1 Unlock time
- Default: Rabu 07:00:00 WIB berikutnya (hitung dalam UTC: 00:00:00 UTC hari Rabu; WIB = UTC+7 tanpa DST). Prioritas sumber: (1) `unlockAtOverride`, (2) teks "Available from" di halaman assignment/course, (3) default Rabu 07:00.
- Semua perhitungan internal dalam epoch ms UTC.

### 8.2 Budget subrequest (C2) — **desain wajib**
Satu invokasi alarm hanya boleh ≤ 50 fetch. Alokasi:
- **Alarm A (persiapan)**: login ≈ 6, discover 1–2, upload 1–3, sampling offset 3 → ≈ 14. Aman.
- **Alarm B (eksekusi)**: validasi sesi ≤ 2, **cadangan submit = 8** (GET edit 1, POST 1, verify 1–2, Telegram 1, sisa), sisanya untuk polling (≈ 35). Gunakan `Budget` dan hentikan polling saat `remaining <= 8`.
- Bila burst habis dan belum terbuka → simpan state, `setAlarm(Date.now()+20)` untuk melanjutkan di invokasi baru (budget reset). Polling total dibatasi jendela **T-0.4 dtk sampai T+120 dtk**.

### 8.3 Sinkronisasi jam
- Sampling offset: 5 request ringan ke `{BASE}/login/index.php`; `offset = serverDateMs + 500 − (t0+t1)/2` (header `Date` beresolusi 1 detik, jadi tambahkan 500 ms ke tengah interval); ambil **median**.
- `nowServer() = Date.now() + offset`. Akurasi realistis ±0,5 dtk; tidak masalah karena polling dimulai 0,4 dtk sebelum target.
- **Jangan busy-wait (H6)**: gunakan `sleepUntil` berbasis `setTimeout` bertahap.

```ts
const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));
export async function sleepUntil(targetServerMs: number, offset: number) {
  for (;;) {
    const rem = targetServerMs - (Date.now() + offset);
    if (rem <= 0) return;
    await sleep(Math.min(rem, 1000));
  }
}
```

### 8.4 Polling ringan & CPU (H8)
- Deteksi buka/kunci **tanpa membaca body**: `GET view.php?id=CMID` dengan `redirect:'manual'`; **30x = terkunci (F7), 200 = terbuka**. Setelah dapat status, panggil `res.body?.cancel()`.
- Interval polling: **180 ms** (≈ 5,5 req/dtk), jendela maks 120 dtk. **Jangan lebih agresif** (hormati server kampus).
- Parsing form edit (~230 KB): hindari DOM penuh. Gunakan `indexOf` untuk memotong segmen `<form ... mform1_ ...>…</form>` lalu regex pada segmen itu, atau `HTMLRewriter` streaming. Ukur CPU di Workers Logs; **bila > 10 ms secara konsisten, laporkan ke pemilik dengan angka** dan usulkan opsi (optimasi lanjutan / jalur browser cadangan / paket berbayar sebagai pilihan terakhir milik pemilik).

### 8.5 Retry & idempotensi
- Alarm Durable Object bisa dieksekusi ulang bila terjadi galat → semua langkah **idempoten**: sebelum POST final, cek state `SUBMITTING/DONE` di DO; setelah sukses, tandai `DONE` **sebelum** mengirim notifikasi.
- POST final dikirim **sekali** per deteksi terbuka; retry hanya pada galat jaringan atau galat `lastmodified`, maks 2 kali.

---

## 9. Keamanan (wajib dipenuhi)

1. **Satu deployment = satu akun.** Tidak ada kolom "banyak user", tidak ada endpoint yang menerima password dari luar.
2. Password hanya di **Worker secret**. Cookie sesi Moodle disimpan di DO storage; **tidak pernah** di log, respons API, atau UI.
3. UI: login dengan `APP_PASSWORD` (bandingkan constant-time), cookie token HMAC (`HttpOnly; Secure; SameSite=Strict; Path=/`), kedaluwarsa 12 jam, rate-limit login di DO, header keamanan (`Content-Security-Policy` ketat tanpa inline script, `X-Content-Type-Options`, `Referrer-Policy: no-referrer`, `X-Frame-Options: DENY`).
4. Validasi upload: hanya PDF (cek magic bytes `%PDF-`), batas ukuran sisi app, sanitasi nama file.
5. Redaksi log otomatis: `Cookie`, `Set-Cookie`, `sesskey`, `password`, `logintoken`, `MoodleSession`, token Telegram.
6. Repo: `.gitignore` menolak `.dev.vars`, `*.pdf`, `*.har`, `*.json` sesi, screenshot. Tambahkan pemeriksaan pre-commit sederhana (grep pola rahasia).
7. Fixture test **wajib disanitasi** (hapus sesskey, NIM, nama, email, cookie).
8. Jangan mengirim data apa pun ke pihak ketiga selain Moodle UNAIR dan Telegram (opsional) dan GitHub (opsional, jalur cadangan).

## 10. Observabilitas

- Log terstruktur `{t, lvl, ev, data}` di DO SQLite (simpan 500 baris terakhir, buang yang lama).
- Peristiwa waktu yang wajib dicatat relatif ke unlock (ms): `alarmA_start`, `login_ok`, `draft_uploaded`, `offset_ms`, `alarmB_start`, `poll_first`, `unlock_detected`, `form_fetched`, `post_sent`, `post_done`, `verified`, `notified`; plus `cpu_ms`/`subrequests` bila tersedia.
- Notifikasi Telegram: ringkas, tanpa data sensitif. Gagal kirim notifikasi **tidak boleh** menggagalkan submit.

## 11. Bila hipotesis gugur: minta bukti dari pemilik (jangan menebak)

Instruksikan pemilik (dalam bahasa sederhana):
1. Buka tugas yang **sedang terbuka**, DevTools → tab **Network**, centang **Preserve log**.
2. Lakukan upload + Save secara manual.
3. Catat daftar request yang relevan: URL, method, **nama** parameter (form data), status. 
4. **Jangan kirim**: password, cookie (`MoodleSession`), nilai `sesskey`, atau file HAR mentah. Ganti nilainya dengan `<REDACTED>`.

## 12. Aturan main untuk AI agent

1. **Jangan mengarang** endpoint, field, atau perilaku Moodle/Cloudflare. Setiap klaim teknis harus punya bukti (log uji, fixture, dokumentasi resmi yang dibuka saat itu). Bila belum pasti, tulis "belum terverifikasi" di FINDINGS.
2. **Cek dokumentasi Cloudflare terkini** untuk batas (CPU, subrequest, alarm) dan sintaks `wrangler` sebelum implementasi; versi di dokumen ini bisa kedaluwarsa.
3. **Jangan melakukan aksi live yang tak dapat dibatalkan** (submit sungguhan, "Submit assignment") tanpa persetujuan eksplisit pemilik pada sesi itu. Default `DRY_RUN=true` sampai pemilik menyatakan siap live.
4. **Jangan mengunggah file ke tugas yang salah.** Selalu cocokkan nama assignment dan tampilkan cmid + nama ke pemilik sebelum aksi mutasi pertama.
5. **Jangan menyimpan atau mencetak rahasia.** Bila rahasia terlanjur muncul di output/log, hentikan, beritahu pemilik, dan sarankan rotasi.
6. **Jangan menaikkan agresivitas polling** di atas batas Bagian 8.4.
7. **Jangan beralih ke layanan berbayar** (termasuk paket Workers Paid) tanpa persetujuan tertulis pemilik; presentasikan angka dan opsi.
8. Hormati fase: laporkan hasil tiap fase (apa yang lulus, apa yang gagal, angka, bukti) sebelum lanjut.
9. Bila pemilik meminta perubahan UI, ubah hanya `ui/` dan jaga kontrak API (Bagian 5).
10. Bila ragu tentang aturan kampus soal otomasi, **tanyakan ke pemilik**; jangan asumsikan.

## 13. Pertanyaan yang harus ditanyakan agent ke pemilik sebelum mulai

1. Apakah sudah punya akun Cloudflare (gratis) dan `wrangler login` bisa dijalankan?
2. `COURSE_ID` dan pola nama assignment untuk minggu ini?
3. Ada tugas yang **sedang terbuka** dan boleh dipakai untuk uji submit sungguhan (Fase 0 tahap 6)? Jika tidak, uji submit baru bisa dilakukan pada Rabu berikutnya.
4. Mau notifikasi Telegram? (butuh bot token + chat id)
5. Mau jalur cadangan GitHub Actions? (butuh repo private + PAT fine-grained)
6. Preferensi tampilan UI (warna, logo, bahasa)?
7. Apakah login dari IP luar negeri pernah dibatasi oleh kampus (info tambahan untuk risiko Fase 2)?

## 14. Daftar tugas manusia (pemilik)

- [ ] Buat akun Cloudflare gratis; install Node ≥ 20; `npm i -g wrangler` (atau pakai `npx`); `wrangler login`.
- [ ] Siapkan `MOODLE_USER`, `MOODLE_PASS`, `APP_PASSWORD` (kuat, unik), `SESSION_HMAC_KEY` (acak ≥ 32 byte).
- [ ] (Opsional) Buat bot Telegram via @BotFather, ambil `chat id`.
- [ ] (Opsional) Buat repo GitHub **private** dan PAT fine-grained (1 repo, Actions: write) untuk jalur cadangan.
- [ ] Sediakan PDF tugas; siap standby pada Rabu uji pertama (cadangan manual).
- [ ] Berikan bukti Network yang disanitasi bila agent memintanya (Bagian 11).

## 15. Definition of Done

- [ ] `docs/FINDINGS.md` memuat status H1–H8 (terbukti/gugur) dengan bukti.
- [ ] Fase 0–4 lulus; ≥ 1 submit live terverifikasi.
- [ ] UI berfungsi di HP + desktop; kontrak API terdokumentasi; `docs/UI_CUSTOMIZE.md` ada.
- [ ] Log Workers menunjukkan CPU < 10 ms dan subrequest ≤ 50 per invokasi pada alur normal (atau deviasi dilaporkan beserta opsi).
- [ ] Tidak ada rahasia di repo/riwayat git (`gitleaks`/grep bersih).
- [ ] `docs/RUNBOOK.md`: prosedur H-1 (cek), hari-H (apa yang dipantau), jika gagal (submit manual + diagnosis), rotasi rahasia.
- [ ] Laporan akhir ke pemilik: apa yang terbukti, apa yang masih asumsi, latensi terukur, risiko tersisa.

---

## Lampiran A — Jalur cadangan: browser (Playwright)

Selector terbukti (F5), gunakan bila jalur HTTP tidak bisa:

```text
buka form      : {BASE}/mod/assign/view.php?id=CMID&action=editsubmission
tambah file    : .fp-btn-add a
repo upload    : .fp-repo-name:has-text('Upload a file')   (kadang sudah default)
input file     : input[name='repo_upload_file']
upload         : button.fp-upload-btn
overwrite      : button:has-text('Overwrite'), .fp-dlg-butoverwrite
indikator file : .filemanager .fp-file, .filemanager .fp-filename
simpan         : #id_submitbutton   (atau button:has-text('Save changes'))
sukses         : teks "Submitted for grading" / .submissionstatussubmitted
```

Catatan: waktu target pada jalur browser harus dihitung dalam **WIB eksplisit** (bukan zona runner), dan runner GitHub (UTC, IP luar negeri) belum terbukti diterima server UNAIR.

## Lampiran B — Pemetaan istilah

| Istilah | Arti |
|---|---|
| cmid | Course module id; angka di `view.php?id=` dan `li#module-<cmid>` |
| draft area | Penampung file sementara milik user di Moodle (`user/draft/<itemid>`) |
| itemid | Id draft area; dipakai field `files_filemanager` |
| unlock | Waktu "Available from" pada availability restriction (server-side) |
| WIB | UTC+7 |

## Lampiran C — Risiko tersisa (jujur)

1. H2 (upload sebelum buka) belum terbukti; jika gagal, latensi submit lebih besar (upload setelah unlock) atau perlu jalur browser.
2. CPU 10 ms (H8) bisa ketat untuk parsing halaman besar.
3. Presisi alarm DO (H7) belum diukur; mitigasi: bangun lebih awal + `sleepUntil`.
4. Struktur Moodle UNAIR bisa berubah (tema/versi); fixture dan selector perlu diperbarui.
5. Aturan kampus soal otomasi belum diketahui; sistem dirancang menghormati kunci server dan batas polling, tetapi keputusan penggunaan ada pada pemilik.
6. Server UNAIR mungkin memblokir/menandai IP Cloudflare; baru terjawab di Fase 2.
