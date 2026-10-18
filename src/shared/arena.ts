/**
 * Procedurally generated combat arenas (design doc §5). A room's arena is
 * *derived* from its six-character room code on both sides — the same seed
 * means the same geometry, so nothing about the arena ever crosses the wire.
 * This follows the chaos-modifier pattern (`chaosModifierFor` in match.ts):
 * pure, deterministic, isomorphic. The hand-built Stage remains the default
 * layout for lobby previews, tests and any empty seed.
 *
 * A generated layout is a mid-sized combat arena: a central slab always at
 * (0, 0, 0) with its top at y=0 (the match machine and the server tests lean
 * on that origin), satellite platforms and branch platforms around it, one or
 * two elevated perches reachable only by bounce pads, cover walls to fight
 * behind, eight spawns on reachable ground and a scattering of props.
 * Everything floats over the void; leaving the bounds or the world is out.
 */
import { ARENA, DOORS, LEVEL, PADS, PROPS, SPAWNS, WINDOWS } from "./level.js";
import type { Box, Door, Pad, Prop, WindowDef } from "./level.js";

export type Spawn = [number, number, number];
export type Bounds = { minX: number; maxX: number; minZ: number; maxZ: number };
/** Everything a room needs: the authority and each prediction world build
 * the same arena from the same layout, and `GameScene` renders it. */
export type ArenaLayout = {
  /** Human-readable label, generated with the seed. UI flavour only. */
  name: string;
  level: Box[];
  doors: Door[];
  windows: WindowDef[];
  spawns: Spawn[];
  props: Prop[];
  pads: Pad[];
  bounds: Bounds;
};

/** The hand-built Stage, exported unchanged as the default layout. */
export const DEFAULT_ARENA: ArenaLayout = {
  name: "The Stage",
  level: LEVEL,
  doors: DOORS,
  windows: WINDOWS,
  spawns: SPAWNS.map((s) => [s[0], s[1], s[2]]),
  props: PROPS,
  pads: PADS,
  bounds: ARENA,
};

/** FNV-1a into a 32-bit seed, then mulberry32 — the same generator match.ts
 * uses in spirit, kept local so arena tuning never touches chaos draws. */
function hashSeed(seed: string) {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = (h * 16777619) | 0;
  }
  return h;
}
function rng(seed: number) {
  let s = seed | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const DIRS = [
  [1, 0],
  [0, 1],
  [-1, 0],
  [0, -1],
  [1, 1],
  [1, -1],
  [-1, 1],
  [-1, -1],
];
/** Platform tops ride the centre slab's height by small steps; anything the
 * player cannot clear with the default 6.5 m/s jump stays one-way fun, never
 * a spawn path. */
const HEIGHTS = [-1.4, -0.7, 0, 0.7];
const TINTS: [min: number, color: string][] = [
  [-2.6, "#3f4b5c"],
  [-0.6, "#4b5563"],
  [0.9, "#5b6472"],
  [1.9, "#6d4f8f"],
];
function tint(top: number) {
  let color = TINTS[0][1];
  for (const [t, c] of TINTS) if (top >= t) color = c;
  return color;
}

const ARENA_NAMES = [
  "Skybridge Flats",
  "Cinder Commons",
  "Perchwood",
  "The Tip-Off",
  "Gravel & Gantry",
  "Ledgeholm",
  "Bounceburg",
  "Overhang Arena",
  "Slabwater",
  "The Long Tally",
  "Rivet Yard",
  "Highfall",
];

export const buildArena = (seed: string): ArenaLayout => {
  const key = (seed || "").toUpperCase().trim();
  if (!key) return DEFAULT_ARENA;
  const r = rng(hashSeed(key));
  const boxes: Box[] = [];
  const pads: Pad[] = [];
  const spawns: Spawn[] = [];
  const props: Prop[] = [];
  /** Placed platform footprints: {cx, cz, hw, hd, top} for overlap maths. */
  const nodes: { cx: number; cz: number; hw: number; hd: number; top: number }[] = [];

  const clash = (cx: number, cz: number, hw: number, hd: number, top: number) =>
    nodes.some(
      (n) =>
        Math.abs(cx - n.cx) < hw + n.hw + 0.8 &&
        Math.abs(cz - n.cz) < hd + n.hd + 0.8 &&
        Math.abs(top - n.top) < 1.3,
    );

  // The centre slab: always at the origin, always wide enough for TINY_ARENA.
  const chw = 4.5 + (r() < 0.5 ? 0 : 1);
  const chd = 4.5 + (r() < 0.5 ? 0 : 1);
  nodes.push({ cx: 0, cz: 0, hw: chw, hd: chd, top: 0 });
  boxes.push({ p: [0, -0.25, 0], s: [chw * 2, 0.5, chd * 2], color: "#4b5563", kind: "stage" });

  const attach = (parent: number) => {
    const n = nodes[parent];
    for (let attempt = 0; attempt < 12; attempt++) {
      const [dx, dz] = DIRS[Math.floor(r() * DIRS.length)];
      const hw = 1.5 + Math.floor(r() * 4) * 0.5;
      const hd = 1.5 + Math.floor(r() * 4) * 0.5;
      const gap = 0.3 + r();
      const cx = n.cx + dx * (n.hw + hw + gap) + (dx ? 0 : (r() * 2 - 1) * (n.hw + hw - 1.2));
      const cz = n.cz + dz * (n.hd + hd + gap) + (dz ? 0 : (r() * 2 - 1) * (n.hd + hd - 1.2));
      const top = Math.max(-2.4, Math.min(2.4, n.top + HEIGHTS[Math.floor(r() * HEIGHTS.length)]));
      if (clash(cx, cz, hw, hd, top)) continue;
      boxes.push({ p: [cx, top - 0.25, cz], s: [hw * 2, 0.5, hd * 2], color: tint(top) });
      nodes.push({ cx, cz, hw, hd, top });
      return true;
    }
    return false;
  };

  // A ring of satellites on the centre, then shorter branches off the ring.
  const satellites = 5 + Math.floor(r() * 2);
  for (let i = 0; i < satellites; i++) attach(0);
  const branches = 3 + Math.floor(r() * 3);
  for (let i = 0; i < branches; i++) attach(1 + Math.floor(r() * Math.max(1, nodes.length - 1)));

  // Eight spawns on the widest, safest ground: centre slab twice, then one
  // per remaining platform, filling with large platforms if it runs short.
  const roomy = nodes
    .map((n, i) => ({ n, i }))
    .sort((a, b) => b.n.hw * b.n.hd - a.n.hw * a.n.hd)
    .filter((x) => x.n.hw >= 2.4 && x.n.hd >= 2.4 && x.n.top <= 2.4 - 1.9);
  const at = (n: { cx: number; cz: number; hw: number; hd: number; top: number }): Spawn => [
    n.cx + (r() * 2 - 1) * Math.max(0, n.hw - 1.4),
    n.top + 1,
    n.cz + (r() * 2 - 1) * Math.max(0, n.hd - 1.4),
  ];
  for (let i = 0; i < 2 && spawns.length < 8; i++) {
    const c = nodes[0];
    spawns.push([c.cx + (i ? 1 : -1) * (c.hw * 0.45), 1, c.cz + (i ? 1 : -1) * (c.hd * 0.45)]);
  }
  for (const room of roomy) {
    if (spawns.length >= 8) break;
    if (room.i === 0) continue;
    spawns.push(at(room.n));
  }
  for (let i = 0; spawns.length < 8 && i < 16; i++) {
    const n = nodes[(i + 1) % nodes.length];
    if (n.hw < 2.4 || n.hd < 2.4) continue;
    spawns.push(at(n));
  }
  while (spawns.length < 8) {
    const c = nodes[0];
    spawns.push([c.cx + (r() * 2 - 1) * (c.hw - 1.4), 1, c.cz + (r() * 2 - 1) * (c.hd - 1.4)]);
  }

  const nearSpawn = (x: number, z: number, pad = 1.6) =>
    spawns.some((s) => Math.hypot(s[0] - x, s[2] - z) < pad);
  const nearPad = (x: number, z: number, pad = 1.4) =>
    pads.some((p) => Math.hypot(p.x - x, p.z - z) < pad);

  // One or two perches, each paired with a bounce pad aimed at it from its
  // parent — same launch numbers the hand-built Stage uses. Pads are purely
  // triggers like the Stage's: the coil is drawn in scene.ts, and no collider
  // sits on the floor to snag a walker. Pads also stay clear of spawns, or a
  // player would materialise already airborne off the trigger.
  for (let i = 0, tries = 0; i < 1 + Math.floor(r() * 2) && tries < 10; i++, tries++) {
    if (nodes.length < 2) break;
    // First perch always hangs off the centre slab so every arena has a
    // pad you can reach by walking; later ones may ride any satellite.
    const n = i === 0 ? nodes[0] : nodes[1 + Math.floor(r() * (nodes.length - 1))];
    if (n.hw < 2.4 || n.hd < 2.4) continue;
    const [dx, dz] = DIRS[Math.floor(r() * DIRS.length)];
    // Same geometry as the hand-built Stage: the pad sits 1.5 m inside its
    // parent's edge, the perch centre 3 m beyond it, 2 m up, launch 5+5+9.
    const px = n.cx + dx * (n.hw + 3),
      pz = n.cz + dz * (n.hd + 3);
    const phw = 1.3 + r() * 0.4,
      phd = 1.3 + r() * 0.4,
      ptop = Math.min(2.4, n.top + 2);
    const padX = n.cx + dx * (n.hw - 1.5),
      padZ = n.cz + dz * (n.hd - 1.5);
    if (
      clash(px, pz, phw, phd, ptop) ||
      nearSpawn(padX, padZ, 2.2) ||
      nearSpawn(px, pz, 1.8)
    ) {
      i--;
      continue;
    }
    pads.push({ x: padX, z: padZ, r: 0.8, y: n.top, vx: dx * 5, vz: dz * 5, bounce: 9 });
    nodes.push({ cx: px, cz: pz, hw: phw, hd: phd, top: ptop });
    boxes.push({ p: [px, ptop - 0.25, pz], s: [phw * 2, 0.5, phd * 2], color: "#6d4f8f", kind: "perch" });
  }

  // Cover walls on the big lower platforms: waist-high, vaultable, never
  // tucked against an edge, a pad or a spawn, and never inside the walkable
  // ring the browser tests fight and walk across at the centre.
  for (let i = 0, tries = 0; i < 2 + Math.floor(r() * 3) && tries < 24; tries++) {
    const ni = Math.floor(r() * Math.max(1, nodes.length - 1));
    const n = nodes[ni];
    if (n.hw * n.hd < 6.25 || n.hw < 3 || n.hd < 3) continue;
    i++;
    const len = 1.6 + r() * 2.2,
      h = 0.7 + r() * 0.45;
    const flat = r() < 0.5;
    const hw = flat ? len / 2 : 0.22,
      hd = flat ? 0.22 : len / 2;
    const x = n.cx + (r() * 2 - 1) * Math.max(0, n.hw - hw - 1),
      z = n.cz + (r() * 2 - 1) * Math.max(0, n.hd - hd - 1);
    if (
      nearSpawn(x, z) ||
      nearPad(x, z) ||
      Math.hypot(x, z) < 2.6 ||
      boxes.some(
        (b) =>
          b.kind === "wall" &&
          Math.abs(b.p[0] - x) < b.s[0] / 2 + hw + 0.3 &&
          Math.abs(b.p[2] - z) < b.s[2] / 2 + hd + 0.3,
      ) ||
      nodes.some(
        (m, mi) =>
          mi !== ni &&
          Math.abs(x - m.cx) < hw + m.hw + 0.8 &&
          Math.abs(z - m.cz) < hd + m.hd + 0.8 &&
          Math.abs(n.top + h / 2 - m.top) < 1.3,
      )
    )
      continue;
    boxes.push({ p: [x, n.top + h / 2, z], s: [hw * 2, h, hd * 2], color: "#565e6e", kind: "wall" });
  }

  // Props: a guaranteed fighting load-out, then junk. Everything rests on a
  // platform, clear of spawns, pads, perches, walls and other props.
  const load: Prop["kind"][] = [
    "gun",
    "gun",
    "bat",
    "bat",
    "horn",
    "ball",
    "ball",
    "crate",
    "crate",
    "crate",
    "trashcan",
    "bottle",
    "bucket",
    "chair",
  ];
  const junk: Prop["kind"][] = ["table", "trashcan", "bottle", "bucket"];
  const wanted = [
    ...load,
    ...Array(1 + Math.floor(r() * 3)).map(() => junk[Math.floor(r() * junk.length)]),
  ];
  for (const kind of wanted) {
    for (let attempt = 0; attempt < 20; attempt++) {
      // The first gun, horn and crate always rest on the centre slab: the
      // opening fight and the browser tests need reachable ground there.
      const centreFirst = !props.some((p) => p.kind === kind) && (kind === "gun" || kind === "horn" || kind === "crate");
      const n = centreFirst ? nodes[0] : nodes[Math.floor(r() * Math.max(1, nodes.length - 1))];
      if (n.hw < 2.4 || n.hd < 2.4) continue;
      const x = n.cx + (r() * 2 - 1) * Math.max(0, n.hw - 1),
        z = n.cz + (r() * 2 - 1) * Math.max(0, n.hd - 1);
      if (
        nearSpawn(x, z, 1.3) ||
        nearPad(x, z, 1.2) ||
        props.some((p) => Math.hypot(p.p[0] - x, p.p[2] - z) < 1.2) ||
        boxes.some(
          (b) =>
            b.kind === "wall" &&
            Math.abs(b.p[0] - x) < b.s[0] / 2 + 0.9 &&
            Math.abs(b.p[2] - z) < b.s[2] / 2 + 0.9,
        )
      )
        continue;
      props.push({ p: [x, n.top + 0.5, z], kind });
      break;
    }
  }
  // Guarantee the fighting load-out survives even if every random spot clashed.
  const fallback: Array<[kind: Prop["kind"], x: number, z: number]> = [
    ["gun", -0.6, -0.6],
    ["bat", 0.6, -0.6],
    ["horn", -0.6, 0.6],
    ["ball", 0.6, 0.6],
    ["crate", 0, 0.3],
  ];
  for (const [kind, fx, fz] of fallback) {
    if (props.some((p) => p.kind === kind)) continue;
    props.push({ p: [nodes[0].cx + fx * nodes[0].hw, 0.5, nodes[0].cz + fz * nodes[0].hd], kind });
  }

  let minX = Infinity,
    maxX = -Infinity,
    minZ = Infinity,
    maxZ = -Infinity;
  for (const n of nodes) {
    minX = Math.min(minX, n.cx - n.hw);
    maxX = Math.max(maxX, n.cx + n.hw);
    minZ = Math.min(minZ, n.cz - n.hd);
    maxZ = Math.max(maxZ, n.cz + n.hd);
  }
  return {
    name: ARENA_NAMES[Math.floor(r() * ARENA_NAMES.length)],
    level: boxes,
    doors: [],
    windows: [],
    spawns,
    props,
    pads,
    bounds: { minX: minX - 2.5, maxX: maxX + 2.5, minZ: minZ - 2.5, maxZ: maxZ + 2.5 },
  };
};
