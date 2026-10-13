# Findings & Hypotheses Log

Catatan pengujian hipotesis (H1–H8) dan fakta terverifikasi sistem auto-submit Moodle UNAIR.

## Status Hipotesis (Diperbarui Fase 0)

| Hipotesis | Deskripsi | Status | Bukti / Catatan |
|---|---|---|---|
| **H1** | Login via HTTP (`GET` logintoken + `POST` form urlencoded) menghasilkan cookie `MoodleSession`. | **TERBUKTI** | Sukses login via HTTP murni di Fase 0 Tahap 1. Mendapatkan `MoodleSession`, mengikuti redirect ke `testsession` -> `/my/`, dan mengekstrak `sesskey`. Latensi total: 2717 ms. |
| **H2** | Upload draft sebelum tugas terbuka memakai konteks course (`ctx_id` = context course) via `repository_ajax.php?action=upload`. | **TERBUKTI (K1)** | Kandidat K1 sukses! Upload dummy PDF menggunakan `ctx_id` = 288276 (course context) dan itemid acak 9-digit mengembalikan status 200 dengan metadata file tanpa error. Latensi: 166 ms. |
| **H3** | Draft `itemid` baru bisa diciptakan tanpa membuka form edit (itemid acak 9-digit). | **TERBUKTI** | ItemID acak 9 digit (`505205942`) langsung diterima oleh endpoint `repository_ajax.php` dan terkonfirmasi valid. |
| **H4** | Simpan submission membutuhkan `lastmodified` dari form (`GET editsubmission` lalu `POST savesubmission`). | **TERBUKTI** | Terverifikasi pada cmid `167430` (tugas terbuka): field `lastmodified` ada (nilai epoch `1791912170`) bersama hidden fields: `id`, `userid`, `action`, `sesskey`, `_qf__mod_assign_submission_form`, `mform_isexpanded_id_submissionheader`, `files_filemanager`. |
| **H5** | Alternatif simpan submission via AJAX `mod_assign_save_submission`. | **GUGUR / TIDAK TERSEDIA** | AJAX web service Moodle UNAIR memunculkan pesan error: `servicenotavailable` ("Web service is not available"). Sistem wajib memakai jalur form (H4). |
| **H6** | Di Workers, `Date.now()` hanya maju setelah I/O -> `sleepUntil` dengan `setTimeout`. | **TERVERIFIKASI (Desain)** | Polling dilakukan secara loop I/O jaringan nyata via `await mfetch`, sehingga runtime Workers memperbarui clock `Date.now()` di setiap siklus tanpa freeze clock. |
| **H7** | Presisi alarm Durable Object cukup dengan bangun lebih awal + `sleepUntil`. | **TERVERIFIKASI (Desain & Uji)** | Alur dua alarm diterapkan: Alarm A bangun pada T-10m untuk pre-upload draft, dan Alarm B bangun pada T-30s sebelum target unlock untuk presisi spin-polling (180ms). Deviasi alarm cloud diimbangi sepenuhnya oleh buffer 30 detik. |
| **H8** | Parsing form edit (~230 KB) muat dalam 10 ms CPU Workers. | **TERVERIFIKASI (Benchmark)** | Unit test benchmark mengeksekusi ekstraksi regex form edit 50 kali dalam waktu < 50 ms (rata-rata < 1 ms per parsing). CPU dipastikan sangat aman untuk batas 10 ms Workers. |

## Fakta Terverifikasi Baru

| # | Fakta | Sumber |
|---|---|---|
| F9 | Course ID target: `10978` ("2026Ganjil - FST25605011 - Sistem Operasi (Praktikum)"), Course Context ID: `288276`. | Uji Fase 0 |
| F10 | Assignment target terdeteksi: cmid `101761`, nama: `"Pengumpulan Modul Prak Lab 10 NDG Linux Essential  Assignment"`. | Uji Fase 0 |
| F11 | Moodle UNAIR membatasi AJAX external web services untuk mahasiswa (`errorcode: servicenotavailable`). Discovery dan submission tidak bisa mengandalkan web service JSON. | Uji Fase 0 Tahap 2 |
| F12 | Layout mata kuliah menggunakan format multi-section/section-page (`course/section.php?id=75330`). Pencarian modul mencakup fallback parsing halaman section. | Uji Fase 0 Tahap 2 |
| F13 | Perilaku kunci (F7) terbukti valid: akses `mod/assign/view.php?id=101761` me-redirect 303 ke `course/view.php?id=10978`. | Uji Fase 0 Tahap 3 |
| F14 | Form submission tugas terbuka (`167430`) memvalidasi struktur form F2 dengan `lastmodified` aktif. | Uji Fase 0 Tahap 6 |
| F15 | **LIVE SUBMISSION TERBUKTI SUKSES**: Submission nyata via HTTP murni pada cmid `167430` berhasil terverifikasi "Submitted for grading" dengan file `tugas_test_autosubmit.pdf` terlampir di Moodle. Durasi POST: 668 ms. | Uji Live Mandiri (14 Okt 2026) |
| F16 | **DEPLOYMENT PRODUCTION CLOUDFLARE SUKSES**: Worker berhasil online di `https://hebat-submitter.mufath04.workers.dev` lengkap dengan Durable Object SQLite singleton dan static assets UI. | Deploy Produksi (14 Okt 2026) |
| F17 | **IP CLOUDFLARE DITERIMA MOODLE UNAIR**: Request `/api/check` dari edge Cloudflare berhasil login dan mendeteksi modul di server `hebat.elearning.unair.ac.id` tanpa diblokir/CAPTCHA. Server offset terukur: `-43.5 ms`. | Uji Edge Cloudflare (14 Okt 2026) |

## Log Latensi Terukur (Koneksi Lokal ke Server UNAIR)

| Tahap | Operasi | Latensi Terukur | Catatan |
|---|---|---|---|
| 1 | Login HTTP Total | **2717 ms** | Termasuk GET login token, POST credentials, dan 2x redirect hop |
| 2 | Discover Assignment | **964 ms** | GET course/view.php + section.php |
| 3 | Check Lock Status | **556 ms** | GET view.php terkunci -> 303 redirect |
| 4 | Upload Draft (K1) | **166 ms** | POST repository_ajax.php (upload file PDF) |
| 6 | Fetch Edit Form | **449 ms** | GET view.php?action=editsubmission |
| **LIVE** | **POST savesubmission (Live)** | **668 ms** | Kirim submission nyata ke server UNAIR |
| **Total Estimasi Jam-H** | **Unlock -> Submit** | **≈ 1.0 – 1.3 detik** | Polling (180ms) + GET form (450ms) + POST submit (668ms) |
