export type Vec3 = { x: number; y: number; z: number };
export type Box = {
  p: [number, number, number];
  s: [number, number, number];
  color: string;
  kind?: string;
  /** Near-side geometry, hidden while the lobby camera looks into the world. */
  hide?: boolean;
};
export type PropKind =
  | "gun"
  | "smg"
  | "shotgun"
  | "rifle"
  | "launcher"
  | "seeker"
  | "horn"
  | "chair"
  | "table"
  | "trashcan"
  | "bottle";
export type Prop = { p: [number, number, number]; kind: PropKind };
/** A sliding leaf. Closed at `p`, open at `p + slide`; ids are their own namespace. */
export type Door = {
  id: number;
  p: [number, number, number];
  s: [number, number, number];
  slide: [number, number, number];
  color: string;
  /** Opens by itself for anyone within `AUTO_RANGE`, instead of on a keypress. */
  auto?: boolean;
  zone: string;
};

/**
 * The Stage (design doc §5): a centre platform with four satellite pads and two
 * elevated perches on the diagonals, floating over the void. Falling off any
 * edge — or being launched out of bounds — eliminates you (see Simulation).
 */
export const LEVEL: Box[] = [
  // The centre stage: a 10×10 m slab, top surface at y=0.
  { p: [0, -0.25, 0], s: [10, 0.5, 10], color: "#4b5563", kind: "stage" },
  // Four satellite platforms, 4×4 m, one on each cardinal axis at the same height.
  { p: [9, -0.25, 0], s: [4, 0.5, 4], color: "#5b6472", kind: "satellite" },
  { p: [-9, -0.25, 0], s: [4, 0.5, 4], color: "#5b6472", kind: "satellite" },
  { p: [0, -0.25, 9], s: [4, 0.5, 4], color: "#5b6472", kind: "satellite" },
  { p: [0, -0.25, -9], s: [4, 0.5, 4], color: "#5b6472", kind: "satellite" },
  // Two elevated perches on the diagonals, top at y=2 — reachable only by a pad
  // launch or being thrown up there.
  { p: [8, 1.75, 8], s: [3, 0.5, 3], color: "#6d4f8f", kind: "perch" },
  { p: [-8, 1.75, -8], s: [3, 0.5, 3], color: "#6d4f8f", kind: "perch" },
  // Two bounce pads on the stage, one aimed at each diagonal perch. Thin boxes so
  // they read as mats; the launch physics lives in PADS below.
  { p: [3.5, 0.05, 3.5], s: [1.2, 0.1, 1.2], color: "#d3c170", kind: "pad" },
  { p: [-3.5, 0.05, -3.5], s: [1.2, 0.1, 1.2], color: "#d3c170", kind: "pad" },
];

/** Sliding leaves. None on the Stage — ids are their own namespace. */
export const DOORS: Door[] = [];

/** Breakable glass panes in openings carved into the outer walls (see LEVEL). */
export type WindowDef = {
  id: number;
  p: [number, number, number];
  s: [number, number, number];
  /** Frame colour; the glass tint is fixed in the scene. */
  color: string;
};
/** No windows on the Stage. */
export const WINDOWS: WindowDef[] = [];

export const SPAWNS = [
  [0, 1, 4],
  [0, 1, -4],
  [4, 1, 0],
  [-4, 1, 0],
  [9, 1, 0],
  [-9, 1, 0],
  [0, 1, 9],
  [0, 1, -9],
];

export const PROPS: Prop[] = [
  { p: [-2, 0.5, -2], kind: "trashcan" },
  { p: [2, 0.5, 3], kind: "bottle" },
  { p: [10, 0.5, 1], kind: "trashcan" },
  { p: [-4, 0.5, -2], kind: "gun" },
  { p: [1, 0.5, -10], kind: "gun" },
  { p: [2.5, 0.5, -2.5], kind: "smg" },
  { p: [-2.5, 0.5, 2.5], kind: "shotgun" },
  { p: [8, 0.5, 1.8], kind: "rifle" },
  { p: [-9, 0.5, -1.6], kind: "launcher" },
  { p: [0, 0.5, 8.5], kind: "seeker" },
  { p: [-3, 0.5, 4], kind: "horn" },
  { p: [-7.8, 0.5, 1.4], kind: "bottle" },
  { p: [6.8, 2.5, 6.8], kind: "bottle" },
  { p: [1, 0.5, 10], kind: "chair" },
  { p: [3, 0.5, -4], kind: "table" },
  { p: [-1, 0.5, 3], kind: "trashcan" },
  { p: [-4, 0.5, -4], kind: "bottle" },
  { p: [4.5, 0.5, -4], kind: "trashcan" },
  { p: [1.2, 0.5, -1.2], kind: "bottle" },
  { p: [-10.2, 0.5, -1], kind: "gun" },
];
export const PROP_STARTS = PROPS.map((p) => p.p);
export const propKind = (id: number): PropKind | undefined =>
  PROPS[id - 1]?.kind;

/**
 * A bounce pad (Smash-style spring). Landing on it while grounded launches the
 * player toward its diagonal perch with a fixed velocity — deterministic, so the
 * client's prediction world and the authority agree without any extra state.
 */
export type Pad = {
  x: number;
  z: number;
  /** Radius of the pad's trigger footprint. */
  r: number;
  /** Top surface height of the mat; 0 when omitted (the Stage sits at y=0). */
  y?: number;
  /** Horizontal launch velocity (m/s) toward the perch. */
  vx: number;
  vz: number;
  /** Vertical launch speed (m/s). */
  bounce: number;
};
export const PADS: Pad[] = [
  { x: 3.5, z: 3.5, r: 0.8, vx: 5, vz: 5, bounce: 12 },
  { x: -3.5, z: -3.5, r: 0.8, vx: -5, vz: -5, bounce: 12 },
  // Satellite return pads hug the outer edge so a respawn at the SPAWN above
  // the centre never materialises standing on the trigger.
  { x: 10, z: 0, y: 0, r: 0.8, vx: -5, vz: 0, bounce: 12 },
  { x: -10, z: 0, y: 0, r: 0.8, vx: 5, vz: 0, bounce: 12 },
  { x: 0, z: 10, y: 0, r: 0.8, vx: 0, vz: -5, bounce: 12 },
  { x: 0, z: -10, y: 0, r: 0.8, vx: 0, vz: 5, bounce: 12 },
  // Perch return pads, aimed back at the centre slab, one on each perch.
  { x: 8, z: 8, y: 2, r: 0.8, vx: -3.5, vz: -3.5, bounce: 12 },
  { x: -8, z: -8, y: 2, r: 0.8, vx: 3.5, vz: 3.5, bounce: 12 },
  { x: 8, z: -8, y: 2, r: 0.8, vx: -3.5, vz: 3.5, bounce: 12 },
  { x: -8, z: 8, y: 2, r: 0.8, vx: 3.5, vz: -3.5, bounce: 12 },
];

export const PALETTE = [
  "#d9a261",
  "#7c9e89",
  "#c87e66",
  "#91a9b3",
  "#b3a0be",
  "#d3c170",
  "#82a8a2",
  "#c78fa0",
];
export const CHARACTER_PALETTE = [
  "#ff8f1f", // flare orange
  "#2fd066", // field green
  "#ef3b46", // crimson
  "#23a7ff", // azure
  "#a25ae0", // royal violet
  "#ffd21f", // sun yellow
  "#19c9a6", // reef teal
  "#f24596", // punch pink
];
export const STEP = 1 / 60;
export const MAX_PLAYERS = 8;
/** Seconds for a leaf to travel, and how close an automatic door watches for. */
export const DOOR_TRAVEL = 0.9;
export const AUTO_RANGE = 3.4;
/** Shove gun tuning; BassSpace Brawl adds ammo + reload (design doc §4). */
export const WEAPON = {
  /** Aim range: short/medium per design doc §4 — the stage is 32 m wide, and
      the old house-sized 42 m made every shot read as a cross-map laser. */
  range: 18,
  cooldown: 20,
  /** Pellets per magazine. */
  ammo: 6,
  /** Ticks to refill a magazine (1.5 s at 60 Hz). */
  reload: 90,
  /** Muzzle speed of a physical pellet, in metres per second. */
  pelletSpeed: 28,
  /** Ticks a pellet stays live before it fizzles out. */
  pelletsLive: 150,
  /** Radians either side of the aim for a TRIPLE SHOT spread. */
  tripleSpread: 0.18,
  /** Per-tick blend toward the target for a HOMING pellet. */
  homingSteer: 0.12,
  /** EXPLOSIVE radial reach in metres. */
  boomRadius: 4,
  /** Radial shove strength of an explosion. */
  boomForce: 9,
  /** Vertical lift of an explosion. */
  boomLift: 4,
  /** HP an explosion takes at full falloff. */
  boomDamage: 22,
  knock: 9.5,
  lift: 5,
  recoil: 1.8,
  stagger: 26,
  /** How much of your own steering survives while staggered. */
  control: 0.12,
};
/**
 * Every gun is a prop kind, and this table is the whole difference between them:
 * the same pellet physics with different numbers, plus two self-propelled
 * behaviours (a shell that arcs and bursts, a swarm that hunts). Nothing about a
 * gun travels on the wire — both sides read it from the arena layout by prop id.
 */
export type GunKind =
  | "gun"
  | "smg"
  | "shotgun"
  | "rifle"
  | "launcher"
  | "seeker";
export type GunSpec = {
  /** Shown on the pickup prompt and beside the ammo readout. */
  name: string;
  /** How far the aim ray reads; also how far a shot is drawn. */
  range: number;
  /** Ticks between trigger pulls at 60 Hz. */
  cooldown: number;
  /** Rounds per magazine. */
  ammo: number;
  /** Spare magazines the gun carries for itself. Reloads take rounds from
   * those, and when they run out the gun is empty — worth throwing, not
   * firing. The supply belongs to the gun, so a half-used gun on the floor
   * hands the next player what is left of it. */
  reloads: number;
  /** Ticks to refill it; QUICK DRAW still shortens this. */
  reload: number;
  /** Muzzle speed of a pellet, metres per second. */
  pelletSpeed: number;
  /** Ticks a pellet stays live before it fizzles out. */
  pelletsLive: number;
  /** Pellets per trigger pull. TRIPLE SHOT adds two to the fan. */
  pellets: number;
  /** Total width of the fan in radians; a single pellet ignores it. */
  spread: number;
  /** The shove a pellet hands out, and how much HP it takes. */
  knock: number;
  lift: number;
  /** Scales impact HP, so a swarm of small rounds does not read as one big one. */
  damage: number;
  /** Ticks of lost footing. */
  stagger: number;
  /** BOOM TUBE shells burst on contact; SEEKER rounds curve toward a target. */
  explosive: boolean;
  homing: boolean;
  /** Gravity on the pellet: the launcher's shell loops, everything else flies flat. */
  gravityScale: number;
  /** Radial blast for an explosive pellet. */
  boom: { radius: number; force: number; lift: number; damage: number };
  /** Shove back on the shooter, and the pellet's collider radius. */
  recoil: number;
  radius: number;
  /** Where the model's own origin sits in the aim frame, measured from the
   * shoulder line (`Simulation.shoulder`): forward reach, sideways offset, how
   * far down. It is `HAND_ANCHOR` plus this gun's `grip`, because the grip brick
   * is what the hands should be holding, not the model's centre. */
  hold: { forward: number; sideways: number; lowered: number };
  /** Where the pistol-grip brick sits inside the model: how far back from the
   * origin along the barrel axis, how far above it. `propMesh` in scene.ts lays
   * the brick out at exactly these offsets, so `grip` is the distance from the
   * hand anchor to the hands — change the brick and change this together. */
  grip: { back: number; up: number };
  /** Barrel tip, measured from the hand pose; the visual model matches it. */
  muzzleZ: number;
  /** Collider half-extents and mass, so a tube is heftier than a pistol. */
  collider: { s: [number, number, number]; mass: number };
  /** Firing sound. */
  sound: "shoot" | "shoot-fast" | "shoot-heavy" | "launch";
};
/**
 * The one point both fists meet at, in the aim frame about the shoulder line:
 * `forward` reach, `sideways`, `lowered`. Measured off the shipped rig by
 * CPU-skinning the fist vertices (`forearmL`/`forearmR` weights) at look pitches
 * −0.6…0.6 — the posed arms swing with the aim, so this point holds still as you
 * look up or down. Note the mitten sits only ~0.12 m past the elbow bone's own
 * origin while the arm chain is 1 m long: the chain's tail is NOT the hand, and
 * anchoring a tool there leaves it hanging in mid-air in front of the fists.
 * `squat` is the crouch scale (see `scene.ts`), which lifts the fists toward the
 * shoulders, so only `lowered` scales with it.
 */
export const HAND_ANCHOR = { forward: 0.40, sideways: 0, lowered: 0.37, squat: 0.63 };
export const GUNS: Record<GunKind, GunSpec> = {
  /** The starter shove gun — the numbers above are its tuning. */
  gun: {
    name: "SHOVE GUN",
    range: WEAPON.range,
    cooldown: WEAPON.cooldown,
    ammo: WEAPON.ammo,
    reloads: 2,
    reload: WEAPON.reload,
    pelletSpeed: WEAPON.pelletSpeed,
    pelletsLive: WEAPON.pelletsLive,
    pellets: 1,
    spread: WEAPON.tripleSpread * 2,
    knock: WEAPON.knock,
    lift: WEAPON.lift,
    damage: 1,
    stagger: WEAPON.stagger,
    explosive: false,
    homing: false,
    gravityScale: 0,
    boom: {
      radius: WEAPON.boomRadius,
      force: WEAPON.boomForce,
      lift: WEAPON.boomLift,
      damage: WEAPON.boomDamage,
    },
    recoil: WEAPON.recoil,
    radius: 0.1,
    hold: { forward: 0.54, sideways: 0, lowered: 0.17 },
    grip: { back: 0.14, up: 0.20 },
    muzzleZ: 0.64,
    collider: { s: [0.1, 0.11, 0.3], mass: 1.1 },
    sound: "shoot",
  },
  /** BUZZ GUN: a cheap drum of light rounds. Fast, weak, no reach. */
  smg: {
    name: "BUZZ GUN",
    range: 14,
    cooldown: 7,
    ammo: 26,
    reloads: 2,
    reload: 130,
    pelletSpeed: 26,
    pelletsLive: 90,
    pellets: 1,
    spread: 0.12,
    knock: 6.5,
    lift: 2.4,
    damage: 0.5,
    stagger: 14,
    explosive: false,
    homing: false,
    gravityScale: 0,
    boom: { radius: 3, force: 6, lift: 2.5, damage: 14 },
    recoil: 0.7,
    radius: 0.08,
    hold: { forward: 0.54, sideways: 0, lowered: 0.18 },
    grip: { back: 0.14, up: 0.19 },
    muzzleZ: 0.6,
    collider: { s: [0.1, 0.12, 0.34], mass: 1.25 },
    sound: "shoot-fast",
  },
  /** FAN GUN: seven rounds in a wide sheet. Terrible past ten metres. */
  shotgun: {
    name: "FAN GUN",
    range: 11,
    cooldown: 44,
    ammo: 4,
    reloads: 3,
    reload: 140,
    pelletSpeed: 22,
    pelletsLive: 45,
    pellets: 7,
    spread: 0.44,
    knock: 10.5,
    lift: 4.5,
    damage: 0.45,
    stagger: 30,
    explosive: false,
    homing: false,
    gravityScale: 0,
    boom: { radius: 3, force: 6, lift: 2.5, damage: 14 },
    recoil: 3.2,
    radius: 0.075,
    hold: { forward: 0.56, sideways: 0, lowered: 0.18 },
    grip: { back: 0.16, up: 0.19 },
    muzzleZ: 0.7,
    collider: { s: [0.11, 0.13, 0.38], mass: 1.5 },
    sound: "shoot-heavy",
  },
  /** LONG SHOT: slow to rack, but the round crosses the whole arena. */
  rifle: {
    name: "LONG SHOT",
    range: 34,
    cooldown: 40,
    ammo: 5,
    reloads: 3,
    reload: 150,
    pelletSpeed: 46,
    pelletsLive: 220,
    pellets: 1,
    spread: 0.06,
    knock: 12,
    lift: 5.5,
    damage: 1.5,
    stagger: 34,
    explosive: false,
    homing: false,
    gravityScale: 0,
    boom: { radius: 3, force: 6, lift: 2.5, damage: 14 },
    recoil: 3,
    radius: 0.09,
    hold: { forward: 0.44, sideways: 0, lowered: 0.18 },
    grip: { back: 0.04, up: 0.19 },
    muzzleZ: 0.92,
    collider: { s: [0.09, 0.12, 0.46], mass: 1.6 },
    sound: "shoot-heavy",
  },
  /** BOOM TUBE: a shell that loops under gravity and bursts on anything. */
  launcher: {
    name: "BOOM TUBE",
    range: 22,
    cooldown: 95,
    ammo: 2,
    reloads: 2,
    reload: 180,
    pelletSpeed: 17,
    pelletsLive: 240,
    pellets: 1,
    spread: 0,
    knock: 0,
    lift: 0,
    damage: 0,
    stagger: 28,
    explosive: true,
    homing: false,
    gravityScale: 0.5,
    boom: { radius: 5, force: 11, lift: 5.5, damage: 26 },
    recoil: 2.6,
    radius: 0.14,
    hold: { forward: 0.58, sideways: 0, lowered: 0.17 },
    grip: { back: 0.18, up: 0.20 },
    muzzleZ: 0.78,
    collider: { s: [0.14, 0.16, 0.42], mass: 1.9 },
    sound: "launch",
  },
  /** SEEKER: three lazy rounds that bend toward whoever is nearest. */
  seeker: {
    name: "SEEKER",
    range: 20,
    cooldown: 52,
    ammo: 3,
    reload: 160,
    reloads: 2,
    pelletSpeed: 14,
    pelletsLive: 300,
    pellets: 3,
    spread: 0.6,
    knock: 8,
    lift: 4,
    damage: 0.8,
    stagger: 22,
    explosive: false,
    homing: true,
    gravityScale: 0,
    boom: { radius: 3, force: 6, lift: 2.5, damage: 14 },
    recoil: 1.4,
    radius: 0.12,
    hold: { forward: 0.58, sideways: 0, lowered: 0.18 },
    grip: { back: 0.18, up: 0.19 },
    muzzleZ: 0.66,
    collider: { s: [0.12, 0.13, 0.33], mass: 1.35 },
    sound: "shoot",
  },
};
/** Narrow a prop kind to a gun kind; junk and tools come back false. */
export function isGun(kind: PropKind | undefined): kind is GunKind {
  return kind !== undefined && kind in GUNS;
}
/** Rounds the held gun holds, for an empty trigger with no gun in hand. */
export const magazineOf = (kind: PropKind | undefined) =>
  isGun(kind) ? GUNS[kind].ammo : WEAPON.ammo;
/** Spare rounds a fresh gun of this kind carries behind its magazine: this is
 *  what a reload takes from, and once it is gone the gun is spent. */
export const reserveOf = (kind: GunKind) => GUNS[kind].ammo * GUNS[kind].reloads;
/** How long a gun's reload takes in ticks under a build's reload scale
 *  (QUICK DRAW hands in 0.6 of the pistol's), scaled to each magazine. */
export const gunReloadTicks = (gun: GunSpec, reloadTicks: number) =>
  Math.max(1, Math.round((gun.reload * reloadTicks) / WEAPON.reload));
/**
 * Guns fall out of the sky through the round. The arena's own guns run dry
 * (each carries only `reloads` spare magazines), so the drops are what keep a
 * fight going: one gun appears every `period` ticks, up to `max` at once, and
 * an untouched one dissolves after `linger`.
 */
export const AIR = {
  /** Ticks between drops at 60 Hz. */
  period: 9 * 60,
  /** Metres above the landing point a gun appears. */
  height: 7.5,
  /** How far off a spawn it may land, metres. */
  scatter: 1.3,
  /** How far off the spawn's own floor the landing may be, metres. Anything
   *  further is a wall top or the void: try again. */
  maxDrop: 1.6,
  /** Drop at most this many guns at once. */
  max: 4,
  /** Ticks an untouched gun lies in the open before it dissolves. */
  linger: 45 * 60,
  /** HP scale for a thrown gun that is completely empty: dead weight as a club. */
  club: 1.8,
  /** The rotation drops cycle through, so a round sees every gun. */
  kinds: ["smg", "shotgun", "rifle", "gun", "seeker", "launcher"] as GunKind[],
};
/** Bare-handed shove — the base numbers the melee cards scale. */
export const FIST = {
  range: 1.95,
  radius: 0.44,
  cooldown: 38,
  knock: 9.5,
  lift: 3.6,
  recoil: 0.3,
  stagger: 26,
  /** A punch's relative-speed equivalent: how deep a wound it opens. */
  impact: 12,
};
/** HAMMER HANDS: a landed punch also bellows outward, mostly as a shove. */
export const MELEE_BOOM = { radius: 2.4, force: 6, lift: 2.5, damage: 2 };
/** How hard a throw leaves the hand: launch speed, a little lift, some spin. */
export const THROW = { speed: 17, lift: 2.6, spin: 3 };
/** A horn is harmless, but the authority still rate-limits the noise. */
export const HORN = { cooldown: 42 };
/** DOOR SLAMMER: a moving leaf launches the players it sweeps over. */
export const DOOR_SLAM = { force: 8, lift: 3 };
/** Relative speed that shatters a breakable window pane (metres per second). */
export const WINDOW = { break: 7 };
/**
 * Impacts worth hearing (design doc §17): contacts above `floor` relative m/s
 * are recorded by the authority and broadcast for spatial SFX; at `full` the
 * sound is at its biggest. Presentation only — no physics depends on this.
 */
export const IMPACT = { floor: 3, full: 12 };
/** Arena bounds (design doc §5): outside this box, or below y=-8, you are out. */
export const ARENA = { minX: -16, maxX: 16, minZ: -16, maxZ: 16 };
/** The "tiny arena" chaos modifier shrinks play to the centre stage. */
export const TINY_ARENA = { minX: -5, maxX: 5, minZ: -5, maxZ: 5 };
export const VOICE = {
  refDistance: 2,
  maxDistance: 22,
  rolloff: 1.25,
  distanceModel: "inverse" as const,
};
