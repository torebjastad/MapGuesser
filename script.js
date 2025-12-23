(() => {
  // --- DATA: DEFINE MAPS HERE ---
  // --- DATA: MAP SOURCES ---
  const MAP_SOURCES = {
    europe: { name: "Europe", file: "Maps/europeLow.svg", viewBox: "50 50 700 700" },
    africa: { name: "Africa", file: "Maps/africaLow.svg", viewBox: "370 310 280 280" },
    asia: { name: "Asia", file: "Maps/asiaLow.svg", viewBox: "580 200 300 300" }, // Estimated viewbox based on coordinates
    usa: { name: "USA", file: "Maps/usaLow.svg", viewBox: "130 -20 800 800" }
  };

  const DEBUG_TEST_MAP = false; // Toggle this to enable Test Map
  if (DEBUG_TEST_MAP) {
    MAP_SOURCES.TEST_MAP = { name: "TEST_MAP", file: "Maps/TEST_MAP.svg", viewBox: "0 0 800 600" };
  }

  // Increment this when you update map files to force reload
  const APP_VERSION = '2.7';
  const DEBUG_TOUCH = false;

  const mapCache = new Map();


  // Helper to fetch and parse SVG
  async function fetchMapData(key) {
    if (mapCache.has(key)) return mapCache.get(key);

    const src = MAP_SOURCES[key];
    if (!src) return null;

    try {
      const resp = await fetch(`${src.file}?v=${APP_VERSION}`);
      if (!resp.ok) throw new Error(`Failed to load ${src.file}`);
      const text = await resp.text();

      const parser = new DOMParser();
      const doc = parser.parseFromString(text, "image/svg+xml");

      const svgEl = doc.querySelector('svg');
      if (!svgEl) throw new Error('No SVG element found');

      // Use custom viewBox from config if available, else derive from SVG
      const viewBox = src.viewBox || svgEl.getAttribute('viewBox') || "0 0 800 600";

      // Extract content: try active grouping <g> or fallback to just paths
      // The user provided structure shows a main <g> containing paths.
      // We'll append all child nodes of the root SVG that are not defs/metadata?
      // Simplest: take innerHTML of the SVG but filtering out scripts/etc if needed.
      // Actually, we can just grab all 'path' elements or the first 'g'.
      // Let's grab specific 'land' paths or just everything in the 'g'.

      // Attempt to find the group containing paths
      const g = doc.querySelector('g');
      let content = "";
      if (g) {
        content = g.innerHTML;
      } else {
        // Fallback: all paths
        const paths = doc.querySelectorAll('path');
        paths.forEach(p => content += p.outerHTML);
      }

      const data = {
        name: src.name,
        viewBox,
        content
      };

      mapCache.set(key, data);
      return data;

    } catch (e) {
      console.error(e);
      toast(`Error loading map: ${e.message}`, 'error');
      return null;
    }
  }

  // --- HIGHSCORE --
  const HIGH_SCORE_URL = "https://script.google.com/macros/s/AKfycbwCsA4TCK9Yq35y3BmD_pvFlYABWV1R322C67SdU9dYWfmvsxvyii_142Pysd-7QDTkwQ/exec";

  function formatScoreForUpload(ms) {
    const totalSec = ms / 1000;
    const m = Math.floor(totalSec / 60);
    const s = Math.floor(totalSec % 60);
    const msPart = Math.floor((totalSec - Math.floor(totalSec)) * 1000);
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}:${String(msPart).padStart(3, '0')}`;
  }

  function formatLeaderboardDisplay(timeStr) {
    if (!timeStr) return '—';
    // Expected format: MM:SS:mmm (e.g. 02:04:379)
    // We want to display M:SS.d (e.g. 2:04.4)
    const parts = timeStr.split(':');
    if (parts.length === 3) {
      let m = parseInt(parts[0], 10);
      let s = parseInt(parts[1], 10);
      let ms = parseInt(parts[2], 10);

      // Round to nearest 100ms (tenth of a second)
      let d = Math.round(ms / 100);

      if (d === 10) {
        d = 0;
        s++;
        if (s === 60) {
          s = 0;
          m++;
        }
      }

      return `${m}:${String(s).padStart(2, '0')}.${d}`;
    }
    return timeStr; // Fallback
  }

  function capitalize(s) {
    if (!s) return '';
    return s.charAt(0).toUpperCase() + s.slice(1);
  }

  function parseScoreToMs(timeStr) {
    if (!timeStr) return Infinity;
    const parts = timeStr.split(':');
    if (parts.length !== 3) return Infinity;
    const m = parseInt(parts[0], 10);
    const s = parseInt(parts[1], 10);
    const ms = parseInt(parts[2], 10);
    return (m * 60 + s) * 1000 + ms;
  }

  function sendHighScore(spillerNavn, poengSum, regionKey) {
    const regionName = capitalize(regionKey);
    const data = {
      name: spillerNavn,
      score: poengSum, // Expecting formatted string "MM:SS:mmm"
      sheetName: `${regionName}InData`
    };

    fetch(HIGH_SCORE_URL, {
      method: "POST",
      mode: "no-cors",
      cache: "no-cache",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(data)
    })
      .then(() => {
        console.log("Poengsum lagret i Google Sheets!");
        toast("Score Submitted!", "good");
        // Optimistically re-fetch after a delay to allow sheet to process
        setTimeout(() => fetchLeaderboard(regionKey), 2000);
      })
      .catch((error) => {
        console.error("Feil ved lagring:", error);
        toast("Submission Failed", "bad");
      });
  }

  function fetchLeaderboard(regionKey) {
    const lbEl = $('#globalLeaderboard');
    if (!lbEl) return;

    lbEl.innerHTML = '<div class="loading-text">Loading...</div>';

    const regionName = capitalize(regionKey);
    const sheetName = `${regionName}HighScore`;
    const url = `${HIGH_SCORE_URL}?sheetName=${sheetName}&limit=10`;

    fetch(url)
      .then(res => res.json())
      .then(data => {
        lbEl.innerHTML = '';
        if (!Array.isArray(data) || data.length === 0) {
          lbEl.innerHTML = '<div class="loading-text">No scores yet</div>';
          return;
        }


        // Calculate Cutoff (10th place or Infinity if < 10)
        if (data.length >= 10) {
          const lastRow = data[data.length - 1]; // [Name, Score]
          state.leaderboardCutoff = parseScoreToMs(lastRow[1]);
        } else {
          state.leaderboardCutoff = Infinity;
        }

        data.forEach((row, i) => {
          // Expecting row = [Name, Score]
          const name = row[0] || 'Unknown';
          const rawScore = row[1] || '';
          const displayScore = formatLeaderboardDisplay(rawScore);

          const div = document.createElement('div');
          div.className = 'leaderboard-row';
          div.innerHTML = `
            <span class="rank">${i + 1}.</span>
            <span class="name">${name}</span>
            <span class="score">${displayScore}</span>
          `;
          lbEl.appendChild(div);
        });
      })
      .catch(e => {
        console.error(e);
        lbEl.innerHTML = '<div class="loading-text">Failed to load</div>';
      });
  }

  const $ = (sel, root = document) => root.querySelector(sel);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const now = () => performance.now();

  function parseViewBox(vb) {
    const parts = (vb || '').trim().split(/[ ,]+/).map(Number);
    if (parts.length !== 4 || parts.some(n => !Number.isFinite(n))) return { x: 0, y: 0, w: 900, h: 800 };
    return { x: parts[0], y: parts[1], w: parts[2], h: parts[3] };
  }

  // ... (rest of helpers unchanged until initMapSelector) ...

  function initMapSelector() {
    mapSelectEl.innerHTML = '';
    const keys = Object.keys(MAP_SOURCES);
    if (keys.length === 0) return;

    for (const key of keys) {
      const opt = document.createElement('option');
      opt.value = key;
      opt.textContent = MAP_SOURCES[key].name;
      mapSelectEl.appendChild(opt);
    }
    if (!MAP_SOURCES[currentMapKey]) currentMapKey = keys[0];
    mapSelectEl.value = currentMapKey;
    mapSelectEl.addEventListener('change', (e) => loadMap(e.target.value));
  }

  async function loadMap(key) {
    if (state.phase === 'running') {
      if (state.rafTimer) cancelAnimationFrame(state.rafTimer);
      state.rafTimer = 0;
    }

    // Show loading state?
    viewport.innerHTML = ''; // Clear current
    targetEl.textContent = 'Loading...';

    const data = await fetchMapData(key);
    if (!data) {
      targetEl.textContent = 'Error loading map';
      return;
    }

    currentMapKey = key;

    svg.setAttribute('viewBox', data.viewBox);
    viewport.innerHTML = data.content;

    labelsContainer.innerHTML = '';
    activeLabels = [];

    buildCountryIndex();

    view.base = parseViewBox(data.viewBox);
    view.cur = { ...view.base };
    scheduleViewBox({ ...view.cur });

    resetGame();
    fetchLeaderboard(key);
  }

  function fmtTime(ms) {
    const t = Math.max(0, ms);
    const totalSec = t / 1000;
    const m = Math.floor(totalSec / 60);
    const s = Math.floor(totalSec % 60);
    const d = Math.floor((totalSec % 1) * 10);
    return `${m}:${String(s).padStart(2, '0')}.${d}`;
  }

  function colorFor(id) {
    let h = 0;
    for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
    const hue = h % 360;
    return `hsla(${hue}, 78%, 56%, 0.45)`;
  }

  // --- AUDIO ---
  let audioCtx = null;
  let audioUnlocked = false;

  function unlockAudio() {
    if (audioUnlocked) return;
    try {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      if (!AudioContext) return;
      audioCtx = audioCtx || new AudioContext();
      if (audioCtx.state === 'suspended') audioCtx.resume();

      const o = audioCtx.createOscillator();
      const g = audioCtx.createGain();
      g.gain.value = 0.0001;
      o.connect(g); g.connect(audioCtx.destination);
      o.start(); o.stop(audioCtx.currentTime + 0.01);
      audioUnlocked = true;
    } catch (e) { console.error(e); }
  }

  function beep({ freq = 440, dur = 0.06, type = 'sine', gain = 0.05 } = {}) {
    if (!audioUnlocked || !audioCtx) return;
    const t0 = audioCtx.currentTime;
    const o = audioCtx.createOscillator();
    const g = audioCtx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t0);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(gain, t0 + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g);
    g.connect(audioCtx.destination);
    o.start(t0);
    o.stop(t0 + dur + 0.02);
  }

  function fanfare() {
    if (!audioUnlocked || !audioCtx) return;
    const base = 440;
    const notes = [0, 4, 7, 12, 16].map(n => base * Math.pow(2, n / 12));
    let t = audioCtx.currentTime;
    for (let i = 0; i < notes.length; i++) {
      const o = audioCtx.createOscillator();
      const g = audioCtx.createGain();
      o.type = 'triangle';
      o.frequency.setValueAtTime(notes[i], t);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.08, t + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.15);
      o.connect(g); g.connect(audioCtx.destination);
      o.start(t);
      o.stop(t + 0.18);
      t += 0.06;
    }
  }

  function errorSound() {
    if (!audioUnlocked || !audioCtx) return;
    const t0 = audioCtx.currentTime;
    const o = audioCtx.createOscillator();
    const g = audioCtx.createGain();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(220, t0);
    o.frequency.exponentialRampToValueAtTime(110, t0 + 0.18);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(0.07, t0 + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.2);
    o.connect(g); g.connect(audioCtx.destination);
    o.start(t0);
    o.stop(t0 + 0.22);
  }

  // --- CONFETTI ---
  const confettiCanvas = $('#confettiCanvas');
  const ctx = confettiCanvas.getContext('2d');
  let confettiParticles = [];
  let confettiRaf = 0;

  // DEBUG LOGGING
  const debugEl = document.getElementById('debugParams');
  if (DEBUG_TOUCH && debugEl) debugEl.style.display = 'block';

  function logDebug(msg) {
    if (!DEBUG_TOUCH || !debugEl) return;
    const lines = debugEl.textContent.split('\n');
    lines.push(`${now().toFixed(0)}: ${msg}`);
    if (lines.length > 8) lines.shift();
    debugEl.textContent = lines.join('\n');
    console.log(msg);
  }

  function resizeConfetti() {
    confettiCanvas.width = confettiCanvas.offsetWidth;
    confettiCanvas.height = confettiCanvas.offsetHeight;
  }
  window.addEventListener('resize', resizeConfetti);
  resizeConfetti();

  function spawnConfetti(originX, originY) {
    for (let i = 0; i < 150; i++) {
      const angle = Math.random() * Math.PI * 2;
      const vel = 3 + Math.random() * 8;
      confettiParticles.push({
        x: originX, y: originY,
        vx: Math.cos(angle) * vel,
        vy: Math.sin(angle) * vel - 4, // Upward bias
        grav: 0.15 + Math.random() * 0.1,
        drag: 0.96,
        color: `hsl(${Math.random() * 360}, 100%, 50%)`,
        size: 4 + Math.random() * 4,
        rot: Math.random() * 360,
        vRot: (Math.random() - 0.5) * 10
      });
    }
    if (!confettiRaf) loopConfetti();
  }

  function loopConfetti() {
    ctx.clearRect(0, 0, confettiCanvas.width, confettiCanvas.height);
    if (confettiParticles.length === 0) {
      confettiRaf = 0;
      return;
    }

    for (let i = confettiParticles.length - 1; i >= 0; i--) {
      const p = confettiParticles[i];
      p.x += p.vx;
      p.y += p.vy;
      p.vy += p.grav;
      p.vx *= p.drag;
      p.vy *= p.drag;
      p.rot += p.vRot;

      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot * Math.PI / 180);
      ctx.fillStyle = p.color;
      ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size);
      ctx.restore();

      if (p.y > confettiCanvas.height + 20) confettiParticles.splice(i, 1);
    }
    confettiRaf = requestAnimationFrame(loopConfetti);
  }

  // --- DOM ELEMENTS ---
  const svg = $('#mapSvg');
  const viewport = $('#viewport');
  const startBtn = $('#startBtn');
  const clockEl = $('#clock');
  const targetEl = $('#targetCountry');
  const toastEl = $('#toast');
  const guessedRemainingEl = $('#guessedRemaining');
  const mistakesEl = $('#mistakes');
  const accuracyEl = $('#accuracy');
  const bestEl = $('#best');
  const foundListEl = $('#foundList');
  const listTitleEl = $('#listTitle');
  const listActionEl = $('#listAction');
  const mapSelectEl = $('#mapSelect');
  const mapPane = $('#mapPane');
  const labelsContainer = $('#labelsContainer');

  const flawlessBox = $('#flawlessBox');
  // Modal Elements
  const highScoreModal = $('#highScoreModal');
  const modalTime = $('#modalTime');
  const modalAccuracy = $('#modalAccuracy');
  const playerNameInput = $('#playerNameInput');
  const submitScoreBtn = $('#submitScoreBtn');
  const cancelScoreBtn = $('#cancelScoreBtn');

  // Modal Logic
  function showHighScoreModal(finalMs, accuracyVal) {
    modalTime.textContent = fmtTime(finalMs);
    modalAccuracy.textContent = accuracyVal + '%';
    highScoreModal.classList.add('show');
    playerNameInput.value = localStorage.getItem('last_player_name') || '';
    playerNameInput.focus();

    // One-off submit handler
    submitScoreBtn.onclick = () => {
      const name = playerNameInput.value.trim();
      if (!name) {
        toast('Enter a name!', 'bad');
        return;
      }
      localStorage.setItem('last_player_name', name);
      sendHighScore(name, formatScoreForUpload(finalMs), currentMapKey);
      highScoreModal.classList.remove('show');
    };

    cancelScoreBtn.onclick = () => {
      highScoreModal.classList.remove('show');
    };
  }

  let toastTimer = null;
  function toast(msg, kind = '') {
    clearTimeout(toastTimer);
    toastEl.className = '';
    toastEl.textContent = msg;
    toastEl.classList.add('show');
    if (kind) toastEl.classList.add(kind);
    toastTimer = setTimeout(() => toastEl.classList.remove('show', 'good', 'bad'), 1200);
  }

  // --- STATE ---
  let currentMapKey = DEBUG_TEST_MAP ? 'TEST_MAP' : 'europe';
  let countries = [];
  let countryById = new Map();
  // We keep track of active labels to update their position on zoom/pan
  let activeLabels = [];

  const state = {
    phase: 'idle', // idle | running | done
    startAt: 0,
    rafTimer: 0,
    elapsedMs: 0,
    remainingIds: [],
    targetId: null,
    targetPickTime: 0, // When current target was picked
    mistakes: 0,
    correct: 0,
    found: [],
    bestMs: null,
    isFullRun: true,
    leaderboardCutoff: Infinity, // Time to beat (ms)
  };

  // --- LABELS SYSTEM ---
  function spawnLabel(text, type = 'permanent', position = null) {
    if (type === 'permanent') {
      activeLabels = activeLabels.filter(l => {
        if (l.type === 'permanent') {
          l.el.remove();
          return false;
        }
        return true;
      });
    }

    const div = document.createElement('div');
    div.className = `map-label ${type === 'error' ? 'error' : ''}`;
    div.textContent = text;

    const labelObj = { el: div, type };

    if (position) {
      if (position.mapX !== undefined) {
        labelObj.mapX = position.mapX;
        labelObj.mapY = position.mapY;
      } else if (position.clientX !== undefined) {
        // Convert screen to map coordinates immediately
        const pt = svgPointFromClient(position.clientX, position.clientY);
        labelObj.mapX = pt.x;
        labelObj.mapY = pt.y;
      }
    }

    labelsContainer.appendChild(div);

    // Set initial position immediately
    if (labelObj.mapX !== undefined) {
      updateLabelPosition(labelObj);
    }

    requestAnimationFrame(() => div.classList.add('visible'));

    if (type === 'error') {
      activeLabels.push(labelObj);
      setTimeout(() => {
        div.classList.remove('visible');
        setTimeout(() => {
          div.remove();
          activeLabels = activeLabels.filter(l => l !== labelObj);
        }, 200);
      }, 1500);
    } else {
      activeLabels.push(labelObj);
    }
  }

  function clearPermanentLabels() {
    activeLabels = activeLabels.filter(l => {
      if (l.type === 'permanent') {
        l.el.remove();
        return false;
      }
      return true;
    });
  }

  function updateLabelPosition(l) {
    if (!view.cur) return;

    // Convert Map (SVG) Point -> Screen Point
    const pt = svg.createSVGPoint();
    pt.x = l.mapX;
    pt.y = l.mapY;

    const ctm = svg.getScreenCTM();
    if (!ctm) return; // Can happen if hidden

    const screenPt = pt.matrixTransform(ctm);
    const rect = mapPane.getBoundingClientRect();

    l.el.style.left = (screenPt.x - rect.left) + 'px';
    l.el.style.top = (screenPt.y - rect.top) + 'px';
  }

  function updateAllLabels() {
    for (const l of activeLabels) {
      updateLabelPosition(l);
    }
  }

  // --- MAP LOADING ---


  function stripBackgroundRects() {
    const vb = parseViewBox(svg.getAttribute('viewBox'));
    const rects = [...svg.querySelectorAll('rect')];
    for (const r of rects) {
      const fill = (r.getAttribute('fill') || '').trim().toLowerCase();
      const x = Number(r.getAttribute('x') || 0);
      const y = Number(r.getAttribute('y') || 0);
      const w = Number(r.getAttribute('width') || 0);
      const h = Number(r.getAttribute('height') || 0);
      const looksLikeBg = (x === vb.x || x === 0) && (y === vb.y || y === 0) && w >= vb.w * 0.98 && h >= vb.h * 0.98;
      const isOcean = fill.includes('url(#ocean)');
      if (looksLikeBg || isOcean) r.remove();
    }
  }

  function getCountryIdFromEl(el) {
    if (!el) return null;
    if (el.dataset && el.dataset.ref) return el.dataset.ref;
    if (el.id) return el.id;
    const p = el.closest ? el.closest('[data-ref], path.land, path.country, [id]') : null;
    if (!p) return null;
    if (p.dataset && p.dataset.ref) return p.dataset.ref;
    return p.id || null;
  }

  function buildCountryIndex() {
    stripBackgroundRects();
    [...viewport.querySelectorAll('.hit')].forEach(n => n.remove());

    const els = [...viewport.querySelectorAll('path.land, path.country, path[data-id]')];
    countries = [];
    countryById = new Map();

    for (const el of els) {
      const id = (el.getAttribute('id') || '').trim();
      if (!id) continue;
      const name = (el.getAttribute('title') || el.getAttribute('data-id') || el.getAttribute('data-name') || id).trim();
      try {
        const bbox = el.getBBox();
        const c = { id, name, el, bbox, guessed: false };
        countries.push(c);
        countryById.set(id, c);
      } catch (_) { }
    }

    countries.sort((a, b) => a.name.localeCompare(b.name));

    const vb = parseViewBox(svg.getAttribute('viewBox'));
    const vbArea = vb.w * vb.h;
    if (countries.length > 0) {
      const bboxAreas = countries.map(c => Math.max(0.000001, c.bbox.width * c.bbox.height)).sort((a, b) => a - b);

      let medianArea = 0;
      if (bboxAreas.length > 0) {
        const mid = Math.floor(bboxAreas.length / 2);
        medianArea = bboxAreas.length % 2 !== 0 ? bboxAreas[mid] : (bboxAreas[mid - 1] + bboxAreas[mid]) / 2;
      }

      const microThresh = medianArea > 0 ? medianArea / 10 : vbArea * 0.00035;

      for (const c of countries) {
        const a = c.bbox.width * c.bbox.height;
        // Flag microstates
        if (a <= microThresh) {
          c.isMicro = true;
        }

        const cx = c.bbox.x + c.bbox.width / 2;
        const cy = c.bbox.y + c.bbox.height / 2;
        c.center = { x: cx, y: cy };

        if (a > microThresh) continue;

        const hp = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        hp.setAttribute('d', c.el.getAttribute('d') || '');
        hp.setAttribute('class', 'hit hit-path');
        hp.dataset.ref = c.id;
        hp.setAttribute('stroke-width', '30');
        hp.setAttribute('vector-effect', 'non-scaling-stroke');
        hp.setAttribute('pointer-events', 'stroke');

        c.el.insertAdjacentElement('afterend', hp);
      }
    }
  }

  // --- GAME LOGIC ---

  function getBestTimeKey() {
    return `best_ms_${currentMapKey}`;
  }

  function loadBestTime() {
    if (currentMapKey === 'europe' && localStorage.getItem('eu_best_ms') && !localStorage.getItem(getBestTimeKey())) {
      localStorage.setItem(getBestTimeKey(), localStorage.getItem('eu_best_ms'));
    }
    const stored = localStorage.getItem(getBestTimeKey());
    state.bestMs = (stored && !isNaN(stored)) ? Number(stored) : null;
  }

  function setPhase(phase) {
    state.phase = phase;
    startBtn.textContent = (phase === 'running') ? 'RESET (Space)' : 'START (Space)';
    startBtn.classList.add('primary');
    targetEl.classList.toggle('running', phase === 'running');
  }

  function updateBestUI() {
    bestEl.textContent = state.bestMs == null ? '—' : fmtTime(state.bestMs);
  }

  function updateGuessedRemaining() {
    const total = state.remainingIds.length + state.correct;
    guessedRemainingEl.textContent = `${state.correct}/${total}`;
  }

  function updateMistakesUI() {
    mistakesEl.textContent = String(state.mistakes);
    const total = state.correct + state.mistakes;
    accuracyEl.textContent = total === 0 ? '—' : `${Math.round((state.correct / total) * 100)}%`;
  }

  function checkHighScore(finalTime) {
    if (state.isFullRun && countries.length > 0) {
      if (state.bestMs == null || finalTime < state.bestMs) {
        state.bestMs = finalTime;
        localStorage.setItem(getBestTimeKey(), String(state.bestMs));
        updateBestUI();
        toast('New best time!', 'good');
      } else {
        toast('Completed!', 'good');
      }
    } else {
      toast('Custom run done!', 'good');
    }
  }

  function animateClockRewind(fromMs, toMs, onComplete) {
    clockEl.classList.add('bonus');
    const duration = 2000;
    const start = performance.now();

    function step() {
      const nowT = performance.now();
      const progress = Math.min(1, (nowT - start) / duration);
      const ease = 1 - Math.pow(1 - progress, 3);
      const currentMs = fromMs - ((fromMs - toMs) * ease);

      clockEl.textContent = fmtTime(currentMs);

      if (progress < 1) {
        requestAnimationFrame(step);
      } else {
        clockEl.classList.remove('bonus');
        if (onComplete) onComplete();
      }
    }
    requestAnimationFrame(step);
  }

  function renderFoundList() {
    listTitleEl.textContent = 'FOUND (Sorted by Time)';
    listActionEl.textContent = '';
    listActionEl.onclick = null;
    foundListEl.innerHTML = '';

    const sorted = [...state.found].sort((a, b) => b.timeMs - a.timeMs);

    for (const f of sorted) {
      const div = document.createElement('div');
      div.className = f.failed ? 'listItem failed' : 'listItem';

      const left = document.createElement('div');

      const timeSpan = document.createElement('span');
      timeSpan.className = 'time-val';
      timeSpan.textContent = (f.timeMs / 1000).toFixed(1) + 's';

      const nameSpan = document.createElement('span');
      nameSpan.textContent = f.name;
      nameSpan.style.fontWeight = '900';
      nameSpan.style.fontSize = '13px';

      left.appendChild(timeSpan);
      left.appendChild(nameSpan);

      const right = document.createElement('span');
      right.className = 'pill';
      right.textContent = f.id;

      div.addEventListener('mouseenter', () => {
        const c = countryById.get(f.id);
        if (c) c.el.classList.add('hovered');
      });
      div.addEventListener('mouseleave', () => {
        const c = countryById.get(f.id);
        if (c) c.el.classList.remove('hovered');
      });

      div.appendChild(left);
      div.appendChild(right);
      foundListEl.appendChild(div);
    }
  }

  function renderConfigList() {
    listTitleEl.textContent = 'MAP LIST';
    listActionEl.textContent = '';
    listActionEl.onclick = null;

    foundListEl.innerHTML = '';
    if (countries.length === 0) {
      foundListEl.innerHTML = '<div style="padding:10px; color:var(--muted); font-size:12px;">No countries found. Add SVG paths to code.</div>';
      return;
    }

    for (const c of countries) {
      const div = document.createElement('div');
      div.className = 'listItem config';
      div.style.cursor = 'pointer';

      const label = document.createElement('div');
      label.textContent = c.name;
      label.style.fontWeight = '700';
      label.style.fontSize = '13px';

      div.onclick = (e) => {
        // Flash animation
        c.el.classList.remove('flash-fail');
        void c.el.offsetWidth;
        c.el.classList.add('flash-fail');
        setTimeout(() => c.el.classList.remove('flash-fail'), 2000);
      };

      div.addEventListener('mouseenter', () => {
        c.el.classList.add('hovered');
      });
      div.addEventListener('mouseleave', () => {
        c.el.classList.remove('hovered');
      });

      div.appendChild(label);
      foundListEl.appendChild(div);
    }
  }

  function pickNextTarget() {
    if (state.remainingIds.length === 0) {
      console.log("Game Finished! Handling Done state...");
      state.targetId = null;

      // Stop the game clock
      if (state.rafTimer) cancelAnimationFrame(state.rafTimer);
      state.rafTimer = 0;

      const totalGuesses = state.correct + state.mistakes;
      const accuracy = totalGuesses > 0 ? Math.round((state.correct / totalGuesses) * 100) : 0;
      const flawless = (state.mistakes === 0 && state.correct > 0);
      let finalTime = state.elapsedMs;

      if (flawless) {
        targetEl.textContent = `DONE! ${accuracy}% Accuracy`;
        flawlessBox.classList.add('show');

        // Bonus Calc
        const bonusTime = Math.floor(finalTime * 0.95);

        // Confetti from Flawless Box
        const r = flawlessBox.getBoundingClientRect();
        const mapR = mapPane.getBoundingClientRect();
        spawnConfetti(r.left - mapR.left + r.width / 2, r.top - mapR.top + r.height / 2);

        fanfare();

        // Remove Flawless Box after 4 seconds
        setTimeout(() => {
          flawlessBox.classList.remove('show');
        }, 4000);

        // Animate Clock
        animateClockRewind(finalTime, bonusTime, () => {
          checkHighScore(bonusTime);

          if (state.isFullRun && bonusTime < state.leaderboardCutoff) {
            console.log("Qualifies for Top 10! (Flawless)");
            highScoreModal.querySelector('h2').textContent = "Congrats! You made it to the global top 10!!";
            setTimeout(() => showHighScoreModal(bonusTime, accuracy), 600);
          } else {
            console.log("Did not qualify for Top 10 (Flawless)");
            toast('Flawless Run Complete!', 'good');
          }
        });
      } else {
        targetEl.textContent = `DONE! ${accuracy}% Accuracy`;
        checkHighScore(finalTime);
        // Only show modal if we qualify for top 10 (or leaderboard is not full)
        if (state.isFullRun && finalTime < state.leaderboardCutoff) {
          console.log("Qualifies for Top 10!");
          // Update Modal Title
          highScoreModal.querySelector('h2').textContent = "Congrats! You made it to the global top 10!!";
          setTimeout(() => showHighScoreModal(finalTime, accuracy), 400);
        } else {
          console.log("Did not qualify for Top 10");
          toast('Run Complete!', 'good');
        }
      }

      setPhase('done');
      return;
    }
    state.attempts = 0;
    const idx = Math.floor(Math.random() * state.remainingIds.length);
    const id = state.remainingIds[idx];
    state.targetId = id;

    // Set time tracking for next guess
    state.targetPickTime = now();

    const c = countryById.get(id);
    targetEl.textContent = c ? c.name : id;
  }

  function handleFailure(failedId) {
    const c = countryById.get(failedId);
    if (!c) return;

    // Visuals: Flash then permanent fail
    c.el.classList.add('flash-fail');
    c.guessed = true; // Mark as processed so it can't be guessed again

    // Remove flash class after animation and keep permanent fail
    setTimeout(() => {
      c.el.classList.remove('flash-fail');
      c.el.classList.add('failed');
    }, 2000);

    // Sound
    errorSound();

    // Penalty
    const PENALTY_MS = 5000;
    state.startAt -= PENALTY_MS; // Adds 5 seconds to elapsed time

    // Show Indicator
    const pi = $('#penaltyIndicator');
    pi.classList.remove('show');
    void pi.offsetWidth; // Force reflow
    pi.classList.add('show');

    // Progression
    const timeTaken = now() - state.targetPickTime + PENALTY_MS;
    state.found.push({ id: failedId, name: c.name, timeMs: timeTaken, failed: true });

    const i = state.remainingIds.indexOf(failedId);
    if (i >= 0) state.remainingIds.splice(i, 1);

    updateGuessedRemaining();
    updateMistakesUI();
    renderFoundList();

    toast(`Failed: ${c.name} (+5s)`, 'bad');
    pickNextTarget();
  }

  function resetGame() {
    clearPermanentLabels();
    flawlessBox.classList.remove('show');
    clockEl.classList.remove('bonus');

    for (const c of countries) {
      c.guessed = false;
      c.el.classList.remove('guessed', 'hovered', 'wrongflash', 'failed', 'flash-fail');
      c.el.style.removeProperty('--c');
    }
    state.startAt = 0;
    state.elapsedMs = 0;
    state.remainingIds = [];
    state.targetId = null;
    state.mistakes = 0;
    state.correct = 0;
    state.found = [];
    state.lastGuessedId = null;
    state.isFullRun = false;
    state.attempts = 0;

    loadBestTime();

    targetEl.textContent = 'Press START';
    clockEl.textContent = '00:00.0';

    guessedRemainingEl.textContent = '0/0';
    updateMistakesUI();
    renderConfigList();
    updateBestUI();

    if (state.rafTimer) cancelAnimationFrame(state.rafTimer);
    state.rafTimer = 0;

    setPhase('idle');
  }

  // --- LONG PRESS RESET LOGIC ---
  let resetTimer = 0;
  let resetStartTime = 0;
  const RESET_DURATION = 500;
  let ignoreClick = false;

  function handleResetStart(e) {
    if (state.phase !== 'running' && state.phase !== 'done') return; // Only allow reset if running/done? or anytime? usually anytime not idle.
    // Actually, user said "game can be reset". If it's idle, it's already reset.
    if (state.phase === 'idle') return;

    // Prevent default click behavior
    if (e.cancelable) e.preventDefault();

    resetStartTime = now();
    targetEl.classList.add('reset-arming');

    // Force reflow to ensure black starts immediately before transition
    void targetEl.offsetWidth;

    targetEl.classList.add('reset-active');
  }

  function handleResetEnd(e) {
    if (!resetStartTime) return;

    const duration = now() - resetStartTime;
    cancelReset();

    if (duration >= RESET_DURATION) {
      resetGame();
      toast('Game Reset', 'bad');

      // Prevent the subsequent click from restarting the game immediately
      ignoreClick = true;
      setTimeout(() => ignoreClick = false, 500);
    } else {
      // toast('Hold longer to reset', 'bad'); 
      // Optional: feedback if released too early?
    }
  }

  function cancelReset() {
    resetStartTime = 0;
    targetEl.classList.remove('reset-arming', 'reset-active');
  }

  // Attach Reset Listeners
  // targetEl.onclick = resetGame; // REMOVED simple click
  targetEl.addEventListener('mousedown', handleResetStart);
  targetEl.addEventListener('touchstart', handleResetStart, { passive: false });

  targetEl.addEventListener('mouseup', handleResetEnd);
  targetEl.addEventListener('touchend', handleResetEnd);

  targetEl.addEventListener('mouseleave', cancelReset);
  // specific logic for touch moving off element is tricky, 
  // but if they drag *off* it usually fires standard events or we can rely on cancel triggers.
  // Ideally we track touchmove and check elementFromPoint, but mouseleave covers mouse.
  // For touch, often just lifting finger triggers end.
  // If they slide off, they might not trigger 'leave'.
  // Let's add touchcancel.
  targetEl.addEventListener('touchcancel', cancelReset);

  targetEl.addEventListener('touchmove', (e) => {
    // If pointer moves outside bounding box, cancel reset
    const t = e.touches[0];
    const rect = targetEl.getBoundingClientRect();
    // Use a small buffer? No, strict is fine.
    if (t.clientX < rect.left || t.clientX > rect.right || t.clientY < rect.top || t.clientY > rect.bottom) {
      cancelReset();
    }
  }, { passive: true });

  // Ensure no old click handler exists if it was assigned via property
  targetEl.onclick = null;

  function startGame() {
    const activeIds = countries.map(c => c.id);

    if (activeIds.length === 0) {
      toast('Map is empty!', 'bad');
      return;
    }

    clearPermanentLabels();
    flawlessBox.classList.remove('show');
    highScoreModal.classList.remove('show'); /* Ensure modal closed on restart */

    state.startAt = now();
    state.elapsedMs = 0;
    state.mistakes = 0;
    state.correct = 0;
    state.found = [];
    state.remainingIds = activeIds;
    state.attempts = 0;

    state.isFullRun = (activeIds.length === countries.length);

    updateGuessedRemaining();
    updateMistakesUI();
    renderFoundList();

    setPhase('running');
    pickNextTarget();
    tickClock();
    toast('Go!', 'good');
  }

  function tickClock() {
    if (state.phase !== 'running') return;
    state.elapsedMs = now() - state.startAt;
    clockEl.textContent = fmtTime(state.elapsedMs);
    state.rafTimer = requestAnimationFrame(tickClock);
  }

  function handleGuess(candidateIds, clientX, clientY) {
    if (state.phase !== 'running') return;
    if (!candidateIds || candidateIds.length === 0) return;

    // Logic: If the target is in the candidates, pick it!
    // Otherwise pick the first one.
    let clickedId = candidateIds[0];
    if (state.targetId && candidateIds.includes(state.targetId)) {
      clickedId = state.targetId;
    }

    const clicked = countryById.get(clickedId);
    if (!clicked) return;

    // Filter out bounces/echoes: Impossible to react in < 250ms
    if (now() - state.targetPickTime < 250) {
      logDebug(`Ignored: Debounce (${now() - state.targetPickTime | 0}ms)`);
      return;
    }

    // Strict double-tap prevention
    if (clickedId === state.lastGuessedId) {
      logDebug(`Ignored: Duplicate ID ${clickedId}`);
      return;
    }

    if (clicked.guessed) {
      logDebug(`Ignored: Already Guessed`);
      return;
    }

    if (clickedId === state.targetId) {
      logDebug(`CORRECT!`);
      state.lastGuessedId = clickedId;
      clicked.guessed = true;
      clicked.el.classList.add('guessed');
      clicked.el.style.setProperty('--c', colorFor(clickedId));

      const timeTaken = now() - state.targetPickTime;

      state.correct++;
      state.found.push({ id: clickedId, name: clicked.name, timeMs: timeTaken });

      const i = state.remainingIds.indexOf(clickedId);
      if (i >= 0) state.remainingIds.splice(i, 1);

      updateGuessedRemaining();
      updateMistakesUI();
      renderFoundList();

      fanfare();
      toast(`Correct: ${clicked.name}`, 'good');
      pickNextTarget();
    } else {
      state.mistakes++;
      state.attempts++;

      updateMistakesUI();
      errorSound();

      if (state.attempts >= 3) {
        handleFailure(state.targetId);
      } else {
        const mapPt = svgPointFromClient(clientX, clientY);
        spawnLabel(clicked.name, 'error', { mapX: mapPt.x, mapY: mapPt.y });

        clicked.el.classList.add('wrongflash');
        setTimeout(() => clicked.el.classList.remove('wrongflash'), 260);
        toast(`Wrong: ${clicked.name} (${state.attempts}/3)`, 'bad');
      }
    }
  }

  // --- ZOOM / PAN / MOBILE ---
  const view = {
    base: { x: 0, y: 0, w: 900, h: 800 },
    cur: null,
    minScale: 0.5,
    maxScale: 30,
    pending: null,
    raf: 0,
  };

  function applyViewBox() {
    view.raf = 0;
    if (!view.pending) return;
    view.cur = view.pending;
    view.pending = null;
    svg.setAttribute('viewBox', `${view.cur.x} ${view.cur.y} ${view.cur.w} ${view.cur.h}`);
    updateAllLabels();
  }

  function scheduleViewBox(next) {
    view.pending = next;
    if (!view.raf) view.raf = requestAnimationFrame(applyViewBox);
  }

  function svgPointFromClient(clientX, clientY) {
    const pt = svg.createSVGPoint();
    pt.x = clientX;
    pt.y = clientY;
    return pt.matrixTransform(svg.getScreenCTM().inverse());
  }

  function zoomAt(clientX, clientY, zoomFactor) {
    const vb = view.cur;
    const p = svgPointFromClient(clientX, clientY);

    const newW = clamp(vb.w / zoomFactor, view.base.w / view.maxScale, view.base.w / view.minScale);
    const newH = clamp(vb.h / zoomFactor, view.base.h / view.maxScale, view.base.h / view.minScale);

    const kx = (p.x - vb.x) / vb.w;
    const ky = (p.y - vb.y) / vb.h;

    scheduleViewBox({
      x: p.x - kx * newW,
      y: p.y - ky * newH,
      w: newW,
      h: newH
    });
  }

  const ptr = {
    pointers: new Map(), // active pointers for multitouch
    down: false,
    id: null,
    startX: 0,
    startY: 0,
    startVb: null,
    dragging: false,
    downCountryId: null,
    hoveredId: null,
    hoverSoundAt: 0,
    captured: false,
    // pinch state
    // pinch state
    startDist: 0,
    startCenter: { x: 0, y: 0 },
    startWorldCenter: { x: 0, y: 0 },
    rect: null,
  };

  function getPointerCenter() {
    let x = 0, y = 0;
    let c = 0;
    for (const p of ptr.pointers.values()) {
      x += p.clientX;
      y += p.clientY;
      c++;
    }
    if (c === 0) return null;
    return { x: x / c, y: y / c };
  }

  function getPinchDist() {
    if (ptr.pointers.size < 2) return 0;
    const pts = [...ptr.pointers.values()];
    const dx = pts[0].clientX - pts[1].clientX;
    const dy = pts[0].clientY - pts[1].clientY;
    return Math.sqrt(dx * dx + dy * dy);
  }

  function clearHover() {
    if (ptr.hoveredId) {
      countryById.get(ptr.hoveredId)?.el?.classList?.remove('hovered');
      ptr.hoveredId = null;
      clearPermanentLabels();
    }
  }

  function setHover(id, clientX, clientY) {
    const existingLabel = activeLabels.find(l => l.type === 'permanent');
    if (existingLabel && clientX != null) {
      const pt = svgPointFromClient(clientX, clientY);
      existingLabel.mapX = pt.x;
      existingLabel.mapY = pt.y;
      updateLabelPosition(existingLabel);
    }

    if (id === ptr.hoveredId) return;
    if (ptr.hoveredId) countryById.get(ptr.hoveredId)?.el?.classList?.remove('hovered');

    ptr.hoveredId = id;
    if (id) {
      const c = countryById.get(id);
      if (c && !c.guessed) {
        c.el.classList.add('hovered');
        if (state.phase !== 'running') {
          spawnLabel(c.name, 'permanent', { clientX, clientY });
        }
        const t = now();
        if (t - ptr.hoverSoundAt > 70) {
          beep({ freq: 820, dur: 0.028, type: 'sine', gain: 0.03 });
          ptr.hoverSoundAt = t;
        }
      } else {
        clearPermanentLabels();
      }
    } else {
      clearPermanentLabels();
    }
  }

  // Calculate accurate CTM manually to avoid DOM read lag
  function getRobustCTM(vb, rect) {
    const sX = rect.width / vb.w;
    const sY = rect.height / vb.h;
    const scale = Math.min(sX, sY);

    let tx = -vb.x * scale;
    let ty = -vb.y * scale;

    // Centering (meet logic)
    if (sX < sY) {
      // Width constrained - centered vertically
      const hReal = vb.h * scale;
      ty += (rect.height - hReal) / 2;
    } else {
      // Height constrained - centered horizontally
      const wReal = vb.w * scale;
      tx += (rect.width - wReal) / 2;
    }
    tx += rect.left;
    ty += rect.top;

    return { scale, tx, ty };
  }

  function elementUnderPointer(clientX, clientY) {
    return document.elementFromPoint(clientX, clientY);
  }

  // Prevent automatic zoom on iOS mainly
  document.addEventListener('gesturestart', (e) => e.preventDefault());

  svg.addEventListener('wheel', (e) => {
    unlockAudio();
    e.preventDefault();
    const delta = Math.sign(e.deltaY);
    zoomAt(e.clientX, e.clientY, delta > 0 ? 0.92 : 1.08);
  }, { passive: false });

  svg.addEventListener('pointerdown', (e) => {
    unlockAudio();
    if (e.button !== 0 && e.pointerType === 'mouse') return;

    ptr.pointers.set(e.pointerId, e);
    try { svg.setPointerCapture(e.pointerId); } catch (_) { }


    if (ptr.pointers.size === 1) {
      // If touch explore is allowed (not running), trigger hover immediately
      if (e.pointerType === 'touch' && state.phase !== 'running') {
        const el = elementUnderPointer(e.clientX, e.clientY);
        const hid = getCountryIdFromEl(el);
        if (hid && countryById.has(hid)) setHover(hid, e.clientX, e.clientY);
      }

      // Primary interaction
      ptr.down = true;
      ptr.id = e.pointerId; // main pointer logic for drag
      ptr.dragging = false;
      ptr.startX = e.clientX;
      ptr.startY = e.clientY;
      ptr.startVb = { ...view.cur };
      ptr.rect = svg.getBoundingClientRect();

      const el = elementUnderPointer(e.clientX, e.clientY);
      ptr.downCountryId = getCountryIdFromEl(el);
    } else if (ptr.pointers.size === 2) {
      // Start Pinch
      ptr.dragging = true;
      ptr.downCountryId = null;
      ptr.startDist = getPinchDist();
      ptr.startCenter = getPointerCenter();
      ptr.startVb = { ...view.cur }; // Capture baseline viewbox
      ptr.rect = svg.getBoundingClientRect();

      // Calculate the specific map point under the pinch center
      const ctm = getRobustCTM(ptr.startVb, ptr.rect);
      ptr.startWorldCenter = {
        x: (ptr.startCenter.x - ctm.tx) / ctm.scale,
        y: (ptr.startCenter.y - ctm.ty) / ctm.scale
      };
    }
  });

  svg.addEventListener('pointermove', (e) => {
    if (ptr.pointers.has(e.pointerId)) {
      ptr.pointers.set(e.pointerId, e);
    }

    // DEBUG OVERLAY
    const debugEl = document.getElementById('debugParams');

    if (ptr.pointers.size === 2) {
      // 2-Finger Pan + Zoom
      const dist = getPinchDist();
      const center = getPointerCenter();

      if (dist > 5 && ptr.startDist > 5) {
        let totalScale = dist / ptr.startDist;

        // Deadzone (applied to total scale to prevent jitter near 1.0)
        let isDeadzone = false;
        if (Math.abs(totalScale - 1) < 0.05) { // 5% deadzone
          totalScale = 1;
          isDeadzone = true;
        }

        const rect = ptr.rect;

        // 1. Calculate Target Dimensions based on START ViewBox
        const startW = ptr.startVb.w;
        const startH = ptr.startVb.h;

        const newW = clamp(startW / totalScale, view.base.w / view.maxScale, view.base.w / view.minScale);
        const newH = clamp(startH / totalScale, view.base.h / view.maxScale, view.base.h / view.minScale);

        // 2. Pan Compensation (Anchor Point Logic)
        const dummyVB = { x: 0, y: 0, w: newW, h: newH };
        const nextCTM = getRobustCTM(dummyVB, rect);

        const nextX = ptr.startWorldCenter.x + (nextCTM.tx - center.x) / nextCTM.scale;
        const nextY = ptr.startWorldCenter.y + (nextCTM.ty - center.y) / nextCTM.scale;

        // Check for NaN
        if (isNaN(nextX) || isNaN(nextY)) {
          if (debugEl) debugEl.textContent = `NaN Error: ctm.scale=${nextCTM.scale} sWC=${ptr.startWorldCenter.x}`;
          return;
        }

        if (debugEl) {
          debugEl.textContent = `2-Fingers (ABS)
Dist: ${dist.toFixed(1)} / Start: ${ptr.startDist.toFixed(1)}
Scale: ${totalScale.toFixed(4)} ${isDeadzone ? '(DZ)' : ''}
StartWorld: ${ptr.startWorldCenter.x.toFixed(1)}, ${ptr.startWorldCenter.y.toFixed(1)}
NextVB: ${nextX.toFixed(1)}, ${nextY.toFixed(1)} ${newW.toFixed(1)}x${newH.toFixed(1)}`;
        }

        scheduleViewBox({
          x: nextX,
          y: nextY,
          w: newW,
          h: newH
        });
      } else {
        // Debug why we are skipping
        if (debugEl) {
          debugEl.textContent = `2-Fingers SKIP
Dist: ${dist.toFixed(1)}
StartDist: ${ptr.startDist.toFixed(1)}
Reason: ${dist <= 5 ? 'Dist too small' : 'StartDist too small'}`;
        }
      }
    } else if (ptr.pointers.size === 1 && ptr.down && e.pointerId === ptr.id) {
      /*
       * 1-FINGER DRAG: ABSOLUTE TRACKING
       * 
       * Similar to 2-finger, we "lock" the map relative to the start position to prevent drift.
       * 1. On Start: Record startX, startY, startViewBox.
       * 2. On Move: 
       *    - Calculate screen delta (current - start).
       *    - Convert screen delta to World Units using the SCALE at the START of the drag.
       *    - Subtract this world delta from the startViewBox.
       */
      if (!ptr.dragging && (Math.abs(e.clientX - ptr.startX) > 5 || Math.abs(e.clientY - ptr.startY) > 5)) {
        ptr.dragging = true;
      }

      if (ptr.dragging) {
        const rect = ptr.rect;
        const dx = e.clientX - ptr.startX;
        const dy = e.clientY - ptr.startY;

        const startCTM = getRobustCTM(ptr.startVb, rect);

        const dWx = dx / startCTM.scale;
        const dWy = dy / startCTM.scale;

        if (DEBUG_TOUCH && debugEl) {
          debugEl.textContent = `1-Finger (ABS)
dx: ${dx.toFixed(1)} dy: ${dy.toFixed(1)}
dWx: ${dWx.toFixed(1)} dWy: ${dWy.toFixed(1)}`;
        }

        scheduleViewBox({
          x: ptr.startVb.x - dWx,
          y: ptr.startVb.y - dWy,
          w: ptr.startVb.w,
          h: ptr.startVb.h
        });
      }
    }

    if (!ptr.down || !ptr.dragging) {
      const el = elementUnderPointer(e.clientX, e.clientY);
      const hid = getCountryIdFromEl(el);
      if (hid && countryById.has(hid)) setHover(hid, e.clientX, e.clientY);
      else clearHover();
    }
  });

  function endPointer(e) {
    ptr.pointers.delete(e.pointerId);
    try { svg.releasePointerCapture(e.pointerId); } catch (_) { }

    if (ptr.pointers.size === 0) {
      // All fingers up
      if (ptr.down && !ptr.dragging && e.pointerId === ptr.id) {
        // Click
        const els = document.elementsFromPoint(e.clientX, e.clientY);
        const candidates = new Set();
        for (const el of els) {
          const id = getCountryIdFromEl(el);
          if (id) candidates.add(id);
        }
        if (candidates.size > 0) {
          handleGuess(Array.from(candidates), e.clientX, e.clientY);
        }
      }
      ptr.down = false;
      ptr.dragging = false;
      ptr.downCountryId = null;
      ptr.id = null;
      if (e.pointerType === 'touch') clearHover(); // Clear label on lift
    } else if (ptr.pointers.size === 1) {
      // One finger remains, maybe switch to panning?
      // Usually safer to just reset drag state to avoid jumps
      ptr.down = false;
      ptr.dragging = false;
      // Optionally pick the remaining finger as new primary?
      // Let's keep it simple: multi-touch end stops interaction until fresh start
    }
  }

  svg.addEventListener('pointerup', endPointer);
  svg.addEventListener('pointercancel', (e) => { endPointer(e); clearHover(); });

  window.addEventListener('blur', () => {
    ptr.down = false;
    ptr.dragging = false;
    ptr.downCountryId = null;
    ptr.id = null;
    ptr.pointers.clear();
  });

  function toggleStartReset() {
    unlockAudio();
    if (state.phase === 'running' || state.phase === 'done') {
      resetGame();
      toast('Reset. Press START.', '');
    } else {
      startGame();
    }
  }

  startBtn.addEventListener('click', toggleStartReset);
  targetEl.addEventListener('click', (e) => {
    if (ignoreClick) {
      ignoreClick = false;
      return;
    }
    // Only allow starting via click, not resetting (use long press)
    if (state.phase === 'idle') {
      toggleStartReset();
    } else {
      toast('Hold to RESET', '');
    }
  });

  window.addEventListener('keydown', (e) => {
    if (e.code === 'Space') {
      // If modal is open, do not toggle game.
      // Also do not preventDefault if user is typing name.
      if (highScoreModal.classList.contains('show')) return;

      e.preventDefault();
      toggleStartReset();
    }
  }, { passive: false });

  // Init
  // Welcome Modal Logic
  const welcomeModal = document.getElementById('welcomeModal');
  const closeWelcomeBtn = document.getElementById('closeWelcomeBtn');
  const versionDisplay = document.getElementById('versionDisplay');

  if (welcomeModal && closeWelcomeBtn) {
    if (versionDisplay) versionDisplay.textContent = `v${APP_VERSION}`;

    // Show on load
    setTimeout(() => welcomeModal.classList.add('show'), 500);

    closeWelcomeBtn.addEventListener('click', () => {
      unlockAudio(); // Good opportunity to unlock audio context
      welcomeModal.classList.remove('show');
    });
  }

  setTimeout(() => {
    initMapSelector();
    loadMap(currentMapKey);
  }, 100);

})();

