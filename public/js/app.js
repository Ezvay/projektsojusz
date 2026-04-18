// ===== STATE =====
let activeStatuses = {}; // { `${generalId}_${ch}`: { id, general_id, channel, killed_at, killed_by } }
let selectedGeneral = null;
let ws = null;
let timerInterval = null;

// ===== NAVIGATION =====
function navigate(section) {
  document.querySelectorAll('.page-section').forEach(s => s.classList.remove('active'));
  document.querySelectorAll('.nav-link').forEach(l => l.classList.remove('active'));

  const target = document.getElementById(section);
  if (target) target.classList.add('active');

  const navLink = document.querySelector(`[data-section="${section}"]`);
  if (navLink) navLink.classList.add('active');

  history.pushState(null, '', `#${section}`);
}

// ===== INIT =====
document.addEventListener('DOMContentLoaded', () => {
  // Embers animation
  spawnEmbers();

  // Nav links
  document.querySelectorAll('[data-section]').forEach(link => {
    link.addEventListener('click', e => {
      e.preventDefault();
      navigate(link.dataset.section);
    });
  });

  // Handle hash on load
  const hash = window.location.hash.replace('#', '');
  if (hash && document.getElementById(hash)) navigate(hash);
  else navigate('home');

  // Build map
  buildMap();

  // Connect WebSocket
  connectWS();

  // Start timer refresh loop
  timerInterval = setInterval(refreshTimers, 1000);
});

// ===== WEBSOCKET =====
function connectWS() {
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const wsUrl = `${protocol}//${location.host}`;

  setWsStatus('connecting');

  try {
    ws = new WebSocket(wsUrl);
  } catch (e) {
    setWsStatus('error');
    setTimeout(connectWS, 5000);
    return;
  }

  ws.addEventListener('open', () => {
    setWsStatus('connected');
  });

  ws.addEventListener('message', (evt) => {
    try {
      const msg = JSON.parse(evt.data);
      handleWsMessage(msg);
    } catch (e) { console.error('WS parse error', e); }
  });

  ws.addEventListener('close', () => {
    setWsStatus('error');
    setTimeout(connectWS, 4000);
  });

  ws.addEventListener('error', () => {
    setWsStatus('error');
  });
}

function handleWsMessage(msg) {
  switch (msg.type) {
    case 'INIT':
      activeStatuses = {};
      msg.data.forEach(entry => {
        const key = `${entry.general_id}_${entry.channel}`;
        activeStatuses[key] = entry;
      });
      refreshUI();
      break;

    case 'GENERAL_KILLED':
      const key = `${msg.data.general_id}_${msg.data.channel}`;
      activeStatuses[key] = msg.data;
      refreshUI();
      showToast(`⚔ ${getGeneralName(msg.data.general_id)} (CH${msg.data.channel}) zabity przez ${msg.data.killed_by}!`);
      break;

    case 'GENERAL_RESET':
      // Remove by id
      Object.keys(activeStatuses).forEach(k => {
        if (activeStatuses[k].id === msg.data.id) delete activeStatuses[k];
      });
      refreshUI();
      break;

    case 'CLEANUP':
      // Server cleaned up old entries; refresh via reconnect or ignore
      break;
  }
}

function setWsStatus(status) {
  const dot = document.getElementById('wsIndicator')?.querySelector('.ws-dot');
  const label = document.getElementById('wsIndicator')?.querySelector('.ws-label');
  if (!dot || !label) return;

  dot.className = 'ws-dot';
  if (status === 'connected') {
    dot.classList.add('connected');
    label.textContent = 'Na żywo';
  } else if (status === 'error') {
    dot.classList.add('error');
    label.textContent = 'Brak połączenia';
  } else {
    label.textContent = 'Łączenie...';
  }
}

// ===== MAP BUILDING =====
function buildMap() {
  const pinsContainer = document.getElementById('generalPins');
  if (!pinsContainer) return;

  GENERALS.forEach(gen => {
    const pin = document.createElement('div');
    pin.className = 'general-pin';
    pin.id = `pin_${gen.id}`;
    pin.style.left = `${gen.x}%`;
    pin.style.top = `${gen.y}%`;
    pin.innerHTML = `
      <div class="pin-timer" id="pinTimer_${gen.id}" style="display:none"></div>
      <div class="pin-circle" id="pinCircle_${gen.id}">${gen.emoji}</div>
      <div class="pin-label">${gen.short}</div>
    `;
    pin.addEventListener('click', () => openKillModal(gen));
    pinsContainer.appendChild(pin);
  });
}

// ===== FALLBACK MAP =====
function loadFallbackMap() {
  const wrapper = document.getElementById('mapWrapper');
  if (!wrapper) return;

  const img = document.getElementById('grotaMap');
  if (img) img.style.display = 'none';

  // Create SVG fallback map
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 800 500');
  svg.setAttribute('class', 'map-fallback');
  svg.setAttribute('xmlns', 'http://www.w3.org/2000/svg');

  svg.innerHTML = `
    <defs>
      <radialGradient id="caveBg" cx="50%" cy="50%" r="60%">
        <stop offset="0%" stop-color="#2a1a0a"/>
        <stop offset="100%" stop-color="#0d0804"/>
      </radialGradient>
      <filter id="glow">
        <feGaussianBlur stdDeviation="3" result="blur"/>
        <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
      </filter>
    </defs>

    <!-- Background -->
    <rect width="800" height="500" fill="url(#caveBg)"/>

    <!-- Cave walls texture -->
    <path d="M0,0 Q50,30 100,10 Q150,0 200,20 Q250,40 300,15 Q350,0 400,25 Q450,45 500,20 Q550,5 600,30 Q650,50 700,20 Q750,5 800,15 L800,0 Z" fill="#1a0d05" opacity="0.8"/>
    <path d="M0,500 Q60,470 120,490 Q180,510 250,480 Q320,460 390,485 Q460,500 530,472 Q600,450 660,478 Q720,500 800,475 L800,500 Z" fill="#1a0d05" opacity="0.8"/>
    <path d="M0,0 Q20,80 10,150 Q0,220 15,300 Q30,370 10,440 Q0,480 0,500 L0,0Z" fill="#1a0d05" opacity="0.7"/>
    <path d="M800,0 Q780,70 790,160 Q800,240 785,320 Q770,400 790,460 Q800,490 800,500 L800,0Z" fill="#1a0d05" opacity="0.7"/>

    <!-- Paths/corridors -->
    <path d="M100,100 L400,100 L400,250 L600,250 L600,400" stroke="#3d2510" stroke-width="60" fill="none" stroke-linecap="round" opacity="0.7"/>
    <path d="M200,200 L200,380" stroke="#3d2510" stroke-width="50" fill="none" stroke-linecap="round" opacity="0.6"/>
    <path d="M400,100 L650,100 L650,300" stroke="#3d2510" stroke-width="45" fill="none" stroke-linecap="round" opacity="0.5"/>

    <!-- Rooms -->
    <ellipse cx="145" cy="110" rx="60" ry="45" fill="#2d1a08" stroke="#4a2d12" stroke-width="2" opacity="0.9"/>
    <ellipse cx="385" cy="90" rx="50" ry="40" fill="#2d1a08" stroke="#4a2d12" stroke-width="2" opacity="0.9"/>
    <ellipse cx="625" cy="100" rx="55" ry="42" fill="#2d1a08" stroke="#4a2d12" stroke-width="2" opacity="0.9"/>
    <ellipse cx="200" cy="290" rx="58" ry="48" fill="#2d1a08" stroke="#4a2d12" stroke-width="2" opacity="0.9"/>
    <ellipse cx="495" cy="220" rx="50" ry="40" fill="#2d1a08" stroke="#4a2d12" stroke-width="2" opacity="0.9"/>
    <ellipse cx="320" cy="390" rx="55" ry="44" fill="#2d1a08" stroke="#4a2d12" stroke-width="2" opacity="0.9"/>
    <ellipse cx="655" cy="360" rx="58" ry="46" fill="#2d1a08" stroke="#4a2d12" stroke-width="2" opacity="0.9"/>

    <!-- Lava pools -->
    <ellipse cx="145" cy="115" rx="25" ry="18" fill="#8b1a00" opacity="0.6"/>
    <ellipse cx="625" cy="105" rx="22" ry="16" fill="#8b1a00" opacity="0.5"/>
    <ellipse cx="655" cy="365" rx="24" ry="17" fill="#8b1a00" opacity="0.55"/>

    <!-- Torch glows -->
    <circle cx="145" cy="110" r="40" fill="#c93010" opacity="0.08" filter="url(#glow)"/>
    <circle cx="385" cy="90" r="35" fill="#c97010" opacity="0.06" filter="url(#glow)"/>
    <circle cx="625" cy="100" r="38" fill="#c93010" opacity="0.07" filter="url(#glow)"/>

    <!-- Map label -->
    <text x="400" y="480" text-anchor="middle" font-family="Cinzel, serif" font-size="14" fill="#5a3a18" letter-spacing="4" opacity="0.8">GROTA WYGNAŃCÓW</text>

    <!-- Rock details -->
    <g opacity="0.4" fill="#1a0d05">
      <polygon points="50,200 80,180 90,220"/>
      <polygon points="700,150 730,130 740,170"/>
      <polygon points="350,350 380,330 390,370"/>
      <polygon points="500,400 530,380 540,420"/>
    </g>
  `;

  wrapper.insertBefore(svg, wrapper.querySelector('#generalPins'));
}

// ===== MODAL =====
function openKillModal(gen) {
  selectedGeneral = gen;
  document.getElementById('modalTitle').textContent = `${gen.name}`;
  document.getElementById('killerNick').value = localStorage.getItem('playerNick') || '';

  // Build channel buttons
  const grid = document.getElementById('channelGrid');
  grid.innerHTML = '';

  for (let ch = 1; ch <= 8; ch++) {
    const key = `${gen.id}_${ch}`;
    const status = activeStatuses[key];
    const isKilled = !!status;

    const btn = document.createElement('button');
    btn.className = 'ch-btn';
    btn.textContent = `CH${ch}`;

    if (isKilled) {
      const elapsed = getElapsedMinutes(status.killed_at);
      btn.style.borderColor = 'rgba(176,28,28,0.6)';
      btn.style.color = 'var(--red-bright)';
      btn.title = `Zabity ${elapsed} min temu`;
    }

    btn.addEventListener('click', () => killGeneral(gen, ch));
    grid.appendChild(btn);
  }

  document.getElementById('killModal').classList.add('open');
}

function closeModal() {
  document.getElementById('killModal').classList.remove('open');
  selectedGeneral = null;
}

// Close on overlay click
document.getElementById('killModal')?.addEventListener('click', function (e) {
  if (e.target === this) closeModal();
});

// Close on Escape
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') closeModal();
});

// ===== KILL GENERAL =====
async function killGeneral(gen, channel) {
  const nick = document.getElementById('killerNick')?.value?.trim() || 'Anonim';
  if (nick) localStorage.setItem('playerNick', nick);

  closeModal();

  try {
    const res = await fetch('/api/generals/kill', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        general_id: gen.id,
        channel: channel,
        killed_by: nick
      })
    });

    if (!res.ok) throw new Error('Server error');
  } catch (e) {
    showToast('Błąd połączenia z serwerem!', 'error');
  }
}

// ===== RESET GENERAL =====
async function resetGeneral(entryId) {
  try {
    await fetch(`/api/generals/${entryId}`, { method: 'DELETE' });
  } catch (e) {
    showToast('Błąd resetu!', 'error');
  }
}

// ===== REFRESH UI =====
function refreshUI() {
  refreshPins();
  refreshList();
}

function refreshPins() {
  GENERALS.forEach(gen => {
    const circle = document.getElementById(`pinCircle_${gen.id}`);
    const timerEl = document.getElementById(`pinTimer_${gen.id}`);
    if (!circle) return;

    // Find any killed status for this general (any channel)
    const entries = Object.values(activeStatuses).filter(s => s.general_id === gen.id);

    if (entries.length === 0) {
      circle.className = 'pin-circle';
      circle.textContent = gen.emoji;
      if (timerEl) timerEl.style.display = 'none';
      return;
    }

    // Pick most recently killed
    const latest = entries.sort((a, b) => b.killed_at - a.killed_at)[0];
    const { state, label } = getTimerState(latest);

    if (state === 'dead') {
      circle.className = 'pin-circle dead';
    } else if (state === 'soon') {
      circle.className = 'pin-circle soon';
    } else {
      circle.className = 'pin-circle';
    }

    circle.textContent = gen.emoji;

    if (timerEl) {
      timerEl.style.display = 'block';
      timerEl.textContent = label;
      timerEl.className = `pin-timer ${state === 'alive' ? 'alive' : ''}`;
    }
  });
}

function refreshList() {
  const list = document.getElementById('generalsList');
  if (!list) return;

  const entries = Object.values(activeStatuses);

  if (entries.length === 0) {
    list.innerHTML = '<div class="no-kills">Brak zabitych Generałów.<br>Kliknij na mapie, aby oznaczyć bossa.</div>';
    return;
  }

  // Sort: soonest respawn first
  entries.sort((a, b) => a.killed_at - b.killed_at);

  list.innerHTML = '';
  entries.forEach(entry => {
    const gen = GENERALS.find(g => g.id === entry.general_id);
    if (!gen) return;

    const { state, label, pct } = getTimerState(entry);
    const entryEl = document.createElement('div');
    entryEl.className = `general-entry ${state === 'dead' ? 'dead' : ''} ${state === 'soon' ? 'soon-to-spawn' : ''}`;

    entryEl.innerHTML = `
      <div class="entry-top">
        <span class="entry-name">${gen.emoji} ${gen.name}</span>
        <span class="entry-ch">CH${entry.channel}</span>
      </div>
      <div class="entry-timer ${state === 'alive' ? 'alive' : state === 'soon' ? 'spawning' : ''}">
        ${label}
      </div>
      <div class="entry-meta">
        Zabity przez: ${escapeHtml(entry.killed_by || 'Anonim')} · ${formatTime(entry.killed_at)}
      </div>
      <button class="entry-reset" onclick="resetGeneral('${entry.id}')">✕ Usuń wpis</button>
    `;

    list.appendChild(entryEl);
  });
}

function refreshTimers() {
  refreshPins();
  // Update timer texts in list
  const entries = Object.values(activeStatuses);
  entries.forEach(entry => {
    const { state, label } = getTimerState(entry);
    // Update existing list entries without full re-render for performance
    // But for simplicity, just re-render the whole list periodically
  });

  // Full re-render every 5s to avoid stale timers
  if (Date.now() % 5000 < 1100) refreshList();
}

// ===== TIMER LOGIC =====
function getTimerState(entry) {
  const now = Date.now();
  const elapsed = now - entry.killed_at; // ms since kill
  const elapsedMin = elapsed / 60000;
  const minRespawn = RESPAWN_MIN * 60000; // 6h in ms
  const maxRespawn = RESPAWN_MAX * 60000; // 8h in ms

  const timeToMin = minRespawn - elapsed;
  const timeToMax = maxRespawn - elapsed;

  if (elapsed < minRespawn) {
    // Still dead for sure
    const remainMin = Math.ceil(timeToMin / 60000);
    const h = Math.floor(remainMin / 60);
    const m = remainMin % 60;
    const label = h > 0 ? `Respawn za ${h}h ${m}min` : `Respawn za ${m} min`;
    return { state: 'dead', label, pct: elapsed / minRespawn };
  } else if (elapsed < maxRespawn) {
    // Can respawn any moment
    const elapsedSinceMin = elapsed - minRespawn;
    const window = maxRespawn - minRespawn;
    const label = `⚡ Może się zrespawnować!`;
    return { state: 'soon', label, pct: elapsedSinceMin / window };
  } else {
    // Past max respawn — already alive
    return { state: 'alive', label: `✓ Prawdopodobnie żywy`, pct: 1 };
  }
}

// ===== HELPERS =====
function getElapsedMinutes(killedAt) {
  return Math.floor((Date.now() - killedAt) / 60000);
}

function getGeneralName(id) {
  return GENERALS.find(g => g.id === id)?.name || id;
}

function formatTime(ts) {
  const d = new Date(ts);
  return d.toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit' });
}

function escapeHtml(str) {
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// ===== TOAST =====
function showToast(message, type = 'success') {
  const container = document.getElementById('toastContainer');
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.textContent = message;
  container.appendChild(toast);
  setTimeout(() => toast.remove(), 4100);
}

// ===== EMBERS =====
function spawnEmbers() {
  const container = document.getElementById('embers');
  if (!container) return;

  for (let i = 0; i < 25; i++) {
    setTimeout(() => {
      const ember = document.createElement('div');
      ember.className = 'ember';
      ember.style.left = `${Math.random() * 100}%`;
      ember.style.animationDuration = `${6 + Math.random() * 10}s`;
      ember.style.animationDelay = `${Math.random() * 8}s`;
      ember.style.setProperty('--drift', `${(Math.random() - 0.5) * 80}px`);
      ember.style.width = ember.style.height = `${1 + Math.random() * 3}px`;
      container.appendChild(ember);
    }, i * 200);
  }
}

// ===== FETCH INITIAL STATE (fallback if WS slow) =====
async function fetchInitialState() {
  try {
    const res = await fetch('/api/generals');
    const data = await res.json();
    if (data.length > 0 && Object.keys(activeStatuses).length === 0) {
      data.forEach(entry => {
        activeStatuses[`${entry.general_id}_${entry.channel}`] = entry;
      });
      refreshUI();
    }
  } catch (e) { /* ignore */ }
}

setTimeout(fetchInitialState, 2000);
