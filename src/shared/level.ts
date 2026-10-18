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
  | "crate"
  | "ball"
  | "gun"
  | "bat"
  | "horn"
  | "chair"
  | "table"
  | "trashcan"
  | "bottle"
  | "bucket";
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
  { p: [-2, 0.5, -2], kind: "crate" },
  { p: [2, 0.5, 3], kind: "crate" },
  { p: [9, 0.5, 0], kind: "crate" },
  { p: [-4, 0.5, -2], kind: "gun" },
  { p: [0, 0.5, -9], kind: "gun" },
  { p: [0, 0.5, -4], kind: "bat" },
  { p: [-3, 0.5, 4], kind: "horn" },
  { p: [-9, 0.5, 0], kind: "ball" },
  { p: [8, 2.5, 8], kind: "ball" },
  { p: [0, 0.5, 9], kind: "chair" },
  { p: [3, 0.5, -4], kind: "table" },
  { p: [-1, 0.5, 3], kind: "trashcan" },
  { p: [-4, 0.5, -4], kind: "bottle" },
  { p: [4.5, 0.5, -4], kind: "bucket" },
  { p: [1.2, 0.5, -1.2], kind: "crate" },
  { p: [-9, 0.5, 0], kind: "gun" },
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
  /** Horizontal launch velocity (m/s) toward the perch. */
  vx: number;
  vz: number;
  /** Vertical launch speed (m/s). */
  bounce: number;
};
export const PADS: Pad[] = [
  { x: 3.5, z: 3.5, r: 0.8, vx: 5, vz: 5, bounce: 9 },
  { x: -3.5, z: -3.5, r: 0.8, vx: -5, vz: -5, bounce: 9 },
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
  "#ff9d00",
  "#32d41e",
  "#ff283b",
  "#00b2ff",
  "#a036ff",
  "#ffd800",
  "#00deb0",
  "#ff288f",
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
/** Short-range, authority-owned shove from a baseball bat. */
export const MELEE = {
  range: 2.35,
  radius: 0.48,
  cooldown: 34,
  knock: 11.5,
  lift: 4.2,
  recoil: 0.35,
  stagger: 30,
};
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
