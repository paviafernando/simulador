// Sintetizador procedural: motores, viento, efectos. Sin archivos de audio.
export class Synth {
  constructor() { this.ctx = null; this.loops = {}; this.enabled = true; }

  ensure() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      this.ctx = new AC();
      this.master = this.ctx.createGain(); this.master.gain.value = 0.8;
      const comp = this.ctx.createDynamicsCompressor();
      this.master.connect(comp); comp.connect(this.ctx.destination);
      const len = this.ctx.sampleRate * 2;
      this.noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const d = this.noiseBuf.getChannelData(0);
      let b = 0; for (let i = 0; i < len; i++) { const w = Math.random() * 2 - 1; b = 0.97 * b + 0.03 * w; d[i] = w * 0.5 + b * 3; }
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
    return this.ctx;
  }
  get t() { return this.ctx.currentTime; }

  noiseSrc() { const s = this.ctx.createBufferSource(); s.buffer = this.noiseBuf; s.loop = true; return s; }

  // ---- Loops continuos ----
  engine(name = 'engine', { type = 'sawtooth', base = 50, vol = 0.18 } = {}) {
    if (!this.ensure()) return dummy;
    if (this.loops[name]) return this.loops[name];
    const ctx = this.ctx;
    const o1 = ctx.createOscillator(), o2 = ctx.createOscillator(), o3 = ctx.createOscillator();
    o1.type = type; o2.type = 'square'; o3.type = 'sine';
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 600; lp.Q.value = 2;
    const g = ctx.createGain(); g.gain.value = 0;
    const g2 = ctx.createGain(); g2.gain.value = 0.35;
    o1.connect(lp); o2.connect(g2); g2.connect(lp); o3.connect(lp); lp.connect(g); g.connect(this.master);
    [o1, o2, o3].forEach((o) => o.start());
    const loop = {
      set: (rpm, load = 0.5) => {
        const f = base + rpm * base * 3;
        const t = ctx.currentTime;
        o1.frequency.setTargetAtTime(f, t, 0.05); o2.frequency.setTargetAtTime(f * 0.5, t, 0.05); o3.frequency.setTargetAtTime(f * 2.01, t, 0.05);
        lp.frequency.setTargetAtTime(300 + load * 1800 + rpm * 1200, t, 0.05);
        g.gain.setTargetAtTime(this.enabled ? vol * (0.45 + load * 0.55) : 0, t, 0.08);
      },
      stop: () => { g.gain.setTargetAtTime(0, ctx.currentTime, 0.1); setTimeout(() => [o1, o2, o3].forEach((o) => o.stop()), 400); delete this.loops[name]; },
    };
    this.loops[name] = loop;
    return loop;
  }

  noiseLoop(name, { type = 'bandpass', freq = 800, q = 0.7, vol = 0.3 } = {}) {
    if (!this.ensure()) return dummy;
    if (this.loops[name]) return this.loops[name];
    const ctx = this.ctx;
    const src = this.noiseSrc();
    const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
    const g = ctx.createGain(); g.gain.value = 0;
    src.connect(f); f.connect(g); g.connect(this.master); src.start();
    const loop = {
      set: (level, fr) => {
        const t = ctx.currentTime;
        g.gain.setTargetAtTime(this.enabled ? vol * Math.max(0, level) : 0, t, 0.08);
        if (fr) f.frequency.setTargetAtTime(fr, t, 0.08);
      },
      stop: () => { g.gain.setTargetAtTime(0, ctx.currentTime, 0.1); setTimeout(() => src.stop(), 400); delete this.loops[name]; },
    };
    this.loops[name] = loop;
    return loop;
  }

  stopAll() { Object.values(this.loops).forEach((l) => l.stop()); this.loops = {}; }

  // ---- Efectos ----
  tone(freq, dur, { type = 'sine', vol = 0.3, at = 0, slide = 0, attack = 0.005 } = {}) {
    const ctx = this.ctx, t = ctx.currentTime + at;
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type; o.frequency.setValueAtTime(freq, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(20, freq * slide), t + dur);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + attack); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(this.master); o.start(t); o.stop(t + dur + 0.05);
    return o;
  }
  burst(dur, { freq = 1000, type = 'lowpass', vol = 0.5, at = 0, q = 0.5, slide = 0 } = {}) {
    const ctx = this.ctx, t = ctx.currentTime + at;
    const s = this.noiseSrc(), f = ctx.createBiquadFilter(), g = ctx.createGain();
    f.type = type; f.frequency.setValueAtTime(freq, t); f.Q.value = q;
    if (slide) f.frequency.exponentialRampToValueAtTime(freq * slide, t + dur);
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f); f.connect(g); g.connect(this.master); s.start(t, Math.random()); s.stop(t + dur + 0.05);
  }

  play(name) {
    if (!this.enabled || !this.ensure()) return;
    switch (name) {
      case 'ding': [880, 1175, 1568].forEach((f, i) => this.tone(f, 0.35, { at: i * 0.07, vol: 0.22, type: 'triangle' })); break;
      case 'coin': this.tone(988, 0.08, { vol: 0.2, type: 'square' }); this.tone(1319, 0.3, { at: 0.08, vol: 0.2, type: 'square' }); break;
      case 'boost': this.burst(0.9, { freq: 400, type: 'bandpass', slide: 6, vol: 0.6, q: 1 }); this.tone(120, 0.8, { slide: 3, type: 'sawtooth', vol: 0.12 }); break;
      case 'crash': this.burst(1.4, { freq: 1800, slide: 0.1, vol: 1 }); this.tone(70, 0.9, { slide: 0.4, type: 'square', vol: 0.3 }); break;
      case 'bump': this.burst(0.25, { freq: 500, vol: 0.6 }); break;
      case 'hoot':
        this.tone(410, 0.42, { vol: 0.35, slide: 0.88, attack: 0.08 });
        this.tone(395, 0.6, { at: 0.55, vol: 0.35, slide: 0.85, attack: 0.08 });
        this.tone(380, 0.35, { at: 1.25, vol: 0.25, slide: 0.9, attack: 0.06 }); break;
      case 'flap': this.burst(0.22, { freq: 600, type: 'bandpass', vol: 0.5, slide: 0.5, q: 0.8 }); break;
      case 'whee': this.tone(500, 1.2, { type: 'triangle', vol: 0.25, slide: 2.2, attack: 0.05 }); this.tone(750, 1.2, { type: 'sine', vol: 0.15, slide: 2.0, attack: 0.05 }); break;
      case 'beep': this.tone(660, 0.18, { type: 'square', vol: 0.18 }); break;
      case 'go': this.tone(1320, 0.6, { type: 'square', vol: 0.2 }); break;
      case 'click': this.burst(0.03, { freq: 3000, type: 'highpass', vol: 0.4 }); break;
      case 'win': [523, 659, 784, 1047, 1319].forEach((f, i) => this.tone(f, 0.4, { at: i * 0.12, vol: 0.2, type: 'triangle' })); break;
      case 'lap': [784, 988].forEach((f, i) => this.tone(f, 0.25, { at: i * 0.12, vol: 0.2, type: 'square' })); break;
      case 'horn': this.tone(392, 0.5, { type: 'sawtooth', vol: 0.15 }); this.tone(494, 0.5, { type: 'sawtooth', vol: 0.12 }); break;
      case 'select': this.tone(1200, 0.06, { type: 'triangle', vol: 0.15 }); break;
    }
  }
}
const dummy = { set() {}, stop() {} };
