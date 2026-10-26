import RAPIER from "@dimforge/rapier3d-compat";
import {
  AUTO_RANGE,
  DOOR_SLAM,
  DOOR_TRAVEL,
  GUNS,
  HORN,
  IMPACT,
  MELEE,
  STEP,
  TINY_ARENA,
  WEAPON,
  WINDOW,
  gunReloadTicks,
  isGun,
  magazineOf,
  type Door,
  type GunKind,
  type GunSpec,
  type PropKind,
  type WindowDef,
} from "./level.js";
import { DEFAULT_ARENA } from "./arena.js";
import { CHAOS, COMBAT } from "./match.js";
import { buildStats, type BuildStats } from "./upgrades.js";
import {
  BUTTON,
  type Input,
  type PlayerState,
  type PropState,
} from "./protocol.js";
export { RAPIER };
// Keep WASM initialization stable across in-process development module reloads.
const runtime = globalThis as typeof globalThis & {
  __friendslopPhysicsReady?: Promise<void>;
};
export function initPhysics() {
  return (runtime.__friendslopPhysicsReady ??= RAPIER.init());
}
export type Character = {
  state: PlayerState;
  body: RAPIER.RigidBody;
  collider: RAPIER.Collider;
  controller: RAPIER.KinematicCharacterController;
};
/** A leaf slides between `def.p` (shut) and `def.p + def.slide` (open). */
export type DoorRuntime = {
  def: Door;
  body: RAPIER.RigidBody;
  collider: RAPIER.Collider;
  /** What the authority last said. Automatic doors add local proximity on top. */
  remote: boolean;
  open: boolean;
  progress: number;
  /** This tick's leaf displacement, for DOOR SLAMMER shoves. */
  moved: { x: number; y: number; z: number };
  /** Players already launched by this pass; cleared when the leaf reverses. */
  slammed: Set<number>;
};
export type DoorState = { id: number; open: boolean; progress: number };
/** A pane's frame is static; only its broken state travels. */
export type WindowRuntime = {
  def: WindowDef;
  body: RAPIER.RigidBody;
  collider: RAPIER.Collider;
  broken: boolean;
};
export type WindowState = { id: number; broken: boolean };
export type Shot = {
  id: number;
  object: number;
  x: number;
  y: number;
  z: number;
  dx: number;
  dy: number;
  dz: number;
  distance: number;
  hit: number;
  /** The live body this shot created, riding the prop channel. */
  pellet?: number;
  /** Every direction of a TRIPLE SHOT, so viewers see the full fan. */
  dirs?: { dx: number; dy: number; dz: number }[];
};
/** Pellet ids start here so they never collide with the fixed prop set. */
export const PELLET_ID_BASE = 1000;
/** One live pellet body and how long it gets to fly. */
export type Pellet = {
  body: RAPIER.RigidBody;
  creator: number;
  expires: number;
  /** Velocity before the current step's resolution, for impact reads. */
  v: { x: number; y: number; z: number };
  /** Bounces left before it fizzles (BOUNCY/RICOCHET never run out). */
  bounces: number;
  /** Launch speed, kept so HOMING can re-energise a slowing pellet. */
  speed: number;
  /** Which gun fired it: its shove, HP scale and stagger ride the hit. */
  gun: GunKind;
  /** BOOM TUBE shells burst on contact, with the card's blast as an override. */
  explosive: boolean;
  /** SEEKER rounds curve even without the HOMING card. */
  homing: boolean;
};
export type Swing = { id: number; object: number; hit: number };
/** Per-kind default restitutions; chaos "bounce" overrides them all. */
const PROP_BOUNCE: Record<PropKind, number> = {
  ball: 0.86,
  gun: 0.1,
  smg: 0.1,
  shotgun: 0.1,
  rifle: 0.1,
  launcher: 0.1,
  seeker: 0.1,
  bat: 0.2,
  horn: 0.14,
  chair: 0.2,
  table: 0.1,
  trashcan: 0.15,
  bottle: 0.3,
  bucket: 0.12,
  crate: 0.18,
};
/** Each prop kind is a different thing to throw: a crate thuds, a ball bounces. */
function shape(kind: PropKind) {
  if (kind === "ball")
    return RAPIER.ColliderDesc.ball(0.3)
      .setMass(0.9)
      .setFriction(0.45)
      .setRestitution(0.86)
      .setRestitutionCombineRule(RAPIER.CoefficientCombineRule.Max);
  if (isGun(kind)) {
    // Every gun is a hard metal box; only its heft and length differ.
    const [hx, hy, hz] = GUNS[kind].collider.s;
    return RAPIER.ColliderDesc.cuboid(hx, hy, hz)
      .setMass(GUNS[kind].collider.mass)
      .setFriction(0.7)
      .setRestitution(0.1);
  }
  if (kind === "bat")
    return RAPIER.ColliderDesc.cuboid(0.09, 0.09, 0.55)
      .setMass(0.95)
      .setFriction(0.72)
      .setRestitution(0.2);
  if (kind === "horn")
    return RAPIER.ColliderDesc.cuboid(0.16, 0.13, 0.32)
      .setMass(0.7)
      .setFriction(0.68)
      .setRestitution(0.14);
  if (kind === "chair")
    return RAPIER.ColliderDesc.cuboid(0.28, 0.45, 0.28)
      .setMass(1.2)
      .setFriction(0.7)
      .setRestitution(0.2);
  if (kind === "table")
    return RAPIER.ColliderDesc.cuboid(0.42, 0.38, 0.42)
      .setMass(2.2)
      .setFriction(0.75)
      .setRestitution(0.1);
  if (kind === "trashcan")
    return RAPIER.ColliderDesc.cuboid(0.21, 0.3, 0.21)
      .setMass(1.4)
      .setFriction(0.78)
      .setRestitution(0.15);
  if (kind === "bottle")
    return RAPIER.ColliderDesc.cuboid(0.09, 0.24, 0.09)
      .setMass(0.7)
      .setFriction(0.65)
      .setRestitution(0.3);
  if (kind === "bucket")
    return RAPIER.ColliderDesc.cuboid(0.19, 0.17, 0.19)
      .setMass(0.9)
      .setFriction(0.72)
      .setRestitution(0.12);
  return RAPIER.ColliderDesc.cuboid(0.3, 0.3, 0.3)
    .setMass(1.5)
    .setFriction(0.8)
    .setRestitution(0.18);
}
export class Simulation {
  world = new RAPIER.World({ x: 0, y: -18, z: 0 });
  players = new Map<number, Character>();
  props = new Map<number, RAPIER.RigidBody>();
  /** Prop colliders keyed by prop id, so chaos "bounce" can retune them. */
  propColliders = new Map<number, RAPIER.Collider>();
  owners = new Map<number, number>();
  doors = new Map<number, DoorRuntime>();
  /** Door ids whose open state changed since the authority last drained them. */
  doorEvents: number[] = [];
  /** Breakable panes keyed by window id, plus ids shattered since the drain. */
  windows = new Map<number, WindowRuntime>();
  windowEvents: number[] = [];
  /** Chaos explosions since the last drain (authority only). */
  explosionEvents: { x: number; y: number; z: number }[] = [];
  /** Impacts worth hearing since the last drain (authority only, design doc §17). */
  impactEvents: { x: number; y: number; z: number; s: number }[] = [];
  /**
   * Junk cards ride on the prop itself (design doc §8): who threw it, what
   * that thrower had stacked, and whether this particular throw is angry or
   * magnetic. Cleared when the prop is picked up again or reset to its spawn.
   */
  private propMeta = new Map<
    number,
    {
      thrower: number;
      build: number;
      angry?: boolean;
      magnet?: boolean;
      born: number;
    }
  >();
  /** Players who already spent their air-dash on the current airborne arc. */
  private dashed = new Set<number>();
  /** Active env modifier ("none" off); host and clients both apply it. */
  env = "none";
  private cooldowns = new Map<number, number>();
  private meleeCooldowns = new Map<number, number>();
  private hornCooldowns = new Map<number, number>();
  private frame = 0;
  /** Live pellets; their ids start at PELLET_ID_BASE and ride the prop channel. */
  pellets = new Map<number, Pellet>();
  private nextPelletId = PELLET_ID_BASE;
  private reloadAt = new Map<number, number>();
  /** Collider handle → who it is, so contact events know what just touched. */
  private entities = new Map<
    number,
    {
      kind: "player" | "prop" | "pellet" | "window";
      id: number;
      body?: RAPIER.RigidBody;
      /** Velocity at the start of the current step (impact speeds). */
      preV?: { x: number; y: number; z: number };
    }
  >();
  private events = new RAPIER.EventQueue(true);
  /**
   * The layout is derived from the room code by `buildArena` on both sides,
   * never shipped on the wire; the Stage stays the default for tests, the
   * lobby preview and the loopback host worker.
   */
  constructor(public prediction = false, public arena = DEFAULT_ARENA) {
    this.world.timestep = STEP;
    for (const b of arena.level)
      this.world.createCollider(
        RAPIER.ColliderDesc.cuboid(b.s[0] / 2, b.s[1] / 2, b.s[2] / 2)
          .setTranslation(...b.p)
          .setFriction(0.8),
      );
    for (const def of arena.doors) {
      const body = this.world.createRigidBody(
        RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(...def.p),
      );
      const collider = this.world.createCollider(
        RAPIER.ColliderDesc.cuboid(
          def.s[0] / 2,
          def.s[1] / 2,
          def.s[2] / 2,
        ).setFriction(0.6),
        body,
      );
      this.doors.set(def.id, {
        def,
        body,
        collider,
        remote: false,
        open: false,
        progress: 0,
        moved: { x: 0, y: 0, z: 0 },
        slammed: new Set(),
      });
    }
    arena.props.forEach((prop, i) => {
      const bouncy = prop.kind === "ball";
      const body = this.world.createRigidBody(
        (prediction
          ? RAPIER.RigidBodyDesc.kinematicPositionBased()
          : RAPIER.RigidBodyDesc.dynamic()
        )
          .setTranslation(...prop.p)
          .setLinearDamping(bouncy ? 0.08 : 0.6)
          .setAngularDamping(bouncy ? 0.12 : 0.8)
          .setCcdEnabled(true),
      );
      const collider = this.world.createCollider(shape(prop.kind), body);
      this.propColliders.set(i + 1, collider);
      collider.setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS);
      this.props.set(i + 1, body);
      this.owners.set(i + 1, 0);
      this.entities.set(collider.handle, { kind: "prop", id: i + 1, body });
    });
    // Panes are heavy dynamic bodies so they raise events against player KCCs,
    // exactly like pellets do; gravity is off and step() pins them in place.
    for (const def of arena.windows) {
      const body = this.world.createRigidBody(
        RAPIER.RigidBodyDesc.dynamic()
          .setGravityScale(0)
          .setTranslation(...def.p),
      );
      const collider = this.world.createCollider(
        RAPIER.ColliderDesc.cuboid(def.s[0] / 2, def.s[1] / 2, def.s[2] / 2)
          .setMass(500)
          .setFriction(0.3)
          .setRestitution(0.4),
        body,
      );
      collider.setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS);
      this.windows.set(def.id, { def, body, collider, broken: false });
      this.entities.set(collider.handle, { kind: "window", id: def.id, body });
    }
    this.world.step();
  }
  /** Prop kind by id; ids are positions in the layout's prop list. */
  kind(objectId: number): PropKind | undefined {
    return this.arena.props[objectId - 1]?.kind;
  }
  addPlayer(id: number) {
    const spawn = this.arena.spawns[(id - 1) % this.arena.spawns.length];
    const body = this.world.createRigidBody(
      RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(
        spawn[0],
        spawn[1],
        spawn[2],
      ),
    );
    const collider = this.world.createCollider(
      RAPIER.ColliderDesc.capsule(0.55, 0.3),
      body,
    );
    collider.setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS);
    const controller = this.world.createCharacterController(0.02);
    controller.enableAutostep(0.32, 0.2, false);
    controller.enableSnapToGround(0.25);
    controller.setMaxSlopeClimbAngle(Math.PI / 4);
    controller.setMinSlopeSlideAngle(Math.PI / 3);
    controller.setApplyImpulsesToDynamicBodies(false);
    const state: PlayerState = {
      id,
      x: spawn[0],
      y: spawn[1],
      z: spawn[2],
      vx: 0,
      vy: 0,
      vz: 0,
      yaw: 0,
      pitch: 0,
      flags: 0,
      held: 0,
      stagger: 0,
      jumps: 0,
      hp: COMBAT.hpMax,
      out: 0,
      ammo: WEAPON.ammo,
      build: 0,
      ack: 0,
      pool: 0,
      launch: 0,
      block: 0,
      cool: 0,
    };
    const c = { state, body, collider, controller };
    this.players.set(id, c);
    this.entities.set(c.collider.handle, { kind: "player", id });
    return c;
  }
  removePlayer(id: number) {
    const c = this.players.get(id);
    if (!c) return;
    this.release(id);
    this.world.removeCharacterController(c.controller);
    this.world.removeRigidBody(c.body);
    this.players.delete(id);
    this.entities.delete(c.collider.handle);
    this.reloadAt.delete(id);
    this.cooldowns.delete(id);
    this.meleeCooldowns.delete(id);
    this.hornCooldowns.delete(id);
    this.dashed.delete(id);
  }
  motor(c: Character, input: Input) {
    const s = c.state,
      wasCrouched = !!(s.flags & 2);
    let crouched = !!(input.buttons & BUTTON.CROUCH);
    // Never call Rapier again from a query predicate: its Rust world is borrowed.
    // Resolve every handle before entering the WASM query.
    const excluded = new Set(
      [...this.players.values()].map((p) => p.collider.handle),
    );
    const heldCollider = s.held
      ? this.props.get(s.held)?.collider(0).handle
      : undefined;
    if (heldCollider !== undefined) excluded.add(heldCollider);
    const filter = (col: RAPIER.Collider) => !excluded.has(col.handle);
    if (s.out) {
      // Eliminated: inert until the next round's respawn puts them back.
      s.vx = 0;
      s.vz = 0;
      s.vy = Math.max(
        -30,
        s.vy - 18 * (this.env === "low-gravity" ? CHAOS.lowGravityFactor : 1) * STEP,
      );
      c.controller.computeColliderMovement(
        c.collider,
        { x: 0, y: s.vy * STEP, z: 0 },
        undefined,
        undefined,
        filter,
      );
      const m = c.controller.computedMovement();
      s.x += m.x;
      s.y += m.y;
      s.z += m.z;
      if (c.controller.computedGrounded() || Math.abs(m.y - s.vy * STEP) > 0.001)
        s.vy = 0;
      s.flags = (c.controller.computedGrounded() ? 1 : 0) | (s.flags & 2 ? 2 : 0);
      s.ack = input.seq;
      c.body.setNextKinematicTranslation({ x: s.x, y: s.y, z: s.z });
      return;
    }
    if (wasCrouched && !crouched) {
      const p = c.body.translation();
      const hit = this.world.castShape(
        p,
        { x: 0, y: 0, z: 0, w: 1 },
        { x: 0, y: 1, z: 0 },
        new RAPIER.Capsule(0.2, 0.3),
        0.01,
        0.7,
        true,
        undefined,
        undefined,
        c.collider,
        c.body,
        filter,
      );
      if (hit) crouched = true;
    }
    if (crouched !== wasCrouched) {
      c.collider.setShape(new RAPIER.Capsule(crouched ? 0.2 : 0.55, 0.3));
      s.y += crouched ? -0.35 : 0.35;
      c.body.setTranslation({ x: s.x, y: s.y, z: s.z }, true);
    }
    const length = Math.max(1, Math.hypot(input.x, input.z)),
      speed = crouched ? 2 : input.buttons & BUTTON.SPRINT ? 6 : 3.6;
    const dx =
        ((input.x * Math.cos(input.yaw) - input.z * Math.sin(input.yaw)) /
          length) *
        speed,
      dz =
        ((-input.x * Math.sin(input.yaw) - input.z * Math.cos(input.yaw)) /
          length) *
        speed;
    // A shove wins the argument with your own legs until the stagger runs out.
    const st = buildStats(s.build),
      control = s.stagger > 0 ? WEAPON.control : 1,
      slick = (s.flags & 1) && this.env === "slippery";
    const steer = st.steerRate * (slick ? CHAOS.slipFactor : 1);
    s.vx += (dx - s.vx) * Math.min(1, STEP * steer) * control;
    s.vz += (dz - s.vz) * Math.min(1, STEP * steer) * control;
    if (s.stagger > 0) s.stagger--;
    // Right-click raises the shield for a breath of ticks; the bubble stays
    // up that long whether you move or not, and one raise never stacks.
    if (input.buttons & BUTTON.BLOCK && s.cool === 0) {
      s.block = COMBAT.blockTicks;
      s.cool = COMBAT.blockCooldown;
    }
    if (s.block > 0) s.block--;
    if (s.cool > 0) s.cool--;
    if (input.buttons & BUTTON.JUMP && !(s.flags & 8) && !crouched) {
      if (s.flags & 1) {
        // Grounded jump: the usual one, plus rocket legs' little bang.
        s.vy = st.jumpVel;
        if (st.rocketLegs)
          for (const p of this.players.values()) {
            const ps = p.state;
            if (p === c || ps.out) continue;
            const dxp = ps.x - s.x,
              dzp = ps.z - s.z,
              dist = Math.hypot(dxp, dzp);
            if (dist > 2.5 || Math.abs(ps.y - s.y) > 3) continue;
            const inv = dist < 0.001 ? 0 : 1 / dist;
            ps.vx += dxp * inv * 7;
            ps.vz += dzp * inv * 7;
            ps.vy = Math.max(ps.vy, 0) + 3;
            ps.stagger = 18;
          }
      } else if (st.airJumps > 0 && s.jumps < st.airJumps) {
        // Bunny hop: one extra jump while the air is young.
        s.vy = st.jumpVel;
        s.jumps++;
      }
    }
    // AIR DASH: one hard shove per airborne arc, along your steering or aim.
    if (
      input.buttons & BUTTON.DASH &&
      st.airDash &&
      !(s.flags & 1) &&
      !this.dashed.has(s.id)
    ) {
      const lx = Math.hypot(input.x, input.z);
      const fx =
          lx > 0.1
            ? (input.x * Math.cos(input.yaw) - input.z * Math.sin(input.yaw)) /
              lx
            : -Math.sin(input.yaw),
        fz =
          lx > 0.1
            ? (-input.x * Math.sin(input.yaw) - input.z * Math.cos(input.yaw)) /
              lx
            : -Math.cos(input.yaw);
      s.vx += fx * 8;
      s.vz += fz * 8;
      this.dashed.add(s.id);
    }
    const g = this.env === "low-gravity" ? CHAOS.lowGravityFactor : 1;
    s.vy = Math.max(-30, s.vy - st.gravity * g * STEP);
    c.controller.computeColliderMovement(
      c.collider,
      { x: s.vx * STEP, y: s.vy * STEP, z: s.vz * STEP },
      undefined,
      undefined,
      filter,
    );
    const m = c.controller.computedMovement();
    s.x += m.x;
    s.y += m.y;
    s.z += m.z;
    if (c.controller.computedGrounded() || Math.abs(m.y - s.vy * STEP) > 0.001)
      s.vy = 0;
    // A bounce pad: landing on it launches you toward its diagonal perch.
    if (c.controller.computedGrounded()) {
      for (const pad of this.arena.pads) {
        const dxp = s.x - pad.x,
          dzp = s.z - pad.z;
        if (dxp * dxp + dzp * dzp <= pad.r * pad.r) {
          s.vx = pad.vx;
          s.vz = pad.vz;
          s.vy = pad.bounce;
        }
      }
    }
    s.yaw =
      ((((input.yaw + Math.PI) % (2 * Math.PI)) + 2 * Math.PI) %
        (2 * Math.PI)) -
      Math.PI;
    s.pitch = Math.max(-1.5, Math.min(1.5, input.pitch));
    s.flags =
      (c.controller.computedGrounded() ? 1 : 0) |
      (crouched ? 2 : 0) |
      (input.buttons & BUTTON.SPRINT ? 4 : 0) |
      (input.buttons & BUTTON.JUMP ? 8 : 0);
    if (s.flags & 1) s.jumps = 0;
    s.ack = input.seq;
    // Fell through the world or left the arena: that is an elimination.
    if (!s.out && (s.y < -8 || !this.inArena(s.x, s.z))) {
      s.out = 1;
      s.hp = 0;
    }
    c.body.setNextKinematicTranslation({ x: s.x, y: s.y, z: s.z });
  }
  restore(c: Character, s: PlayerState) {
    c.state = { ...s };
    c.collider.setShape(new RAPIER.Capsule(s.flags & 2 ? 0.2 : 0.55, 0.3));
    c.body.setTranslation({ x: s.x, y: s.y, z: s.z }, true);
    c.body.setNextKinematicTranslation({ x: s.x, y: s.y, z: s.z });
  }
  /**
   * Chaos env modifier, idempotent. The host applies it at countdown and
   * round start; prediction clients apply the same derived id from the
   * match broadcast, so both sides' physics agree without a wire message.
   */
  setEnv(env: string) {
    if (this.env === env) return;
    this.env = env;
    const g = env === "low-gravity" ? -18 * CHAOS.lowGravityFactor : -18;
    this.world.gravity = { x: 0, y: g, z: 0 };
    for (const [id, col] of this.propColliders) {
      const kind = this.kind(id);
      if (!kind) continue;
      const r = PROP_BOUNCE[kind];
      if (env === "bounce") {
        col.setRestitution(0.9);
        col.setRestitutionCombineRule(RAPIER.CoefficientCombineRule.Max);
      } else {
        col.setRestitution(r);
        col.setRestitutionCombineRule(
          kind === "ball"
            ? RAPIER.CoefficientCombineRule.Max
            : RAPIER.CoefficientCombineRule.Min,
        );
      }
    }
  }
  eye(s: PlayerState) {
    return { x: s.x, y: s.y + (s.flags & 2 ? 0.3 : 0.65), z: s.z };
  }
  direction(s: PlayerState) {
    return {
      x: -Math.sin(s.yaw) * Math.cos(s.pitch),
      y: -Math.sin(s.pitch),
      z: -Math.cos(s.yaw) * Math.cos(s.pitch),
    };
  }
  /** Stable hand pose shared by physics and shot visuals for compact tools. */
  heldPose(s: PlayerState, kind = this.kind(s.held)) {
    const eye = this.eye(s),
      d = this.direction(s),
      span = Math.max(0.001, Math.hypot(d.x, d.z)),
      right = { x: -d.z / span, z: d.x / span },
      gun = isGun(kind) ? GUNS[kind] : null,
      forward = gun ? gun.hold.forward : kind === "bat" ? 0.76 : 0.72,
      sideways = gun ? gun.hold.sideways : kind === "bat" ? 0.34 : 0.29,
      lowered = gun ? gun.hold.lowered : kind === "bat" ? 0.27 : 0.16;
    const cy = Math.cos(s.yaw / 2),
      sy = Math.sin(s.yaw / 2),
      cx = Math.cos(s.pitch / 2),
      sx = Math.sin(-s.pitch / 2);
    return {
      position: {
        x: eye.x + d.x * forward + right.x * sideways,
        y: eye.y + d.y * forward - lowered,
        z: eye.z + d.z * forward + right.z * sideways,
      },
      rotation: { x: cy * sx, y: sy * cx, z: -sy * sx, w: cy * cx },
    };
  }
  /** World-space tip of the gun barrel, matching its visual model. */
  muzzle(s: PlayerState) {
    const kind = this.kind(s.held),
      gun = isGun(kind) ? GUNS[kind] : GUNS.gun,
      pose = this.heldPose(s, kind),
      d = this.direction(s);
    return {
      x: pose.position.x + d.x * gun.muzzleZ,
      y: pose.position.y + d.y * gun.muzzleZ,
      z: pose.position.z + d.z * gun.muzzleZ,
    };
  }
  /** Closest collider along the look ray, players included. Nothing is mutated. */
  private look(s: PlayerState, max: number, skipPlayers: boolean) {
    const c = this.players.get(s.id);
    if (!c) return null;
    const players = new Set(
      [...this.players.values()].map((p) => p.collider.handle),
    );
    const held = s.held ? this.props.get(s.held)?.collider(0).handle : undefined;
    const hit = this.world.castRay(
      new RAPIER.Ray(this.eye(s), this.direction(s)),
      max,
      true,
      undefined,
      undefined,
      c.collider,
      c.body,
      (col: RAPIER.Collider) =>
        col.handle !== held && !(skipPlayers && players.has(col.handle)),
    );
    return hit;
  }
  target(s: PlayerState, max = 2.8) {
    const hit = this.look(s, max, true);
    if (!hit) return 0;
    return (
      [...this.props].find(
        ([id, b]) =>
          id < PELLET_ID_BASE && b.collider(0).handle === hit.collider.handle,
      )?.[0] ?? 0
    );
  }
  /** The door leaf under the crosshair, or 0. Anything nearer blocks the reach. */
  doorTarget(s: PlayerState, max = 3.2) {
    const hit = this.look(s, max, true);
    if (!hit) return 0;
    return (
      [...this.doors].find(
        ([, d]) => d.collider.handle === hit.collider.handle,
      )?.[0] ?? 0
    );
  }
  /** How far the crosshair reaches before something stops it, for local tracers. */
  reach(s: PlayerState, max = WEAPON.range) {
    const hit = this.look(s, max, false);
    return hit ? hit.timeOfImpact : max;
  }
  setDoor(id: number, open: boolean) {
    const door = this.doors.get(id);
    if (door) door.remote = open;
  }
  /** Toggle a hand-operated leaf the player is actually looking at. */
  toggleDoor(playerId: number, id: number) {
    const c = this.players.get(playerId),
      door = this.doors.get(id);
    if (!c || !door || door.def.auto || this.doorTarget(c.state) !== id)
      return null;
    door.remote = !door.remote;
    return door.remote;
  }
  doorStates(): DoorState[] {
    return [...this.doors].map(([id, d]) => ({
      id,
      open: d.open,
      progress: d.progress,
    }));
  }
  syncDoors(states: DoorState[]) {
    for (const s of states) {
      const door = this.doors.get(s.id);
      if (!door) continue;
      door.remote = s.open;
      door.open = s.open;
      door.progress = s.progress;
    }
  }
  /** Shatter a pane: its collider is gone, and the id waits for the drain. */
  private breakWindow(w: WindowRuntime) {
    w.broken = true;
    this.entities.delete(w.collider.handle);
    this.world.removeRigidBody(w.body);
  }
  /** Authority-side: a hard impact just broke this pane. */
  shatterWindow(id: number) {
    const w = this.windows.get(id);
    if (!w || w.broken) return;
    this.breakWindow(w);
    this.windowEvents.push(id);
  }
  /** Client-side: agree that a pane is broken (also used by syncWindows). */
  setWindow(id: number, broken: boolean) {
    const w = this.windows.get(id);
    if (!w || !broken) return;
    this.breakWindow(w);
  }
  windowStates(): WindowState[] {
    return [...this.windows].map(([id, w]) => ({ id, broken: w.broken }));
  }
  syncWindows(states: WindowState[]) {
    for (const s of states) if (s.broken) this.setWindow(s.id, true);
  }
  /**
   * Fire the held gun. The pellet is a live body: it flies from the muzzle and
   * does its damage on contact, so aim leads your target. Which gun is in hand
   * picks every number below — `GUNS` in level.ts is the whole arsenal.
   */
  shoot(playerId: number): Shot | null {
    const c = this.players.get(playerId);
    if (!c) return null;
    const kind = this.kind(c.state.held);
    if (!isGun(kind)) return null;
    const g = GUNS[kind];
    if (this.frame < (this.cooldowns.get(playerId) ?? 0)) return null;
    if ((this.reloadAt.get(playerId) ?? -1) > this.frame) return null;
    const s = c.state,
      muzzle = this.muzzle(s),
      d = this.direction(s),
      st = buildStats(s.build),
      reload = this.reloadTicks(g, st);
    if (s.ammo <= 0) {
      // Dry trigger: start the reload and let the client watch it finish.
      this.reloadAt.set(playerId, this.frame + reload);
      return null;
    }
    this.cooldowns.set(playerId, this.frame + g.cooldown);
    s.ammo--;
    if (s.ammo === 0) this.reloadAt.set(playerId, this.frame + reload);
    const speed =
      g.pelletSpeed *
      st.pelletSpeedMult *
      (this.env === "huge-pellets" ? CHAOS.pelletSpeedMult : 1);
    const dirs = this.fanDirs(d, g.pellets + (st.tripleShot ? 2 : 0), g.spread);
    // Survivors ride high restitution so they actually rebound off things.
    const survives =
      st.bouncy || st.ricochet || st.rubberBullet || this.env === "bounce";
    const bounces = st.rubberBullet ? 2 : 0;
    const explosive = g.explosive || st.explosive;
    const radius =
      (st.bigBall ? 0.3 : g.radius) *
      (this.env === "huge-pellets" ? CHAOS.pelletRadiusMult : 1);
    const middle = Math.floor((dirs.length - 1) / 2);
    let firstId = 0,
      centerId = 0;
    dirs.forEach((dir, i) => {
      if (this.nextPelletId > 64000) this.clearPellets();
      const id = this.nextPelletId++;
      if (!firstId) firstId = id;
      if (i === middle && dirs.length > 1) centerId = id;
      const body = this.world.createRigidBody(
        RAPIER.RigidBodyDesc.dynamic()
          .setTranslation(muzzle.x, muzzle.y, muzzle.z)
          .setLinearDamping(0.02)
          .setGravityScale(g.gravityScale)
          .setCcdEnabled(true),
      );
      let desc = RAPIER.ColliderDesc.ball(radius)
        .setMass(0.05)
        .setRestitution(survives ? 0.9 : 0.3);
      if (survives)
        desc = desc.setRestitutionCombineRule(RAPIER.CoefficientCombineRule.Max);
      const collider = this.world.createCollider(desc, body);
      collider.setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS);
      this.props.set(id, body);
      this.owners.set(id, playerId);
      this.entities.set(collider.handle, { kind: "pellet", id, body });
      this.pellets.set(id, {
        body,
        creator: playerId,
        expires: this.frame + g.pelletsLive,
        v: { x: dir.x * speed, y: dir.y * speed, z: dir.z * speed },
        bounces,
        speed,
        gun: kind,
        explosive,
        homing: st.homing || g.homing,
      });
      body.setLinvel({ x: dir.x * speed, y: dir.y * speed, z: dir.z * speed }, true);
    });
    s.vx -= d.x * g.recoil;
    s.vz -= d.z * g.recoil;
    const hit = this.look(s, g.range, false);
    return {
      id: playerId,
      object: s.held,
      x: muzzle.x,
      y: muzzle.y,
      z: muzzle.z,
      dx: d.x,
      dy: d.y,
      dz: d.z,
      distance: hit ? hit.timeOfImpact : g.range,
      hit: 0,
      pellet: centerId || firstId,
      dirs: dirs.length > 1
        ? dirs.map((x) => ({ dx: x.x, dy: x.y, dz: x.z }))
        : undefined,
    };
  }
  /** QUICK DRAW scales the pistol's discount, so it fits every magazine. */
  private reloadTicks(g: GunSpec, st: BuildStats) {
    return gunReloadTicks(g, st.reloadTicks);
  }
  /** A multi-round gun, fanned evenly about the aim in the yaw plane. */
  private fanDirs(
    d: { x: number; y: number; z: number },
    count: number,
    total: number,
  ): { x: number; y: number; z: number }[] {
    if (count <= 1) return [{ ...d }];
    const step = total / (count - 1),
      out: { x: number; y: number; z: number }[] = [];
    for (let i = 0; i < count; i++) {
      const a = (i - (count - 1) / 2) * step,
        cos = Math.cos(a),
        sin = Math.sin(a);
      out.push({
        x: d.x * cos + d.z * sin,
        y: d.y,
        z: -d.x * sin + d.z * cos,
      });
    }
    return out;
  }
  /** Start refilling the held gun early; friendlier than waiting for empty. */
  reload(playerId: number) {
    const c = this.players.get(playerId);
    if (!c) return false;
    const kind = this.kind(c.state.held);
    if (!isGun(kind)) return false;
    if ((this.reloadAt.get(playerId) ?? -1) > this.frame) return false;
    if (c.state.ammo >= GUNS[kind].ammo) return false;
    this.reloadAt.set(
      playerId,
      this.frame + this.reloadTicks(GUNS[kind], buildStats(c.state.build)),
    );
    return true;
  }
  /** Swing the held bat through a forgiving capsule-sized lane in front. */
  swing(playerId: number): Swing | null {
    const c = this.players.get(playerId);
    if (!c || this.kind(c.state.held) !== "bat") return null;
    if (this.frame < (this.meleeCooldowns.get(playerId) ?? 0)) return null;
    this.meleeCooldowns.set(playerId, this.frame + MELEE.cooldown);
    const s = c.state,
      d = this.direction(s),
      targets = new Map(
        [...this.players].map(([id, p]) => [p.collider.handle, id]),
      ),
      held = this.props.get(s.held)!;
    const hit = this.world.castShape(
      this.eye(s),
      { x: 0, y: 0, z: 0, w: 1 },
      d,
      new RAPIER.Ball(MELEE.radius),
      0.01,
      MELEE.range,
      true,
      undefined,
      undefined,
      c.collider,
      c.body,
      (col: RAPIER.Collider) => col.handle !== held.collider(0).handle,
    );
    const victim = hit ? (targets.get(hit.collider.handle) ?? 0) : 0,
      struck = this.players.get(victim),
      mult = buildStats(s.build).knockMult;
    if (struck) {
      // The victim's own wound decides how far they fly.
      const hurt = mult * this.knockScale(struck.state.hp);
      struck.state.vx += d.x * MELEE.knock * hurt;
      struck.state.vz += d.z * MELEE.knock * hurt;
      struck.state.vy = Math.max(struck.state.vy, 0) + MELEE.lift * hurt;
      struck.state.stagger = MELEE.stagger;
    }
    s.vx -= d.x * MELEE.recoil;
    s.vz -= d.z * MELEE.recoil;
    return { id: playerId, object: s.held, hit: victim };
  }
  honk(playerId: number) {
    const c = this.players.get(playerId);
    if (!c || this.kind(c.state.held) !== "horn") return false;
    if (this.frame < (this.hornCooldowns.get(playerId) ?? 0)) return false;
    this.hornCooldowns.set(playerId, this.frame + HORN.cooldown);
    return true;
  }
  pickup(playerId: number, objectId: number) {
    const c = this.players.get(playerId),
      body = this.props.get(objectId);
    if (
      !c ||
      !body ||
      c.state.held ||
      this.owners.get(objectId) ||
      this.target(c.state) !== objectId
    )
      return false;
    c.state.held = objectId;
    this.owners.set(objectId, playerId);
    body.setBodyType(RAPIER.RigidBodyType.KinematicPositionBased, true);
    body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    // Picked up: the junk card's tag and bounce tuning go with it.
    this.propMeta.delete(objectId);
    const col = this.propColliders.get(objectId),
      kind = this.kind(objectId);
    if (col && kind) {
      col.setRestitution(PROP_BOUNCE[kind]);
      col.setRestitutionCombineRule(
        kind === "ball"
          ? RAPIER.CoefficientCombineRule.Max
          : RAPIER.CoefficientCombineRule.Min,
      );
    }
    // Every gun hands you its own magazine, and a reload already running is
    // about a gun you no longer have.
    if (isGun(kind)) {
      c.state.ammo = magazineOf(kind);
      this.reloadAt.delete(playerId);
    }
    return true;
  }
  release(playerId: number, throwing = false) {
    const c = this.players.get(playerId);
    if (!c || !c.state.held) return false;
    const id = c.state.held,
      body = this.props.get(id)!;
    c.state.held = 0;
    this.owners.set(id, 0);
    body.setBodyType(
      this.prediction
        ? RAPIER.RigidBodyType.KinematicPositionBased
        : RAPIER.RigidBodyType.Dynamic,
      true,
    );
    const d = this.direction(c.state),
      k = throwing ? 10 : 1;
    body.setLinvel(
      {
        x: c.state.vx + d.x * k,
        y: Math.max(0, c.state.vy) + d.y * k + (throwing ? 2 : 0),
        z: c.state.vz + d.z * k,
      },
      true,
    );
    body.setAngvel({ x: throwing ? 2 : 0, y: throwing ? 1 : 0, z: 0 }, true);
    // Junk cards (design doc §8): the thrower's build rides with the prop.
    const st = buildStats(c.state.build);
    this.propMeta.set(id, {
      thrower: playerId,
      build: c.state.build,
      angry: st.angryBall && this.kind(id) === "ball",
      magnet: st.magnetGlove && !throwing,
      born: this.frame,
    });
    if (st.bounceJunk) {
      const col = this.propColliders.get(id);
      if (col) {
        col.setRestitution(0.92);
        col.setRestitutionCombineRule(RAPIER.CoefficientCombineRule.Max);
      }
    }
    return true;
  }
  /** Slide every leaf toward its target; automatic ones watch for company. */
  private moveDoors() {
    const rate = STEP / (DOOR_TRAVEL * (this.env === "fast-doors" ? CHAOS.doorFactor : 1));
    for (const [id, door] of this.doors) {
      const near =
        !!door.def.auto &&
        [...this.players.values()].some(
          (p) =>
            Math.hypot(
              p.state.x - door.def.p[0],
              p.state.z - door.def.p[2],
            ) < AUTO_RANGE && Math.abs(p.state.y - door.def.p[1]) < 3,
        );
      const open = door.remote || near;
      if (open !== door.open) {
        // A new pass starts; anyone not yet launched can be again.
        door.slammed.clear();
        door.open = open;
        if (this.doorEvents.length < 64) this.doorEvents.push(id);
      }
      const goal = open ? 1 : 0;
      door.moved = { x: 0, y: 0, z: 0 };
      if (door.progress === goal) continue;
      const oldE = door.progress * door.progress * (3 - 2 * door.progress);
      door.progress =
        goal > door.progress
          ? Math.min(1, door.progress + rate)
          : Math.max(0, door.progress - rate);
      const e = door.progress * door.progress * (3 - 2 * door.progress);
      const de = e - oldE;
      door.moved = {
        x: door.def.slide[0] * de,
        y: door.def.slide[1] * de,
        z: door.def.slide[2] * de,
      };
      door.body.setNextKinematicTranslation({
        x: door.def.p[0] + door.def.slide[0] * e,
        y: door.def.p[1] + door.def.slide[1] * e,
        z: door.def.p[2] + door.def.slide[2] * e,
      });
    }
  }
  step() {
    this.frame++;
    for (const [id, until] of this.reloadAt)
      if (this.frame >= until) {
        const c = this.players.get(id);
        // Refill whatever is actually in hand — a gun picked up mid-reload
        // would otherwise come back with the pistol's six rounds.
        if (c) c.state.ammo = magazineOf(this.kind(c.state.held));
        this.reloadAt.delete(id);
      }
    this.moveDoors();
    for (const c of this.players.values()) {
      if (!c.state.held) continue;
      // Compact tools stay locked to one stable hand pose. Bulky throwable
      // props still pull back when a wall would clip them.
      const kind = this.kind(c.state.held),
        gun = isGun(kind),
        tool = gun || kind === "bat" || kind === "horn",
        reach = gun ? 1.5 : 2.25,
        lowered = gun ? 0.18 : 0,
        sideways = gun ? 0.28 : 0;
      const body = this.props.get(c.state.held)!,
        eye = this.eye(c.state),
        d = this.direction(c.state),
        origin = {
          x: eye.x - d.x * 0.65,
          y: eye.y - d.y * 0.65,
          z: eye.z - d.z * 0.65,
        };
      if (tool) {
        const pose = this.heldPose(c.state, kind);
        body.setNextKinematicTranslation(pose.position);
        body.setNextKinematicRotation(pose.rotation);
        continue;
      }
      const hit = this.world.castShape(
        origin,
        { x: 0, y: 0, z: 0, w: 1 },
        d,
        new RAPIER.Ball(0.54),
        0.03,
        2.25,
        true,
        undefined,
        undefined,
        body.collider(0),
        body,
        (col: RAPIER.Collider) =>
          ![...this.players.values()].some(
            (p) => p.collider.handle === col.handle,
          ),
      );
      // Keep it in front of the face: a cast that starts already touching
      // something reports no distance at all, which used to park the object
      // behind the eye where its owner could not see it.
      const distance = Math.max(
        gun ? 1.05 : 0.95,
        Math.min(reach, (hit?.time_of_impact ?? reach) - 0.05),
      );
      const span = Math.max(0.001, Math.hypot(d.x, d.z)),
        right = { x: -d.z / span, z: d.x / span };
      body.setNextKinematicTranslation({
        x: origin.x + d.x * distance + right.x * sideways,
        y: origin.y + d.y * distance - lowered,
        z: origin.z + d.z * distance + right.z * sideways,
      });
      // Guns are modelled pointing down -z, so they take the look pitch too.
      const cy = Math.cos(c.state.yaw / 2),
        sy = Math.sin(c.state.yaw / 2),
        cx = gun ? Math.cos(c.state.pitch / 2) : 1,
        sx = gun ? Math.sin(-c.state.pitch / 2) : 0;
      body.setNextKinematicRotation({
        x: cy * sx,
        y: sy * cx,
        z: -sy * sx,
        w: cy * cx,
      });
    }
    // Unbroken panes stay exactly where the level says; both sides agree.
    for (const w of this.windows.values()) {
      if (w.broken) continue;
      w.body.setTranslation(
        { x: w.def.p[0], y: w.def.p[1], z: w.def.p[2] },
        true,
      );
      w.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
      w.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    }
    // Snapshot pre-step velocities: by the time contact events arrive,
    // restitution has already resolved the impact (CCD included).
    for (const e of this.entities.values()) {
      if (!e.body || e.kind === "player") continue;
      const v = e.body.linvel();
      e.preV = { x: v.x, y: v.y, z: v.z };
    }
    this.world.step(this.events);
    if (!this.prediction) {
      for (const [id, p] of this.pellets) {
        const t = p.body.translation();
        if (this.frame >= p.expires || !this.inArena(t.x, t.z))
          this.removePellet(id);
      }
      this.handleCollisions();
      // Chaos random explosions: on their own clock, anywhere in the arena.
      if (this.env === "explosions" && this.frame % CHAOS.explosion.period === 0) {
        const x = this.arena.bounds.minX + Math.random() * (this.arena.bounds.maxX - this.arena.bounds.minX),
          z = this.arena.bounds.minZ + Math.random() * (this.arena.bounds.maxZ - this.arena.bounds.minZ);
        // boomAt announces it; this used to push the event here as well.
        this.boomAt(
          { x, y: 0.5, z },
          CHAOS.explosion.radius,
          CHAOS.explosion.force,
          CHAOS.explosion.lift,
          CHAOS.explosion.damage,
        );
      }
      // Record each pellet's resolved velocity so a contact that starts next
      // step reads the impact speed, not the post-bounce remainder (CCD
      // resolves before events arrive).
      for (const p of this.pellets.values()) {
        const v = p.body.linvel();
        p.v = { x: v.x, y: v.y, z: v.z };
      }
      for (const [id, body] of this.props) {
        if (id >= PELLET_ID_BASE) continue;
        if (body.translation().y < -8) {
          const p = this.arena.props[id - 1].p;
          body.setTranslation({ x: p[0], y: p[1] + 1.5, z: p[2] }, true);
          body.setLinvel({ x: 0, y: 0, z: 0 }, true);
          this.propMeta.delete(id);
        }
      }
      this.steerPellets();
      this.steerJunk();
      // DOOR SLAMMER: any holder turns moving leaves into launchers.
      if (
        [...this.players.values()].some(
          (c) => buildStats(c.state.build).doorSlammer,
        )
      ) {
        for (const [, door] of this.doors) {
          const m = door.moved;
          if (!m.x && !m.y && !m.z) continue;
          const t = door.body.translation(),
            s = door.def.s;
          for (const c of this.players.values()) {
            const ps = c.state;
            if (ps.out || door.slammed.has(ps.id)) continue;
            if (
              Math.abs(ps.x - t.x) < s[0] / 2 + 0.4 &&
              Math.abs(ps.y - t.y) < s[1] / 2 + 0.9 &&
              Math.abs(ps.z - t.z) < s[2] / 2 + 0.4
            ) {
              door.slammed.add(ps.id);
              const ml = Math.max(0.001, Math.hypot(m.x, m.y, m.z));
              ps.vx += (m.x / ml) * DOOR_SLAM.force;
              ps.vz += (m.z / ml) * DOOR_SLAM.force;
              ps.vy = Math.max(ps.vy, 0) + DOOR_SLAM.lift;
              ps.stagger = WEAPON.stagger;
            }
          }
        }
      }
    }
  }
  /** The speed a contact actually had: pre-step for dynamic bodies, since restitution has already resolved by the time events arrive. */
  private impactVelocityOf(h: number) {
    const e = this.entities.get(h);
    if (!e) return { x: 0, y: 0, z: 0 };
    if (e.kind === "player") {
      const s = this.players.get(e.id)?.state;
      return s ? { x: s.vx, y: s.vy, z: s.vz } : { x: 0, y: 0, z: 0 };
    }
    return e.preV ?? { x: 0, y: 0, z: 0 };
  }
  /**
   * Impact damage above the harmless threshold; zero HP is an elimination.
   * `scale` is the weapon's HP factor — a fan of small rounds hurts less per
   * pellet than a single rifle slug of the same speed.
   */
  private hurt(s: PlayerState, rel: number, scale = 1) {
    const excess = rel - COMBAT.threshold;
    if (excess <= 0) return;
    s.hp = Math.max(
      0,
      s.hp - Math.min(COMBAT.maxPerHit, excess * COMBAT.damagePerUnit) * scale,
    );
    if (!s.hp) s.out = 1;
  }
  /** EXPLOSIVE: radial shove + lift + HP to everyone in range of the blast. */
  /**
   * How hard a fighter receives a shove, scaled by the HP they have lost:
   * 1.0 at full health, up to 1 + COMBAT.knockRamp at death's door. Applied
   * to every knockback a player receives; `hp` is replicated, so a client's
   * deterministic replay scales identically.
   */
  private knockScale(hp: number) {
    return 1 + ((COMBAT.hpMax - Math.max(0, hp)) / COMBAT.hpMax) * COMBAT.knockRamp;
  }
  /** A blast from an armed pellet: the gun's numbers, or the card's. */
  private boom(t: { x: number; y: number; z: number }, spec = GUNS.gun.boom) {
    this.boomAt(t, spec.radius, spec.force, spec.lift, spec.damage);
  }
  /**
   * A radial blast with explicit numbers; chaos explosions and the BOOM TUBE
   * pass their own. Every blast is announced once, so clients boom once.
   */
  private boomAt(
    t: { x: number; y: number; z: number },
    radius: number,
    force: number,
    lift: number,
    damage: number,
  ) {
    this.explosionEvents.push({ x: t.x, y: t.y, z: t.z });
    for (const c of this.players.values()) {
      const ps = c.state;
      if (ps.out) continue;
      const dxp = ps.x - t.x,
        dzp = ps.z - t.z,
        dist = Math.hypot(dxp, dzp);
      if (dist > radius || Math.abs(ps.y - t.y) > 3) continue;
      const fall = Math.max(0.2, 1 - dist / radius);
      // The blast shoves the wounded harder, too.
      const shove = fall * this.knockScale(ps.hp);
      if (dist > 0.001) {
        ps.vx += (dxp / dist) * force * shove;
        ps.vz += (dzp / dist) * force * shove;
      }
      ps.vy = Math.max(ps.vy, 0) + lift * shove;
      ps.stagger = WEAPON.stagger;
      const dmg = damage * fall;
      ps.hp = Math.max(0, ps.hp - dmg);
      if (!ps.hp) ps.out = 1;
    }
  }
  /** RICOCHET: after a hit the pellet leaves toward the nearest player. */
  private ricochet(p: Pellet) {
    const t = p.body.translation();
    const target = this.nearestPlayer(t, p.creator);
    if (!target) return;
    const dx = target.x - t.x,
      dy = target.y - t.y,
      dz = target.z - t.z;
    const dist = Math.max(0.001, Math.hypot(dx, dy, dz));
    p.body.setLinvel(
      { x: (dx / dist) * p.speed, y: (dy / dist) * p.speed, z: (dz / dist) * p.speed },
      true,
    );
  }
  /** The live player closest to a point, ignoring `exclude`. */
  private nearestPlayer(pos: { x: number; y: number; z: number }, exclude: number) {
    let best: { x: number; y: number; z: number } | null = null,
      bd = Infinity;
    for (const c of this.players.values()) {
      const s = c.state;
      if (s.id === exclude || s.out) continue;
      const d = Math.hypot(s.x - pos.x, s.y - pos.y, s.z - pos.z);
      if (d < bd) {
        bd = d;
        best = { x: s.x, y: s.y + 0.65, z: s.z };
      }
    }
    return best;
  }
  /** HOMING (and the SEEKER's own rounds): curve live pellets toward a target. */
  private steerPellets() {
    for (const p of this.pellets.values()) {
      // Decided at fire time, so a card taken after the shot does not retroact.
      if (!p.homing) continue;
      const t = p.body.translation();
      const target = this.nearestPlayer(t, p.creator);
      if (!target) continue;
      const v = p.body.linvel();
      const cs = Math.hypot(v.x, v.y, v.z);
      if (cs < 0.01) continue;
      const dx = target.x - t.x,
        dy = target.y - t.y,
        dz = target.z - t.z;
      const dist = Math.max(0.001, Math.hypot(dx, dy, dz));
      const k = WEAPON.homingSteer;
      const nx = v.x / cs + (dx / dist - v.x / cs) * k,
        ny = v.y / cs + (dy / dist - v.y / cs) * k,
        nz = v.z / cs + (dz / dist - v.z / cs) * k;
      const nl = Math.max(0.001, Math.hypot(nx, ny, nz));
      p.body.setLinvel(
        { x: (nx / nl) * p.speed, y: (ny / nl) * p.speed, z: (nz / nl) * p.speed },
        true,
      );
    }
  }
  /**
   * Junk cards on loose props: ANGRY BALL accelerates toward the nearest
   * other player; MAGNET GLOVE drifts a dropped prop back to its thrower.
   * Authority only — prediction worlds keep these props as kinematic proxies.
   */
  private steerJunk() {
    for (const [id, body] of this.props) {
      if (id >= PELLET_ID_BASE) continue;
      const meta = this.propMeta.get(id);
      if (!meta || this.owners.get(id)) continue;
      if (meta.magnet && this.frame - meta.born > 300) {
        this.propMeta.delete(id);
        continue;
      }
      let tx: number, ty: number, tz: number, accel: number, cap: number;
      if (meta.angry) {
        const target = this.nearestPlayer(body.translation(), meta.thrower);
        if (!target) continue;
        tx = target.x;
        ty = target.y;
        tz = target.z;
        // The floor's friction eats 14.4 m/s², so the hunt has to out-pull it
        // — and out-turn a 10 m/s throw, which wants a turning radius near 2 m.
        accel = 60;
        cap = 12;
      } else if (meta.magnet) {
        const s = this.players.get(meta.thrower)?.state;
        if (!s || s.out) {
          this.propMeta.delete(id);
          continue;
        }
        tx = s.x;
        ty = s.y - 0.4;
        tz = s.z;
        accel = 30;
        cap = 6;
      } else continue;
      const t = body.translation();
      const dx = tx - t.x,
        dy = ty - t.y,
        dz = tz - t.z;
      const dist = Math.max(0.001, Math.hypot(dx, dy, dz));
      if (dist < 0.5) {
        this.propMeta.delete(id);
        continue;
      }
      const v = body.linvel();
      let vx = v.x + (dx / dist) * accel * STEP,
        vy = v.y + (dy / dist) * accel * STEP,
        vz = v.z + (dz / dist) * accel * STEP;
      if (cap && Math.hypot(vx, vy, vz) > cap) {
        const sp = Math.hypot(vx, vy, vz);
        vx *= cap / sp;
        vy *= cap / sp;
        vz *= cap / sp;
      }
      body.setLinvel({ x: vx, y: vy, z: vz }, true);
    }
  }
  /** Where an entity is, for presentation purposes: players by state, bodies by translation. */
  private entityPosition(
    e: { kind: string; id: number; body?: RAPIER.RigidBody } | undefined,
  ) {
    if (!e) return null;
    if (e.kind === "player") {
      const s = this.players.get(e.id)?.state;
      return s ? { x: s.x, y: s.y, z: s.z } : null;
    }
    if (!e.body) return null;
    const t = e.body.translation();
    return { x: t.x, y: t.y, z: t.z };
  }
  /**
   * Impacts worth hearing (design doc §17): every contact above `IMPACT.floor`
   * relative m/s is recorded with a normalized strength so clients can scale
   * sound and sparks. `rel` is the pre-step speed — by the time events drain,
   * restitution has already rewritten the dynamic bodies — and it is the same
   * number the damage path pays out. Pellet-on-player pairs are skipped — the
   * shot broadcast already tells those. Authority only; nothing affects physics.
   */
  private recordImpact(
    a: { kind: string; id: number; body?: RAPIER.RigidBody } | undefined,
    b: { kind: string; id: number; body?: RAPIER.RigidBody } | undefined,
    rel: number,
  ) {
    if (rel < IMPACT.floor || this.impactEvents.length >= 24) return;
    const pellet = a?.kind === "pellet" ? a : b?.kind === "pellet" ? b : null;
    const other = pellet ? (a?.kind === "pellet" ? b : a) : null;
    if (pellet && other?.kind === "player") return;
    const p = this.entityPosition(a) ?? this.entityPosition(b);
    if (!p) return;
    this.impactEvents.push({
      x: p.x,
      y: p.y,
      z: p.z,
      s: Math.min(1, (rel - IMPACT.floor) / (IMPACT.full - IMPACT.floor)),
    });
  }
  /**
   * The only place damage is decided: drain the collision events and pay out
   * knockback plus impact HP. Runs on the authority only — clients reconcile
   * the resulting state from snapshots, exactly like stagger does today.
   */
  private handleCollisions() {
    const spent: number[] = [];
    this.events.drainCollisionEvents((h1, h2, started) => {
      if (!started) return;
      const a = this.entities.get(h1),
        b = this.entities.get(h2);
      const pa = this.impactVelocityOf(h1),
        pb = this.impactVelocityOf(h2);
      const rel = Math.hypot(pa.x - pb.x, pa.y - pb.y, pa.z - pb.z);
      this.recordImpact(a, b, rel);
      const pellet = a?.kind === "pellet" ? a : b?.kind === "pellet" ? b : null;
      if (pellet) {
        const other = a?.kind === "pellet" ? b : a,
          live = this.pellets.get(pellet.id);
        if (!live) return;
        const creator = this.players.get(live.creator)?.state,
          cstats = creator ? buildStats(creator.build) : undefined,
          g = GUNS[live.gun];
        let deflect = false;
        if (live.explosive) {
          // A bomb: radial impulse + HP on first contact, then it is gone. The
          // EXPLOSIVE card arms any gun; a BOOM TUBE arrives already armed.
          this.boom(live.body.translation(), g.boom);
          spent.push(pellet.id);
          return;
        }
        if (other?.kind === "player") {
          const s = this.players.get(other.id)?.state;
          if (s && !s.out) {
            if (s.block > 0) {
              // A raised bubble catches the pellet and throws it straight back
              // down at its own shooter, same speed, aimed at their eye.
              const t = live.body.translation(),
                aimx = (creator?.x ?? t.x - live.v.x) - t.x,
                aimy = ((creator?.y ?? t.y - live.v.y) + 0.65) - t.y,
                aimz = (creator?.z ?? t.z - live.v.z) - t.z,
                len = Math.max(0.001, Math.hypot(aimx, aimy, aimz)),
                back = live.speed;
              const backv = {
                x: (aimx / len) * back,
                y: (aimy / len) * back,
                z: (aimz / len) * back,
              };
              live.body.setLinvel(backv, true);
              live.v = live.body.linvel();
              deflect = true;
            } else {
              // CCD resolves the hit before events arrive, so read the velocity
              // the pellet had *before* this step for both direction and damage.
              const impact = Math.hypot(
                live.v.x - s.vx,
                live.v.y - s.vy,
                live.v.z - s.vz,
              );
              const speed = Math.max(0.001, Math.hypot(live.v.x, live.v.y, live.v.z)),
                mult = cstats?.knockMult ?? 1,
                hurt = mult * this.knockScale(s.hp);
              s.vx += (live.v.x / speed) * g.knock * hurt;
              s.vz += (live.v.z / speed) * g.knock * hurt;
              s.vy = Math.max(s.vy, 0) + g.lift * hurt;
              s.stagger = g.stagger;
              this.hurt(s, impact, g.damage);
              if (cstats?.chainReaction) {
                // The victim's momentum bleeds into whoever is standing close.
                for (const p of this.players.values()) {
                  const ps = p.state;
                  if (ps.id === other.id || ps.out) continue;
                  if (Math.hypot(ps.x - s.x, ps.z - s.z) > 2.2) continue;
                  ps.vx +=
                    (live.v.x / speed) * g.knock * mult * 0.4 * this.knockScale(ps.hp);
                  ps.vz +=
                    (live.v.z / speed) * g.knock * mult * 0.4 * this.knockScale(ps.hp);
                  ps.stagger = g.stagger;
                }
              }
            }
          }
        } else if (cstats?.wallBonk && live) {
          // A pellet that dies on anything but a player bonks the wall, and
          // everyone standing near the impact feels it.
          const t = live.body.translation();
          for (const p of this.players.values()) {
            const ps = p.state;
            if (ps.out) continue;
            const dxp = ps.x - t.x,
              dzp = ps.z - t.z,
              dist = Math.hypot(dxp, dzp);
            if (dist > 2.5 || Math.abs(ps.y - t.y) > 3) continue;
            const inv = dist < 0.001 ? 0 : 1 / dist,
              hurt = 6 * this.knockScale(ps.hp);
            ps.vx += dxp * inv * hurt;
            ps.vz += dzp * inv * hurt;
            ps.vy = Math.max(ps.vy, 0) + 2 * this.knockScale(ps.hp);
            ps.stagger = WEAPON.stagger;
          }
        }
        // A surviving pellet keeps flying; a spent one is removed below.
        if (deflect) return;
        if (cstats?.ricochet) {
          this.ricochet(live);
        } else if (cstats?.bouncy || this.env === "bounce") {
          // BOUNCY and the chaos bounce ride physical restitution; done.
        } else if (cstats?.rubberBullet && live.bounces > 0) {
          live.bounces--;
        } else {
          spent.push(pellet.id);
        }
        return;
      }
      // Glass takes impacts like anything else, but hard ones shatter it.
      // Pellets never reach this branch: they die or bounce on glass above.
      const w = a?.kind === "window" ? a : b?.kind === "window" ? b : null;
      if (w) {
        const other = a?.kind === "window" ? b : a;
        if (rel > WINDOW.break) this.shatterWindow(w.id);
        // A player that smashes the glass feels it through the usual damage.
        if (other && other.kind === "player") {
          const os = this.players.get(other.id)!.state;
          this.hurt(os, rel);
        }
        return;
      }
      // Two kinematic characters never raise events against each other, so
      // impact damage arrives through the dynamic bodies that hit them.
      if (!a || !b) return;
      const sa = a.kind === "player" ? this.players.get(a.id)?.state : undefined,
        sb = b.kind === "player" ? this.players.get(b.id)?.state : undefined;
      if (sa && !sb || sb && !sa) {
        // HEAVY JUNK / DANGEROUS JUNK: the thrower's build rides with the prop.
        const victim = sa ?? sb!,
          propE = a.kind === "prop" ? a : b,
          meta =
            propE.kind === "prop" ? this.propMeta.get(propE.id) : undefined,
          tstats = meta ? buildStats(meta.build) : undefined,
          thrower = meta ? this.players.get(meta.thrower)?.state : undefined;
        if (
          victim.block > 0 &&
          meta &&
          thrower &&
          !thrower.out &&
          this.owners.get(propE.id) === 0 &&
          rel > COMBAT.threshold
        ) {
          // The bubble bats the thrown thing back at the thrower: same punch
          // reversed at their chest, plus a pop so it clears out on approach.
          const body = this.props.get(propE.id);
          if (body) {
            const t = body.translation(),
              aimx = thrower.x - t.x,
              aimy = thrower.y + 0.6 - t.y,
              aimz = thrower.z - t.z,
              len = Math.max(0.001, Math.hypot(aimx, aimy, aimz)),
              back = Math.min(Math.max(rel, 8), 30);
            body.setLinvel(
              {
                x: (aimx / len) * back,
                y: (aimy / len) * back + 1.5,
                z: (aimz / len) * back,
              },
              true,
            );
          }
        } else {
          this.hurt(victim, tstats?.heavyJunk ? rel * 1.8 : rel);
          if (tstats?.dangerousJunk && rel > COMBAT.threshold) {
            const p = this.entityPosition(propE);
            if (p) this.boomAt(p, 2.5, 4, 2, 6);
          }
        }
      }
    });
    for (const id of spent) this.removePellet(id);
  }
  removePellet(id: number) {
    const p = this.pellets.get(id);
    if (!p) return;
    this.entities.delete(p.body.collider(0).handle);
    this.world.removeRigidBody(p.body);
    this.props.delete(id);
    this.owners.delete(id);
    this.pellets.delete(id);
  }
  clearPellets() {
    for (const id of [...this.pellets.keys()]) this.removePellet(id);
    this.nextPelletId = PELLET_ID_BASE;
  }
  /** Put everyone back at their spawn with full HP; the pellets are gone. */
  respawn() {
    for (const c of this.players.values()) this.respawnPlayer(c.state.id);
    this.clearPellets();
  }
  /** Put one player back at their spawn with full HP. */
  respawnPlayer(playerId: number) {
    const c = this.players.get(playerId);
    if (!c) return;
    const s = c.state,
      spawn = this.arena.spawns[(s.id - 1) % this.arena.spawns.length];
    this.dropHeld(s.id);
    s.x = spawn[0];
    s.y = spawn[1];
    s.z = spawn[2];
    s.vx = 0;
    s.vy = 0;
    s.vz = 0;
    s.yaw = 0;
    s.pitch = 0;
    s.flags = 0;
    s.held = 0;
    s.stagger = 0;
    s.jumps = 0;
    s.block = 0;
    s.cool = 0;
    s.hp = COMBAT.hpMax;
    s.out = 0;
    s.ammo = WEAPON.ammo;
    this.reloadAt.delete(s.id);
    this.cooldowns.delete(s.id);
    this.meleeCooldowns.delete(s.id);
    this.hornCooldowns.delete(s.id);
    this.dashed.delete(s.id);
    c.collider.setShape(new RAPIER.Capsule(0.55, 0.3));
    c.body.setTranslation({ x: s.x, y: s.y, z: s.z }, true);
    c.body.setNextKinematicTranslation({ x: s.x, y: s.y, z: s.z });
  }
  private dropHeld(playerId: number) {
    const c = this.players.get(playerId);
    if (!c || !c.state.held) return;
    const id = c.state.held,
      body = this.props.get(id)!;
    c.state.held = 0;
    this.owners.set(id, 0);
    body.setBodyType(
      this.prediction
        ? RAPIER.RigidBodyType.KinematicPositionBased
        : RAPIER.RigidBodyType.Dynamic,
      true,
    );
    body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    body.setAngvel({ x: 0, y: 0, z: 0 }, true);
  }
  /** The arena is the generated layout's bounds: outside it, or below y=-8, you are out. */
  private inArena(x: number, z: number) {
    const b = this.env === "tiny-arena" ? TINY_ARENA : this.arena.bounds;
    return x >= b.minX && x <= b.maxX && z >= b.minZ && z <= b.maxZ;
  }
  propStates(): PropState[] {
    return [...this.props].map(([id, b]) => {
      const p = b.translation(),
        q = b.rotation();
      return {
        id,
        ...p,
        qx: q.x,
        qy: q.y,
        qz: q.z,
        qw: q.w,
        owner: this.owners.get(id) ?? 0,
      };
    });
  }
  syncProps(props: PropState[]) {
    for (const p of props) {
      let b = this.props.get(p.id);
      if (!b && p.id >= PELLET_ID_BASE) {
        // A pellet the prediction world has not seen yet.
        b = this.world.createRigidBody(
          RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(
            p.x,
            p.y,
            p.z,
          ),
        );
        this.world.createCollider(RAPIER.ColliderDesc.ball(0.1), b);
        this.props.set(p.id, b);
      }
      if (!b) continue;
      this.owners.set(p.id, p.owner);
      b.setTranslation(p, true);
      b.setNextKinematicTranslation(p);
      b.setRotation({ x: p.qx, y: p.qy, z: p.qz, w: p.qw }, true);
      b.setNextKinematicRotation({ x: p.qx, y: p.qy, z: p.qz, w: p.qw });
    }
    for (const id of [...this.props.keys()]) {
      if (id < PELLET_ID_BASE) continue;
      if (!props.some((p) => p.id === id)) this.removePellet(id);
    }
  }
  dispose() {
    this.events.free();
    this.world.free();
  }
}
