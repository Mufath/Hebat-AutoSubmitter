/**
 * ui/app.js
 * Controller for Hebat_Submitter Apple-Native UI with 60FPS WebGL Fluid Flow Canvas.
 */

// ----------------------------------------------------------------------------
// 1. WebGL Fluid Flow Shader (60FPS)
// ----------------------------------------------------------------------------
(function initWebGLFlow() {
  const canvas = document.getElementById('flow-canvas');
  if (!canvas) return;

  const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  let gl = canvas.getContext('webgl', { 
    alpha: false, 
    antialias: false,
    powerPreference: "high-performance",
    preserveDrawingBuffer: false,
    depth: false
  });

  if (gl) {
    const vsSource = `
      attribute vec2 position;
      void main() {
        gl_Position = vec4(position, 0.0, 1.0);
      }
    `;

    const fsSource = `
      precision highp float;
      uniform float u_time;
      uniform vec2 u_resolution;

      const vec3 cLagoon     = vec3(0.451, 0.647, 0.820);
      const vec3 cLapis      = vec3(0.118, 0.314, 0.635);
      const vec3 cWhiteGrey  = vec3(0.863, 0.867, 0.867);
      const vec3 cSky        = vec3(0.627, 0.847, 0.937);
      const vec3 cUltramarine= vec3(0.298, 0.424, 0.702);

      void main() {
        vec2 uv = gl_FragCoord.xy / u_resolution.xy;
        float t = u_time * 0.12;

        float wave1 = sin(uv.x * 2.1 + t * 0.8 + uv.y * 1.5) * 0.5 + 0.5;
        float wave2 = cos(uv.y * 2.3 - t * 0.6 + uv.x * 1.7) * 0.5 + 0.5;
        float wave3 = sin((uv.x + uv.y) * 1.8 + t * 0.5) * 0.5 + 0.5;

        vec3 layer1 = mix(cLagoon, cLapis, wave1);
        vec3 layer2 = mix(cSky, cUltramarine, wave2);
        vec3 baseBlend = mix(layer1, layer2, uv.y * 0.8 + wave3 * 0.2);

        float highlight = smoothstep(0.35, 0.95, sin(uv.x * 1.5 - uv.y * 1.2 + t * 0.4) * 0.5 + 0.5);
        vec3 finalColor = mix(baseBlend, cWhiteGrey, highlight * 0.18);

        gl_FragColor = vec4(finalColor, 1.0);
      }
    `;

    function createShader(gl, type, src) {
      const s = gl.createShader(type);
      gl.shaderSource(s, src);
      gl.compileShader(s);
      return s;
    }

    const vs = createShader(gl, gl.VERTEX_SHADER, vsSource);
    const fs = createShader(gl, gl.FRAGMENT_SHADER, fsSource);
    const prog = gl.createProgram();
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.linkProgram(prog);

    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]),
      gl.STATIC_DRAW
    );

    const posLoc = gl.getAttribLocation(prog, 'position');
    const timeLoc = gl.getUniformLocation(prog, 'u_time');
    const resLoc = gl.getUniformLocation(prog, 'u_resolution');

    gl.useProgram(prog);
    gl.enableVertexAttribArray(posLoc);
    gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 0, 0);

    function resize() {
      const scale = 0.5;
      const w = Math.max(320, Math.floor(window.innerWidth * scale));
      const h = Math.max(320, Math.floor(window.innerHeight * scale));
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
        gl.viewport(0, 0, w, h);
        gl.uniform2f(resLoc, w, h);
      }
    }

    window.addEventListener('resize', resize, { passive: true });
    resize();

    let startTime = performance.now();
    function renderLoop(now) {
      const elapsed = (now - startTime) * 0.001;
      gl.uniform1f(timeLoc, prefersReducedMotion ? 1.0 : elapsed);
      gl.drawArrays(gl.TRIANGLES, 0, 6);

      if (!prefersReducedMotion) {
        requestAnimationFrame(renderLoop);
      }
    }

    requestAnimationFrame(renderLoop);
  } else {
    // 2D Fallback
    const ctx = canvas.getContext('2d');
    if (ctx) {
      function drawFallback() {
        const w = (canvas.width = window.innerWidth);
        const h = (canvas.height = window.innerHeight);
        const grad = ctx.createLinearGradient(0, 0, w, h);
        grad.addColorStop(0, '#73A5D1');
        grad.addColorStop(0.35, '#1E50A2');
        grad.addColorStop(0.65, '#DCDDDD');
        grad.addColorStop(0.85, '#A0D8EF');
        grad.addColorStop(1, '#4C6CB3');
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, w, h);
      }
      window.addEventListener('resize', drawFallback, { passive: true });
      drawFallback();
    }
  }
})();

// ----------------------------------------------------------------------------
// 2. Client Controller & API Integration
// ----------------------------------------------------------------------------

let appState = null;
let countdownInterval = null;

// DOM Elements
const loginModal = document.getElementById('login-modal');
const appContainer = document.getElementById('app-container');
const loginForm = document.getElementById('login-form');
const loginError = document.getElementById('login-error');
const appPasswordInput = document.getElementById('app-password');
const btnLogout = document.getElementById('btn-logout');

const statusDot = document.getElementById('status-dot');
const statusText = document.getElementById('status-text');

const leadTitle = document.getElementById('lead-title');
const leadSubtitle = document.getElementById('lead-subtitle');
const countdownTimer = document.getElementById('countdown-timer');
const countdownBadgeText = document.getElementById('countdown-badge-text');
const countdownSubtext = document.getElementById('countdown-subtext');

const rowFileName = document.getElementById('row-file-name');
const rowFileIcon = document.getElementById('row-file-icon');
const rowSessionStatus = document.getElementById('row-session-status');
const rowSessionIcon = document.getElementById('row-session-icon');
const rowAssignName = document.getElementById('row-assign-name');
const rowAssignIcon = document.getElementById('row-assign-icon');
const rowDraftItem = document.getElementById('row-draft-item');
const rowDraftIcon = document.getElementById('row-draft-icon');

const btnMainAction = document.getElementById('btn-main-action');
const actionCheckRow = document.getElementById('action-check-row');
const rowCheckMeta = document.getElementById('row-check-meta');
const actionPrepareRow = document.getElementById('action-prepare-row');
const rowPrepareMeta = document.getElementById('row-prepare-meta');
const actionSubmitNowRow = document.getElementById('action-submit-now-row');
const rowSubmitNowMeta = document.getElementById('row-submit-now-meta');

const rowLastStatus = document.getElementById('row-last-status');
const rowLastTime = document.getElementById('row-last-time');
const rowLastFile = document.getElementById('row-last-file');

// Files Tab
const dropzone = document.getElementById('dropzone');
const fileInput = document.getElementById('file-input');
const fileCardDetails = document.getElementById('file-card-details');
const activeFileName = document.getElementById('active-file-name');
const activeFileSize = document.getElementById('active-file-size');
const btnDeleteFile = document.getElementById('btn-delete-file');

// Config Tab
const configForm = document.getElementById('config-form');
const cfgCourseId = document.getElementById('cfg-course-id');
const cfgAssignName = document.getElementById('cfg-assign-name');
const cfgUnlockOverride = document.getElementById('cfg-unlock-override');
const cfgAutoWeekly = document.getElementById('cfg-auto-weekly');
const cfgDryRun = document.getElementById('cfg-dry-run');
const btnTestTelegram = document.getElementById('btn-test-telegram');

// Logs Tab
const logsList = document.getElementById('logs-list');

// ----------------------------------------------------------------------------
// API Fetch Helper
// ----------------------------------------------------------------------------

async function apiRequest(endpoint, method = 'GET', body = null) {
  const headers = { 'X-Requested-With': 'fetch' };
  if (body && !(body instanceof FormData)) {
    headers['Content-Type'] = 'application/json';
  }

  const res = await fetch(endpoint, {
    method,
    headers,
    body: body instanceof FormData ? body : body ? JSON.stringify(body) : undefined,
  });

  if (res.status === 401) {
    showLogin();
    throw new Error('Sesi tidak valid / belum login');
  }

  return res.json();
}

function showLogin() {
  loginModal.classList.remove('hidden');
}

function showApp() {
  loginModal.classList.add('hidden');
}

// ----------------------------------------------------------------------------
// Tabs Navigation
// ----------------------------------------------------------------------------

function switchTab(tabId) {
  // Update desktop buttons
  document.querySelectorAll('.seg-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.tab === tabId);
  });
  // Update mobile buttons
  document.querySelectorAll('.tab-item').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.tab === tabId);
  });
  // Update panels
  document.querySelectorAll('.tab-panel').forEach(panel => {
    if (panel.id === tabId) {
      panel.classList.remove('hidden');
      panel.classList.add('active');
    } else {
      panel.classList.add('hidden');
      panel.classList.remove('active');
    }
  });

  if (tabId === 'tab-log') {
    refreshLogs();
  }
}

document.querySelectorAll('[data-tab]').forEach(btn => {
  btn.addEventListener('click', () => switchTab(btn.dataset.tab));
});

// ----------------------------------------------------------------------------
// Countdown Timer
// ----------------------------------------------------------------------------

function updateCountdown(targetMs, serverOffsetMs = 0) {
  if (countdownInterval) clearInterval(countdownInterval);

  if (!targetMs) {
    countdownTimer.textContent = '-- : -- : --';
    countdownSubtext.textContent = 'Target: Belum dijadwalkan';
    return;
  }

  const targetDate = new Date(targetMs);
  const dateFormatted = targetDate.toLocaleDateString('id-ID', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
  leadTitle.textContent = `Terjadwal untuk ${dateFormatted} WIB`;

  const tick = () => {
    const nowServer = Date.now() + serverOffsetMs;
    const diff = targetMs - nowServer;

    if (diff <= 0) {
      countdownTimer.textContent = '00:00:00';
      countdownBadgeText.textContent = 'Peluncuran Dibuka!';
      return;
    }

    const hours = Math.floor(diff / (1000 * 60 * 60));
    const mins = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
    const secs = Math.floor((diff % (1000 * 60)) / 1000);

    const pad = (n) => String(n).padStart(2, '0');
    countdownTimer.textContent = `${pad(hours)}:${pad(mins)}:${pad(secs)}`;
  };

  tick();
  countdownInterval = setInterval(tick, 1000);
}

// ----------------------------------------------------------------------------
// Status Sync
// ----------------------------------------------------------------------------

function setRowIcon(element, isOk) {
  element.className = isOk ? 'row-indicator ok' : 'row-indicator neutral';
  element.innerHTML = `<svg class="icon"><use href="#${isOk ? 'icon-check' : 'icon-cross'}"></use></svg>`;
}

async function refreshStatus() {
  try {
    const status = await apiRequest('/api/status');
    appState = status;
    showApp();

    // Status Dot & Text
    statusText.textContent = status.phase;
    statusDot.className = 'status-dot';
    if (status.phase === 'ARMED') {
      statusDot.classList.add('ok');
      statusText.textContent = 'Terjadwal (ARMED)';
    } else if (status.phase === 'READY') {
      statusText.textContent = 'Siap (File Ada)';
    } else if (status.phase === 'FAILED') {
      statusDot.classList.add('err');
      statusText.textContent = 'Gagal';
    }

    // Lead & Schedule
    const fileNamingHint = document.getElementById('file-naming-hint');
    if (status.activeSchedule) {
      leadTitle.textContent = `Week ${status.activeSchedule.week} (Praktikum)`;
      leadSubtitle.textContent = status.activeSchedule.assignmentName;
      if (fileNamingHint) {
        fileNamingHint.textContent = `PrakSO_[I1-I4]_Week${status.activeSchedule.week}_[NIM].pdf`;
      }
    } else if (status.assignment) {
      leadSubtitle.textContent = status.assignment.name;
    }

    if (status.assignment) {
      rowAssignName.textContent = status.assignment.name;
      setRowIcon(rowAssignIcon, true);
    } else if (status.activeSchedule) {
      rowAssignName.textContent = status.activeSchedule.assignmentName;
      setRowIcon(rowAssignIcon, false);
    } else {
      rowAssignName.textContent = 'Belum dipindai';
      setRowIcon(rowAssignIcon, false);
    }

    // File
    if (status.file) {
      rowFileName.textContent = status.file.name;
      setRowIcon(rowFileIcon, true);
      activeFileName.textContent = status.file.name;
      activeFileSize.textContent = `${Math.round(status.file.size / 1024)} KB`;
      fileCardDetails.classList.remove('hidden');
    } else {
      rowFileName.textContent = 'Belum ada berkas';
      setRowIcon(rowFileIcon, false);
      fileCardDetails.classList.add('hidden');
    }

    // Draft
    if (status.draft) {
      rowDraftItem.textContent = `Item ${status.draft.itemId}`;
      setRowIcon(rowDraftIcon, true);
      rowPrepareMeta.textContent = `Draft tersiap (ID ${status.draft.itemId})`;
    } else {
      rowDraftItem.textContent = 'Tidak ada';
      setRowIcon(rowDraftIcon, false);
      rowPrepareMeta.textContent = 'Unggah file ke draft area sebelum jam buka';
    }

    // Last Result
    if (status.lastResult) {
      rowLastStatus.textContent = status.lastResult.status;
      rowLastStatus.style.color = status.lastResult.status === 'FAILED' ? '#D70015' : '#34C759';
      rowLastTime.textContent = status.lastResult.tSubmitMs ? `${status.lastResult.tSubmitMs} ms` : '-';
      rowLastFile.textContent = status.file ? status.file.name : '-';
    }

    // Main Button (ARM / DISARM toggle)
    if (status.phase === 'ARMED') {
      btnMainAction.textContent = 'Nonaktifkan (DISARM)';
      btnMainAction.className = 'btn btn-tinted-disarm btn-block';
      btnMainAction.onclick = disarmJob;
    } else {
      btnMainAction.textContent = 'Aktifkan (ARM)';
      btnMainAction.className = 'btn btn-tinted-arm btn-block';
      btnMainAction.onclick = armJob;
    }

    // Config form values
    if (status.config) {
      cfgCourseId.value = status.config.courseId || '';
      cfgAssignName.value = status.config.assignmentName || '';
      cfgUnlockOverride.value = status.config.unlockAtOverride || '';
      cfgAutoWeekly.checked = Boolean(status.config.autoWeekly);
      cfgDryRun.checked = Boolean(status.dryRun);
    }

    // Countdown
    updateCountdown(status.nextUnlockAt, status.serverOffsetMs);
  } catch (err) {
    // Handled by apiRequest
  }
}

// ----------------------------------------------------------------------------
// Action Handlers
// ----------------------------------------------------------------------------

async function armJob() {
  btnMainAction.disabled = true;
  try {
    const res = await apiRequest('/api/arm', 'POST');
    if (res.ok) {
      alert(`Sistem Aktif (ARMED)!\nAlarm akan mulai bersiap di: ${res.nextUnlockIso}`);
    }
  } catch (e) {
    alert(`Error: ${e.message}`);
  } finally {
    btnMainAction.disabled = false;
    refreshStatus();
  }
}

async function disarmJob() {
  btnMainAction.disabled = true;
  try {
    await apiRequest('/api/disarm', 'POST');
    alert('Sistem dinonaktifkan (DISARMED).');
  } catch (e) {
    alert(`Error: ${e.message}`);
  } finally {
    btnMainAction.disabled = false;
    refreshStatus();
  }
}

actionCheckRow.addEventListener('click', async () => {
  rowCheckMeta.textContent = 'Memindai Moodle...';
  try {
    const res = await apiRequest('/api/check', 'POST');
    if (res.ok) {
      rowCheckMeta.textContent = `Terkoneksi (Latensi server: ${res.serverOffsetMs} ms)`;
      alert(`Pindai Sukses!\nTugas: ${res.assignment?.name || 'Tidak ada'}\nStatus: ${res.isLocked ? 'TERKUNCI' : 'TERBUKA'}`);
    } else {
      rowCheckMeta.textContent = `Gagal: ${res.error}`;
      alert(`Pindai Gagal: ${res.error}`);
    }
  } catch (e) {
    rowCheckMeta.textContent = `Error: ${e.message}`;
  } finally {
    refreshStatus();
  }
});

actionPrepareRow.addEventListener('click', async () => {
  rowPrepareMeta.textContent = 'Mempersiapkan draft...';
  try {
    const res = await apiRequest('/api/prepare', 'POST');
    if (res.ok) {
      alert('Draft area berhasil disiapkan sebelum tugas dibuka!');
    }
  } catch (e) {
    alert(`Error: ${e.message}`);
  } finally {
    refreshStatus();
  }
});

actionSubmitNowRow.addEventListener('click', async () => {
  if (!confirm('Apakah Anda yakin ingin mengirim tugas ini sekarang secara langsung?')) return;
  rowSubmitNowMeta.textContent = 'Sedang mengirim tugas ke Moodle...';
  try {
    const res = await apiRequest('/api/submit-now', 'POST');
    if (res.ok) {
      alert(`Pengumpulan Berhasil! 🎉\nTugas: ${res.assignmentName}\nDurasi: ${res.elapsedMs} ms\nStatus: ${res.statusText}`);
      rowSubmitNowMeta.textContent = `Sukses terkirim (${res.elapsedMs} ms)`;
    } else {
      alert(`Gagal: ${res.error || 'Terjadi kesalahan'}`);
      rowSubmitNowMeta.textContent = `Gagal: ${res.error || 'Terjadi kesalahan'}`;
    }
  } catch (e) {
    alert(`Error: ${e.message}`);
    rowSubmitNowMeta.textContent = `Error: ${e.message}`;
  } finally {
    refreshStatus();
  }
});

// ----------------------------------------------------------------------------
// File Upload & Config
// ----------------------------------------------------------------------------

dropzone.addEventListener('click', () => fileInput.click());

dropzone.addEventListener('dragover', (e) => {
  e.preventDefault();
  dropzone.classList.add('drag-over');
});

dropzone.addEventListener('dragleave', () => dropzone.classList.remove('drag-over'));

dropzone.addEventListener('drop', (e) => {
  e.preventDefault();
  dropzone.classList.remove('drag-over');
  if (e.dataTransfer.files.length > 0) {
    uploadFile(e.dataTransfer.files[0]);
  }
});

fileInput.addEventListener('change', () => {
  if (fileInput.files.length > 0) {
    uploadFile(fileInput.files[0]);
  }
});

async function uploadFile(file) {
  if (!file.name.toLowerCase().endsWith('.pdf')) {
    alert('Hanya file berekstensi .pdf yang diperbolehkan!');
    return;
  }

  const formData = new FormData();
  formData.append('file', file);

  try {
    const res = await apiRequest('/api/file', 'POST', formData);
    if (res.ok) {
      alert(`Berkas ${file.name} berhasil diunggah!`);
      switchTab('tab-beranda');
      refreshStatus();
    } else {
      alert(`Gagal unggah: ${res.error}`);
    }
  } catch (e) {
    alert(`Error: ${e.message}`);
  }
}

btnDeleteFile.addEventListener('click', async () => {
  if (!confirm('Hapus berkas PDF yang tersimpan?')) return;
  try {
    await apiRequest('/api/file', 'DELETE');
    refreshStatus();
  } catch (e) {
    alert(`Error: ${e.message}`);
  }
});

configForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const cfg = {
    courseId: cfgCourseId.value.trim(),
    assignmentName: cfgAssignName.value.trim(),
    unlockAtOverride: cfgUnlockOverride.value.trim() || undefined,
    autoWeekly: cfgAutoWeekly.checked,
    dryRun: cfgDryRun.checked,
  };

  try {
    const res = await apiRequest('/api/config', 'POST', cfg);
    if (res.ok) {
      alert('Pengaturan berhasil diperbarui!');
      refreshStatus();
    }
  } catch (e) {
    alert(`Error: ${e.message}`);
  }
});

btnTestTelegram.addEventListener('click', async () => {
  try {
    const res = await apiRequest('/api/test-notify', 'POST');
    if (res.ok) {
      alert('Pesan uji coba berhasil terkirim ke Telegram Anda!');
    } else {
      alert(`Gagal kirim Telegram: ${res.error}`);
    }
  } catch (e) {
    alert(`Error: ${e.message}`);
  }
});

// ----------------------------------------------------------------------------
// Logs
// ----------------------------------------------------------------------------

async function refreshLogs() {
  try {
    const logs = await apiRequest('/api/logs?limit=80');
    if (!Array.isArray(logs) || logs.length === 0) {
      logsList.innerHTML = '<div class="list-row"><span class="row-label text-subtle">Belum ada aktivitas.</span></div>';
      return;
    }

    logsList.innerHTML = logs
      .slice()
      .reverse()
      .map((l) => {
        const timeStr = new Date(l.t).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
        const dataStr = l.data !== undefined ? JSON.stringify(l.data) : '';
        return `
          <div class="list-row">
            <div class="row-main">
              <span class="row-label">${l.ev}</span>
              <span class="row-meta mono">${timeStr} · [${l.lvl}] ${dataStr}</span>
            </div>
          </div>
        `;
      })
      .join('');
  } catch {
    // Handled by apiRequest
  }
}

// ----------------------------------------------------------------------------
// Auth
// ----------------------------------------------------------------------------

loginForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  loginError.classList.add('hidden');
  const password = appPasswordInput.value.trim();

  try {
    const res = await fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password }),
    });
    const json = await res.json();

    if (json.ok) {
      showApp();
      refreshStatus();
    } else {
      loginError.textContent = 'Password salah.';
      loginError.classList.remove('hidden');
    }
  } catch (err) {
    loginError.textContent = `Gagal login: ${err.message}`;
    loginError.classList.remove('hidden');
  }
});

btnLogout.addEventListener('click', async () => {
  await fetch('/api/logout', { method: 'POST' });
  showLogin();
});

// Initialize
(async () => {
  try {
    await refreshStatus();
    setInterval(refreshStatus, 15000); // sync status every 15s
  } catch {
    showLogin();
  }
})();
