export function renderMockMoodleHtml(baseUrl: string): string {
  return `<!DOCTYPE html>
<html lang="id">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Hebat Unair - Sandbox Testing Server</title>
  <style>
    :root {
      --unair-blue: #003366;
      --unair-yellow: #FFCC00;
      --moodle-bg: #F2F4F8;
      --card-bg: #FFFFFF;
      --text-dark: #212529;
      --text-muted: #6C757D;
      --border-color: #E2E8F0;
      --success: #28A745;
      --danger: #DC3545;
      --warning: #FFC107;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      background-color: var(--moodle-bg);
      color: var(--text-dark);
      line-height: 1.5;
    }
    header {
      background: linear-gradient(135deg, var(--unair-blue), #002244);
      color: #fff;
      padding: 12px 24px;
      display: flex;
      justify-content: space-between;
      align-items: center;
      box-shadow: 0 2px 8px rgba(0,0,0,0.15);
    }
    .header-brand {
      display: flex;
      align-items: center;
      gap: 12px;
    }
    .header-logo {
      background: var(--unair-yellow);
      color: var(--unair-blue);
      font-weight: 800;
      font-size: 16px;
      padding: 6px 12px;
      border-radius: 6px;
      letter-spacing: 0.5px;
    }
    .header-title {
      font-size: 16px;
      font-weight: 600;
    }
    .header-badge {
      background: rgba(255, 204, 0, 0.2);
      border: 1px solid var(--unair-yellow);
      color: var(--unair-yellow);
      font-size: 11px;
      padding: 4px 8px;
      border-radius: 4px;
      font-weight: 600;
      text-transform: uppercase;
    }
    .container {
      max-width: 1200px;
      margin: 24px auto;
      padding: 0 16px;
      display: grid;
      grid-template-columns: 1fr 380px;
      gap: 24px;
    }
    @media (max-width: 900px) {
      .container { grid-template-columns: 1fr; }
    }
    .breadcrumb {
      font-size: 13px;
      color: var(--text-muted);
      margin-bottom: 16px;
      grid-column: 1 / -1;
    }
    .card {
      background: var(--card-bg);
      border: 1px solid var(--border-color);
      border-radius: 8px;
      padding: 20px;
      margin-bottom: 20px;
      box-shadow: 0 1px 3px rgba(0,0,0,0.05);
    }
    .card-title {
      font-size: 16px;
      font-weight: 700;
      color: var(--unair-blue);
      margin-bottom: 16px;
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    .status-banner {
      padding: 16px;
      border-radius: 8px;
      margin-bottom: 20px;
      display: flex;
      align-items: center;
      gap: 14px;
    }
    .status-banner.locked {
      background: #FFF3CD;
      border: 1px solid #FFEEBA;
      color: #856404;
    }
    .status-banner.unlocked {
      background: #D4EDDA;
      border: 1px solid #C3E6CB;
      color: #155724;
    }
    .status-banner.submitted {
      background: #D1ECF1;
      border: 1px solid #BEE5EB;
      color: #0C5460;
    }
    .status-icon {
      font-size: 28px;
      flex-shrink: 0;
    }
    .status-content h3 {
      font-size: 15px;
      margin-bottom: 4px;
    }
    .status-content p {
      font-size: 13px;
    }
    .table-moodle {
      width: 100%;
      border-collapse: collapse;
      font-size: 13px;
    }
    .table-moodle th, .table-moodle td {
      padding: 10px 12px;
      border: 1px solid var(--border-color);
      text-align: left;
    }
    .table-moodle th {
      background: #F8FAFC;
      width: 200px;
      color: var(--text-muted);
      font-weight: 600;
    }
    .badge {
      display: inline-block;
      padding: 4px 8px;
      border-radius: 4px;
      font-size: 12px;
      font-weight: 600;
    }
    .badge-success { background: #D4EDDA; color: #155724; }
    .badge-warning { background: #FFF3CD; color: #856404; }
    .badge-danger { background: #F8D7DA; color: #721C24; }
    .badge-info { background: #D1ECF1; color: #0C5460; }

    /* Control Panel */
    .btn-group {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 8px;
      margin-bottom: 12px;
    }
    .btn {
      padding: 8px 12px;
      font-size: 12px;
      font-weight: 600;
      border-radius: 6px;
      border: none;
      cursor: pointer;
      transition: opacity 0.2s;
      text-align: center;
    }
    .btn:hover { opacity: 0.85; }
    .btn-primary { background: var(--unair-blue); color: #fff; }
    .btn-warning { background: var(--unair-yellow); color: #000; }
    .btn-danger { background: var(--danger); color: #fff; }
    .btn-secondary { background: #E2E8F0; color: #334155; }
    .btn-block { grid-column: 1 / -1; }

    /* Log Console */
    .log-box {
      background: #1E293B;
      color: #E2E8F0;
      font-family: monospace;
      font-size: 11px;
      padding: 12px;
      border-radius: 6px;
      height: 380px;
      overflow-y: auto;
    }
    .log-entry {
      margin-bottom: 6px;
      padding-bottom: 6px;
      border-bottom: 1px solid #334155;
      display: flex;
      gap: 8px;
    }
    .log-time { color: #94A3B8; }
    .log-method { font-weight: bold; color: #38BDF8; }
    .log-status-200 { color: #4ADE80; font-weight: bold; }
    .log-status-303 { color: #FACC15; font-weight: bold; }
    .log-status-403 { color: #F87171; font-weight: bold; }
    .log-note { color: #CBD5E1; word-break: break-all; }
  </style>
</head>
<body>

  <header>
    <div class="header-brand">
      <div class="header-logo">UNAIR</div>
      <div>
        <div class="header-title">HEBAT E-Learning UNAIR (Mock Sandbox)</div>
      </div>
    </div>
    <div class="header-badge">Simulasi Realistis</div>
  </header>

  <div class="container">
    <div class="breadcrumb">
      Beranda / Kursus Saya / <b>10978 - Sistem Operasi Praktikum</b> / Week 8 / <b>Pengumpulan Modul Prak Lab 8 NDG Linux Essential</b>
    </div>

    <!-- MAIN COLUMN: Assignment View -->
    <main>
      <div class="card">
        <h2 style="font-size: 20px; color: var(--unair-blue); margin-bottom: 8px;">
          Pengumpulan Modul Prak Lab 8 NDG Linux Essential
        </h2>
        <p style="font-size: 13px; color: var(--text-muted); margin-bottom: 20px;">
          Unggah laporan modul praktikum dalam format .pdf sebelum batas waktu berakhir.
        </p>

        <!-- DYNAMIC STATUS BANNER -->
        <div id="status-banner" class="status-banner locked">
          <div class="status-icon" id="status-icon">🔒</div>
          <div class="status-content">
            <h3 id="status-title">Pembatasan Akses: Tugas Terkunci</h3>
            <p id="status-desc">Tidak tersedia kecuali: Tersedia mulai <b id="unlock-time-text">--:--:-- WIB</b> (<span id="countdown-text">--</span>)</p>
          </div>
        </div>

        <!-- GRADING STATUS TABLE -->
        <h3 style="font-size: 15px; margin-bottom: 12px; color: var(--text-dark);">Status Pengumpulan</h3>
        <table class="table-moodle">
          <tbody>
            <tr>
              <th>Status Pengumpulan</th>
              <td id="row-submission-status"><span class="badge badge-warning">Tidak ada upaya</span></td>
            </tr>
            <tr>
              <th>Status Penilaian</th>
              <td id="row-grading-status">Belum dinilai</td>
            </tr>
            <tr>
              <th>Waktu Buka Tugas</th>
              <td id="row-open-time">--</td>
            </tr>
            <tr>
              <th>Batas Waktu Akhir</th>
              <td>Kamis, 23:59 WIB</td>
            </tr>
            <tr>
              <th>Waktu Diterima</th>
              <td id="row-submit-time">-</td>
            </tr>
            <tr>
              <th>Pengiriman Berkas</th>
              <td id="row-file-submission">-</td>
            </tr>
            <tr>
              <th>Latensi Eksekusi</th>
              <td id="row-latency">-</td>
            </tr>
          </tbody>
        </table>
      </div>

      <!-- REPOSITORY DRAFT AREA PREVIEW -->
      <div class="card">
        <div class="card-title">
          <span>Memori Draft Area (Candidate K1 Pre-Upload)</span>
          <span class="badge badge-info" id="draft-count">0 File</span>
        </div>
        <p style="font-size: 12px; color: var(--text-muted); margin-bottom: 12px;">
          Hebat Unair mengizinkan pre-upload ke draft repository via <code>repository_ajax.php?action=upload</code> bahkan saat tugas masih terkunci.
        </p>
        <div id="draft-list" style="font-size: 13px; color: var(--text-muted);">
          Belum ada draft file yang diunggah oleh bot.
        </div>
      </div>
    </main>

    <!-- SIDEBAR: TESTING CONTROLS & TRAFFIC INSPECTOR -->
    <aside>
      <div class="card">
        <div class="card-title">
          <span>Kontrol Sandbox</span>
          <span class="badge badge-warning" id="lag-badge">Normal (0ms)</span>
        </div>
        <div class="btn-group">
          <button class="btn btn-warning" onclick="setUnlockIn(120)">⏱️ Buka 2 Menit</button>
          <button class="btn btn-secondary" onclick="setUnlockIn(60)">⏱️ Buka 1 Menit</button>
          <button class="btn btn-primary" onclick="setUnlockIn(0)">🔓 Buka Sekarang</button>
          <button class="btn btn-danger" onclick="setUnlockIn(-999999)">🔒 Kunci Sekarang</button>
          <button class="btn btn-secondary btn-block" onclick="toggleLag()">🐢 Toggle Lag (+500ms Delay)</button>
          <button class="btn btn-danger btn-block" onclick="resetState()">🧹 Reset Semua Data</button>
        </div>
        <div style="font-size: 11px; color: var(--text-muted); margin-top: 8px;">
          URL Base Mock untuk SubSecond:<br>
          <code style="color: var(--unair-blue); font-weight: bold;" id="mock-url-code">${baseUrl}</code>
        </div>
      </div>

      <div class="card">
        <div class="card-title">
          <span>Live Traffic Inspector</span>
          <button class="btn btn-secondary" style="font-size: 10px; padding: 2px 6px;" onclick="loadState()">Refresh</button>
        </div>
        <div class="log-box" id="log-box">
          <div style="color: #64748B;">Menunggu koneksi dari SubSecond...</div>
        </div>
      </div>
    </aside>
  </div>

  <script>
    let appState = null;

    async function loadState() {
      try {
        const res = await fetch('/mock-api/state');
        const state = await res.json();
        appState = state;
        renderState(state);
      } catch (e) {
        console.error('Failed to load state', e);
      }
    }

    function renderState(state) {
      const now = Date.now();
      const isLocked = now < state.unlockTimestampMs;
      const banner = document.getElementById('status-banner');
      const icon = document.getElementById('status-icon');
      const title = document.getElementById('status-title');
      const desc = document.getElementById('status-desc');
      const unlockText = document.getElementById('unlock-time-text');
      const openTimeRow = document.getElementById('row-open-time');

      const unlockDate = new Date(state.unlockTimestampMs);
      const timeStr = unlockDate.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
      unlockText.textContent = timeStr + ' WIB';
      openTimeRow.textContent = unlockDate.toLocaleString('id-ID');

      // Lag badge
      document.getElementById('lag-badge').textContent = state.lagMs > 0 ? \`Lag +\${state.lagMs}ms\` : 'Normal (0ms)';
      document.getElementById('lag-badge').className = state.lagMs > 0 ? 'badge badge-danger' : 'badge badge-warning';

      // Has submission?
      const sub = state.submissions && state.submissions.length > 0 ? state.submissions[state.submissions.length - 1] : null;

      if (sub) {
        banner.className = 'status-banner submitted';
        icon.textContent = '✅';
        title.textContent = 'Tugas Berhasil Dikumpulkan!';
        desc.textContent = \`Diterima di server Hebat Unair pada \${new Date(sub.submittedAt).toLocaleTimeString('id-ID')}.\`;

        document.getElementById('row-submission-status').innerHTML = '<span class="badge badge-success">Diserahkan untuk dinilai (Submitted for grading)</span>';
        document.getElementById('row-submit-time').textContent = new Date(sub.submittedAt).toLocaleString('id-ID') + ' (' + sub.submittedAt + ')';
        document.getElementById('row-file-submission').innerHTML = \`📄 <b>\${sub.fileName}</b> (\${Math.round(sub.size / 1024)} KB) <a href="/mock-api/download-file?id=\${sub.draftItemId}" target="_blank" style="margin-left: 8px; color: #003366; text-decoration: underline;">Unduh Berkas</a>\`;
        document.getElementById('row-latency').innerHTML = \`<span class="badge badge-success">+\${sub.timeFromUnlockMs} ms dari jam buka</span>\`;
      } else if (isLocked) {
        banner.className = 'status-banner locked';
        icon.textContent = '🔒';
        title.textContent = 'Pembatasan Akses: Tugas Masih Terkunci';
        const remainingSec = Math.max(0, Math.floor((state.unlockTimestampMs - now) / 1000));
        desc.innerHTML = \`Tidak tersedia sebelum: <b>\${timeStr} WIB</b> (<span id="countdown-text">\${remainingSec} detik lagi</span>)\`;

        document.getElementById('row-submission-status').innerHTML = '<span class="badge badge-warning">Tidak ada upaya</span>';
        document.getElementById('row-submit-time').textContent = '-';
        document.getElementById('row-file-submission').textContent = '-';
        document.getElementById('row-latency').textContent = '-';
      } else {
        banner.className = 'status-banner unlocked';
        icon.textContent = '🔓';
        title.textContent = 'Tugas Terbuka untuk Pengumpulan';
        desc.textContent = 'Pintu pengumpulan sudah dibuka! Sistem siap menerima payload submit.';

        document.getElementById('row-submission-status').innerHTML = '<span class="badge badge-info">Siap Dikumpulkan</span>';
        document.getElementById('row-submit-time').textContent = '-';
        document.getElementById('row-file-submission').textContent = '-';
        document.getElementById('row-latency').textContent = '-';
      }

      // Drafts
      const draftList = document.getElementById('draft-list');
      document.getElementById('draft-count').textContent = \`\${state.drafts.length} File\`;
      if (state.drafts.length > 0) {
        draftList.innerHTML = state.drafts.map(d => \`
          <div style="padding: 6px 0; border-bottom: 1px solid #EEE;">
            📦 <b>\${d.fileName}</b> (\${Math.round(d.size/1024)} KB) — Draft ItemID: <code>\${d.itemId}</code>
            <br><span style="font-size: 11px; color: #64748B;">Diunggah: \${new Date(d.createdAt).toLocaleTimeString('id-ID')}</span>
          </div>
        \`).join('');
      } else {
        draftList.textContent = 'Belum ada draft file yang diunggah oleh bot.';
      }

      // Logs
      const logBox = document.getElementById('log-box');
      if (state.trafficLogs && state.trafficLogs.length > 0) {
        logBox.innerHTML = state.trafficLogs.slice().reverse().map(l => {
          const t = new Date(l.timestamp).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', second: '2-digit', fractionalSecondDigits: 3 });
          const statusCls = l.status === 200 ? 'log-status-200' : l.status === 303 ? 'log-status-303' : 'log-status-403';
          return \`
            <div class="log-entry">
              <span class="log-time">\${t}</span>
              <span class="log-method">\${l.method}</span>
              <span class="\${statusCls}">\${l.status}</span>
              <span class="log-note">\${l.path} \${l.note ? '— ' + l.note : ''} (\${l.elapsedMs}ms)</span>
            </div>
          \`;
        }).join('');
      }
    }

    async function setUnlockIn(seconds) {
      await fetch('/mock-api/set-unlock', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ seconds })
      });
      loadState();
    }

    async function toggleLag() {
      const newLag = appState && appState.lagMs > 0 ? 0 : 500;
      await fetch('/mock-api/set-lag', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lagMs: newLag })
      });
      loadState();
    }

    async function resetState() {
      if (!confirm('Reset semua data mock submission dan draft?')) return;
      await fetch('/mock-api/reset', { method: 'POST' });
      loadState();
    }

    // Auto-refresh state every 1.5 seconds
    loadState();
    setInterval(loadState, 1500);
  </script>
</body>
</html>
`;
}
