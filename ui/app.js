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

// Video Background Handler (loads background.mp4 or background.mp4.mp4)
(function initVideoBackground() {
  const bgVideo = document.getElementById('bg-video');
  const flowCanvas = document.getElementById('flow-canvas');
  if (!bgVideo) return;

  function activateVideo() {
    bgVideo.classList.remove('hidden');
    bgVideo.style.display = 'block';
    if (flowCanvas) flowCanvas.style.display = 'none';
    bgVideo.play().catch(() => {});
  }

  if (bgVideo.readyState >= 2) {
    activateVideo();
  }

  bgVideo.addEventListener('loadeddata', activateVideo);
  bgVideo.addEventListener('canplay', activateVideo);
  bgVideo.addEventListener('playing', activateVideo);

  bgVideo.addEventListener('error', () => {
    bgVideo.classList.add('hidden');
    bgVideo.style.display = 'none';
    if (flowCanvas) flowCanvas.style.display = 'block';
  });
})();

// ----------------------------------------------------------------------------
// 2. Client Controller & API Integration
// ----------------------------------------------------------------------------

let appState = null;
let countdownInterval = null;
let userHasModifiedSchedule = false;

// New State Variables for All Assignments & Submodes
let currentSubmode = 'custom'; // 'custom' | 'direct' | 'template'
let coursesData = [];
let assignmentsData = [];
let activeAssignmentFilter = 'all';

// DOM Elements
const loginModal = document.getElementById('login-modal');
const appContainer = document.getElementById('app-container');
const loginForm = document.getElementById('login-form');
const loginError = document.getElementById('login-error');
const loginNimInput = document.getElementById('login-nim');
const loginMoodlePassInput = document.getElementById('login-moodle-pass');
const btnLoginSubmit = document.getElementById('btn-login-submit');
const userNimPill = document.getElementById('user-nim-pill');
const btnLogout = document.getElementById('btn-logout');

const headerPing = document.getElementById('header-ping');
const statusDot = document.getElementById('status-dot');
const statusText = document.getElementById('status-text');

const leadTitle = document.getElementById('lead-title');
const leadSubtitle = document.getElementById('lead-subtitle');
const countdownTimer = document.getElementById('countdown-timer');
const countdownBadgeText = document.getElementById('countdown-badge-text');
const countdownSubtext = document.getElementById('countdown-subtext');

// Beranda Quick Workflow Elements
const quickFileEmpty = document.getElementById('quick-file-empty');
const quickFileInput = document.getElementById('quick-file-input');
const quickFileLoaded = document.getElementById('quick-file-loaded');
const quickFileName = document.getElementById('quick-file-name');
const quickFileSize = document.getElementById('quick-file-size');
const btnQuickChangeFile = document.getElementById('btn-quick-change-file');
const btnQuickDeleteFile = document.getElementById('btn-quick-delete-file');

const quickCourseSelect = document.getElementById('quick-course-select');
const quickAssignSelect = document.getElementById('quick-assign-select');
const quickAssignInput = document.getElementById('quick-assign-input');
const linkGoToTugas = document.getElementById('link-go-to-tugas');

const submodeSelector = document.getElementById('submode-selector');
const subpanelCustom = document.getElementById('subpanel-custom');
const subpanelDirect = document.getElementById('subpanel-direct');
const subpanelTemplate = document.getElementById('subpanel-template');

// Tab Tugas Elements
const courseDropdown = document.getElementById('course-dropdown');
const btnReloadCourses = document.getElementById('btn-reload-courses');
const assignmentsListContainer = document.getElementById('assignments-list-container');

const btnMainAction = document.getElementById('btn-main-action');
const actionCheckRow = document.getElementById('action-check-row');
const rowCheckMeta = document.getElementById('row-check-meta');
const actionPrepareRow = document.getElementById('action-prepare-row');
const rowPrepareMeta = document.getElementById('row-prepare-meta');
const actionSubmitNowRow = document.getElementById('action-submit-now-row');
const rowSubmitNowMeta = document.getElementById('row-submit-now-meta');
const actionSimulateRow = document.getElementById('action-simulate-row');
const rowSimulateMeta = document.getElementById('row-simulate-meta');

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

// Config & Schedule Tabs
const configForm = document.getElementById('config-form');
const scheduleForm = document.getElementById('schedule-form');
const cfgMoodleUser = document.getElementById('cfg-moodle-user');
const cfgMoodlePass = document.getElementById('cfg-moodle-pass');
const badgeUserSource = document.getElementById('badge-user-source');
const badgePassSource = document.getElementById('badge-pass-source');

const cfgScheduleMode = document.getElementById('cfg-schedule-mode');
const wrapperCustomSchedule = document.getElementById('wrapper-custom-schedule');

// Apple Calendar Preset Buttons
const btnQuickTomorrow = document.getElementById('btn-quick-tomorrow');
const btnQuickFriday = document.getElementById('btn-quick-friday');
const btnQuickWednesday = document.getElementById('btn-quick-wednesday');

const cfgMoodleTarget = document.getElementById('cfg-moodle-target');
const cfgCourseId = document.getElementById('cfg-course-id');
const cfgAssignName = document.getElementById('cfg-assign-name');
const cfgUnlockOverride = document.getElementById('cfg-unlock-override');
const cfgAutoWeekly = document.getElementById('cfg-auto-weekly');
const cfgDryRun = document.getElementById('cfg-dry-run');

const cfgTelegramToken = document.getElementById('cfg-telegram-token');
const cfgTelegramChat = document.getElementById('cfg-telegram-chat');
const btnTestTelegram = document.getElementById('btn-test-telegram');

// Logs Tab
const logsList = document.getElementById('logs-list');
const btnSubtabMyLogs = document.getElementById('btn-subtab-my-logs');
const btnSubtabGlobalLogs = document.getElementById('btn-subtab-global-logs');
const sectionMyLogs = document.getElementById('section-my-logs');
const sectionGlobalLogs = document.getElementById('section-global-logs');
const btnRefreshGlobalLogs = document.getElementById('btn-refresh-global-logs');
const globalLogsList = document.getElementById('global-logs-list');
let currentLogSubtab = 'my-logs';

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

  const rawText = await res.text();
  let data;
  try {
    data = JSON.parse(rawText);
  } catch {
    throw new Error(`Server mengembalikan respon tidak valid (Status ${res.status}): ${rawText.slice(0, 80)}`);
  }

  if (!res.ok && data && data.error) {
    throw new Error(data.error);
  }

  return data;
}

function showToast(message, duration = 3500) {
  const container = document.getElementById('toast-container');
  if (!container) {
    console.log(message);
    return;
  }
  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.textContent = message;
  container.appendChild(toast);
  requestAnimationFrame(() => toast.classList.add('show'));
  setTimeout(() => {
    toast.classList.remove('show');
    setTimeout(() => toast.remove(), 300);
  }, duration);
}

async function updatePing() {
  if (!headerPing) return;
  try {
    const res = await apiRequest('/api/ping');
    if (res && res.ok && res.latencyMs !== null && res.latencyMs !== undefined) {
      headerPing.textContent = `${res.latencyMs} ms`;
    } else {
      headerPing.textContent = '-- ms';
    }
  } catch {
    headerPing.textContent = '-- ms';
  }
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

  if (tabId === 'tab-tugas') {
    if (assignmentsData.length === 0) {
      loadCoursesAndAssignments();
    }
  } else if (tabId === 'tab-log') {
    if (currentLogSubtab === 'my-logs') {
      refreshLogs();
    } else {
      refreshGlobalLogs();
    }
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

    if (userNimPill && status.nim) {
      userNimPill.textContent = `NIM: ${status.nim}`;
    }

    // Status Dot & Text
    statusDot.className = 'status-dot';
    if (status.phase === 'ARMED') {
      statusDot.classList.add('ok');
      statusText.textContent = 'Terjadwal';
    } else if (status.phase === 'PREPARING') {
      statusDot.classList.add('ok');
      statusText.textContent = 'Menyiapkan berkas...';
    } else if (status.phase === 'PREPARED') {
      statusDot.classList.add('ok');
      statusText.textContent = 'Berkas siap';
    } else if (status.phase === 'WAITING') {
      statusDot.classList.add('ok');
      statusText.textContent = 'Siaga buka';
    } else if (status.phase === 'POLLING') {
      statusDot.classList.add('ok');
      statusText.textContent = 'Memeriksa status...';
    } else if (status.phase === 'SUBMITTING') {
      statusDot.classList.add('ok');
      statusText.textContent = 'Mengirim tugas...';
    } else if (status.phase === 'DONE') {
      statusDot.classList.add('ok');
      statusText.textContent = 'Selesai';
    } else if (status.phase === 'READY') {
      statusText.textContent = 'Siap dikumpulkan';
    } else if (status.phase === 'FAILED') {
      statusDot.classList.add('err');
      statusText.textContent = 'Gagal';
    } else {
      statusText.textContent = 'Belum terjadwal';
    }

    // Lead Title & Subtitle
    if (status.assignment) {
      leadTitle.textContent = status.assignment.name;
      leadSubtitle.textContent = 'Target Tugas Moodle Aktif';
    } else if (status.activeSchedule) {
      leadTitle.textContent = `Week ${status.activeSchedule.week}`;
      leadSubtitle.textContent = status.activeSchedule.assignmentName;
    } else {
      leadTitle.textContent = 'Pengumpulan Tugas';
      leadSubtitle.textContent = 'Moodle Hebat UNAIR';
    }

    // Quick File Display (Beranda)
    if (status.file) {
      if (quickFileEmpty) quickFileEmpty.classList.add('hidden');
      if (quickFileLoaded) quickFileLoaded.classList.remove('hidden');
      if (quickFileName) quickFileName.textContent = status.file.name;
      if (quickFileSize) quickFileSize.textContent = `${Math.round(status.file.size / 1024)} KB`;

      // Also sync Tab Berkas
      if (activeFileName) activeFileName.textContent = status.file.name;
      if (activeFileSize) activeFileSize.textContent = `${Math.round(status.file.size / 1024)} KB`;
      if (fileCardDetails) fileCardDetails.classList.remove('hidden');
    } else {
      if (quickFileEmpty) quickFileEmpty.classList.remove('hidden');
      if (quickFileLoaded) quickFileLoaded.classList.add('hidden');
      if (fileCardDetails) fileCardDetails.classList.add('hidden');
    }

    // Last Result
    if (status.lastResult) {
      rowLastStatus.textContent = status.lastResult.status === 'SUCCESS' ? 'Berhasil Dikumpulkan' : status.lastResult.status;
      rowLastStatus.style.color = status.lastResult.status === 'FAILED' ? '#D70015' : '#34C759';
      rowLastTime.textContent = status.lastResult.tSubmitMs ? `${status.lastResult.tSubmitMs} ms` : '-';
      rowLastFile.textContent = status.file ? status.file.name : '-';
    }

    // Main Action Button Contextual Logic
    if (status.phase === 'ARMED' || status.phase === 'WAITING' || status.phase === 'PREPARED') {
      btnMainAction.textContent = 'Batalkan Jadwal';
      btnMainAction.className = 'btn btn-tinted-disarm btn-block';
      btnMainAction.onclick = disarmJob;
    } else if (currentSubmode === 'direct') {
      btnMainAction.textContent = 'Kirim Tugas Sekarang';
      btnMainAction.className = 'btn btn-primary btn-block';
      btnMainAction.onclick = submitDirectJob;
    } else {
      btnMainAction.textContent = 'Jadwalkan Tugas';
      btnMainAction.className = 'btn btn-primary btn-block';
      btnMainAction.onclick = armJob;
    }

    // Update Ping Latency in header
    updatePing();

    if (userNimPill) {
      userNimPill.textContent = `NIM: ${status.nim || '--'}`;
    }

    // Config form values
    if (status.config) {
      if (cfgMoodleTarget && !cfgMoodleTarget.matches(':focus')) {
        cfgMoodleTarget.value = status.config.moodleBase || 'https://hebat.elearning.unair.ac.id';
        syncAppleSelect(cfgMoodleTarget);
      }
      if (cfgCourseId && !cfgCourseId.matches(':focus')) cfgCourseId.value = status.config.courseId || '';
      if (cfgAssignName && !cfgAssignName.matches(':focus')) cfgAssignName.value = status.config.assignmentName || '';
      if (cfgUnlockOverride && !cfgUnlockOverride.matches(':focus')) cfgUnlockOverride.value = status.config.unlockAtOverride || '';
      if (cfgAutoWeekly && !cfgAutoWeekly.matches(':focus')) cfgAutoWeekly.checked = Boolean(status.config.autoWeekly);
      if (cfgDryRun && !cfgDryRun.matches(':focus')) cfgDryRun.checked = Boolean(status.dryRun);

      // Credentials Info
      if (status.credentialsInfo) {
        const isOwner = Boolean(status.credentialsInfo.isOwner);
        if (cfgMoodleUser) {
          cfgMoodleUser.value = status.nim || status.credentialsInfo.moodleUser || '';
        }
        if (badgeUserSource) {
          badgeUserSource.textContent = isOwner ? '(Pemilik Worker)' : '(Akun Mahasiswa Terverifikasi)';
          badgeUserSource.style.color = '#0071E3';
        }
        if (badgePassSource) {
          badgePassSource.textContent = status.credentialsInfo.hasMoodlePass
            ? '(Password Tersimpan & Aktif)'
            : '(Belum Diisi)';
          badgePassSource.style.color = status.credentialsInfo.hasMoodlePass ? '#34C759' : '#D70015';
        }
        if (btnSubtabGlobalLogs) {
          btnSubtabGlobalLogs.classList.toggle('hidden', !isOwner);
        }
        if (!isOwner && currentLogSubtab === 'global-logs') {
          setLogSubtab('my-logs');
        }
        if (cfgTelegramChat && !cfgTelegramChat.matches(':focus')) {
          cfgTelegramChat.value = status.config.telegramChatId || '';
        }
      }

      // Schedule mode: ONLY sync from server if user has not modified schedule locally
      if (!userHasModifiedSchedule) {
        const schedMode = status.config.scheduleMode || 'CUSTOM';
        if (cfgScheduleMode) {
          cfgScheduleMode.value = schedMode;
          syncAppleSelect(cfgScheduleMode);
        }
        if (wrapperCustomSchedule) {
          wrapperCustomSchedule.classList.toggle('hidden', schedMode !== 'CUSTOM');
        }

        if (status.config.customUnlockIso) {
          try {
            const d = new Date(status.config.customUnlockIso);
            if (!isNaN(d.getTime()) && d.getTime() > Date.now() - 60000) {
              calCurrentYear = d.getFullYear();
              calCurrentMonth = d.getMonth();
              calSelectedDate = d;
              document.querySelectorAll('.cal-hour').forEach(inp => {
                if (!inp.matches(':focus')) inp.value = d.getHours();
              });
              document.querySelectorAll('.cal-minute').forEach(inp => {
                if (!inp.matches(':focus')) inp.value = d.getMinutes();
              });
              syncCalendarSelection();
              renderAppleCalendar();
            }
          } catch {}
        }
      }
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
  if (!appState || !appState.file) {
    showToast('Harap pilih dan unggah berkas PDF tugas terlebih dahulu!');
    return;
  }

  btnMainAction.disabled = true;
  try {
    const configUpdate = {
      unlockAtOverride: null,
    };

    // If user is in custom mode and has calendar date selected, sync it
    if (currentSubmode === 'custom' && calSelectedDate) {
      const hourInput = document.querySelector('#tab-beranda .cal-hour') || document.querySelector('.cal-hour');
      const minInput = document.querySelector('#tab-beranda .cal-minute') || document.querySelector('.cal-minute');
      const h = parseInt(hourInput ? hourInput.value : '7', 10);
      const m = parseInt(minInput ? minInput.value : '0', 10);
      calSelectedDate.setHours(isNaN(h) ? 7 : Math.min(23, Math.max(0, h)));
      calSelectedDate.setMinutes(isNaN(m) ? 0 : Math.min(59, Math.max(0, m)));
      calSelectedDate.setSeconds(0, 0);

      if (calSelectedDate.getTime() <= Date.now() - 30000) {
        showToast('Waktu jadwal yang dipilih sudah lewat! Silakan pilih tanggal atau jam yang akan datang.');
        return;
      }

      configUpdate.customUnlockIso = calSelectedDate.toISOString();
      configUpdate.scheduleMode = 'CUSTOM';
    }

    // Save target course & assignment if selected from quick dropdown or input
    const chosenCourse = (quickCourseSelect?.value || courseDropdown?.value || '').trim();
    if (chosenCourse) {
      configUpdate.courseId = chosenCourse;
    }

    const chosenAssign = (quickAssignInput?.value || quickAssignSelect?.value || '').trim();
    if (chosenAssign) {
      configUpdate.assignmentName = chosenAssign;
      const matched = assignmentsData.find(a => a.name === chosenAssign);
      if (matched && matched.cmid) {
        configUpdate.assignmentCmid = matched.cmid;
      }
    }

    await apiRequest('/api/config', 'POST', configUpdate);

    const res = await apiRequest('/api/arm', 'POST');
    if (res.ok) {
      showToast('Jadwal pengumpulan berhasil diaktifkan!');
    }
  } catch (e) {
    showToast(`Gagal menjadwalkan: ${e.message}`);
  } finally {
    btnMainAction.disabled = false;
    refreshStatus();
  }
}

async function disarmJob() {
  btnMainAction.disabled = true;
  try {
    await apiRequest('/api/disarm', 'POST');
    showToast('Jadwal pengumpulan dibatalkan.');
  } catch (e) {
    showToast(`Error: ${e.message}`);
  } finally {
    btnMainAction.disabled = false;
    refreshStatus();
  }
}

async function submitDirectJob() {
  if (!confirm('Apakah Anda yakin ingin mengirim tugas ini sekarang ke Moodle?')) return;
  btnMainAction.disabled = true;
  try {
    const res = await apiRequest('/api/submit-now', 'POST');
    if (res.ok) {
      showToast(`Pengumpulan berhasil! (${res.elapsedMs || 0} ms)`);
    } else {
      showToast(`Gagal: ${res.error || 'Terjadi kesalahan'}`);
    }
  } catch (e) {
    showToast(`Error: ${e.message}`);
  } finally {
    btnMainAction.disabled = false;
    refreshStatus();
  }
}

if (actionCheckRow) {
  actionCheckRow.addEventListener('click', async () => {
    rowCheckMeta.textContent = 'Memindai Moodle...';
    try {
      const res = await apiRequest('/api/check', 'POST');
      if (res.ok) {
        rowCheckMeta.textContent = `Terkoneksi (Latensi: ${res.serverOffsetMs} ms)`;
        showToast(`Terkoneksi ke Moodle! Latensi server: ${res.serverOffsetMs} ms`);
      } else {
        rowCheckMeta.textContent = `Gagal: ${res.error}`;
        showToast(`Pindai Gagal: ${res.error}`);
      }
    } catch (e) {
      rowCheckMeta.textContent = `Error: ${e.message}`;
      showToast(`Error: ${e.message}`);
    } finally {
      refreshStatus();
    }
  });
}

if (actionPrepareRow) {
  actionPrepareRow.addEventListener('click', async () => {
    rowPrepareMeta.textContent = 'Mempersiapkan draft...';
    try {
      const res = await apiRequest('/api/prepare', 'POST');
      if (res.ok) {
        showToast('Draft area berhasil disiapkan di server Moodle!');
      }
    } catch (e) {
      showToast(`Error: ${e.message}`);
    } finally {
      refreshStatus();
    }
  });
}

if (actionSubmitNowRow) {
  actionSubmitNowRow.addEventListener('click', () => submitDirectJob());
}

if (actionSimulateRow) {
  actionSimulateRow.addEventListener('click', async () => {
    const isDryRun = cfgDryRun ? cfgDryRun.checked : false;
    const modeStr = isDryRun
      ? 'Mode Uji Coba (Tanpa mengubah nilai di Moodle)'
      : 'Pengiriman Nyata ke Moodle';
    const msg =
      `Mulai Uji Coba Pengiriman Otomatis (2 Menit)?\n\n` +
      `Mode: ${modeStr}\n\n` +
      `Sistem akan menjadwalkan pembukaan tugas tepat 120 detik dari sekarang dan menjalankan simulasi otomatisasi penuh.`;

    if (!confirm(msg)) return;

    rowSimulateMeta.textContent = 'Sedang menjadwalkan uji coba 2 menit...';
    try {
      const res = await apiRequest('/api/simulate-run', 'POST', { seconds: 120 });
      if (res.ok) {
        showToast(`Uji coba dimulai! Waktu buka: ${new Date(res.targetIso).toLocaleTimeString('id-ID')}`);
        rowSimulateMeta.textContent = `Aktif! Target: ${new Date(res.targetIso).toLocaleTimeString('id-ID')}`;
      } else {
        showToast(`Gagal: ${res.error || 'Terjadi kesalahan'}`);
        rowSimulateMeta.textContent = `Gagal: ${res.error || 'Terjadi kesalahan'}`;
      }
    } catch (e) {
      showToast(`Error: ${e.message}`);
      rowSimulateMeta.textContent = `Error: ${e.message}`;
    } finally {
      refreshStatus();
    }
  });
}

// ----------------------------------------------------------------------------
// File Upload & Config
// ----------------------------------------------------------------------------

if (dropzone) dropzone.addEventListener('click', () => fileInput.click());

if (dropzone) {
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
}

if (fileInput) {
  fileInput.addEventListener('change', () => {
    if (fileInput.files.length > 0) {
      uploadFile(fileInput.files[0]);
    }
  });
}

// Beranda Quick File Listeners
if (quickFileEmpty) {
  quickFileEmpty.addEventListener('click', () => {
    if (quickFileInput) quickFileInput.click();
  });
  quickFileEmpty.addEventListener('dragover', (e) => {
    e.preventDefault();
    quickFileEmpty.style.borderColor = '#0071E3';
    quickFileEmpty.style.backgroundColor = 'rgba(0, 113, 227, 0.05)';
  });
  quickFileEmpty.addEventListener('dragleave', () => {
    quickFileEmpty.style.borderColor = 'rgba(0,0,0,0.12)';
    quickFileEmpty.style.backgroundColor = 'rgba(0,0,0,0.01)';
  });
  quickFileEmpty.addEventListener('drop', (e) => {
    e.preventDefault();
    quickFileEmpty.style.borderColor = 'rgba(0,0,0,0.12)';
    quickFileEmpty.style.backgroundColor = 'rgba(0,0,0,0.01)';
    if (e.dataTransfer && e.dataTransfer.files.length > 0) {
      uploadFile(e.dataTransfer.files[0]);
    }
  });
}

if (btnQuickChangeFile) {
  btnQuickChangeFile.addEventListener('click', () => {
    if (quickFileInput) quickFileInput.click();
  });
}

if (quickFileInput) {
  quickFileInput.addEventListener('change', () => {
    if (quickFileInput.files.length > 0) {
      uploadFile(quickFileInput.files[0]);
    }
  });
}

if (btnQuickDeleteFile) {
  btnQuickDeleteFile.addEventListener('click', () => deleteFile());
}

async function uploadFile(file) {
  if (!file.name.toLowerCase().endsWith('.pdf')) {
    showToast('Hanya berkas berekstensi .pdf yang diperbolehkan!');
    return;
  }

  const formData = new FormData();
  formData.append('file', file);

  try {
    const res = await apiRequest('/api/file', 'POST', formData);
    if (res.ok) {
      showToast(`Berkas ${file.name} berhasil diunggah!`);
      refreshStatus();
    } else {
      showToast(`Gagal unggah: ${res.error}`);
    }
  } catch (e) {
    showToast(`Error: ${e.message}`);
  }
}

async function deleteFile() {
  if (!confirm('Hapus berkas PDF yang tersimpan?')) return;
  try {
    await apiRequest('/api/file', 'DELETE');
    showToast('Berkas berhasil dihapus.');
    refreshStatus();
  } catch (e) {
    showToast(`Error: ${e.message}`);
  }
}

if (btnDeleteFile) {
  btnDeleteFile.addEventListener('click', () => deleteFile());
}

// ----------------------------------------------------------------------------
// Beranda Submode Selector & Presets
// ----------------------------------------------------------------------------

function setSubmode(mode) {
  currentSubmode = mode;
  document.querySelectorAll('#submode-selector .submode-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.submode === mode);
  });

  if (subpanelCustom) subpanelCustom.classList.toggle('hidden', mode !== 'custom');
  if (subpanelDirect) subpanelDirect.classList.toggle('hidden', mode !== 'direct');
  if (subpanelTemplate) subpanelTemplate.classList.toggle('hidden', mode !== 'template');

  if (btnMainAction) {
    if (appState && (appState.phase === 'ARMED' || appState.phase === 'WAITING' || appState.phase === 'PREPARED')) {
      btnMainAction.textContent = 'Batalkan Jadwal';
      btnMainAction.className = 'btn btn-tinted-disarm btn-block';
      btnMainAction.onclick = disarmJob;
    } else if (currentSubmode === 'direct') {
      btnMainAction.textContent = 'Kirim Tugas Sekarang';
      btnMainAction.className = 'btn btn-primary btn-block';
      btnMainAction.onclick = submitDirectJob;
    } else {
      btnMainAction.textContent = 'Jadwalkan Tugas';
      btnMainAction.className = 'btn btn-primary btn-block';
      btnMainAction.onclick = armJob;
    }
  }
}

document.querySelectorAll('#submode-selector .submode-btn').forEach(btn => {
  btn.addEventListener('click', () => setSubmode(btn.dataset.submode));
});

// Template Presets
document.querySelectorAll('.btn-template-preset').forEach(btn => {
  btn.addEventListener('click', async () => {
    const type = btn.dataset.template;
    let targetDate = new Date();

    if (type === 'so-wednesday') {
      const day = targetDate.getUTCDay();
      const diff = (3 - day + 7) % 7;
      targetDate = new Date(Date.UTC(targetDate.getUTCFullYear(), targetDate.getUTCMonth(), targetDate.getUTCDate() + diff, 0, 0, 0));
      if (targetDate.getTime() <= Date.now()) {
        targetDate.setUTCDate(targetDate.getUTCDate() + 7);
      }
      showToast('Template disetel: Praktikum SO (Rabu 07:00 WIB)');
    } else if (type === 'tomorrow-morning') {
      targetDate.setDate(targetDate.getDate() + 1);
      targetDate.setHours(7, 0, 0, 0);
      showToast('Template disetel: Besok Pagi 07:00 WIB');
    } else if (type === 'tonight-deadline') {
      targetDate.setHours(23, 55, 0, 0);
      if (targetDate.getTime() <= Date.now()) {
        targetDate.setDate(targetDate.getDate() + 1);
      }
      showToast('Template disetel: Malam Ini 23:55 WIB');
    }

    try {
      await apiRequest('/api/config', 'POST', {
        customUnlockIso: targetDate.toISOString(),
        scheduleMode: 'CUSTOM',
      });
      refreshStatus();
    } catch (err) {
      showToast(`Gagal mengatur jadwal: ${err.message}`);
    }
  });
});

if (linkGoToTugas) {
  linkGoToTugas.addEventListener('click', (e) => {
    e.preventDefault();
    switchTab('tab-tugas');
  });
}

if (quickCourseSelect) {
  quickCourseSelect.addEventListener('change', async () => {
    const selectedCourseId = quickCourseSelect.value;
    if (selectedCourseId) {
      if (courseDropdown && courseDropdown.value !== selectedCourseId) {
        courseDropdown.value = selectedCourseId;
        syncAppleSelect(courseDropdown);
      }
      await apiRequest('/api/config', 'POST', { courseId: selectedCourseId }).catch(() => {});
      await loadCoursesAndAssignments(selectedCourseId);
    }
  });
}

if (quickAssignSelect) {
  quickAssignSelect.addEventListener('change', async () => {
    const val = quickAssignSelect.value;
    if (val) {
      if (quickAssignInput) quickAssignInput.value = val;
      const matched = assignmentsData.find(a => a.name === val);
      const courseId = (quickCourseSelect?.value || courseDropdown?.value || '').trim();
      try {
        await apiRequest('/api/select-assignment', 'POST', {
          courseId: courseId || undefined,
          assignmentName: val,
          cmid: matched?.cmid,
          unlockIso: matched?.availableFromEpochMs ? new Date(matched.availableFromEpochMs).toISOString() : undefined,
        });
        showToast(`Target tugas disetel ke: ${val}`);
        refreshStatus();
      } catch (err) {
        showToast(`Gagal menyimpan target: ${err.message}`);
      }
    }
  });
}

// ----------------------------------------------------------------------------
// Tab Tugas (All Assignments Controller)
// ----------------------------------------------------------------------------

function escapeHtml(str) {
  if (!str) return '';
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function getStatusBadgeLabel(status) {
  if (status === 'SUBMITTED') return 'Sudah Dikumpulkan';
  if (status === 'OPEN') return 'Belum Dikumpulkan';
  if (status === 'OVERDUE') return 'Terlewat (Belum Kumpul)';
  if (status === 'LOCKED') return 'Dikunci (Akan Datang)';
  if (status === 'CLOSED') return 'Ditutup / Terkunci';
  return 'Aktif';
}

async function loadCoursesAndAssignments(forceCourseId = null) {
  if (assignmentsListContainer) {
    assignmentsListContainer.innerHTML = '<div class="list-row"><span class="row-label text-subtle">Memuat daftar mata kuliah dan tugas dari Moodle...</span></div>';
  }

  try {
    const url = forceCourseId ? `/api/assignments?courseId=${encodeURIComponent(forceCourseId)}` : '/api/assignments';
    const res = await apiRequest(url);
    if (res && res.ok) {
      coursesData = res.courses || [];
      assignmentsData = res.assignments || [];

      [courseDropdown, quickCourseSelect].forEach(selectEl => {
        if (!selectEl) return;
        selectEl.innerHTML = '';
        coursesData.forEach(c => {
          const opt = document.createElement('option');
          opt.value = c.id;
          opt.textContent = `${c.name} (${c.id})`;
          if (c.id === res.currentCourseId) opt.selected = true;
          selectEl.appendChild(opt);
        });
        syncAppleSelect(selectEl);
      });

      populateQuickAssignDropdown(assignmentsData);
      renderAssignmentsList();
    } else {
      if (assignmentsListContainer) {
        assignmentsListContainer.innerHTML = `<div class="list-row"><span class="row-label text-subtle" style="color: #D70015;">Gagal memuat tugas: ${res?.error || 'Terjadi kesalahan'}</span></div>`;
      }
    }
  } catch (err) {
    if (assignmentsListContainer) {
      assignmentsListContainer.innerHTML = `<div class="list-row"><span class="row-label text-subtle" style="color: #D70015;">Gagal memuat tugas: ${err.message}</span></div>`;
    }
  }
}

function populateQuickAssignDropdown(assignments) {
  if (!quickAssignSelect) return;
  const currentVal = quickAssignSelect.value || (appState?.config?.assignmentName || '');
  quickAssignSelect.innerHTML = '<option value="">Pilih tugas dari daftar mata kuliah...</option>';
  assignments.forEach(a => {
    const opt = document.createElement('option');
    opt.value = a.name;
    opt.textContent = `${a.name} — [${getStatusBadgeLabel(a.status)}]`;
    if (currentVal && a.name === currentVal) {
      opt.selected = true;
    }
    quickAssignSelect.appendChild(opt);
  });
  syncAppleSelect(quickAssignSelect);
}

function renderAssignmentsList() {
  if (!assignmentsListContainer) return;

  const filtered = assignmentsData.filter(a => {
    if (activeAssignmentFilter === 'all') return true;
    if (activeAssignmentFilter === 'OVERDUE') {
      return a.status === 'OVERDUE' || a.status === 'CLOSED';
    }
    return a.status === activeAssignmentFilter;
  });

  if (filtered.length === 0) {
    assignmentsListContainer.innerHTML = '<div class="list-row"><span class="row-label text-subtle">Tidak ada tugas pada kategori ini.</span></div>';
    return;
  }

  assignmentsListContainer.innerHTML = '';
  filtered.forEach(a => {
    const row = document.createElement('div');
    row.className = 'list-row';
    row.style.display = 'flex';
    row.style.flexDirection = 'column';
    row.style.alignItems = 'stretch';
    row.style.padding = '14px 16px';
    row.style.gap = '8px';

    let badgeClass = 'open';
    if (a.status === 'LOCKED') badgeClass = 'locked';
    else if (a.status === 'OVERDUE') badgeClass = 'overdue';
    else if (a.status === 'SUBMITTED') badgeClass = 'submitted';
    else if (a.status === 'CLOSED') badgeClass = 'closed';
    const badgeLabel = getStatusBadgeLabel(a.status);

    let metaInfo = '';
    if (a.availableFromText) {
      metaInfo += `<div class="footnote" style="font-size: 11.5px; color: #86868B;">Dibuka: ${escapeHtml(a.availableFromText)}</div>`;
    }
    if (a.dueDateText) {
      metaInfo += `<div class="footnote" style="font-size: 11.5px; color: #86868B;">Batas: ${escapeHtml(a.dueDateText)}</div>`;
    }
    if (a.availableUntilText) {
      metaInfo += `<div class="footnote" style="font-size: 11.5px; color: #86868B;">Ditutup: ${escapeHtml(a.availableUntilText)}</div>`;
    }
    if (a.submissionStatusText) {
      metaInfo += `<div class="footnote" style="font-size: 11.5px; color: #6E6E73;">Status Moodle: ${escapeHtml(a.submissionStatusText)}</div>`;
    }

    row.innerHTML = `
      <div style="display: flex; justify-content: space-between; align-items: flex-start; gap: 10px;">
        <div style="flex: 1 1 0%; min-width: 0;">
          <div style="font-size: 14.5px; font-weight: 600; color: #1D1D1F; margin-bottom: 2px; word-break: break-word;">${escapeHtml(a.name)}</div>
          ${metaInfo}
        </div>
        <span class="badge-status ${badgeClass}" style="flex-shrink: 0;">${badgeLabel}</span>
      </div>
      <div style="display: flex; gap: 8px; justify-content: flex-end; margin-top: 4px;">
        <button type="button" class="btn btn-sm btn-select-assign" style="background: rgba(0,113,227,0.08); color: #0071E3; font-size: 12px; padding: 5px 12px; font-weight: 600;">
          Pilih Tugas Ini
        </button>
      </div>
    `;

    row.querySelector('.btn-select-assign')?.addEventListener('click', async () => {
      const courseId = courseDropdown ? courseDropdown.value : (quickCourseSelect ? quickCourseSelect.value : '10983');
      try {
        await apiRequest('/api/select-assignment', 'POST', {
          courseId,
          assignmentName: a.name,
          cmid: a.cmid,
          unlockIso: a.availableFromEpochMs ? new Date(a.availableFromEpochMs).toISOString() : undefined,
        });
        if (quickAssignSelect) {
          quickAssignSelect.value = a.name;
          syncAppleSelect(quickAssignSelect);
        }
        if (quickAssignInput) quickAssignInput.value = a.name;
        showToast(`Target tugas disetel ke: ${a.name}`);
        switchTab('tab-beranda');
        refreshStatus();
      } catch (err) {
        showToast(`Gagal memilih tugas: ${err.message}`);
      }
    });

    assignmentsListContainer.appendChild(row);
  });
}

if (courseDropdown) {
  courseDropdown.addEventListener('change', async () => {
    const selectedCourseId = courseDropdown.value;
    if (quickCourseSelect && quickCourseSelect.value !== selectedCourseId) {
      quickCourseSelect.value = selectedCourseId;
      syncAppleSelect(quickCourseSelect);
    }
    await apiRequest('/api/config', 'POST', { courseId: selectedCourseId }).catch(() => {});
    await loadCoursesAndAssignments(selectedCourseId);
  });
}

if (btnReloadCourses) {
  btnReloadCourses.addEventListener('click', () => {
    loadCoursesAndAssignments(courseDropdown ? courseDropdown.value : null);
  });
}

document.querySelectorAll('.filter-pill').forEach(pill => {
  pill.addEventListener('click', () => {
    document.querySelectorAll('.filter-pill').forEach(p => p.classList.remove('active'));
    pill.classList.add('active');
    activeAssignmentFilter = pill.dataset.filter;
    renderAssignmentsList();
  });
});

// ----------------------------------------------------------------------------
// Apple Native Calendar Controller (Supports All Calendar Cards in DOM)
// ----------------------------------------------------------------------------

const monthNamesId = [
  'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
  'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'
];

let calCurrentYear = new Date().getFullYear();
let calCurrentMonth = new Date().getMonth();
let calSelectedDate = new Date();
calSelectedDate.setHours(7, 0, 0, 0);
if (new Date().getHours() >= 7) {
  calSelectedDate.setDate(calSelectedDate.getDate() + 1);
  calCurrentYear = calSelectedDate.getFullYear();
  calCurrentMonth = calSelectedDate.getMonth();
}

function renderAppleCalendar() {
  const cards = document.querySelectorAll('.apple-calendar-card');
  if (!cards.length) return;

  const firstDayIndex = new Date(calCurrentYear, calCurrentMonth, 1).getDay(); // 0 = Sunday
  const lastDayOfMonth = new Date(calCurrentYear, calCurrentMonth + 1, 0).getDate();
  const prevMonthLastDay = new Date(calCurrentYear, calCurrentMonth, 0).getDate();

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  cards.forEach(card => {
    const titleEl = card.querySelector('.cal-month-title');
    const gridEl = card.querySelector('.cal-days-grid');
    if (titleEl) {
      titleEl.textContent = `${monthNamesId[calCurrentMonth]} ${calCurrentYear}`;
    }
    if (!gridEl) return;
    gridEl.innerHTML = '';

    // Previous month trailing days
    for (let i = firstDayIndex - 1; i >= 0; i--) {
      const dayNum = prevMonthLastDay - i;
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'cal-day other-month';
      btn.disabled = true;
      btn.textContent = dayNum;
      gridEl.appendChild(btn);
    }

    // Current month days
    for (let d = 1; d <= lastDayOfMonth; d++) {
      const thisDate = new Date(calCurrentYear, calCurrentMonth, d);
      thisDate.setHours(0, 0, 0, 0);

      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'cal-day';
      btn.textContent = d;

      if (thisDate.getTime() === today.getTime()) {
        btn.classList.add('today');
      }

      if (thisDate < today) {
        btn.disabled = true;
      }

      const isSel = (
        calSelectedDate.getFullYear() === calCurrentYear &&
        calSelectedDate.getMonth() === calCurrentMonth &&
        calSelectedDate.getDate() === d
      );
      if (isSel) {
        btn.classList.add('selected');
      }

      btn.addEventListener('click', () => {
        userHasModifiedSchedule = true;
        calSelectedDate.setFullYear(calCurrentYear);
        calSelectedDate.setMonth(calCurrentMonth);
        calSelectedDate.setDate(d);
        syncCalendarSelection();
        renderAppleCalendar();
      });

      gridEl.appendChild(btn);
    }

    // Next month leading days
    const totalRendered = firstDayIndex + lastDayOfMonth;
    const remaining = (7 - (totalRendered % 7)) % 7;
    for (let n = 1; n <= remaining; n++) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'cal-day other-month';
      btn.disabled = true;
      btn.textContent = n;
      gridEl.appendChild(btn);
    }
  });
}

function syncCalendarSelection(sourceHourEl = null, sourceMinEl = null) {
  const hourEl = sourceHourEl || document.querySelector('.cal-hour');
  const minEl = sourceMinEl || document.querySelector('.cal-minute');
  const h = parseInt(hourEl ? hourEl.value : '7', 10);
  const m = parseInt(minEl ? minEl.value : '0', 10);
  const validH = isNaN(h) ? 7 : Math.min(23, Math.max(0, h));
  const validM = isNaN(m) ? 0 : Math.min(59, Math.max(0, m));

  calSelectedDate.setHours(validH);
  calSelectedDate.setMinutes(validM);
  calSelectedDate.setSeconds(0, 0);

  // Sync all hour/minute inputs across both tabs
  document.querySelectorAll('.cal-hour').forEach(inp => {
    if (inp !== sourceHourEl && !inp.matches(':focus')) inp.value = validH;
  });
  document.querySelectorAll('.cal-minute').forEach(inp => {
    if (inp !== sourceMinEl && !inp.matches(':focus')) inp.value = validM;
  });

  const dateFormatted = calSelectedDate.toLocaleDateString('id-ID', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
  const pad = (n) => String(n).padStart(2, '0');
  const timeFormatted = `${pad(calSelectedDate.getHours())}:${pad(calSelectedDate.getMinutes())}:00 WIB`;
  const previewText = `Target: ${dateFormatted}, pukul ${timeFormatted}`;

  document.querySelectorAll('.cal-selected-preview').forEach(el => {
    el.textContent = previewText;
  });
}

document.querySelectorAll('.cal-prev-month').forEach(btn => {
  btn.addEventListener('click', () => {
    calCurrentMonth--;
    if (calCurrentMonth < 0) {
      calCurrentMonth = 11;
      calCurrentYear--;
    }
    renderAppleCalendar();
  });
});

document.querySelectorAll('.cal-next-month').forEach(btn => {
  btn.addEventListener('click', () => {
    calCurrentMonth++;
    if (calCurrentMonth > 11) {
      calCurrentMonth = 0;
      calCurrentYear++;
    }
    renderAppleCalendar();
  });
});

document.querySelectorAll('.cal-hour').forEach(inp => {
  inp.addEventListener('input', () => {
    userHasModifiedSchedule = true;
    syncCalendarSelection(inp, null);
  });
});

document.querySelectorAll('.cal-minute').forEach(inp => {
  inp.addEventListener('input', () => {
    userHasModifiedSchedule = true;
    syncCalendarSelection(null, inp);
  });
});

if (btnQuickTomorrow) {
  btnQuickTomorrow.addEventListener('click', () => {
    userHasModifiedSchedule = true;
    if (cfgScheduleMode) {
      cfgScheduleMode.value = 'CUSTOM';
      syncAppleSelect(cfgScheduleMode);
    }
    if (wrapperCustomSchedule) wrapperCustomSchedule.classList.remove('hidden');
    const d = new Date();
    d.setDate(d.getDate() + 1);
    calCurrentYear = d.getFullYear();
    calCurrentMonth = d.getMonth();
    calSelectedDate = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 7, 0, 0, 0);
    document.querySelectorAll('.cal-hour').forEach(inp => { inp.value = 7; });
    document.querySelectorAll('.cal-minute').forEach(inp => { inp.value = 0; });
    syncCalendarSelection();
    renderAppleCalendar();
  });
}

if (btnQuickFriday) {
  btnQuickFriday.addEventListener('click', () => {
    userHasModifiedSchedule = true;
    if (cfgScheduleMode) {
      cfgScheduleMode.value = 'CUSTOM';
      syncAppleSelect(cfgScheduleMode);
    }
    if (wrapperCustomSchedule) wrapperCustomSchedule.classList.remove('hidden');
    const now = new Date();
    const day = now.getDay();
    let daysToAdd = (5 - day + 7) % 7;
    if (daysToAdd === 0 && now.getHours() >= 7) daysToAdd = 7;
    const fri = new Date(now.getFullYear(), now.getMonth(), now.getDate() + daysToAdd, 7, 0, 0, 0);
    calCurrentYear = fri.getFullYear();
    calCurrentMonth = fri.getMonth();
    calSelectedDate = fri;
    document.querySelectorAll('.cal-hour').forEach(inp => { inp.value = 7; });
    document.querySelectorAll('.cal-minute').forEach(inp => { inp.value = 0; });
    syncCalendarSelection();
    renderAppleCalendar();
  });
}

if (btnQuickWednesday) {
  btnQuickWednesday.addEventListener('click', () => {
    userHasModifiedSchedule = true;
    if (cfgScheduleMode) {
      cfgScheduleMode.value = 'CUSTOM';
      syncAppleSelect(cfgScheduleMode);
    }
    if (wrapperCustomSchedule) wrapperCustomSchedule.classList.remove('hidden');
    const now = new Date();
    const day = now.getDay();
    let daysToAdd = (3 - day + 7) % 7;
    if (daysToAdd === 0 && now.getHours() >= 7) daysToAdd = 7;
    const wed = new Date(now.getFullYear(), now.getMonth(), now.getDate() + daysToAdd, 7, 0, 0, 0);
    calCurrentYear = wed.getFullYear();
    calCurrentMonth = wed.getMonth();
    calSelectedDate = wed;
    document.querySelectorAll('.cal-hour').forEach(inp => { inp.value = 7; });
    document.querySelectorAll('.cal-minute').forEach(inp => { inp.value = 0; });
    syncCalendarSelection();
    renderAppleCalendar();
  });
}

if (cfgScheduleMode) {
  cfgScheduleMode.addEventListener('change', () => {
    userHasModifiedSchedule = true;
    if (wrapperCustomSchedule) {
      wrapperCustomSchedule.classList.toggle('hidden', cfgScheduleMode.value !== 'CUSTOM');
    }
    if (cfgScheduleMode.value === 'CUSTOM') {
      renderAppleCalendar();
      syncCalendarSelection();
    }
  });
}

// Render calendar immediately on script load so it is never blank
renderAppleCalendar();
syncCalendarSelection();

// ----------------------------------------------------------------------------
// Apple Native Pop-up Select Controller (macOS / iOS HIG)
// ----------------------------------------------------------------------------

function initAppleSelect(select) {
  if (!select || select.dataset.appleSelectInitialized) return;
  select.dataset.appleSelectInitialized = 'true';

  const wrapper = document.createElement('div');
  wrapper.className = 'apple-select-container';

  const trigger = document.createElement('button');
  trigger.type = 'button';
  trigger.className = 'apple-select-trigger';
  trigger.setAttribute('aria-haspopup', 'listbox');
  trigger.setAttribute('aria-expanded', 'false');

  const labelSpan = document.createElement('span');
  labelSpan.className = 'apple-select-label';

  const chevronSpan = document.createElement('span');
  chevronSpan.className = 'apple-select-chevron';
  chevronSpan.innerHTML = `
    <svg width="10" height="14" viewBox="0 0 10 14" fill="none">
      <path d="M2 5L5 2L8 5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>
      <path d="M2 9L5 12L8 9" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>
  `;

  trigger.appendChild(labelSpan);
  trigger.appendChild(chevronSpan);

  const menu = document.createElement('div');
  menu.className = 'apple-select-menu hidden';
  menu.setAttribute('role', 'listbox');

  function updateTriggerLabel() {
    const selectedOpt = select.options[select.selectedIndex];
    labelSpan.textContent = selectedOpt ? selectedOpt.textContent : '';
    menu.querySelectorAll('.apple-select-item').forEach(item => {
      item.classList.toggle('selected', item.dataset.value === select.value);
    });
  }

  function renderMenuOptions() {
    menu.innerHTML = '';
    const selectedVal = select.value;
    const selectedOpt = select.options[select.selectedIndex];
    labelSpan.textContent = selectedOpt ? selectedOpt.textContent : '';

    Array.from(select.options).forEach(opt => {
      const item = document.createElement('div');
      item.className = 'apple-select-item';
      item.setAttribute('role', 'option');
      item.dataset.value = opt.value;
      if (opt.value === selectedVal) item.classList.add('selected');

      const text = document.createElement('span');
      text.className = 'item-text';
      text.textContent = opt.textContent;
      item.appendChild(text);

      const check = document.createElement('span');
      check.className = 'item-check';
      check.innerHTML = `
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
          <path d="M3.5 8.5L6.5 11.5L12.5 4.5" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
      `;
      item.appendChild(check);

      item.addEventListener('click', (e) => {
        e.stopPropagation();
        select.value = opt.value;
        select.dispatchEvent(new Event('change', { bubbles: true }));
        updateTriggerLabel();
        closeMenu();
      });

      menu.appendChild(item);
    });
  }

  function openMenu() {
    document.querySelectorAll('.apple-select-menu:not(.hidden)').forEach(m => {
      if (m !== menu) m.classList.add('hidden');
    });
    document.querySelectorAll('.apple-select-trigger.active').forEach(t => {
      if (t !== trigger) {
        t.classList.remove('active');
        t.setAttribute('aria-expanded', 'false');
      }
    });

    renderMenuOptions();
    menu.classList.remove('hidden');
    trigger.classList.add('active');
    trigger.setAttribute('aria-expanded', 'true');
  }

  function closeMenu() {
    menu.classList.add('hidden');
    trigger.classList.remove('active');
    trigger.setAttribute('aria-expanded', 'false');
  }

  trigger.addEventListener('click', (e) => {
    e.stopPropagation();
    if (menu.classList.contains('hidden')) {
      openMenu();
    } else {
      closeMenu();
    }
  });

  document.addEventListener('click', (e) => {
    if (!wrapper.contains(e.target)) {
      closeMenu();
    }
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !menu.classList.contains('hidden')) {
      closeMenu();
    }
  });

  select.addEventListener('change', () => {
    updateTriggerLabel();
  });

  if (select.style.flex) {
    wrapper.style.flex = select.style.flex;
    wrapper.style.minWidth = '0';
  }
  if (select.parentElement && (select.parentElement.classList.contains('course-picker-row') || window.getComputedStyle(select.parentElement).display === 'flex')) {
    wrapper.style.flex = select.style.flex || '1 1 0%';
    wrapper.style.minWidth = '0';
  }

  // Insert wrapper before select in DOM
  select.parentNode.insertBefore(wrapper, select);
  wrapper.appendChild(select);
  wrapper.appendChild(trigger);
  wrapper.appendChild(menu);

  // Visually hide native select while keeping it functional for forms
  select.style.position = 'absolute';
  select.style.opacity = '0';
  select.style.pointerEvents = 'none';
  select.style.height = '0';
  select.style.width = '0';
  select.style.margin = '0';
  select.style.padding = '0';
  select.style.border = 'none';

  select._syncAppleSelect = updateTriggerLabel;
  updateTriggerLabel();
}

function syncAppleSelect(select) {
  if (select && typeof select._syncAppleSelect === 'function') {
    select._syncAppleSelect();
  }
}

// Initialize all Apple selects
document.querySelectorAll('select.apple-select').forEach(initAppleSelect);


if (configForm) {
  configForm.addEventListener('submit', async (e) => {
    e.preventDefault();

    const cfg = {
      moodleBase: cfgMoodleTarget ? cfgMoodleTarget.value.trim() : undefined,
      autoWeekly: cfgAutoWeekly ? cfgAutoWeekly.checked : undefined,
      dryRun: cfgDryRun ? cfgDryRun.checked : undefined,
      unlockAtOverride: (cfgUnlockOverride && cfgUnlockOverride.value.trim()) ? cfgUnlockOverride.value.trim() : null,
    };

    // Custom User
    if (cfgMoodleUser && cfgMoodleUser.value.trim()) {
      cfg.moodleUser = cfgMoodleUser.value.trim();
    }
    // Custom Pass (only send if filled)
    if (cfgMoodlePass && cfgMoodlePass.value.trim()) {
      cfg.moodlePass = cfgMoodlePass.value.trim();
    }

    // Telegram overrides
    if (cfgTelegramToken && cfgTelegramToken.value.trim()) {
      cfg.telegramBotToken = cfgTelegramToken.value.trim();
    }
    if (cfgTelegramChat && cfgTelegramChat.value.trim()) {
      cfg.telegramChatId = cfgTelegramChat.value.trim();
    }

    try {
      const res = await apiRequest('/api/config', 'POST', cfg);
      if (res.ok) {
        showToast('Pengaturan akun dan server berhasil diperbarui!');
        if (cfgMoodlePass) cfgMoodlePass.value = '';
        if (cfgTelegramToken) cfgTelegramToken.value = '';
        refreshStatus();
      }
    } catch (e) {
      showToast(`Error: ${e.message}`);
    }
  });
}

if (btnTestTelegram) {
  btnTestTelegram.addEventListener('click', async () => {
    try {
      const res = await apiRequest('/api/test-notify', 'POST');
      if (res.ok) {
        showToast('Pesan uji coba berhasil terkirim ke Telegram Anda!');
      } else {
        showToast(`Gagal kirim Telegram: ${res.error}`);
      }
    } catch (e) {
      showToast(`Error: ${e.message}`);
    }
  });
}

// ----------------------------------------------------------------------------
// Logs & Global Audit
// ----------------------------------------------------------------------------

function setLogSubtab(tab) {
  currentLogSubtab = tab;
  if (tab === 'my-logs') {
    if (btnSubtabMyLogs) {
      btnSubtabMyLogs.style.background = '#0071E3';
      btnSubtabMyLogs.style.color = '#fff';
      btnSubtabMyLogs.style.fontWeight = '600';
    }
    if (btnSubtabGlobalLogs) {
      btnSubtabGlobalLogs.style.background = 'rgba(0,0,0,0.06)';
      btnSubtabGlobalLogs.style.color = '#1D1D1F';
      btnSubtabGlobalLogs.style.fontWeight = '500';
    }
    if (sectionMyLogs) sectionMyLogs.classList.remove('hidden');
    if (sectionGlobalLogs) sectionGlobalLogs.classList.add('hidden');
    refreshLogs();
  } else {
    if (btnSubtabMyLogs) {
      btnSubtabMyLogs.style.background = 'rgba(0,0,0,0.06)';
      btnSubtabMyLogs.style.color = '#1D1D1F';
      btnSubtabMyLogs.style.fontWeight = '500';
    }
    if (btnSubtabGlobalLogs) {
      btnSubtabGlobalLogs.style.background = '#0071E3';
      btnSubtabGlobalLogs.style.color = '#fff';
      btnSubtabGlobalLogs.style.fontWeight = '600';
    }
    if (sectionMyLogs) sectionMyLogs.classList.add('hidden');
    if (sectionGlobalLogs) sectionGlobalLogs.classList.remove('hidden');
    refreshGlobalLogs();
  }
}

if (btnSubtabMyLogs) btnSubtabMyLogs.addEventListener('click', () => setLogSubtab('my-logs'));
if (btnSubtabGlobalLogs) btnSubtabGlobalLogs.addEventListener('click', () => setLogSubtab('global-logs'));
if (btnRefreshGlobalLogs) btnRefreshGlobalLogs.addEventListener('click', () => refreshGlobalLogs());

async function refreshLogs() {
  try {
    const logs = await apiRequest('/api/logs?limit=80');
    if (!Array.isArray(logs) || logs.length === 0) {
      logsList.innerHTML = '<div class="list-row"><span class="row-label text-subtle">Belum ada aktivitas di ruang kerja ini.</span></div>';
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

async function refreshGlobalLogs() {
  if (!globalLogsList) return;
  try {
    const res = await apiRequest('/api/global-logs?limit=100');
    const audits = Array.isArray(res) ? res : (Array.isArray(res?.audits) ? res.audits : []);
    if (audits.length === 0) {
      globalLogsList.innerHTML = '<div class="list-row"><span class="row-label text-subtle">Belum ada catatan audit pengguna di server.</span></div>';
      return;
    }

    globalLogsList.innerHTML = audits
      .slice()
      .reverse()
      .map((a) => {
        const timestamp = a.t || a.timestamp || Date.now();
        const d = new Date(timestamp);
        const dateStr = d.toLocaleDateString('id-ID', { day: 'numeric', month: 'short' });
        const timeStr = d.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', second: '2-digit' });

        let statusBadge = '';
        if (a.status === 'SUCCESS') {
          statusBadge = '<span style="background: rgba(52,199,89,0.15); color: #28a745; padding: 2px 6px; border-radius: 4px; font-weight: 600; font-size: 11px;">SUKSES</span>';
        } else if (a.status === 'FAILED') {
          statusBadge = '<span style="background: rgba(215,0,21,0.15); color: #d70015; padding: 2px 6px; border-radius: 4px; font-weight: 600; font-size: 11px;">GAGAL</span>';
        } else {
          statusBadge = `<span style="background: rgba(0,113,227,0.12); color: #0071E3; padding: 2px 6px; border-radius: 4px; font-weight: 600; font-size: 11px;">${a.status}</span>`;
        }

        const detailsObj = (typeof a.details === 'object' && a.details !== null) ? a.details : {};
        const detailsArr = [];
        const elapsed = a.elapsedMs !== undefined ? a.elapsedMs : detailsObj.elapsedMs;
        if (elapsed !== undefined && elapsed !== null) detailsArr.push(`${elapsed} ms`);
        const file = a.fileName || detailsObj.fileName;
        if (file) detailsArr.push(`Berkas: ${file}`);
        const assign = a.assignmentName || detailsObj.assignment;
        if (assign) detailsArr.push(`Tugas: ${assign}`);
        if (detailsObj.step) detailsArr.push(`Tahap: ${detailsObj.step}`);
        if (detailsObj.unlockAt) detailsArr.push(`Target: ${detailsObj.unlockAt}`);
        const err = a.error || detailsObj.error;
        if (err) detailsArr.push(`<span style="color: #d70015;">Error: ${err}</span>`);
        if (typeof a.details === 'string') detailsArr.push(a.details);
        const detailsStr = detailsArr.join(' · ');

        return `
          <div class="list-row" style="padding: 10px 16px;">
            <div class="row-main">
              <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 2px;">
                <span style="background: rgba(0,0,0,0.06); color: #1D1D1F; font-family: monospace; font-size: 11.5px; font-weight: 600; padding: 1px 6px; border-radius: 4px;">NIM ${a.nim}</span>
                <span class="row-label" style="font-size: 13.5px; font-weight: 600;">${a.action}</span>
                ${statusBadge}
              </div>
              <span class="row-meta mono" style="font-size: 12px; color: #6e6e73;">
                ${dateStr} ${timeStr} ${detailsStr ? '— ' + detailsStr : ''}
              </span>
            </div>
          </div>
        `;
      })
      .join('');
  } catch (err) {
    globalLogsList.innerHTML = `<div class="list-row"><span class="row-label text-subtle" style="color: #d70015;">Gagal memuat log audit: ${err.message}</span></div>`;
  }
}

// ----------------------------------------------------------------------------
// Auth
// ----------------------------------------------------------------------------

loginForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  loginError.classList.add('hidden');
  const nim = loginNimInput ? loginNimInput.value.trim() : '';
  const password = loginMoodlePassInput ? loginMoodlePassInput.value.trim() : '';

  if (!nim || !password) {
    loginError.textContent = 'Harap masukkan NIM dan Password Cybercampus Anda.';
    loginError.classList.remove('hidden');
    return;
  }

  const origBtnText = btnLoginSubmit ? btnLoginSubmit.textContent : 'Masuk ke AutoSubmit';
  if (btnLoginSubmit) {
    btnLoginSubmit.disabled = true;
    btnLoginSubmit.textContent = 'Memverifikasi ke Moodle UNAIR...';
  }

  try {
    const res = await fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password, nim }),
    });
    const json = await res.json();

    if (json.ok) {
      if (nim) localStorage.setItem('last_nim', nim);
      if (loginMoodlePassInput) loginMoodlePassInput.value = '';
      showApp();
      await refreshStatus();
    } else {
      loginError.textContent = json.error || 'NIM atau Password Moodle salah.';
      loginError.classList.remove('hidden');
    }
  } catch (err) {
    loginError.textContent = `Gagal verifikasi login: ${err.message}`;
    loginError.classList.remove('hidden');
  } finally {
    if (btnLoginSubmit) {
      btnLoginSubmit.disabled = false;
      btnLoginSubmit.textContent = origBtnText;
    }
  }
});

btnLogout.addEventListener('click', async () => {
  await fetch('/api/logout', { method: 'POST' });
  if (userNimPill) userNimPill.textContent = 'NIM: --';
  showLogin();
});

// Initialize
(async () => {
  if (loginNimInput && localStorage.getItem('last_nim')) {
    loginNimInput.value = localStorage.getItem('last_nim');
  }
  try {
    await refreshStatus();
    updatePing();
    loadCoursesAndAssignments();

    // Dynamic polling: 3s during active phases/simulation, 15s when idle/done
    const pollLoop = async () => {
      try {
        await refreshStatus();
      } catch {}
      const activePhases = ['ARMED', 'PREPARING', 'PREPARED', 'WAITING', 'POLLING', 'SUBMITTING'];
      const delay = appState && activePhases.includes(appState.phase) ? 3000 : 15000;
      setTimeout(pollLoop, delay);
    };
    setTimeout(pollLoop, 3000);
    setInterval(updatePing, 30000);
  } catch {
    showLogin();
  }
})();
