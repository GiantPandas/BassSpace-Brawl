export type PlayerState = {
  id: number;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  yaw: number;
  pitch: number;
  flags: number;
  held: number;
  /** Ticks of lost footing left after a hit; steering is damped while it runs. */
  stagger: number;
  /** Air jumps spent this airborne arc (bunny-hop); reset on landing. */
  jumps: number;
  /** Health left this round; zero means the round is over for you. */
  hp: number;
  /** 1 once eliminated (zero HP or out of bounds); inert until respawn. */
  out: number;
  /** Pellets left in the magazine, as the authority last said. */
  ammo: number;
  /** Rounds left behind that magazine for the gun in hand; zero means the gun
   * is spent and only good for throwing. */
  reserve: number;
  /** Bitmask of picked upgrade-card indices in CARDS; survives respawns. */
  build: number;
  ack: number;
  /** Ticks left in the pool basin; zero means out of the water (design doc §10). */
  pool: number;
  /** Ticks left on the ballistic flight after the pool spits the player out. */
  launch: number;
  /** Ticks of raised shield left; zero means no bubble (see COMBAT.blockTicks). */
  block: number;
  /** Ticks left until the shield may be raised again (see COMBAT.blockCooldown). */
  cool: number;
};
export type PropState = {
  id: number;
  x: number;
  y: number;
  z: number;
  qx: number;
  qy: number;
  qz: number;
  qw: number;
  owner: number;
};
export type Snapshot = {
  tick: number;
  baseline: number;
  full: boolean;
  players: PlayerState[];
  props: PropState[];
};
export type Input = {
  seq: number;
  x: number;
  z: number;
  yaw: number;
  pitch: number;
  buttons: number;
};
export const BUTTON = { JUMP: 1, SPRINT: 2, CROUCH: 4, DASH: 8, BLOCK: 16 };
/** Wire version. 8 adds the gun's spare rounds (`reserve`) to the player record. */
export const VERSION = 8;
export class Writer {
  buffer = new ArrayBuffer(16384);
  v = new DataView(this.buffer);
  n = 0;
  u8(n: number) {
    this.v.setUint8(this.n, n);
    this.n++;
    return this;
  }
  u16(n: number) {
    this.v.setUint16(this.n, n, true);
    this.n += 2;
    return this;
  }
  i16(n: number) {
    this.v.setInt16(
      this.n,
      Math.max(-32768, Math.min(32767, Math.round(n))),
      true,
    );
    this.n += 2;
    return this;
  }
  u32(n: number) {
    this.v.setUint32(this.n, n, true);
    this.n += 4;
    return this;
  }
  f32(n: number) {
    this.v.setFloat32(this.n, n, true);
    this.n += 4;
    return this;
  }
  end() {
    return this.buffer.slice(0, this.n);
  }
}
export class Reader {
  v: DataView;
  n = 0;
  constructor(b: ArrayBuffer) {
    this.v = new DataView(b);
  }
  u8() {
    return this.v.getUint8(this.n++);
  }
  u16() {
    const x = this.v.getUint16(this.n, true);
    this.n += 2;
    return x;
  }
  i16() {
    const x = this.v.getInt16(this.n, true);
    this.n += 2;
    return x;
  }
  u32() {
    const x = this.v.getUint32(this.n, true);
    this.n += 4;
    return x;
  }
  f32() {
    const x = this.v.getFloat32(this.n, true);
    this.n += 4;
    if (!Number.isFinite(x)) throw Error("Non-finite float");
    return x;
  }
  done() {
    if (this.n !== this.v.byteLength) throw Error("Unexpected message length");
  }
}
export function encodeInputs(inputs: Input[], baseline: number) {
  const w = new Writer().u8(VERSION).u8(1).u8(inputs.length).u32(baseline);
  for (const i of inputs)
    w.u32(i.seq)
      .i16(i.x * 32767)
      .i16(i.z * 32767)
      .f32(i.yaw)
      .f32(i.pitch)
      .u8(i.buttons);
  return w.end();
}
export function decodeInputs(b: ArrayBuffer) {
  const r = new Reader(b);
  if (r.u8() !== VERSION || r.u8() !== 1) throw Error("Invalid input");
  const n = r.u8();
  if (n > 8) throw Error("Too many inputs");
  const baseline = r.u32();
  const inputs: Input[] = [];
  for (let k = 0; k < n; k++)
    inputs.push({
      seq: r.u32(),
      x: r.i16() / 32767,
      z: r.i16() / 32767,
      yaw: r.f32(),
      pitch: r.f32(),
      buttons: r.u8(),
    });
  r.done();
  return { inputs, baseline };
}
export function encodeSnapshot(s: Snapshot) {
  const w = new Writer()
    .u8(VERSION)
    .u8(2)
    .u8(s.full ? 1 : 0)
    .u32(s.tick)
    .u32(s.baseline)
    .u8(s.players.length)
    .u16(s.props.length);
  for (const p of s.players)
    w.u16(p.id)
      .f32(p.x)
      .f32(p.y)
      .f32(p.z)
      .f32(p.vx)
      .f32(p.vy)
      .f32(p.vz)
      .i16((p.yaw / Math.PI) * 32767)
      .i16((p.pitch / Math.PI) * 32767)
      .u8(p.flags)
      .u16(p.held)
      .u8(Math.max(0, Math.min(255, p.stagger)))
      .u8(Math.max(0, Math.min(255, p.jumps)))
      .u8(Math.max(0, Math.min(255, p.hp)))
      .u8(p.out ? 1 : 0)
      .u8(Math.max(0, Math.min(255, p.ammo)))
      .u8(Math.max(0, Math.min(255, p.reserve)))
      .u32(p.build)
      .u32(p.ack)
      .u8(Math.max(0, Math.min(255, p.pool)))
      .u8(Math.max(0, Math.min(255, p.launch)))
      .u8(Math.max(0, Math.min(255, p.block)))
      .u8(Math.max(0, Math.min(255, p.cool)));
  for (const p of s.props)
    w.u16(p.id)
      .i16(p.x * 100)
      .i16(p.y * 100)
      .i16(p.z * 100)
      .i16(p.qx * 32767)
      .i16(p.qy * 32767)
      .i16(p.qz * 32767)
      .i16(p.qw * 32767)
      .u16(p.owner);
  return w.end();
}
export function decodeSnapshot(b: ArrayBuffer): Snapshot {
  const r = new Reader(b);
  if (r.u8() !== VERSION || r.u8() !== 2) throw Error("Invalid snapshot");
  const full = !!r.u8(),
    tick = r.u32(),
    baseline = r.u32(),
    np = r.u8(),
    no = r.u16();
  if (np > 8 || no > 128) throw Error("Entity limit");
  const players: PlayerState[] = [],
    props: PropState[] = [];
  for (let i = 0; i < np; i++)
    players.push({
      id: r.u16(),
      x: r.f32(),
      y: r.f32(),
      z: r.f32(),
      vx: r.f32(),
      vy: r.f32(),
      vz: r.f32(),
      yaw: (r.i16() / 32767) * Math.PI,
      pitch: (r.i16() / 32767) * Math.PI,
      flags: r.u8(),
      held: r.u16(),
      stagger: r.u8(),
      jumps: r.u8(),
      hp: r.u8(),
      out: r.u8(),
      ammo: r.u8(),
      reserve: r.u8(),
      build: r.u32(),
      ack: r.u32(),
      pool: r.u8(),
      launch: r.u8(),
      block: r.u8(),
      cool: r.u8(),
    });
  for (let i = 0; i < no; i++)
    props.push({
      id: r.u16(),
      x: r.i16() / 100,
      y: r.i16() / 100,
      z: r.i16() / 100,
      qx: r.i16() / 32767,
      qy: r.i16() / 32767,
      qz: r.i16() / 32767,
      qw: r.i16() / 32767,
      owner: r.u16(),
    });
  r.done();
  return { full, tick, baseline, players, props };
}
export function changedProp(a: PropState, b: PropState) {
  return (
    a.owner !== b.owner ||
    ["x", "y", "z"].some(
      (k) => Math.round(a[k as "x"] * 100) !== Math.round(b[k as "x"] * 100),
    ) ||
    ["qx", "qy", "qz", "qw"].some(
      (k) =>
        Math.round(a[k as "qx"] * 32767) !== Math.round(b[k as "qx"] * 32767),
    )
  );
}
// The source ID is stamped by the server; clients cannot impersonate another speaker.
export function voicePacket(
  epoch: number,
  seq: number,
  timestamp: number,
  payload: Uint8Array,
) {
  const b = new ArrayBuffer(18 + payload.length),
    v = new DataView(b);
  v.setUint8(0, VERSION);
  v.setUint8(1, 3);
  v.setUint16(2, 0, true);
  v.setUint32(4, epoch, true);
  v.setUint32(8, seq, true);
  v.setUint32(12, timestamp, true);
  v.setUint16(16, payload.length, true);
  new Uint8Array(b, 18).set(payload);
  return b;
}
export function readVoice(b: ArrayBuffer) {
  const v = new DataView(b);
  if (
    b.byteLength < 18 ||
    v.getUint8(0) !== VERSION ||
    v.getUint8(1) !== 3 ||
    v.getUint16(16, true) !== b.byteLength - 18 ||
    b.byteLength > 1500
  )
    throw Error("Invalid voice frame");
  return {
    id: v.getUint16(2, true),
    epoch: v.getUint32(4, true),
    seq: v.getUint32(8, true),
    timestamp: v.getUint32(12, true),
    payload: new Uint8Array(b, 18),
  };
}
