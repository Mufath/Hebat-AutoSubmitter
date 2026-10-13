/**
 * ui/app.js
 * Vanilla JavaScript controller for Hebat Submitter UI.
 * Handles API communications, countdown timing, file uploads, and log streaming.
 */

let appState = null;
let countdownInterval = null;

// DOM Elements
const loginModal = document.getElementById('login-modal');
const appContainer = document.getElementById('app-container');
const loginForm = document.getElementById('login-form');
const loginError = document.getElementById('login-error');
const appPasswordInput = document.getElementById('app-password');
const btnLogout = document.getElementById('btn-logout');

const badgePhase = document.getElementById('badge-phase');
const infoPhase = document.getElementById('info-phase');
const infoAssignment = document.getElementById('info-assignment');
const infoLocked = document.getElementById('info-locked');
const infoDraft = document.getElementById('info-draft');
const serverOffsetText = document.getElementById('server-offset-text');
const countdownTimer = document.getElementById('countdown-timer');
const unlockTargetText = document.getElementById('unlock-target-text');

const btnCheck = document.getElementById('btn-check');
const btnPrepare = document.getElementById('btn-prepare');
const btnArm = document.getElementById('btn-arm');
const btnDisarm = document.getElementById('btn-disarm');

const dropzone = document.getElementById('dropzone');
const fileInput = document.getElementById('file-input');
const fileDetails = document.getElementById('file-details');
const fileName = document.getElementById('file-name');
const fileSize = document.getElementById('file-size');
const btnDeleteFile = document.getElementById('btn-delete-file');

const configForm = document.getElementById('config-form');
const cfgCourseId = document.getElementById('cfg-course-id');
const cfgAssignName = document.getElementById('cfg-assign-name');
const cfgUnlockOverride = document.getElementById('cfg-unlock-override');
const cfgAutoWeekly = document.getElementById('cfg-auto-weekly');

const btnRefreshLogs = document.getElementById('btn-refresh-logs');
const logsTbody = document.getElementById('logs-tbody');

// ----------------------------------------------------------------------------
// API Helper
// ----------------------------------------------------------------------------

async function apiRequest(endpoint, method = 'GET', body = null) {
  const headers = {
    'X-Requested-With': 'fetch',
  };
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
  appContainer.classList.add('hidden');
}

function showApp() {
  loginModal.classList.add('hidden');
  appContainer.classList.remove('hidden');
}

// ----------------------------------------------------------------------------
// Auth Flow
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
      refreshLogs();
    } else {
      loginError.textContent = 'Password salah, silakan coba lagi.';
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

// ----------------------------------------------------------------------------
// Status & Countdown
// ----------------------------------------------------------------------------

function updatePhaseBadge(phase) {
  badgePhase.textContent = phase;
  infoPhase.textContent = phase;
  badgePhase.className = 'nav-status-badge';
  
  if (phase === 'ARMED') badgePhase.style.backgroundColor = '#10b981';
  else if (phase === 'READY') badgePhase.style.backgroundColor = '#38bdf8';
  else if (phase === 'FAILED') badgePhase.style.backgroundColor = '#ef4444';
  else if (phase === 'POLLING' || phase === 'SUBMITTING') badgePhase.style.backgroundColor = '#f59e0b';
  else badgePhase.style.backgroundColor = 'var(--secondary)';
}

function updateCountdown(targetMs, serverOffsetMs = 0) {
  if (countdownInterval) clearInterval(countdownInterval);

  if (!targetMs) {
    countdownTimer.textContent = '-- : -- : --';
    unlockTargetText.textContent = 'Target: Belum dijadwalkan';
    return;
  }

  const targetDate = new Date(targetMs);
  unlockTargetText.textContent = `Target: ${targetDate.toLocaleDateString('id-ID', { weekday: 'long', hour: '2-digit', minute: '2-digit', second: '2-digit' })} WIB`;

  const tick = () => {
    const nowServer = Date.now() + serverOffsetMs;
    const diff = targetMs - nowServer;

    if (diff <= 0) {
      countdownTimer.textContent = '00 : 00 : 00';
      return;
    }

    const hours = Math.floor(diff / (1000 * 60 * 60));
    const mins = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
    const secs = Math.floor((diff % (1000 * 60)) / 1000);

    const pad = (n) => String(n).padStart(2, '0');
    countdownTimer.textContent = `${pad(hours)} : ${pad(mins)} : ${pad(secs)}`;
  };

  tick();
  countdownInterval = setInterval(tick, 1000);
}

async function refreshStatus() {
  try {
    const status = await apiRequest('/api/status');
    appState = status;

    updatePhaseBadge(status.phase);
    serverOffsetText.textContent = `Offset Server: ${status.serverOffsetMs || 0} ms`;

    // Assignment details
    if (status.assignment) {
      infoAssignment.textContent = status.assignment.name;
      infoLocked.textContent = status.assignment.isAvailable ? '🔓 Terbuka' : '🔒 Terkunci';
    } else {
      infoAssignment.textContent = 'Belum dipindai (Gunakan tombol Check)';
      infoLocked.textContent = '--';
    }

    // Draft info
    infoDraft.textContent = status.draft ? String(status.draft.itemId) : 'Tidak ada';

    // File details
    if (status.file) {
      dropzone.classList.add('hidden');
      fileDetails.classList.remove('hidden');
      fileName.textContent = status.file.name;
      fileSize.textContent = `${Math.round(status.file.size / 1024)} KB`;
    } else {
      dropzone.classList.remove('hidden');
      fileDetails.classList.add('hidden');
    }

    // Config inputs
    if (status.config) {
      cfgCourseId.value = status.config.courseId || '';
      cfgAssignName.value = status.config.assignmentName || '';
      cfgUnlockOverride.value = status.config.unlockAtOverride || '';
      cfgAutoWeekly.checked = Boolean(status.config.autoWeekly);
    }

    // Countdown target
    updateCountdown(status.nextUnlockAt, status.serverOffsetMs);
  } catch {
    // Session expired or network error handled by apiRequest
  }
}

// ----------------------------------------------------------------------------
// Action Buttons
// ----------------------------------------------------------------------------

btnCheck.addEventListener('click', async () => {
  btnCheck.disabled = true;
  btnCheck.textContent = 'Memindai...';
  try {
    const res = await apiRequest('/api/check', 'POST');
    if (res.ok) {
      alert(`Pindai Berhasil!\nModul: ${res.assignment?.name || 'Tidak ada'}\nStatus: ${res.isLocked ? 'TERKUNCI' : 'TERBUKA'}`);
    } else {
      alert(`Pindai Gagal: ${res.error}`);
    }
  } catch (e) {
    alert(`Error: ${e.message}`);
  } finally {
    btnCheck.disabled = false;
    btnCheck.textContent = '🔍 Pindai (Check)';
    refreshStatus();
    refreshLogs();
  }
});

btnPrepare.addEventListener('click', async () => {
  btnPrepare.disabled = true;
  btnPrepare.textContent = 'Mempersiapkan...';
  try {
    const res = await apiRequest('/api/prepare', 'POST');
    if (res.ok) {
      alert('Persiapan Berhasil! Login, discovery, dan upload draft PDF selesai.');
    }
  } catch (e) {
    alert(`Error: ${e.message}`);
  } finally {
    btnPrepare.disabled = false;
    btnPrepare.textContent = '📦 Persiapkan (Prepare)';
    refreshStatus();
    refreshLogs();
  }
});

btnArm.addEventListener('click', async () => {
  try {
    const res = await apiRequest('/api/arm', 'POST');
    if (res.ok) {
      alert(`Sistem Telah Diaktifkan (ARMED)!\nAlarm akan berbunyi di: ${res.nextUnlockIso}`);
    }
  } catch (e) {
    alert(`Error: ${e.message}`);
  } finally {
    refreshStatus();
    refreshLogs();
  }
});

btnDisarm.addEventListener('click', async () => {
  try {
    await apiRequest('/api/disarm', 'POST');
    alert('Sistem Dibatalkan (DISARMED).');
  } catch (e) {
    alert(`Error: ${e.message}`);
  } finally {
    refreshStatus();
    refreshLogs();
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
    alert('Hanya file PDF yang diperbolehkan!');
    return;
  }

  const formData = new FormData();
  formData.append('file', file);

  try {
    const res = await apiRequest('/api/file', 'POST', formData);
    if (res.ok) {
      refreshStatus();
      refreshLogs();
    } else {
      alert(`Gagal upload: ${res.error}`);
    }
  } catch (e) {
    alert(`Error: ${e.message}`);
  }
}

btnDeleteFile.addEventListener('click', async () => {
  if (!confirm('Yakin ingin menghapus file PDF yang tersimpan?')) return;
  try {
    await apiRequest('/api/file', 'DELETE');
    refreshStatus();
    refreshLogs();
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
  };

  try {
    const res = await apiRequest('/api/config', 'POST', cfg);
    if (res.ok) {
      alert('Pengaturan berhasil disimpan!');
      refreshStatus();
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
    const logs = await apiRequest('/api/logs?limit=100');
    if (!Array.isArray(logs) || logs.length === 0) {
      logsTbody.innerHTML = '<tr><td colspan="4" class="text-center text-muted">Belum ada riwayat log.</td></tr>';
      return;
    }

    logsTbody.innerHTML = logs
      .slice()
      .reverse()
      .map((l) => {
        const timeStr = new Date(l.t).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
        const badgeClass = l.lvl === 'ERROR' ? 'log-error' : l.lvl === 'WARN' ? 'log-warn' : 'log-info';
        const dataStr = l.data !== undefined ? JSON.stringify(l.data) : '-';

        return `
          <tr>
            <td class="font-mono text-muted">${timeStr}</td>
            <td><span class="log-badge ${badgeClass}">${l.lvl}</span></td>
            <td><strong>${l.ev}</strong></td>
            <td class="font-mono text-muted" style="word-break: break-all;">${dataStr}</td>
          </tr>
        `;
      })
      .join('');
  } catch {
    // Session expired handled by apiRequest
  }
}

btnRefreshLogs.addEventListener('click', refreshLogs);

// Initialize on Load
(async () => {
  try {
    await refreshStatus();
    showApp();
    refreshLogs();
    setInterval(refreshStatus, 10000); // Poll status every 10s
    setInterval(refreshLogs, 15000);   // Refresh logs every 15s
  } catch {
    showLogin();
  }
})();
