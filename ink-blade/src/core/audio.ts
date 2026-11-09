export class Sfx {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noiseBuf: AudioBuffer | null = null;
  muted = false;
  private drone: { a: OscillatorNode; b: OscillatorNode; filter: BiquadFilterNode } | null = null;

  init() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      return;
    }
    const C = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!C) return;
    this.ctx = new C();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.42;
    this.master.connect(this.ctx.destination);

    const len = Math.floor(this.ctx.sampleRate * 1.2);
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    this.noiseBuf = buf;
  }

  get now() {
    return this.ctx ? this.ctx.currentTime : 0;
  }

  setMuted(m: boolean) {
    this.muted = m;
    if (this.master && this.ctx) {
      this.master.gain.setTargetAtTime(m ? 0 : 0.42, this.ctx.currentTime, 0.05);
    }
  }

  private tone(freq: number, dur: number, type: OscillatorType, gain: number, slideTo?: number, delay = 0) {
    if (!this.ctx || !this.master) return;
    const t0 = this.ctx.currentTime + delay;
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(Math.max(20, freq), t0);
    if (slideTo !== undefined) o.frequency.exponentialRampToValueAtTime(Math.max(20, slideTo), t0 + dur);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, gain), t0 + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g);
    g.connect(this.master);
    o.start(t0);
    o.stop(t0 + dur + 0.02);
  }

  private noise(dur: number, gain: number, type: BiquadFilterType, freq: number, q = 1, slideTo?: number, delay = 0) {
    if (!this.ctx || !this.master || !this.noiseBuf) return;
    const t0 = this.ctx.currentTime + delay;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    const f = this.ctx.createBiquadFilter();
    f.type = type;
    f.Q.value = q;
    f.frequency.setValueAtTime(Math.max(30, freq), t0);
    if (slideTo !== undefined) f.frequency.exponentialRampToValueAtTime(Math.max(30, slideTo), t0 + dur);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, gain), t0 + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(f);
    f.connect(g);
    g.connect(this.master);
    src.start(t0, Math.random() * 0.2);
    src.stop(t0 + dur + 0.02);
  }

  swing() {
    this.noise(0.14, 0.09, 'bandpass', 2600, 1.2, 500);
  }

  hit(crit = false) {
    this.noise(0.1, 0.16, 'lowpass', 900, 0.8, 120);
    this.tone(crit ? 160 : 110, 0.09, 'square', 0.08, 45);
  }

  skill1() {
    this.noise(0.28, 0.2, 'bandpass', 3200, 1.5, 300);
    this.tone(880, 0.3, 'sawtooth', 0.1, 180);
    this.tone(1320, 0.18, 'triangle', 0.06, 520, 0.02);
  }

  skill2() {
    this.tone(1180, 0.25, 'triangle', 0.09, 940);
    this.noise(0.4, 0.12, 'highpass', 2000, 0.7, 600);
    this.tone(590, 0.4, 'sine', 0.07, 300, 0.05);
  }

  skill3() {
    this.tone(90, 0.9, 'sine', 0.24, 38);
    this.noise(0.9, 0.24, 'lowpass', 1200, 0.8, 80);
    this.tone(240, 0.5, 'sawtooth', 0.09, 60, 0.06);
    this.noise(0.5, 0.1, 'highpass', 2600, 1, 400, 0.08);
  }

  dodge() {
    this.noise(0.22, 0.1, 'highpass', 900, 0.8, 2400);
  }

  perfect() {
    this.tone(880, 0.35, 'sine', 0.1, 880);
    this.tone(1320, 0.45, 'sine', 0.07, 1320, 0.02);
    this.tone(1760, 0.5, 'triangle', 0.05, 1760, 0.04);
    this.noise(0.3, 0.07, 'highpass', 3000, 1, 1200);
  }

  hurt() {
    this.tone(190, 0.22, 'sawtooth', 0.1, 70);
    this.noise(0.16, 0.1, 'lowpass', 700, 0.6, 120);
  }

  pickup() {
    this.tone(660, 0.1, 'sine', 0.06, 990);
    this.tone(990, 0.12, 'triangle', 0.04, 1320, 0.03);
  }

  ui() {
    this.tone(520, 0.06, 'sine', 0.05);
  }

  buy() {
    this.tone(740, 0.08, 'square', 0.04);
    this.tone(1100, 0.12, 'sine', 0.05, 1320, 0.05);
  }

  deny() {
    this.tone(180, 0.12, 'square', 0.05, 140);
  }

  heal() {
    this.tone(440, 0.3, 'sine', 0.06, 660);
    this.tone(660, 0.4, 'sine', 0.04, 880, 0.08);
  }

  bossRoar() {
    this.tone(64, 1.2, 'sawtooth', 0.18, 40);
    this.tone(96, 1.0, 'square', 0.06, 48);
    this.noise(1.0, 0.16, 'lowpass', 500, 1, 90);
  }

  death() {
    this.tone(220, 1.4, 'sine', 0.12, 55);
    this.noise(1.2, 0.1, 'lowpass', 500, 0.8, 60);
  }

  victory() {
    const notes = [392, 523, 659, 784, 1046];
    notes.forEach((n, i) => {
      this.tone(n, 0.7, 'sine', 0.07, n, i * 0.16);
      this.tone(n * 0.5, 0.7, 'triangle', 0.04, n * 0.5, i * 0.16);
    });
  }

  gate() {
    this.tone(300, 0.5, 'sine', 0.06, 180);
    this.noise(0.5, 0.08, 'bandpass', 800, 1, 300);
  }

  startDrone() {
    if (!this.ctx || !this.master || this.drone) return;
    const mk = (f: number) => {
      const o = this.ctx!.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = f;
      const g = this.ctx!.createGain();
      g.gain.value = 0.02;
      o.connect(g);
      return { o, g };
    };
    const a = mk(55);
    const b = mk(82.4);
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 220;
    filter.Q.value = 0.8;
    const sum = this.ctx.createGain();
    sum.gain.value = 0.5;
    a.g.connect(filter);
    b.g.connect(filter);
    filter.connect(sum);
    sum.connect(this.master);
    a.o.start();
    b.o.start();
    this.drone = { a: a.o, b: b.o, filter };
  }

  setRegionMood(idx: number) {
    if (!this.ctx || !this.drone) return;
    const freqs = [220, 180, 150, 120];
    this.drone.filter.frequency.setTargetAtTime(freqs[Math.max(0, Math.min(3, idx))], this.ctx.currentTime, 1.5);
  }
}
