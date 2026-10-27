/* dishwasher 1.2 — master glitch box (AudioWorklet).
   Keeps the last 6 s of the mix in a ring buffer and, on demand, plays it back
   in one of several broken ways. One read mode at a time; crush stacks on top. */
class GlitchBox extends AudioWorkletProcessor {
  constructor() {
    super();
    const sr = sampleRate;
    this.N = Math.ceil(sr * 6);
    this.b = [new Float32Array(this.N), new Float32Array(this.N)];
    this.W = 0;                         // absolute write counter
    this.M = Math.ceil(sr * 2.6);       // captured loop source
    this.cap = [new Float32Array(this.M), new Float32Array(this.M)];
    this.mode = null; this.mix = 0; this.tgt = 0;
    this.L = sr / 4; this.ph = 0; this.rate = 1; this.rateT = 1;
    this.r = 0; this.tapeT = .8;
    this.G = sr * .08; this.gr = [{ p: 0, j: 0 }, { p: 0, j: 0 }];
    this.crush = 0; this.cr = 0; this.hold = [0, 0]; this.cnt = 0;
    this.port.onmessage = e => this.msg(e.data);
  }
  capture(len) {
    const N = this.N, M = this.M, w = this.W;
    for (let c = 0; c < 2; c++) { const src = this.b[c], dst = this.cap[c]; for (let i = 0; i < M; i++) dst[i] = src[(w - M + i + N * 4) % N]; }
  }
  msg(d) {
    const sr = sampleRate;
    if (d.t === 'on') {
      const fresh = this.mode !== d.mode || this.mix < .5;
      this.mode = d.mode; this.tgt = 1;
      if (d.len) this.L = Math.max(64, Math.min(this.M - 2, d.len | 0));
      if (d.rate != null) this.rateT = d.rate;
      if (d.mode === 'repeat' || d.mode === 'reverse') { if (fresh) { this.capture(); this.ph = 0; this.rate = this.rateT; } }
      else if (d.mode === 'freeze') { this.G = Math.max(256, Math.min(sr * .5, (d.grain || .08) * sr)) | 0; this.capture(); this.gr[0].p = 0; this.gr[1].p = this.G / 2; this.gr.forEach(g => g.j = Math.random() * (this.M - this.G * 2 - 2)); }
      else if (d.mode === 'tape') { this.r = this.W - 1; this.rate = 1; this.tapeT = d.time || .8; }
      else if (d.mode === 'scratch') { if (fresh) { this.r = this.W - 2048; this.rate = 1; } }
    } else if (d.t === 'off') { this.tgt = 0; }
    else if (d.t === 'set') {
      if (d.len) { this.L = Math.max(64, Math.min(this.M - 2, d.len | 0)); if (this.ph >= this.L) this.ph %= this.L; }
      if (d.rate != null) this.rateT = d.rate;
      if (d.grain) this.G = Math.max(256, Math.min(sr * .5, d.grain * sr)) | 0;
      if (d.time) this.tapeT = d.time;
    } else if (d.t === 'crush') this.crush = d.v;
  }
  rdRing(c, pos) {
    const N = this.N, p = ((pos % N) + N) % N, i = p | 0, f = p - i, a = this.b[c][i], b = this.b[c][(i + 1) % N];
    return a + (b - a) * f;
  }
  rdCap(c, pos) {
    const M = this.M; let p = pos % M; if (p < 0) p += M; const i = p | 0, f = p - i, a = this.cap[c][i], b = this.cap[c][(i + 1) % M];
    return a + (b - a) * f;
  }
  process(inputs, outputs) {
    const inp = inputs[0] || [], out = outputs[0], n = out[0].length, N = this.N, M = this.M, sr = sampleRate;
    const step = 1 / (.006 * sr);
    const il = inp[0], ir = inp[1] || inp[0];
    for (let i = 0; i < n; i++) {
      const xl = il ? il[i] : 0, xr = ir ? ir[i] : 0;
      const wi = this.W % N; this.b[0][wi] = xl; this.b[1][wi] = xr;
      if (this.mix < this.tgt) this.mix = Math.min(this.tgt, this.mix + step);
      else if (this.mix > this.tgt) { this.mix = Math.max(this.tgt, this.mix - step); if (this.mix === 0) this.mode = null; }
      let wl = 0, wr = 0;
      if (this.mode && this.mix > 0) {
        const m = this.mode;
        if (m === 'repeat' || m === 'reverse') {
          this.rate += (this.rateT - this.rate) * .0008;
          const L = this.L, ph = this.ph, base = M - L;
          const pos = m === 'repeat' ? base + ph : base + (L - 1 - ph);
          const env = Math.min(1, ph / 96, (L - ph) / 96);
          wl = this.rdCap(0, pos) * env; wr = this.rdCap(1, pos) * env;
          let np = ph + this.rate; if (np >= L) np -= L; if (np < 0) np += L; this.ph = np;
        } else if (m === 'freeze') {
          const G = this.G;
          for (let k = 0; k < 2; k++) {
            const g = this.gr[k], win = .5 - .5 * Math.cos(2 * Math.PI * g.p / G), pos = g.j + g.p;
            wl += this.rdCap(0, pos) * win; wr += this.rdCap(1, pos) * win;
            g.p++; if (g.p >= G) { g.p = 0; g.j = Math.random() * Math.max(1, M - G - 2); }
          }
        } else if (m === 'tape') {
          this.rate = Math.max(0, this.rate - 1 / (this.tapeT * sr));
          wl = this.rdRing(0, this.r); wr = this.rdRing(1, this.r);
          this.r += this.rate;
          const env = Math.min(1, this.rate * 6); wl *= env; wr *= env;
        } else if (m === 'scratch') {
          this.rate += (this.rateT - this.rate) * .002;
          let r = this.r + this.rate;
          if (r > this.W - 32) r = this.W - 32;
          if (r < this.W - N + 4096) r = this.W - N + 4096;
          this.r = r; wl = this.rdRing(0, r); wr = this.rdRing(1, r);
        }
      }
      let yl = xl * (1 - this.mix) + wl * this.mix, yr = xr * (1 - this.mix) + wr * this.mix;
      // crush: bit depth + sample-rate reduction, crossfaded in
      this.cr += (this.crush - this.cr) * .002;
      if (this.cr > .002) {
        const a = this.cr, bits = 16 - a * 13, q = Math.pow(2, bits - 1), down = 1 + Math.floor(a * a * 34);
        if (this.cnt++ % down === 0) { this.hold[0] = Math.round(yl * q) / q; this.hold[1] = Math.round(yr * q) / q; }
        yl = yl * (1 - a) + this.hold[0] * a; yr = yr * (1 - a) + this.hold[1] * a;
      }
      out[0][i] = yl; if (out[1]) out[1][i] = yr;
      this.W++;
    }
    return true;
  }
}
registerProcessor('glitchbox', GlitchBox);
