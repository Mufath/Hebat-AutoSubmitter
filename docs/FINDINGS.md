# Findings & Hypotheses Log

Catatan pengujian hipotesis (H1–H8) dan fakta terverifikasi sistem auto-submit Moodle UNAIR.

## Status Hipotesis

| Hipotesis | Deskripsi | Status | Bukti / Catatan |
|---|---|---|---|
| **H1** | Login via HTTP (`GET` logintoken + `POST` form urlencoded) menghasilkan cookie `MoodleSession`. | Belum teruji | Akan diuji pada Fase 0 Tahap 1. |
| **H2** | Upload draft sebelum tugas terbuka memakai konteks course (`ctx_id` = context course) via `repository_ajax.php?action=upload`. | Belum teruji | Akan diuji pada Fase 0 Tahap 4 (Kandidat K1-K4). |
| **H3** | Draft `itemid` baru bisa diciptakan tanpa membuka form edit (itemid acak 9-digit / web service). | Belum teruji | Akan diuji pada Fase 0 Tahap 4. |
| **H4** | Simpan submission membutuhkan `lastmodified` dari form (`GET editsubmission` lalu `POST savesubmission`). | Belum teruji | Akan diuji pada Fase 0 Tahap 6. |
| **H5** | Alternatif simpan submission via AJAX `mod_assign_save_submission`. | Belum teruji | Cadangan jika H4 tidak optimal. |
| **H6** | Di Workers, `Date.now()` hanya maju setelah I/O -> `sleepUntil` dengan `setTimeout`. | Belum teruji | Akan diverifikasi di Fase 2. |
| **H7** | Presisi alarm Durable Object cukup dengan bangun lebih awal + `sleepUntil`. | Belum teruji | Akan diverifikasi di Fase 2. |
| **H8** | Parsing form edit (~230 KB) muat dalam 10 ms CPU Workers. | Belum teruji | Akan diverifikasi di Fase 1 (benchmark) & Fase 2. |

## Fakta Terverifikasi Baru

| # | Fakta | Sumber |
|---|---|---|
| F9 | Course ID target: `10978` ("2026Ganjil - FST25605011 - Sistem Operasi (Praktikum)"), section `75330`. | Investigasi pemilik |
| F10 | Pola nama assignment target: `Pengumpulan Modul Prak Lab X` (contoh modul 10: cmid `101761`). | Investigasi pemilik |
| F11 | Moodle AJAX API `core_course_get_contents` (`POST /lib/ajax/service.php?sesskey=...`) dapat digunakan untuk discovery daftar assignment secara terstruktur. | Investigasi pemilik |

## Log Latensi Terukur (Fase 0)

*Akan diisi setelah eksekusi Fase 0.*
