import { VOICE, type Vec3 } from "../../shared/level";
import { REVERB_REGIONS, regionWeights } from "../../shared/acoustics";
export type Emitter = {
  input: GainNode;
  panner: PannerNode;
  range: GainNode;
  dry: GainNode;
  sends: Map<string, GainNode>;
  position: Vec3;
  dispose: () => void;
};
/** One synthesized voice per event: a tone that falls or rises, plus filtered noise. */
type EffectSpec = {
  volume: number;
  duration: number;
  from: number;
  to: number;
  noise: number;
  cutoff: number;
  type?: OscillatorType;
};
const EFFECTS: Record<string, EffectSpec> = {
  step: { volume: 0.1, duration: 0.095, from: 105, to: 42, noise: 0.9, cutoff: 650 },
  "step-soft": { volume: 0.04, duration: 0.095, from: 105, to: 42, noise: 0.9, cutoff: 650 },
  jump: { volume: 0.13, duration: 0.2, from: 210, to: 460, noise: 0.3, cutoff: 1800 },
  pickup: { volume: 0.16, duration: 0.18, from: 420, to: 680, noise: 0.3, cutoff: 650 },
  // A card locked in during the build phase: a short rising chirp.
  lock: {
    volume: 0.2,
    duration: 0.26,
    from: 520,
    to: 1040,
    noise: 0.1,
    cutoff: 2600,
    type: "triangle",
  },
  // A supply gun coming in from the sky: a long descending whistle.
  drop: {
    volume: 0.13,
    duration: 0.5,
    from: 1400,
    to: 240,
    noise: 0.5,
    cutoff: 1500,
    type: "triangle",
  },
  shoot: {
    volume: 0.3,
    duration: 0.17,
    from: 820,
    to: 70,
    noise: 1.1,
    cutoff: 3200,
    type: "triangle",
  },
  // The buzz gun: the same report, thinner and quicker.
  "shoot-fast": {
    volume: 0.22,
    duration: 0.1,
    from: 980,
    to: 120,
    noise: 0.95,
    cutoff: 3800,
    type: "triangle",
  },
  // The fan gun and the long shot: a heavier report with more low end.
  "shoot-heavy": {
    volume: 0.38,
    duration: 0.24,
    from: 620,
    to: 45,
    noise: 1.35,
    cutoff: 2400,
    type: "triangle",
  },
  // The boom tube's pneumatic launch, before the shell's own boom lands.
  launch: {
    volume: 0.3,
    duration: 0.3,
    from: 220,
    to: 60,
    noise: 1.1,
    cutoff: 900,
    type: "square",
  },
  swing: { volume: 0.18, duration: 0.16, from: 340, to: 95, noise: 0.8, cutoff: 1400 },
  hit: { volume: 0.3, duration: 0.26, from: 220, to: 38, noise: 0.7, cutoff: 700 },
  bounce: { volume: 0.17, duration: 0.13, from: 470, to: 140, noise: 0.22, cutoff: 1300 },
  door: { volume: 0.12, duration: 0.55, from: 120, to: 80, noise: 0.45, cutoff: 420 },
  slam: { volume: 0.42, duration: 0.3, from: 75, to: 30, noise: 1.25, cutoff: 380 },
  glass: { volume: 0.5, duration: 0.4, from: 2600, to: 700, noise: 1.3, cutoff: 7000 },
  boom: { volume: 0.55, duration: 0.6, from: 120, to: 30, noise: 1.5, cutoff: 400 },
  clack: { volume: 0.12, duration: 0.07, from: 950, to: 320, noise: 0.5, cutoff: 2600 },
  thud: { volume: 0.3, duration: 0.22, from: 150, to: 44, noise: 0.85, cutoff: 520 },
  crash: { volume: 0.5, duration: 0.42, from: 95, to: 27, noise: 1.6, cutoff: 950 },
  chug: { volume: 0.4, duration: 0.16, from: 85, to: 42, noise: 1.1, cutoff: 260, type: "square" },
  default: { volume: 0.16, duration: 0.18, from: 180, to: 60, noise: 0.3, cutoff: 650 },
};
export class SpatialAudio {
  context: AudioContext;
  master: GainNode;
  convolvers = new Map<string, ConvolverNode>();
  emitters = new Set<Emitter>();
  zone = 0;
  private noise: AudioBuffer;
  private horn?: AudioBuffer;
  constructor() {
    this.context = new AudioContext({
      latencyHint: "interactive",
      sampleRate: 48000,
    });
    const c = this.context;
    // Original deterministic noise, synthesized here; no recordings or third-party samples.
    this.noise = c.createBuffer(
      1,
      Math.ceil(c.sampleRate * 0.22),
      c.sampleRate,
    );
    const samples = this.noise.getChannelData(0);
    let seed = 7319;
    for (let i = 0; i < samples.length; i++) {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      samples[i] = (seed / 4294967296) * 2 - 1;
    }
    this.master = c.createGain();
    this.master.gain.value = 0.8;
    const limiter = c.createDynamicsCompressor();
    limiter.threshold.value = -5;
    limiter.ratio.value = 12;
    this.master.connect(limiter).connect(c.destination);
    for (const region of REVERB_REGIONS) {
      const convolver = c.createConvolver();
      convolver.connect(this.master);
      this.convolvers.set(region.id, convolver);
    }
  }
  async init() {
    await Promise.all([
      ...REVERB_REGIONS.map(async (region) => {
        const response = await fetch(
          new URL(region.impulse, document.baseURI),
        );
        this.convolvers.get(region.id)!.buffer =
          await this.context.decodeAudioData(await response.arrayBuffer());
      }),
      fetch(new URL("audio/horn.ogg", document.baseURI))
        .then((response) => response.arrayBuffer())
        .then((data) => this.context.decodeAudioData(data))
        .then((buffer) => (this.horn = buffer)),
    ]);
  }
  emitter(): Emitter {
    const c = this.context,
      input = c.createGain(),
      panner = c.createPanner(),
      range = c.createGain(),
      dry = c.createGain();
    const sends = new Map<string, GainNode>();
    panner.panningModel = "HRTF";
    panner.distanceModel = VOICE.distanceModel;
    panner.refDistance = VOICE.refDistance;
    panner.maxDistance = VOICE.maxDistance;
    panner.rolloffFactor = VOICE.rolloff;
    input.connect(panner).connect(range);
    range.connect(dry).connect(this.master);
    for (const [id, convolver] of this.convolvers) {
      const gain = c.createGain();
      gain.gain.value = 0;
      range.connect(gain).connect(convolver);
      sends.set(id, gain);
    }
    const e: Emitter = {
      input,
      panner,
      range,
      dry,
      sends,
      position: { x: 0, y: 0, z: 0 },
      dispose: () => {
        for (const n of [input, panner, range, dry, ...sends.values()])
          n.disconnect();
        this.emitters.delete(e);
      },
    };
    this.emitters.add(e);
    return e;
  }
  update(listener: Vec3, yaw: number, pitch: number) {
    const c = this.context,
      t = c.currentTime,
      l = c.listener;
    const values = [
      l.positionX,
      l.positionY,
      l.positionZ,
      l.forwardX,
      l.forwardY,
      l.forwardZ,
      l.upX,
      l.upY,
      l.upZ,
    ];
    const sin = Math.sin,
      cos = Math.cos;
    const v = [
      listener.x,
      listener.y,
      listener.z,
      -sin(yaw) * cos(pitch),
      -sin(pitch),
      -cos(yaw) * cos(pitch),
      -sin(yaw) * sin(pitch),
      cos(pitch),
      -cos(yaw) * sin(pitch),
    ];
    values.forEach((p, i) => p.setTargetAtTime(v[i], t, 0.015));
    const listenerWeights = regionWeights(listener);
    this.zone = listenerWeights.get("hall") ?? 0;
    for (const e of this.emitters) {
      e.panner.positionX.setTargetAtTime(e.position.x, t, 0.015);
      e.panner.positionY.setTargetAtTime(e.position.y, t, 0.015);
      e.panner.positionZ.setTargetAtTime(e.position.z, t, 0.015);
      const d = Math.hypot(
          e.position.x - listener.x,
          e.position.y - listener.y,
          e.position.z - listener.z,
        ),
        fade = Math.max(0, Math.min(1, (VOICE.maxDistance - d) / 3));
      e.range.gain.setTargetAtTime(fade, t, 0.03);
      const speakerWeights = regionWeights(e.position);
      const overlap = REVERB_REGIONS.reduce(
        (sum, region) =>
          sum +
          Math.min(
            listenerWeights.get(region.id) ?? 0,
            speakerWeights.get(region.id) ?? 0,
          ),
        0,
      );
      for (const region of REVERB_REGIONS)
        e.sends
          .get(region.id)!
          .gain.setTargetAtTime(
            (listenerWeights.get(region.id) ?? 0) *
              region.wet *
              (0.5 + 0.5 * overlap),
            t,
            0.08,
          );
      e.dry.gain.value = 1;
    }
  }
  effect(position: Vec3, kind: string, intensity = 1) {
    if (this.context.state !== "running") return;
    const e = this.emitter();
    e.position = { ...position };
    const c = this.context;
    if (kind === "honk" && this.horn) {
      const source = c.createBufferSource(),
        gain = c.createGain();
      source.buffer = this.horn;
      gain.gain.value = 0.72;
      source.connect(gain).connect(e.input);
      source.start();
      source.onended = () => {
        source.disconnect();
        gain.disconnect();
        setTimeout(() => e.dispose(), 2000);
      };
      return;
    }
    const
      o = c.createOscillator(),
      g = c.createGain();
    const { volume, duration, from, to, noise, cutoff, type } =
      EFFECTS[kind] ?? EFFECTS.default;
    // The harder the interaction, the bigger it feels (design doc §17).
    const k = 0.35 + 0.65 * Math.max(0, Math.min(1, intensity)),
      f = 0.85 + 0.4 * Math.max(0, Math.min(1, intensity));
    o.type = type ?? "sine";
    o.frequency.setValueAtTime(from * f, c.currentTime);
    o.frequency.exponentialRampToValueAtTime(to * f, c.currentTime + duration);
    g.gain.setValueAtTime(0.001, c.currentTime);
    g.gain.linearRampToValueAtTime(volume * k, c.currentTime + 0.008);
    g.gain.exponentialRampToValueAtTime(0.001, c.currentTime + duration);
    o.connect(g).connect(e.input);
    const scuff = c.createBufferSource(),
      filter = c.createBiquadFilter(),
      rustle = c.createGain();
    scuff.buffer = this.noise;
    filter.type = "lowpass";
    filter.frequency.value = cutoff;
    rustle.gain.setValueAtTime(volume * noise * k, c.currentTime);
    rustle.gain.exponentialRampToValueAtTime(0.001, c.currentTime + duration);
    scuff.connect(filter).connect(rustle).connect(e.input);
    scuff.start();
    scuff.stop(c.currentTime + duration);
    o.start();
    o.stop(c.currentTime + duration + 0.02);
    o.onended = () => {
      o.disconnect();
      g.disconnect();
      scuff.disconnect();
      filter.disconnect();
      rustle.disconnect();
      setTimeout(() => e.dispose(), 2000);
    };
  }
  /**
   * Comedic reactions on elimination (design doc §17): a long falling whistle
   * for whoever leaves the arena, a descending womp-womp for everyone else.
   */
  reaction(position: Vec3, kind: "fall" | "womp") {
    if (this.context.state !== "running") return;
    const e = this.emitter();
    e.position = { ...position };
    const c = this.context,
      t0 = c.currentTime;
    if (kind === "fall") {
      const o = c.createOscillator(),
        g = c.createGain();
      o.type = "sine";
      o.frequency.setValueAtTime(1400, t0);
      o.frequency.exponentialRampToValueAtTime(160, t0 + 0.75);
      g.gain.setValueAtTime(0.001, t0);
      g.gain.linearRampToValueAtTime(0.22, t0 + 0.03);
      g.gain.exponentialRampToValueAtTime(0.001, t0 + 0.85);
      o.connect(g).connect(e.input);
      o.start(t0);
      o.stop(t0 + 0.9);
      const scuff = c.createBufferSource(),
        filter = c.createBiquadFilter(),
        rustle = c.createGain();
      scuff.buffer = this.noise;
      filter.type = "lowpass";
      filter.frequency.value = 300;
      rustle.gain.setValueAtTime(0.001, t0);
      rustle.gain.linearRampToValueAtTime(0.5, t0 + 0.72);
      rustle.gain.exponentialRampToValueAtTime(0.001, t0 + 1.0);
      scuff.connect(filter).connect(rustle).connect(e.input);
      scuff.start(t0 + 0.68);
      scuff.stop(t0 + 1.05);
      o.onended = () => {
        o.disconnect();
        g.disconnect();
        scuff.disconnect();
        filter.disconnect();
        rustle.disconnect();
        setTimeout(() => e.dispose(), 2000);
      };
      return;
    }
    // Womp womp: three descending trombone notes.
    let t = t0;
    for (const hertz of [233, 196, 147]) {
      const o = c.createOscillator(),
        g = c.createGain();
      o.type = "triangle";
      o.frequency.setValueAtTime(hertz * 1.02, t);
      o.frequency.linearRampToValueAtTime(hertz * 0.97, t + 0.26);
      g.gain.setValueAtTime(0.001, t);
      g.gain.linearRampToValueAtTime(0.24, t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.3);
      o.connect(g).connect(e.input);
      o.start(t);
      o.stop(t + 0.32);
      t += 0.28;
    }
    setTimeout(() => e.dispose(), (t - t0) * 1000 + 400);
  }
}
