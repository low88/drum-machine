/* MICROFONIA — audio engine.
   Everything is a sample: a track's source is either a microphone recording (or a file, or a resampled
   bit of the mix) or a sound the app synthesises itself — which is rendered to a buffer and then treated
   exactly like a recording. Each hit is then shaped offline (start, length, pitch, envelope, reverse,
   colour) into round-robin buffers and played sample-accurately through a live channel strip with
   per-hit modulation (LFO), sends to reverb and delay, and a master glitch box. */
'use strict';
const Engine = (() => {
const R = Math.random, clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const SR = 44100;

/* ================= parameter table ================= */
const ms = s => s < 1 ? Math.round(s * 1000) + ' ms' : s.toFixed(2) + ' s';
const hz = f => f < 1000 ? Math.round(f) + ' Hz' : (f / 1000).toFixed(f < 10000 ? 2 : 1) + ' k';
const pc = v => Math.round(v * 100) + '%';
const PARAMS = {
  // CAMPIONE — how the source buffer is played
  sStart: { g: 'campione', l: 'Inizio', d: 0, fmt: pc },
  sLen:   { g: 'campione', l: 'Durata', d: 1, fmt: pc },
  sPitch: { g: 'campione', l: 'Tono', d: .5, map: v => Math.round((v - .5) * 48), fmt: v => (v > 0 ? '+' : '') + v + ' st' },
  sFine:  { g: 'campione', l: 'Fine', d: .5, map: v => Math.round((v - .5) * 100), fmt: v => (v > 0 ? '+' : '') + v + ' ct' },
  sAtk:   { g: 'campione', l: 'Attacco', d: 0, map: v => v * v * .3, fmt: ms },
  sDec:   { g: 'campione', l: 'Coda', d: 1, map: v => v > .98 ? 99 : .01 * Math.pow(300, v), fmt: v => v > 90 ? 'intera' : ms(v) },
  sRev:   { g: 'campione', l: 'Verso', d: 0, sel: ['Avanti', 'Indietro'] },
  sGain:  { g: 'campione', l: 'Guadagno', d: .5, map: v => Math.pow(4, (v - .5) * 2), fmt: v => (20 * Math.log10(v) > 0 ? '+' : '') + (20 * Math.log10(v)).toFixed(1) + ' dB' },
  // SINTESI (only when the source is "suono suo") — rendered to a buffer, then sampled
  tLvl:   { g: 'corpo', l: 'Livello', d: 1, fmt: pc },
  tPitch: { g: 'corpo', l: 'Altezza', d: .28, map: v => 20 * Math.pow(100, v), fmt: hz },
  tBend:  { g: 'corpo', l: 'Caduta', d: .6, map: v => v * 48, fmt: v => '+' + Math.round(v) + ' st' },
  tBendT: { g: 'corpo', l: 'Rapidità', d: .35, map: v => .002 * Math.pow(150, v), fmt: ms },
  tWave:  { g: 'corpo', l: 'Onda', d: 0, sel: ['Sinus', 'Triang', 'Quadra', 'Dente'] },
  tDec:   { g: 'corpo', l: 'Coda', d: .6, map: v => .01 * Math.pow(300, v), fmt: ms },
  nLvl:   { g: 'rumore', l: 'Livello', d: 0, fmt: pc },
  nType:  { g: 'rumore', l: 'Filtro', d: 1, sel: ['Basso', 'Banda', 'Alto'] },
  nFreq:  { g: 'rumore', l: 'Frequenza', d: .6, map: v => 60 * Math.pow(300, v), fmt: hz },
  nQ:     { g: 'rumore', l: 'Risonanza', d: .2, map: v => .3 * Math.pow(60, v), fmt: v => v.toFixed(1) },
  nDec:   { g: 'rumore', l: 'Coda', d: .4, map: v => .005 * Math.pow(400, v), fmt: ms },
  nBursts:{ g: 'rumore', l: 'Colpi', d: 0, sel: ['1', '2', '3', '4', '5', '6'] },
  nSpread:{ g: 'rumore', l: 'Spazio', d: .3, map: v => .002 + v * .03, fmt: ms },
  mLvl:   { g: 'metallo', l: 'Livello', d: 0, fmt: pc },
  mFreq:  { g: 'metallo', l: 'Base', d: .45, map: v => 60 * Math.pow(30, v), fmt: hz },
  mSet:   { g: 'metallo', l: 'Serie', d: 0, sel: ['808', 'Campana', 'Armon.', 'Campan.', 'Caos'] },
  mDisp:  { g: 'metallo', l: 'Dispers.', d: .2, fmt: pc },
  mFm:    { g: 'metallo', l: 'FM', d: 0, fmt: pc },
  mDec:   { g: 'metallo', l: 'Coda', d: .3, map: v => .01 * Math.pow(200, v), fmt: ms },
  mHp:    { g: 'metallo', l: 'Passa‑alto', d: .7, map: v => 200 * Math.pow(60, v), fmt: hz },
  rLvl:   { g: 'risonanza', l: 'Livello', d: 0, fmt: pc },
  rFreq:  { g: 'risonanza', l: 'Frequenza', d: .55, map: v => 80 * Math.pow(100, v), fmt: hz },
  rShape: { g: 'risonanza', l: 'Forma', d: 1, sel: ['Piastra', 'Tazza', 'Vetro', 'Barra', 'Gong', 'Legno', 'Pelle', 'Pentola'] },
  rRing:  { g: 'risonanza', l: 'Risonanza', d: .5, map: v => 4 * Math.pow(100, v), fmt: v => 'Q ' + Math.round(v) },
  rExc:   { g: 'risonanza', l: 'Colpo', d: .6, fmt: v => v < .5 ? 'spazzola' : 'bacchetta' },
  rBright:{ g: 'risonanza', l: 'Brillanza', d: .5, fmt: pc },
  // COLORE — baked character
  click:  { g: 'colore', l: 'Click', d: 0, fmt: pc },
  drive:  { g: 'colore', l: 'Drive', d: .1, fmt: pc },
  bits:   { g: 'colore', l: 'Bit', d: 0, map: v => Math.round(16 - v * 14), fmt: v => v + ' bit' },
  down:   { g: 'colore', l: 'Riduci', d: 0, map: v => 1 + Math.round(v * v * 39), fmt: v => v === 1 ? 'off' : '÷' + v },
  vari:   { g: 'colore', l: 'Variazione', d: .15, fmt: pc },
  human:  { g: 'colore', l: 'Umano', d: 0, map: v => v * .025, fmt: ms },
  // MIX — live channel strip
  vol:    { g: 'mix', l: 'Volume', d: .75, fmt: pc, live: true },
  pan:    { g: 'mix', l: 'Pan', d: .5, fmt: v => v < .48 ? 'S ' + Math.round((.5 - v) * 200) : v > .52 ? 'D ' + Math.round((v - .5) * 200) : 'centro', live: true },
  cut:    { g: 'mix', l: 'Filtro', d: .5, fmt: v => v < .48 ? 'LP' : v > .52 ? 'HP' : 'aperto', live: true },
  res:    { g: 'mix', l: 'Risonanza', d: .1, fmt: pc, live: true },
  rev:    { g: 'mix', l: 'Spazio', d: .1, fmt: pc, live: true },
  del:    { g: 'mix', l: 'Eco', d: 0, fmt: pc, live: true },
  choke:  { g: 'mix', l: 'Choke', d: 0, sel: ['—', 'A', 'B', 'C'], live: true },
  // MOVIMENTO — two LFOs per track, synced to the bars
  l1T:    { g: 'movimento', l: 'Destinaz. 1', d: 0, sel: ['—', 'Filtro', 'Tono', 'Pan', 'Volume', 'Inizio', 'Eco', 'Spazio'], live: true },
  l1S:    { g: 'movimento', l: 'Forma 1', d: 0, sel: ['Sinus', 'Triang', 'Rampa', 'Quadra', 'Caso'], live: true },
  l1R:    { g: 'movimento', l: 'Periodo 1', d: .43, sel: ['1/8', '1/4', '1/2', '1 b', '2 b', '4 b', '8 b', '16 b', '32 b'], live: true },
  l1D:    { g: 'movimento', l: 'Quantità 1', d: .5, fmt: pc, live: true },
  l2T:    { g: 'movimento', l: 'Destinaz. 2', d: 0, sel: ['—', 'Filtro', 'Tono', 'Pan', 'Volume', 'Inizio', 'Eco', 'Spazio'], live: true },
  l2S:    { g: 'movimento', l: 'Forma 2', d: .25, sel: ['Sinus', 'Triang', 'Rampa', 'Quadra', 'Caso'], live: true },
  l2R:    { g: 'movimento', l: 'Periodo 2', d: .75, sel: ['1/8', '1/4', '1/2', '1 b', '2 b', '4 b', '8 b', '16 b', '32 b'], live: true },
  l2D:    { g: 'movimento', l: 'Quantità 2', d: .5, fmt: pc, live: true },
};
const LFO_BARS = [.125, .25, .5, 1, 2, 4, 8, 16, 32];
const SYNTH_KEYS = Object.keys(PARAMS).filter(k => ['corpo', 'rumore', 'metallo', 'risonanza'].includes(PARAMS[k].g));
const val = (p, k) => { const d = PARAMS[k]; const v = p[k] == null ? d.d : p[k]; return d.sel ? Math.round(v * (d.sel.length - 1)) : d.map ? d.map(v) : v; };
function display(k, v) { const d = PARAMS[k]; if (d.sel) return d.sel[Math.round(v * (d.sel.length - 1))]; const x = d.map ? d.map(v) : v; return d.fmt ? d.fmt(x) : String(x); }
function defaults() { const o = {}; for (const k in PARAMS) o[k] = PARAMS[k].d; return o; }

const METAL = [[1, 1.483, 1.8, 2.546, 2.63, 3.897], [1, 1.64, 2.12, 3.05, 3.57, 4.9], [1, 2, 3, 4, 5, 6], [1, 1.4818], null];
const MODES = [[1, 2.08, 3.41, 3.89, 5.0, 5.95], [1, 2.32, 4.25, 6.63, 9.38], [1, 2.756, 5.404, 8.933], [1, 3.93, 9.61], [1, 1.13, 1.42, 1.67, 2.2, 2.6, 3.1, 3.7], [1, 2.57, 4.2], [1, 1.59, 2.14, 2.3, 2.65, 2.92], [1, 1.5, 1.98, 2.44, 2.9, 3.6, 4.1]];
const hash = n => { const x = Math.sin(n * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };

/* ================= synthesis → buffer ================= */
function noiseBuffer(oc, sec) { const b = oc.createBuffer(1, Math.max(1, Math.ceil(oc.sampleRate * sec)), oc.sampleRate), d = b.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = R() * 2 - 1; return b; }
function envDecay(g, t0, peak, dec, att = .0015) {
  g.gain.setValueAtTime(0, t0); g.gain.linearRampToValueAtTime(peak, t0 + att);
  g.gain.exponentialRampToValueAtTime(Math.max(peak * .0005, 1e-5), t0 + att + dec); g.gain.linearRampToValueAtTime(0, t0 + att + dec + .01);
}
async function renderSynth(p0, variation) {
  const P = Object.assign(defaults(), p0), vx = P.vari * (variation ? 1 : 0);
  const jit = (k, a) => { if (vx) P[k] = clamp(P[k] + (R() - .5) * a * vx, 0, 1); };
  ['tPitch', 'nFreq', 'mFreq', 'rFreq'].forEach(k => jit(k, .03)); ['tDec', 'nDec', 'mDec', 'rRing', 'tBend', 'nQ', 'rBright', 'mFm'].forEach(k => jit(k, .1));
  const v = k => val(P, k);
  const tl = P.tLvl, nl = P.nLvl, ml = P.mLvl, rl = P.rLvl, rQ = v('rRing'), rF = v('rFreq');
  let dur = Math.max(.03, tl > 0 ? v('tDec') + .01 : 0, nl > 0 ? v('nDec') + v('nSpread') * v('nBursts') + .01 : 0, ml > 0 ? v('mDec') + .01 : 0, rl > 0 ? Math.min(3.5, rQ / (Math.PI * rF) * 7 + .03) : 0) + .03;
  dur = Math.min(dur, 5);
  const oc = new OfflineAudioContext(1, Math.ceil(SR * dur), SR), sum = oc.createGain(); sum.connect(oc.destination);
  if (tl > 0) {
    const f = v('tPitch'), w = ['sine', 'triangle', 'square', 'sawtooth'][v('tWave')], o = oc.createOscillator(); o.type = w;
    o.frequency.setValueAtTime(Math.min(20000, f * Math.pow(2, v('tBend') / 12)), 0); o.frequency.setTargetAtTime(f, 0, v('tBendT') / 3);
    const g = oc.createGain(); envDecay(g, 0, tl * tl, v('tDec'), .0008); let tail = o;
    if (w !== 'sine') { const lp = oc.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = Math.min(18000, f * 10 + 500); o.connect(lp); tail = lp; }
    tail.connect(g); g.connect(sum); o.start(0); o.stop(dur);
  }
  if (nl > 0) {
    const src = oc.createBufferSource(); src.buffer = noiseBuffer(oc, dur);
    const fl = oc.createBiquadFilter(); fl.type = ['lowpass', 'bandpass', 'highpass'][v('nType')]; fl.frequency.value = Math.min(18000, v('nFreq')); fl.Q.value = v('nQ');
    const g = oc.createGain(), bursts = v('nBursts') + 1, sp = v('nSpread'), lvl = nl * nl * (fl.type === 'bandpass' ? 1.6 : 1);
    g.gain.setValueAtTime(0, 0);
    for (let b = 0; b < bursts; b++) { const t = b * sp * (1 + (R() - .5) * .3), last = b === bursts - 1; g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(lvl * (last ? 1 : .85), t + .0008);
      if (last) g.gain.exponentialRampToValueAtTime(lvl * .0005 + 1e-5, t + .0008 + v('nDec')); else g.gain.exponentialRampToValueAtTime(lvl * .05 + 1e-5, t + sp * .9); }
    src.connect(fl); fl.connect(g); g.connect(sum); src.start(0);
  }
  if (ml > 0) {
    const base = v('mFreq'), ratios = METAL[v('mSet')] || [0, 1, 2, 3, 4, 5].map(i => 1 + i * .37 + hash(i + Math.round(P.mFreq * 50)) * 1.6);
    const hp = oc.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = v('mHp'); hp.Q.value = .7;
    const bp = oc.createBiquadFilter(); bp.type = 'peaking'; bp.frequency.value = Math.min(16000, base * 8); bp.gain.value = 6; bp.Q.value = 1;
    const g = oc.createGain(); envDecay(g, 0, ml * ml * .35, v('mDec'), .0005); hp.connect(bp); bp.connect(g); g.connect(sum);
    let fm = null;
    if (P.mFm > .01) { const o = oc.createOscillator(); o.frequency.value = base * (1.41 + P.mDisp * 2.3); const fg = oc.createGain(); fg.gain.value = P.mFm * P.mFm * base * 6; o.connect(fg); o.start(0); o.stop(dur); fm = fg; }
    ratios.forEach((r, i) => { const o = oc.createOscillator(); o.type = 'square'; o.frequency.value = Math.min(18000, base * r * (1 + (hash(i * 7.3 + 1) - .5) * P.mDisp * .6)); if (fm) fm.connect(o.frequency);
      const og = oc.createGain(); og.gain.value = 1 / ratios.length * 2; o.connect(og); og.connect(hp); o.start(0); o.stop(dur); });
  }
  if (rl > 0) {
    const modes = MODES[v('rShape')], exc = P.rExc, eLen = .0004 + (1 - exc) * .025;
    const eb = oc.createBuffer(1, Math.ceil(SR * eLen) + 2, SR), ed = eb.getChannelData(0);
    for (let i = 0; i < ed.length; i++) { const k = i / ed.length; ed[i] = (exc > .5 && i < 3 ? (i === 0 ? 1 : -.5) : (R() * 2 - 1)) * Math.pow(1 - k, 2); }
    const src = oc.createBufferSource(); src.buffer = eb; const tone = oc.createBiquadFilter(); tone.type = 'lowpass'; tone.frequency.value = 800 + P.rBright * P.rBright * 17000; src.connect(tone);
    const out = oc.createGain(); out.gain.value = rl * rl * Math.sqrt(rQ) * .9; out.connect(sum);
    modes.forEach((m, i) => { const f = rF * m; if (f > 19000) return; const bp = oc.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = f * (1 + (R() - .5) * .004 * (1 + vx * 4)); bp.Q.value = rQ * (1 - i * .06);
      const g = oc.createGain(); g.gain.value = Math.pow(i + 1, -(1.6 - P.rBright * 1.4)); tone.connect(bp); bp.connect(g); g.connect(out); });
    src.start(0);
  }
  const out = await oc.startRendering(), d = out.getChannelData(0);
  let pk = 0; for (let i = 0; i < d.length; i++) pk = Math.max(pk, Math.abs(d[i])); if (pk > 1e-4) { const k = .95 / pk; for (let i = 0; i < d.length; i++) d[i] *= k; }
  return out;
}

/* ================= sample shaping (every hit goes through here) ================= */
const reversedCache = new WeakMap();
function reversed(buf) {
  if (reversedCache.has(buf)) return reversedCache.get(buf);
  const r = new AudioBuffer({ length: buf.length, numberOfChannels: 1, sampleRate: buf.sampleRate }), s = buf.getChannelData(0), d = r.getChannelData(0);
  for (let i = 0; i < s.length; i++) d[i] = s[s.length - 1 - i];
  reversedCache.set(buf, r); return r;
}
async function shapeHit(src, p0, variation) {
  const P = Object.assign(defaults(), p0), vx = P.vari * (variation ? 1 : 0), v = k => val(P, k);
  const rate = Math.pow(2, (v('sPitch') + v('sFine') / 100 + (vx ? (R() - .5) * vx * .5 : 0)) / 12);
  const buf = P.sRev > .5 ? reversed(src) : src, bd = buf.duration;
  const st = clamp(P.sStart + (vx ? (R() - .5) * vx * .01 : 0), 0, .999) * bd;
  const len = Math.max(.005, P.sLen * (bd - st)), dec = v('sDec') * (vx ? 1 + (R() - .5) * vx * .4 : 1), atk = v('sAtk');
  const dur = Math.min(len / rate, dec < 90 ? dec * 1.3 + atk + .02 : 99, 12) + .005;
  const oc = new OfflineAudioContext(1, Math.max(64, Math.ceil(SR * dur)), SR);
  const s = oc.createBufferSource(); s.buffer = buf; s.playbackRate.value = rate;
  const g = oc.createGain(), gain = v('sGain');
  g.gain.setValueAtTime(atk > .001 ? 0 : gain, 0); if (atk > .001) g.gain.linearRampToValueAtTime(gain, atk);
  if (dec < 90) g.gain.setTargetAtTime(0, atk + .003, dec / 4);
  const sh = oc.createWaveShaper(); { const k = 1 + P.drive * P.drive * 30, n = 2048, c = new Float32Array(n), nk = Math.tanh(k); for (let i = 0; i < n; i++) { const x = i / (n - 1) * 2 - 1; c[i] = Math.tanh(k * x) / nk; } sh.curve = c; sh.oversample = '4x'; }
  s.connect(g); g.connect(sh); sh.connect(oc.destination); s.start(0, st, len);
  if (P.click > .01) {
    const b = oc.createBuffer(1, 96, SR), d = b.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = (i === 0 ? 1 : (R() * 2 - 1) * .6) * Math.exp(-i / 9);
    const c = oc.createBufferSource(); c.buffer = b; const hp = oc.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 1500; const cg = oc.createGain(); cg.gain.value = P.click * P.click * 1.4; c.connect(hp); hp.connect(cg); cg.connect(sh); c.start(0);
  }
  const out = await oc.startRendering(), d = out.getChannelData(0);
  const bits = v('bits'), down = v('down');
  if (bits < 16 || down > 1) { const q = Math.pow(2, bits - 1); let hold = 0; for (let i = 0; i < d.length; i++) { if (i % down === 0) hold = bits < 16 ? Math.round(d[i] * q) / q : d[i]; d[i] = hold; } }
  let pk = 0; for (let i = 0; i < d.length; i++) pk = Math.max(pk, Math.abs(d[i]));
  if (pk > 1) { const k = .98 / pk; for (let i = 0; i < d.length; i++) d[i] *= k; }
  const fo = Math.min(d.length, 220); for (let i = 0; i < fo; i++) d[d.length - 1 - i] *= i / fo;
  return out;
}
// track: { src: 'mic'|'synth', sample: AudioBuffer|null, p }
async function sourceOf(track, variation) {
  if (track.src === 'synth') return renderSynth(track.p, variation);
  return track.sample || null;
}
async function render(track) {
  const n = track.p.vari > .02 ? 4 : 1, bufs = [];
  for (let i = 0; i < n; i++) { const src = await sourceOf(track, i > 0); if (!src) return []; bufs.push(await shapeHit(src, track.p, i > 0)); }
  return bufs;
}

/* ================= live graph ================= */
let ctx = null, bus, dry, mDrive, djF, xyF, comp, limiter, outG, analyser, streamDest, glitch = null;
let revIn, conv, revPre, revRet, delIn, dL, dR, fbL, fbR, dTone, delRet, wowG, washRev, washDel;
const FX = { size: .45, damp: .5, pre: .1, tub: .2, revLvl: .8, dDiv: 3, dFb: .45, dTone: .55, dWow: .2, dPing: 1, delLvl: .7, press: .35, sat: .2, dj: .5, master: .85 };
const DIVS = [['1/32', .125], ['1/16', .25], ['1/16T', 1 / 6], ['1/8', .5], ['1/8T', 1 / 3], ['3/16', .75], ['1/4', 1], ['3/8', 1.5], ['1/2', 2]];
const channels = [];
let washV = 0;
function init() {
  if (ctx) return ctx;
  const AC = window.AudioContext || window.webkitAudioContext;
  ctx = new AC({ latencyHint: 'interactive' });
  dry = ctx.createGain(); bus = ctx.createGain();
  mDrive = ctx.createWaveShaper(); mDrive.oversample = '2x';
  xyF = ctx.createBiquadFilter(); xyF.type = 'lowpass'; xyF.frequency.value = 22000; xyF.Q.value = .5;
  djF = ctx.createBiquadFilter(); djF.type = 'lowpass'; djF.frequency.value = 22000;
  comp = ctx.createDynamicsCompressor(); comp.knee.value = 8; comp.attack.value = .006; comp.release.value = .12;
  const makeup = ctx.createGain();
  limiter = ctx.createDynamicsCompressor(); limiter.threshold.value = -1.5; limiter.knee.value = 0; limiter.ratio.value = 20; limiter.attack.value = .001; limiter.release.value = .06;
  outG = ctx.createGain(); analyser = ctx.createAnalyser(); analyser.fftSize = 2048; analyser.smoothingTimeConstant = .7;
  dry.connect(bus); bus.connect(mDrive); mDrive.connect(xyF); xyF.connect(djF); djF.connect(comp); comp.connect(makeup); makeup.connect(limiter); limiter.connect(outG);
  outG.connect(ctx.destination); outG.connect(analyser);
  try { streamDest = ctx.createMediaStreamDestination(); outG.connect(streamDest); } catch (e) {}
  FX.makeup = makeup;
  revIn = ctx.createGain(); revPre = ctx.createDelay(.5); conv = ctx.createConvolver(); revRet = ctx.createGain();
  revIn.connect(revPre); revPre.connect(conv); conv.connect(revRet); revRet.connect(bus);
  delIn = ctx.createGain(); dL = ctx.createDelay(4); dR = ctx.createDelay(4); fbL = ctx.createGain(); fbR = ctx.createGain();
  dTone = ctx.createBiquadFilter(); dTone.type = 'lowpass'; const dSat = ctx.createWaveShaper(); dSat.curve = tanhCurve(1.6);
  const hpD = ctx.createBiquadFilter(); hpD.type = 'highpass'; hpD.frequency.value = 120;
  const merge = ctx.createChannelMerger(2); delRet = ctx.createGain();
  delIn.connect(dTone); dTone.connect(hpD); hpD.connect(dL); dL.connect(fbL); fbL.connect(dSat); dSat.connect(dR); dR.connect(fbR); fbR.connect(dTone);
  dL.connect(merge, 0, 0); dR.connect(merge, 0, 1); merge.connect(delRet); delRet.connect(bus);
  const wow = ctx.createOscillator(); wow.frequency.value = .6; wowG = ctx.createGain(); wow.connect(wowG); wowG.connect(dL.delayTime); wowG.connect(dR.delayTime); wow.start();
  washRev = ctx.createGain(); washRev.gain.value = 0; washDel = ctx.createGain(); washDel.gain.value = 0;
  dry.connect(washRev); washRev.connect(revIn); dry.connect(washDel); washDel.connect(delIn);
  applyFX(true);
  if (ctx.audioWorklet) ctx.audioWorklet.addModule('glitch-worklet.js').then(() => {
    glitch = new AudioWorkletNode(ctx, 'glitchbox', { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [2] });
    bus.disconnect(mDrive); bus.connect(glitch); glitch.connect(mDrive);
  }).catch(e => console.warn('glitch off', e));
  return ctx;
}
function tanhCurve(k) { const n = 1024, c = new Float32Array(n), nk = Math.tanh(k); for (let i = 0; i < n; i++) { const x = i / (n - 1) * 2 - 1; c[i] = Math.tanh(k * x) / nk; } return c; }
function makeIR() {
  const sec = .25 + FX.size * FX.size * 7.5, n = Math.ceil(ctx.sampleRate * sec), b = ctx.createBuffer(2, n, ctx.sampleRate);
  const tubF = [], tubN = 7; for (let i = 0; i < tubN; i++) tubF.push(300 + R() * 4200);
  for (let c = 0; c < 2; c++) { const d = b.getChannelData(c); let y = 0;
    for (let i = 0; i < n; i++) { const k = i / n, a = clamp(1 - FX.damp * (.3 + k * .7), .03, 1); y += a * ((R() * 2 - 1) - y); let s = y * Math.pow(1 - k, 1.6 + FX.damp);
      if (FX.tub > .01) { let m = 0; const t = i / ctx.sampleRate; for (let j = 0; j < tubN; j++) m += Math.sin(t * tubF[j] * 6.2832 + c * j) * Math.exp(-t * (3 + j * 1.3 + (1 - FX.size) * 8)); s += m * FX.tub * .06 * (R() * .5 + .5); }
      d[i] = s * (i < 64 ? i / 64 : 1); } }
  return b;
}
let irT = 0;
function applyFX(rebuildIR) {
  if (!ctx) return; const t = ctx.currentTime;
  if (rebuildIR) { clearTimeout(irT); irT = setTimeout(() => { conv.buffer = makeIR(); }, 120); }
  revPre.delayTime.setTargetAtTime(FX.pre * .15, t, .05); revRet.gain.setTargetAtTime(FX.revLvl * 1.4, t, .05);
  const dt = Math.min(3.9, DIVS[FX.dDiv][1] * 60 / S.bpm);
  dL.delayTime.setTargetAtTime(dt, t, .05); dR.delayTime.setTargetAtTime(FX.dPing ? dt : .0001, t, .05);
  const fb = Math.min(.93, FX.dFb * .95 + washV * .35);
  fbL.gain.setTargetAtTime(FX.dPing ? 1 : fb, t, .05); fbR.gain.setTargetAtTime(fb, t, .05);
  dTone.frequency.setTargetAtTime(300 * Math.pow(50, FX.dTone), t, .05); wowG.gain.setTargetAtTime(FX.dWow * .004, t, .1);
  delRet.gain.setTargetAtTime(FX.delLvl * 1.2, t, .05);
  comp.threshold.setTargetAtTime(-6 - FX.press * 30, t, .05); comp.ratio.setTargetAtTime(1.5 + FX.press * 8, t, .05); FX.makeup.gain.setTargetAtTime(1 + FX.press * 1.6, t, .05);
  mDrive.curve = tanhCurve(.6 + FX.sat * FX.sat * 8);
  const dj = FX.dj;
  if (dj < .48) { djF.type = 'lowpass'; djF.frequency.setTargetAtTime(80 * Math.pow(270, dj / .48), t, .03); djF.Q.value = 3; }
  else if (dj > .52) { djF.type = 'highpass'; djF.frequency.setTargetAtTime(20 * Math.pow(250, (dj - .52) / .48), t, .03); djF.Q.value = 3; }
  else { djF.type = 'lowpass'; djF.frequency.setTargetAtTime(22000, t, .03); djF.Q.value = .5; }
  outG.gain.setTargetAtTime(FX.master, t, .05);
}

/* ---------- performance FX (the touch surface) ---------- */
const PERF = {
  get ready() { return !!glitch; },
  on(mode, o = {}) { if (glitch) glitch.port.postMessage(Object.assign({ t: 'on', mode }, o)); },
  set(o) { if (glitch) glitch.port.postMessage(Object.assign({ t: 'set' }, o)); },
  off() { if (glitch) glitch.port.postMessage({ t: 'off' }); },
  crush(v) { if (glitch) glitch.port.postMessage({ t: 'crush', v }); },
  wash(rev, del) { if (!ctx) return; washV = Math.max(rev, del); const t = ctx.currentTime; washRev.gain.setTargetAtTime(rev * 1.3, t, .04); washDel.gain.setTargetAtTime(del * 1.1, t, .04); applyFX(false); },
  xy(x, y) {
    if (!ctx) return; const t = ctx.currentTime;
    if (x == null) { xyF.type = 'lowpass'; xyF.frequency.setTargetAtTime(22000, t, .12); xyF.Q.setTargetAtTime(.5, t, .12); return; }
    const q = .6 + y * y * 18;
    if (x < .46) { xyF.type = 'lowpass'; xyF.frequency.setTargetAtTime(70 * Math.pow(280, x / .46), t, .02); }
    else if (x > .54) { xyF.type = 'highpass'; xyF.frequency.setTargetAtTime(30 * Math.pow(220, (x - .54) / .46), t, .02); }
    else { xyF.type = 'lowpass'; xyF.frequency.setTargetAtTime(20000, t, .02); }
    xyF.Q.setTargetAtTime(q, t, .02);
  },
};

/* ---------- LFO ---------- */
function lfoVal(shape, phase, seed) {
  const f = phase - Math.floor(phase);
  switch (shape) {
    case 0: return Math.sin(f * Math.PI * 2);
    case 1: return f < .5 ? f * 4 - 1 : 3 - f * 4;
    case 2: return f * 2 - 1;
    case 3: return f < .5 ? 1 : -1;
    default: return hash(Math.floor(phase) * 13.7 + seed) * 2 - 1;
  }
}
// modulations for one hit at a position (in bars)
function mods(p, pos, seed) {
  const m = { semis: 0, pan: 0, cut: 0, cutD: 0, gain: 1, start: 0, del: 0, rev: 0 };
  for (const L of ['l1', 'l2']) {
    const tgt = val(p, L + 'T'); if (!tgt) continue;
    const d = p[L + 'D'] == null ? .5 : p[L + 'D'], x = lfoVal(val(p, L + 'S'), pos / LFO_BARS[val(p, L + 'R')], seed + (L === 'l2' ? 7 : 0));
    switch (tgt) {
      case 1: m.cut += x * d; m.cutD += d; break; case 2: m.semis += x * d * 12; break; case 3: m.pan += x * d; break;
      case 4: m.gain *= 1 - d * (1 - (x + 1) / 2); break; case 5: m.start = Math.max(m.start, (x + 1) / 2 * d); break;
      case 6: m.del += (x + 1) / 2 * d; break; case 7: m.rev += (x + 1) / 2 * d; break;
    }
  }
  return m;
}

class Channel {
  constructor() {
    this.in = ctx.createGain(); this.f = ctx.createBiquadFilter(); this.v = ctx.createGain();
    this.pan = ctx.createStereoPanner(); this.rs = ctx.createGain(); this.ds = ctx.createGain();
    this.in.connect(this.f); this.f.connect(this.v); this.v.connect(this.pan); this.pan.connect(dry);
    this.v.connect(this.rs); this.rs.connect(revIn); this.v.connect(this.ds); this.ds.connect(delIn);
    this.an = ctx.createAnalyser(); this.an.fftSize = 256; this.v.connect(this.an); this.buf = new Float32Array(256);
    this.active = []; this.bufs = []; this.rr = 0; this.base = { type: 'lowpass', freq: 22000, q: .5, pan: 0, rs: 0, ds: 0 };
  }
  apply(p, gate) {
    const t = ctx.currentTime, g = val(p, 'vol');
    this.v.gain.setTargetAtTime(g * g * 1.2 * gate, t, .02);
    const c = p.cut, q = .5 + p.res * 14, B = this.base;
    B.pan = (p.pan - .5) * 2; B.rs = p.rev * p.rev * 1.5; B.ds = p.del * p.del * 1.4;
    if (c < .48) { B.type = 'lowpass'; B.freq = 60 * Math.pow(330, c / .48); B.q = q; }
    else if (c > .52) { B.type = 'highpass'; B.freq = 20 * Math.pow(500, (c - .52) / .48); B.q = q; }
    else { B.type = 'lowpass'; B.freq = 22000; B.q = .5; }
    this.f.type = B.type;
    this.f.frequency.setTargetAtTime(B.freq, t, .02); this.f.Q.setTargetAtTime(B.q, t, .02);
    this.pan.pan.setTargetAtTime(B.pan, t, .02); this.rs.gain.setTargetAtTime(B.rs, t, .02); this.ds.gain.setTargetAtTime(B.ds, t, .02);
    this.modded = !!(val(p, 'l1T') || val(p, 'l2T'));
  }
  level() { this.an.getFloatTimeDomainData(this.buf); let m = 0; for (let i = 0; i < this.buf.length; i++) m = Math.max(m, Math.abs(this.buf[i])); return m; }
  play(time, vel, semis, human, m) {
    if (!this.bufs.length) return;
    const b = this.bufs[this.rr++ % this.bufs.length];
    const s = ctx.createBufferSource(); s.buffer = b; s.playbackRate.value = Math.pow(2, ((semis || 0) + (m ? m.semis : 0)) / 12);
    const g = ctx.createGain(); g.gain.value = Math.pow(clamp(vel, 0, 1.2), 1.6) * (m ? m.gain : 1);
    s.connect(g); g.connect(this.in);
    const t = Math.max(ctx.currentTime, time + (human ? (R() - .5) * human * 2 : 0));
    if (m && this.modded) {
      const B = this.base;
      if (m.cutD) { const open = B.freq > 20000, f = open ? 20000 * Math.pow(2, -(m.cutD - m.cut) * 4.5) : B.freq * Math.pow(2, m.cut * 4);
        this.f.frequency.setValueAtTime(clamp(f, 40, 22000), t); if (open) this.f.Q.setValueAtTime(3, t); }
      if (m.pan) this.pan.pan.setValueAtTime(clamp(B.pan + m.pan, -1, 1), t);
      if (m.del) this.ds.gain.setValueAtTime(B.ds + m.del * 1.2, t);
      if (m.rev) this.rs.gain.setValueAtTime(B.rs + m.rev * 1.5, t);
    }
    const off = m && m.start ? Math.min(b.duration * .95, m.start * b.duration) : 0;
    s.start(t, off);
    const node = { s, g, end: t + (b.duration - off) / s.playbackRate.value };
    this.active.push(node); s.onended = () => { const i = this.active.indexOf(node); if (i >= 0) this.active.splice(i, 1); g.disconnect(); };
  }
  choke(time) { for (const n of this.active) if (n.end > time) { try { n.g.gain.setTargetAtTime(0, Math.max(time, ctx.currentTime), .006); n.s.stop(Math.max(time, ctx.currentTime) + .06); } catch (e) {} } }
}
function channel(i) { init(); while (channels.length <= i) channels.push(new Channel()); return channels[i]; }

/* ================= clock ================= */
const RATES = [['1/4', 1], ['1/8', 2], ['1/8T', 3], ['1/16', 4], ['1/16T', 6], ['1/32', 8]];
const S = { bpm: 120, swing: 0, playing: false, loopBars: 4 };
let timer = null, nextT = [], stepN = [], barNext = 0, barN = 0, cb = null;
const events = [];
function start(callbacks) {
  init(); ctx.resume(); cb = callbacks;
  if (S.playing) return; S.playing = true;
  const t0 = ctx.currentTime + .06;
  nextT = new Array(16).fill(t0); stepN = new Array(16).fill(0); barNext = t0; barN = 0;
  timer = setInterval(tick, 20); tick();
}
function stop() { S.playing = false; clearInterval(timer); timer = null; events.length = 0; channels.forEach(c => c.choke(ctx.currentTime)); }
function resetTracks(t) { for (let i = 0; i < nextT.length; i++) { nextT[i] = t; stepN[i] = 0; } }
const barDur = () => 4 * 60 / S.bpm;
// position (in bars, fractional) of time t inside the current loop
function posAt(t) { return (barN - 1) + (t - (barNext - barDur())) / barDur(); }
function tick() {
  if (!S.playing || ctx.state !== 'running') return;
  const ahead = ctx.currentTime + .12;
  if (barNext < ctx.currentTime - .25) { const t = ctx.currentTime + .05; barNext = t; resetTracks(t); }
  for (let guard = 0; guard < 8; guard++) {
    const limit = Math.min(ahead, barNext);
    const pat = cb.pattern();
    if (barN > 0) for (let i = 0; i < pat.tracks.length; i++) {
      const tr = pat.tracks[i], div = RATES[tr.rate][1], sd = 60 / S.bpm / div, len = Math.max(1, tr.bars * 16);
      while (nextT[i] < limit) {
        const n = stepN[i] % len, st = tr.steps[n];
        let t = nextT[i];
        if ((div === 4 || div === 2) && n % 2 === 1) t += S.swing * sd * .5;
        if (st) cb.step(i, n, t, sd, st, posAt(t));
        events.push({ t, i, n, on: !!st });
        stepN[i]++; nextT[i] += sd;
      }
    }
    if (barNext < ahead) {
      const loopPos = barN % S.loopBars;
      const changed = cb.bar(barN, barNext, loopPos);
      if (changed || loopPos === 0) resetTracks(barNext);   // every loop all tracks realign
      events.push({ t: barNext, bar: loopPos });
      barN++; barNext += barDur();
    } else break;
  }
}
function stepAt(i, t, len, rate) { if (!S.playing || nextT[i] == null) return 0; const sd = 60 / S.bpm / RATES[rate][1]; const k = Math.round((t - nextT[i]) / sd) + stepN[i]; return ((k % len) + len) % len; }
function setBpm(b) { S.bpm = clamp(b, 30, 300); if (ctx) applyFX(false); }

/* ================= microphone ================= */
function trimNormalize(buf, maxSec, keepHead) {
  const ch = buf.numberOfChannels, n = buf.length, mono = new Float32Array(n);
  for (let c = 0; c < ch; c++) { const d = buf.getChannelData(c); for (let i = 0; i < n; i++) mono[i] += d[i] / ch; }
  let pk = 0; for (let i = 0; i < n; i++) pk = Math.max(pk, Math.abs(mono[i]));
  const th = pk * .06; let a = 0, b = n - 1;
  if (!keepHead) while (a < n && Math.abs(mono[a]) < th) a++;
  while (b > a && Math.abs(mono[b]) < th * .3) b--;
  a = Math.max(0, a - Math.round(buf.sampleRate * .004)); b = Math.min(n - 1, b + Math.round(buf.sampleRate * .05), a + Math.round(buf.sampleRate * maxSec));
  const len = Math.max(64, b - a), out = new AudioBuffer({ length: len, numberOfChannels: 1, sampleRate: buf.sampleRate }), d = out.getChannelData(0);
  const k = pk > 1e-4 ? .95 / pk : 1;
  for (let i = 0; i < len; i++) d[i] = mono[a + i] * k;
  const fo = Math.min(len, Math.round(buf.sampleRate * .01)); for (let i = 0; i < fo; i++) d[len - 1 - i] *= i / fo;
  return out;
}
async function decodeFile(file) { init(); const ab = await file.arrayBuffer(); return trimNormalize(await ctx.decodeAudioData(ab), 20); }
let mic = null;
async function recStart() {
  init(); await ctx.resume();
  const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
  const src = ctx.createMediaStreamSource(stream), an = ctx.createAnalyser(); an.fftSize = 1024; src.connect(an);
  const mr = new MediaRecorder(stream), chunks = [];
  mr.ondataavailable = e => e.data.size && chunks.push(e.data);
  mic = { stream, an, mr, chunks, t0: performance.now(), buf: new Float32Array(1024), wave: [] };
  mr.start(100);
  return mic;
}
function micLevel() { if (!mic) return 0; mic.an.getFloatTimeDomainData(mic.buf); let m = 0; for (const x of mic.buf) m = Math.max(m, Math.abs(x)); mic.wave.push(m); if (mic.wave.length > 2000) mic.wave.shift(); return m; }
function recStop(raw) {
  return new Promise((res, rej) => {
    if (!mic) return rej(new Error('no mic'));
    const m = mic; mic = null;
    m.mr.onstop = async () => {
      m.stream.getTracks().forEach(t => t.stop());
      try { const ab = await new Blob(m.chunks, { type: m.mr.mimeType }).arrayBuffer(); const b = await ctx.decodeAudioData(ab); res(raw ? b : trimNormalize(b, 10)); }
      catch (e) { rej(e); }
    };
    m.mr.stop();
  });
}
// split a long take into hits (onset detection on an energy envelope)
function slice(buf, maxN = 8) {
  const d = buf.getChannelData(0), sr = buf.sampleRate, hop = Math.round(sr * .005), env = [];
  for (let i = 0; i + hop <= d.length; i += hop) { let e = 0; for (let k = i; k < i + hop; k++) e += d[k] * d[k]; env.push(Math.sqrt(e / hop)); }
  let pk = 0; for (const e of env) pk = Math.max(pk, e);
  const on = [], minGap = Math.round(.09 / .005); let last = -1e9, avg = 0;
  for (let i = 1; i < env.length; i++) {
    avg = avg * .9 + env[i - 1] * .1;
    if (env[i] > pk * .12 && env[i] > avg * 2.2 && i - last > minGap) { on.push(i); last = i; }
  }
  const hits = on.map((s, k) => { const a = Math.max(0, s * hop - Math.round(sr * .006)), b = k + 1 < on.length ? on[k + 1] * hop - Math.round(sr * .004) : d.length; let peak = 0; for (let i = a; i < b; i++) peak = Math.max(peak, Math.abs(d[i])); return { a, b, peak }; });
  hits.sort((x, y) => y.peak - x.peak);
  const keep = hits.slice(0, maxN).sort((x, y) => x.a - y.a);
  return keep.map(h => { const len = Math.min(h.b - h.a, sr * 4), out = new AudioBuffer({ length: Math.max(64, len), numberOfChannels: 1, sampleRate: sr }), o = out.getChannelData(0);
    for (let i = 0; i < len; i++) o[i] = d[h.a + i]; return trimNormalize(out, 4); });
}

/* ================= resample the mix / record the mix ================= */
let mixRec = null;
function mixStart() {
  if (!streamDest || !window.MediaRecorder) return false;
  const types = ['audio/mp4', 'audio/webm;codecs=opus', 'audio/webm', 'audio/ogg'];
  const type = types.find(t => MediaRecorder.isTypeSupported(t)) || '';
  const mr = new MediaRecorder(streamDest.stream, type ? { mimeType: type, audioBitsPerSecond: 256000 } : undefined), chunks = [];
  mr.ondataavailable = e => e.data.size && chunks.push(e.data); mr.start(250);
  mixRec = { mr, chunks, t0: performance.now() }; return true;
}
function mixStop() {
  return new Promise(res => {
    if (!mixRec) return res(null); const m = mixRec; mixRec = null;
    m.mr.onstop = () => { const type = m.mr.mimeType || 'audio/webm'; res({ blob: new Blob(m.chunks, { type }), ext: type.includes('mp4') ? 'm4a' : type.includes('ogg') ? 'ogg' : 'webm', secs: (performance.now() - m.t0) / 1000 }); };
    m.mr.stop();
  });
}
// capture `sec` seconds of the master output straight into a buffer (no codec)
function resample(sec) {
  return new Promise((res, rej) => {
    init(); if (!ctx.createScriptProcessor) return rej(new Error('no'));
    const n = Math.ceil(ctx.sampleRate * sec), out = new Float32Array(n); let w = 0;
    const sp = ctx.createScriptProcessor(4096, 2, 1);
    sp.onaudioprocess = e => { const a = e.inputBuffer.getChannelData(0), b = e.inputBuffer.getChannelData(1); for (let i = 0; i < a.length && w < n; i++) out[w++] = (a[i] + b[i]) / 2;
      if (w >= n) { outG.disconnect(sp); sp.disconnect(); const buf = new AudioBuffer({ length: n, numberOfChannels: 1, sampleRate: ctx.sampleRate }); buf.copyToChannel(out, 0); res(trimNormalize(buf, sec, true)); } };
    outG.connect(sp); sp.connect(ctx.destination);
  });
}
function masterLevel() { if (!analyser) return 0; const b = masterLevel.b || (masterLevel.b = new Float32Array(2048)); analyser.getFloatTimeDomainData(b); let m = 0; for (let i = 0; i < b.length; i += 2) m = Math.max(m, Math.abs(b[i])); return m; }
function spectrum(arr) { if (analyser) analyser.getByteFrequencyData(arr); }

return { PARAMS, SYNTH_KEYS, DIVS, RATES, FX, S, PERF, LFO_BARS, val, display, defaults, init, render, renderSynth, channel, channels, applyFX, start, stop, setBpm, mods,
  decodeFile, recStart, recStop, micLevel, slice, mixStart, mixStop, resample, masterLevel, spectrum, events, resetTracks, barDur, stepAt,
  get ctx() { return ctx; }, get recording() { return !!mixRec; }, get mixT0() { return mixRec ? mixRec.t0 : 0; }, get mic() { return mic; } };
})();
