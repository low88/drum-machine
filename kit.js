/* MICROFONIA — roles, "suono suo" recipes, genres and long-form rhythm generation (4 … 32 bars). */
'use strict';
const Kit = (() => {
const R = Math.random, r = (a, b) => a + R() * (b - a), pick = a => a[R() * a.length | 0];
const sel = (k, i) => i / (Engine.PARAMS[k].sel.length - 1);

/* ---------- the app's own sounds (rendered to a sample, then treated like a recording) ---------- */
const RECIPES = {
  kick:   () => ({ tLvl: 1, tPitch: r(.13, .25), tBend: r(.45, .95), tBendT: r(.22, .5), tWave: sel('tWave', R() < .8 ? 0 : 1), tDec: r(.6, .84), nLvl: R() < .4 ? r(.08, .3) : 0, nType: sel('nType', 0), nFreq: r(.35, .55), nDec: r(.15, .35), click: r(.1, .5), drive: r(0, .5) }),
  snare:  () => ({ tLvl: r(.5, .85), tPitch: r(.42, .56), tBend: r(.1, .3), tBendT: r(.25, .4), tDec: r(.33, .5), nLvl: r(.8, 1), nType: sel('nType', pick([1, 2])), nFreq: r(.55, .8), nQ: r(.05, .3), nDec: r(.48, .66), rLvl: R() < .5 ? r(.2, .5) : 0, rShape: sel('rShape', 6), rFreq: r(.18, .3), rRing: r(.3, .5), click: r(.1, .4), drive: r(0, .4) }),
  clap:   () => ({ tLvl: 0, nLvl: 1, nType: sel('nType', 1), nFreq: r(.45, .62), nQ: r(.15, .45), nDec: r(.55, .7), nBursts: sel('nBursts', pick([2, 3, 3, 4])), nSpread: r(.18, .45), drive: r(0, .3), vari: r(.3, .6) }),
  hatC:   () => ({ tLvl: 0, mLvl: 1, mFreq: r(.45, .6), mSet: sel('mSet', R() < .75 ? 0 : 4), mDisp: r(0, .35), mFm: R() < .3 ? r(.1, .5) : 0, mDec: r(.24, .42), mHp: r(.86, .96), nLvl: r(.1, .45), nType: sel('nType', 2), nFreq: r(.82, .92), nDec: r(.25, .4), vari: r(.3, .6) }),
  hatO:   () => ({ tLvl: 0, mLvl: 1, mFreq: r(.45, .6), mSet: sel('mSet', R() < .75 ? 0 : 4), mDisp: r(0, .35), mFm: R() < .3 ? r(.1, .5) : 0, mDec: r(.6, .78), mHp: r(.84, .95), nLvl: r(.1, .4), nType: sel('nType', 2), nFreq: r(.8, .92), nDec: r(.55, .7) }),
  perc:   () => pick([
    () => ({ tLvl: r(.1, .4), tPitch: r(.55, .7), tBend: r(0, .1), tDec: r(.1, .2), rLvl: 1, rShape: sel('rShape', pick([3, 5, 2])), rFreq: r(.62, .78), rRing: r(.22, .42), rExc: r(.8, 1), rBright: r(.5, .9), click: r(.3, .7) }),
    () => ({ tLvl: 0, nLvl: 1, nType: sel('nType', pick([1, 2])), nFreq: r(.78, .9), nQ: r(.1, .4), nDec: r(.3, .46), nBursts: sel('nBursts', pick([0, 1])), nSpread: r(.3, .6), vari: r(.5, .9), human: r(.1, .4) }),
    () => ({ tLvl: 0, rLvl: 1, rShape: sel('rShape', pick([0, 1, 2, 1])), rFreq: r(.5, .8), rRing: r(.55, .82), rExc: r(.6, 1), rBright: r(.45, .85), vari: r(.2, .5) }),
    () => ({ tLvl: 0, mLvl: 1, mSet: sel('mSet', 3), mFreq: r(.6, .7), mDisp: r(0, .15), mDec: r(.35, .5), mHp: r(.3, .5) }),
  ])(),
  tom:    () => ({ tLvl: 1, tPitch: r(.33, .56), tBend: r(.1, .3), tBendT: r(.3, .5), tDec: r(.62, .78), rLvl: r(.25, .6), rShape: sel('rShape', pick([6, 7])), rFreq: r(.25, .45), rRing: r(.35, .55), rExc: r(.4, .8), click: r(.1, .35) }),
  fx:     () => R() < .5 ? ({ tLvl: 1, tWave: sel('tWave', pick([0, 2, 3, 1])), tPitch: r(.55, .85), tBend: r(.5, 1), tBendT: r(.5, .8), tDec: r(.35, .55), bits: R() < .5 ? r(.3, .75) : 0, down: R() < .4 ? r(.2, .6) : 0, drive: r(.1, .6) })
                     : ({ tLvl: r(0, .5), tPitch: r(.2, .35), tDec: r(.3, .5), rLvl: 1, rShape: sel('rShape', pick([7, 4])), rFreq: r(.2, .42), rRing: r(.5, .75), rExc: r(.3, .8), rBright: r(.3, .7), mLvl: R() < .4 ? r(.2, .5) : 0, mFreq: r(.3, .5), mSet: sel('mSet', 1), mDec: r(.5, .7) }),
};
const ROLES = { kick: 'Cassa', snare: 'Rullante', clap: 'Clap', hatC: 'Hat chiuso', hatO: 'Hat aperto', perc: 'Percussione', tom: 'Tom', fx: 'Effetto' };
const ROLE_KEYS = Object.keys(ROLES);
const HINTS = { kick: 'pugno sul tavolo, “bum” con la bocca', snare: 'schiaffo su un libro, “ts” secco', clap: 'battito di mani', hatC: '“ts” corto, chiavi, monete', hatO: '“tssss” lungo, sacchetto', perc: 'bicchiere, cucchiaio, lingua che schiocca', tom: 'pentola, scatola di cartone', fx: 'quello che vuoi: voce, fischio, porta' };
// fresh synth parameters for a role (only synthesis + colour; the mix stays)
function synth(role) {
  const p = {}; for (const k of Engine.SYNTH_KEYS) p[k] = Engine.PARAMS[k].d;
  Object.assign(p, { tLvl: 0, click: 0, drive: .1, bits: 0, down: 0 }, RECIPES[role]());
  return p;
}
function wilder(p, amt) { const q = Object.assign({}, p); for (const k of Engine.SYNTH_KEYS) { const d = Engine.PARAMS[k]; if (d.sel || k.endsWith('Lvl')) continue; if (R() < .5) q[k] = Math.max(0, Math.min(1, q[k] + (R() - .5) * amt)); } return q; }

/* ---------- steps (sparse: {index: step}) ---------- */
const step = (v = .85) => ({ v, p: 1, r: 1, t: 0 });
function emptyTrack(bars = 4) { return { bars, rate: 3, steps: {} }; }
function euclid(k, n, rot = 0) { const out = new Array(n).fill(0); if (k <= 0) return out; for (let i = 0; i < n; i++) out[(i + rot) % n] = Math.floor((i * k) / n) !== Math.floor(((i - 1) * k) / n) ? 1 : 0; return out; }
const at = (n, idx) => { const a = new Array(n).fill(0); idx.forEach(i => a[i % n] = 1); return a; };

/* ---------- genres ---------- */
const GENRES = {
  techno:   { n: 'Techno', d: 'cassa dritta, ipnotica', bpm: [124, 134], swing: [0, .1], fx: { size: .5, dDiv: 5, dFb: .45 } },
  house:    { n: 'House', d: 'swing, clap in levare', bpm: [118, 125], swing: [.25, .45], fx: { size: .4, dDiv: 3, dFb: .35 } },
  breaks:   { n: 'Breakbeat / DnB', d: 'spezzato e veloce', bpm: [164, 176], swing: [0, .1], fx: { size: .35, dDiv: 2, dFb: .3 } },
  trap:     { n: 'Trap', d: 'hat a raffica, rullate', bpm: [136, 150], swing: [0, .05], fx: { size: .55, dDiv: 4, dFb: .4 } },
  boombap:  { n: 'Boom bap', d: 'hip hop sporco, swing', bpm: [84, 96], swing: [.3, .55], fx: { size: .3, dDiv: 3, dFb: .3 } },
  organico: { n: 'Organico', d: 'percussioni che respirano', bpm: [92, 110], swing: [.1, .3], fx: { size: .6, dDiv: 2, dFb: .4 } },
  dub:      { n: 'Dub', d: 'lento, eco infinite', bpm: [68, 84], swing: [.1, .25], fx: { size: .8, dDiv: 5, dFb: .65 } },
  idm:      { n: 'Caos IDM', d: 'poliritmi e glitch', bpm: [140, 172], swing: [0, .2], fx: { size: .5, dDiv: 2, dFb: .55 } },
};
function baseBar(role, g) {
  const T = {
    kick: { techno: () => at(16, [0, 4, 8, 12]), house: () => at(16, [0, 4, 8, 12]), breaks: () => at(16, [0, pick([6, 7]), 10]), trap: () => at(16, [0, pick([3, 6]), pick([7, 10, 11])]),
      boombap: () => at(16, [0, pick([7, 8]), 10]), organico: () => at(16, [0, pick([7, 10])]), dub: () => at(16, [0, pick([7, 10])]) },
    snare: { techno: () => at(16, []), house: () => at(16, []), breaks: () => at(16, [4, 12]), trap: () => at(16, [8]), boombap: () => at(16, [4, 12]), organico: () => euclid(3, 16, 2), dub: () => at(16, [8]) },
    clap: { techno: () => at(16, [4, 12]), house: () => at(16, [4, 12]), breaks: () => at(16, [12]), trap: () => at(16, [8]), boombap: () => at(16, [12]), organico: () => euclid(2, 16, 4), dub: () => at(16, []) },
    hatC: { techno: () => at(16, [2, 6, 10, 14]).map((x, i) => x || (R() < .35 && i % 2 ? 1 : 0)), house: () => new Array(16).fill(0).map((_, i) => i % 2 === 0 || R() < .5 ? 1 : 0),
      breaks: () => new Array(16).fill(0).map((_, i) => i % 2 === 0 || R() < .4 ? 1 : 0), trap: () => new Array(16).fill(1), boombap: () => new Array(16).fill(0).map((_, i) => i % 2 === 0 ? 1 : 0), organico: () => euclid(7, 16, 1), dub: () => euclid(4, 16, 2) },
    hatO: { techno: () => at(16, [2, 6, 10, 14]), house: () => at(16, [2, 6, 10, 14]), breaks: () => at(16, [pick([6, 14])]), trap: () => at(16, [pick([6, 14])]), boombap: () => at(16, [14]), organico: () => euclid(2, 16, 6), dub: () => at(16, [14]) },
  };
  const t = T[role] && T[role][g];
  if (t) return t();
  if (g === 'dub') return euclid(pick([1, 2, 3]), 16, R() * 16 | 0);
  if (role === 'tom') return euclid(pick([1, 2, 3]), 16, R() * 16 | 0);
  if (role === 'fx') return euclid(pick([1, 1, 2]), 16, R() * 16 | 0);
  return euclid(pick([2, 3, 3, 4, 5, 5, 7]), 16, R() * 16 | 0);
}
function velFor(role, i) { return (role === 'hatC' || role === 'perc') ? (i % 4 === 0 ? .95 : i % 2 === 0 ? .7 : .5 + R() * .2) : .6 + R() * .4; }
/* a whole track over `bars` bars: a base bar plus variations, fills at phrase ends and a drop in long loops */
function rhythm(role, g, bars) {
  const tr = emptyTrack(bars);
  if (g === 'idm' && role !== 'kick') {
    const len = pick([5, 7, 9, 11, 12, 13, 15, 16]); tr.rate = pick([3, 3, 4, 5, 2]);
    const pat = euclid(1 + (R() * len * .6 | 0), len, R() * len | 0);
    for (let n = 0; n < bars * 16; n++) if (pat[n % len] && R() > .08) { const s = step(.55 + R() * .45); if (R() < .2) s.r = pick([2, 3, 4]); if (R() < .25) s.t = pick([-12, -5, -3, 3, 5, 7, 12]); s.p = R() < .3 ? r(.4, .9) : 1; tr.steps[n] = s; }
    return tr;
  }
  const base = baseBar(role, g === 'idm' ? 'breaks' : g), alt = R() < .5 ? baseBar(role, g === 'idm' ? 'breaks' : g) : base;
  const drop0 = bars >= 16 ? Math.floor(bars / 2) : -1, dropLen = Math.max(1, bars / 8);
  for (let b = 0; b < bars; b++) {
    const bar = (b % 2 === 1 && R() < .5) ? alt : base;
    const phraseEnd = (b % 4) === 3, bigEnd = b === bars - 1 || (b % 8) === 7;
    const inDrop = drop0 >= 0 && b >= drop0 && b < drop0 + dropLen;
    for (let i = 0; i < 16; i++) {
      let on = bar[i];
      if (inDrop && (role === 'kick' || (role === 'hatC' && i % 4 !== 2))) on = 0;
      // ghost notes and small mutations every other bar
      if (!on && b % 2 === 1 && (role === 'snare' || role === 'perc') && R() < .06) { tr.steps[b * 16 + i] = step(.28 + R() * .15); continue; }
      if (on && (role === 'hatC' || role === 'perc') && R() < .05) on = 0;
      if (on) { const s = step(velFor(role, i)); if (g === 'trap' && role === 'hatC' && R() < .18) s.r = pick([2, 3, 4]); if ((role === 'perc' || role === 'fx') && (g === 'organico' || g === 'techno')) s.p = r(.55, 1); if (role === 'fx' && R() < .3) s.t = pick([-5, 7, 12, -12, 3]); tr.steps[b * 16 + i] = s; }
    }
    // fills
    if (phraseEnd || bigEnd) {
      const who = bigEnd ? ['snare', 'clap', 'tom', 'hatC', 'perc'] : ['snare', 'tom', 'perc'];
      if (who.includes(role)) {
        const from = bigEnd ? pick([8, 10, 12]) : pick([12, 13, 14]);
        for (let i = from; i < 16; i++) if ((role === 'tom' || role === 'snare' || role === 'clap') ? R() < (bigEnd ? .75 : .5) : R() < .4) {
          const s = step(.45 + (i - from) / (16 - from) * .5); if (bigEnd && R() < .3) s.r = pick([2, 3]); if (role === 'tom') s.t = -Math.round((i - from) * 1.5); tr.steps[b * 16 + i] = s; }
      }
      if (role === 'kick' && bigEnd && R() < .6) { delete tr.steps[b * 16 + 12]; tr.steps[b * 16 + 14] = step(.8); }
      if (role === 'fx' && bigEnd) { const s = step(.9); s.t = 12; tr.steps[b * 16 + 15] = s; }
      if (role === 'hatO' && bigEnd && R() < .5) for (let i = 12; i < 16; i++) delete tr.steps[b * 16 + i];
    }
  }
  return tr;
}

/* ---------- evolution ---------- */
function evolve(pattern, roles, mutes, amt) {
  pattern.tracks.forEach((tr, i) => {
    if (mutes[i] || R() > amt * .7) return;
    const len = tr.bars * 16, n = R() * len | 0, s = tr.steps[n], count = Object.keys(tr.steps).length, op = R();
    if (op < .35) { if (s && (count / len > .3 || R() < .3) && !(roles[i] === 'kick' && R() < .7)) delete tr.steps[n]; else if (!s) tr.steps[n] = step(.4 + R() * .5); }
    else if (op < .55) { if (s) s.v = Math.max(.2, Math.min(1, s.v + (R() - .5) * .5)); }
    else if (op < .7) { if (s) s.r = R() < .6 ? 1 : pick([2, 3, 4]); }
    else if (op < .82) { if (s) s.p = R() < .5 ? 1 : .5 + R() * .5; }
    else if (op < .92) { if (s) s.t = R() < .5 ? 0 : pick([-12, -5, -2, 2, 5, 7, 12]); }
    else if (roles[i] !== 'kick') { const o = {}; for (const k in tr.steps) o[(+k + 1) % len] = tr.steps[k]; tr.steps = o; }
  });
}

return { ROLES, ROLE_KEYS, HINTS, GENRES, synth, wilder, step, emptyTrack, euclid, rhythm, evolve };
})();
