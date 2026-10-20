/**
 * mock-moodle/src/ui.ts
 * 1:1 Replica UI for Hebat E-Learning UNAIR (Gen 2 & Moodle 4.x)
 * Includes integrated Floating Referee & Duel Leaderboard
 */

export interface MockAppState {
  unlockTimestampMs: number;
  lagMs: number;
  offsetMs: number;
  drafts: Array<{
    itemId: number;
    fileName: string;
    size: number;
    author: string;
    createdAt: number;
  }>;
  submissions: Array<{
    rank: number;
    cmid: number;
    fileName: string;
    size: number;
    draftItemId: number;
    submittedAt: number;
    timeFromUnlockMs: number;
    status: string;
    botName?: string;
    userAgent?: string;
  }>;
  trafficLogs: Array<{
    id: string;
    timestamp: number;
    method: string;
    path: string;
    query: string;
    status: number;
    note: string;
    elapsedMs: number;
  }>;
}

/**
 * Common Floating Referee & Arena Duel Drawer
 */
export function renderRefereeDrawer(baseUrl: string): string {
  return `
<!-- BEGIN: Referee Floating Pill & Drawer -->
<div id="referee-pill" class="fixed bottom-6 left-6 z-50">
  <button onclick="toggleRefereeDrawer()" class="flex items-center space-x-2.5 px-4 py-2.5 bg-[#0f172a]/95 hover:bg-[#0f172a] text-white rounded-full shadow-2xl backdrop-blur-md border border-slate-700/60 text-xs font-bold transition-all transform hover:scale-105 cursor-pointer">
    <span class="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-pulse"></span>
    <span class="tracking-wide">⚡ Wasit Arena (Duel Leaderboard)</span>
  </button>
</div>

<!-- Modal / Drawer Backdrop -->
<div id="referee-modal" class="fixed inset-0 bg-slate-950/60 backdrop-blur-sm z-50 hidden flex items-center justify-center p-4">
  <div class="bg-[#0f172a] text-slate-100 w-full max-w-4xl max-h-[90vh] rounded-2xl shadow-2xl border border-slate-800 flex flex-col overflow-hidden font-sans">
    
    <!-- Header -->
    <div class="px-6 py-4 bg-slate-900 border-b border-slate-800 flex items-center justify-between">
      <div class="flex items-center space-x-3">
        <div class="w-8 h-8 rounded-lg bg-yellow-400 text-slate-950 flex items-center justify-center font-black text-sm">
          ⚖️
        </div>
        <div>
          <h2 class="text-base font-bold text-white tracking-tight">Wasit Netral HEBAT UNAIR (Sandbox Race Arena)</h2>
          <p class="text-xs text-slate-400">Pencatat waktu mutlak sisi server (single source of truth) untuk adu kecepatan bot</p>
        </div>
      </div>
      <button onclick="toggleRefereeDrawer()" class="text-slate-400 hover:text-white p-2 text-xl font-bold leading-none cursor-pointer">✕</button>
    </div>

    <!-- Body Content (Scrollable) -->
    <div class="p-6 overflow-y-auto space-y-6 flex-1 text-xs">
      
      <!-- Section 1: Live Status & Race Leaderboard -->
      <div class="bg-slate-900/80 border border-slate-800 rounded-xl p-5">
        <div class="flex items-center justify-between mb-4">
          <div class="flex items-center space-x-2.5">
            <span class="text-lg">🏆</span>
            <h3 class="text-sm font-bold text-white">Leaderboard Adu Cepat (Kedatangan Paket Submit)</h3>
          </div>
          <div id="ref-status-badge" class="px-3 py-1 rounded-full text-xs font-semibold bg-amber-500/20 text-amber-300 border border-amber-500/30">
            Memuat status...
          </div>
        </div>

        <div class="overflow-x-auto">
          <table class="w-full text-left border-collapse">
            <thead>
              <tr class="border-b border-slate-800 text-slate-400 font-semibold">
                <th class="py-2.5 px-3">Peringkat</th>
                <th class="py-2.5 px-3">Identitas Bot</th>
                <th class="py-2.5 px-3">Waktu Tiba di Server</th>
                <th class="py-2.5 px-3">Delta Jam Buka</th>
                <th class="py-2.5 px-3">Berkas Dikirim</th>
                <th class="py-2.5 px-3">Status</th>
              </tr>
            </thead>
            <tbody id="ref-leaderboard-body" class="divide-y divide-slate-800/60 text-slate-200">
              <tr>
                <td colspan="6" class="py-4 text-center text-slate-500 italic">
                  Belum ada bot yang melakukan submit. Jalankan kedua bot untuk memulai perlombaan!
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <!-- Section 2: Sandbox Control Panel -->
      <div class="bg-slate-900/80 border border-slate-800 rounded-xl p-5">
        <h3 class="text-sm font-bold text-white mb-3 flex items-center gap-2">
          <span>🎮</span> Kontrol Waktu Buka & Simulasi Jaringan
        </h3>
        <p class="text-slate-400 mb-4 leading-relaxed">
          Atur kapan tugas modul dibuka agar kedua bot bisa bersiap di jendela T-minus dan menembak tepat di detik ke-00.
        </p>
        
        <div class="grid grid-cols-2 sm:grid-cols-4 gap-2.5 mb-3">
          <button onclick="refSetUnlock(30)" class="px-3 py-2.5 bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold rounded-lg transition text-center cursor-pointer">
            ⏱️ Buka 30 Detik Lagi
          </button>
          <button onclick="refSetUnlock(60)" class="px-3 py-2.5 bg-slate-800 hover:bg-slate-700 text-white font-bold rounded-lg transition text-center cursor-pointer">
            ⏱️ Buka 1 Menit Lagi
          </button>
          <button onclick="refSetUnlock(0)" class="px-3 py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white font-bold rounded-lg transition text-center cursor-pointer">
            🔓 Buka Sekarang (T=0)
          </button>
          <button onclick="refSetUnlock(-999999)" class="px-3 py-2.5 bg-rose-600 hover:bg-rose-500 text-white font-bold rounded-lg transition text-center cursor-pointer">
            🔒 Kunci Sekarang
          </button>
        </div>

        <div class="flex flex-wrap items-center gap-2.5 pt-1">
          <button onclick="refToggleLag()" id="ref-lag-btn" class="px-3 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg font-medium transition cursor-pointer">
            🐢 Toggle Lag Server (0ms)
          </button>
          <button onclick="refResetState()" class="px-3 py-2 bg-rose-950/60 hover:bg-rose-900/80 text-rose-300 border border-rose-800/40 rounded-lg font-medium transition ml-auto cursor-pointer">
            🧹 Reset Semua Data Duel
          </button>
        </div>
      </div>

      <!-- Section 3: Live Neutral Traffic Inspector -->
      <div class="bg-slate-900/80 border border-slate-800 rounded-xl p-5">
        <div class="flex items-center justify-between mb-3">
          <h3 class="text-sm font-bold text-white flex items-center gap-2">
            <span>📡</span> Live HTTP Traffic Audit (Log Netral)
          </h3>
          <span class="text-[11px] text-slate-400">Presisi milidetik mutlak</span>
        </div>
        <div id="ref-traffic-box" class="h-48 overflow-y-auto font-mono text-[11px] bg-slate-950 p-3 rounded-lg border border-slate-800 divide-y divide-slate-850 space-y-1">
          <div class="text-slate-500 py-1">Menunggu request dari bot...</div>
        </div>
      </div>

    </div>

    <!-- Footer -->
    <div class="px-6 py-3 bg-slate-900 border-t border-slate-800 flex items-center justify-between text-slate-400">
      <span>Target Mock URL: <code class="text-yellow-400 font-mono">${baseUrl}</code></span>
      <button onclick="refetchState()" class="px-3 py-1 bg-slate-800 hover:bg-slate-700 text-white rounded text-xs cursor-pointer">Refresh Data</button>
    </div>
  </div>
</div>

<script>
  let isRefereeOpen = false;
  let refState = null;

  function toggleRefereeDrawer() {
    isRefereeOpen = !isRefereeOpen;
    const modal = document.getElementById('referee-modal');
    if (modal) {
      if (isRefereeOpen) {
        modal.classList.remove('hidden');
        refetchState();
      } else {
        modal.classList.add('hidden');
      }
    }
  }

  async function refetchState() {
    try {
      const res = await fetch('/mock-api/state');
      if (!res.ok) return;
      refState = await res.json();
      updateRefereeUI(refState);
    } catch(e) {
      console.error('Failed to fetch mock state', e);
    }
  }

  function updateRefereeUI(state) {
    if (!state) return;
    const now = Date.now();
    const isLocked = now < state.unlockTimestampMs;
    const badge = document.getElementById('ref-status-badge');
    const unlockDate = new Date(state.unlockTimestampMs);
    const unlockTimeStr = unlockDate.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', second: '2-digit' });

    if (badge) {
      if (isLocked) {
        const secLeft = Math.max(0, Math.floor((state.unlockTimestampMs - now)/1000));
        badge.className = 'px-3 py-1 rounded-full text-xs font-semibold bg-amber-500/20 text-amber-300 border border-amber-500/30';
        badge.textContent = '🔒 Terkunci (Buka: ' + unlockTimeStr + ' WIB / ' + secLeft + 's lagi)';
      } else {
        badge.className = 'px-3 py-1 rounded-full text-xs font-semibold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30';
        badge.textContent = '🔓 Terbuka (Sejak ' + unlockTimeStr + ' WIB)';
      }
    }

    const lagBtn = document.getElementById('ref-lag-btn');
    if (lagBtn) {
      lagBtn.textContent = state.lagMs > 0 ? '🐢 Lag Server Aktif (+' + state.lagMs + 'ms)' : '⚡ Lag Server: Normal (0ms)';
      lagBtn.className = state.lagMs > 0 ? 'px-3 py-2 bg-rose-900/60 text-rose-200 border border-rose-700 rounded-lg font-medium transition cursor-pointer' : 'px-3 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg font-medium transition cursor-pointer';
    }

    // Render Leaderboard
    const lbBody = document.getElementById('ref-leaderboard-body');
    if (lbBody) {
      if (state.submissions && state.submissions.length > 0) {
        lbBody.innerHTML = state.submissions.map((s, idx) => {
          const rankBadge = idx === 0 ? '🥇 #1 JUARA' : idx === 1 ? '🥈 #2' : '#' + (idx + 1);
          const tDate = new Date(s.submittedAt);
          const tStr = tDate.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', second: '2-digit', fractionalSecondDigits: 3 });
          const deltaColor = s.timeFromUnlockMs <= 200 ? 'text-emerald-400 font-bold' : s.timeFromUnlockMs <= 1000 ? 'text-yellow-400' : 'text-slate-300';
          return \`
            <tr class="hover:bg-slate-800/40 transition">
              <td class="py-3 px-3 font-bold text-amber-400">\${rankBadge}</td>
              <td class="py-3 px-3">
                <span class="font-semibold text-white">\${s.botName || 'Bot Pelajar'}</span>
                <span class="block text-[10px] text-slate-400 truncate max-w-[200px]" title="\${s.userAgent || ''}">\${s.userAgent || 'HTTP Agent'}</span>
              </td>
              <td class="py-3 px-3 font-mono">\${tStr}</td>
              <td class="py-3 px-3 font-mono \${deltaColor}">+\${s.timeFromUnlockMs} ms</td>
              <td class="py-3 px-3">
                <a href="/mock-api/download-file?id=\${s.draftItemId}" target="_blank" class="text-cyan-400 hover:underline truncate block max-w-[150px]">\${s.fileName}</a>
                <span class="text-[10px] text-slate-400">\${Math.round(s.size/1024)} KB</span>
              </td>
              <td class="py-3 px-3">
                <span class="px-2 py-0.5 rounded text-[10px] bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">Diterima</span>
              </td>
            </tr>
          \`;
        }).join('');
      } else {
        lbBody.innerHTML = '<tr><td colspan="6" class="py-4 text-center text-slate-500 italic">Belum ada bot yang melakukan submit. Jalankan kedua bot untuk memulai perlombaan!</td></tr>';
      }
    }

    // Render Traffic Logs
    const trafBox = document.getElementById('ref-traffic-box');
    if (trafBox && state.trafficLogs) {
      if (state.trafficLogs.length > 0) {
        trafBox.innerHTML = state.trafficLogs.slice().reverse().map(l => {
          const t = new Date(l.timestamp).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', second: '2-digit', fractionalSecondDigits: 3 });
          const statusCls = l.status === 200 ? 'text-emerald-400' : l.status === 303 ? 'text-yellow-400' : 'text-rose-400';
          return \`
            <div class="py-0.5 flex items-center gap-2">
              <span class="text-slate-500">\${t}</span>
              <span class="text-cyan-400 font-bold w-12">\${l.method}</span>
              <span class="\${statusCls} font-bold w-8">\${l.status}</span>
              <span class="text-slate-300 truncate flex-1">\${l.path} \${l.note ? '— ' + l.note : ''}</span>
              <span class="text-slate-500">\${l.elapsedMs}ms</span>
            </div>
          \`;
        }).join('');
      }
    }
  }

  async function refSetUnlock(seconds) {
    await fetch('/mock-api/set-unlock', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ seconds })
    });
    refetchState();
  }

  async function refToggleLag() {
    const newLag = refState && refState.lagMs > 0 ? 0 : 500;
    await fetch('/mock-api/set-lag', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ lagMs: newLag })
    });
    refetchState();
  }

  async function refResetState() {
    if (!confirm('Reset semua data perlombaan, draft, dan traffic log?')) return;
    await fetch('/mock-api/reset', { method: 'POST' });
    refetchState();
  }

  // Periodic polling when modal is open
  setInterval(() => {
    if (isRefereeOpen) refetchState();
  }, 1000);
</script>
<!-- END: Referee Floating Pill & Drawer -->
`;
}

/**
 * 1. LANDING PAGE HEBAT GEN 2
 */
export function renderLandingHtml(baseUrl: string): string {
  return `<!DOCTYPE html><html lang="id"><head>
<meta charset="utf-8">
<meta content="width=device-width, initial-scale=1.0" name="viewport">
<title>Hebat Gen 2 - Universitas Airlangga</title>
<!-- Google Fonts: Inter & Caveat for Script Highlights -->
<link href="https://fonts.googleapis.com" rel="preconnect">
<link crossorigin="" href="https://fonts.gstatic.com" rel="preconnect">
<link href="https://fonts.googleapis.com/css2?family=Caveat:wght@700&amp;family=Plus+Jakarta+Sans:wght@400;500;600;700;800;900&amp;display=swap" rel="stylesheet">
<!-- Tailwind CSS v3 -->
<script src="https://cdn.tailwindcss.com?plugins=forms,container-queries"></script>
<script>
    tailwind.config = {
      theme: {
        extend: {
          fontFamily: {
            sans: ['"Plus Jakarta Sans"', 'sans-serif'],
            script: ['Caveat', 'cursive'],
          },
          colors: {
            unairNavy: '#284196',
            unairYellow: '#fcb813',
            unairCyan: '#00c3ff',
            unairDarkRed: '#b00000',
            unairGrayBg: '#787878',
            unairHeroBg: '#e2ebfa',
            unairLightBg: '#f8fafc',
          }
        }
      }
    }
  </script>
<style data-purpose="custom-typography">
    .font-script {
      font-family: 'Caveat', cursive;
    }
    .marker-cyan {
      background: linear-gradient(180deg, transparent 60%, #b8f0ff 60%);
    }
    .marker-pink {
      background: linear-gradient(180deg, transparent 60%, #ffd0db 60%);
    }
  </style>
<style data-purpose="organic-shapes">
    /* Organic clip shape mimicking the hero statue image mask in screenshot */
    .hero-statue-shape {
      border-radius: 46% 54% 48% 52% / 60% 40% 60% 40%;
      overflow: hidden;
      box-shadow: 0 10px 30px -10px rgba(0, 0, 0, 0.2);
    }
  </style>
</head>
<body class="bg-white text-slate-800 font-sans antialiased selection:bg-blue-200">
<!-- BEGIN: MainHeader -->
<header class="w-full bg-unairHeroBg/60 backdrop-blur-sm sticky top-0 z-40 border-b border-blue-100/40">
<div class="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
<!-- Brand Logos -->
<div class="flex items-center gap-3">
  <a href="/" class="block">
    <img src="/assets/logo_unair_combined.png" alt="Logo Kemdikbud, Universitas Airlangga, Kampus Merdeka" class="h-10 md:h-12 w-auto object-contain">
  </a>
</div>
<!-- Navigation Menu -->
<nav class="hidden md:flex items-center space-x-7 text-xs font-semibold text-slate-800">
<a class="hover:text-blue-700 transition-colors" href="#beranda">Beranda</a>
<a class="hover:text-blue-700 transition-colors" href="#tentang">Tentang Kami</a>
<a class="hover:text-blue-700 transition-colors" href="#panduan">Helpdesk &amp; Panduan</a>
<a class="hover:text-blue-700 transition-colors" href="#arsip">Arsip</a>
<a class="text-blue-700 font-bold hover:text-blue-800 transition-colors" href="#partner">Partner &amp; Statistik</a>
<a class="px-4 py-1.5 rounded-full bg-[#294297] text-white text-xs font-bold shadow hover:bg-blue-900 transition" href="/login/index.php">
  Login
</a>
</nav>
</div>
</header>
<!-- END: MainHeader -->

<!-- BEGIN: HeroSection -->
<section class="w-full bg-gradient-to-b from-unairHeroBg/60 to-unairHeroBg/40 pt-10 pb-20 overflow-hidden" id="beranda">
<div class="max-w-7xl mx-auto px-6 grid grid-cols-1 lg:grid-cols-12 gap-8 items-center">
<!-- Left Column: Content -->
<div class="lg:col-span-7 space-y-6">
<!-- Big Hero Headings -->
<div class="space-y-1">
<h1 class="text-5xl md:text-6xl font-black text-slate-900 tracking-tight leading-none">
  Hebat <span class="font-script text-red-600 text-6xl md:text-7xl font-bold px-1.5 marker-cyan inline-block align-middle transform -rotate-2">Gen 2</span>
</h1>
<h2 class="text-5xl md:text-6xl font-black text-slate-900 tracking-tight leading-none pt-2">
  Universitas
</h2>
<h2 class="text-5xl md:text-6xl font-black text-slate-900 tracking-tight leading-none">
  Airlangga.
</h2>
</div>
<!-- Motto -->
<p class="text-xs md:text-sm font-semibold text-slate-700 tracking-normal pt-2">
  Humble, Honest, Helpful, Excellent, Brave, Agile &amp; Transcendent.
</p>
<!-- Daring Links Buttons -->
<div class="flex flex-wrap items-center gap-3 pt-1">
<a class="px-5 py-1.5 rounded-full bg-[#ffc524] text-slate-900 text-xs font-bold shadow-sm hover:opacity-90 transition" href="#">
  Link Daring Dosen
</a>
<a class="px-5 py-1.5 rounded-full bg-[#00c5ff] text-white text-xs font-bold shadow-sm hover:opacity-90 transition" href="#">
  Link Daring Mahasiswa
</a>
</div>
<!-- Main Action Buttons -->
<div class="flex items-center gap-3 pt-3">
<a class="w-24 text-center py-2.5 rounded-full bg-[#294297] text-white text-xs font-bold shadow hover:bg-blue-900 transition" href="/login/index.php">
  Login
</a>
<a class="w-24 text-center py-2.5 rounded-full bg-[#fcb813] text-slate-900 text-xs font-bold shadow hover:bg-yellow-500 transition" href="/my/">
  Dashboard
</a>
</div>
</div>
<!-- Right Column: Masked Statue Image -->
<div class="lg:col-span-5 flex justify-center lg:justify-end">
<div class="w-full max-w-md aspect-[4/3] hero-statue-shape relative">
  <img src="/assets/garuda_mukti.jpg" alt="Patung Garuda Mukti Universitas Airlangga" class="w-full h-full object-cover drop-shadow-md">
</div>
</div>
</div>
</section>
<!-- END: HeroSection -->

<!-- BEGIN: AboutSection -->
<section class="py-20 bg-white" id="tentang">
<div class="max-w-7xl mx-auto px-6">
<div class="text-center mb-16">
<h2 class="text-4xl md:text-5xl font-black text-slate-900 tracking-tight">
  Tentang <span class="font-script text-red-600 text-5xl md:text-6xl font-bold px-2 marker-pink inline-block transform -rotate-1">Kami</span>
</h2>
</div>
<div class="grid grid-cols-1 md:grid-cols-3 gap-8">
<!-- Card 1: Sejarah -->
<div class="p-6 rounded-xl hover:shadow-lg transition duration-200 border border-slate-100 flex flex-col justify-between">
<div>
<div class="w-12 h-12 rounded-lg bg-yellow-100 flex items-center justify-center text-yellow-600 mb-6">
<svg class="w-6 h-6 stroke-current fill-none" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>
</div>
<h3 class="text-lg font-bold text-slate-900 mb-2">Sejarah</h3>
<p class="text-xs text-slate-500 leading-relaxed mb-6">Sejarah, Milestone Universitas Airlangga dapat dilihat melalui link dibawah ini</p>
</div>
<a class="text-xs font-bold text-blue-700 hover:text-blue-900 flex items-center gap-1" href="#">Learn More <span class="text-sm">→</span></a>
</div>
<!-- Card 2: Identitas -->
<div class="p-6 rounded-xl hover:shadow-lg transition duration-200 border border-slate-100 flex flex-col justify-between">
<div>
<div class="w-12 h-12 rounded-lg bg-emerald-100 flex items-center justify-center text-emerald-600 mb-6">
<svg class="w-6 h-6 stroke-current fill-none" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" viewBox="0 0 24 24"><rect height="14" rx="2" ry="2" width="20" x="2" y="3"></rect><line x1="8" x2="16" y1="21" y2="21"></line><line x1="12" x2="12" y1="17" y2="21"></line></svg>
</div>
<h3 class="text-lg font-bold text-slate-900 mb-2">Identitas</h3>
<p class="text-xs text-slate-500 leading-relaxed mb-6">Lambang, Bendera dan Hymne Universitas Airlangga dapat dilihat melalui link dibawah ini</p>
</div>
<a class="text-xs font-bold text-blue-700 hover:text-blue-900 flex items-center gap-1" href="#">Learn More <span class="text-sm">→</span></a>
</div>
<!-- Card 3: Visi Misi -->
<div class="p-6 rounded-xl hover:shadow-lg transition duration-200 border border-slate-100 flex flex-col justify-between">
<div>
<div class="w-12 h-12 rounded-lg bg-pink-100 flex items-center justify-center text-pink-600 mb-6">
<svg class="w-6 h-6 stroke-current fill-none" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" viewBox="0 0 24 24"><path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"></path></svg>
</div>
<h3 class="text-lg font-bold text-slate-900 mb-2">Visi Misi</h3>
<p class="text-xs text-slate-500 leading-relaxed mb-6">Visi dan Misi Universitas Airlangga dapat dilihat melalui link dibawah ini</p>
</div>
<a class="text-xs font-bold text-blue-700 hover:text-blue-900 flex items-center gap-1" href="#">Learn More <span class="text-sm">→</span></a>
</div>
</div>
</div>
</section>
<!-- END: AboutSection -->

<!-- BEGIN: GuideSection -->
<section id="panduan" class="relative w-full text-white overflow-hidden bg-cover bg-center bg-no-repeat" style="background-image: url('/assets/panduan_bg.png'); background-attachment: fixed; background-position: center; background-size: cover;">
  <div class="w-full h-full bg-slate-950/70 backdrop-blur-[2px] py-20">
    <div class="max-w-7xl mx-auto px-6 relative z-10">
      <div class="mb-12">
        <h2 class="text-5xl font-black tracking-tight mb-2 drop-shadow-md">Panduan</h2>
        <span class="inline-block text-xs font-bold tracking-wider uppercase border-b-2 border-pink-400 pb-0.5 text-slate-200 drop-shadow-sm">HELPDESK DAN PANDUAN</span>
      </div>
      <div class="flex flex-wrap items-center gap-4">
        <a class="px-8 py-3 rounded-lg bg-[#2b429a] hover:bg-blue-800 text-white text-sm font-semibold transition shadow-md" href="#">Helpdesk</a>
        <a class="px-8 py-3 rounded-lg bg-[#fcb813] hover:bg-yellow-500 text-slate-900 text-sm font-bold transition shadow-md" href="#">Spada</a>
        <a class="px-8 py-3 rounded-lg bg-[#af0000] hover:bg-red-800 text-white text-sm font-semibold transition shadow-md" href="#">Direktori Panduan</a>
        <a class="px-8 py-3 rounded-lg bg-[#00c5ff] hover:bg-cyan-500 text-slate-900 text-sm font-semibold transition shadow-md" href="#">Seb Ujian</a>
      </div>
    </div>
  </div>
</section>
<!-- END: GuideSection -->

<!-- BEGIN: PartnerAndStatisticSection -->
<section class="w-full bg-[#f4f7f9] py-20 overflow-hidden" id="partner">
<div class="max-w-7xl mx-auto px-6 grid grid-cols-1 lg:grid-cols-12 gap-12 items-center">
<div class="lg:col-span-6 flex justify-center items-center">
  <div class="relative w-full max-w-md flex items-center justify-center min-h-[380px]">
    <img src="/assets/partner_statistic.png" alt="Partner &amp; Statistik Hebat E-Learning" class="max-h-[380px] md:max-h-[420px] w-auto object-contain">
  </div>
</div>
<div class="lg:col-span-6 space-y-6">
<div>
  <h2 class="text-4xl md:text-5xl font-black text-slate-900 leading-tight">Our <span class="font-script text-red-600 text-5xl md:text-6xl font-bold px-2 marker-cyan inline-block transform -rotate-1">Partner</span></h2>
  <h2 class="text-4xl md:text-5xl font-black text-slate-900 leading-tight">And Statistic</h2>
</div>
<p class="text-sm text-slate-600 leading-relaxed font-normal">Berikut adalah patner dan statistik dari hebat e learning</p>
<div class="space-y-3 pt-2">
  <div class="bg-[#294297] text-white rounded-md shadow-sm overflow-hidden">
    <button class="w-full px-5 py-3.5 flex items-center justify-between text-left font-bold text-xs tracking-wider uppercase">
      <span>SPADA</span>
      <svg class="w-4 h-4 transform rotate-180" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M19 9l-7 7-7-7" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"></path></svg>
    </button>
  </div>
  <div class="bg-white text-slate-700 rounded-md shadow-sm border border-slate-200 overflow-hidden">
    <button class="w-full px-5 py-3.5 flex items-center justify-between text-left font-semibold text-xs tracking-wide">
      <span>ICE Institute</span>
      <svg class="w-4 h-4 text-blue-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M19 9l-7 7-7-7" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"></path></svg>
    </button>
  </div>
  <div class="bg-white text-slate-700 rounded-md shadow-sm border border-slate-200 overflow-hidden">
    <button class="w-full px-5 py-3.5 flex items-center justify-between text-left font-semibold text-xs tracking-wide">
      <span>Cybercampus</span>
      <svg class="w-4 h-4 text-blue-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M19 9l-7 7-7-7" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"></path></svg>
    </button>
  </div>
</div>
</div>
</div>
</section>
<!-- END: PartnerAndStatisticSection -->

<!-- BEGIN: MainFooter -->
<footer class="w-full bg-white border-t border-slate-100 pt-16 pb-8">
<div class="max-w-7xl mx-auto px-6">
<div class="grid grid-cols-1 md:grid-cols-12 gap-8 pb-12">
<div class="md:col-span-4 flex items-start gap-3">
  <a href="#" class="block"><img src="/assets/logo_unair_combined.png" alt="Logo" class="h-12 w-auto object-contain"></a>
</div>
<div class="md:col-span-4 space-y-3">
  <h4 class="text-sm font-bold text-slate-900 tracking-tight">Link Terkait</h4>
  <ul class="space-y-2 text-xs text-slate-600 font-medium">
    <li><a class="hover:text-blue-600 transition" href="#">Universitas Airlangga</a></li>
    <li><a class="hover:text-blue-600 transition" href="#">Cybercampus</a></li>
    <li><a class="hover:text-blue-600 transition" href="#">Spada Indonesia</a></li>
    <li><a class="hover:text-blue-600 transition" href="#">ICE Institute</a></li>
  </ul>
</div>
<div class="md:col-span-4 space-y-3">
  <h4 class="text-sm font-bold text-slate-900 tracking-tight">Kontak</h4>
  <div class="space-y-1 text-xs text-slate-600 leading-relaxed font-medium">
    <p>Gedung Kantor Manajemen, Kampus MERR C</p>
    <p>Mulyorejo – Surabaya</p>
    <p>Telp. (031) 5914042, 5914043, 5915551 Fax. (031) 5915551</p>
    <p>WhatsApp. +62 821-3004-0061</p>
    <p>Email: adm@pkip.unair.ac.id</p>
  </div>
</div>
</div>
<div class="border-t border-slate-100 pt-6 flex flex-col md:flex-row items-center justify-between text-xs text-slate-500">
  <p>© 2026. All Rights Reserved.</p>
  <p class="mt-2 md:mt-0">Built by Universitas Airlangga with <span class="text-blue-700">♥</span></p>
</div>
</div>
</footer>
<!-- END: MainFooter -->

${renderRefereeDrawer(baseUrl)}
</body></html>`;
}

/**
 * 2. LOGIN PAGE
 */
export function renderLoginHtml(baseUrl: string, errorMsg = ''): string {
  const alertHtml = errorMsg
    ? `<div class="bg-[#f8d7da] border border-[#f5c6cb] text-[#721c24] text-[13.5px] px-4 py-3 rounded-[5px] mb-5 leading-normal" role="alert">${errorMsg}</div>`
    : `<div class="bg-[#f8d7da] border border-[#f5c6cb] text-[#721c24] text-[13.5px] px-4 py-3 rounded-[5px] mb-5 leading-normal" data-purpose="timeout-notification" role="alert">Your session has timed out. Please log in again.</div>`;

  return `<!DOCTYPE html>
<html lang="en"><head>
<meta charset="utf-8"/>
<meta content="width=device-width, initial-scale=1.0" name="viewport"/>
<title>Login - Universitas Airlangga</title>
<!-- Tailwind CSS CDN -->
<script src="https://cdn.tailwindcss.com?plugins=forms,container-queries"></script>
<!-- Font Awesome for the eye icon -->
<link href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css" rel="stylesheet"/>
<style data-purpose="custom-styling">
    body {
      background-color: #e9ecef;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
    }
    .custom-shadow {
      box-shadow: 0 4px 20px 0 rgba(0, 0, 0, 0.08), 0 1px 3px 0 rgba(0, 0, 0, 0.05);
    }
  </style>
</head>
<body class="min-h-screen flex items-center justify-center p-4 relative antialiased text-[#212529]">
<!-- BEGIN: MainLoginCard -->
<main class="w-full max-w-[430px] bg-white rounded-[10px] custom-shadow p-8 sm:p-9 my-8" data-purpose="login-container">
<!-- BEGIN: HeaderLogos -->
<header class="flex items-center justify-center gap-3 sm:gap-4 mb-6" data-purpose="institution-logos">
  <img alt="Tut Wuri Handayani, UNAIR, Kampus Merdeka" class="h-12 w-auto object-contain" src="/assets/logo_unair_combined.png"/>
</header>
<!-- END: HeaderLogos -->

<!-- BEGIN: SessionAlert -->
${alertHtml}
<!-- END: SessionAlert -->

<!-- BEGIN: LoginForm -->
<form action="/login/index.php" class="space-y-4" data-purpose="credentials-form" method="POST">
<input type="hidden" name="logintoken" value="mock_logintoken_${Date.now()}">
<!-- Username Field -->
<div>
  <label class="sr-only" for="username">Username</label>
  <input class="w-full px-3.5 py-2 border border-[#ced4da] rounded-[4px] text-[15px] text-[#495057] focus:outline-none focus:ring-2 focus:ring-blue-500/40 focus:border-[#80bdff] transition-colors" id="username" name="username" placeholder="Username" required="" type="text" value="187251052"/>
</div>
<!-- Password Field with Visibility Toggle Button -->
<div class="flex rounded-[4px] border border-[#ced4da] overflow-hidden focus-within:ring-2 focus-within:ring-blue-500/40 focus-within:border-[#80bdff] transition-all">
  <label class="sr-only" for="password">Password</label>
  <input class="w-full px-3.5 py-2 text-[15px] text-[#495057] border-0 focus:ring-0 focus:outline-none" id="password" name="password" placeholder="Password" required="" type="password" value="password123"/>
  <button aria-label="Toggle password visibility" class="bg-[#ced4da]/50 hover:bg-[#ced4da]/80 text-[#495057] px-3.5 flex items-center justify-center transition-colors" data-purpose="password-visibility-toggle" id="togglePassword" type="button">
    <i class="fa-regular fa-eye text-[14px]"></i>
  </button>
</div>
<!-- Submit Button -->
<div class="pt-1">
  <button class="bg-[#0f6cbf] hover:bg-[#0056b3] text-white text-[15px] font-normal px-4 py-2 rounded-[4px] transition-colors shadow-sm inline-block cursor-pointer" data-purpose="login-submit-button" type="submit">
    Log in
  </button>
</div>
</form>
<!-- END: LoginForm -->

<div class="mt-3">
  <a class="text-[#0f6cbf] hover:underline text-[13.5px]" href="#">Lost password?</a>
</div>
<hr class="border-[#e9ecef] my-6"/>
<section class="space-y-1" data-purpose="first-time-users">
  <h2 class="text-[17px] font-semibold text-[#212529]">Is this your first time here?</h2>
  <div><a class="text-[#0f6cbf] hover:underline text-[13.5px]" href="#">Lost password</a></div>
</section>
<hr class="border-[#e9ecef] my-6"/>
<footer data-purpose="cookie-section">
  <a class="inline-block bg-[#ced4da]/50 hover:bg-[#ced4da]/70 text-[#212529] text-[13.5px] px-3 py-1.5 rounded-[4px] transition-colors" href="#">Cookies notice</a>
</footer>
</main>
<!-- END: MainLoginCard -->

<aside class="fixed bottom-4 right-4" data-purpose="help-action">
  <button aria-label="Help &amp; Information" class="w-7 h-7 rounded-full bg-[#ced4da]/70 hover:bg-[#ced4da] flex items-center justify-center text-xs font-semibold text-[#495057] shadow-sm transition-colors" type="button">?</button>
</aside>

<script data-purpose="password-toggle-script">
  const toggleBtn = document.getElementById('togglePassword');
  const passwordInput = document.getElementById('password');
  if (toggleBtn && passwordInput) {
    toggleBtn.addEventListener('click', () => {
      const isPassword = passwordInput.getAttribute('type') === 'password';
      passwordInput.setAttribute('type', isPassword ? 'text' : 'password');
      const icon = toggleBtn.querySelector('i');
      if (icon) {
        icon.classList.toggle('fa-eye', !isPassword);
        icon.classList.toggle('fa-eye-slash', isPassword);
      }
    });
  }
</script>

${renderRefereeDrawer(baseUrl)}
</body></html>`;
}

/**
 * 3. DASHBOARD PAGE (/my/)
 */
export function renderDashboardHtml(baseUrl: string, state: MockAppState): string {
  const isLocked = Date.now() < state.unlockTimestampMs;
  const statusBadge = isLocked
    ? `<span class="bg-[#ba2e23] text-white text-[10.5px] font-semibold px-2 py-0.5 rounded-full leading-none tracking-wide">Locked (Buka 07:00 WIB)</span>`
    : `<span class="bg-emerald-600 text-white text-[10.5px] font-semibold px-2 py-0.5 rounded-full leading-none tracking-wide">Open for submission</span>`;

  return `<!DOCTYPE html>
<html lang="id"><head>
<meta charset="utf-8"/>
<meta content="width=device-width, initial-scale=1.0" name="viewport"/>
<title>Dashboard - Universitas Airlangga LMS</title>
<script src="https://cdn.tailwindcss.com?plugins=forms,container-queries"></script>
<script>
    tailwind.config = {
      theme: {
        extend: {
          colors: {
            moodleBlue: '#0f6cb5',
            moodleDark: '#1d2125',
            moodleBorder: '#dee2e6',
            moodleGrayBg: '#f8f9fa',
            overdueRed: '#c93a2b',
            avatarOrange: '#e65100'
          },
          fontFamily: {
            sans: ['-apple-system', 'BlinkMacSystemFont', '"Segoe UI"', 'Roboto', '"Helvetica Neue"', 'Arial', 'sans-serif']
          }
        }
      }
    }
  </script>
<style data-purpose="custom-scrollbars">
    ::-webkit-scrollbar { width: 8px; height: 8px; }
    ::-webkit-scrollbar-thumb { background: #cbd5e1; border-radius: 4px; }
    ::-webkit-scrollbar-thumb:hover { background: #94a3b8; }
</style>
</head>
<body class="bg-[#ffffff] text-[#1d2125] font-sans antialiased min-h-screen flex flex-col justify-between">
<!-- BEGIN: MainHeader -->
<header class="w-full bg-white border-b border-gray-200 sticky top-0 z-40">
<div class="w-full px-4 sm:px-6 flex items-center justify-between h-[60px]">
<div class="flex items-center space-x-6">
  <div class="flex items-center space-x-2.5">
    <a href="/"><img src="/assets/logo_unair_combined.png" alt="UNAIR" class="h-9 w-auto object-contain"></a>
  </div>
  <nav aria-label="Main Navigation" class="hidden md:flex items-center space-x-1 pl-4 h-[60px]">
    <a class="px-3 text-[14.5px] font-normal text-gray-700 hover:text-[#0f6cb5] flex items-center h-full" href="/">Home</a>
    <a class="px-3 text-[14.5px] font-semibold text-[#1d2125] border-b-[3px] border-[#0f6cb5] flex items-center h-full relative top-[1px]" href="/my/">Dashboard</a>
    <a class="px-3 text-[14.5px] font-normal text-gray-700 hover:text-[#0f6cb5] flex items-center h-full" href="/my/courses.php">My courses</a>
  </nav>
</div>
<div class="flex items-center space-x-4">
  <button aria-label="Notifications" class="relative p-1.5 text-gray-600 hover:text-gray-900 focus:outline-none" type="button">
    <svg class="w-[21px] h-[21px]" fill="none" stroke="currentColor" viewbox="0 0 24 24"><path d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8"></path></svg>
    <span class="absolute -top-1 -left-1.5 bg-[#d93829] text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full leading-none">129</span>
  </button>
  <button aria-label="Messages" class="p-1.5 text-gray-600 hover:text-gray-900 focus:outline-none" type="button">
    <svg class="w-5 h-5" fill="none" stroke="currentColor" viewbox="0 0 24 24"><path d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8"></path></svg>
  </button>
  <div class="flex items-center space-x-1 pl-1">
    <div class="w-8 h-8 rounded-full bg-[#e65100] text-white flex items-center justify-center text-sm font-semibold">m</div>
    <svg class="w-3.5 h-3.5 text-gray-500" fill="none" stroke="currentColor" viewbox="0 24 24"><path d="M19 9l-7 7-7-7" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"></path></svg>
  </div>
</div>
</div>
</header>
<!-- END: MainHeader -->

<!-- BEGIN: MainDashboardLayout -->
<main class="w-full max-w-[1720px] mx-auto px-4 sm:px-8 py-7 flex-1">
<div class="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
<!-- Left Stream -->
<section class="lg:col-span-8 flex flex-col" data-purpose="dashboard-main-stream">
<div class="mb-5">
  <h1 class="text-[28px] font-bold text-[#1d2125] tracking-tight">Dashboard</h1>
  <h2 class="text-[26px] font-bold text-[#1d2125] mt-2 flex items-center">
    Hi, 187251052! <span class="ml-2 text-2xl">👋</span>
  </h2>
</div>

<div class="bg-white border border-gray-200 rounded-lg p-5 shadow-sm" data-purpose="timeline-card">
  <h3 class="text-[18px] font-semibold text-[#1d2125] mb-4">Timeline</h3>
  <div class="flex flex-wrap items-center gap-2 mb-6">
    <button class="inline-flex items-center px-3.5 py-1.5 border border-gray-300 rounded-md bg-white text-[14px] text-gray-700 hover:bg-gray-50" type="button">
      <span>All</span>
    </button>
    <button class="inline-flex items-center px-3.5 py-1.5 border border-gray-300 rounded-md bg-white text-[14px] text-gray-700 hover:bg-gray-50" type="button">
      <span>Sort by dates</span>
    </button>
    <div class="flex-1 min-w-[200px]">
      <input class="w-full px-3.5 py-1.5 text-[14px] border border-gray-300 rounded-md text-gray-700" placeholder="Search by activity type or name" type="text"/>
    </div>
  </div>
  
  <div class="border-b border-gray-100 mb-5"></div>

  <!-- Target Assignment Item -->
  <div class="mb-7" data-purpose="timeline-date-group">
    <h4 class="text-[14.5px] font-bold text-[#1d2125] mb-3">Rabu, Pekan Ini (Target Auto-Submit)</h4>
    <div class="flex flex-col sm:flex-row sm:items-start justify-between gap-3 group bg-blue-50/40 p-3 rounded-lg border border-blue-100">
      <div class="flex items-start space-x-3.5">
        <span class="text-[13px] text-gray-700 font-semibold mt-0.5 w-11 shrink-0">07:00</span>
        <div class="w-8 h-9 border border-[#d63384] rounded flex flex-col items-center justify-center shrink-0 mt-0.5 bg-white">
          <svg class="w-4 h-4 text-[#d63384]" fill="none" stroke="currentColor" viewbox="0 0 24 24"><path d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"></path></svg>
        </div>
        <div>
          <div class="flex flex-wrap items-center gap-1.5">
            <a class="text-[14.5px] font-bold text-[#0f6cb5] hover:underline leading-snug" href="/mod/assign/view.php?id=101761">
              Pengumpulan Modul Prak Lab 8 NDG Linux Essential
            </a>
            ${statusBadge}
          </div>
          <p class="text-[12.5px] text-gray-600 mt-1">
            Assignment is due · 2026Ganjil - FST25605011 - Sistem Operasi (Praktikum) - S1 - Sistem Informasi - 2025 - I3
          </p>
        </div>
      </div>
      <div class="self-end sm:self-center ml-auto">
        <a href="/mod/assign/view.php?id=101761" class="px-3.5 py-1.5 text-[13px] bg-[#0f6cb5] text-white hover:bg-blue-700 rounded-md font-medium inline-block">
          Buka Tugas
        </a>
      </div>
    </div>
  </div>

  <div class="border-b border-gray-100 my-5"></div>

  <!-- Other Timeline Item -->
  <div class="mb-5">
    <h4 class="text-[14.5px] font-bold text-[#1d2125] mb-3">Tugas Pekan Sebelumnya</h4>
    <div class="flex flex-col sm:flex-row sm:items-start justify-between gap-3 group">
      <div class="flex items-start space-x-3.5">
        <span class="text-[13px] text-gray-700 font-normal mt-0.5 w-11 shrink-0">23:59</span>
        <div class="w-8 h-9 border border-[#d63384] rounded flex flex-col items-center justify-center shrink-0 mt-0.5 bg-white">
          <svg class="w-4 h-4 text-[#d63384]" fill="none" stroke="currentColor" viewbox="0 0 24 24"><path d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"></path></svg>
        </div>
        <div>
          <div class="flex flex-wrap items-center gap-1.5">
            <a class="text-[14.5px] font-medium text-[#0f6cb5] hover:underline leading-snug" href="#">
              Tugas Kelompok - Proyek1
            </a>
            <span class="bg-[#ba2e23] text-white text-[10.5px] font-semibold px-2 py-0.5 rounded-full leading-none tracking-wide">Overdue</span>
          </div>
          <p class="text-[12.5px] text-gray-600 mt-1">2026Ganjil - FST25605019 - Statistika Inferensi</p>
        </div>
      </div>
    </div>
  </div>
</div>
</section>

<!-- Right Sidebar -->
<aside class="lg:col-span-4" data-purpose="recently-accessed-sidebar">
<div class="bg-white border border-gray-200 rounded-xl p-5 shadow-sm">
  <h3 class="text-[18px] font-bold text-[#1d2125] mb-4">Recently accessed items</h3>
  <div class="space-y-3">
    <a class="flex items-center space-x-3.5 p-3 rounded-lg border border-gray-200 hover:bg-gray-50 transition-colors" href="/course/view.php?id=10978">
      <div class="w-8 h-9 border border-[#d63384] rounded flex items-center justify-center shrink-0 bg-white">
        <svg class="w-4 h-4 text-[#d63384]" fill="none" stroke="currentColor" viewbox="0 0 24 24"><path d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"></path></svg>
      </div>
      <div class="overflow-hidden min-w-0">
        <p class="text-[14px] font-medium text-[#0f6cb5] truncate hover:underline">Sistem Operasi (Praktikum) - I3</p>
        <p class="text-[12px] text-gray-500 truncate mt-0.5">2026Ganjil - FST25605011</p>
      </div>
    </a>
    <a class="flex items-center space-x-3.5 p-3 rounded-lg border border-gray-200 hover:bg-gray-50 transition-colors" href="/mod/assign/view.php?id=101761">
      <div class="w-8 h-9 border border-[#0f6cb5] rounded flex flex-col items-center justify-center shrink-0 bg-white">
        <svg class="w-4 h-3.5 text-[#0f6cb5]" fill="none" stroke="currentColor" viewbox="0 0 24 24"><path d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8"></path></svg>
        <span class="text-[7.5px] font-bold text-[#0f6cb5] uppercase leading-none mt-0.5">PDF</span>
      </div>
      <div class="overflow-hidden min-w-0">
        <p class="text-[14px] font-medium text-[#0f6cb5] truncate hover:underline">Pengumpulan Modul Prak Lab 8</p>
        <p class="text-[12px] text-gray-500 truncate mt-0.5">NDG Linux Essential</p>
      </div>
    </a>
  </div>
</div>
</aside>
</div>
</main>
<!-- END: MainDashboardLayout -->

<div class="fixed bottom-6 right-6 z-50">
  <button aria-label="Help" class="w-10 h-10 rounded-full bg-[#ced4da] hover:bg-[#c2c8ce] text-gray-800 flex items-center justify-center font-bold text-lg shadow-md transition-all focus:outline-none" type="button">?</button>
</div>

${renderRefereeDrawer(baseUrl)}
</body></html>`;
}

/**
 * 4. MY COURSES PAGE (/my/courses.php)
 */
export function renderMyCoursesHtml(baseUrl: string): string {
  return `<!DOCTYPE html>
<html lang="id"><head>
<meta charset="utf-8"/>
<meta content="width=device-width, initial-scale=1.0" name="viewport"/>
<title>My courses | Cybercampus Universitas Airlangga</title>
<script src="https://cdn.tailwindcss.com?plugins=forms,container-queries"></script>
<link href="https://fonts.googleapis.com" rel="preconnect"/>
<link crossorigin="" href="https://fonts.gstatic.com" rel="preconnect"/>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&amp;family=Playfair+Display:ital,wght@1,600;1,700&amp;display=swap" rel="stylesheet"/>
<style data-purpose="base-styling">
    body {
      font-family: 'Inter', -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      background-color: #ffffff;
      color: #1a1a1a;
    }
    .banner-card-1 { background-color: #f7cb72; }
    .banner-card-3 { background-color: #583e9b; }
    .banner-card-4 { background-color: #f6c0d6; }
    .banner-card-5 { background-color: #0d72c7; }
    .banner-card-6 { background-color: #b7c6c4; }
    .font-serif-italic { font-family: 'Playfair Display', Georgia, serif; font-style: italic; }
</style>
</head>
<body class="min-h-screen flex flex-col relative text-[#212529]">
<!-- TopHeader -->
<header class="w-full bg-white border-b border-gray-200 px-4 md:px-8 h-16 flex items-center justify-between sticky top-0 z-40">
<div class="flex items-center space-x-6 md:space-x-8">
  <a class="flex items-center space-x-2 shrink-0" href="/">
    <img src="/assets/logo_unair_combined.png" alt="UNAIR" class="h-10 w-auto object-contain">
  </a>
  <nav class="hidden md:flex items-center space-x-8 h-16 pt-1 text-[15px] font-normal">
    <a class="text-gray-700 hover:text-gray-900 transition-colors py-4" href="/">Home</a>
    <a class="text-gray-700 hover:text-gray-900 transition-colors py-4" href="/my/">Dashboard</a>
    <a class="text-gray-900 font-medium border-b-[3px] border-[#0d6efd] py-[18px] transition-colors" href="/my/courses.php">My courses</a>
  </nav>
</div>
<div class="flex items-center space-x-4">
  <div class="w-8 h-8 rounded-full bg-[#f15a24] text-white flex items-center justify-center font-bold text-sm">m</div>
</div>
</header>

<main class="flex-grow w-full max-w-[1400px] mx-auto px-4 md:px-10 pt-8 pb-16">
<div class="mb-5">
  <h1 class="text-[34px] font-bold text-[#1f2937] tracking-tight leading-none mb-3">My courses</h1>
  <h2 class="text-xl font-semibold text-[#1f2937]">Course overview</h2>
</div>

<div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
  <!-- CARD 1: Target Course Sistem Operasi Praktikum -->
  <div class="bg-white rounded-lg border border-gray-200 overflow-hidden shadow-xs flex flex-col justify-between hover:shadow-md transition-shadow">
    <div>
      <div class="h-44 w-full relative flex border-b border-gray-100 overflow-hidden">
        <div class="w-[30%] bg-[#de2b2b] h-full relative">
          <div class="absolute inset-y-0 right-0 w-[2px] bg-black"></div>
        </div>
        <div class="w-[70%] bg-[#efc94c] h-full flex flex-col items-center justify-center p-3 text-center relative">
          <span class="text-[9px] tracking-tight font-serif-italic text-black mb-1">Gasal 2026/2027</span>
          <h3 class="text-sm md:text-base font-serif-italic font-semibold text-black leading-tight">
            Sistem Operasi<br/>(Praktikum) - I3
          </h3>
          <div class="text-[8px] font-serif-italic text-black mt-2 leading-tight">
            <p>Rabu, 07.00-08.40</p>
            <p>Labkom 4</p>
          </div>
        </div>
      </div>
      <div class="p-4">
        <a class="text-[#0275d8] hover:underline font-semibold text-[15px] leading-snug block mb-1" href="/course/view.php?id=10978">
          2026Ganjil - FST25605011 - Sistem Operasi (Praktikum) - S1 - Sistem Informasi - 2025 - I3
        </a>
        <p class="text-xs font-semibold text-gray-700 tracking-wide uppercase">S1 SISTEM INFORMASI</p>
      </div>
    </div>
  </div>

  <!-- CARD 2 -->
  <div class="bg-white rounded-lg border border-gray-200 overflow-hidden shadow-xs flex flex-col justify-between hover:shadow-md transition-shadow">
    <div>
      <div class="h-44 w-full banner-card-1 border-b border-gray-100"></div>
      <div class="p-4">
        <a class="text-[#0275d8] hover:underline font-normal text-[15px] leading-snug block mb-1" href="#">
          2026Ganjil - FST25605010 - Sistem Operasi - S1 - ...
        </a>
        <p class="text-xs font-semibold text-gray-700 tracking-wide uppercase">S1 SISTEM INFORMASI</p>
      </div>
    </div>
  </div>

  <!-- CARD 3 -->
  <div class="bg-white rounded-lg border border-gray-200 overflow-hidden shadow-xs flex flex-col justify-between hover:shadow-md transition-shadow">
    <div>
      <div class="h-44 w-full banner-card-3 border-b border-gray-100"></div>
      <div class="p-4">
        <a class="text-[#0275d8] hover:underline font-normal text-[15px] leading-snug block mb-1" href="#">
          2026Ganjil - FST25605012 - Basis Data - S1 - Sistem ...
        </a>
        <p class="text-xs font-semibold text-gray-700 tracking-wide uppercase">S1 SISTEM INFORMASI</p>
      </div>
    </div>
  </div>
</div>
</main>

<aside class="fixed bottom-6 right-6 z-50">
  <button aria-label="Help" class="w-10 h-10 rounded-full bg-[#ced4da] hover:bg-[#adb5bd] text-gray-800 flex items-center justify-center font-bold text-base shadow-sm" type="button">?</button>
</aside>

${renderRefereeDrawer(baseUrl)}
</body></html>`;
}

/**
 * 5. COURSE VIEW PAGE (/course/view.php?id=...)
 */
export function renderCourseViewHtml(baseUrl: string, courseId: string, state: MockAppState): string {
  const isLocked = Date.now() < state.unlockTimestampMs;
  const unlockDateStr = new Date(state.unlockTimestampMs).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
  const unlockTimeStr = new Date(state.unlockTimestampMs).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });

  return `<!DOCTYPE html>
<html lang="id"><head>
<meta charset="utf-8"/>
<meta content="width=device-width, initial-scale=1.0" name="viewport"/>
<title>2026Ganjil - FST25605011 - Sistem Operasi (Praktikum) - S1 - Sistem Informasi - 2025 - I3</title>
<script src="https://cdn.tailwindcss.com?plugins=forms,container-queries"></script>
<script>var M = { cfg: { contextid: "288276", sesskey: "mock_sesskey_unair_999", userId: "187251052" } };</script>
<style data-purpose="typography">
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
      color: #333333;
      background-color: #ffffff;
    }
</style>
</head>
<body class="min-h-screen relative flex flex-col bg-white text-[#373a3c] antialiased">
<header class="w-full border-b border-gray-200 bg-white sticky top-0 z-30">
<div class="w-full px-6 py-2.5 flex items-center justify-between">
  <div class="flex items-center space-x-8">
    <a class="flex items-center space-x-2.5" href="/">
      <img src="/assets/logo_unair_combined.png" alt="UNAIR" class="h-9 w-auto object-contain">
    </a>
    <nav class="hidden md:flex items-center space-x-6 text-[15px] text-[#333333]">
      <a class="hover:text-blue-600" href="/">Home</a>
      <a class="hover:text-blue-600" href="/my/">Dashboard</a>
      <a class="hover:text-blue-600" href="/my/courses.php">My courses</a>
    </nav>
  </div>
  <div class="flex items-center space-x-5 pr-2">
    <div class="w-8 h-8 rounded-full bg-[#e65100] text-white flex items-center justify-center font-medium text-sm">m</div>
  </div>
</div>
</header>

<main class="flex-1 w-full max-w-[1360px] mx-auto px-6 sm:px-12 lg:px-20 pt-8 pb-16">
<div class="mb-6">
  <h1 class="text-[32px] font-bold text-[#1d2125] leading-tight">
    2026Ganjil - FST25605011 - Sistem Operasi (Praktikum) - S1 - Sistem Informasi - 2025 - I3
  </h1>
</div>

<div class="border-b border-gray-200 mb-8">
  <nav class="flex space-x-8 text-[15px]">
    <a class="pb-3 px-1 border-b-[3px] border-[#0f6cbf] text-[#1d2125] font-semibold" href="#">Course</a>
    <a class="pb-3 px-1 border-b-[3px] border-transparent text-[#0f6cbf] hover:text-blue-800" href="#">Participants</a>
    <a class="pb-3 px-1 border-b-[3px] border-transparent text-[#0f6cbf] hover:text-blue-800" href="#">Grades</a>
  </nav>
</div>

<div class="max-w-[1040px] space-y-6">
  <!-- Section 1: General -->
  <section class="border border-gray-200 rounded-2xl bg-white shadow-sm p-6">
    <h2 class="text-2xl font-bold text-[#1d2125] tracking-tight mb-4">General</h2>
    <div class="flex flex-col divide-y divide-gray-100 text-[14.5px]">
      <div class="py-3 flex items-start space-x-3.5">
        <span class="text-[#0f6cbf]">💬</span>
        <a class="text-[#0f6cbf] hover:underline" href="#">Announcements</a>
      </div>
      <div class="py-3 flex items-start space-x-3.5">
        <span class="text-[#0f6cbf]">📄</span>
        <div>
          <a class="text-[#0f6cbf] font-medium hover:underline block" href="#">Template Laporan Prak SO</a>
          <p class="text-xs text-gray-500 mt-1">Format penamaan: PrakSO_[I1/I2/I3/I4]_Week[Mgg]_NIM.pdf</p>
        </div>
      </div>
    </div>
  </section>

  <!-- Section 2: Week 7 & 8 (Target Modul) -->
  <section class="border border-gray-200 rounded-2xl bg-white shadow-sm p-6">
    <h2 class="text-2xl font-bold text-[#1d2125] tracking-tight mb-4">Week 8 - NDG Linux Essentials</h2>
    <div class="text-[14.5px] space-y-4">
      <div class="flex items-start space-x-3.5 p-3 rounded-xl bg-slate-50 border border-slate-200/80">
        <div class="text-pink-600 mt-0.5">
          <svg class="w-6 h-6 stroke-current fill-none" stroke-width="2" viewBox="0 0 24 24"><path d="M9 13h6m-3-3v6m-9 1V7a2 2 0 012-2h6l2 2h6a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2z"></path></svg>
        </div>
        <div class="flex-1">
          <a class="text-[16px] font-bold text-[#0f6cbf] hover:underline block" href="/mod/assign/view.php?id=101761">
            Pengumpulan Modul Prak Lab 8 NDG Linux Essential
          </a>
          <div class="text-xs text-slate-600 mt-1 space-y-1">
            ${isLocked 
              ? `<div class="text-amber-700 font-semibold bg-amber-50 px-2.5 py-1 rounded border border-amber-200 inline-block">🔒 Restricted: Available from ${unlockDateStr}, ${unlockTimeStr} WIB</div>` 
              : `<div class="text-emerald-700 font-semibold bg-emerald-50 px-2.5 py-1 rounded border border-emerald-200 inline-block">🔓 Tugas sudah dibuka!</div>`
            }
            <p class="text-slate-500">Batas pengumpulan: Kamis, 23:59 WIB. Format PDF satu berkas.</p>
          </div>
        </div>
      </div>
    </div>
  </section>
</div>
</main>

${renderRefereeDrawer(baseUrl)}
</body></html>`;
}

/**
 * 6. ASSIGNMENT VIEW & SUBMISSION STATUS (/mod/assign/view.php?id=...)
 */
export function renderAssignmentViewHtml(baseUrl: string, cmid: string, state: MockAppState): string {
  const isLocked = Date.now() < state.unlockTimestampMs;
  const unlockDate = new Date(state.unlockTimestampMs);
  const unlockDateStr = unlockDate.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
  const unlockTimeStr = unlockDate.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });

  const latestSub = state.submissions && state.submissions.length > 0 ? state.submissions[state.submissions.length - 1] : null;
  const isSubmitted = Boolean(latestSub);

  // Status Rows
  const statusRow = isSubmitted
    ? `<span class="bg-[#d4edda] text-[#155724] font-semibold px-2 py-0.5 rounded text-xs">Submitted for grading</span>`
    : isLocked
    ? `<span class="bg-[#fff3cd] text-[#856404] font-semibold px-2 py-0.5 rounded text-xs">Locked (Belum Dibuka)</span>`
    : `<span class="bg-gray-100 text-gray-700 font-semibold px-2 py-0.5 rounded text-xs">No submissions have been made yet</span>`;

  const gradingRow = isSubmitted ? 'Not graded' : 'Not graded';
  const fileRow = isSubmitted && latestSub
    ? `<div class="flex items-center space-x-2 text-[13px]">
         <svg class="w-4 h-4 text-red-600 fill-current" viewBox="0 0 24 24"><path d="M14 2H6c-1.1 0-2 .9-2 2v16c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V8l-6-6zm2 16H8v-2h8v2zm0-4H8v-2h8v2zm-3-5V3.5L18.5 9H13z"></path></svg>
         <a href="/mock-api/download-file?id=${latestSub.draftItemId}" class="text-[#0066cc] hover:underline font-bold">${latestSub.fileName}</a>
         <span class="text-gray-500">(${Math.round(latestSub.size/1024)} KB) — Diterima +${latestSub.timeFromUnlockMs}ms dari jam buka</span>
       </div>`
    : '-';

  const lastModifiedRow = isSubmitted && latestSub
    ? new Date(latestSub.submittedAt).toLocaleString('id-ID')
    : '-';

  return `<!DOCTYPE html>
<html lang="id"><head>
<meta charset="utf-8"/>
<meta content="width=device-width, initial-scale=1.0" name="viewport"/>
<title>Pengumpulan Modul Prak Lab 8 NDG Linux Essential</title>
<script src="https://cdn.tailwindcss.com?plugins=forms,container-queries"></script>
<script>var M = { cfg: { contextid: "288276", sesskey: "mock_sesskey_unair_999", userId: "187251052" } };</script>
<style data-purpose="custom-scrollbars">
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
      color: #1d2125;
      background-color: #ffffff;
    }
</style>
</head>
<body class="min-h-screen bg-white text-[#1d2125] flex flex-col relative antialiased">
<header class="w-full border-b border-gray-200 bg-white sticky top-0 z-40">
<div class="px-6 py-2.5 flex items-center justify-between">
  <div class="flex items-center space-x-7">
    <a href="/"><img src="/assets/logo_unair_combined.png" alt="UNAIR" class="h-9 w-auto object-contain"></a>
    <nav class="hidden md:flex items-center space-x-5 text-[15px] text-[#333333]">
      <a class="hover:text-gray-900" href="/">Home</a>
      <a class="hover:text-gray-900" href="/my/">Dashboard</a>
      <a class="hover:text-gray-900" href="/my/courses.php">My courses</a>
    </nav>
  </div>
  <div class="flex items-center space-x-5">
    <div class="w-8 h-8 rounded-full bg-[#e65100] text-white font-medium flex items-center justify-center text-sm">m</div>
  </div>
</div>
</header>

<main class="flex-1 max-w-[1240px] w-full mx-auto px-6 pt-5 pb-16">
<!-- Breadcrumbs -->
<nav aria-label="Breadcrumb" class="text-[13.5px] leading-relaxed text-[#0066cc] mb-6">
  <div class="flex flex-wrap items-center">
    <a class="hover:underline" href="/course/view.php?id=10978">2026Ganjil - FST25605011 - Sistem Operasi (Praktikum) - S1 - Sistem Informasi - 2025 - I3</a>
  </div>
  <div class="flex flex-wrap items-center space-x-2 mt-0.5">
    <span class="text-gray-400">/</span>
    <a class="hover:underline" href="/course/view.php?id=10978">Week 8 - NDG Linux Essentials</a>
    <span class="text-gray-400">/</span>
    <span class="text-gray-700 font-medium">Pengumpulan Modul Prak Lab 8 NDG Linux Essential</span>
  </div>
</nav>

<!-- Title -->
<div class="flex items-start gap-4 mb-5">
  <div class="mt-1 flex-shrink-0 text-[#e91e63]">
    <svg class="w-7 h-7" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" viewBox="0 0 24 24"><path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2"></path><polyline points="7 9 12 4 17 9"></polyline><line x1="12" x2="12" y1="4" y2="16"></line></svg>
  </div>
  <h1 class="text-[27px] font-bold text-[#1d2125] leading-tight">
    Pengumpulan Modul Prak Lab 8 NDG Linux Essential
  </h1>
</div>

<!-- Lock Alert if locked -->
${isLocked ? `
<div class="bg-[#fff3cd] border border-[#ffeeba] text-[#856404] p-4 rounded-lg mb-6 text-[14px] flex items-center gap-3">
  <span class="text-xl">🔒</span>
  <div>
    <b>Pembatasan Akses:</b> Tugas ini belum dibuka untuk pengumpulan.<br>
    Tersedia mulai: <b>${unlockDateStr}, ${unlockTimeStr} WIB</b>.
  </div>
</div>` : ''}

<!-- Assignment Description Card -->
<section class="bg-white border-b border-gray-200 pb-7 mb-7">
<div class="bg-[#f8f9fa] border border-gray-200/90 rounded-lg p-6 mb-6 text-[14px] leading-relaxed text-[#1d2125]">
  <div class="space-y-1 pb-4 mb-4 border-b border-gray-200">
    <p><span class="font-bold">Opened:</span> ${unlockDateStr}, ${unlockTimeStr} WIB</p>
    <p><span class="font-bold">Due:</span> Kamis, 23:59 WIB</p>
  </div>
  <div class="space-y-3.5 mb-5 text-[13.5px]">
    <p>Silahkan kumpulkan Laporan Praktikum Modul Lab 8 NDG Linux Essential Anda dalam format PDF satu berkas.</p>
    <p>Penamaan file: <strong class="font-bold">PrakSO_I3_Week8_NIM.pdf</strong></p>
  </div>
</div>

<!-- Submission Button -->
<div>
  ${isLocked
    ? `<button disabled class="bg-gray-300 text-gray-500 text-[14px] font-medium px-4 py-2 rounded cursor-not-allowed">Add submission (Terkunci)</button>`
    : isSubmitted
    ? `<a href="/mod/assign/view.php?id=101761&action=editsubmission" class="bg-[#0f6cbf] hover:bg-[#0c5799] text-white text-[14px] font-medium px-4 py-2 rounded shadow-sm inline-block">Edit submission</a>`
    : `<a href="/mod/assign/view.php?id=101761&action=editsubmission" class="bg-[#0f6cbf] hover:bg-[#0c5799] text-white text-[14px] font-medium px-4 py-2 rounded shadow-sm inline-block">Add submission</a>`
  }
</div>
</section>

<!-- Submission Status Section -->
<section>
<h2 class="text-[22px] font-bold text-[#1d2125] mb-5 tracking-tight">Submission status</h2>
<div class="border border-gray-300 rounded-lg overflow-hidden">
<table class="w-full text-left text-[14px] border-collapse" id="submission-status-table">
<tbody>
  <tr class="border-b border-gray-200">
    <th class="w-[28%] bg-white font-bold p-3.5 border-r border-gray-200 text-[#1d2125]">Submission status</th>
    <td class="bg-white p-3.5">${statusRow}</td>
  </tr>
  <tr class="border-b border-gray-200">
    <th class="w-[28%] bg-[#f8f9fa] font-bold p-3.5 border-r border-gray-200 text-[#1d2125]">Grading status</th>
    <td class="bg-[#f8f9fa] p-3.5 text-gray-800">${gradingRow}</td>
  </tr>
  <tr class="border-b border-gray-200">
    <th class="w-[28%] bg-white font-bold p-3.5 border-r border-gray-200 text-[#1d2125]">Time remaining</th>
    <td class="bg-white p-3.5 text-gray-800">${isLocked ? 'Tugas belum dibuka' : isSubmitted ? 'Tugas diserahkan tepat waktu' : '2 days remaining'}</td>
  </tr>
  <tr class="border-b border-gray-200">
    <th class="w-[28%] bg-[#f8f9fa] font-bold p-3.5 border-r border-gray-200 text-[#1d2125]">Last modified</th>
    <td class="bg-[#f8f9fa] p-3.5 text-gray-800">${lastModifiedRow}</td>
  </tr>
  <tr>
    <th class="w-[28%] bg-white font-bold p-3.5 border-r border-gray-200 text-[#1d2125]">File submissions</th>
    <td class="bg-white p-3.5">${fileRow}</td>
  </tr>
</tbody>
</table>
</div>
</section>
</main>

${renderRefereeDrawer(baseUrl)}
</body></html>`;
}

/**
 * 7. EDIT SUBMISSION FORM (/mod/assign/view.php?id=...&action=editsubmission)
 */
export function renderEditSubmissionHtml(baseUrl: string, cmid: string, draftId: number, state: MockAppState): string {
  const latestDraft = state.drafts && state.drafts.length > 0 ? state.drafts[state.drafts.length - 1] : null;
  const fileName = latestDraft ? latestDraft.fileName : 'PrakSO_I3_Week8_187251052.pdf';

  return `<!DOCTYPE html>
<html lang="id"><head>
<meta charset="utf-8"/>
<meta content="width=device-width, initial-scale=1.0" name="viewport"/>
<title>Edit submission - Pengumpulan Modul Prak Lab 8</title>
<script src="https://cdn.tailwindcss.com?plugins=forms,container-queries"></script>
<script>var M = { cfg: { contextid: "288276", sesskey: "mock_sesskey_unair_999", userId: "187251052" } };</script>
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
</style>
</head>
<body class="min-h-screen bg-white text-[#1d2125] flex flex-col relative antialiased">
<header class="w-full border-b border-gray-200 bg-white sticky top-0 z-40">
<div class="px-6 py-2.5 flex items-center justify-between">
  <div class="flex items-center space-x-7">
    <a href="/"><img src="/assets/logo_unair_combined.png" alt="UNAIR" class="h-9 w-auto object-contain"></a>
    <nav class="hidden md:flex items-center space-x-5 text-[15px] text-[#333333]">
      <a class="hover:text-gray-900" href="/">Home</a>
      <a class="hover:text-gray-900" href="/my/">Dashboard</a>
      <a class="hover:text-gray-900" href="/my/courses.php">My courses</a>
    </nav>
  </div>
  <div class="w-8 h-8 rounded-full bg-[#e65100] text-white flex items-center justify-center font-medium text-sm">m</div>
</div>
</header>

<main class="flex-1 max-w-[1240px] w-full mx-auto px-6 pt-5 pb-16">
<nav aria-label="Breadcrumb" class="text-[13.5px] leading-relaxed text-[#0066cc] mb-6">
  <a class="hover:underline" href="/course/view.php?id=10978">2026Ganjil - FST25605011 - Sistem Operasi (Praktikum)</a> /
  <a class="hover:underline" href="/mod/assign/view.php?id=${cmid}">Pengumpulan Modul Prak Lab 8</a> /
  <span class="text-gray-700">Edit submission</span>
</nav>

<h1 class="text-[26px] font-bold text-[#1d2125] mb-6">Pengumpulan Modul Prak Lab 8 NDG Linux Essential</h1>

<!-- Actual Form targetted by SubSecond & Friend's bot -->
<form action="/mod/assign/view.php?id=${cmid}" method="post" id="mform1" class="space-y-6">
  <input type="hidden" name="id" value="${cmid}">
  <input type="hidden" name="action" value="savesubmission">
  <input type="hidden" name="sesskey" value="mock_sesskey_unair_999">
  <input type="hidden" name="_qf__mod_assign_submission_form" value="1">
  <input type="hidden" name="mform_isexpanded_id_submissionheader" value="1">
  <input type="hidden" name="userid" value="187251052">
  <input type="hidden" name="lastmodified" value="${Math.floor(Date.now() / 1000)}">
  <input type="hidden" name="files_filemanager" value="${draftId}">

  <div class="border border-gray-300 rounded-lg p-6 bg-slate-50">
    <label class="block text-sm font-bold text-gray-800 mb-2">File submissions</label>
    <p class="text-xs text-gray-500 mb-4">Maksimum ukuran berkas: 100MB, jumlah maksimum lampiran: 1</p>
    
    <!-- Drag & Drop Zone -->
    <div class="border-2 border-dashed border-gray-300 rounded-xl p-8 bg-white text-center hover:border-blue-500 transition cursor-pointer">
      <div class="text-4xl mb-2">📄</div>
      <p class="text-sm font-semibold text-gray-700">${fileName}</p>
      <p class="text-xs text-gray-500 mt-1">Draft Item ID: <code class="bg-gray-100 px-1.5 py-0.5 rounded">${draftId}</code> (Siap dikumpulkan)</p>
    </div>
  </div>

  <div class="flex items-center space-x-3 pt-2">
    <button type="submit" name="submitbutton" value="Save changes" class="bg-[#0f6cbf] hover:bg-[#0c5799] text-white text-[14px] font-medium px-5 py-2.5 rounded shadow-sm cursor-pointer">
      Save changes
    </button>
    <a href="/mod/assign/view.php?id=${cmid}" class="bg-gray-200 hover:bg-gray-300 text-gray-800 text-[14px] font-medium px-4 py-2.5 rounded">
      Cancel
    </a>
  </div>
</form>
</main>

${renderRefereeDrawer(baseUrl)}
</body></html>`;
}
