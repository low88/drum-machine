/* MICROFONIA — app: state, sequencer glue, rack, deck (sound / pads / surface / rhythm / fx), sheets, storage. */
'use strict';
(() => {
const $ = id => document.getElementById(id);
const R = Math.random, pick = a => a[R() * a.length | 0], clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const NT = 8, LETTERS = 'ABCDEFGH', LOOPS = [4, 8, 16, 32], TBARS = [1, 2, 4, 8, 16, 32];
const COLORS = ['#ff6b1a', '#ffd23f', '#3ddc97', '#4cc9f0', '#b388ff', '#ff5d8f', '#e9e4d8', '#8bd3c7'];
const P = Engine.PARAMS;

/* ================= state ================= */
let st;
const samples = new Array(NT).fill(null);
const blankPattern = (loop = 4) => ({ loop, tracks: Array.from({ length: NT }, () => Kit.emptyTrack(loop)) });
function freshTrack(role, i) { return { name: Kit.ROLES[role], role, color: COLORS[i], src: 'mic', p: Object.assign(Engine.defaults(), Kit.synth(role)), mute: false, solo: false, sampleName: null }; }
function freshState() {
  return { v: 1, tracks: Kit.ROLE_KEYS.map((r, i) => freshTrack(r, i)), patterns: Array.from({ length: 8 }, () => blankPattern(4)),
    pat: 0, queued: null, sel: 0, mode: 'on', page: 0, follow: true, deck: 'suono', sub: 'rec', bpm: 120, swing: 0, genre: 'techno',
    fx: Object.assign({}, Engine.FX), evo: { on: false, amt: .4, every: 4, sounds: false },
    pad: { mode: 'play', write: false, repeat: false, rate: 1, tone: false }, surf: { mode: 'filter', latch: false }, seen: {} };
}
const KEY = 'microfonia-v1';
function load() {
  try { const s = JSON.parse(localStorage.getItem(KEY) || 'null'); if (s && s.tracks && s.tracks.length === NT) { st = Object.assign(freshState(), s); st.tracks.forEach(t => t.p = Object.assign(Engine.defaults(), t.p)); return true; } } catch (e) {}
  return false;
}
let saveT = 0;
function save() { clearTimeout(saveT); saveT = setTimeout(() => { try { localStorage.setItem(KEY, JSON.stringify(Object.assign({}, st, { queued: null }))); } catch (e) {} }, 400); }
const DB = {
  open() { return this.p || (this.p = new Promise((res, rej) => { const r = indexedDB.open('microfonia', 1); r.onupgradeneeded = () => { r.result.createObjectStore('s'); }; r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); })); },
  async put(k, v) { const db = await this.open(); return new Promise(r => { const tx = db.transaction('s', 'readwrite'); v == null ? tx.objectStore('s').delete(k) : tx.objectStore('s').put(v, k); tx.oncomplete = r; tx.onerror = r; }); },
  async get(k) { const db = await this.open(); return new Promise(r => { const q = db.transaction('s').objectStore('s').get(k); q.onsuccess = () => r(q.result); q.onerror = () => r(null); }); },
  async keys() { const db = await this.open(); return new Promise(r => { const q = db.transaction('s').objectStore('s').getAllKeys(); q.onsuccess = () => r(q.result); q.onerror = () => r([]); }); },
};
const packBuf = b => b ? { sr: b.sampleRate, d: b.getChannelData(0).slice() } : null;
const unpackBuf = o => { if (!o || !o.d) return null; const b = new AudioBuffer({ length: o.d.length, numberOfChannels: 1, sampleRate: o.sr }); b.copyToChannel(o.d, 0); return b; };
async function storeSample(i) { try { await DB.put('cur' + i, packBuf(samples[i])); } catch (e) {} }
async function restoreSamples() { for (let i = 0; i < NT; i++) { try { samples[i] = unpackBuf(await DB.get('cur' + i)); } catch (e) {} } }
const pat = () => st.patterns[st.pat];
const ptr = i => pat().tracks[i];

/* ================= audio glue ================= */
const renderTok = new Array(NT).fill(0), renderTimers = [];
const preview = new Array(NT).fill(null);   // a buffer to draw for synth tracks
function renderTrack(i, now) {
  if (!Engine.ctx) return;
  clearTimeout(renderTimers[i]);
  const go = async () => {
    const tok = ++renderTok[i], tr = st.tracks[i];
    try {
      const bufs = await Engine.render({ src: tr.src, sample: samples[i], p: tr.p });
      if (tok !== renderTok[i]) return;
      Engine.channel(i).bufs = bufs; preview[i] = bufs[0] || null;
      if (i === st.sel) drawWave();
      renderPlate(i);
    } catch (e) { console.warn(e); }
  };
  if (now) go(); else renderTimers[i] = setTimeout(go, 90);
}
function gateOf(i) { const any = st.tracks.some(t => t.solo), t = st.tracks[i]; return t.mute || (any && !t.solo) ? 0 : 1; }
function applyMix(i) { if (Engine.ctx) Engine.channel(i).apply(st.tracks[i].p, gateOf(i)); }
function audition(i, vel = .9, semis = 0) { boot(); Engine.channel(i).play(Engine.ctx.currentTime + .005, vel, semis, 0); flashPlate(i); }
let booted = false;
function boot() {
  if (booted) { Engine.ctx.resume(); return; }
  booted = true; Engine.init(); Engine.ctx.resume();
  Object.assign(Engine.FX, st.fx); Engine.setBpm(st.bpm); Engine.S.swing = st.swing; Engine.S.loopBars = pat().loop; Engine.applyFX(true);
  for (let i = 0; i < NT; i++) { applyMix(i); renderTrack(i, true); }
}
const seqCallbacks = {
  pattern: pat,
  step(i, n, t, sd, s, pos) {
    const tr = st.tracks[i]; if (gateOf(i) === 0) return;
    if (s.p < 1 && R() > s.p) return;
    const ch = Engine.channel(i), g = Engine.val(tr.p, 'choke'), human = Engine.val(tr.p, 'human'), rr = s.r || 1;
    for (let k = 0; k < rr; k++) {
      const tt = t + k * sd / rr, m = Engine.mods(tr.p, pos + k * sd / rr / Engine.barDur(), i);
      if (g > 0) st.tracks.forEach((o, j) => { if (j !== i && Engine.val(o.p, 'choke') === g) Engine.channel(j).choke(tt); });
      ch.play(tt, s.v * (k ? .78 : 1), s.t, human, m);
    }
  },
  bar(n, t, loopPos) {
    let changed = false;
    if (st.queued != null && (loopPos === 0 || st.queuedNow)) { st.pat = st.queued; st.queued = null; st.queuedNow = false; Engine.S.loopBars = pat().loop; changed = true; dirty.pats = dirty.rack = true; }
    if (st.evo.on && n > 0 && n % st.evo.every === 0) {
      Kit.evolve(pat(), st.tracks.map(t => t.role), st.tracks.map(t => t.mute), st.evo.amt); dirty.rack = true;
      if (st.evo.sounds && R() < st.evo.amt * .6) { const i = R() * NT | 0, tr = st.tracks[i]; if (tr.src === 'synth') tr.p = Object.assign(tr.p, Kit.wilder(tr.p, .15 * st.evo.amt)); else { tr.p.sStart = clamp(tr.p.sStart + (R() - .5) * .06 * st.evo.amt, 0, .9); tr.p.sPitch = clamp(tr.p.sPitch + (R() - .5) * .05 * st.evo.amt, 0, 1); } renderTrack(i, true); if (i === st.sel) dirty.deck = true; }
      save();
    }
    return changed;
  },
};
const dirty = { rack: false, pats: false, deck: false };

/* ================= transport & header ================= */
function play() {
  boot();
  if (Engine.S.playing) { Engine.stop(); $('playBtn').classList.remove('on'); clearCursor(); return; }
  Engine.S.loopBars = pat().loop; Engine.start(seqCallbacks); $('playBtn').classList.add('on');
}
$('playBtn').onclick = play;
document.addEventListener('keydown', e => {
  if (e.target.matches('input,select,textarea')) return;
  if (e.code === 'Space') { e.preventDefault(); play(); }
  const n = '12345678'.indexOf(e.key); if (n >= 0) audition(n);
});
function renderPats() {
  const h = $('pats'); h.innerHTML = '';
  for (let k = 0; k < 8; k++) {
    const b = document.createElement('button'); b.className = 'pat'; b.textContent = LETTERS[k];
    const has = st.patterns[k].tracks.some(t => Object.keys(t.steps).length);
    b.classList.toggle('cur', k === st.pat); b.classList.toggle('queued', k === st.queued); b.classList.toggle('has', has);
    b.title = `Pattern ${LETTERS[k]} · ${st.patterns[k].loop} battute`;
    b.onclick = () => {
      if (k === st.pat) return;
      if (Engine.S.playing) { st.queued = k; st.queuedNow = false; toast(`Pattern ${LETTERS[k]} alla fine del loop · tocca di nuovo per la prossima battuta`); b.ondblclick = null; }
      else { st.pat = k; st.page = 0; Engine.S.loopBars = pat().loop; renderAll(); }
      renderPats(); save();
    };
    b.addEventListener('pointerdown', () => { if (st.queued === k) { st.queuedNow = true; toast('Cambio alla prossima battuta'); } });
    h.appendChild(b);
  }
  const s = $('loopSeg'); s.innerHTML = '';
  LOOPS.forEach(L => { const b = document.createElement('button'); b.textContent = L; b.setAttribute('aria-pressed', pat().loop === L); b.title = L + ' battute'; b.onclick = () => setLoop(L); s.appendChild(b); });
  s.insertAdjacentHTML('beforeend', '<span>batt.</span>');
  renderLcd();
}
function setLoop(L) {
  const p = pat(), old = p.loop; if (L === old) return;
  p.loop = L; Engine.S.loopBars = L;
  p.tracks.forEach(t => {
    if (t.bars === old || t.bars > L) {
      const oldLen = t.bars * 16, nb = Math.min(L, t.bars === old ? L : t.bars);
      if (nb > t.bars) for (let n = oldLen; n < nb * 16; n++) if (!t.steps[n] && t.steps[n % oldLen]) t.steps[n] = Object.assign({}, t.steps[n % oldLen]);
      t.bars = nb;
    }
  });
  if (st.page >= L) st.page = 0;
  toast(L > old ? `Loop di ${L} battute: le battute esistenti sono state ripetute, ora variale` : `Loop di ${L} battute`);
  renderAll(); save();
}
function renderLcd() {
  $('lcdBpm').textContent = st.bpm.toFixed(2);
  $('lcdInfo').textContent = `${LETTERS[st.pat]} · ${pat().loop} BATT · ${(Kit.GENRES[st.genre] || {}).n || ''}`.toUpperCase();
}

/* ================= bar navigator ================= */
const barsC = $('bars');
let curBar = -1;
function drawBars() {
  const dpr = Math.min(2, devicePixelRatio || 1), w = barsC.clientWidth, h = barsC.clientHeight; if (!w) return;
  if (barsC.width !== Math.round(w * dpr)) { barsC.width = Math.round(w * dpr); barsC.height = Math.round(h * dpr); }
  const c = barsC.getContext('2d'); c.setTransform(dpr, 0, 0, dpr, 0, 0); c.clearRect(0, 0, w, h);
  const L = pat().loop, bw = w / L, rh = (h - 6) / NT;
  for (let b = 0; b < L; b++) {
    c.fillStyle = b === st.page ? 'rgba(255,107,26,.22)' : b % 4 === 0 ? 'rgba(255,255,255,.06)' : 'rgba(255,255,255,.03)';
    c.fillRect(b * bw + 1, 0, bw - 2, h);
    for (let i = 0; i < NT; i++) {
      const t = ptr(i), len = t.bars * 16, base = (b % t.bars) * 16; let cnt = 0;
      for (let k = 0; k < 16; k++) if (t.steps[base + k]) cnt++;
      if (!cnt) continue;
      c.fillStyle = st.tracks[i].color; c.globalAlpha = (b >= t.bars ? .35 : .9) * Math.min(1, .25 + cnt / 8);
      const cw = Math.max(2, (bw - 4) * Math.min(1, cnt / 12)); c.fillRect(b * bw + 2, 3 + i * rh, cw, Math.max(1.5, rh - 1.5));
      c.globalAlpha = 1;
    }
  }
  if (Engine.S.playing && curBar >= 0) { const x = (curBar + barFrac()) * bw; c.fillStyle = '#fff'; c.fillRect(x - 1, 0, 2, h); }
  $('pageLbl').textContent = `${st.page + 1}/${L}`;
}
let barT0 = 0;
const barFrac = () => Engine.ctx ? clamp((Engine.ctx.currentTime - barT0) / Engine.barDur(), 0, .999) : 0;
function gotoPage(p) { const L = pat().loop; st.page = (p + L) % L; renderRack(); drawBars(); }
barsC.addEventListener('pointerdown', e => {
  const r = barsC.getBoundingClientRect(), pick2 = ev => gotoPage(clamp(Math.floor((ev.clientX - r.left) / r.width * pat().loop), 0, pat().loop - 1));
  pick2(e); barsC.setPointerCapture(e.pointerId); barsC.onpointermove = ev => { if (ev.buttons) pick2(ev); };
  if (st.follow && Engine.S.playing) { st.follow = false; $('followBtn').setAttribute('aria-pressed', 'false'); }
});
$('pagePrev').onclick = () => gotoPage(st.page - 1); $('pageNext').onclick = () => gotoPage(st.page + 1);
$('followBtn').onclick = () => { st.follow = !st.follow; $('followBtn').setAttribute('aria-pressed', st.follow); save(); };
$('barMenu').onclick = () => openSheet(`Battuta ${st.page + 1}`, body => {
  const b = div('btns'); body.appendChild(b);
  const each = fn => { pat().tracks.forEach((t, i) => fn(t, i)); renderRack(); drawBars(); save(); };
  b.append(
    btn('Copia', () => { clip = pat().tracks.map(t => { const o = {}, base = (st.page % t.bars) * 16; for (let k = 0; k < 16; k++) if (t.steps[base + k]) o[k] = Object.assign({}, t.steps[base + k]); return o; }); toast('Battuta copiata'); closeSheet(); }),
    btn('Incolla', () => { if (!clip) return toast('Niente da incollare'); each((t, i) => { const base = (st.page % t.bars) * 16; for (let k = 0; k < 16; k++) { delete t.steps[base + k]; if (clip[i][k]) t.steps[base + k] = Object.assign({}, clip[i][k]); } }); closeSheet(); }),
    btn('Ripeti su tutto il loop', () => { each(t => { const base = (st.page % t.bars) * 16, src = {}; for (let k = 0; k < 16; k++) if (t.steps[base + k]) src[k] = t.steps[base + k]; for (let b2 = 0; b2 < t.bars; b2++) for (let k = 0; k < 16; k++) { delete t.steps[b2 * 16 + k]; if (src[k]) t.steps[b2 * 16 + k] = Object.assign({}, src[k]); } }); toast('Battuta ripetuta in tutto il loop'); closeSheet(); }, 'hot'),
    btn('Svuota battuta', () => { each(t => { const base = (st.page % t.bars) * 16; for (let k = 0; k < 16; k++) delete t.steps[base + k]; }); closeSheet(); }),
    btn('Fill automatico', () => { each((t, i) => { const role = st.tracks[i].role, base = (st.page % t.bars) * 16; if (!['snare', 'clap', 'tom', 'perc', 'hatC'].includes(role)) return; const from = pick([8, 10, 12]); for (let k = from; k < 16; k++) if (R() < .6) { const s = Kit.step(.45 + (k - from) / (16 - from) * .5); if (R() < .25) s.r = pick([2, 3]); if (role === 'tom') s.t = -Math.round((k - from) * 1.5); t.steps[base + k] = s; } }); closeSheet(); toast('Fill aggiunto'); }),
  );
  body.appendChild(note('“Ripeti su tutto il loop” è il modo più rapido per partire: fai una battuta, ripetila, poi cambia qualcosa nelle battute successive.'));
});
let clip = null;

/* ================= rack ================= */
const MODES = [['on', 'Accendi'], ['v', 'Forza'], ['p', 'Probab.'], ['r', 'Ripeti'], ['t', 'Tono']];
function renderModes() {
  const h = $('modes'); h.innerHTML = '';
  MODES.forEach(([k, n]) => { const b = document.createElement('button'); b.className = 'chip'; b.textContent = n; b.setAttribute('aria-pressed', st.mode === k); b.onclick = () => { st.mode = k; renderModes(); renderRack(); }; h.appendChild(b); });
}
let cells = [], plates = [];
function cellInfo(i, k) { const t = ptr(i), abs = st.page * 16 + k, len = t.bars * 16; return { t, n: abs % len, wrap: abs >= len }; }
function renderRack() {
  const host = $('rack'); host.innerHTML = ''; cells = []; plates = [];
  for (let i = 0; i < NT; i++) {
    const tr = st.tracks[i], row = div('row');
    const pl = document.createElement('button'); pl.className = 'plate'; pl.dataset.i = i; pl.style.setProperty('--c', tr.color);
    row.appendChild(pl); plates.push(pl);
    const steps = div('steps'); steps.style.setProperty('--c', tr.color);
    const rc = [];
    for (let k = 0; k < 16; k++) {
      const { t, n, wrap } = cellInfo(i, k), s = t.steps[n];
      const c = document.createElement('button'); c.className = 'step' + (k % 4 === 0 ? ' beat' : '') + (wrap ? ' wrap' : '');
      c.dataset.i = i; c.dataset.k = k; c.innerHTML = stepInner(s);
      steps.appendChild(c); rc.push(c);
    }
    cells.push(rc); row.appendChild(steps); host.appendChild(row);
    renderPlate(i);
  }
  renderModes(); drawBars();
}
function renderPlate(i) {
  const pl = plates[i]; if (!pl) return; const tr = st.tracks[i];
  const empty = tr.src === 'mic' && !samples[i];
  pl.innerHTML = `<b>${esc(tr.name.slice(0, 7))}</b><small>${tr.src === 'synth' ? '✦ suo' : empty ? '● vuoto' : '🎙 ' + (samples[i] ? samples[i].duration.toFixed(1) + 's' : '')}</small><i class="lvl"></i>`;
  pl.classList.toggle('sel', i === st.sel); pl.classList.toggle('muted', gateOf(i) === 0); pl.classList.toggle('empty', empty);
}
function stepInner(s) {
  if (!s) return '';
  const h = 30 + s.v * 62, op = .35 + s.p * .65;
  let x = `<span class="fill" style="height:${h}%;opacity:${op}"></span>`;
  if (s.r > 1) x += `<span class="rat">${'<i></i>'.repeat(s.r)}</span>`;
  const m = st.mode;
  if (m === 'v') x += `<span class="val">${Math.round(s.v * 100)}</span>`;
  else if (m === 'p') x += `<span class="val">${Math.round(s.p * 100)}</span>`;
  else if (m === 't' || s.t) x += `<span class="val">${s.t > 0 ? '+' : ''}${s.t || (m === 't' ? '0' : '')}</span>`;
  return x;
}
function updateCell(i, k) { const { t, n } = cellInfo(i, k); cells[i][k].innerHTML = stepInner(t.steps[n]); }
function refreshCellsFor(i, n) { for (let k = 0; k < 16; k++) if (cellInfo(i, k).n === n) updateCell(i, k); }
let drag = null;
$('rack').addEventListener('pointerdown', ev => {
  const pl = ev.target.closest('.plate');
  if (pl) {
    const i = +pl.dataset.i; ev.preventDefault(); const t0 = performance.now();
    const lp = setTimeout(() => { st.tracks[i].mute = !st.tracks[i].mute; applyMix(i); renderPlate(i); toast(st.tracks[i].name + (st.tracks[i].mute ? ' muto' : ' attivo')); save(); pl.dataset.lp = 1; }, 480);
    pl.onpointerup = pl.onpointerleave = () => { clearTimeout(lp); if (!pl.dataset.lp && performance.now() - t0 < 480) { selectTrack(i); if (samples[i] || st.tracks[i].src === 'synth') audition(i); } delete pl.dataset.lp; pl.onpointerup = pl.onpointerleave = null; };
    return;
  }
  const c = ev.target.closest('.step'); if (!c) return;
  ev.preventDefault(); boot();
  const i = +c.dataset.i, k = +c.dataset.k, { t, n } = cellInfo(i, k);
  $('rack').setPointerCapture(ev.pointerId);
  let s = t.steps[n];
  drag = { i, k, n, y: ev.clientY, moved: false, start: s ? { v: s.v, p: s.p, t: s.t } : { v: .85, p: 1, t: 0 } };
  if (st.mode === 'on') { if (s) delete t.steps[n]; else { t.steps[n] = s = Kit.step(.85); if (!Engine.S.playing) audition(i, s.v); } drag.paint = !!t.steps[n]; refreshCellsFor(i, n); }
  if (st.mode === 'r') { if (!s) t.steps[n] = Kit.step(); else s.r = s.r >= 4 ? 1 : s.r + 1; refreshCellsFor(i, n); }
  if (i !== st.sel) selectTrack(i, true);
});
$('rack').addEventListener('pointermove', ev => {
  if (!drag) return;
  if (st.mode === 'on') {
    const el = document.elementFromPoint(ev.clientX, ev.clientY), c = el && el.closest('.step');
    if (c && +c.dataset.i === drag.i) { const { t, n } = cellInfo(drag.i, +c.dataset.k); if (!!t.steps[n] !== drag.paint) { if (drag.paint) t.steps[n] = Kit.step(.85); else delete t.steps[n]; refreshCellsFor(drag.i, n); } }
    return;
  }
  const dy = drag.y - ev.clientY; if (Math.abs(dy) > 4) drag.moved = true; if (!drag.moved) return;
  const t = ptr(drag.i); const s = t.steps[drag.n] || (t.steps[drag.n] = Kit.step());
  if (st.mode === 'v') s.v = clamp(drag.start.v + dy / 120, .05, 1);
  if (st.mode === 'p') s.p = clamp(drag.start.p + dy / 120, .05, 1);
  if (st.mode === 't') s.t = clamp(Math.round(drag.start.t + dy / 10), -24, 24);
  refreshCellsFor(drag.i, drag.n);
});
const endDrag = () => {
  if (!drag) return;
  const t = ptr(drag.i);
  if (!drag.moved && st.mode !== 'on' && st.mode !== 'r') {
    const s = t.steps[drag.n], cyc = (v, list) => { const k = list.findIndex(x => Math.abs(x - v) < .01); return list[(k + 1) % list.length]; };
    if (!s) t.steps[drag.n] = Kit.step();
    else if (st.mode === 'v') s.v = cyc(s.v, [1, .75, .5, .25]); else if (st.mode === 'p') s.p = cyc(s.p, [1, .75, .5, .25]); else if (st.mode === 't') s.t = 0;
    refreshCellsFor(drag.i, drag.n);
  }
  const s = t.steps[drag.n];
  if (st.mode === 't' && s && !Engine.S.playing) audition(drag.i, s.v, s.t);
  drag = null; renderPats(); drawBars(); save();
};
$('rack').addEventListener('pointerup', endDrag); $('rack').addEventListener('pointercancel', endDrag);
const cur = new Array(NT).fill(-1);
function clearCursor() { cells.flat().forEach(c => c.classList.remove('now')); cur.fill(-1); }
function flashPlate(i) { const p = plates[i]; if (!p) return; p.classList.add('hit'); clearTimeout(p._t); p._t = setTimeout(() => p.classList.remove('hit'), 90); const pd = document.querySelector(`.pad[data-i="${i}"]`); if (pd) { pd.classList.add('hit'); clearTimeout(pd._t); pd._t = setTimeout(() => pd.classList.remove('hit'), 110); } }
function selectTrack(i, quiet) { st.sel = i; plates.forEach((p, k) => p.classList.toggle('sel', k === i)); if (st.deck === 'suono' || st.deck === 'ritmo') renderDeck(); if (!quiet) save(); }

/* ================= knobs ================= */
const A0 = 135, SW = 270;
function arcD(a0, a1, r = 28) { const p = a => [32 + r * Math.cos(a * Math.PI / 180), 32 + r * Math.sin(a * Math.PI / 180)]; const [x0, y0] = p(a0), [x1, y1] = p(a1); return `M${x0.toFixed(2)} ${y0.toFixed(2)}A${r} ${r} 0 ${a1 - a0 > 180 ? 1 : 0} 1 ${x1.toFixed(2)} ${y1.toFixed(2)}`; }
function knob(o) {
  const w = div('knob'); w.style.setProperty('--c', o.color || st.tracks[st.sel].color);
  w.setAttribute('role', 'slider'); w.tabIndex = 0; w.setAttribute('aria-label', o.label);
  w.innerHTML = `<svg viewBox="0 0 64 64" aria-hidden="true"><path d="${arcD(A0, A0 + SW)}" fill="none" stroke="rgba(255,255,255,.1)" stroke-width="4" stroke-linecap="round"/>
    <path class="arc" fill="none" stroke="var(--c)" stroke-width="4" stroke-linecap="round"/><circle cx="32" cy="32" r="21" fill="#262626"/><circle cx="32" cy="32" r="21" fill="url(#kg)"/>
    <g class="ptr"><line x1="32" y1="14" x2="32" y2="22" stroke="var(--c)" stroke-width="3" stroke-linecap="round"/></g></svg><span class="kl">${o.label}</span><span class="kv"></span>`;
  const arc = w.querySelector('.arc'), ptr2 = w.querySelector('.ptr'), kv = w.querySelector('.kv');
  const q = v => o.steps ? Math.round(v * (o.steps - 1)) / (o.steps - 1) : v;
  const draw = () => { const v = q(o.get()), a = A0 + SW * v; arc.setAttribute('d', v > .003 ? arcD(A0, a) : ''); ptr2.setAttribute('transform', `rotate(${a + 90} 32 32)`); kv.textContent = o.fmt(v); w.setAttribute('aria-valuetext', o.fmt(v)); };
  const set = v => { v = q(clamp(v, 0, 1)); if (v === q(o.get())) return; o.set(v); draw(); };
  let y0 = 0, x0 = 0, v0 = 0, lastTap = 0, moved = false;
  w.addEventListener('pointerdown', e => { e.preventDefault(); w.setPointerCapture(e.pointerId); w.classList.add('drag'); y0 = e.clientY; x0 = e.clientX; v0 = o.get(); moved = false; const now = performance.now(); if (now - lastTap < 280 && o.def != null) { set(o.def); lastTap = 0; } else lastTap = now; });
  w.addEventListener('pointermove', e => { if (!w.hasPointerCapture(e.pointerId)) return; const dist = (y0 - e.clientY) + (e.clientX - x0) * .6; const d = o.steps ? dist / (clamp(160 / (o.steps - 1), 5, 28) * (o.steps - 1)) : dist / 180; if (Math.abs(y0 - e.clientY) + Math.abs(e.clientX - x0) > 3) moved = true; set(v0 + d); });
  w.addEventListener('pointerup', () => { w.classList.remove('drag'); if (o.steps && !moved && o.steps <= 9 && performance.now() - lastTap < 250) { const n = o.steps - 1; set(((Math.round(o.get() * n) + 1) % o.steps) / n); } if (o.done) o.done(); });
  w.addEventListener('pointercancel', () => w.classList.remove('drag'));
  w.addEventListener('keydown', e => { const s = o.steps ? 1 / (o.steps - 1) : (e.shiftKey ? .1 : .02); if (e.key === 'ArrowUp' || e.key === 'ArrowRight') { set(o.get() + s); e.preventDefault(); o.done && o.done(); } if (e.key === 'ArrowDown' || e.key === 'ArrowLeft') { set(o.get() - s); e.preventDefault(); o.done && o.done(); } });
  draw(); w.redraw = draw; return w;
}
document.body.insertAdjacentHTML('afterbegin', '<svg width="0" height="0" style="position:absolute" aria-hidden="true"><defs><radialGradient id="kg" cx=".35" cy=".3" r=".8"><stop offset="0" stop-color="#fff" stop-opacity=".16"/><stop offset=".5" stop-color="#fff" stop-opacity=".02"/><stop offset="1" stop-color="#000" stop-opacity=".35"/></radialGradient></defs></svg>');
function paramKnob(i, k) {
  const d = P[k], tr = st.tracks[i];
  return knob({ label: d.l, def: d.d, steps: d.sel ? d.sel.length : 0, color: tr.color, get: () => tr.p[k], fmt: v => Engine.display(k, v),
    set: v => { tr.p[k] = v; if (d.live) applyMix(i); else renderTrack(i); if (k === 'sStart' || k === 'sLen') drawWave(); },
    done: () => { save(); if (!d.live && !Engine.S.playing) setTimeout(() => audition(i, .85), 140); } });
}
const grid = keys => { const g = div('kgrid'); keys.forEach(k => g.appendChild(paramKnob(st.sel, k))); return g; };
const keysOf = g => Object.keys(P).filter(k => P[k].g === g);

/* ================= helpers ================= */
function div(c) { const d = document.createElement('div'); if (c) d.className = c; return d; }
function btn(txt, on, cls) { const b = document.createElement('button'); b.className = 'key' + (cls ? ' ' + cls : ''); b.textContent = txt; b.onclick = on; return b; }
function note(t) { const p = document.createElement('p'); p.className = 'note'; p.textContent = t; return p; }
function chips(list, cur, on, cls = '') { const h = div('chips ' + cls); list.forEach(([k, n]) => { const b = document.createElement('button'); b.className = 'chip'; b.textContent = n; b.setAttribute('aria-pressed', cur === k); b.onclick = () => on(k); h.appendChild(b); }); return h; }
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
function toast(msg, ms = 2400) { const t = $('toast'); t.textContent = msg; t.hidden = false; clearTimeout(toast.t); toast.t = setTimeout(() => t.hidden = true, ms); }
function openSheet(title, build) { $('sheetTitle').textContent = title; const b = $('sheetBody'); b.innerHTML = ''; build(b); $('sheet').hidden = false; }
function closeSheet() { $('sheet').hidden = true; if (sliceRec) stopSliceRec(true); }
$('sheetClose').onclick = closeSheet;
$('sheet').addEventListener('pointerdown', e => { if (e.target === $('sheet')) closeSheet(); });

/* ================= DECK ================= */
$('deckTabs').addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return; st.deck = b.dataset.d; renderDeck(); save(); });
function renderDeck() {
  $$('#deckTabs button').forEach(b => b.setAttribute('aria-pressed', b.dataset.d === st.deck));
  const d = $('deck'); d.innerHTML = ''; d.className = 'deck d-' + st.deck; surf = null;
  ({ suono: deckSound, pad: deckPad, surf: deckSurf, ritmo: deckRhythm, fx: deckFx })[st.deck](d);
}
const $$ = s => [...document.querySelectorAll(s)];

/* ---------- SUONO ---------- */
let waveC = null, rec = null;
function deckSound(d) {
  const i = st.sel, tr = st.tracks[i];
  d.style.setProperty('--c', tr.color);
  const head = div('ed-head');
  head.innerHTML = `<button class="ed-plate" id="edPlate" style="--c:${tr.color}" aria-label="Prova">▶</button><div class="ed-name"><input id="edName" maxlength="14" value="${esc(tr.name)}" aria-label="Nome"><small>${Kit.ROLES[tr.role]} · traccia ${i + 1}</small></div>`;
  const acts = div('ed-acts');
  acts.append(btn('M', () => { tr.mute = !tr.mute; for (let k = 0; k < NT; k++) { applyMix(k); renderPlate(k); } renderDeck(); save(); }, tr.mute ? 'on' : ''), btn('S', () => { tr.solo = !tr.solo; for (let k = 0; k < NT; k++) { applyMix(k); renderPlate(k); } renderDeck(); save(); }, tr.solo ? 'on' : ''));
  head.appendChild(acts); d.appendChild(head);
  head.querySelector('#edPlate').onclick = () => audition(i);
  head.querySelector('#edName').oninput = e => { tr.name = e.target.value || '—'; renderPlate(i); save(); };
  // source switch
  const srcRow = div('src');
  srcRow.append(chips([['mic', '🎙 Microfono'], ['synth', '✦ Suono suo']], tr.src, k => { if (k === tr.src) return; tr.src = k; st.sub = k === 'mic' ? 'rec' : 'gen'; renderTrack(i, true); renderPlate(i); renderDeck(); save(); setTimeout(() => audition(i), 250); }, 'big'));
  d.appendChild(srcRow);
  const subs = tr.src === 'mic' ? [['rec', 'Registra'], ['campione', 'Campione'], ['colore', 'Colore'], ['mix', 'Mix'], ['movimento', 'Movimento']]
    : [['gen', 'Genera'], ['corpo', 'Corpo'], ['rumore', 'Rumore'], ['metallo', 'Metallo'], ['risonanza', 'Risonanza'], ['campione', 'Campione'], ['colore', 'Colore'], ['mix', 'Mix'], ['movimento', 'Movimento']];
  if (!subs.some(s => s[0] === st.sub)) st.sub = subs[0][0];
  d.appendChild(chips(subs, st.sub, k => { st.sub = k; renderDeck(); save(); }, 'subs'));
  const body = div('ed-body'); d.appendChild(body);
  // waveform with draggable start / end
  if (['rec', 'gen', 'campione'].includes(st.sub)) { waveC = document.createElement('canvas'); waveC.className = 'wave'; body.appendChild(waveC); hookWave(); }
  else waveC = null;
  switch (st.sub) {
    case 'rec': {
      const rb = document.createElement('button'); rb.className = 'recbig' + (rec ? ' on' : ''); rb.id = 'recBig';
      rb.innerHTML = rec ? '<i></i><b>■ STOP</b><small>tocca per fermare</small>' : '<i></i><b>● REGISTRA</b><small>tieni premuto, o tocca per avviare/fermare</small>';
      body.appendChild(rb); hookRecButton(rb, i);
      const b = div('btns');
      const lab = document.createElement('label'); lab.className = 'key'; lab.textContent = 'Carica file'; lab.style.position = 'relative'; lab.style.overflow = 'hidden';
      const inp = document.createElement('input'); inp.type = 'file'; inp.accept = 'audio/*'; inp.style.cssText = 'position:absolute;inset:0;opacity:0';
      inp.onchange = async () => { const f = inp.files[0]; if (!f) return; try { const buf = await Engine.decodeFile(f); setSample(i, buf, f.name.replace(/\.[^.]+$/, '').slice(0, 20)); toast('Caricato: ' + f.name); } catch (e) { toast('Formato audio non supportato'); } };
      lab.appendChild(inp);
      b.append(btn('✂︎ Affetta su più tracce', openSlicer, 'hot'), lab, btn('⟲ Ricampiona il mix', openResample));
      if (samples[i]) b.append(btn('Togli', () => setSample(i, null)));
      body.appendChild(b);
      body.appendChild(note(samples[i] ? `Campione: ${tr.sampleName || 'microfono'} · ${samples[i].duration.toFixed(2)} s. Trascina i bordi gialli sull'onda per scegliere inizio e fine.` : `Idea per “${Kit.ROLES[tr.role]}”: ${Kit.HINTS[tr.role]}. Il silenzio iniziale viene tagliato da solo.`));
      break;
    }
    case 'gen': {
      const b = div('btns');
      b.append(btn('🎲 Nuovo suono', () => { tr.p = Object.assign(tr.p, Kit.synth(tr.role)); renderTrack(i, true); setTimeout(() => audition(i), 200); save(); }, 'hot'),
        btn('Muta un po’', () => { tr.p = Object.assign(tr.p, Kit.wilder(tr.p, .2)); renderTrack(i, true); setTimeout(() => audition(i), 200); save(); }),
        btn('🎙 Campionalo', async () => { boot(); const buf = await Engine.renderSynth(tr.p, false); tr.src = 'mic'; st.sub = 'campione'; setSample(i, buf, 'suono suo'); toast('Ora è un campione: puoi tagliarlo, invertirlo, stirarlo come una registrazione'); }));
      body.appendChild(b);
      const sel = document.createElement('select'); sel.className = 'sel'; sel.innerHTML = Kit.ROLE_KEYS.map(k => `<option value="${k}" ${k === tr.role ? 'selected' : ''}>ricetta: ${Kit.ROLES[k]}</option>`).join('');
      sel.onchange = () => { tr.role = sel.value; tr.p = Object.assign(tr.p, Kit.synth(tr.role)); renderTrack(i, true); setTimeout(() => audition(i), 200); renderDeck(); save(); };
      body.appendChild(sel);
      body.appendChild(note('L’app sintetizza un suono e lo trasforma in campione. “Campionalo” lo congela come registrazione, così puoi lavorarlo come un suono del microfono.'));
      break;
    }
    case 'campione': body.appendChild(grid(keysOf('campione'))); body.appendChild(note('Tono sposta l’intonazione come un campionatore a nastro (più acuto = più corto). Attacco ammorbidisce l’inizio, Coda lo taglia.')); break;
    case 'colore': body.appendChild(grid(keysOf('colore'))); body.appendChild(note('Variazione: ogni colpo è un po’ diverso (tono, inizio, coda). Umano sposta i colpi nel tempo. Bit e Riduci sporcano il campione.')); break;
    case 'mix': body.appendChild(grid(keysOf('mix'))); body.appendChild(note('Spazio ed Eco mandano la traccia al riverbero e al delay. Choke: le tracce dello stesso gruppo si zittiscono a vicenda (hat chiuso/aperto).')); break;
    case 'movimento': body.appendChild(grid(keysOf('movimento'))); body.appendChild(note('Due modulatori sincronizzati alle battute muovono filtro, tono, pan, volume, punto di inizio del campione, eco e spazio. Con periodi da 8–32 battute i loop lunghi cambiano lentamente da soli.')); break;
    default: body.appendChild(grid(keysOf(st.sub))); body.appendChild(note({ corpo: 'Oscillatore con caduta di intonazione: casse, tom, zap.', rumore: 'Rumore filtrato. Più colpi ravvicinati fanno un clap.', metallo: 'Oscillatori metallici: hi‑hat, piatti, campanacci.', risonanza: 'Risuonatori: piastre, tazze, vetro, legno, pelle.' }[st.sub]));
  }
  drawWave();
}
function hookRecButton(rb, i) {
  let t0 = 0, held = false;
  rb.addEventListener('pointerdown', async e => {
    e.preventDefault(); boot();
    if (rec) { stopRec(); return; }
    t0 = performance.now(); held = true;
    try { await Engine.recStart(); rec = { i, t0: performance.now(), hold: true }; $('logoDot').classList.add('rec'); rb.classList.add('on'); rb.querySelector('b').textContent = '● REC'; rb.querySelector('small').textContent = 'rilascia per finire'; }
    catch (err) { held = false; toast(location.protocol === 'https:' || location.hostname === 'localhost' ? 'Microfono non consentito: abilitalo nelle impostazioni del browser' : 'Il microfono funziona solo da https'); }
  });
  const up = () => { if (!held) return; held = false; if (!rec) return; if (performance.now() - t0 > 450) stopRec(); else { rec.hold = false; renderDeck(); } };
  rb.addEventListener('pointerup', up); rb.addEventListener('pointerleave', up); rb.addEventListener('pointercancel', up);
}
async function stopRec() {
  if (!rec) return; const target = rec.i; rec = null; $('logoDot').classList.remove('rec');
  try { const buf = await Engine.recStop(); setSample(target, buf, 'microfono'); toast('Registrato: ' + buf.duration.toFixed(2) + ' s'); }
  catch (e) { toast('Registrazione non riuscita'); }
  if (st.deck === 'suono') renderDeck();
}
function setSample(i, buf, name) {
  samples[i] = buf; const tr = st.tracks[i]; tr.sampleName = buf ? name : null;
  if (buf) { tr.src = 'mic'; Object.assign(tr.p, { sStart: 0, sLen: 1, sDec: 1, sAtk: 0, sRev: 0 }); }
  storeSample(i); renderTrack(i, true); renderPlate(i); save();
  if (st.sel === i && st.deck === 'suono') { renderDeck(); setTimeout(() => audition(i), 220); }
}
function drawWave() {
  const cv = waveC; if (!cv || !cv.isConnected) return;
  const dpr = Math.min(2, devicePixelRatio || 1), w = cv.clientWidth || 300, h = cv.clientHeight || 90;
  if (cv.width !== Math.round(w * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); }
  const c = cv.getContext('2d'); c.setTransform(dpr, 0, 0, dpr, 0, 0); c.clearRect(0, 0, w, h);
  const i = st.sel, tr = st.tracks[i], col = tr.color;
  c.fillStyle = 'rgba(255,255,255,.03)'; c.fillRect(0, 0, w, h);
  if (rec && rec.i === i && Engine.mic) {
    const wv = Engine.mic.wave, n = Math.min(wv.length, w);
    c.fillStyle = '#ff3b3b'; for (let x = 0; x < n; x++) { const m = wv[wv.length - n + x]; c.fillRect(x, h / 2 - m * h * .48, 1, Math.max(1, m * h * .96)); }
    c.font = '700 13px "JetBrains Mono",monospace'; c.fillText('REC ' + ((performance.now() - rec.t0) / 1000).toFixed(1) + ' s', 10, 20); return;
  }
  const b = tr.src === 'synth' ? preview[i] : samples[i];
  if (!b) { c.fillStyle = 'rgba(255,255,255,.35)'; c.font = '13px "JetBrains Mono",monospace'; c.fillText(tr.src === 'synth' ? 'preparo il suono…' : 'nessun campione — registra qualcosa', 10, h / 2 + 4); return; }
  const d = b.getChannelData(0), p = tr.p;
  const showSE = tr.src === 'mic';
  const s0 = showSE ? (p.sRev > .5 ? 1 - (p.sStart + p.sLen * (1 - p.sStart)) : p.sStart) * w : 0, s1 = showSE ? (p.sRev > .5 ? (1 - p.sStart) * w : s0 + p.sLen * (w - s0)) : w;
  c.fillStyle = 'rgba(0,0,0,.45)'; c.fillRect(0, 0, w, h);
  c.fillStyle = col + '22'; c.fillRect(s0, 0, s1 - s0, h);
  for (let x = 0; x < w; x++) { const a = Math.floor(x / w * d.length), e = Math.floor((x + 1) / w * d.length); let m = 0; for (let k = a; k < e; k++) m = Math.max(m, Math.abs(d[k])); c.fillStyle = x >= s0 && x <= s1 ? col : 'rgba(255,255,255,.25)'; c.fillRect(x, h / 2 - m * h * .45, 1, Math.max(1, m * h * .9)); }
  if (showSE) { c.fillStyle = '#ffd23f'; c.fillRect(s0 - 1, 0, 3, h); c.fillRect(s1 - 2, 0, 3, h); c.beginPath(); c.arc(s0, h - 8, 7, 0, 7); c.arc(s1, h - 8, 7, 0, 7); c.fill(); }
  if (playhead && playhead.i === i) { const x = playhead.x(); if (x != null) { c.fillStyle = '#fff'; c.fillRect(x, 0, 1.5, h); } }
}
let playhead = null;
function hookWave() {
  const cv = waveC; let dragH = null;
  cv.addEventListener('pointerdown', e => {
    const tr = st.tracks[st.sel]; boot();
    const r = cv.getBoundingClientRect(), x = (e.clientX - r.left) / r.width, p = tr.p;
    if (tr.src !== 'mic' || !samples[st.sel]) { audition(st.sel); return; }
    const s = p.sStart, en = s + p.sLen * (1 - s);
    dragH = Math.abs(x - s) < .06 ? 's' : Math.abs(x - en) < .06 ? 'e' : null;
    if (!dragH) { audition(st.sel); const t0 = Engine.ctx.currentTime, dur = (en - s) * samples[st.sel].duration / Math.pow(2, Engine.val(p, 'sPitch') / 12); playhead = { i: st.sel, x: () => { const k = (Engine.ctx.currentTime - t0) / dur; return k > 1 ? (playhead = null) : (s + (en - s) * k) * r.width; } }; return; }
    cv.setPointerCapture(e.pointerId);
  });
  cv.addEventListener('pointermove', e => {
    if (!dragH) return; const tr = st.tracks[st.sel], p = tr.p, r = cv.getBoundingClientRect(), x = clamp((e.clientX - r.left) / r.width, 0, 1);
    const s = p.sStart, en = s + p.sLen * (1 - s);
    if (dragH === 's') { const ns = Math.min(x, en - .01); p.sStart = ns; p.sLen = clamp((en - ns) / (1 - ns), .005, 1); }
    else { const ne = Math.max(x, s + .01); p.sLen = clamp((ne - s) / (1 - s), .005, 1); }
    drawWave(); renderTrack(st.sel);
  });
  const up = () => { if (dragH) { dragH = null; save(); setTimeout(() => audition(st.sel), 100); } };
  cv.addEventListener('pointerup', up); cv.addEventListener('pointercancel', up);
}

/* slicer: one long take → many tracks */
let sliceRec = null, slices = [];
function openSlicer() {
  openSheet('Affetta una registrazione', body => {
    body.appendChild(note('Registra una sequenza di suoni diversi, con una piccola pausa fra uno e l’altro (es. pugno sul tavolo, schiocco di dita, “ts”, bicchiere…). Li divido da solo e li metto sulle tracce, a partire da quella selezionata.'));
    const cv = document.createElement('canvas'); cv.className = 'wave tall'; cv.id = 'sliceWave'; body.appendChild(cv);
    const rb = document.createElement('button'); rb.className = 'recbig'; rb.id = 'sliceBtn'; rb.innerHTML = '<i></i><b>● REGISTRA LA SEQUENZA</b><small>fino a 20 secondi · tocca di nuovo per fermare</small>'; body.appendChild(rb);
    const res = div('slices'); res.id = 'sliceRes'; body.appendChild(res);
    rb.onclick = async () => {
      boot();
      if (sliceRec) { await stopSliceRec(); return; }
      try { await Engine.recStart(); sliceRec = { t0: performance.now() }; rb.classList.add('on'); rb.querySelector('b').textContent = '■ FERMA'; $('logoDot').classList.add('rec'); }
      catch (e) { toast('Microfono non disponibile'); }
    };
  });
}
async function stopSliceRec(cancel) {
  const r = sliceRec; if (!r) return; sliceRec = null; $('logoDot').classList.remove('rec');
  try {
    const raw = await Engine.recStop(true); if (cancel) return;
    const mono = new AudioBuffer({ length: raw.length, numberOfChannels: 1, sampleRate: raw.sampleRate }); const md = mono.getChannelData(0);
    for (let c = 0; c < raw.numberOfChannels; c++) { const s = raw.getChannelData(c); for (let k = 0; k < s.length; k++) md[k] += s[k] / raw.numberOfChannels; }
    slices = Engine.slice(mono, NT);
    const res = $('sliceRes'), rb = $('sliceBtn'); if (!res) return;
    rb.classList.remove('on'); rb.querySelector('b').textContent = '● RIFAI';
    if (!slices.length) { res.innerHTML = '<p class="note">Non ho trovato colpi chiari: prova più forte e con pause più lunghe.</p>'; return; }
    res.innerHTML = `<p class="note">${slices.length} suoni trovati. Tocca per ascoltarli, poi assegnali.</p>`;
    const g = div('slicegrid'); res.appendChild(g);
    slices.forEach((b, k) => { const tr = (st.sel + k) % NT; const x = document.createElement('button'); x.className = 'slice'; x.style.setProperty('--c', st.tracks[tr].color); x.innerHTML = `<b>${k + 1}</b><small>→ ${esc(st.tracks[tr].name)}</small><span>${b.duration.toFixed(2)} s</span>`;
      x.onclick = () => { const s = Engine.ctx.createBufferSource(); s.buffer = b; s.connect(Engine.ctx.destination); s.start(); }; g.appendChild(x); });
    const bb = div('btns'); res.appendChild(bb);
    bb.append(btn(`Assegna a ${slices.length} tracce`, () => { slices.forEach((b, k) => setSample((st.sel + k) % NT, b, 'fetta ' + (k + 1))); closeSheet(); renderRack(); toast('Fatto: ogni suono ha la sua traccia'); }, 'hot'));
  } catch (e) { toast('Registrazione non riuscita'); }
}
function openResample() {
  openSheet('Ricampiona il mix', body => {
    body.appendChild(note('Registra quello che sta suonando adesso (con tutti gli effetti) e lo mette nella traccia selezionata come nuovo campione. Ottimo per creare loop, texture e suoni impossibili.'));
    const b = div('btns'); body.appendChild(b);
    [[.25, '1 movimento'], [1, '1 battuta'], [2, '2 battute'], [4, '4 battute']].forEach(([bars, n]) => b.appendChild(btn(n, async () => {
      boot(); if (!Engine.S.playing) play();
      const i = st.sel, sec = bars * Engine.barDur(); closeSheet(); toast(`Ricampiono ${n}…`, sec * 1000 + 800);
      try { const buf = await Engine.resample(sec); setSample(i, buf, 'ricampionato'); st.tracks[i].p.vari = 0; toast('Ricampionato nella traccia ' + st.tracks[i].name); } catch (e) { toast('Questo browser non può ricampionare'); }
    })));
  });
}

/* ---------- PAD ---------- */
const SCALE = [0, 2, 3, 5, 7, 8, 10, 12];
function deckPad(d) {
  const P2 = st.pad;
  const top = div('padbar');
  top.append(chips([['play', 'Suona'], ['rec', '● Tieni = registra']], P2.mode, k => { P2.mode = k; renderDeck(); save(); }));
  const opts = div('chips');
  const tog = (txt, key) => { const b = document.createElement('button'); b.className = 'chip'; b.textContent = txt; b.setAttribute('aria-pressed', !!P2[key]); b.onclick = () => { P2[key] = !P2[key]; renderDeck(); save(); }; return b; };
  opts.append(tog('✎ Scrivi', 'write'), tog('Ripeti', 'repeat'), tog('Tono', 'tone'));
  top.appendChild(opts); d.appendChild(top);
  const g = div('pads');
  for (let k = 0; k < 8; k++) {
    const i = P2.tone ? st.sel : k, tr = st.tracks[i];
    const pd = document.createElement('button'); pd.className = 'pad'; pd.dataset.k = k; pd.dataset.i = i; pd.style.setProperty('--c', tr.color);
    const empty = tr.src === 'mic' && !samples[i];
    pd.innerHTML = P2.tone ? `<b>${SCALE[k] ? '+' + SCALE[k] : '0'}</b><small>${esc(tr.name)}</small>` : `<b>${esc(tr.name)}</b><small>${tr.src === 'synth' ? '✦ suono suo' : empty ? '● vuoto' : '🎙 campione'}</small>`;
    if (empty && !P2.tone) pd.classList.add('empty');
    g.appendChild(pd);
  }
  d.appendChild(g);
  d.appendChild(note(P2.mode === 'rec' ? 'Tieni premuto un pad per registrare col microfono direttamente in quella traccia; rilascia per finire.' :
    'Più in alto premi, più forte suona. Con “Ripeti” tieni il dito: la posizione orizzontale sceglie la velocità (1/8 → 1/32). “Scrivi” registra i colpi nel pattern mentre suona. “Tono” trasforma i pad in note della traccia selezionata.'));
  hookPads(g);
}
const padHold = new Map();
function hookPads(g) {
  g.addEventListener('pointerdown', async e => {
    const pd = e.target.closest('.pad'); if (!pd) return; e.preventDefault(); boot();
    pd.setPointerCapture(e.pointerId);
    const k = +pd.dataset.k, i = +pd.dataset.i, P2 = st.pad;
    if (P2.mode === 'rec' && !P2.tone) {
      try { await Engine.recStart(); rec = { i, t0: performance.now(), pad: true }; pd.classList.add('rec'); $('logoDot').classList.add('rec'); padHold.set(e.pointerId, { rec: true, pd }); } catch (err) { toast('Microfono non disponibile'); }
      return;
    }
    const r = pd.getBoundingClientRect(), vel = () => clamp(1.1 - (e.clientY - r.top) / r.height * .8, .25, 1);
    const semis = P2.tone ? SCALE[k] : 0;
    const hit = (v, t) => { const tr = st.tracks[i]; const tt = t || Engine.ctx.currentTime + .004; Engine.channel(i).play(tt, v, semis, 0, Engine.S.playing ? null : null); flashPlate(i); if (P2.write && Engine.S.playing) writeHit(i, v, semis, tt); };
    const h = { i, k, pd, x: (e.clientX - r.left) / r.width, y: e.clientY, r, v: vel(), semis };
    padHold.set(e.pointerId, h);
    hit(h.v);
    if (P2.repeat) {
      const rates = [2, 4, 8]; const step = () => 60 / st.bpm / rates[clamp(Math.floor(h.x * 3), 0, 2)];
      let next = Engine.ctx.currentTime + step();
      h.timer = setInterval(() => { const now = Engine.ctx.currentTime; while (next < now + .05) { hit(clamp(1.1 - (h.y - r.top) / r.height * .8, .25, 1), next); next += step(); } }, 15);
    }
  });
  g.addEventListener('pointermove', e => { const h = padHold.get(e.pointerId); if (!h || h.rec) return; h.x = clamp((e.clientX - h.r.left) / h.r.width, 0, 1); h.y = e.clientY; });
  const up = e => { const h = padHold.get(e.pointerId); if (!h) return; padHold.delete(e.pointerId); if (h.timer) clearInterval(h.timer); if (h.rec) { h.pd.classList.remove('rec'); stopRec().then(() => { if (st.deck === 'pad') renderDeck(); }); } };
  g.addEventListener('pointerup', up); g.addEventListener('pointercancel', up);
}
function writeHit(i, v, semis, t) {
  const tr = ptr(i), len = tr.bars * 16, lat = (Engine.ctx.outputLatency || Engine.ctx.baseLatency || 0);
  const n = Engine.stepAt(i, t - lat, len, tr.rate);
  const s = Kit.step(v); s.t = semis; tr.steps[n] = s;
  dirty.rack = true;
}

/* ---------- SUPERFICIE (multi-touch performance) ---------- */
const SMODES = [['filter', 'Filtro'], ['repeat', 'Ripeti'], ['reverse', 'Inverso'], ['freeze', 'Congela'], ['tape', 'Nastro'], ['scratch', 'Scratch'], ['crush', 'Crush']];
let surf = null;
function deckSurf(d) {
  const top = div('padbar');
  top.append(chips(SMODES, st.surf.mode, k => { surfRelease(true); st.surf.mode = k; renderDeck(); save(); }));
  const lt = document.createElement('button'); lt.className = 'chip'; lt.textContent = '🔒 Blocca'; lt.setAttribute('aria-pressed', st.surf.latch); lt.onclick = () => { st.surf.latch = !st.surf.latch; if (!st.surf.latch) surfRelease(true); renderDeck(); save(); };
  top.appendChild(lt); d.appendChild(top);
  const cv = document.createElement('canvas'); cv.className = 'surf'; d.appendChild(cv);
  d.appendChild(note({ filter: '1 dito: orizzontale = filtro passa‑basso ↔ passa‑alto, verticale = risonanza.', repeat: '1 dito: orizzontale = lunghezza della ripetizione (2 movimenti → 1/32), verticale = intonazione.', reverse: 'Come Ripeti, ma al contrario.', freeze: 'Congela l’ultimo istante in granelli: orizzontale = dimensione del granello.', tape: 'Poggia il dito: il nastro rallenta fino a fermarsi. Più in basso = frenata più lunga.', scratch: 'Trascina avanti e indietro come un vinile; tieni fermo il dito per fermare il disco.', crush: 'Orizzontale = quantità di distruzione digitale.' }[st.surf.mode] + ' 2° dito ovunque: Spazio (orizzontale = riverbero, verticale = eco). Con “Blocca” l’effetto resta quando alzi le dita.'));
  surf = { cv, touches: new Map(), trails: [], first: null, last: null };
  hookSurf(cv);
}
function surfRelease(all) {
  const E = Engine.PERF;
  E.off(); E.xy(null); E.crush(0); E.wash(0, 0);
  if (surf) { surf.first = null; if (all) surf.touches.clear(); }
}
function hookSurf(cv) {
  const pos = e => { const r = cv.getBoundingClientRect(); return { x: clamp((e.clientX - r.left) / r.width, 0, 1), y: clamp((e.clientY - r.top) / r.height, 0, 1) }; };
  const E = Engine.PERF, sr = () => Engine.ctx.sampleRate, beat = () => 60 / st.bpm;
  const lens = [2, 1, .5, .25, .125, .0625];
  const apply = (t, first) => {
    const m = st.surf.mode, x = t.x, y = 1 - t.y;
    if (!first) { E.wash(x, y); return; }
    switch (m) {
      case 'filter': E.xy(x, y); break;
      case 'repeat': case 'reverse': { const L = lens[clamp(Math.floor(x * lens.length), 0, lens.length - 1)] * beat() * sr(), rate = Math.pow(2, (y - .5) * 2); if (!t.on) { E.on(m, { len: L, rate }); t.on = 1; } else E.set({ len: L, rate }); break; }
      case 'freeze': { const gr = .015 + x * x * .4; if (!t.on) { E.on('freeze', { grain: gr }); t.on = 1; } else E.set({ grain: gr }); break; }
      case 'tape': if (!t.on) { E.on('tape', { time: .15 + (1 - y) * 2.2 }); t.on = 1; } break;
      case 'scratch': { if (!t.on) { E.on('scratch', { rate: 0 }); t.on = 1; } const now = performance.now(), dt = Math.max(8, now - (t.lt || now - 16)); const v = (t.x - (t.lx == null ? t.x : t.lx)) / dt * 1000; E.set({ rate: clamp(v * 1.6, -4, 4) }); t.lx = t.x; t.lt = now; break; }
      case 'crush': E.crush(x); break;
    }
  };
  cv.addEventListener('pointerdown', e => {
    e.preventDefault(); boot(); cv.setPointerCapture(e.pointerId);
    const p = pos(e), t = Object.assign(p, { id: e.pointerId, t0: performance.now() });
    if (!surf.first || !surf.touches.has(surf.first)) { surf.first = e.pointerId; if (st.surf.latch) E.off(); }
    surf.touches.set(e.pointerId, t); apply(t, surf.first === e.pointerId);
  });
  cv.addEventListener('pointermove', e => { const t = surf && surf.touches.get(e.pointerId); if (!t) return; const p = pos(e); t.x = p.x; t.y = p.y; apply(t, surf.first === e.pointerId); surf.trails.push({ x: p.x, y: p.y, a: 1, c: surf.first === e.pointerId ? '#ff6b1a' : '#4cc9f0' }); if (surf.trails.length > 160) surf.trails.shift(); });
  const up = e => {
    if (!surf) return; const t = surf.touches.get(e.pointerId); if (!t) return; surf.touches.delete(e.pointerId);
    if (st.surf.latch) return;
    if (surf.first === e.pointerId) { const m = st.surf.mode; if (m === 'filter') E.xy(null); else if (m === 'crush') E.crush(0); else E.off(); surf.first = null; }
    else E.wash(0, 0);
  };
  cv.addEventListener('pointerup', up); cv.addEventListener('pointercancel', up);
}
const spec = new Uint8Array(1024);
function drawSurf() {
  if (!surf || !surf.cv.isConnected) return;
  const cv = surf.cv, dpr = Math.min(2, devicePixelRatio || 1), w = cv.clientWidth, h = cv.clientHeight; if (!w) return;
  if (cv.width !== Math.round(w * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); }
  const c = cv.getContext('2d'); c.setTransform(dpr, 0, 0, dpr, 0, 0);
  c.fillStyle = 'rgba(14,14,14,.35)'; c.fillRect(0, 0, w, h);
  Engine.spectrum(spec);
  const n = 96; for (let k = 0; k < n; k++) { const a = Math.floor(Math.pow(k / n, 2) * 700), v = spec[a] / 255; c.fillStyle = `hsla(${20 + k * 2.2},90%,${35 + v * 30}%,${.12 + v * .5})`; const bw = w / n; c.fillRect(k * bw, h - v * h * .9, bw - 1, v * h * .9); }
  c.strokeStyle = 'rgba(255,255,255,.06)'; c.lineWidth = 1;
  for (let k = 1; k < 6; k++) { c.beginPath(); c.moveTo(w * k / 6, 0); c.lineTo(w * k / 6, h); c.stroke(); c.beginPath(); c.moveTo(0, h * k / 6); c.lineTo(w, h * k / 6); c.stroke(); }
  for (const p of surf.trails) { p.a *= .93; c.fillStyle = p.c; c.globalAlpha = p.a * .6; c.beginPath(); c.arc(p.x * w, p.y * h, 4 + (1 - p.a) * 22, 0, 7); c.fill(); }
  c.globalAlpha = 1; surf.trails = surf.trails.filter(p => p.a > .03);
  const lv = Engine.masterLevel();
  for (const [id, t] of surf.touches) {
    const first = id === surf.first, col = first ? '#ff6b1a' : '#4cc9f0', R2 = 26 + lv * 40;
    const g = c.createRadialGradient(t.x * w, t.y * h, 2, t.x * w, t.y * h, R2 * 2); g.addColorStop(0, col); g.addColorStop(1, 'rgba(0,0,0,0)');
    c.fillStyle = g; c.beginPath(); c.arc(t.x * w, t.y * h, R2 * 2, 0, 7); c.fill();
    c.strokeStyle = '#fff'; c.lineWidth = 2; c.beginPath(); c.arc(t.x * w, t.y * h, R2 * .6, 0, 7); c.stroke();
    c.fillStyle = 'rgba(255,255,255,.8)'; c.font = '700 11px "JetBrains Mono",monospace'; c.fillText(first ? SMODES.find(m => m[0] === st.surf.mode)[1].toUpperCase() : 'SPAZIO', t.x * w + R2, t.y * h - R2);
  }
  c.fillStyle = 'rgba(255,255,255,.35)'; c.font = '11px "JetBrains Mono",monospace';
  if (!surf.touches.size) c.fillText(st.surf.latch && surf.first == null ? 'tocca e trascina · più dita' : 'tocca e trascina · più dita', 10, 18);
}

/* ---------- RITMO ---------- */
const euc = { k: 4, rot: 0 };
function deckRhythm(d) {
  const i = st.sel, tr = st.tracks[i], t = () => ptr(i);
  d.style.setProperty('--c', tr.color);
  const h = div('ed-head'); h.innerHTML = `<button class="ed-plate" style="--c:${tr.color}">▶</button><div class="ed-name"><b>${esc(tr.name)}</b><small>ritmo della traccia nel pattern ${LETTERS[st.pat]}</small></div>`; h.querySelector('button').onclick = () => audition(i); d.appendChild(h);
  const lab = div('lbl'); lab.textContent = 'Lunghezza della traccia (battute)'; d.appendChild(lab);
  d.appendChild(chips(TBARS.filter(b => b <= 32).map(b => [b, String(b)]), t().bars, b => { const tt = t(), old = tt.bars * 16; if (b > tt.bars) for (let n = old; n < b * 16; n++) if (!tt.steps[n] && tt.steps[n % old]) tt.steps[n] = Object.assign({}, tt.steps[n % old]); tt.bars = b; renderRack(); renderDeck(); save(); }));
  const g = div('kgrid'); d.appendChild(g);
  g.appendChild(knob({ label: 'Velocità', steps: Engine.RATES.length, color: tr.color, get: () => t().rate / (Engine.RATES.length - 1), fmt: v => Engine.RATES[Math.round(v * (Engine.RATES.length - 1))][0], set: v => { t().rate = Math.round(v * (Engine.RATES.length - 1)); }, done: save, def: 3 / 5 }));
  g.appendChild(knob({ label: 'Colpi', steps: 17, color: tr.color, get: () => euc.k / 16, fmt: v => Math.round(v * 16) + '/16', set: v => { euc.k = Math.round(v * 16); } }));
  g.appendChild(knob({ label: 'Rotazione', steps: 16, color: tr.color, get: () => euc.rot / 15, fmt: v => Math.round(v * 15) + '', set: v => { euc.rot = Math.round(v * 15); } }));
  const b = div('btns'); d.appendChild(b);
  const apply = fn => { fn(t()); renderRack(); renderPats(); save(); };
  b.append(
    btn('Euclideo in ogni battuta', () => apply(tt => { const e = Kit.euclid(euc.k, 16, euc.rot); for (let bb = 0; bb < tt.bars; bb++) for (let k = 0; k < 16; k++) { const n = bb * 16 + k; if (e[k]) tt.steps[n] = tt.steps[n] || Kit.step(.85); else delete tt.steps[n]; } })),
    btn(`Genera (${Kit.GENRES[st.genre].n})`, () => { pat().tracks[i] = Kit.rhythm(tr.role, st.genre, t().bars); renderRack(); renderPats(); save(); }, 'hot'),
    btn('Casuale', () => apply(tt => { tt.steps = {}; for (let n = 0; n < tt.bars * 16; n++) if (R() < .28) { const s = Kit.step(.4 + R() * .6); s.p = R() < .2 ? .5 + R() * .5 : 1; s.r = R() < .08 ? pick([2, 3, 4]) : 1; tt.steps[n] = s; } })),
    btn('← Sposta', () => apply(tt => { const len = tt.bars * 16, o = {}; for (const k in tt.steps) o[(+k - 1 + len) % len] = tt.steps[k]; tt.steps = o; })),
    btn('Sposta →', () => apply(tt => { const len = tt.bars * 16, o = {}; for (const k in tt.steps) o[(+k + 1) % len] = tt.steps[k]; tt.steps = o; })),
    btn('Umanizza', () => apply(tt => { for (const k in tt.steps) tt.steps[k].v = clamp(tt.steps[k].v + (R() - .5) * .35, .2, 1); })),
    btn('Svuota', () => apply(tt => { tt.steps = {}; })),
  );
  d.appendChild(note('Ogni traccia può durare da 1 a 32 battute e andare a una velocità diversa: le tracce corte si ripetono dentro il loop lungo, quelle a velocità diverse si sfasano (poliritmi). A ogni giro del loop tutto si riallinea.'));
}

/* ---------- EFFETTI ---------- */
const pc = v => Math.round(v * 100) + '%';
function fxKnob(label, key, fmt, steps, rebuild) { return knob({ label, steps, color: '#e9e4d8', def: Engine.FX[key], get: () => st.fx[key], fmt, set: v => { st.fx[key] = v; Engine.FX[key] = v; Engine.applyFX(!!rebuild); }, done: save }); }
function deckFx(d) {
  const sec = t => { const s = div('lbl'); s.textContent = t; return s; };
  d.appendChild(sec('Spazio · riverbero'));
  const a = div('kgrid'); d.appendChild(a);
  a.append(fxKnob('Dimensione', 'size', v => (.25 + v * v * 7.5).toFixed(1) + ' s', 0, true), fxKnob('Smorzam.', 'damp', pc, 0, true), fxKnob('Pre‑delay', 'pre', v => Math.round(v * 150) + ' ms'), fxKnob('Metallo', 'tub', pc, 0, true), fxKnob('Livello', 'revLvl', pc));
  d.appendChild(sec('Eco · delay'));
  const b = div('kgrid'); d.appendChild(b); const nd = Engine.DIVS.length;
  b.append(knob({ label: 'Tempo', steps: nd, color: '#e9e4d8', get: () => st.fx.dDiv / (nd - 1), fmt: v => Engine.DIVS[Math.round(v * (nd - 1))][0], set: v => { st.fx.dDiv = Engine.FX.dDiv = Math.round(v * (nd - 1)); Engine.applyFX(); }, done: save }),
    fxKnob('Ripetiz.', 'dFb', pc), fxKnob('Tono', 'dTone', pc), fxKnob('Nastro', 'dWow', pc),
    knob({ label: 'Ping‑pong', steps: 2, color: '#e9e4d8', get: () => st.fx.dPing ? 1 : 0, fmt: v => v ? 'sì' : 'no', set: v => { st.fx.dPing = Engine.FX.dPing = v ? 1 : 0; Engine.applyFX(); }, done: save }), fxKnob('Livello', 'delLvl', pc));
  d.appendChild(sec('Uscita'));
  const c = div('kgrid'); d.appendChild(c);
  c.append(fxKnob('Pressione', 'press', pc), fxKnob('Saturaz.', 'sat', pc), fxKnob('Filtro DJ', 'dj', v => v < .48 ? 'LP ' + Math.round((.48 - v) / .48 * 100) : v > .52 ? 'HP ' + Math.round((v - .52) / .48 * 100) : 'aperto'), fxKnob('Volume', 'master', pc));
  d.appendChild(note('Doppio tocco su una manopola: torna al valore iniziale. Ogni traccia decide quanto mandare a Spazio ed Eco dalla scheda Mix.'));
}

/* ================= header sheets ================= */
$('genreBtn').onclick = () => openSheet('Genere', body => {
  body.appendChild(note(`Genera il ritmo di tutte le tracce per il pattern ${LETTERS[st.pat]} (${pat().loop} battute), con variazioni, fill alla fine delle frasi e uno stacco nei loop lunghi. I tuoi suoni restano.`));
  const g = div('genres'); body.appendChild(g);
  Object.entries(Kit.GENRES).forEach(([k, G]) => {
    const b = document.createElement('button'); b.className = 'genre' + (k === st.genre ? ' cur' : '');
    b.innerHTML = `<b>${G.n}</b><small>${G.d} · ${G.bpm[0]}–${G.bpm[1]} bpm</small>`;
    b.onclick = () => { boot(); applyGenre(k); closeSheet(); };
    g.appendChild(b);
  });
  const bb = div('btns'); body.appendChild(bb);
  bb.append(btn('Svuota pattern', () => { pat().tracks = pat().tracks.map(() => Kit.emptyTrack(pat().loop)); renderAll(); save(); closeSheet(); }));
  body.appendChild(div('lbl')).textContent = `Copia il pattern ${LETTERS[st.pat]} in…`;
  const cp = div('btns'); body.appendChild(cp);
  for (let k = 0; k < 8; k++) if (k !== st.pat) cp.appendChild(btn(LETTERS[k], () => { st.patterns[k] = JSON.parse(JSON.stringify(pat())); renderPats(); save(); toast('Copiato in ' + LETTERS[k]); }));
});
function applyGenre(k, keepTempo) {
  const G = Kit.GENRES[k]; st.genre = k;
  pat().tracks = st.tracks.map(t => Kit.rhythm(t.role, k, pat().loop));
  if (!keepTempo) {
    st.bpm = Math.round(G.bpm[0] + R() * (G.bpm[1] - G.bpm[0])); st.swing = +(G.swing[0] + R() * (G.swing[1] - G.swing[0])).toFixed(2);
    Object.assign(st.fx, G.fx); Object.assign(Engine.FX, st.fx); Engine.setBpm(st.bpm); Engine.S.swing = st.swing; Engine.applyFX(true);
  }
  toast(`${G.n}: ritmo di ${pat().loop} battute generato`);
  renderAll(); save();
}
function renderEvo() { $('evoBtn').setAttribute('aria-pressed', !!st.evo.on); }
$('evoBtn').onclick = () => openSheet('Evoluzione', body => {
  const kg = div('kgrid'); body.appendChild(kg);
  kg.append(
    knob({ label: 'Attiva', steps: 2, color: '#3ddc97', get: () => st.evo.on ? 1 : 0, fmt: v => v ? 'sì' : 'no', set: v => { st.evo.on = !!v; renderEvo(); }, done: save }),
    knob({ label: 'Intensità', color: '#3ddc97', def: .4, get: () => st.evo.amt, fmt: pc, set: v => { st.evo.amt = v; }, done: save }),
    knob({ label: 'Ogni', steps: 5, color: '#3ddc97', get: () => [1, 2, 4, 8, 16].indexOf(st.evo.every) / 4, fmt: v => [1, 2, 4, 8, 16][Math.round(v * 4)] + ' batt.', set: v => { st.evo.every = [1, 2, 4, 8, 16][Math.round(v * 4)]; }, done: save }),
    knob({ label: 'Suoni', steps: 2, color: '#3ddc97', get: () => st.evo.sounds ? 1 : 0, fmt: v => v ? 'si muovono' : 'fermi', set: v => { st.evo.sounds = !!v; }, done: save }));
  body.appendChild(note('Il ritmo cambia un po’ da solo ogni N battute: colpi che appaiono e spariscono, ripetizioni, accenti, note. Con “Suoni” anche i campioni scivolano lentamente (inizio e tono).'));
});
$('lcd').onclick = () => openSheet('Tempo', body => {
  const f = document.createElement('label'); f.className = 'field'; f.innerHTML = 'BPM esatti<input id="bpmIn" type="number" inputmode="decimal" min="30" max="300" step="0.01">'; body.appendChild(f);
  const inp = f.querySelector('input'); inp.value = st.bpm.toFixed(2);
  const setB = b => { st.bpm = +clamp(b, 30, 300).toFixed(2); Engine.setBpm(st.bpm); inp.value = st.bpm.toFixed(2); renderLcd(); save(); };
  inp.onchange = () => setB(parseFloat(inp.value.replace(',', '.')) || st.bpm);
  const b = div('btns'); body.appendChild(b);
  [-1, -.1, .1, 1].forEach(dd => b.appendChild(btn((dd > 0 ? '+' : '−') + Math.abs(dd), () => setB(st.bpm + dd))));
  b.appendChild(btn('Tap', tap, 'hot'));
  const g = div('kgrid'); body.appendChild(g);
  g.appendChild(knob({ label: 'Swing', color: '#ffd23f', def: 0, get: () => st.swing, fmt: v => Math.round(50 + v * 25) + '%', set: v => { st.swing = v; Engine.S.swing = v; }, done: save }));
  g.appendChild(knob({ label: 'BPM', color: '#ffd23f', get: () => (st.bpm - 30) / 270, fmt: () => st.bpm.toFixed(1), set: v => setB(Math.round(30 + v * 270)) }));
});
let taps = [];
function tap() { const now = performance.now(); taps = taps.filter(t => now - t < 2500); taps.push(now); if (taps.length >= 3) { const iv = []; for (let k = 1; k < taps.length; k++) iv.push(taps[k] - taps[k - 1]); st.bpm = +(60000 / (iv.reduce((a, b) => a + b) / iv.length)).toFixed(2); Engine.setBpm(st.bpm); renderLcd(); save(); const i = $('bpmIn'); if (i) i.value = st.bpm.toFixed(2); } }

/* sessions */
$('sessBtn').onclick = () => openSheet('Sessioni', async body => {
  const f = document.createElement('label'); f.className = 'field'; f.innerHTML = 'Nome<input id="sessName" maxlength="24" placeholder="la mia sessione">'; body.appendChild(f);
  const b = div('btns'); body.appendChild(b);
  b.append(btn('💾 Salva (anche i campioni)', async () => { const n = ($('sessName').value || '').trim() || 'Sessione ' + new Date().toLocaleString('it-IT').slice(0, 16); await DB.put('sess:' + n, { name: n, date: Date.now(), st: JSON.parse(JSON.stringify(Object.assign({}, st, { queued: null }))), samples: samples.map(packBuf) }); toast('Salvata: ' + n); closeSheet(); }, 'hot'),
    btn('✚ Nuova vuota', () => { if (Engine.S.playing) play(); st = freshState(); samples.fill(null); for (let i = 0; i < NT; i++) storeSample(i); Engine.setBpm(st.bpm); Object.assign(Engine.FX, st.fx); Engine.applyFX(true); if (Engine.ctx) for (let i = 0; i < NT; i++) { applyMix(i); renderTrack(i, true); } renderAll(); save(); closeSheet(); toast('Nuova sessione'); }));
  const list = div('list'); body.appendChild(list);
  const keys = (await DB.keys()).filter(k => String(k).startsWith('sess:'));
  if (!keys.length) list.appendChild(note('Nessuna sessione salvata.'));
  for (const k of keys) {
    const s = await DB.get(k); if (!s) continue;
    const row = div('srow'); row.innerHTML = `<div><b>${esc(s.name)}</b><small>${new Date(s.date).toLocaleString('it-IT')}</small></div>`;
    row.append(btn('Apri', async () => { if (Engine.S.playing) play(); st = Object.assign(freshState(), s.st); st.tracks.forEach(t => t.p = Object.assign(Engine.defaults(), t.p)); s.samples.forEach((o, i) => { samples[i] = unpackBuf(o); storeSample(i); }); Object.assign(Engine.FX, st.fx); Engine.setBpm(st.bpm); Engine.S.swing = st.swing; Engine.applyFX(true); if (Engine.ctx) for (let i = 0; i < NT; i++) { applyMix(i); renderTrack(i, true); } renderAll(); save(); closeSheet(); toast('Aperta: ' + s.name); }, 'hot'),
      btn('✕', async () => { await DB.put(k, null); row.remove(); }));
    list.appendChild(row);
  }
});

/* mix recording */
$('recBtn').onclick = async () => {
  boot();
  if (Engine.recording) {
    const r = await Engine.mixStop(); $('recBtn').setAttribute('aria-pressed', 'false'); if (!r) return;
    const url = URL.createObjectURL(r.blob), name = 'microfonia-' + new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '') + '.' + r.ext;
    openSheet('Registrazione', body => {
      const au = document.createElement('audio'); au.controls = true; au.src = url; body.appendChild(au);
      body.appendChild(note(r.secs.toFixed(1) + ' s · ' + (r.blob.size / 1048576).toFixed(1) + ' MB · ' + r.ext.toUpperCase()));
      const b = div('btns'); body.appendChild(b);
      b.appendChild(btn('Condividi / Salva', async () => { const file = new File([r.blob], name, { type: r.blob.type }); if (navigator.canShare && navigator.canShare({ files: [file] })) { try { await navigator.share({ files: [file], title: 'Microfonia' }); return; } catch (e) { if (e.name === 'AbortError') return; } } const a = document.createElement('a'); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove(); }, 'hot'));
      const a = document.createElement('a'); a.className = 'key'; a.href = url; a.download = name; a.textContent = 'Scarica'; b.appendChild(a);
    });
    return;
  }
  if (!Engine.mixStart()) { toast('Questo browser non può registrare l’uscita'); return; }
  $('recBtn').setAttribute('aria-pressed', 'true'); toast('Registrazione del mix avviata');
  if (!Engine.S.playing) play();
};

/* ================= animation loop ================= */
const lcdBars = [...document.querySelectorAll('#lcdBars i')];
let lastBarsDraw = 0;
function frame(now) {
  requestAnimationFrame(frame);
  if (Engine.ctx) {
    const t = Engine.ctx.currentTime, ev = Engine.events; let k = 0;
    while (k < ev.length && ev[k].t <= t) {
      const e = ev[k++];
      if (e.bar != null) { curBar = e.bar; barT0 = e.t; if (st.follow && st.page !== e.bar) { st.page = e.bar; renderRack(); } continue; }
      if (e.i >= NT || !cells[e.i]) continue;
      const tr = ptr(e.i), show = Math.floor(e.n / 16) === st.page % tr.bars, kk = e.n % 16;
      if (cur[e.i] >= 0) cells[e.i][cur[e.i]].classList.remove('now');
      cur[e.i] = show ? kk : -1; if (show) cells[e.i][kk].classList.add('now');
      if (e.on) flashPlate(e.i);
    }
    if (k) ev.splice(0, k);
    if (ev.length > 6000) ev.splice(0, ev.length - 1500);
    const lv = Engine.masterLevel(); lcdBars.forEach((b, j) => b.classList.toggle('on', lv > (j + 1) / 7));
    if (Engine.S.playing && curBar >= 0) { const f = barFrac(); $('lcdPos').textContent = `${curBar + 1}.${Math.floor(f * 4) + 1}`; }
    else $('lcdPos').textContent = '—';
    if (Engine.recording) $('lcdPos').textContent = 'REC ' + ((performance.now() - Engine.mixT0) / 1000).toFixed(0) + 's';
    if (now - lastBarsDraw > 60) { lastBarsDraw = now; drawBars(); for (let i = 0; i < NT; i++) { const l = plates[i] && plates[i].querySelector('.lvl'); if (l && Engine.channels[i]) l.style.opacity = Math.min(1, Engine.channels[i].level() * 3); } }
  }
  if (dirty.rack) { dirty.rack = false; renderRack(); }
  if (dirty.pats) { dirty.pats = false; renderPats(); }
  if (dirty.deck) { dirty.deck = false; if (!document.querySelector('.knob.drag') && st.deck !== 'surf') renderDeck(); }
  if (rec || sliceRec) {
    Engine.micLevel();
    if (rec) { drawWave(); if (performance.now() - rec.t0 > 10000) stopRec(); }
    if (sliceRec) { const cv = $('sliceWave'); if (cv && Engine.mic) { const dpr = 2, w = cv.clientWidth, h = cv.clientHeight; cv.width = w * dpr; cv.height = h * dpr; const c = cv.getContext('2d'); c.scale(dpr, dpr); const wv = Engine.mic.wave, n = Math.min(wv.length, w); c.fillStyle = '#ff3b3b'; for (let x = 0; x < n; x++) { const m = wv[wv.length - n + x]; c.fillRect(x, h / 2 - m * h * .48, 1, Math.max(1, m * h * .96)); } c.font = '700 12px "JetBrains Mono",monospace'; c.fillText(((performance.now() - sliceRec.t0) / 1000).toFixed(1) + ' s', 8, 16); }
      if (performance.now() - sliceRec.t0 > 20000) stopSliceRec(); }
  } else if (playhead) drawWave();
  if (st.deck === 'surf') drawSurf();
}
function renderAll() { renderPats(); renderRack(); renderDeck(); renderLcd(); renderEvo(); $('followBtn').setAttribute('aria-pressed', st.follow); }

/* ================= boot ================= */
(async () => {
  const had = load();
  if (!had) st = freshState();
  Object.assign(Engine.FX, st.fx); Engine.S.bpm = st.bpm; Engine.S.swing = st.swing; Engine.S.loopBars = pat().loop;
  renderAll();
  requestAnimationFrame(frame);
  await restoreSamples(); for (let i = 0; i < NT; i++) renderPlate(i); if (st.deck === 'suono') renderDeck();
  const unlock = () => { boot(); window.removeEventListener('pointerdown', unlock, true); };
  window.addEventListener('pointerdown', unlock, true);
  if (!st.seen.intro) openSheet('Benvenuto in MICROFONIA', body => {
    body.appendChild(note('Una drum machine dove ogni suono è un campione. 8 tracce: per ognuna registri col microfono (tieni premuto ● REGISTRA) oppure lasci che l’app crei un suono suo, che diventa comunque un campione da tagliare, invertire, intonare e modulare.'));
    body.appendChild(note('I loop durano 4, 8, 16 o 32 battute. Sotto trovi i Pad per suonare col dito, la Superficie per gli effetti a più dita, il Ritmo e gli Effetti.'));
    const b = div('btns'); body.appendChild(b);
    b.append(btn('🎙 Comincio registrando', () => { st.seen.intro = 1; st.sel = 0; st.deck = 'suono'; st.sub = 'rec'; applyGenre('techno'); closeSheet(); renderAll(); save(); toast('Registra la cassa: tieni premuto ● e fai “bum”'); }, 'hot'),
      btn('✦ Parto coi suoni suoi', () => { st.seen.intro = 1; st.tracks.forEach(t => t.src = 'synth'); applyGenre('techno'); boot(); for (let i = 0; i < NT; i++) renderTrack(i, true); closeSheet(); renderAll(); save(); toast('Premi ▶ — poi sostituisci i suoni col microfono'); }),
      btn('✂︎ Una registrazione, tante tracce', () => { st.seen.intro = 1; applyGenre('techno'); st.sel = 0; save(); closeSheet(); setTimeout(openSlicer, 50); }));
  });
})();
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && Engine.ctx) Engine.ctx.resume(); });
if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) navigator.serviceWorker.register('sw.js').catch(() => {});
window.__mf = { get st() { return st; }, samples, Engine, renderAll, setSample, applyGenre };
})();
