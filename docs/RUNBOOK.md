# Runbook Operasional: SubSecond (Hebat Unair Auto-Submit)

Panduan operasional resmi untuk mahasiswa dalam mengoperasikan sistem otomasi pengumpulan tugas Hebat Unair (`hebat.elearning.unair.ac.id`) secara andal, aman, dan tepat waktu pada jendela submission Rabu pukul 07:00:00 WIB.

---

## 1. Akses Dashboard
- **URL Dashboard Produksi:** `https://hebat-submitter.mufath04.workers.dev`
- **Autentikasi:** Masukkan NIM dan Password Cybercampus / Hebat Unair Anda pada layar masuk. Sesi login tersimpan aman via cookie HTTP-only berdurasi 12 jam.

---

## 2. Prosedur H-1 (Selasa Sore / Malam)

Lakukan langkah persiapan berikut sebelum pukul 23:00 WIB pada hari Selasa:

### Langkah 2.1: Unggah Berkas PDF Tugas
1. Buka Dashboard, navigasikan ke tab **Berkas**.
2. Seret dan lepas (*drag-and-drop*) file laporan tugas praktikum berformat `.pdf` ke area unggah (atau klik untuk memilih file).
3. Pastikan notifikasi sukses muncul dan berkas terdata:
   - Nama berkas (contoh: `Modul10_Praktikum_SistemOperasi.pdf`)
   - Ukuran berkas (maksimal 10 MB)
   - SHA-256 fingerprint tercatat.

### Langkah 2.2: Verifikasi & Sesuaikan Pengaturan Modul
1. Buka tab **Pengaturan**.
2. Periksa parameter:
   - **Course ID:** Standar `10978` (Sistem Operasi Praktikum).
   - **Pola Nama Tugas:** Contoh `Pengumpulan Modul Prak Lab 10` atau sesuaikan dengan judul modul minggu berjalan.
   - **Mode Aman (DRY_RUN):** Pastikan dinonaktifkan (`false`) jika ingin tugas benar-benar dikumpulkan ke Hebat Unair, atau centang `true` jika ingin uji coba tanpa mutasi.
3. Klik **Simpan Pengaturan**.

### Langkah 2.3: Uji Koneksi & Availability Target
1. Kembali ke tab **Beranda**.
2. Klik tombol **Cek Tugas (Check)**.
3. Periksa status yang terdeteksi:
   - Nama modul assignment berhasil ditemukan.
   - Status: **Terkunci** (*Available from Rabu, 07:00 AM*).
   - Selisih jam server terukur via *Second-Boundary Detection*.

### Langkah 2.4: Aktifkan Sistem (ARM)
1. Klik tombol **Jadwalkan Tugas** di tab Beranda.
2. Status indikator di kanan atas akan berubah menjadi **Terjadwal (ARMED)** dengan titik hijau.
3. Countdown akan menghitung mundur ke jam 07:00:00 WIB hari Rabu.

### Langkah 2.5: Uji Notifikasi Telegram
1. Buka tab **Pengaturan**.
2. Klik tombol **Uji Kirim Telegram**.
3. Pastikan bot mengirimkan pesan *"SubSecond Test: Koneksi bot Telegram berhasil terhubung ke akun Anda!"* ke ponsel Anda.

---

## 3. Prosedur Hari-H (Rabu Pagi 06:45 – 07:05 WIB)

Sistem berjalan sepenuhnya tanpa-server (*zero-browser headless worker*) di edge Cloudflare. Anda tidak wajib membuka laptop, namun disarankan memantau status via ponsel:

| Waktu | Peristiwa Otomatis | Apa yang Harus Diperhatikan |
|---|---|---|
| **06:50 WIB** (T-10m) | **Alarm A Terpicu (Persiapan / Pre-upload)** | Cloudflare Worker login ke Hebat Unair, menghitung clock skew, dan mengunggah draft PDF ke course context (`ctx_id`). Status berubah menjadi `PREPARED`. |
| **06:59:30 WIB** (T-30s) | **Alarm B Terpicu (Standby Polling + TCP Warm-Up)** | Durable Object aktif, mengkalibrasi ulang offset detik server, melakukan *TCP/TLS Warm-Up* di T-1.5s, dan memulai *Two-Gear Polling* (15 ms di zona kritis). Status: `POLLING`. |
| **07:00:00 WIB** (T-0) | **Eksekusi Pengumpulan Kilat** | Server UNAIR membuka kunci availability. Polling mendeteksi HTTP 200 + mengekstrak form edit (`lastmodified`) sekaligus -> mengirim POST final -> memverifikasi *"Submitted for grading"*. Status: `DONE`. |
| **07:00:01 WIB** | **Notifikasi Selesai** | Bot Telegram mengirimkan alert sukses lengkap dengan durasi kirim murni (`POST`) dan total siklus. |

---

## 4. Prosedur Darurat & Kontinjensi (Jika Terjadi Kendala)

### 4.1 Deteksi Masalah
Kondisi darurat terjadi jika:
- Status di dashboard berubah menjadi **FAILED** atau **DISARMED**.
- Muncul notifikasi Telegram peringatan error.
- Hingga pukul **07:00:15 WIB**, status belum berubah menjadi `DONE` / `Submitted for grading`.

### 4.2 Langkah Submit Manual (Fallback Cepat)
1. Buka browser di laptop atau HP.
2. Akses langsung: `https://hebat.elearning.unair.ac.id/mod/assign/view.php?id=<CMID>`
3. Klik **Add submission**.
4. Tarik file PDF yang telah Anda siapkan di lokal.
5. Klik **Save changes**.
6. Konfirmasi bahwa halaman menampilkan *"Submitted for grading"*.

### 4.3 Investigasi & Diagnosis
1. Buka tab **Log** pada dashboard SubSecond.
2. Teliti entri log dengan level `[ERROR]` atau `[WARN]`:
   - `LOGIN_FAILED`: Kredensial Hebat Unair salah atau password akun UNAIR kedaluwarsa.
   - `ASSIGNMENT_NOT_FOUND`: Nama tugas di pengaturan tidak cocok dengan judul di Hebat Unair. Periksa apakah dosen menggunakan format penamaan berbeda.
   - `SUBREQUEST_BUDGET`: Batas 50 subrequest tercapai (biasanya karena redirection berlebih).
   - `LOCK_TIMEOUT`: Server UNAIR terlambat membuka assignment melewati batas polling 120 detik.

---

## 5. Prosedur Rotasi & Pembaruan Rahasia (*Secrets*)

Jika Anda mengganti password Cybercampus/Moodle, atau mengganti token bot Telegram, perbarui secret Cloudflare tanpa perlu mengubah kode:

Jalankan perintah berikut di terminal:

```powershell
# Ganti password Moodle UNAIR
npx wrangler secret put MOODLE_PASS

# Ganti username/NIM Moodle
npx wrangler secret put MOODLE_USER

# Ganti password login dashboard SubSecond
npx wrangler secret put APP_PASSWORD

# Ganti bot token Telegram
npx wrangler secret put TELEGRAM_BOT_TOKEN

# Ganti Chat ID Telegram
npx wrangler secret put TELEGRAM_CHAT_ID
```

Atau gunakan skrip otomatis yang tersedia:
```powershell
node scripts/deploy_secrets.mjs
```
