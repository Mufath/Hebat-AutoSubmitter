# Panduan Kustomisasi Tampilan Web UI (SubSecond)

Dokumen ini menjelaskan cara mudah memodifikasi tampilan, warna tema, logo, dan teks pada antarmuka web dashboard **SubSecond**.

---

## 1. Lokasi File UI

Seluruh antarmuka web berada di dalam folder `ui/` yang disajikan langsung oleh Cloudflare Worker:
- **`ui/index.html`** : Struktur komponen HTML (modal login, header, countdown, upload file, tabel log).
- **`ui/style.css`** : Pengaturan gaya visual, warna tema, tata letak responsif, dan dark mode.
- **`ui/app.js`** : Logika interaksi frontend, koneksi API, dan countdown timer.

---

## 2. Mengubah Warna Tema (CSS Variables)

Semua warna utama didefinisikan menggunakan CSS Variables di bagian teratas [`ui/style.css`](../ui/style.css#L2-L28). Anda cukup mengubah nilai hex warna di `:root`:

```css
:root {
  /* Warna Latar & Panel */
  --bg-color: #0f172a;          /* Latar belakang utama (Dark Mode) */
  --surface-color: #1e293b;     /* Warna kartu / panel */
  --surface-border: #334155;    /* Warna garis tepi / border */

  /* Warna Teks */
  --text-main: #f8fafc;         /* Warna teks utama */
  --text-muted: #94a3b8;        /* Warna teks redup / keterangan */

  /* Warna Aksen Tombol */
  --primary: #38bdf8;           /* Warna aksen utama (biru muda) */
  --primary-hover: #0284c7;     /* Warna saat tombol disorot kursor */
  --success: #10b981;           /* Warna tombol ARM / Sukses (hijau) */
  --danger: #ef4444;            /* Warna tombol DISARM / Batal (merah) */
}
```

---

## 3. Mengubah Teks & Nama Judul

Untuk mengubah teks judul aplikasi atau nama instansi:
1. Buka [`ui/index.html`](../ui/index.html).
2. Cari bagian `<div class="brand-header">` atau `<div class="nav-brand">`.
3. Ganti teks:
   - `<span class="brand-badge">UNAIR</span>` → Ganti badge kampus jika diinginkan.
   - `<h1>SubSecond</h1>` → Ganti dengan nama judul aplikasi pilihan Anda.
   - `⚡` (logo icon) → Ganti dengan emoji atau gambar `<img>` logo Anda.

---

## 4. Keamanan & Ketentuan UI
- **Tanpa Library Berat:** UI dirancang murni menggunakan HTML5, CSS3, dan Vanilla JS tanpa runtime framework (React/Vue/Tailwind) agar ukuran bundle sangat ringan (< 15 KB gzip) dan memuat seketika di koneksi seluler.
- **Tanpa Token Sensitif di LocalStorage:** Sesi login disimpan secara aman melalui cookie `HttpOnly` bertanda tangan HMAC sehingga aman dari serangan XSS.
