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
export const LEVEL: Box[] = [
  // The common room and the hall: one floor, walls with a doorway north and east.
  { p: [0, -0.25, 0], s: [28, 0.5, 22], color: "#b7a892", kind: "floor" },
  // Roof slabs are hidden for the landing-page dollhouse view, then restored in-game.
  { p: [0, 5.8, 0], s: [28.4, 0.4, 22.4], color: "#d6d0bd", hide: true },
  { p: [-6, 2.8, -11], s: [16, 5.6, 0.4], color: "#ded7c5" },
  { p: [9.25, 2.8, -11], s: [9.5, 5.6, 0.4], color: "#ded7c5" },
  { p: [3.25, 4.1, -11], s: [2.5, 3, 0.4], color: "#ded7c5" },
  // The north wall, with two window openings (see WINDOWS); hidden for the dollhouse.
  { p: [-11.4, 2.8, 11], s: [5.2, 5.6, 0.4], color: "#d7cfbc", hide: true },
  // The middle span carries the patio doorway (see DOORS id 7).
  { p: [-4.2, 2.8, 11], s: [6, 5.6, 0.4], color: "#d7cfbc", hide: true },
  { p: [3.8, 2.8, 11], s: [6.8, 5.6, 0.4], color: "#d7cfbc", hide: true },
  { p: [-0.4, 4.6, 11], s: [1.6, 2, 0.4], color: "#d7cfbc", hide: true },
  { p: [11.4, 2.8, 11], s: [5.2, 5.6, 0.4], color: "#d7cfbc", hide: true },
  { p: [-8, 0.625, 11], s: [1.6, 1.25, 0.4], color: "#d7cfbc", hide: true },
  { p: [-8, 4.175, 11], s: [1.6, 2.85, 0.4], color: "#d7cfbc", hide: true },
  { p: [8, 0.625, 11], s: [1.6, 1.25, 0.4], color: "#d7cfbc", hide: true },
  { p: [8, 4.175, 11], s: [1.6, 2.85, 0.4], color: "#d7cfbc", hide: true },
  // The west wall, with a window opening at z=4 (see WINDOWS).
  { p: [-14, 2.8, -7.1], s: [0.4, 5.6, 7.8], color: "#d9d0bb" },
  { p: [-14, 2.8, 3.1], s: [0.4, 5.6, 15.8], color: "#d9d0bb" },
  { p: [-14, 0.625, 4], s: [0.4, 1.25, 1.6], color: "#d9d0bb" },
  { p: [-14, 4.175, 4], s: [0.4, 2.85, 1.6], color: "#d9d0bb" },
  { p: [14, 2.8, -6.3], s: [0.4, 5.6, 9.4], color: "#d9d0bb", hide: true },
  { p: [14, 2.8, 6.3], s: [0.4, 5.6, 9.4], color: "#d9d0bb", hide: true },
  { p: [14, 4.3, 0], s: [0.4, 2.6, 3.2], color: "#d9d0bb", hide: true },
  { p: [5, 2.8, -7], s: [0.35, 5.6, 8], color: "#678276" },
  { p: [5, 2.8, 7], s: [0.35, 5.6, 8], color: "#678276" },
  { p: [5, 4.6, 0], s: [0.35, 2, 6], color: "#678276" },
  { p: [-9, 0.45, -7.8], s: [5, 0.9, 1.8], color: "#71806c", kind: "couch" },
  { p: [-9, 1.12, -8.45], s: [4.9, 0.7, 0.4], color: "#71806c" },
  { p: [-11.55, 0.9, -7.8], s: [0.35, 1.5, 1.66], color: "#71806c" },
  { p: [-6.45, 0.9, -7.8], s: [0.35, 1.5, 1.66], color: "#71806c" },
  { p: [-9, 0.28, -4.8], s: [3.3, 0.56, 1.5], color: "#705844", kind: "table" },
  { p: [-10, 1.2, 7.8], s: [6, 0.2, 1.6], color: "#997b58" },
  { p: [-12.7, 0.6, 7.8], s: [0.18, 1.2, 1.4], color: "#424d45" },
  { p: [-7.3, 0.6, 7.8], s: [0.18, 1.2, 1.4], color: "#424d45" },
  // The kitchen, tucked into the south-east corner; open doorway at z 6.2..8.
  { p: [1, 2.8, 5.1], s: [0.35, 5.6, 2.2], color: "#678276" },
  { p: [1, 2.8, 9.5], s: [0.35, 5.6, 3], color: "#678276" },
  { p: [3, 2.8, 4], s: [4, 5.6, 0.35], color: "#678276" },
  { p: [4.1, 0.6, 7.5], s: [1, 1.2, 6], color: "#9aa5a8" },
  { p: [4.1, 1.32, 6], s: [0.7, 0.24, 0.9], color: "#3d4148" },
  { p: [3.4, 1.1, 10.3], s: [1.3, 2.2, 0.9], color: "#cdd3d6" },
  // The hall stair: four steps north, four more east, up to the mezzanine deck.
  { p: [9, 0.15, -6], s: [3, 0.3, 1], color: "#a89b84" },
  { p: [9, 0.3, -7], s: [3, 0.6, 1], color: "#a89b84" },
  { p: [9, 0.45, -8], s: [3, 0.9, 1], color: "#a89b84" },
  { p: [9, 0.6, -9], s: [3, 1.2, 1], color: "#a89b84" },
  { p: [10.86, 0.75, -9.4], s: [0.72, 1.5, 2.4], color: "#a89b84" },
  { p: [11.58, 0.9, -9.4], s: [0.72, 1.8, 2.4], color: "#a89b84" },
  { p: [12.3, 1.05, -9.4], s: [0.72, 2.1, 2.4], color: "#a89b84" },
  { p: [13.02, 1.2, -9.4], s: [0.72, 2.4, 2.4], color: "#a89b84" },
  { p: [11.9, 2.575, -5.7], s: [4.2, 0.25, 5], color: "#8b7d64", kind: "deck" },
  { p: [9.8, 3.15, -5.7], s: [0.12, 0.9, 5], color: "#5c6b58" },
  { p: [11.9, 3.15, -3.2], s: [4.2, 0.9, 0.12], color: "#5c6b58" },
  { p: [10.9, 3.15, -8.2], s: [2.2, 0.9, 0.12], color: "#5c6b58" },
  // The workshop, east through the sliding doors.
  { p: [22, -0.25, 0], s: [16, 0.5, 18], color: "#a89e8b", kind: "floor" },
  { p: [22, 5.8, 0], s: [16.4, 0.4, 18.4], color: "#cec6b2", hide: true },
  // The workshop east wall, with a window opening at z=2 (see WINDOWS).
  { p: [30, 2.8, -5.2], s: [0.4, 5.6, 8], color: "#cdc4ae" },
  { p: [30, 2.8, 6], s: [0.4, 5.6, 6.4], color: "#cdc4ae" },
  { p: [30, 0.625, 2], s: [0.4, 1.25, 1.6], color: "#cdc4ae" },
  { p: [30, 4.175, 2], s: [0.4, 2.85, 1.6], color: "#cdc4ae" },
  { p: [21.9, 2.8, -9], s: [15.8, 5.6, 0.4], color: "#cdc4ae" },
  { p: [21.9, 2.8, 9], s: [15.8, 5.6, 0.4], color: "#cdc4ae", hide: true },
  { p: [24, 2.8, -7.75], s: [0.4, 5.6, 2.5], color: "#c3b9a2" },
  { p: [24, 2.8, -3.45], s: [0.4, 5.6, 2.9], color: "#c3b9a2" },
  { p: [24, 4.4, -5.7], s: [0.4, 2.4, 1.6], color: "#c3b9a2" },
  { p: [27, 2.8, -2], s: [6, 5.6, 0.4], color: "#c3b9a2" },
  { p: [18, 0.45, -6], s: [6, 0.9, 1.6], color: "#7a6a52", kind: "table" },
  { p: [16.4, 1.6, 5], s: [1.2, 3.2, 5], color: "#8a7c63" },
  { p: [21, 0.3, 5.5], s: [3.4, 0.6, 2.2], color: "#6f6350", kind: "table" },
  { p: [27, 0.5, 5], s: [1, 1, 1], color: "#9c8f76" },
  { p: [27, 1.5, 5], s: [0.9, 0.9, 0.9], color: "#8d8168" },
  { p: [28.9, 0.7, -6], s: [1.4, 0.16, 4], color: "#6d6552", kind: "rack" },
  { p: [28.9, 1.35, -6], s: [1.4, 0.16, 4], color: "#6d6552", kind: "rack" },
  // The yard, north through the barn doors.
  { p: [0, -0.25, -18.5], s: [26, 0.5, 15], color: "#8fa27d", kind: "floor" },
  { p: [-13, 1.2, -18.4], s: [0.4, 2.4, 14.8], color: "#cfc7b2" },
  { p: [13, 1.2, -18.4], s: [0.4, 2.4, 14.8], color: "#cfc7b2" },
  { p: [0, 1.2, -26], s: [26.4, 2.4, 0.4], color: "#cfc7b2" },
  { p: [5, 0.03, -18], s: [12, 0.06, 11], color: "#c3b79c", kind: "court" },
  { p: [-6, 0.3, -13.4], s: [9, 0.6, 3.4], color: "#8d7a5e", kind: "deck" },
  { p: [-6, 0.15, -15.4], s: [9, 0.3, 0.6], color: "#8d7a5e" },
  // A shed at the back of the yard, with its own door.
  { p: [-12, 1.3, -22], s: [0.3, 2.6, 3.7], color: "#7d7361" },
  { p: [-9.5, 1.3, -24], s: [5.3, 2.6, 0.3], color: "#7d7361" },
  { p: [-7, 1.3, -22], s: [0.3, 2.6, 3.7], color: "#7d7361" },
  { p: [-11.3, 1.3, -20], s: [1.7, 2.6, 0.3], color: "#7d7361" },
  { p: [-7.85, 1.3, -20], s: [2.2, 2.6, 0.3], color: "#7d7361" },
  { p: [-9.7, 2.4, -20], s: [1.6, 0.4, 0.34], color: "#7d7361" },
  { p: [-9.5, 2.75, -22], s: [5.6, 0.3, 4.6], color: "#6a6152" },
  // A hoop worth throwing a ball at: backboard, posts, and a ring you can rattle.
  { p: [5, 3.3, -24.2], s: [3, 1.8, 0.16], color: "#e7dfc8" },
  { p: [3.6, 1.65, -24.45], s: [0.2, 3.3, 0.2], color: "#5d6a5a" },
  { p: [6.4, 1.65, -24.45], s: [0.2, 3.3, 0.2], color: "#5d6a5a" },
  ...Array.from({ length: 10 }, (_, i): Box => {
    const a = (i / 10) * Math.PI * 2;
    return {
      p: [5 + Math.cos(a) * 0.46, 2.6, -23.45 + Math.sin(a) * 0.46],
      s: [0.2, 0.1, 0.2],
      color: "#d0603f",
      kind: "hoop",
    };
  }),
  // The pool: an above-ground basin at the back of the yard. Water is visual only.
  { p: [-1.5, 0.45, -24.625], s: [4.5, 0.9, 0.25], color: "#d8d2c0" },
  { p: [-1.5, 0.45, -21.375], s: [4.5, 0.9, 0.25], color: "#d8d2c0" },
  { p: [-3.625, 0.45, -23], s: [0.25, 0.9, 3.0], color: "#d8d2c0" },
  { p: [0.625, 0.45, -23], s: [0.25, 0.9, 3.0], color: "#d8d2c0" },
  { p: [-1.5, 0.04, -23], s: [4.0, 0.16, 3.0], color: "#a9c4bd" },
  // The trampoline: a springy mat the "MIND THE BOUNCE." sign is about.
  { p: [8.5, 0.29, -15], s: [3, 0.06, 4], color: "#4a5a66" },
  { p: [8.5, 0.29, -17.05], s: [3.1, 0.12, 0.1], color: "#7d8a94" },
  { p: [8.5, 0.29, -12.95], s: [3.1, 0.12, 0.1], color: "#7d8a94" },
  { p: [6.95, 0.29, -15], s: [0.1, 0.12, 4.2], color: "#7d8a94" },
  { p: [10.05, 0.29, -15], s: [0.1, 0.12, 4.2], color: "#7d8a94" },
  // The explosive grill: an extremely bad place to stand, on its own clock.
  { p: [3.5, 0.62, -19.5], s: [0.85, 0.42, 0.7], color: "#4a4a4f" },
  { p: [3.5, 0.88, -19.5], s: [0.72, 0.06, 0.58], color: "#2e2e33" },
  { p: [3.5, 0.21, -19.5], s: [0.55, 0.42, 0.45], color: "#3a3a3f" },
  // The patio: a low deck off the south wall, fenced on three sides.
  { p: [0, -0.25, 13.5], s: [16, 0.5, 5], color: "#b09468", kind: "floor" },
  { p: [-8, 0.75, 13.5], s: [0.3, 1.5, 5], color: "#9c8f76" },
  { p: [8, 0.75, 13.5], s: [0.3, 1.5, 5], color: "#9c8f76" },
  { p: [0, 0.75, 16], s: [16.3, 1.5, 0.3], color: "#9c8f76" },
  // Planters along the south fence and two trees beyond it.
  { p: [-4, 0.3, 15.55], s: [1.4, 0.6, 0.5], color: "#9c6b4a" },
  { p: [-4, 0.72, 15.55], s: [1.2, 0.24, 0.38], color: "#5f7d4f" },
  { p: [4, 0.3, 15.55], s: [1.4, 0.6, 0.5], color: "#9c6b4a" },
  { p: [4, 0.72, 15.55], s: [1.2, 0.24, 0.38], color: "#5f7d4f" },
  { p: [-6, 0.9, 18.5], s: [0.5, 1.8, 0.5], color: "#7d6a52" },
  { p: [-6, 2.3, 18.5], s: [2.4, 1.6, 2.4], color: "#5f7d4f" },
  { p: [-6, 3.3, 18.5], s: [1.7, 1.1, 1.7], color: "#6b8a58" },
  { p: [5.5, 0.9, 19], s: [0.5, 1.8, 0.5], color: "#7d6a52" },
  { p: [5.5, 2.3, 19], s: [2.4, 1.6, 2.4], color: "#5f7d4f" },
  { p: [5.5, 3.3, 19], s: [1.7, 1.1, 1.7], color: "#6b8a58" },
];
/** Sliding leaves. Ids are independent of prop ids; both are validated server-side. */
export const DOORS: Door[] = [
  {
    id: 1,
    p: [13.65, 1.5, -0.8],
    s: [0.24, 3, 1.6],
    slide: [0, 0, -1.62],
    color: "#93a898",
    auto: true,
    zone: "The workshop",
  },
  {
    id: 2,
    p: [13.65, 1.5, 0.8],
    s: [0.24, 3, 1.6],
    slide: [0, 0, 1.62],
    color: "#93a898",
    auto: true,
    zone: "The workshop",
  },
  {
    id: 3,
    p: [2.63, 1.3, -10.65],
    s: [1.25, 2.6, 0.22],
    slide: [-1.3, 0, 0],
    color: "#a2704e",
    zone: "The yard",
  },
  {
    id: 4,
    p: [3.88, 1.3, -10.65],
    s: [1.25, 2.6, 0.22],
    slide: [1.3, 0, 0],
    color: "#a2704e",
    zone: "The yard",
  },
  {
    id: 5,
    p: [-9.7, 1.1, -19.8],
    s: [1.6, 2.2, 0.18],
    slide: [-1.68, 0, 0],
    color: "#8a5f42",
    zone: "The shed",
  },
  {
    id: 6,
    p: [23.65, 1.6, -5.7],
    s: [0.2, 3.2, 1.6],
    slide: [0, 0, 1.68],
    color: "#8d9aa6",
    zone: "The back room",
  },
  {
    id: 7,
    p: [-0.4, 1.5, 10.65],
    s: [1.6, 3, 0.24],
    slide: [1.62, 0, 0],
    color: "#a2704e",
    zone: "The patio",
  },
];
/** Breakable glass panes in openings carved into the outer walls (see LEVEL). */
export type WindowDef = {
  id: number;
  p: [number, number, number];
  s: [number, number, number];
  /** Frame colour; the glass tint is fixed in the scene. */
  color: string;
};
export const WINDOWS: WindowDef[] = [
  { id: 1, p: [-8, 2.0, 11], s: [1.6, 1.5, 0.4], color: "#8f8265" },
  { id: 2, p: [8, 2.0, 11], s: [1.6, 1.5, 0.4], color: "#8f8265" },
  { id: 3, p: [-14, 2.0, 4], s: [0.4, 1.5, 1.6], color: "#8f8265" },
  { id: 4, p: [30, 2.0, 2], s: [0.4, 1.5, 1.6], color: "#8f8265" },
];
export const SPAWNS = [
  [0, 1, 5],
  [-2, 1, 5],
  [-9, 1, 9],
  [-2, 1, 1],
  [-3, 1, 3],
  [3, 1, 3],
  [-4, 1, 5],
  [3, 1, -1],
];
export const PROPS: Prop[] = [
  { p: [-2, 0.5, -1], kind: "crate" },
  { p: [0, 0.5, -2], kind: "crate" },
  { p: [2, 0.5, -1], kind: "crate" },
  { p: [-1, 0.5, 1], kind: "crate" },
  { p: [9, 1.8, -9], kind: "crate" },
  { p: [12, 0.5, 2], kind: "crate" },
  { p: [10, 0.5, 3], kind: "ball" },
  { p: [0, 0.5, -6], kind: "crate" },
  // Weapons start on open floor where a player can stand and aim at them;
  // bench-top and shelf spawns left them half-embedded in furniture.
  { p: [18, 0.5, -4], kind: "gun" },
  { p: [27, 0.5, 1], kind: "gun" },
  { p: [6, 0.5, -4], kind: "gun" },
  { p: [5, 0.6, -18], kind: "ball" },
  { p: [7.5, 0.6, -21], kind: "ball" },
  { p: [21, 0.9, 5.5], kind: "crate" },
  { p: [-9.5, 0.5, -22], kind: "crate" },
  { p: [-6, 1, -13.4], kind: "gun" },
  { p: [20.5, 0.5, -4], kind: "bat" },
  { p: [-8.8, 1.25, 7.8], kind: "horn" },
  { p: [-6, 0.5, 1], kind: "chair" },
  { p: [18, 0.5, 1], kind: "chair" },
  { p: [7, 0.5, 1], kind: "table" },
  { p: [-6, 0.5, -21], kind: "trashcan" },
  { p: [8, 0.5, -20], kind: "bottle" },
  { p: [-5, 0.5, -21], kind: "bucket" },
  // Kitchen junk and the patio garden set.
  { p: [2, 0.5, 9], kind: "bottle" },
  { p: [2.5, 0.5, 5.5], kind: "bucket" },
  { p: [1.7, 0.5, 6.8], kind: "chair" },
  { p: [0, 0.5, 13.5], kind: "table" },
  { p: [-2.5, 0.5, 13], kind: "chair" },
  { p: [2.5, 0.5, 14.2], kind: "chair" },
];
export const PROP_STARTS = PROPS.map((p) => p.p);
export const propKind = (id: number): PropKind | undefined =>
  PROPS[id - 1]?.kind;
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
  range: 42,
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
/** The trampoline mat in the yard; hard landings on it launch the player. */
export const TRAMPOLINE = { x: 8.5, z: -15, rx: 1.8, rz: 2.3, bounce: 13 };
/**
 * The pool basin (design doc §10): falling in removes the player from combat —
 * no damage taken or dealt, no firing — until `drown` ticks run out and the
 * water spits them out toward their own spawn.
 */
export const POOL = {
  x: -1.5,
  z: -23,
  rx: 2.0,
  rz: 1.5,
  /** Wall-top height; feet (centre minus 0.85) below this count as in the water. */
  rim: 0.9,
  /** Ticks of floating before the launch. */
  drown: 240,
  /** Floating centre height: chest-deep, eyes above the rim. */
  waterY: 0.55,
  /** Water-surface height; feet rest here when they are spat out. */
  surface: 0.12,
  /** Launch speed toward the player's own spawn (m/s). */
  launchX: 11,
  launchY: 9,
  /** Safety cap on the ballistic flight out of the pool. */
  launchTicks: 90,
};
/** Sprinkler-wet grass in the yard; steering barely bites while grounded in it. */
export const SLIP = {
  factor: 0.3,
  patches: [
    { x: 4.5, z: -16, r: 2 },
    { x: -7, z: -18.5, r: 1.8 },
  ],
};
/** The explosive grill: every `period` ticks it is a bad place to stand. */
export const GRILL = {
  x: 3.5,
  z: -19.5,
  period: 420,
  radius: 2.6,
  force: 8,
  lift: 5,
  /** HP taken at full falloff. */
  damage: 18,
};
/** The lawn mower: a moving hazard that mows the yard on its own loop. */
export const MOWER = {
  /** The patrol route corners, in order; the mower walks them and repeats. */
  path: [
    { x: -6.4, z: -16.2 },
    { x: 6.2, z: -16.2 },
    { x: 6.2, z: -25.3 },
    { x: -6.4, z: -25.3 },
  ],
  /** Forward speed in metres per second. */
  speed: 2.2,
  /** How far from the centreline the blades reach. */
  radius: 1.1,
  force: 7,
  lift: 4,
  /** HP taken at full falloff. */
  damage: 10,
  /** Ticks of immunity after a clip, so one pass hurts once. */
  cooldown: 60,
};
export const VOICE = {
  refDistance: 2,
  maxDistance: 22,
  rolloff: 1.25,
  distanceModel: "inverse" as const,
};
