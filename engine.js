// Orientation Day player. No build step; the face finder (MediaPipe) loads from a CDN on demand.
// Scene graph lives in scenes.json; this file only knows how to play it.

import * as music from './music.js?v=10';

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
// Emptied <video> elements kept for reuse. Safari only lets a clip with sound play
// from an element that was started inside a tap or key press, so elements are
// unlocked on input and then recycled rather than thrown away.
const spares = [];

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
    v = spares.pop();
    if (!v) {
      v = document.createElement('video');
      v.className = 'clip';
      v.playsInline = true;
      v.setAttribute('playsinline', '');
      v.setAttribute('webkit-playsinline', '');
      v.preload = 'auto';
      stage.insertBefore(v, faceCanvas);
    }
    v.muted = false;
    v.src = 'clips/' + file;
    v.load();
    pool.set(file, v);
  }
  return v;
}

// Run inside a user gesture. Starting and pausing each idle clip marks the element
// as allowed to play with sound later (Safari), and makes iOS start buffering it.
function unlock() {
  for (const v of [...pool.values(), ...spares]) {
    if (v.dataset.unlocked || !v.paused || v.classList.contains('active')) continue;
    v.dataset.unlocked = '1';
    const p = v.play();
    if (p) p.catch(() => {});
    v.pause();
  }
}

function prune(keep) {
  for (const [file, v] of pool) {
    if (!keep.has(file) && !v.classList.contains('active')) {
      v.pause();
      v.onended = null;
      v.removeAttribute('src');
      v.load();
      pool.delete(file);
      spares.push(v);
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
  hushVoice(false);
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
  try {
    await v.play();
  } catch (e) {
    // Autoplay with sound refused (Safari without a recent tap). Muted always plays.
    console.warn('play() blocked, retrying muted', e);
    v.muted = true;
    try { await v.play(); } catch (e2) { console.warn('muted play() blocked', e2); }
  }
  if (tok !== state.token) return;
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
  // Cutscenes and successes hold their last frame until Cheryl finishes talking.
  const tok = state.token;
  const go = (fn) => afterVoice(() => { if (tok === state.token) fn(); });
  if (sc.type === 'cutscene') go(() => enter(sc.next));
  else if (sc.type === 'success') {
    if (sc.stamp && !state.file.find((f) => f.id === sc.stamp.id)) state.file.push(sc.stamp);
    hud();
    go(() => enter(sc.next));
  } else if (sc.type === 'death') {
    state.deaths++;
    if (sc.deathId) state.seen.add(sc.deathId);
    music.sting();
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
  if (action !== 'timeout' && !sc.prompt.includes(action)) return;
  const target = action === 'timeout' ? sc.timeout : sc.inputs[action];
  if (!target) return;
  w.done = true;
  clearTimeout(state.winTimer);
  hidePrompt();
  enter(target);
}

// ------------------------------------------------------------------ captions + voice
// Recorded lines go through one voice channel so they never talk over each other.
// A line that comes up while another is playing waits its turn.
const voice = { cur: null, queue: [], idle: [] };

function say(c) {
  if (c.audio && (voice.cur || voice.queue.length)) { voice.queue.push(c); return; }
  speakLine(c);
}

function speakLine(c) {
  const est = c.hold || 2600 + c.text.length * 38;
  showCaption(c, est);
  music.duck(est);
  if (c.audio) {
    const a = new Audio('audio/' + c.audio);
    voice.cur = a;
    const next = () => { if (voice.cur !== a) return; voice.cur = null; voiceNext(); };
    a.onloadedmetadata = () => { if (isFinite(a.duration)) { showCaption(c, a.duration * 1000 + 400); music.duck(a.duration * 1000); } };
    a.onended = next;
    a.onerror = () => { speak(c.text); next(); };
    a.play().catch(() => { speak(c.text); next(); });
  } else if (state.opts.tts) {
    speak(c.text);
  }
}

function showCaption(c, ms) {
  if (!state.opts.captions) return;
  $('#who').textContent = c.who || 'Cheryl';
  $('#line').textContent = c.text;
  $('#captions').classList.add('show');
  clearTimeout(state.capTimer);
  state.capTimer = setTimeout(() => $('#captions').classList.remove('show'), ms);
}

function voiceNext() {
  if (voice.queue.length) { speakLine(voice.queue.shift()); return; }
  const waiting = voice.idle;
  voice.idle = [];
  waiting.forEach((f) => f());
}

// Runs fn once nothing is playing or queued.
function afterVoice(fn) {
  if (!voice.cur && !voice.queue.length) fn();
  else voice.idle.push(fn);
}

// Drops queued lines; with hard, also cuts the one playing.
function hushVoice(hard) {
  voice.queue = [];
  voice.idle = [];
  if (hard && voice.cur) { voice.cur.onended = voice.cur.onerror = null; voice.cur.pause(); voice.cur = null; }
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
// iOS only speaks after a first utterance started from a tap.
function primeSpeech() {
  try {
    if (!('speechSynthesis' in window)) return;
    const u = new SpeechSynthesisUtterance(' ');
    u.volume = 0;
    speechSynthesis.speak(u);
  } catch (e) { /* ignore */ }
}

function sizeCanvas() {
  const r = stage.getBoundingClientRect();
  const d = Math.min(2, window.devicePixelRatio || 1);
  faceCanvas.width = Math.round(r.width * d);
  faceCanvas.height = Math.round(r.height * d);
}

// faceOverlay is either a fixed { at, until, rect } or a tracked
// { track: [[t, cx, cy, scale?], ...], size: [w, h], fade } in stage fractions,
// following the hero's head frame by frame (see tools/track_face.py).
function facePose(f, t) {
  if (!f.track) {
    if (t < f.at || t > f.until) return null;
    const [x, y, w, h] = f.rect;
    return { cx: x + w / 2, cy: y + h / 2, w, h, a: 1, wob: Math.sin(t * 60) * 0.03 };
  }
  const k = f.track;
  const t0 = k[0][0], t1 = k[k.length - 1][0];
  if (t < t0 || t > t1) return null;
  let i = 1;
  while (i < k.length - 1 && k[i][0] < t) i++;
  const [ta, xa, ya, sa = 1] = k[i - 1], [tb, xb, yb, sb = 1] = k[i];
  const u = tb > ta ? Math.min(1, Math.max(0, (t - ta) / (tb - ta))) : 0;
  const fade = f.fade || 0;
  const a = fade ? Math.min(1, (t - t0) / fade, (t1 - t) / fade) : 1;
  const sc = sa + (sb - sa) * u;
  return { cx: xa + (xb - xa) * u, cy: ya + (yb - ya) * u, w: f.size[0] * sc, h: f.size[1] * sc, a, wob: 0 };
}

// How much bigger than the tracked size to draw the player's face, so it
// covers the hero's cartoon face. Tune here.
const FACE_SCALE = 1.2;

function drawFace(sc, t) {
  const f = sc.faceOverlay;
  const W = faceCanvas.width, H = faceCanvas.height;
  faceCtx.clearRect(0, 0, W, H);
  if (!f || !state.face) return;
  const p = facePose(f, t);
  if (!p) return;
  const cx = (sc.flip ? 1 - p.cx : p.cx) * W, cy = p.cy * H;
  const rx = (p.w / 2) * W * FACE_SCALE, ry = (p.h / 2) * H * FACE_SCALE;
  faceCtx.save();
  faceCtx.globalAlpha = p.a;
  faceCtx.translate(cx, cy);
  faceCtx.rotate(p.wob);
  faceCtx.beginPath();
  faceCtx.ellipse(0, 0, rx, ry, 0, 0, Math.PI * 2);
  faceCtx.save();
  faceCtx.clip();
  // state.face is already cut to the face, so stretch it over the ellipse.
  faceCtx.drawImage(state.face, -rx, -ry, rx * 2, ry * 2);
  faceCtx.restore();
  faceCtx.lineWidth = Math.max(2, W * 0.003);
  faceCtx.strokeStyle = '#3b2a20';
  faceCtx.beginPath();
  faceCtx.ellipse(0, 0, rx, ry, 0, 0, Math.PI * 2);
  faceCtx.stroke();
  faceCtx.restore();
}

// Box-blur an RGBA buffer in place (horizontal then vertical). Done by hand
// because canvas ctx.filter is missing in Safari.
function boxBlur(d, n, m, r) {
  const tmp = new Float32Array(d.length);
  const pass = (src, dst, along, across, stride, step) => {
    for (let a = 0; a < across; a++) {
      for (let ch = 0; ch < 3; ch++) {
        let sum = 0;
        const at = (k) => src[(a * stride + Math.min(along - 1, Math.max(0, k)) * step) * 4 + ch];
        for (let k = -r; k <= r; k++) sum += at(k);
        for (let k = 0; k < along; k++) {
          dst[(a * stride + k * step) * 4 + ch] = sum / (2 * r + 1);
          sum += at(k + r + 1) - at(k - r);
        }
      }
    }
  };
  pass(d, tmp, n, m, n, 1);
  pass(tmp, d, m, n, 1, n);
}

// Turn a photo into the clips' cartoon look: smoothed, flat bands of shade
// that keep the player's own colouring, a light sepia wash, and thick dark
// ink lines where the shading changes sharply.
function cartoonize(c) {
  const x = c.getContext('2d');
  const n = c.width, m = c.height;
  let img;
  try { img = x.getImageData(0, 0, n, m); } catch (e) { return c; }
  const d = img.data;
  boxBlur(d, n, m, 2);
  const lum = new Float32Array(n * m);
  for (let i = 0, j = 0; i < d.length; i += 4, j++) lum[j] = d[i] * 0.3 + d[i + 1] * 0.59 + d[i + 2] * 0.11;
  const ink = new Uint8Array(n * m);
  for (let yy = 1; yy < m - 2; yy++) {
    for (let xx = 1; xx < n - 2; xx++) {
      const o = yy * n + xx;
      const gx = lum[o - n + 1] + 2 * lum[o + 1] + lum[o + n + 1] - lum[o - n - 1] - 2 * lum[o - 1] - lum[o + n - 1];
      const gy = lum[o + n - 1] + 2 * lum[o + n] + lum[o + n + 1] - lum[o - n - 1] - 2 * lum[o - n] - lum[o - n + 1];
      if (gx * gx + gy * gy > 3600) ink[o] = ink[o + 1] = ink[o + n] = ink[o + n + 1] = 1;
    }
  }
  for (let i = 0, j = 0; i < d.length; i += 4, j++) {
    if (ink[j]) { d[i] = 59; d[i + 1] = 42; d[i + 2] = 32; continue; }
    const l = lum[j];
    const band = Math.min(228, Math.round(l / 64) * 64 + 14);
    for (let ch = 0; ch < 3; ch++) d[i + ch] = band + (d[i + ch] - l) * 1.1;
    d[i] = d[i] * 0.85 + 0.15 * 236;
    d[i + 1] = d[i + 1] * 0.85 + 0.15 * 214;
    d[i + 2] = d[i + 2] * 0.85 + 0.15 * 178;
  }
  x.putImageData(img, 0, 0);
  return c;
}

// MediaPipe Face Landmarker finds the face in the player's photo so only the
// face (no hair, no background) goes on the hero. Loaded from the CDN the
// first time someone picks a photo; without it we fall back to the middle
// of the photo.
const MP = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14';
const MP_MODEL = 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task';
// Face-oval landmark indices, in order around the face.
const FACE_OVAL = [10, 338, 297, 332, 284, 251, 389, 356, 454, 323, 361, 288, 397, 365, 379, 378, 400, 377,
  152, 148, 176, 149, 150, 136, 172, 58, 132, 93, 234, 127, 162, 21, 54, 103, 67, 109];
const FACE_W = 200, FACE_H = 260;
let landmarker = null;

function loadLandmarker() {
  if (!landmarker) {
    landmarker = (async () => {
      const { FilesetResolver, FaceLandmarker } = await import(`${MP}/vision_bundle.mjs`);
      const files = await FilesetResolver.forVisionTasks(`${MP}/wasm`);
      return FaceLandmarker.createFromOptions(files, {
        baseOptions: { modelAssetPath: MP_MODEL, delegate: 'CPU' },
        runningMode: 'IMAGE',
        numFaces: 1,
      });
    })();
    landmarker.catch(() => { landmarker = null; });
  }
  return landmarker;
}

// Cut the face out, straightened, so its outline fills a FACE_W x FACE_H
// canvas. pts are pixel [x, y] pairs.
function cutFace(src, pts) {
  const l = pts[33], r = pts[263];
  const ang = Math.atan2(r[1] - l[1], r[0] - l[0]);
  const cos = Math.cos(-ang), sin = Math.sin(-ang);
  const oval = FACE_OVAL.map((i) => pts[i]);
  const mx = oval.reduce((t, p) => t + p[0], 0) / oval.length;
  const my = oval.reduce((t, p) => t + p[1], 0) / oval.length;
  const flat = oval.map(([x, y]) => [(x - mx) * cos - (y - my) * sin, (x - mx) * sin + (y - my) * cos]);
  const xs = flat.map((p) => p[0]), ys = flat.map((p) => p[1]);
  const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
  const sx = FACE_W / (x1 - x0), sy = FACE_H / (y1 - y0);
  const c = document.createElement('canvas');
  c.width = FACE_W; c.height = FACE_H;
  const x = c.getContext('2d');
  x.translate(-x0 * sx, -y0 * sy);
  x.scale(sx, sy);
  x.rotate(-ang);
  x.translate(-mx, -my);
  x.drawImage(src, 0, 0);
  x.setTransform(1, 0, 0, 1, 0, 0);
  return ovalMask(cartoonize(c));
}

// Keep only the ellipse that fills the canvas. For a face looking at the
// camera this matches its outline; a turned face keeps a sliver of
// background rather than leaving holes where the hero's face shows through.
function ovalMask(c) {
  const x = c.getContext('2d');
  x.globalCompositeOperation = 'destination-in';
  x.beginPath();
  x.ellipse(c.width / 2, c.height / 2, c.width / 2, c.height / 2, 0, 0, Math.PI * 2);
  x.fill();
  x.globalCompositeOperation = 'source-over';
  return c;
}

// No face found: take the middle of the photo, where a selfie's face usually is.
function middleFace(src) {
  const c = document.createElement('canvas');
  c.width = FACE_W; c.height = FACE_H;
  const w = src.width * 0.5, h = Math.min(src.height * 0.6, w * FACE_H / FACE_W);
  c.getContext('2d').drawImage(src, (src.width - w) / 2, (src.height - h) / 2, w, h, 0, 0, FACE_W, FACE_H);
  return ovalMask(cartoonize(c));
}

function useFace(c) {
  state.face = c;
  state.faceURL = c.toDataURL('image/png');
  $('#facePreview').src = state.faceURL;
  $('#facePreview').hidden = false;
}

function setFace(file) {
  if (!file) return;
  const status = $('#faceStatus');
  const img = new Image();
  img.onload = async () => {
    URL.revokeObjectURL(img.src);
    const k = Math.min(1, 1024 / Math.max(img.width, img.height));
    const src = document.createElement('canvas');
    src.width = Math.round(img.width * k); src.height = Math.round(img.height * k);
    src.getContext('2d').drawImage(img, 0, 0, src.width, src.height);
    useFace(middleFace(src));
    status.textContent = 'Finding your face...';
    try {
      const res = (await loadLandmarker()).detect(src);
      const lm = res.faceLandmarks && res.faceLandmarks[0];
      if (!lm) { status.textContent = 'No face found, so the middle of the photo is used. Try facing the camera.'; return; }
      useFace(cutFace(src, lm.map((p) => [p.x * src.width, p.y * src.height])));
      status.textContent = '';
    } catch (e) {
      status.textContent = 'Face finder did not load, so the middle of the photo is used.';
    }
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
  hushVoice(true);
  music.start();
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

// Back to the title screen. A web page cannot close its own tab, so this is "exit".
function quit() {
  state.token++;
  cancelAnimationFrame(state.raf);
  clearTimeout(state.winTimer);
  clearTimeout(state.capTimer);
  state.win = null;
  state.cur = null;
  state.started = false;
  hidePrompt();
  hideCard();
  $('#captions').classList.remove('show');
  $('#end').hidden = true;
  $('#gallery').hidden = true;
  for (const v of pool.values()) { v.onended = null; v.pause(); v.classList.remove('active'); }
  faceCtx.clearRect(0, 0, faceCanvas.width, faceCanvas.height);
  music.stop();
  hushVoice(true);
  try { speechSynthesis.cancel(); } catch (e) { /* ignore */ }
  if (fullscreenEl()) toggleFullscreen();
  $('#start').hidden = false;
  $('#startGo').focus({ preventScroll: true });
}

function fullscreenEl() {
  return document.fullscreenElement || document.webkitFullscreenElement || null;
}

function toggleFullscreen() {
  const el = $('#app');
  try {
    if (fullscreenEl()) {
      const p = (document.exitFullscreen || document.webkitExitFullscreen).call(document);
      if (p && p.catch) p.catch(() => {});
    } else {
      const p = (el.requestFullscreen || el.webkitRequestFullscreen).call(el);
      if (p && p.catch) p.catch(() => {});
    }
  } catch (e) { /* optional */ }
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
  unlock();
  state.opts.captions = $('#optCaptions').checked;
  state.opts.tts = $('#optTts').checked;
  state.opts.extra = $('#optExtra').checked;
  if (state.opts.tts) primeSpeech();
  music.setMuted(!$('#optMusic').checked);
  music.start();
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
  ['#facePick', '#faceSnap'].forEach((id) => {
    $(id).addEventListener('change', (e) => setFace(e.target.files[0]));
    // Start fetching the face finder while the camera or picker is open.
    $(id).parentElement.addEventListener('pointerdown', () => loadLandmarker().catch(() => {}), { once: true });
  });
  const openGallery = () => { buildGallery(); $('#gallery').hidden = false; $('#galleryClose').focus({ preventScroll: true }); };
  $('#openGallery').addEventListener('click', openGallery);
  $('#openGallery2').addEventListener('click', openGallery);
  $('#galleryClose').addEventListener('click', () => { $('#gallery').hidden = true; });
  // iPhone Safari has no element fullscreen, so hide the button where it can't work.
  const app = $('#app');
  if (!app.requestFullscreen && !app.webkitRequestFullscreen) $('#fs').hidden = true;
  $('#fs').addEventListener('click', (e) => { e.currentTarget.blur(); toggleFullscreen(); });
  $('#quit').addEventListener('click', (e) => { e.currentTarget.blur(); quit(); });
  $('#cardQuit').addEventListener('click', quit);
  $('#endQuit').addEventListener('click', quit);
  // Any tap or key press counts as a gesture: unlock clips that were preloaded since the last one.
  window.addEventListener('pointerdown', unlock, true);
  window.addEventListener('keydown', unlock, true);
  window.addEventListener('resize', sizeCanvas);
  new ResizeObserver(sizeCanvas).observe(stage);
  window.addEventListener('keydown', (e) => {
    if (e.code === 'Backquote') { $('#debug').hidden = !$('#debug').hidden; return; }
    if (!$('#gallery').hidden) { if (e.code === 'Escape') $('#gallery').hidden = true; return; }
    if (!$('#start').hidden) return;
    if (e.code === 'Escape') { e.preventDefault(); quit(); return; }
    if (e.code === 'KeyM') { music.setMuted(!music.isMuted()); return; }
    if (!$('#card').hidden && (e.code === 'Space' || e.code === 'Enter')) { e.preventDefault(); retryAfterCard(); return; }
    const a = KEYS[e.code];
    if (a && state.win && !state.win.done) { e.preventDefault(); answer(a); }
  });
}

async function boot() {
  loadSave();
  const res = await fetch('scenes.json', { cache: 'no-cache' });
  data = await res.json();
  scenes = data.scenes;
  $('#title').textContent = data.title;
  $('#tagline').textContent = data.tagline;
  $('#optMusic').checked = !music.isMuted();
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
