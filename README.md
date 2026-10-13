# KumpulTepat (hebat-submitter) ⚡

Sistem auto-submit pengumpulan tugas Moodle UNAIR (`hebat.elearning.unair.ac.id`) berbasis **serverless zero-browser** di Cloudflare Workers. Dirancang khusus untuk memenangkan jendela pengumpulan tugas mingguan (Rabu 07:00:00 WIB) dengan presisi sub-detik, efisiensi maksimal, dan keamanan terisolasi.

UI dirancang dengan estetika minimalis Apple-native, responsif untuk ponsel/desktop, dan dilengkapi latar belakang interaktif *WebGL Fluid Flow Canvas (60 FPS)*.

---

## 🌟 Fitur Utama

- **Zero-Browser Headless Engine:** 100% menggunakan HTTP native protocol (`fetch`), tanpa Chromium/Playwright yang boros RAM dan lambat dibuka.
- **Pre-Unlock Draft Upload:** Berkas PDF diunggah ke draft area Moodle 10 menit sebelum tugas dibuka (*T-10m*). Saat jam 07:00:00 WIB tiba, sistem tinggal menautkan ID draft dalam hitungan milidetik!
- **Latensi Sub-Detik:** Waktu submit live teruji hanya **668 ms** dari deteksi tugas terbuka hingga status *"Submitted for grading"*.
- **100% Bebas Biaya (Cloudflare Free Tier):** Berjalan di Cloudflare Workers Free (CPU < 10 ms per eksekusi, Durable Object SQLite singleton, subrequest ≤ 50).
- **Keamanan Terisolasi:** Setiap pengguna memiliki instance worker mandiri. Tidak ada server terpusat, tidak ada database pihak ketiga. Password dan cookie tidak pernah dicatat dalam log.
- **Notifikasi Telegram Otomatis:** Pemberitahuan berkala saat persiapan draft berhasil dan saat tugas selesai dikumpulkan beserta nama berkas.

---

## 🚀 Panduan Deploy Mandiri (Setup ≤ 15 Menit)

Setiap mahasiswa menjalankan instance Cloudflare sendiri untuk menjamin keamanan kredensial masing-masing.

### 1. Prasyarat
- [Node.js](https://nodejs.org/) versi ≥ 20.x
- Akun Cloudflare gratis di [cloudflare.com](https://dash.cloudflare.com/sign-up)
- Akun bot Telegram via [@BotFather](https://t.me/BotFather) (opsional, untuk notifikasi ke HP)

### 2. Kloning & Instalasi
```bash
git clone https://github.com/mufath04/hebat-submitter.git
cd hebat-submitter
npm install
```

### 3. Login ke Cloudflare Wrangler
```bash
npx wrangler login
```
*Browser akan terbuka untuk mengonfirmasi otorisasi akun Cloudflare Anda.*

### 4. Konfigurasi Rahasia (*Secrets*)
Salin template konfigurasi lokal:
```bash
cp .dev.vars.example .dev.vars
```

Isi variabel pada file `.dev.vars` (file ini otomatis diabaikan oleh `.gitignore`):
```ini
MOODLE_USER=NIM_ANDA
MOODLE_PASS=PASSWORD_CYBERCAMPUS_ANDA
APP_PASSWORD=PASSWORD_DASHBOARD_PILIHAN_ANDA
SESSION_HMAC_KEY=KUNCI_ACAK_MINIMAL_32_KARAKTER
TELEGRAM_BOT_TOKEN=TOKEN_BOT_TELEGRAM_DARI_BOTFATHER
TELEGRAM_CHAT_ID=ID_CHAT_TELEGRAM_ANDA
```

Deploy semua kredensial ke Cloudflare Workers dengan satu perintah:
```bash
node scripts/deploy_secrets.mjs
```

### 5. Deploy ke Cloudflare Workers
```bash
npx wrangler deploy
```

Setelah proses selesai, terminal akan menampilkan URL dashboard Anda:
```text
Deployed hebat-submitter triggers
  https://hebat-submitter.<subdomain-anda>.workers.dev
```

Buka URL tersebut di browser ponsel atau laptop, masukkan `APP_PASSWORD` Anda, dan sistem siap digunakan!

---

## 📱 Panduan Penggunaan Mingguan

1. **Selasa Malam (H-1):**
   - Buka URL dashboard KumpulTepat Anda.
   - Buka tab **Berkas** -> Unggah laporan praktikum dalam format `.pdf`.
   - Buka tab **Pengaturan** -> Pastikan nama modul sesuai dengan target minggu ini (misal: `Pengumpulan Modul Prak Lab 10`).
   - Buka tab **Beranda** -> Tekan tombol **Cek Tugas (Check)** untuk memastikan modul terdeteksi.
   - Tekan tombol **ARM SISTEM** (tombol akan berubah hijau dan status menjadi *Sistem Siap*).

2. **Rabu Pagi (Hari-H):**
   - Anda tidak perlu membuka laptop saat jam 07:00:00 WIB.
   - Pada pukul **06:50 WIB**, sistem secara otomatis bangun dan menyiapkan draft di server Moodle.
   - Pada pukul **07:00:00 WIB**, sistem melakukan polling kilat dan mengumpulkan tugas dalam < 1 detik.
   - Notifikasi sukses akan langsung dikirimkan ke Telegram Anda.

---

## 📂 Struktur Direktori

```text
├── src/
│   ├── moodle/             # Pustaka interaksi HTTP Moodle murni
│   │   ├── http.ts         # CookieJar & Budgeted fetch (anti subrequest leak)
│   │   ├── login.ts        # Alur login Moodle & ekstraksi sesskey
│   │   ├── discover.ts     # Scraper modul assignment & parsing availability
│   │   ├── upload.ts       # Pre-unlock draft file uploader
│   │   ├── submit.ts       # Ekstraksi form editsubmission & savesubmission
│   │   ├── parse.ts        # Parser HTML murni berbasis regex
│   │   └── types.ts        # Definisi antarmuka TypeScript
│   ├── index.ts            # Entrypoint Cloudflare Workers, Router & Auth HMAC
│   ├── job.ts              # Durable Object state machine & alarm runner
│   ├── notify.ts           # Integrasi notifikasi Telegram
│   ├── time.ts             # Parser waktu & sinkronisasi offset server Moodle
│   └── log.ts              # Logger terstruktur dengan redaksi rahasia otomatis
├── ui/                     # Apple-Native Minimalist Web Dashboard
│   ├── index.html          # Markup HTML antarmuka KumpulTepat
│   ├── style.css           # Token desain Apple, responsif ponsel/desktop
│   └── app.js              # Kontroler WebGL Fluid Flow (60FPS) & API dashboard
├── tests/                  # Unit test Vitest dengan fixture tersanitasi
├── scripts/                # Utilitas CLI & script deploy rahasia
├── docs/                   # Dokumentasi teknis & operasional
│   ├── FINDINGS.md         # Catatan pembuktian empiris hipotesis (H1–H8)
│   ├── RUNBOOK.md          # Prosedur operasional H-1, hari-H, dan darurat
│   └── UI_CUSTOMIZE.md     # Panduan kustomisasi tampilan & tema UI
└── wrangler.jsonc          # Konfigurasi Cloudflare Workers & Durable Objects
```

---

## 🧪 Pengujian Unit & Verifikasi

Jalankan test suite Vitest untuk memastikan parsing form dan modul berjalan sempurna:
```bash
npm test
```

Semua pengujian menggunakan fixture HTML yang telah disanitasi penuh (tanpa kredensial/rahasia).

---

## ⚖️ Lisensi & Tanggung Jawab

Perangkat lunak ini dikembangkan untuk tujuan edukasi teknik otomasi sistem web dan analisis performa HTTP. Pengguna bertanggung jawab penuh atas integritas akademik dan kepatuhan terhadap regulasi institusi masing-masing.
