// Orientation Day player. No dependencies, no build step.
// Scene graph lives in scenes.json; this file only knows how to play it.

const $ = (s) => document.querySelector(s);
const stage = $('#stage');
const faceCanvas = $('#face');
const faceCtx = faceCanvas.getContext('2d');

const KEYS = {
  ArrowLeft: 'left', KeyA: 'left',
  ArrowRight: 'right', KeyD: 'right',
  ArrowUp: 'jump', KeyW: 'jump', Space: 'jump',
  ArrowDown: 'stop', KeyS: 'stop', KeyX: 'stop',
};
const ACTIONS = {
  left: { label: 'Left', glyph: '◀', hint: 'A / ←' },
  right: { label: 'Right', glyph: '▶', hint: 'D / →' },
  jump: { label: 'Jump', glyph: '▲', hint: 'W / ↑ / Space' },
  stop: { label: 'Stop', glyph: '■', hint: 'S / ↓' },
};

let data = null;
let scenes = {};
const pool = new Map();

const state = {
  token: 0,
  id: null,
  sc: null,
  cur: null,
  raf: 0,
  fired: new Set(),
  visits: {},
  win: null,
  deaths: 0,
  file: [],
  seen: new Set(),
  opts: { captions: true, tts: false, extra: false },
  face: null,
  faceURL: null,
  cardFor: null,
  capTimer: 0,
  started: false,
};

// ------------------------------------------------------------------ storage
function loadSave() {
  try {
    const s = JSON.parse(localStorage.getItem('orientation-day') || '{}');
    (s.seen || []).forEach((x) => state.seen.add(x));
  } catch (e) { /* storage can be unavailable */ }
}
function save() {
  try {
    localStorage.setItem('orientation-day', JSON.stringify({ seen: [...state.seen] }));
  } catch (e) { /* ignore */ }
}

// ------------------------------------------------------------------ clip pool
function getClip(file) {
  let v = pool.get(file);
  if (!v) {
    v = document.createElement('video');
    v.className = 'clip';
    v.playsInline = true;
    v.setAttribute('playsinline', '');
    v.preload = 'auto';
    v.src = 'clips/' + file;
    stage.insertBefore(v, faceCanvas);
    pool.set(file, v);
  }
  return v;
}

function prune(keep) {
  for (const [file, v] of pool) {
    if (!keep.has(file) && !v.classList.contains('active')) {
      v.pause();
      v.removeAttribute('src');
      v.load();
      v.remove();
      pool.delete(file);
    }
  }
}

function targetsOf(sc) {
  const ids = [sc.next, sc.timeout, sc.retry || (sc.type === 'death' ? data.retry : null), ...Object.values(sc.inputs || {})];
  return ids.filter(Boolean).map((id) => scenes[id]).filter(Boolean);
}

function preloadFor(sc) {
  const keep = new Set([sc.clip]);
  targetsOf(sc).forEach((t) => { if (t.clip) { keep.add(t.clip); getClip(t.clip); } });
  return keep;
}

const once = (el, ev, ms = 4000) =>
  new Promise((res) => {
    const done = () => { el.removeEventListener(ev, done); res(); };
    el.addEventListener(ev, done);
    setTimeout(done, ms);
  });

async function whenReady(v) {
  try { v.currentTime = 0; } catch (e) { /* not seekable yet */ }
  if (v.seeking) await once(v, 'seeked');
  if (v.readyState < 3) await once(v, 'canplay');
}

function swapTo(v) {
  const prev = [...pool.values()].filter((x) => x !== v && x.classList.contains('active'));
  v.classList.add('active');
  const done = () => prev.forEach((p) => { p.classList.remove('active'); p.pause(); });
  if (v.requestVideoFrameCallback) v.requestVideoFrameCallback(done);
  else setTimeout(done, 60);
}

// ------------------------------------------------------------------ scene flow
async function enter(id) {
  const sc = scenes[id];
  if (!sc) { console.error('Unknown scene', id); return; }
  const tok = ++state.token;
  cancelAnimationFrame(state.raf);
  clearTimeout(state.winTimer);
  state.id = id;
  state.sc = sc;
  state.visits[id] = (state.visits[id] || 0) + 1;
  state.fired = new Set();
  state.win = null;
  hidePrompt();
  hideCard();
  hud();
  debug();

  if (sc.type === 'end') { showEnd(sc); return; }

  const v = getClip(sc.clip);
  const keep = preloadFor(sc);
  v.pause();
  v.onended = null;
  v.style.transform = sc.flip ? 'scaleX(-1)' : '';
  await whenReady(v);
  if (tok !== state.token) return;
  try { await v.play(); } catch (e) { console.warn('play() blocked', e); }
  swapTo(v);
  state.cur = v;
  v.onended = () => { if (tok === state.token) onEnded(sc); };
  prune(keep);
  loop(tok);
}

function loop(tok) {
  const step = () => {
    if (tok !== state.token) return;
    const v = state.cur;
    const sc = state.sc;
    const t = v.currentTime;
    (sc.captions || []).forEach((c, i) => {
      if (state.fired.has(i) || t < c.at) return;
      state.fired.add(i);
      if (c.onlyFirst && state.visits[state.id] > 1) return;
      if (c.onlyFirst && state.deaths > 0) return;
      say(c);
    });
    if (sc.type === 'reflex' && !state.win && t >= sc.decisionAt) openWindow(sc, tok);
    drawFace(sc, t);
    debug(t);
    state.raf = requestAnimationFrame(step);
  };
  state.raf = requestAnimationFrame(step);
}

function onEnded(sc) {
  if (sc.type === 'cutscene') enter(sc.next);
  else if (sc.type === 'success') {
    if (sc.stamp && !state.file.find((f) => f.id === sc.stamp.id)) state.file.push(sc.stamp);
    hud();
    enter(sc.next);
  } else if (sc.type === 'death') {
    state.deaths++;
    if (sc.deathId) state.seen.add(sc.deathId);
    save();
    hud();
    showCard(sc);
  }
  // reflex scenes hold the last frame until the player answers or the window closes
}

// ------------------------------------------------------------------ reflex window
function openWindow(sc, tok) {
  const ms = sc.window * 1000 * (state.opts.extra ? 2 : 1);
  state.win = { t0: performance.now(), ms, sc };
  const box = $('#choices');
  box.innerHTML = '';
  sc.prompt.forEach((a) => {
    const meta = ACTIONS[a] || { label: a, glyph: '?', hint: '' };
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'choice choice-' + a;
    b.dataset.action = a;
    b.innerHTML = `<span class="glyph" aria-hidden="true">${meta.glyph}</span><span class="label">${meta.label}</span><span class="hint">${meta.hint}</span>`;
    b.addEventListener('pointerdown', (e) => { e.preventDefault(); answer(a); });
    box.appendChild(b);
  });
  const bar = $('#timer i');
  bar.style.transition = 'none';
  bar.style.transform = 'scaleX(1)';
  void bar.offsetWidth;
  bar.style.transition = `transform ${ms}ms linear`;
  bar.style.transform = 'scaleX(0)';
  $('#dock').classList.add('live');
  $('#prompt').hidden = false;
  state.winTimer = setTimeout(() => { if (tok === state.token) answer('timeout'); }, ms);
}

function hidePrompt() {
  $('#prompt').hidden = true;
  $('#dock').classList.remove('live');
}

function answer(action) {
  const w = state.win;
  if (!w || w.done) return;
  const sc = w.sc;
  const target = action === 'timeout' ? sc.timeout : sc.inputs[action];
  if (!target) return;
  w.done = true;
  clearTimeout(state.winTimer);
  hidePrompt();
  enter(target);
}

// ------------------------------------------------------------------ captions + voice
function say(c) {
  const who = c.who || 'Cheryl';
  if (state.opts.captions) {
    $('#who').textContent = who;
    $('#line').textContent = c.text;
    $('#captions').classList.add('show');
    clearTimeout(state.capTimer);
    state.capTimer = setTimeout(() => $('#captions').classList.remove('show'), c.hold || 2600 + c.text.length * 38);
  }
  if (c.audio) {
    const a = new Audio('audio/' + c.audio);
    a.play().catch(() => speak(c.text));
  } else if (state.opts.tts) {
    speak(c.text);
  }
}

function speak(text) {
  try {
    if (!('speechSynthesis' in window)) return;
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    const voices = speechSynthesis.getVoices();
    u.voice = voices.find((x) => /female|samantha|zira|susan|karen|jenny|aria/i.test(x.name) && /^en/i.test(x.lang)) || null;
    u.pitch = 1.35;
    u.rate = 1.08;
    speechSynthesis.speak(u);
  } catch (e) { /* ignore */ }
}

// ------------------------------------------------------------------ face overlay
function sizeCanvas() {
  const r = stage.getBoundingClientRect();
  const d = Math.min(2, window.devicePixelRatio || 1);
  faceCanvas.width = Math.round(r.width * d);
  faceCanvas.height = Math.round(r.height * d);
}

function drawFace(sc, t) {
  const f = sc.faceOverlay;
  const W = faceCanvas.width, H = faceCanvas.height;
  faceCtx.clearRect(0, 0, W, H);
  if (!f || !state.face || t < f.at || t > f.until) return;
  let [x, y, w, h] = f.rect;
  if (sc.flip) x = 1 - x - w;
  const cx = (x + w / 2) * W, cy = (y + h / 2) * H;
  const rx = (w / 2) * W, ry = (h / 2) * H;
  const wob = Math.sin(t * 60) * 0.03;
  faceCtx.save();
  faceCtx.translate(cx, cy);
  faceCtx.rotate(wob);
  faceCtx.beginPath();
  faceCtx.ellipse(0, 0, rx, ry, 0, 0, Math.PI * 2);
  faceCtx.save();
  faceCtx.clip();
  const s = Math.max(rx * 2, ry * 2);
  faceCtx.drawImage(state.face, -s / 2, -s / 2, s, s);
  faceCtx.restore();
  faceCtx.lineWidth = Math.max(2, W * 0.004);
  faceCtx.strokeStyle = '#4a2c24';
  faceCtx.beginPath();
  faceCtx.ellipse(0, 0, rx, ry, 0, 0, Math.PI * 2);
  faceCtx.stroke();
  faceCtx.restore();
}

function setFace(file) {
  if (!file) return;
  const img = new Image();
  img.onload = () => {
    const s = Math.min(img.width, img.height);
    const c = document.createElement('canvas');
    c.width = c.height = 256;
    const x = c.getContext('2d');
    try { x.filter = 'contrast(1.35) saturate(1.5) brightness(1.05)'; } catch (e) { /* unsupported */ }
    x.drawImage(img, (img.width - s) / 2, (img.height - s) / 2, s, s, 0, 0, 256, 256);
    state.face = c;
    state.faceURL = c.toDataURL('image/jpeg', 0.85);
    $('#facePreview').src = state.faceURL;
    $('#facePreview').hidden = false;
    URL.revokeObjectURL(img.src);
  };
  img.src = URL.createObjectURL(file);
}

// ------------------------------------------------------------------ overlays
function carried() {
  return ['Clipboard', ...state.file.map((f) => f.label)];
}

function showCard(sc) {
  state.cardFor = sc;
  const c = sc.card || {};
  $('#cardNo').textContent = 'Safety violation #' + (sc.deathId || '---');
  $('#cardWhat').textContent = c.violation || 'Unspecified enthusiasm';
  $('#cardLevel').textContent = c.level || 'Level 1';
  $('#cardItems').textContent = carried().join(', ');
  $('#cardAction').textContent = c.action || 'Form 27-B';
  $('#cardCount').textContent = String(state.deaths);
  const badge = $('#badge');
  badge.src = state.faceURL || 'default_badge.jpg';
  badge.parentElement.style.setProperty('--tired', Math.min(1, state.deaths * 0.14));
  $('#card').hidden = false;
  $('#cardGo').focus({ preventScroll: true });
}

function hideCard() { $('#card').hidden = true; state.cardFor = null; }

function retryAfterCard() {
  const sc = state.cardFor;
  if (!sc) return;
  hideCard();
  enter(sc.retry || data.retry);
}

function showEnd(sc) {
  cancelAnimationFrame(state.raf);
  $('#endHeading').textContent = sc.heading || 'Complete';
  $('#endWho').textContent = sc.who || '';
  $('#endLine').textContent = sc.text || '';
  $('#endNote').textContent = sc.note || '';
  const ul = $('#endFile');
  ul.innerHTML = '';
  if (!state.file.length) ul.innerHTML = '<li>No documents on file.</li>';
  state.file.forEach((f) => { const li = document.createElement('li'); li.textContent = f.label; ul.appendChild(li); });
  $('#endStats').textContent = `Incidents this shift: ${state.deaths}`;
  $('#end').hidden = false;
  $('#endAgain').focus({ preventScroll: true });
}

function buildGallery() {
  const list = $('#galleryList');
  list.innerHTML = '';
  const seen = new Map();
  Object.values(scenes).filter((s) => s.type === 'death').forEach((s) => { if (!seen.has(s.deathId)) seen.set(s.deathId, s); });
  [...seen.entries()].sort().forEach(([id, s]) => {
    const li = document.createElement('li');
    const got = state.seen.has(id);
    li.className = got ? 'got' : 'locked';
    li.innerHTML = got
      ? `<b>#${id}</b> <span>${s.card.violation}</span><em>${s.card.level} · ${s.card.action}</em>`
      : `<b>#${id}</b> <span>Not yet filed</span><em>Reach this outcome to unlock it.</em>`;
    list.appendChild(li);
  });
  $('#galleryCount').textContent = `${[...seen.keys()].filter((i) => state.seen.has(i)).length} of ${seen.size} filed`;
}

function hud() {
  $('#hudDeaths').textContent = String(state.deaths);
  $('#hudFile').textContent = String(state.file.length);
}

// ------------------------------------------------------------------ debug
function debug(t) {
  const d = $('#debug');
  if (d.hidden) return;
  const w = state.win;
  $('#dbgInfo').textContent =
    `scene: ${state.id}  t: ${(t || 0).toFixed(2)}s  window: ${w ? (w.done ? 'answered' : 'open') : 'closed'}  deaths: ${state.deaths}`;
}

function buildDebug() {
  const box = $('#dbgJump');
  Object.keys(scenes).forEach((id) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = id;
    b.addEventListener('click', () => { $('#start').hidden = true; state.started = true; enter(id); });
    box.appendChild(b);
  });
}

// ------------------------------------------------------------------ boot
function begin() {
  state.opts.captions = $('#optCaptions').checked;
  state.opts.tts = $('#optTts').checked;
  state.opts.extra = $('#optExtra').checked;
  $('#start').hidden = true;
  state.started = true;
  state.deaths = 0;
  state.file = [];
  state.visits = {};
  $('#end').hidden = true;
  enter(data.start);
}

function wire() {
  $('#startGo').addEventListener('click', begin);
  $('#endAgain').addEventListener('click', begin);
  $('#cardGo').addEventListener('click', retryAfterCard);
  $('#facePick').addEventListener('change', (e) => setFace(e.target.files[0]));
  const openGallery = () => { buildGallery(); $('#gallery').hidden = false; $('#galleryClose').focus({ preventScroll: true }); };
  $('#openGallery').addEventListener('click', openGallery);
  $('#openGallery2').addEventListener('click', openGallery);
  $('#galleryClose').addEventListener('click', () => { $('#gallery').hidden = true; });
  $('#fs').addEventListener('click', () => {
    const el = $('#app');
    try { (document.fullscreenElement ? document.exitFullscreen() : el.requestFullscreen()).catch(() => {}); } catch (e) { /* optional */ }
  });
  window.addEventListener('resize', sizeCanvas);
  new ResizeObserver(sizeCanvas).observe(stage);
  window.addEventListener('keydown', (e) => {
    if (e.code === 'Backquote') { $('#debug').hidden = !$('#debug').hidden; return; }
    if (!$('#gallery').hidden) { if (e.code === 'Escape') $('#gallery').hidden = true; return; }
    if (!$('#start').hidden) return;
    if (!$('#card').hidden && (e.code === 'Space' || e.code === 'Enter')) { e.preventDefault(); retryAfterCard(); return; }
    const a = KEYS[e.code];
    if (a && state.win && !state.win.done) { e.preventDefault(); answer(a); }
  });
}

async function boot() {
  loadSave();
  const res = await fetch('scenes.json');
  data = await res.json();
  scenes = data.scenes;
  $('#title').textContent = data.title;
  $('#tagline').textContent = data.tagline;
  wire();
  buildDebug();
  sizeCanvas();
  hud();
  if (new URLSearchParams(location.search).has('debug')) $('#debug').hidden = false;
  $('#startGo').disabled = false;
  // warm the first clips while the player reads the title screen
  const first = scenes[data.start];
  if (first) { getClip(first.clip); targetsOf(first).forEach((t) => t.clip && getClip(t.clip)); }
}

boot().catch((err) => {
  console.error(err);
  $('#bootError').hidden = false;
  $('#bootError').textContent = 'Could not load scenes.json. Serve this folder over http (see README) instead of opening the file directly.';
});
