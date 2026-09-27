/**
 * Fully procedural ambience - no audio assets.
 * Everything is synthesised with the WebAudio API so the build stays asset-free.
 */

type Zone = "airlock" | "hub" | "corridor" | "wetlab" | "control" | "containment" | "server" | "utility";

const ZONE_TONE: Record<Zone, { vent: number; ventGain: number; humGain: number; whine: number }> = {
  airlock: { vent: 300, ventGain: 0.055, humGain: 1.0, whine: 0 },
  hub: { vent: 260, ventGain: 0.04, humGain: 0.9, whine: 0 },
  corridor: { vent: 340, ventGain: 0.05, humGain: 0.8, whine: 0 },
  wetlab: { vent: 420, ventGain: 0.07, humGain: 0.7, whine: 0.02 },
  control: { vent: 200, ventGain: 0.028, humGain: 0.6, whine: 0.05 },
  containment: { vent: 150, ventGain: 0.022, humGain: 1.25, whine: 0.0 },
  server: { vent: 520, ventGain: 0.085, humGain: 0.9, whine: 0.09 },
  utility: { vent: 180, ventGain: 0.075, humGain: 1.4, whine: 0.03 },
};

export class Ambience {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private humGain: GainNode | null = null;
  private ventGain: GainNode | null = null;
  private ventFilter: BiquadFilterNode | null = null;
  private whineGain: GainNode | null = null;
  private noiseBuffer: AudioBuffer | null = null;
  private timer: number | null = null;
  private nextDrip = 4;
  private nextCreak = 18;
  private nextChatter = 26;
  private zone: Zone = "airlock";
  private started = false;
  private alarmUntil = 0;

  get isRunning() {
    return this.started;
  }

  async start(): Promise<void> {
    if (this.started) return;
    const Ctor: typeof AudioContext =
      window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    const ctx = new Ctor();
    this.ctx = ctx;
    if (ctx.state === "suspended") await ctx.resume();

    const master = ctx.createGain();
    master.gain.value = 0.0;
    master.connect(ctx.destination);
    this.master = master;

    // ---- low electrical hum: two detuned sines + a fifth -----------------
    const humGain = ctx.createGain();
    humGain.gain.value = 0.05;
    const humFilter = ctx.createBiquadFilter();
    humFilter.type = "lowpass";
    humFilter.frequency.value = 220;
    humGain.connect(humFilter).connect(master);
    for (const [freq, gain] of [
      [51.5, 1.0],
      [52.3, 0.7],
      [103.4, 0.32],
    ] as [number, number][]) {
      const o = ctx.createOscillator();
      o.type = "sine";
      o.frequency.value = freq;
      const g = ctx.createGain();
      g.gain.value = gain * 0.5;
      o.connect(g).connect(humGain);
      o.start();
    }
    this.humGain = humGain;

    // ---- ventilation: filtered noise -------------------------------------
    this.noiseBuffer = this.makeNoise(ctx, 4);
    const ventSrc = ctx.createBufferSource();
    ventSrc.buffer = this.noiseBuffer;
    ventSrc.loop = true;
    const ventFilter = ctx.createBiquadFilter();
    ventFilter.type = "bandpass";
    ventFilter.frequency.value = 300;
    ventFilter.Q.value = 0.7;
    const ventGain = ctx.createGain();
    ventGain.gain.value = 0.0;
    ventSrc.connect(ventFilter).connect(ventGain).connect(master);
    ventSrc.start();
    this.ventFilter = ventFilter;
    this.ventGain = ventGain;

    // slow LFO on the vent filter so it breathes
    const lfo = ctx.createOscillator();
    lfo.type = "sine";
    lfo.frequency.value = 0.06;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 90;
    lfo.connect(lfoGain).connect(ventFilter.frequency);
    lfo.start();

    // ---- transformer whine (only audible in the utility room) ------------
    const whineOsc = ctx.createOscillator();
    whineOsc.type = "sawtooth";
    whineOsc.frequency.value = 100;
    const whineFilter = ctx.createBiquadFilter();
    whineFilter.type = "bandpass";
    whineFilter.frequency.value = 600;
    whineFilter.Q.value = 12;
    const whineGain = ctx.createGain();
    whineGain.gain.value = 0;
    whineOsc.connect(whineFilter).connect(whineGain).connect(master);
    whineOsc.start();
    this.whineGain = whineGain;

    master.gain.linearRampToValueAtTime(0.85, ctx.currentTime + 3.5);
    this.started = true;
    this.loop();
  }

  stop(): void {
    if (this.timer !== null) window.clearTimeout(this.timer);
    this.timer = null;
    this.started = false;
    this.ctx?.close().catch(() => undefined);
    this.ctx = null;
  }

  setZone(zone: Zone): void {
    if (this.zone === zone) return;
    this.zone = zone;
    if (!this.ctx || !this.ventGain || !this.ventFilter || !this.humGain || !this.whineGain) return;
    const t = this.ctx.currentTime;
    const tone = ZONE_TONE[zone];
    this.ventFilter.frequency.linearRampToValueAtTime(tone.vent, t + 1.4);
    this.ventGain.gain.linearRampToValueAtTime(tone.ventGain, t + 1.4);
    this.humGain.gain.linearRampToValueAtTime(0.05 * tone.humGain, t + 1.4);
    this.whineGain.gain.linearRampToValueAtTime(tone.whine * 0.05, t + 1.4);
  }

  setPower(on: boolean): void {
    if (!this.ctx || !this.humGain) return;
    const t = this.ctx.currentTime;
    this.humGain.gain.linearRampToValueAtTime(on ? 0.075 : 0.035, t + 2.0);
    if (on) {
      this.alarmUntil = this.ctx.currentTime + 7.5;
      this.alarm(this.alarmUntil);
    }
  }

  /* ------------------------------------------------------------------ */
  /* one-shots                                                           */
  /* ------------------------------------------------------------------ */

  play(name: string): void {
    if (!this.ctx || !this.master) return;
    switch (name) {
      case "beepUp":
        this.tone(720, 0.06, "sine", 0.09);
        break;
      case "beepDown":
        this.tone(360, 0.07, "sine", 0.07);
        break;
      case "breaker":
        this.thud(120, 0.16, 0.16);
        this.noiseBurst(1800, 0.06, 0.05, "highpass");
        break;
      case "spark":
        this.noiseBurst(3200, 0.22, 0.12, "highpass");
        this.tone(1400, 0.05, "square", 0.03);
        break;
      case "doorOpen":
        this.thud(90, 0.34, 0.2);
        this.noiseBurst(700, 0.4, 0.06, "bandpass");
        break;
      case "doorClose":
        this.thud(70, 0.28, 0.24);
        this.noiseBurst(400, 0.2, 0.07, "lowpass");
        break;
      case "locked":
        this.tone(180, 0.12, "square", 0.05);
        window.setTimeout(() => this.tone(150, 0.14, "square", 0.05), 130);
        break;
      case "footstep":
        this.footstep();
        break;
      case "drip":
        this.drip();
        break;
      case "powerSurge":
        this.surge();
        break;
    }
  }

  private tone(freq: number, dur: number, type: OscillatorType, gain: number): void {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.value = freq;
    const g = ctx.createGain();
    const t = ctx.currentTime;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gain, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.master!);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  private thud(freq: number, dur: number, gain: number): void {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    o.type = "sine";
    const t = ctx.currentTime;
    o.frequency.setValueAtTime(freq * 1.6, t);
    o.frequency.exponentialRampToValueAtTime(freq * 0.6, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gain, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.master!);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  private noiseBurst(freq: number, dur: number, gain: number, type: BiquadFilterType): void {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer!;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = 1.2;
    const g = ctx.createGain();
    const t = ctx.currentTime;
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(this.master!);
    src.start(t, Math.random() * 3, dur + 0.05);
  }

  private footstep(): void {
    const hard = this.zone === "utility" || this.zone === "airlock";
    const freq = hard ? 520 + Math.random() * 260 : 900 + Math.random() * 700;
    this.noiseBurst(freq, 0.1, hard ? 0.075 : 0.045, hard ? "bandpass" : "highpass");
    if (Math.random() > 0.72) this.thud(80 + Math.random() * 30, 0.09, 0.03);
  }

  private drip(): void {
    const ctx = this.ctx!;
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    o.type = "sine";
    o.frequency.setValueAtTime(1100 + Math.random() * 500, t);
    o.frequency.exponentialRampToValueAtTime(320, t + 0.09);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.055, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.16);
    o.connect(g).connect(this.master!);
    o.start(t);
    o.stop(t + 0.2);
    this.noiseBurst(2600, 0.05, 0.02, "bandpass");
  }

  private surge(): void {
    const ctx = this.ctx!;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer!;
    const f = ctx.createBiquadFilter();
    f.type = "lowpass";
    f.frequency.setValueAtTime(200, t);
    f.frequency.exponentialRampToValueAtTime(4000, t + 0.6);
    f.frequency.exponentialRampToValueAtTime(300, t + 2.2);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.16, t + 0.5);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 2.4);
    src.connect(f).connect(g).connect(this.master!);
    src.start(t, 0, 2.6);
    this.alarmUntil = t + 8;
    this.alarm(this.alarmUntil);
  }

  private alarm(until: number): void {
    const ctx = this.ctx!;
    const t0 = ctx.currentTime;
    const step = () => {
      if (!this.ctx || ctx.currentTime > until) return;
      const t = ctx.currentTime;
      const o = ctx.createOscillator();
      o.type = "square";
      o.frequency.value = Math.floor((t - t0) * 0.8) % 2 === 0 ? 440 : 587;
      const f = ctx.createBiquadFilter();
      f.type = "lowpass";
      f.frequency.value = 900;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.028, t + 0.05);
      g.gain.setValueAtTime(0.028, t + 0.42);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.5);
      o.connect(f).connect(g).connect(this.master!);
      o.start(t);
      o.stop(t + 0.55);
      window.setTimeout(step, 620);
    };
    step();
  }

  /** Very quiet, heavily gated noise - suggests a distant PA no one is manning. */
  private chatter(): void {
    const ctx = this.ctx!;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer!;
    const f = ctx.createBiquadFilter();
    f.type = "bandpass";
    f.frequency.value = 480;
    f.Q.value = 6;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    for (let i = 0; i < 9; i++) {
      const on = Math.random() > 0.45;
      g.gain.linearRampToValueAtTime(on ? 0.02 : 0.002, t + i * 0.11);
    }
    g.gain.exponentialRampToValueAtTime(0.0001, t + 1.2);
    src.connect(f).connect(g).connect(this.master!);
    src.start(t, Math.random() * 3, 1.4);
  }

  private makeNoise(ctx: AudioContext, seconds: number): AudioBuffer {
    const len = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) {
      const white = Math.random() * 2 - 1;
      last = 0.98 * last + 0.02 * white;
      data[i] = white * 0.7 + last * 3.0;
    }
    return buf;
  }

  private loop(): void {
    if (!this.started) return;
    this.nextDrip -= 1 / 60;
    this.nextCreak -= 1 / 60;
    this.nextChatter -= 1 / 60;
    if (this.nextDrip <= 0) {
      this.nextDrip = 3.5 + Math.random() * 7;
      if (Math.random() > 0.35) this.drip();
    }
    if (this.nextCreak <= 0) {
      this.nextCreak = 16 + Math.random() * 26;
      this.noiseBurst(240 + Math.random() * 200, 1.6, 0.03, "bandpass");
    }
    if (this.nextChatter <= 0) {
      this.nextChatter = 30 + Math.random() * 45;
      if (Math.random() > 0.4) this.chatter();
    }
    this.timer = window.setTimeout(() => this.loop(), 1000 / 15);
  }
}
