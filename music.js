// Orientation Day theme: "Mandatory Fun", a looping hold-music jingle.
// Synthesised with Web Audio so there is no file to ship. If audio/theme.mp3
// exists it plays instead, so a real recording can replace this without code.

const BPM = 112;
const STEP = 60 / BPM / 2; // one eighth note, in seconds
const LEVEL = 0.2;

// Eight bars of 4/4, eight eighth-note steps each. Melody tokens are note:steps.
const BARS = [
  { chord: [53, 57, 60, 64], root: 41, tune: 'C5:1 A4:1 C5:2 F5:3 E5:1' }, // Fmaj7
  { chord: [50, 53, 57, 60], root: 38, tune: 'D5:2 C5:1 A4:1 F4:4' }, // Dm7
  { chord: [55, 58, 62, 65], root: 43, tune: 'G4:1 A4:1 Bb4:2 D5:2 C5:2' }, // Gm7
  { chord: [52, 55, 58, 60], root: 36, tune: 'Bb4:1 A4:1 G4:2 -:2 C5:1 C5:1' }, // C7
  { chord: [53, 57, 60, 64], root: 41, tune: 'C5:1 A4:1 C5:2 F5:3 G5:1' }, // Fmaj7
  { chord: [54, 57, 60, 62], root: 38, tune: 'A5:2 F#5:1 D5:1 C5:4' }, // D7
  { chord: [55, 58, 62, 65], root: 43, tune: 'Bb4:1 D5:1 G5:2 F5:1 E5:1 D5:2' }, // Gm7
  { chord: [52, 55, 58, 61], root: 36, tune: 'E5:2 C5:2 Gb4:1 F4:3' }, // C7b9, with the sour note
];

const NAMES = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
function midi(name) {
  const m = /^([A-G])(#|b)?(\d)$/.exec(name);
  return NAMES[m[1]] + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0) + 12 * (Number(m[3]) + 1);
}
function hz(n) { return 440 * 2 ** ((n - 69) / 12); }

const TUNE = BARS.map((b) => {
  let at = 0;
  return b.tune.split(' ').map((tok) => {
    const [n, len] = tok.split(':');
    const note = { at, len: Number(len), n: n === '-' ? null : midi(n) };
    at += note.len;
    return note;
  }).filter((x) => x.n !== null);
});

let ctx = null;
let master = null;
let bus = null;
let noise = null;
let file = null; // HTMLAudioElement when audio/theme.mp3 exists
let timer = 0;
let nextStep = 0;
let stepNo = 0;
let playing = false;
let muted = false;
let duckUntil = 0;

try { muted = localStorage.getItem('orientation-day-music') === 'off'; } catch (e) { /* ignore */ }

function setup() {
  if (ctx) return;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return;
  ctx = new AC();
  master = ctx.createGain();
  master.gain.value = 0;
  const comp = ctx.createDynamicsCompressor();
  master.connect(comp).connect(ctx.destination);
  bus = ctx.createGain();
  bus.connect(master);
  noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
  const d = noise.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
}

function env(g, t, peak, attack, decay) {
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(peak, t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
}

// Electric piano: FM bell with a fast decaying modulation index.
function keys(n, t, dur, vel) {
  const car = ctx.createOscillator();
  const mod = ctx.createOscillator();
  const idx = ctx.createGain();
  const g = ctx.createGain();
  car.frequency.value = hz(n);
  mod.frequency.value = hz(n) * 2;
  idx.gain.setValueAtTime(hz(n) * 1.4, t);
  idx.gain.exponentialRampToValueAtTime(hz(n) * 0.05, t + 0.4);
  mod.connect(idx).connect(car.frequency);
  car.connect(g).connect(bus);
  env(g, t, vel, 0.005, dur + 0.25);
  [car, mod].forEach((o) => { o.start(t); o.stop(t + dur + 0.4); });
}

// Lead: a cheerful square-ish whistle with delayed vibrato.
function lead(n, t, dur) {
  const o = ctx.createOscillator();
  const o2 = ctx.createOscillator();
  const lfo = ctx.createOscillator();
  const depth = ctx.createGain();
  const lp = ctx.createBiquadFilter();
  const g = ctx.createGain();
  o.type = 'square';
  o2.type = 'triangle';
  o.frequency.value = hz(n);
  o2.frequency.value = hz(n + 12) * 1.003;
  lfo.frequency.value = 5.5;
  depth.gain.setValueAtTime(0, t);
  depth.gain.linearRampToValueAtTime(hz(n) * 0.012, t + Math.min(dur, 0.35));
  lfo.connect(depth);
  depth.connect(o.frequency);
  depth.connect(o2.frequency);
  lp.type = 'lowpass';
  lp.frequency.value = 2200;
  o.connect(lp);
  o2.connect(lp);
  lp.connect(g).connect(bus);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(0.09, t + 0.015);
  g.gain.setValueAtTime(0.09, t + dur * 0.8);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur + 0.08);
  [o, o2, lfo].forEach((x) => { x.start(t); x.stop(t + dur + 0.1); });
}

function bass(n, t, dur) {
  const o = ctx.createOscillator();
  const lp = ctx.createBiquadFilter();
  const g = ctx.createGain();
  o.type = 'triangle';
  o.frequency.value = hz(n);
  lp.type = 'lowpass';
  lp.frequency.value = 600;
  o.connect(lp).connect(g).connect(bus);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(0.32, t + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.start(t);
  o.stop(t + dur + 0.05);
}

function hit(t, freq, q, peak, decay) {
  const s = ctx.createBufferSource();
  const f = ctx.createBiquadFilter();
  const g = ctx.createGain();
  s.buffer = noise;
  f.type = 'bandpass';
  f.frequency.value = freq;
  f.Q.value = q;
  s.connect(f).connect(g).connect(bus);
  env(g, t, peak, 0.002, decay);
  s.start(t, Math.random() * 0.5);
  s.stop(t + decay + 0.05);
}

function kick(t) {
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.frequency.setValueAtTime(110, t);
  o.frequency.exponentialRampToValueAtTime(45, t + 0.12);
  o.connect(g).connect(bus);
  env(g, t, 0.35, 0.003, 0.18);
  o.start(t);
  o.stop(t + 0.25);
}

function schedule(i, t) {
  const bar = BARS[Math.floor(i / 8) % BARS.length];
  const s = i % 8;
  const swing = s % 2 ? STEP * 0.12 : 0;
  t += swing;
  // bossa bass: root, fifth, fifth, root
  if (s === 0) bass(bar.root, t, STEP * 3);
  if (s === 3) bass(bar.root + 7, t, STEP);
  if (s === 4) bass(bar.root + 7, t, STEP * 3);
  if (s === 7) bass(bar.root, t, STEP);
  // piano comping on the off-beats
  if (s === 1 || s === 4 || s === 6) bar.chord.forEach((n) => keys(n, t, STEP * 1.5, 0.045));
  // shaker, rim, kick
  hit(t, 8000, 1.2, s % 2 ? 0.05 : 0.025, 0.05);
  if (s === 3 || s === 6) hit(t, 1800, 6, 0.14, 0.04);
  if (s === 0 || s === 4) kick(t);
  // melody, which sits out every other pass so the hook doesn't wear thin
  if (Math.floor(i / 64) % 2 === 0) {
    TUNE[Math.floor(i / 8) % BARS.length].filter((x) => x.at === s).forEach((x) => lead(x.n, t, x.len * STEP * 0.92));
  }
}

function tick() {
  while (nextStep < ctx.currentTime + 0.15) {
    schedule(stepNo, nextStep);
    nextStep += STEP;
    stepNo++;
  }
  // duck under dialogue
  const target = muted ? 0 : performance.now() < duckUntil ? LEVEL * 0.35 : LEVEL;
  if (Math.abs(master.gain.value - target) > 0.001) master.gain.setTargetAtTime(target, ctx.currentTime, 0.12);
}

async function probeFile() {
  try {
    const r = await fetch('audio/theme.mp3', { method: 'HEAD' });
    if (!r.ok || !/audio/.test(r.headers.get('content-type') || '')) return;
    file = new Audio('audio/theme.mp3');
    file.loop = true;
    file.volume = 0;
  } catch (e) { /* no recording, keep the synth */ }
}
const probed = probeFile();

function fileTick() {
  const target = muted || !playing ? 0 : performance.now() < duckUntil ? 0.25 : 0.7;
  file.volume += (target - file.volume) * 0.2;
}

// Call from a user gesture (the Begin button), or browsers keep audio locked.
export function start() {
  playing = true;
  setup();
  if (ctx) ctx.resume();
  probed.then(() => {
    if (!playing) return;
    clearInterval(timer);
    if (file) {
      file.play().catch(() => {});
      timer = setInterval(fileTick, 50);
      return;
    }
    if (!ctx) return;
    nextStep = ctx.currentTime + 0.05;
    stepNo = 0;
    timer = setInterval(tick, 25);
  });
}

export function stop() {
  playing = false;
  if (file) { file.volume = 0; file.pause(); clearInterval(timer); return; }
  clearInterval(timer);
  if (master) master.gain.setTargetAtTime(0, ctx.currentTime, 0.05);
}

// The record-scratch moment on a death: cut the tune, play a deflating "wah wah".
export function sting() {
  stop();
  if (muted || !ctx || file) return;
  master.gain.cancelScheduledValues(ctx.currentTime);
  master.gain.setValueAtTime(LEVEL, ctx.currentTime);
  const t = ctx.currentTime + 0.05;
  [[64, 0], [63, 0.32], [62, 0.64], [61, 0.96]].forEach(([n, at], i) => lead(n - 12, t + at, i === 3 ? 0.9 : 0.28));
  master.gain.setTargetAtTime(0, t + 1.9, 0.1);
}

export function duck(ms) { duckUntil = Math.max(duckUntil, performance.now() + ms); }

export function isPlaying() { return playing; }

export function setMuted(on) {
  muted = on;
  try { localStorage.setItem('orientation-day-music', on ? 'off' : 'on'); } catch (e) { /* ignore */ }
}

export function isMuted() { return muted; }
