declare const sampleRate: number;
declare const currentTime: number;
declare abstract class AudioWorkletProcessor {
  port: MessagePort;
  constructor(options?: unknown);
  abstract process(
    inputs: Float32Array[][],
    outputs: Float32Array[][],
  ): boolean;
}
declare function registerProcessor(
  name: string,
  ctor: typeof AudioWorkletProcessor,
): void;
class Capture extends AudioWorkletProcessor {
  chunk = new Float32Array(960);
  n = 0;
  phase = 0;
  last = 0;
  process(inputs: Float32Array[][]) {
    const data = inputs[0]?.[0];
    if (!data) return true;
    for (const value of data) {
      this.phase += 48000 / sampleRate;
      while (this.phase >= 1) {
        this.chunk[this.n++] = value;
        this.phase--;
        if (this.n === 960) {
          this.port.postMessage({ pcm: this.chunk, time: currentTime }, [
            this.chunk.buffer,
          ]);
          this.chunk = new Float32Array(960);
          this.n = 0;
        }
      }
    }
    return true;
  }
}
class Playback extends AudioWorkletProcessor {
  ring = new Float32Array(16384);
  read = 0;
  write = 0;
  count = 0;
  playing = false;
  phase = 0;
  value = 0;
  target = 2880;
  underruns = 0;
  frames = 0;
  constructor() {
    super();
    this.port.onmessage = (e) => {
      if (e.data.reset) {
        this.count = 0;
        this.read = this.write;
        this.playing = false;
        return;
      }
      const pcm: Float32Array = e.data.pcm;
      if (!pcm) return;
      if (this.count + pcm.length > 5760) {
        this.read = this.write;
        this.count = 0;
        this.playing = false;
      }
      for (const v of pcm) {
        this.ring[this.write++ % this.ring.length] = v;
        this.count++;
      }
    };
  }
  process(_inputs: Float32Array[][], outputs: Float32Array[][]) {
    const out = outputs[0]?.[0];
    if (!out) return true;
    if (!this.playing && this.count >= this.target) this.playing = true;
    const correction =
      this.count > this.target + 960
        ? 1.01
        : this.count < this.target - 960
          ? 0.99
          : 1;
    for (let i = 0; i < out.length; i++) {
      if (!this.playing) {
        out[i] = 0;
        continue;
      }
      this.phase += (48000 / sampleRate) * correction;
      while (this.phase >= 1) {
        if (!this.count) {
          this.playing = false;
          this.underruns++;
          this.target = Math.min(5760, this.target + 240);
          this.value *= 0.9;
          break;
        }
        this.value = this.ring[this.read++ % this.ring.length];
        this.count--;
        this.phase--;
      }
      out[i] = this.playing ? this.value : 0;
    }
    if (++this.frames % 375 === 0) {
      this.port.postMessage({
        bufferMs: this.count / 48,
        underruns: this.underruns,
      });
      this.target = Math.max(1920, this.target - 48);
    }
    return true;
  }
}
// A per-speaker voice effect: a streaming resampler (rate ≠ 1 bends pitch and
// speed together, tape-style) plus optional ring-modulation for the
// walkie-talkie voice. The ring holds two seconds of audio; at slow rates a
// very long monologue eventually skips its oldest tail rather than grow
// forever. With `on` false (or rate 1 and no radio) it is a zero-latency copy.
class VoiceFx extends AudioWorkletProcessor {
  on = false;
  rate = 1;
  radio = 0;
  ring = new Float32Array(98304);
  written = 0;
  p = 0;
  last = 0;
  phase = 0;
  constructor() {
    super();
    this.port.onmessage = (e) => {
      const d = e.data || {};
      if (typeof d.rate === "number" && d.rate > 0) this.rate = d.rate;
      if (typeof d.radio === "number" && d.radio >= 0) this.radio = d.radio;
      if (typeof d.on === "boolean") this.on = d.on;
      // A changed effect drops the buffered tail so the old voice does not
      // leak into the new one.
      this.written = 0;
      this.p = 0;
      this.last = 0;
    };
  }
  process(inputs: Float32Array[][], outputs: Float32Array[][]) {
    const data = inputs[0]?.[0];
    const out = outputs[0]?.[0];
    if (!out) return true;
    if (!data || !this.on) {
      for (let i = 0; i < out.length; i++) out[i] = data ? data[i] : 0;
      return true;
    }
    const C = this.ring.length;
    if (this.rate === 1 && this.radio === 0) {
      for (let i = 0; i < out.length; i++) out[i] = data[i];
      return true;
    }
    for (const v of data) {
      this.ring[this.written % C] = v;
      this.written++;
    }
    if (this.rate < 1 && this.written - this.p > C)
      this.p += this.written - this.p - C;
    for (let i = 0; i < out.length; i++) {
      const n0 = Math.floor(this.p);
      if (this.written - n0 < 1) {
        // Underrun: hold the last sample, decaying so silence stays silent.
        out[i] = (this.last *= 0.9);
        continue;
      }
      const a = this.ring[n0 % C];
      const b = this.written - n0 >= 2 ? this.ring[(n0 + 1) % C] : a;
      out[i] = a + (b - a) * (this.p - n0);
      this.last = out[i];
      this.p += this.rate;
    }
    if (this.radio > 0) {
      const w = (2 * Math.PI * this.radio) / sampleRate;
      for (let i = 0; i < out.length; i++) {
        this.phase += w;
        out[i] *= 0.35 + 0.65 * (0.5 + 0.5 * Math.cos(this.phase));
      }
    }
    return true;
  }
}
registerProcessor("capture", Capture);
registerProcessor("playback", Playback);
registerProcessor("voicefx", VoiceFx);
