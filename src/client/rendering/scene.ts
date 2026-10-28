import * as THREE from "three";
import { GLTFLoader, type GLTF } from "three/addons/loaders/GLTFLoader.js";
import { clone } from "three/addons/utils/SkeletonUtils.js";
import {
  CHARACTER_PALETTE,
  GUNS,
  PALETTE,
  isGun,
  type Box,
  type GunKind,
  type PropKind,
  type Vec3,
} from "../../shared/level";
import { DEFAULT_ARENA, type ArenaLayout } from "../../shared/arena";
import { PELLET_ID_BASE, type DoorState, type WindowState } from "../../shared/simulation";
import { cardBit } from "../../shared/upgrades";
import {
  DEFAULT_COSMETICS,
  EMOTES,
  SKINS,
  type Cosmetics,
} from "../../shared/cosmetics";
import type { PlayerState, PropState } from "../../shared/protocol";

/** Every gun's rounds get their own colour, silhouette and tracer length in
 *  flight. Snapshots carry no gun kind, so the shot message tells the scene
 *  which ids are which; `stretch` is how long the tracer reads, `hot` draws it
 *  additively, and `shape` picks the mesh — a needle, a shell, a comet. */
type Look = {
  color: string;
  size: number;
  stretch: number;
  hot: boolean;
  shape: "slug" | "dart" | "facet" | "needle" | "shell" | "comet";
  /** The boom tube's shell tumbles as it arcs. */
  spin?: boolean;
};
const LOOKS: Record<GunKind, Look> = {
  gun: { color: "#ffcf8a", size: 1, stretch: 3.2, hot: false, shape: "slug" },
  smg: { color: "#7de8ff", size: 0.75, stretch: 3.6, hot: false, shape: "dart" },
  shotgun: { color: "#ffa45c", size: 1, stretch: 1.7, hot: false, shape: "facet" },
  rifle: { color: "#fff6d2", size: 0.9, stretch: 4.5, hot: true, shape: "needle" },
  launcher: {
    color: "#ff8a5a",
    size: 1.6,
    stretch: 1.25,
    hot: true,
    shape: "shell",
    spin: true,
  },
  seeker: { color: "#c48bff", size: 1.15, stretch: 2.6, hot: true, shape: "comet" },
};
const FALLBACK_LOOK = LOOKS.gun;
/** Rounds are drawn on the same delayed clock as the rest of the scene: truth
 *  arrives 20 Hz apart and the frame loop renders 100 ms in the past. Flying a
 *  round at wall clock instead puts it ahead of the truth it is about to be
 *  corrected to, and that rubber-band is what reads as judder. */
const PELLET_LAG = 0.1;
/** Ceiling on the acceleration a round is drawn with. Gravity (≈9.8), a launcher
 *  arc and a seeker's bend all sit far under it; a reconciliation spike divided
 *  by a frame interval shoots way past it, and that is what made a round appear
 *  to fly back where it came from. */
const ACCEL_CAP = 60;
/** All authored nose-first along +Z, which is what `lookAt` points at the sky. */
function makePelletGeos(): Record<Look["shape"], THREE.BufferGeometry> {
  return {
    // The starter pistol's round: the old speck, still a ball.
    slug: new THREE.SphereGeometry(0.09, 8, 6),
    // A sub-machine gun spits short darts, quick and thin.
    dart: new THREE.CylinderGeometry(0.035, 0.022, 0.17, 6).rotateX(
      -Math.PI / 2,
    ),
    // A fan of shot: faceted lumps, the kind that scatter on impact.
    facet: new THREE.IcosahedronGeometry(0.1, 0),
    // A rifle round is a needle — long before any stretch touches it.
    needle: new THREE.ConeGeometry(0.032, 0.3, 5).rotateX(-Math.PI / 2),
    // The boom tube launches a fat shell with a flat nose.
    shell: new THREE.CylinderGeometry(0.085, 0.11, 0.26, 8).rotateX(Math.PI / 2),
    // A seeker round trails a tail: cone apex behind, head in front.
    comet: new THREE.ConeGeometry(0.11, 0.4, 7).rotateX(Math.PI / 2),
  };
}
type Avatar = {
  root: THREE.Group;
  mixer: THREE.AnimationMixer;
  actions: Map<string, THREE.AnimationAction>;
  current: string;
  label: HTMLDivElement;
  /** The palette index this avatar was tinted with (for live skin swaps). */
  color: number;
  /** The hat currently worn, if any. Clones share the proto's geometry. */
  hatGroup?: THREE.Group | null;
  /** The GLB's hat socket, parented to the head bone so hats ride head tilt. */
  socket?: THREE.Object3D | null;
  /** The emote being performed, or null. `start` is a performance.now() ms. */
  emote?: { id: string; start: number } | null;
  /** The player this avatar renders (cosmetic lookup key). */
  id: number;
  nameEl?: HTMLElement;
  hp?: HTMLElement;
  out?: HTMLElement;
  pool?: HTMLElement;
  king?: HTMLElement;
  driven: Driven[];
  armL?: Driven;
  armR?: Driven;
  head?: Driven;
  jaw?: Driven;
  loudness: number;
  speaking: boolean;
  mouth: number;
  /** Scene time of the last punch, so the arm can swing it out. -1 = never. */
  punch: number;
  /** The raised-shield bubble, hidden until `block` says it is up. */
  shield?: THREE.Mesh;
};
type PreviewPerformer = {
  avatar: Avatar;
  home: THREE.Vector3;
  phase: number;
};
/** A bone the runtime aims by hand, plus the pose the mixer last gave it. */
type Driven = { bone: THREE.Object3D; posed: THREE.Quaternion };
/**
 * The lobby camera orbits this point. OVERVIEW is the resting framing the landing page was
 * composed around; the drift, the visitor's drag and the arrival flight all ride on top of it.
 */
const FOCUS = new THREE.Vector3(0, 0.5, 0);
const OVERVIEW = { yaw: 0.632, pitch: 0.46, dist: 26 };
/** How far a visitor may swing the camera before it stops giving. */
const SWING = { yaw: 0.62, pitch: [0.28, 0.82], dist: [16, 40] };
const ARRIVAL = 2.4;
const MOUTH_OPEN = 0.5;
const HEAD_TILT = 0.55;
const HOLD_LIFT = -1.1;
const THIRD_PERSON_DISTANCE = 4.2;
const THIRD_PERSON_PADDING = 0.18;
const HINGE_AXIS = new THREE.Vector3(1, 0, 0);
/**
 * The void the arena floats in, drawn as an equirectangular dome: a gradient, a
 * lit horizon with a glow at one bearing, drifting cloud banks and sparse stars.
 * The match palette is deliberately deep — a pellet against the old pale sky was
 * nearly invisible, and against this it is the brightest thing on screen.
 */
const SKY = {
  lobby: { high: "#2a3740", band: "#4e5e66", low: "#1b2227", glow: "#7f968c", stars: 90, seed: 7 },
  game: { high: "#070c12", band: "#16232c", low: "#060a0e", glow: "#1e4438", stars: 240, seed: 23 },
};
/** Fog takes each dome's horizon tone so distant geometry melts into it, not into a flat wash. */
const LOBBY_SKY = new THREE.Color("#3b4a52");
const GAME_SKY = new THREE.Color("#131f27");
/** One sky as a canvas: 1024×512 equirectangular, v=0.5 being the horizon. */
function skyTexture(s: (typeof SKY)["lobby"]) {
  const canvas = document.createElement("canvas");
  canvas.width = 1024;
  canvas.height = 512;
  const c = canvas.getContext("2d")!;
  const gradient = c.createLinearGradient(0, 0, 0, 512);
  gradient.addColorStop(0, s.high);
  gradient.addColorStop(0.47, s.band);
  gradient.addColorStop(0.53, s.band);
  gradient.addColorStop(1, s.low);
  c.fillStyle = gradient;
  c.fillRect(0, 0, 1024, 512);
  // The glow: brightest at one bearing, so the arena has a side it faces.
  const halo = c.createRadialGradient(300, 256, 0, 300, 256, 430);
  halo.addColorStop(0, s.glow);
  halo.addColorStop(1, "rgba(0,0,0,0)");
  c.globalAlpha = 0.34;
  c.fillStyle = halo;
  c.fillRect(0, 0, 1024, 512);
  let seed = s.seed;
  const rand = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
  // Cloud banks: thin, low-contrast bands, kept narrow so they read as weather
  // rather than as blobs smeared across the sky.
  for (let i = 0; i < 12; i++) {
    c.globalAlpha = 0.04 + rand() * 0.06;
    c.fillStyle = rand() > 0.5 ? "#e8eef2" : "#0d1319";
    c.beginPath();
    c.ellipse(
      rand() * 1024,
      256 + (rand() - 0.5) * 210,
      70 + rand() * 130,
      5 + rand() * 9,
      0,
      0,
      Math.PI * 2,
    );
    c.fill();
  }
  // Stars above the band only.
  for (let i = 0; i < s.stars; i++) {
    c.globalAlpha = 0.3 + rand() * 0.65;
    c.fillStyle = "#dfe9f2";
    const size = 0.7 + rand() * 1.6;
    c.fillRect(rand() * 1024, rand() * 232, size, size);
  }
  c.globalAlpha = 1;
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.mapping = THREE.EquirectangularReflectionMapping;
  return texture;
}
const spin = new THREE.Quaternion();
function driven(character: THREE.Object3D, name: string): Driven | undefined {
  const bone = character.getObjectByName(name);
  return bone && { bone, posed: bone.quaternion.clone() };
}
/**
 * Hand off to the mixer and take the result back. The mixer skips writing a track whose
 * value has not changed since the last frame, so a bone we aimed ourselves would come back
 * still carrying our offset; putting its last mixer pose back first keeps offsets from
 * compounding into an endless spin.
 */
function repose(a: Avatar, dt: number) {
  for (const d of a.driven) d.bone.quaternion.copy(d.posed);
  a.mixer.update(dt);
  for (const d of a.driven) d.posed.copy(d.bone.quaternion);
}
/**
 * Turn a bone about its own X axis, on top of the pose the mixer gave it. These bones have
 * non-identity rest rotations, so assigning `rotation.x` would compose the offset against a
 * stale Euler decomposition and swing the limb the wrong way.
 */
function hinge(d: Driven | undefined, angle: number) {
  d?.bone.quaternion
    .copy(d.posed)
    .multiply(spin.setFromAxisAngle(HINGE_AXIS, angle));
}
/** Jittery 0..1 babble, used when a speaker's level cannot be metered locally. */
function chatter(t: number, seed: number) {
  return Math.min(
    1,
    Math.abs(
      Math.sin(t * 13.1 + seed) *
        Math.sin(t * 7.7 + seed * 1.7) *
        Math.sin(t * 3.3 + seed * 0.4),
    ) * 1.9,
  );
}
export class GameScene {
  renderer = new THREE.WebGLRenderer({
    antialias: true,
    powerPreference: "high-performance",
  });
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(68, 1, 0.04, 100);
  props = new Map<number, THREE.Group>();
  /** Kinds of the guns that fell out of the sky: their ids are above the
   *  arena's own props, so only the authority's announcement knows them. */
  dropKinds = new Map<number, PropKind>();
  /** A floating name over each gun that fell from the sky, so a player can
   *  tell what is coming down before it lands. Hidden once it is carried. */
  supplyLabels = new Map<number, HTMLDivElement>();
  doors = new Map<number, THREE.Group>();
  windows = new Map<number, { glass: THREE.Mesh; root: THREE.Group }>();
  /** Shards from shattered panes; they spray out and delete themselves. */
  private shards: { mesh: THREE.Mesh; vel: THREE.Vector3; spin: THREE.Vector3; life: number; ttl: number }[] = [];
  /** Muzzle flashes, tracers and impact sparks; they fade out and delete themselves. */
  effects: { mesh: THREE.Mesh; life: number; ttl: number; shrink: boolean; grow?: number }[] = [];
  private propBases = new Map<number, { position: THREE.Vector3; rotation: THREE.Quaternion }>();
  private propUses = new Map<number, { kind: "swing" | "horn"; started: number }>();
  avatars = new Map<number, Avatar>();
  /** Last cosmetics seen per player; applied when the avatar (re)appears. */
  private cosmeticCache = new Map<number, Cosmetics>();
  /** Built-once hat groups that every wearer's clone shares geometry with. */
  private hatProtos: Map<string, THREE.Group> | null = null;
  /** Active chaos env modifier ("none" off) — giant heads scale the head. */
  env = "none";
  /** King of the Yard: the id wearing the crown, 0 for none. */
  kingId = 0;
  /** Live pellet meshes (ids ≥ PELLET_ID_BASE); they share one geometry and material. */
  pellets = new Map<number, THREE.Mesh>();
  /** Which gun threw each live round, keyed by the ids in its shot message. */
  private pelletLooks = new Map<number, GunKind>();
  /** Dead-reckoned flight: snapshots arrive at 20 Hz and the frame loop does
   *  not, so each round is rebased on a snapshot and flown between them. */
  private pelletFlight = new Map<
    number,
    {
      x: number;
      y: number;
      z: number;
      vx: number;
      vy: number;
      vz: number;
      ax: number;
      ay: number;
      az: number;
      /** ms timestamp of the authoritative position above. */
      at: number;
      /** The authoritative position this record was last rebased on. A frame
       *  that hands us the same coordinates is interpolation, not news: flying
       *  the round is what fills the gap between those two truths. */
      px: number;
      py: number;
      pz: number;
      /** Painted on the trigger press; the authority has not confirmed it yet. */
      armed: boolean;
      /** The gap between a trigger-press ghost and the authority's first say so,
       *  captured at `ot` and eased away over ~80 ms. This is what keeps a shot
       *  from popping half a metre forward when the next snapshot lands. */
      ox: number;
      oy: number;
      oz: number;
      ot: number;
      /** big-ball scale, and the gun's own look. */
      size: number;
      look: Look;
    }
  >();
  private pelletGeos = makePelletGeos();
  private lookMats = new Map<string, THREE.MeshBasicMaterial>();
  asset?: GLTF;
  playing = false;
  /** The two domes: a dusk sky behind the lobby, a deep one behind the match. */
  private lobbySky = skyTexture(SKY.lobby);
  private gameSky = skyTexture(SKY.game);
  front: THREE.Object3D[] = [];
  highlight = 0;
  /** The layout currently rendered; the join flow swaps in the room's arena. */
  arena = DEFAULT_ARENA;
  /** Every arena mesh hangs off this group so `renderArena` can replace it whole. */
  private arenaGroup: THREE.Group | null = null;
  labels: HTMLDivElement;
  clock = 0;
  loaded: Promise<void>;
  preview: THREE.Group[] = [];
  private previewCast: PreviewPerformer[] = [];
  /** True while a visitor is dragging the lobby camera; suspends the pointer parallax. */
  private dragging = false;
  /** Visitor-owned offsets from OVERVIEW, the spin left over from a release, and the drift. */
  private swung = { yaw: 0, pitch: 0, dist: 0 };
  private coasting = { yaw: 0, pitch: 0 };
  private parallax = { x: 0, y: 0, wantX: 0, wantY: 0 };
  private drift = 0;
  private arrival = 0;
  private calm = matchMedia("(prefers-reduced-motion: reduce)").matches;
  private cameraRay = new THREE.Ray();
  private cameraBox = new THREE.Box3();
  private cameraHit = new THREE.Vector3();
  private cameraSize = new THREE.Vector3();
  private cameraFocus = new THREE.Vector3();
  private cameraBoom = new THREE.Vector3();
  constructor(container: HTMLElement) {
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.scene.background = this.lobbySky;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.2;
    container.append(this.renderer.domElement);
    this.labels = document.createElement("div");
    this.labels.className = "world-labels";
    container.append(this.labels);
    this.scene.fog = new THREE.Fog(LOBBY_SKY, 35, 90);
    // The dome lights the arena cool and the deck bounces almost nothing back;
    // the sun stays the key, so shadows read against a dark sky.
    this.scene.add(new THREE.HemisphereLight("#cfd9e2", "#2b3436", 1.35));
    const sun = new THREE.DirectionalLight("#fff1c8", 3.2);
    sun.position.set(-3, 19, -13);
    sun.target.position.set(6, 0, -8);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    // Every platform on the stage sits under one shadow camera.
    sun.shadow.camera.left = -32;
    sun.shadow.camera.right = 32;
    sun.shadow.camera.top = 32;
    sun.shadow.camera.bottom = -32;
    sun.shadow.normalBias = 0.03;
    this.scene.add(sun, sun.target);
    // A cool rim from the glow bearing: a silhouette must never merge into the dome.
    const rim = new THREE.DirectionalLight("#7fb6a6", 0.7);
    rim.position.set(9, 7, 15);
    this.scene.add(rim);
    this.renderArena();
    this.loaded = new GLTFLoader()
      .loadAsync(new URL("models/yellow_visor_mascot.glb", document.baseURI).href)
      .then((asset) => {
        this.asset = asset;
        const cast = [
          { p: [-2, 0, -1], color: 2, phase: 2.75 },
          { p: [0, 0, -2.5], color: 1, phase: 4.85 },
          { p: [2, 0, -1], color: 3, phase: 0.65 },
        ] as const;
        for (const [i, performer] of cast.entries()) {
          const a = this.avatar(60000 + i, "", performer.color);
          const home = new THREE.Vector3(...performer.p);
          a.root.position.copy(home);
          a.label.style.display = "none";
          this.preview.push(a.root);
          this.previewCast.push({ avatar: a, home, phase: performer.phase });
        }
        this.animatePreview(0);
      });
    addEventListener("resize", () => this.resize());
    this.resize();
    this.overview(0);
  }
  /**
   * (Re)build the whole arena as geometry. The constructor renders the default
   * Stage for the lobby; the join flow calls this again with the room's
   * generated layout (src/shared/arena.ts), which physics was built from.
   */
  renderArena(arena: ArenaLayout = this.arena) {
    this.arena = arena;
    if (this.arenaGroup) {
      this.scene.remove(this.arenaGroup);
      this.arenaGroup.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (mesh.geometry) mesh.geometry.dispose();
        if (mesh.material) (mesh.material as THREE.Material).dispose();
      });
    }
    this.props.clear();
    this.dropKinds.clear();
    for (const el of this.supplyLabels.values()) el.remove();
    this.supplyLabels.clear();
    this.doors.clear();
    this.windows.clear();
    this.front.length = 0;
    const group = this.arenaGroup = new THREE.Group();
    this.scene.add(group);
    for (const b of arena.level) {
      // Pad mats are replaced by the full spring render below, which sits
      // over the same trigger. Cover walls stay plain boxes; every other
      // slab gets the platform treatment.
      if (b.kind === "pad") continue;
      const node = b.kind === "wall" ? this.box(b.p, b.s, b.color) : this.platform(b);
      if (b.hide) this.front.push(node);
    }
    // Every bounce pad renders as a full spring: a rubber base sunk flush
    // into the deck, brass coils, a launch plate and a chevron aimed down
    // the launch vector. Pads are triggers, so none of this collides.
    for (const pad of arena.pads) {
      const y = pad.y ?? 0;
      const rubber = new THREE.MeshStandardMaterial({ color: "#43403a", roughness: 0.9 });
      const brass = new THREE.MeshStandardMaterial({ color: "#a89443", roughness: 0.35, metalness: 0.6 });
      const spring = new THREE.Group();
      const base = new THREE.Mesh(
        new THREE.CylinderGeometry(pad.r + 0.04, pad.r + 0.09, 0.07, 24),
        rubber,
      );
      base.position.set(pad.x, y - 0.025, pad.z);
      base.receiveShadow = true;
      spring.add(base);
      for (const cy of [0.08, 0.17] as const) {
        const coil = new THREE.Mesh(
          new THREE.TorusGeometry(pad.r * 0.76, 0.05, 10, 28),
          brass,
        );
        coil.rotation.x = Math.PI / 2;
        coil.position.set(pad.x, y + cy, pad.z);
        coil.castShadow = true;
        spring.add(coil);
      }
      const plate = new THREE.Mesh(
        new THREE.CylinderGeometry(pad.r * 0.72, pad.r * 0.66, 0.06, 28),
        new THREE.MeshStandardMaterial({ color: "#d3c170", roughness: 0.55 }),
      );
      plate.position.set(pad.x, y + 0.245, pad.z);
      plate.castShadow = true;
      spring.add(plate);
      const speed = Math.hypot(pad.vx, pad.vz);
      if (speed > 0.01) {
        const chevron = new THREE.Group();
        chevron.position.set(
          pad.x + (pad.vx / speed) * pad.r * 0.45,
          y + 0.28,
          pad.z + (pad.vz / speed) * pad.r * 0.45,
        );
        chevron.rotation.y = Math.atan2(pad.vx, pad.vz);
        for (const s of [-1, 1] as const) {
          const wing = new THREE.Mesh(
            new THREE.BoxGeometry(0.3, 0.018, 0.05),
            new THREE.MeshStandardMaterial({ color: "#241f1a", roughness: 0.7 }),
          );
          wing.rotation.y = s * 0.85;
          wing.position.set(s * 0.09, 0, 0.05);
          chevron.add(wing);
        }
        spring.add(chevron);
      }
      group.add(spring);
    }
    arena.props.forEach((prop, i) => {
      const root = this.makeProp(i);
      root.position.set(...prop.p);
      this.props.set(i + 1, root);
      group.add(root);
    });
    for (const def of arena.doors) {
      const leaf = new THREE.Group();
      const panel = new THREE.Mesh(
        new THREE.BoxGeometry(...def.s),
        new THREE.MeshStandardMaterial({ color: def.color, roughness: 0.7 }),
      );
      panel.castShadow = true;
      panel.receiveShadow = true;
      leaf.add(panel);
      // A handle on the long face, so a shut leaf reads as something to open.
      const across = def.s[0] > def.s[2];
      const handle = new THREE.Mesh(
        new THREE.BoxGeometry(
          across ? 0.09 : def.s[0] + 0.06,
          0.5,
          across ? def.s[2] + 0.06 : 0.09,
        ),
        new THREE.MeshStandardMaterial({
          color: "#2f3a34",
          roughness: 0.4,
          metalness: 0.5,
        }),
      );
      handle.position.set(
        across ? (def.slide[0] > 0 ? -def.s[0] / 2 + 0.22 : def.s[0] / 2 - 0.22) : 0,
        0,
        across ? 0 : def.slide[2] > 0 ? -def.s[2] / 2 + 0.22 : def.s[2] / 2 - 0.22,
      );
      leaf.add(handle);
      leaf.position.set(...def.p);
      this.doors.set(def.id, leaf);
      group.add(leaf);
    }
    for (const def of arena.windows) {
      const root = new THREE.Group();
      root.position.set(...def.p);
      // The thin axis is z on north/south walls, x elsewhere. Build the frame
      // with its depth along local z and rotate for x-thin openings.
      const thinZ = def.s[2] < def.s[0];
      const fw = thinZ ? def.s[0] : def.s[2],
        fh = def.s[1],
        fd = (thinZ ? def.s[2] : def.s[0]) + 0.03, // proud of the wall face: no z-fighting
        t = 0.14;
      if (!thinZ) root.rotation.y = Math.PI / 2;
      const glass = new THREE.Mesh(
        new THREE.BoxGeometry(fw, fh, 0.06),
        new THREE.MeshStandardMaterial({
          color: "#bfe3e8",
          roughness: 0.1,
          metalness: 0.05,
          transparent: true,
          opacity: 0.35,
        }),
      );
      root.add(glass);
      const frameMat = new THREE.MeshStandardMaterial({ color: def.color, roughness: 0.7 });
      for (const [px, py, sx, sy] of [
        [0, fh / 2 + t / 2, fw + 2 * t, t],
        [0, -fh / 2 - t / 2, fw + 2 * t, t],
        [-(fw / 2 + t / 2), 0, t, fh],
        [fw / 2 + t / 2, 0, t, fh],
      ] as const) {
        const bar = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, fd), frameMat);
        bar.position.set(px, py, 0);
        bar.castShadow = true;
        root.add(bar);
      }
      this.windows.set(def.id, { glass, root });
      group.add(root);
    }
  }
  box(p: number[], s: number[], color: string) {
    const m = new THREE.Mesh(
      new THREE.BoxGeometry(...(s as [number, number, number])),
      new THREE.MeshStandardMaterial({ color, roughness: 0.85 }),
    );
    m.position.set(...(p as [number, number, number]));
    m.castShadow = true;
    m.receiveShadow = true;
    (this.arenaGroup ?? this.scene).add(m);
    return m;
  }
  /**
   * The platform treatment: an inset deck slab under steel edge trim with
   * corner posts, a lit safety strip inside the rim, plank seams across the
   * deck and a support column braced under the lip. Pure presentation — the
   * LEVEL box behind it stays the exact collider.
   */
  platform(b: Box) {
    const [px, py, pz] = b.p,
      [sx, sy, sz] = b.s;
    const top = py + sy / 2;
    const g = new THREE.Group();
    const deck = new THREE.Mesh(
      new THREE.BoxGeometry(sx - 0.12, sy - 0.02, sz - 0.12),
      new THREE.MeshStandardMaterial({ color: b.color, roughness: 0.85 }),
    );
    deck.position.set(px, py, pz);
    deck.castShadow = true;
    deck.receiveShadow = true;
    g.add(deck);
    const steel = new THREE.MeshStandardMaterial({ color: "#5b656f", roughness: 0.5, metalness: 0.35 });
    const glow = b.kind === "stage" ? "#a5c666" : b.kind === "perch" ? "#b18ad3" : "#e6cf95";
    const strip = new THREE.MeshStandardMaterial({ color: glow, emissive: glow, emissiveIntensity: 1.2, roughness: 0.6 });
    for (const s of [-1, 1] as const) {
      const railX = new THREE.Mesh(new THREE.BoxGeometry(sx, 0.12, 0.135), steel);
      railX.position.set(px, top - 0.05, pz + s * (sz / 2 - 0.068));
      railX.castShadow = true;
      g.add(railX);
      const railZ = new THREE.Mesh(new THREE.BoxGeometry(0.135, 0.12, sz), steel);
      railZ.position.set(px + s * (sx / 2 - 0.068), top - 0.05, pz);
      railZ.castShadow = true;
      g.add(railZ);
      const lineX = new THREE.Mesh(new THREE.BoxGeometry(sx - 0.24, 0.02, 0.045), strip);
      lineX.position.set(px, top + 0.005, pz + s * (sz / 2 - 0.15));
      g.add(lineX);
      const lineZ = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.02, sz - 0.24), strip);
      lineZ.position.set(px + s * (sx / 2 - 0.15), top + 0.005, pz);
      g.add(lineZ);
    }
    for (const [ax, az] of [[1, 1], [1, -1], [-1, 1], [-1, -1]] as const) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.11, sy + 0.1, 0.11), steel);
      post.position.set(px + ax * (sx / 2 - 0.055), py + 0.05, pz + az * (sz / 2 - 0.055));
      post.castShadow = true;
      g.add(post);
    }
    const seamMat = new THREE.MeshStandardMaterial({ color: "#20262c", roughness: 0.7 });
    const seamsX = Math.floor((sx - 0.6) / 2.4);
    for (let i = 1; i <= seamsX; i++) {
      const seam = new THREE.Mesh(new THREE.BoxGeometry(0.014, 0.012, sz - 0.32), seamMat);
      seam.position.set(px + (i - (seamsX + 1) / 2) * (sx / (seamsX + 1)), top + 0.004, pz);
      g.add(seam);
    }
    const seamsZ = Math.floor((sz - 0.6) / 2.4);
    for (let i = 1; i <= seamsZ; i++) {
      const seam = new THREE.Mesh(new THREE.BoxGeometry(sx - 0.32, 0.012, 0.014), seamMat);
      seam.position.set(px, top + 0.004, pz + (i - (seamsZ + 1) / 2) * (sz / (seamsZ + 1)));
      g.add(seam);
    }
    const column = new THREE.Mesh(
      new THREE.BoxGeometry(Math.max(0.4, sx * 0.26), 1.15, Math.max(0.4, sz * 0.26)),
      steel,
    );
    column.position.set(px, py - sy / 2 - 0.55, pz);
    column.castShadow = true;
    g.add(column);
    for (const [wx, wz] of [[sx * 0.6, 0.11], [0.11, sz * 0.6]] as const) {
      const brace = new THREE.Mesh(new THREE.BoxGeometry(wx, 0.11, wz), steel);
      brace.position.set(px, py - sy / 2 - 0.11, pz);
      brace.castShadow = true;
      g.add(brace);
    }
    (this.arenaGroup ?? this.scene).add(g);
    return g;
  }
  /** A practical fixture's warm pool of light. Kept shadowless to stay cheap on 8-player GPUs. */
  roomLight(p: [number, number, number], intensity: number, distance: number) {
    const light = new THREE.PointLight("#ffe4ad", intensity, distance, 2);
    light.position.set(...p);
    this.scene.add(light);
    return light;
  }
  sign(
    text: string,
    p: number[],
    w: number,
    h: number,
    ink: string,
    bg: string,
    rotation = 0,
  ) {
    const canvas = document.createElement("canvas");
    canvas.width = 1024;
    canvas.height = 512;
    const c = canvas.getContext("2d")!;
    c.fillStyle = bg;
    c.fillRect(0, 0, 1024, 512);
    c.fillStyle = ink;
    c.textAlign = "center";
    c.textBaseline = "middle";
    c.font = "600 64px monospace";
    const lines = text.split("\n");
    lines.forEach((line, i) =>
      c.fillText(line, 512, 256 + (i - (lines.length - 1) / 2) * 95, 970),
    );
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    const mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(w, h),
      new THREE.MeshStandardMaterial({ map: tex, roughness: 1 }),
    );
    mesh.position.set(...(p as [number, number, number]));
    mesh.rotation.y = rotation;
    this.scene.add(mesh);
  }
  plant(x: number, z: number) {
    const pot = new THREE.Mesh(
      new THREE.CylinderGeometry(0.38, 0.27, 0.6, 10),
      new THREE.MeshStandardMaterial({ color: "#b97554" }),
    );
    pot.position.set(x, 0.3, z);
    pot.castShadow = true;
    this.scene.add(pot);
    for (let i = 0; i < 7; i++) {
      const leaf = new THREE.Mesh(
        new THREE.IcosahedronGeometry(0.5, 0),
        new THREE.MeshStandardMaterial({
          color: i % 2 ? "#647b49" : "#7a9158",
        }),
      );
      leaf.scale.set(0.5, 1.3, 0.55);
      leaf.position.set(
        x + Math.sin(i * 2.4) * 0.25,
        0.8 + (i % 3) * 0.24,
        z + Math.cos(i * 2.4) * 0.25,
      );
      leaf.rotation.z = Math.sin(i) * 0.5;
      leaf.castShadow = true;
      this.scene.add(leaf);
    }
  }
  /** A throwable prop's visual mesh. Children[0] is always the tintable body: `setHighlight` writes its emissive. */
  makeProp(i: number) {
    return this.propMesh(this.arena.props[i].kind, i);
  }
  /** A prop mesh for any kind. `tint` seeds the palette: the prop's index for
   *  arena props, the prop's id for a gun that fell out of the sky. */
  propMesh(kind: PropKind, seed: number) {
    const root = new THREE.Group();
    if (isGun(kind)) {
      // Modelled pointing down -z, which is where its holder is looking. The
      // receiver is children[0] — the body `setHighlight` tints — and every gun
      // has its own silhouette, so you can read what someone is carrying from
      // across the room. The tip lands at GUNS[kind].muzzleZ, the point the
      // physics fires from and the client draws a tracer from.
      const metal = (color: string, metalness = 0.5, roughness = 0.4) =>
          new THREE.MeshStandardMaterial({ color, roughness, metalness }),
        dark = metal("#2b3238", 0.6, 0.35),
        frame = metal("#414b54", 0.45, 0.45),
        wood = metal("#6b5137", 0.05, 0.8),
        leather = metal("#3b2b22", 0.05, 0.8),
        tint = metal(PALETTE[seed % 8], 0.1, 0.6);
      const brick = (
        w: number,
        h: number,
        d: number,
        mat: THREE.Material,
        x: number,
        y: number,
        z: number,
        tilt = 0,
      ) => {
        const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
        mesh.position.set(x, y, z);
        mesh.rotation.x = tilt;
        mesh.castShadow = true;
        root.add(mesh);
        return mesh;
      };
      const tube = (
        r1: number,
        r2: number,
        len: number,
        mat: THREE.Material,
        x: number,
        y: number,
        z: number,
      ) => {
        const mesh = new THREE.Mesh(new THREE.CylinderGeometry(r1, r2, len, 12), mat);
        mesh.rotation.x = Math.PI / 2;
        mesh.position.set(x, y, z);
        mesh.castShadow = true;
        root.add(mesh);
        return mesh;
      };
      switch (kind) {
        case "gun": {
          brick(0.11, 0.16, 0.56, frame, 0, 0, 0);
          tube(0.045, 0.05, 0.42, dark, 0, 0.02, -0.42);
          brick(0.1, 0.28, 0.13, wood, 0, -0.2, 0.14, -0.22);
          brick(0.05, 0.05, 0.2, tint, 0, 0.11, -0.02);
          tube(0.055, 0.055, 0.06, dark, 0, 0.02, -0.62);
          brick(0.09, 0.05, 0.18, wood, 0, -0.09, -0.3);
          brick(0.07, 0.12, 0.09, leather, 0, -0.16, 0);
          brick(0.055, 0.035, 0.03, tint, 0, 0.11, 0.24);
          break;
        }
        case "smg": {
          brick(0.1, 0.19, 0.5, frame, 0, 0, -0.06);
          tube(0.038, 0.042, 0.26, dark, 0, 0.02, -0.47);
          brick(0.05, 0.045, 0.2, tint, 0, 0.12, -0.14);
          brick(0.09, 0.25, 0.12, wood, 0, -0.19, 0.14, -0.16);
          brick(0.07, 0.24, 0.1, leather, 0, -0.2, -0.08);
          brick(0.06, 0.06, 0.14, dark, 0, -0.04, 0.28);
          break;
        }
        case "shotgun": {
          brick(0.12, 0.18, 0.5, frame, 0, 0, -0.02);
          tube(0.055, 0.06, 0.5, dark, 0, 0.045, -0.47);
          tube(0.05, 0.05, 0.46, dark, 0, -0.045, -0.45);
          tube(0.066, 0.066, 0.05, tint, 0, 0, -0.7);
          brick(0.09, 0.07, 0.2, wood, 0, -0.1, -0.32);
          brick(0.1, 0.26, 0.13, wood, 0, -0.19, 0.16, -0.2);
          brick(0.11, 0.16, 0.32, wood, 0, -0.03, 0.34);
          break;
        }
        case "rifle": {
          brick(0.09, 0.15, 0.72, frame, 0, 0, -0.18);
          tube(0.032, 0.036, 0.44, dark, 0, 0.02, -0.7);
          tube(0.05, 0.05, 0.28, dark, 0, 0.13, -0.02);
          brick(0.07, 0.05, 0.13, tint, 0, 0.13, 0.14);
          brick(0.08, 0.24, 0.11, leather, 0, -0.19, 0.04, -0.1);
          brick(0.1, 0.24, 0.34, wood, 0, -0.1, 0.4, -0.1);
          brick(0.06, 0.14, 0.14, dark, 0, -0.1, -0.5);
          break;
        }
        case "launcher": {
          brick(0.14, 0.2, 0.36, frame, 0, 0, 0.14);
          tube(0.11, 0.13, 0.64, dark, 0, 0.02, -0.34);
          tube(0.14, 0.12, 0.07, tint, 0, 0.02, -0.7);
          brick(0.11, 0.26, 0.13, wood, 0, -0.2, 0.18, -0.2);
          brick(0.1, 0.15, 0.22, dark, 0.11, -0.04, 0.06);
          tube(0.045, 0.045, 0.18, tint, 0.18, -0.04, 0.06);
          break;
        }
        case "seeker": {
          brick(0.12, 0.18, 0.42, frame, 0, 0, 0.04);
          for (const x of [-0.07, 0, 0.07]) {
            tube(0.036, 0.04, 0.36, dark, x, 0.03, -0.36);
            const eye = new THREE.Mesh(
              new THREE.SphereGeometry(0.045, 12, 10),
              new THREE.MeshStandardMaterial({
                color: PALETTE[seed % 8],
                roughness: 0.4,
                emissive: new THREE.Color(PALETTE[seed % 8]),
                emissiveIntensity: 0.6,
              }),
            );
            eye.position.set(x, 0.03, -0.58);
            root.add(eye);
          }
          brick(0.1, 0.26, 0.12, wood, 0, -0.19, 0.18, -0.2);
          brick(0.07, 0.16, 0.09, leather, 0, -0.16, -0.04);
          break;
        }
      }
      return root;
    }
    if (kind === "horn") {
      // A toy brass squeeze horn. In the held pose -z points away from the
      // player, so the wide bell opens along -z and the bulb sits at the rear.
      const bell = new THREE.Mesh(
        new THREE.CylinderGeometry(0.2, 0.065, 0.5, 18, 1, true),
        new THREE.MeshStandardMaterial({
          color: "#d8a928",
          roughness: 0.3,
          metalness: 0.65,
          side: THREE.DoubleSide,
        }),
      );
      bell.rotation.x = -Math.PI / 2;
      bell.position.z = 0;
      bell.castShadow = true;
      root.add(bell);
      const bulb = new THREE.Mesh(
        new THREE.SphereGeometry(0.15, 16, 12),
        new THREE.MeshStandardMaterial({ color: "#d84b43", roughness: 0.85 }),
      );
      bulb.scale.z = 1.25;
      bulb.position.z = 0.38;
      root.add(bulb);
      const brass = new THREE.MeshStandardMaterial({ color: "#d8a928", roughness: 0.3, metalness: 0.65 });
      const mouth = new THREE.Mesh(new THREE.TorusGeometry(0.202, 0.012, 8, 24), brass);
      mouth.rotation.x = Math.PI / 2;
      mouth.position.z = -0.25;
      root.add(mouth);
      const piece = new THREE.Mesh(
        new THREE.CylinderGeometry(0.05, 0.05, 0.06, 12),
        brass,
      );
      piece.rotation.x = Math.PI / 2;
      piece.position.z = 0.585;
      root.add(piece);
      return root;
    }
    if (kind === "chair") {
      const tint = new THREE.MeshStandardMaterial({ color: PALETTE[seed % 8], roughness: 0.8 });
      const wood = new THREE.MeshStandardMaterial({ color: "#6c5c46", roughness: 0.8 });
      // The collider is a 0.28 x 0.45 x 0.28 cuboid centred on the root, so at
      // rest the body spans -0.45..+0.45: floor to the top of the backrest.
      const seat = new THREE.Mesh(new THREE.BoxGeometry(0.56, 0.1, 0.5), tint);
      seat.position.y = -0.05;
      seat.castShadow = true;
      seat.receiveShadow = true;
      root.add(seat);
      for (const [ry, rh] of [[0.15, 0.06], [0.32, 0.06]] as const) {
        const slat = new THREE.Mesh(new THREE.BoxGeometry(0.5, rh, 0.05), wood);
        slat.position.set(0, ry, -0.19);
        slat.castShadow = true;
        root.add(slat);
      }
      const rail = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.07, 0.07), tint);
      rail.position.set(0, 0.415, -0.19);
      rail.castShadow = true;
      root.add(rail);
      for (const [lx, lz] of [[-0.22, -0.18], [0.22, -0.18], [-0.22, 0.18], [0.22, 0.18]] as const) {
        const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.038, 0.35, 10), wood);
        leg.position.set(lx, -0.275, lz);
        leg.castShadow = true;
        root.add(leg);
      }
      return root;
    }
    if (kind === "table") {
      const tint = new THREE.MeshStandardMaterial({ color: PALETTE[seed % 8], roughness: 0.8 });
      const wood = new THREE.MeshStandardMaterial({ color: "#6c5c46", roughness: 0.8 });
      const top = new THREE.Mesh(new THREE.BoxGeometry(0.84, 0.08, 0.84), tint);
      top.position.y = 0.34;
      top.castShadow = true;
      top.receiveShadow = true;
      root.add(top);
      // Legs run from the collider bottom (-0.38, the floor at rest) up to the
      // top's underside (+0.30), so nothing floats in the gap.
      const inlay = new THREE.Mesh(
        new THREE.BoxGeometry(0.76, 0.02, 0.76),
        new THREE.MeshStandardMaterial({ color: "#3b2b22", roughness: 0.9 }),
      );
      inlay.position.y = 0.385;
      root.add(inlay);
      for (const [w, d, x, z] of [[0.72, 0.06, 0, 0.31], [0.72, 0.06, 0, -0.31], [0.06, 0.72, 0.31, 0], [0.06, 0.72, -0.31, 0]] as const) {
        const apron = new THREE.Mesh(new THREE.BoxGeometry(w, 0.1, d), wood);
        apron.position.set(x, 0.24, z);
        apron.castShadow = true;
        root.add(apron);
      }
      for (const [lx, lz] of [[-0.34, -0.34], [0.34, -0.34], [-0.34, 0.34], [0.34, 0.34]] as const) {
        const leg = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.68, 0.09), wood);
        leg.position.set(lx, -0.04, lz);
        leg.castShadow = true;
        root.add(leg);
      }
      return root;
    }
    if (kind === "trashcan") {
      const tint = new THREE.MeshStandardMaterial({ color: PALETTE[seed % 8], roughness: 0.55, side: THREE.DoubleSide });
      const body = new THREE.Mesh(new THREE.CylinderGeometry(0.21, 0.17, 0.5, 12, 1, true), tint);
      body.position.y = -0.05;
      body.castShadow = true;
      root.add(body);
      const steel = new THREE.MeshStandardMaterial({ color: "#8a8f96", roughness: 0.35, metalness: 0.5 });
      const rim = new THREE.Mesh(new THREE.TorusGeometry(0.208, 0.02, 10, 24), steel);
      rim.rotation.x = Math.PI / 2;
      rim.position.y = 0.19;
      root.add(rim);
      const dark = new THREE.MeshStandardMaterial({ color: "#4a4f48", roughness: 0.6 });
      for (const ry of [-0.16, 0.04] as const) {
        const rib = new THREE.Mesh(new THREE.CylinderGeometry(0.204, 0.19, 0.03, 12), dark);
        rib.position.y = ry;
        root.add(rib);
      }
      const base = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 0.03, 12), dark);
      base.position.y = -0.28;
      root.add(base);
      return root;
    }
    if (kind === "bottle") {
      const tint = new THREE.MeshStandardMaterial({ color: PALETTE[seed % 8], roughness: 0.3 });
      const body = new THREE.Mesh(new THREE.CylinderGeometry(0.085, 0.085, 0.3, 12), tint);
      body.position.y = -0.1;
      body.castShadow = true;
      root.add(body);
      const shoulder = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.085, 0.1, 12), tint);
      shoulder.position.y = 0.1;
      root.add(shoulder);
      const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.14, 12), tint);
      neck.position.y = 0.21;
      root.add(neck);
      const brass = new THREE.MeshStandardMaterial({ color: "#d8a928", roughness: 0.3, metalness: 0.65 });
      const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.048, 0.048, 0.035, 12), brass);
      cap.position.y = 0.29;
      root.add(cap);
      const label = new THREE.Mesh(
        new THREE.CylinderGeometry(0.088, 0.088, 0.1, 12),
        new THREE.MeshStandardMaterial({ color: "#ece0bc", roughness: 0.85 }),
      );
      label.position.y = -0.08;
      root.add(label);
      return root;
    }
    return root;
  }
  /** Keep the visible panes in step with what the simulation says is broken. */
  updateWindows(states: WindowState[]) {
    for (const s of states) {
      const w = this.windows.get(s.id);
      if (w) w.glass.visible = !s.broken;
    }
  }
  /** Shatter VFX: the pane vanishes and a handful of shards spray out. */
  breakWindow(id: number) {
    const w = this.windows.get(id),
      def = this.arena.windows.find((d) => d.id === id);
    if (!w || !def || !w.glass.visible) return;
    w.glass.visible = false;
    // The wall normal is the pane's thin axis: z for north/south walls, x otherwise.
    const alongZ = def.s[2] < def.s[0];
    for (let i = 0; i < 12; i++) {
      const shard = new THREE.Mesh(
        new THREE.BoxGeometry(0.08, 0.16, 0.02),
        new THREE.MeshStandardMaterial({ color: "#bfe3e8", transparent: true, opacity: 0.9 }),
      );
      shard.position.set(
        def.p[0] + (Math.random() - 0.5) * def.s[0],
        def.p[1] + (Math.random() - 0.5) * def.s[1],
        def.p[2] + (Math.random() - 0.5) * def.s[2],
      );
      const sign = Math.random() < 0.5 ? -1 : 1;
      this.shards.push({
        mesh: shard,
        vel: new THREE.Vector3(
          alongZ ? (Math.random() - 0.5) * 2 : sign * (2 + Math.random() * 3),
          (Math.random() - 0.3) * 2,
          alongZ ? sign * (2 + Math.random() * 3) : (Math.random() - 0.5) * 2,
        ),
        spin: new THREE.Vector3(
          (Math.random() - 0.5) * 14,
          (Math.random() - 0.5) * 14,
          (Math.random() - 0.5) * 14,
        ),
        life: 0,
        ttl: 0.9,
      });
      this.scene.add(shard);
    }
  }
  /** Explosions told by the authority — chaos booms, dangerous junk blasts: fireball and sparks at a point. */
  boomAt(x: number, y: number, z: number) {
    const p = new THREE.Vector3(x, y + 0.5, z);
    const ball = new THREE.Mesh(
      new THREE.IcosahedronGeometry(0.55, 1),
      new THREE.MeshBasicMaterial({
        color: "#ff9a3c",
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    );
    ball.position.copy(p);
    this.scene.add(ball);
    this.effects.push({ mesh: ball, life: 0, ttl: 0.45, shrink: false, grow: 1.6 });
    this.spark("#ffd27a", 0.35, p, 0.35);
    this.spark("#ff9a3c", 0.22, new THREE.Vector3(x + 0.4, y + 0.8, z), 0.3);
  }
  /**
   * Chaos env modifier for the visuals: giant heads scale every driven head
   * bone; "none" puts them back. Physics lives in Simulation.setEnv.
   */
  setEnv(env: string) {
    this.env = env;
    const s = env === "giant-heads" ? 2.6 : 1;
    for (const a of this.avatars.values()) if (a.head) a.head.bone.scale.setScalar(s);
  }
  /** King of the Yard: the crown follows the id the authority named. */
  setKing(id: number) {
    this.kingId = id;
  }
  /** Slide the visible leaves to match the physics doors the simulation owns. */
  updateDoors(states: DoorState[]) {
    for (const s of states) {
      const leaf = this.doors.get(s.id),
        def = this.arena.doors.find((d) => d.id === s.id);
      if (!leaf || !def) continue;
      const e = s.progress * s.progress * (3 - 2 * s.progress);
      leaf.position.set(
        def.p[0] + def.slide[0] * e,
        def.p[1] + def.slide[1] * e,
        def.p[2] + def.slide[2] * e,
      );
    }
  }
  private spark(
    color: string,
    size: number,
    position: THREE.Vector3,
    ttl: number,
  ) {
    const mesh = new THREE.Mesh(
      new THREE.IcosahedronGeometry(size, 0),
      new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    );
    mesh.position.copy(position);
    this.scene.add(mesh);
    this.effects.push({ mesh, life: 0, ttl, shrink: true });
  }
  /** Kept in the effects kit for a future laser-class weapon: muzzle flash, a
   * fading tracer, and a spark where the line landed. The shove gun draws only
   * the live pellet, so nothing calls this for plain shots. */
  tracer(shot: {
    x: number;
    y: number;
    z: number;
    dx: number;
    dy: number;
    dz: number;
    distance: number;
    hit: number;
  }, liveMuzzle?: Vec3) {
    const authorityOrigin = new THREE.Vector3(shot.x, shot.y, shot.z),
      authorityDirection = new THREE.Vector3(shot.dx, shot.dy, shot.dz).normalize(),
      end = authorityOrigin.clone().addScaledVector(authorityDirection, shot.distance),
      origin = liveMuzzle
        ? new THREE.Vector3(liveMuzzle.x, liveMuzzle.y, liveMuzzle.z)
        : authorityOrigin,
      direction = end.clone().sub(origin).normalize(),
      length = Math.max(0.5, end.distanceTo(origin));
    const geometry = new THREE.CylinderGeometry(0.013, 0.005, length, 6, 1, true);
    geometry.translate(0, -length / 2, 0);
    const beam = new THREE.Mesh(
      geometry,
      new THREE.MeshBasicMaterial({
        color: "#ffe6a6",
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    );
    beam.position.copy(origin);
    beam.quaternion.setFromUnitVectors(new THREE.Vector3(0, -1, 0), direction);
    this.scene.add(beam);
    this.effects.push({ mesh: beam, life: 0, ttl: 0.18, shrink: false });
    this.spark("#fff2c4", 0.085, origin, 0.06);
    this.spark(
      shot.hit ? "#ffc4a8" : "#e9e3cf",
      shot.hit ? 0.28 : 0.13,
      end,
      shot.hit ? 0.24 : 0.16,
    );
  }
  /** Muzzle ghost flash covering own-shot latency; the real pellet arrives via snapshots. */
  pelletGhost(muzzle: { x: number; y: number; z: number }, kind?: GunKind) {
    const look = kind ? LOOKS[kind] : FALLBACK_LOOK;
    this.spark(
      look.color,
      look.hot ? 0.18 : 0.14,
      new THREE.Vector3(muzzle.x, muzzle.y, muzzle.z),
      0.12 + look.size * 0.05,
    );
  }
  /** Impact spark where a live pellet was consumed, in that gun's colour. */
  pelletImpact(pos: { x: number; y: number; z: number }, kind?: GunKind) {
    const look = kind ? LOOKS[kind] : FALLBACK_LOOK;
    this.spark(
      look.color,
      0.12 + look.size * 0.04,
      new THREE.Vector3(pos.x, pos.y, pos.z),
      0.1,
    );
  }
  /** Authority-told collision burst; the bigger the impact, the bigger it looks (design doc §17). */
  impactAt(x: number, y: number, z: number, strength: number) {
    const p = new THREE.Vector3(x, y, z),
      s = Math.max(0, Math.min(1, strength));
    this.spark(s > 0.6 ? "#fff2c4" : "#e9e3cf", 0.06 + s * 0.22, p, 0.1 + s * 0.18);
    if (s > 0.35)
      this.spark(
        "#ffc4a8",
        0.05 + s * 0.12,
        new THREE.Vector3(x, y + 0.12, z),
        0.12 + s * 0.14,
      );
    if (s > 0.7) {
      const ring = new THREE.Mesh(
        new THREE.IcosahedronGeometry(0.5, 1),
        new THREE.MeshBasicMaterial({
          color: "#ffe6a6",
          transparent: true,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
        }),
      );
      ring.position.copy(p);
      this.scene.add(ring);
      this.effects.push({ mesh: ring, life: 0, ttl: 0.3, shrink: false, grow: 1.2 + s });
    }
  }
  /** Comedic elimination poof: a puff of soft smoke where the round ended for someone. */
  poofAt(x: number, y: number, z: number) {
    const p = new THREE.Vector3(x, Math.max(y, 0.6), z);
    for (let i = 0; i < 5; i++) {
      const puff = new THREE.Mesh(
        new THREE.IcosahedronGeometry(0.28 + Math.random() * 0.2, 1),
        new THREE.MeshBasicMaterial({
          color: "#f4ecd8",
          transparent: true,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
        }),
      );
      puff.position.copy(p).add(
        new THREE.Vector3(
          (Math.random() - 0.5) * 0.7,
          Math.random() * 0.5,
          (Math.random() - 0.5) * 0.7,
        ),
      );
      this.scene.add(puff);
      this.effects.push({ mesh: puff, life: 0, ttl: 0.55 + i * 0.06, shrink: false, grow: 1.8 });
    }
  }
  /** Kind by prop id: the arena's own props first, then guns that fell from the sky. */
  propKindOf(id: number): PropKind | undefined {
    return this.dropKinds.get(id) ?? this.arena.props[id - 1]?.kind;
  }
  /** Set a sky-dropped gun down in the world; the snapshots move it from here. */
  addProp(id: number, kind: PropKind, at: { x: number; y: number; z: number }) {
    const root = this.propMesh(kind, id);
    root.position.set(at.x, at.y, at.z);
    this.props.set(id, root);
    this.dropKinds.set(id, kind);
    (this.arenaGroup ?? this.scene).add(root);
    if (isGun(kind)) {
      const tag = document.createElement("div");
      tag.className = "supply-tag";
      tag.dataset.supply = kind;
      tag.textContent = GUNS[kind].name;
      this.labels.append(tag);
      this.supplyLabels.set(id, tag);
    }
    return root;
  }
  /** Take a sky-dropped gun back out: its mesh, its kind, nothing else. */
  removeProp(id: number) {
    const root = this.props.get(id);
    if (!root) return;
    this.props.delete(id);
    this.dropKinds.delete(id);
    this.supplyLabels.get(id)?.remove();
    this.supplyLabels.delete(id);
    root.parent?.remove(root);
  }
  /** Exact rendered barrel tip, after interpolation, for a tracer with no side gap. */
  muzzle(id: number): Vec3 | undefined {
    const gun = this.props.get(id),
      kind = this.propKindOf(id);
    if (!gun || !isGun(kind)) return;
    gun.updateMatrixWorld(true);
    const p = gun.localToWorld(new THREE.Vector3(0, 0.02, -GUNS[kind].muzzleZ));
    return { x: p.x, y: p.y, z: p.z };
  }
  /** The horn's own tell: a squeeze, not a swing. */
  useProp(id: number, kind: "horn") {
    this.propUses.set(id, { kind, started: this.clock });
  }
  /** A punch: the arm shoves forward, and any junk in the hand swings with it. */
  punch(playerId: number, held = 0) {
    const a = this.avatars.get(playerId);
    if (a) a.punch = this.clock;
    if (held) this.propUses.set(held, { kind: "swing", started: this.clock });
  }
  avatar(id: number, name: string, color = id - 1) {
    const existing = this.avatars.get(id);
    if (existing) {
      if (existing.nameEl) existing.nameEl.textContent = name;
      return existing;
    }
    const root = new THREE.Group();
    const character = this.asset ? clone(this.asset.scene) : new THREE.Group();
    character.traverse((o) => {
      if (o.name === "Belt") o.scale.set(0.82, 1, 0.82);
      if (o instanceof THREE.Mesh) {
        o.castShadow = true;
        o.receiveShadow = true;
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        const clonedMaterials = mats.map((m) => {
          const copy = m.clone() as THREE.MeshStandardMaterial;
          const baseColor = new THREE.Color(CHARACTER_PALETTE[color % 8]);
          if (m.name.startsWith("Jacket") || m.name.startsWith("Body")) {
            copy.color.copy(baseColor);
            copy.roughness = 0.55;
          } else if (m.name.startsWith("Nose")) {
            const hsl = { h: 0, s: 0, l: 0 };
            baseColor.getHSL(hsl);
            copy.color.setHSL(
              hsl.h,
              hsl.s * 0.45,
              hsl.l * 0.78,
            );
            copy.roughness = 0.5;
          } else if (m.name.startsWith("Trim")) {
            // Gear trim stays a designed charcoal across every skin: rubbery,
            // never flat black plastic.
            copy.color.set("#1d2128");
            copy.roughness = 0.55;
            copy.metalness = 0.12;
          } else if (m.name.startsWith("Buckle")) {
            // Hardware reads as polished brass so the rig picks up the sun.
            copy.color.set("#c9a227");
            copy.roughness = 0.24;
            copy.metalness = 0.85;
          } else if (m.name.startsWith("EyeWhite")) {
            copy.color.set("#fffdf4");
            copy.roughness = 0.3;
          } else if (m.name.startsWith("EyePupil")) {
            copy.color.set("#0b0d11");
            copy.roughness = 0.22;
          }
          return copy;
        });
        o.material = Array.isArray(o.material)
          ? clonedMaterials
          : clonedMaterials[0];
      }
    });
    root.add(character);
    this.scene.add(root);
    const mixer = new THREE.AnimationMixer(character),
      actions = new Map<string, THREE.AnimationAction>();
    for (const clip of this.asset?.animations ?? [])
      actions.set(clip.name.split("|").at(-1)!, mixer.clipAction(clip));
    const idle = [...actions.entries()].find(([n]) => n.includes("Idle"));
    idle?.[1].play();
    const label = document.createElement("div");
    label.className = "player-label";
    const nameEl = document.createElement("span");
    nameEl.className = "label-name";
    nameEl.textContent = name;
    const hpBar = document.createElement("div");
    hpBar.className = "hp-bar";
    const hpFill = document.createElement("div");
    hpFill.className = "hp-fill";
    hpBar.append(hpFill);
    const outTag = document.createElement("span");
    outTag.className = "out-tag";
    outTag.textContent = "OUT";
    outTag.hidden = true;
    const poolTag = document.createElement("span");
    poolTag.className = "pool-tag";
    poolTag.textContent = "POOL";
    poolTag.hidden = true;
    const kingTag = document.createElement("span");
    kingTag.className = "king-tag";
    kingTag.textContent = "👑";
    kingTag.hidden = true;
    label.append(nameEl, hpBar, outTag, poolTag, kingTag);
    this.labels.append(label);
    const avatar: Avatar = {
      id,
      root,
      mixer,
      actions,
      current: idle?.[0] ?? "",
      color,
      hatGroup: null,
      socket: character.getObjectByName("Socket_Hat") ?? null,
      emote: null,
      label,
      nameEl,
      hp: hpFill,
      out: outTag,
      pool: poolTag,
      king: kingTag,
      driven: [],
      armL: driven(character, "armL"),
      armR: driven(character, "armR"),
      head: driven(character, "head"),
      jaw: driven(character, "jaw"),
      loudness: -1,
      speaking: false,
      mouth: 0,
      punch: -1,
    };
    avatar.driven = [avatar.armL, avatar.armR, avatar.head, avatar.jaw].filter(
      (d) => d !== undefined,
    );
    if (this.env === "giant-heads" && avatar.head)
      avatar.head.bone.scale.setScalar(2.6);
    // The shield is a soap-bubble shell in the player's own colour: no
    // shadows, no depth writes, so it never occludes the fighter inside.
    avatar.shield = new THREE.Mesh(
      new THREE.SphereGeometry(0.82, 28, 18),
      new THREE.MeshBasicMaterial({
        color: CHARACTER_PALETTE[color % CHARACTER_PALETTE.length],
        transparent: true,
        opacity: 0.24,
        depthWrite: false,
      }),
    );
    avatar.shield.position.set(0, 0.9, 0);
    avatar.shield.visible = false;
    root.add(avatar.shield);
    this.avatars.set(id, avatar);
    this.applyCosmetics(avatar);
    return avatar;
  }
  /**
   * Equip a player's cosmetics (design doc §18 — strictly cosmetic). Stored
   * per id so avatars that have not been created yet pick them up on spawn.
   */
  setCosmetics(id: number, c: Cosmetics) {
    this.cosmeticCache.set(id, c);
    const a = this.avatars.get(id);
    if (a) this.applyCosmetics(a);
  }
  /** Start an emote on a player; updatePlayer() performs and expires it. */
  emote(id: number, emoteId: string) {
    if (!EMOTES.some((e) => e.id === emoteId)) return;
    const a = this.avatars.get(id);
    if (a) a.emote = { id: emoteId, start: performance.now() };
  }
  /** Recolour the avatar's jacket/body/nose and swap its hat. */
  private applyCosmetics(a: Avatar) {
    const cos = this.cosmeticCache.get(a.id) ?? DEFAULT_COSMETICS;
    this.applySkin(a, cos.skin);
    this.applyHat(a, cos.hat);
  }
  /** Recolour the avatar's cloned materials for a skin. */
  private applySkin(a: Avatar, skinId: string) {
    const skin = SKINS.find((s) => s.id === skinId) ?? SKINS[0];
    const base = new THREE.Color(skin.jacket ?? CHARACTER_PALETTE[a.color % 8]);
    const body = new THREE.Color(
      skin.body ?? skin.jacket ?? CHARACTER_PALETTE[a.color % 8],
    );
    const nose = skin.nose ? new THREE.Color(skin.nose) : null;
    a.root.traverse((o) => {
      if (!(o instanceof THREE.Mesh)) return;
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      for (const m of mats) {
        const mat = m as THREE.MeshStandardMaterial;
        const n = mat.name;
        if (n.startsWith("Jacket")) mat.color.copy(base);
        else if (n.startsWith("Body")) mat.color.copy(body);
        else if (n.startsWith("Nose")) {
          if (nose) mat.color.copy(nose);
          else {
            const hsl = { h: 0, s: 0, l: 0 };
            base.getHSL(hsl);
            mat.color.setHSL(
              hsl.h,
              hsl.s * 0.45,
              hsl.l * 0.78,
            );
          }
        }
      }
    });
  }
  /** Swap the hat; every wearer's clone shares the proto's geometry. Hats ride
   * `Socket_Hat`, so they follow the head bone (head tilt, giant-heads scale) and
   * never touch the character mesh. */
  private applyHat(a: Avatar, hatId: string | null) {
    if (a.hatGroup) {
      a.hatGroup.removeFromParent();
      a.hatGroup = null;
    }
    if (!hatId) return;
    this.hatProtos ??= new Map();
    let proto = this.hatProtos.get(hatId);
    if (!proto) {
      proto = this.makeHat(hatId);
      this.hatProtos.set(hatId, proto);
    }
    const g = proto.clone();
    (a.socket ?? a.root).add(g);
    a.hatGroup = g;
  }
  /** Procedural hat geometry — no GLB regeneration needed. Positions are
   * `Socket_Hat`-local: the socket sits on the skull dome at root-space y 1.965,
   * z 0.02, so a hat authored 0.05-0.10 below the socket overlaps the head. */
  private makeHat(id: string): THREE.Group {
    const g = new THREE.Group();
    const part = (
      geo: THREE.BufferGeometry,
      color: string,
      y: number,
      z = 0,
      extra?: Partial<THREE.MeshStandardMaterialParameters>,
    ) => {
      const m = new THREE.Mesh(
        geo,
        new THREE.MeshStandardMaterial({ color, roughness: 0.6, ...extra }),
      );
      m.position.set(0, y, z);
      m.castShadow = true;
      g.add(m);
      return m;
    };
    if (id === "cap") {
      const dome = part(
        new THREE.SphereGeometry(0.24, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2),
        "#35528c",
        -0.125,
      );
      dome.scale.set(1, 0.75, 1);
      part(new THREE.BoxGeometry(0.36, 0.03, 0.24), "#35528c", -0.115, 0.24);
    } else if (id === "party") {
      part(new THREE.ConeGeometry(0.2, 0.5, 16), "#ff5da2", 0.065);
      part(new THREE.SphereGeometry(0.07, 10, 8), "#ffd800", 0.335);
    } else if (id === "tophat") {
      part(new THREE.CylinderGeometry(0.34, 0.34, 0.03, 20), "#1c1c22", -0.065);
      part(new THREE.CylinderGeometry(0.2, 0.22, 0.4, 20), "#1c1c22", 0.145);
    } else if (id === "halo") {
      const h = part(new THREE.TorusGeometry(0.2, 0.035, 8, 24), "#ffd800", 0.095, 0, {
        emissive: "#b8860b",
        emissiveIntensity: 0.7,
      });
      h.rotation.x = Math.PI / 2;
    }
    return g;
  }
  /** Hinge angles for an emote at progress t ∈ [0,1); null when unknown. */
  private emotePose(
    id: string,
    t: number,
  ): { l?: number; r?: number; head?: number } | null {
    const s = Math.sin;
    if (id === "wave") return { r: -2.15 + s(t * Math.PI * 6) * 0.45 };
    if (id === "flex")
      return {
        l: -2.7 + s(t * Math.PI * 2) * 0.12,
        r: -2.7 + s(t * Math.PI * 2) * 0.12,
        head: -0.3,
      };
    if (id === "taunt")
      return { r: -1.35, head: s(t * Math.PI * 4) * 0.3 };
    if (id === "dance") {
      const beat = t * Math.PI * 5;
      return {
        l: -1.5 + s(beat) * 0.7,
        r: -1.5 - s(beat) * 0.7,
        head: s(beat * 2) * 0.2,
      };
    }
    return null;
  }
  setPlaying(playing: boolean) {
    this.playing = playing;
    for (const m of this.front) m.visible = playing;
    for (const p of this.preview) p.visible = !playing;
    const fog = playing ? GAME_SKY : LOBBY_SKY;
    this.scene.background = playing ? this.gameSky : this.lobbySky;
    if (this.scene.fog instanceof THREE.Fog) {
      this.scene.fog.color.copy(fog);
      this.scene.fog.near = playing ? 48 : 35;
      this.scene.fog.far = playing ? 110 : 90;
    }
  }
  private play(a: Avatar, desired: string, speed = 1) {
    const action = [...a.actions.entries()].find(([name]) =>
      name.includes(desired),
    );
    if (action && action[0] !== a.current) {
      a.actions.get(a.current)?.fadeOut(0.15);
      action[1].reset().fadeIn(0.15).play();
      a.current = action[0];
    }
    if (action) action[1].timeScale = speed;
  }
  /** Keep the lobby trio turned toward one another while their idle chatter plays. */
  private animatePreview(dt: number) {
    const center = FOCUS.clone().setY(0);
    for (const performer of this.previewCast) {
      const { avatar: a, home, phase } = performer;
      a.root.position.copy(home);
      const towardFriends = center.clone().sub(a.root.position);
      a.root.rotation.y = Math.atan2(towardFriends.x, towardFriends.z);
      this.play(a, "Idle");
      repose(a, dt);
      hinge(a.head, Math.sin(this.clock * 0.9 + phase) * 0.08);
    }
  }
  /** A visitor took hold of the lobby camera. */
  grab() {
    this.dragging = true;
    this.coasting.yaw = this.coasting.pitch = 0;
  }
  /** …and let go of it, leaving it coasting on the last of the drag. */
  letGo() {
    this.dragging = false;
  }
  /**
   * Swing the lobby camera by a drag of `dx`/`dy` viewport pixels over `dt` seconds. The
   * rate is kept, so the camera carries on turning after the visitor lets go.
   */
  orbitBy(dx: number, dy: number, dt: number) {
    const { clamp } = THREE.MathUtils;
    const was = { yaw: this.swung.yaw, pitch: this.swung.pitch };
    this.swung.yaw = clamp(this.swung.yaw - dx * 0.004, -SWING.yaw, SWING.yaw);
    this.swung.pitch = clamp(
      this.swung.pitch + dy * 0.003,
      SWING.pitch[0] - OVERVIEW.pitch,
      SWING.pitch[1] - OVERVIEW.pitch,
    );
    if (dt <= 0) return;
    this.coasting.yaw = clamp((this.swung.yaw - was.yaw) / dt, -2.5, 2.5);
    this.coasting.pitch = clamp((this.swung.pitch - was.pitch) / dt, -2.5, 2.5);
  }
  /** Push the lobby camera in or out; `delta` is raw wheel movement. */
  zoomBy(delta: number) {
    this.swung.dist = THREE.MathUtils.clamp(
      this.swung.dist + delta * 0.02,
      SWING.dist[0] - OVERVIEW.dist,
      SWING.dist[1] - OVERVIEW.dist,
    );
  }
  /** Where the pointer sits, -1..1 across the viewport, for the idle parallax. */
  aim(x: number, y: number) {
    this.parallax.wantX = x;
    this.parallax.wantY = y;
  }
  /**
   * The landing-page camera: a slow orbit of the building that a visitor can drag, plus a
   * one-off arrival flight the first time the world is shown.
   */
  overview(dt: number) {
    if (this.playing) return;
    const { clamp, lerp } = THREE.MathUtils;
    this.drift += dt;
    this.arrival = this.calm ? 1 : Math.min(1, this.arrival + dt / ARRIVAL);
    const landed = 1 - Math.pow(1 - this.arrival, 3);
    if (!this.dragging) {
      // Carry the release through and bleed it off, then the rig coasts on the drift alone.
      this.swung.yaw = clamp(
        this.swung.yaw + this.coasting.yaw * dt,
        -SWING.yaw,
        SWING.yaw,
      );
      this.swung.pitch = clamp(
        this.swung.pitch + this.coasting.pitch * dt,
        SWING.pitch[0] - OVERVIEW.pitch,
        SWING.pitch[1] - OVERVIEW.pitch,
      );
      const decay = Math.exp(-dt * 3.2);
      this.coasting.yaw *= decay;
      this.coasting.pitch *= decay;
    }
    // The parallax is a whisper — enough that the room answers a moving mouse.
    const follow = this.dragging || this.calm ? 0 : 1;
    const ease = Math.min(1, dt * 2.4);
    this.parallax.x = lerp(this.parallax.x, this.parallax.wantX * follow, ease);
    this.parallax.y = lerp(this.parallax.y, this.parallax.wantY * follow, ease);
    const alive = this.calm ? 0 : 1;
    const yaw =
      OVERVIEW.yaw +
      this.swung.yaw +
      Math.sin(this.drift * 0.11) * 0.075 * alive +
      this.parallax.x * 0.035 -
      (1 - landed) * 0.22;
    const pitch = clamp(
      OVERVIEW.pitch +
        this.swung.pitch +
        Math.sin(this.drift * 0.07 + 1.3) * 0.018 * alive +
        this.parallax.y * 0.02 +
        (1 - landed) * 0.12,
      SWING.pitch[0],
      SWING.pitch[1],
    );
    const dist = (OVERVIEW.dist + this.swung.dist) * (1 + (1 - landed) * 0.14);
    const flat = Math.cos(pitch) * dist;
    this.camera.position.set(
      FOCUS.x + Math.sin(yaw) * flat,
      FOCUS.y + Math.sin(pitch) * dist,
      FOCUS.z + Math.cos(yaw) * flat,
    );
    this.camera.lookAt(FOCUS);
    for (const m of this.front) m.visible = false;
  }
  updatePlayer(
    s: PlayerState,
    name: string,
    dt: number,
    color = s.id - 1,
    showLabel = true,
  ) {
    const a = this.avatar(s.id, name, color);
    a.label.hidden = !showLabel;
    if (a.hp) a.hp.style.width = `${Math.max(0, Math.min(100, s.hp ?? 100))}%`;
    if (a.out) a.out.hidden = !s.out;
    if (a.pool) a.pool.hidden = s.pool === 0;
    if (a.king) a.king.hidden = this.kingId !== s.id;
    a.root.position.set(s.x, s.y - (s.flags & 2 ? 0.5 : 0.85), s.z);
    a.root.rotation.y = s.yaw + Math.PI;
    if (a.shield) a.shield.visible = (s.block ?? 0) > 0;
    const speed = Math.hypot(s.vx, s.vz),
      desired = !(s.flags & 1)
        ? "Jump"
        : s.flags & 2
          ? "Crouch"
          : speed > 0.15
            ? s.flags & 4
              ? "Sprint"
              : "Walk"
            : "Idle";
    const animationSpeed =
      desired === "Walk"
        ? Math.max(0.45, Math.min(1.65, speed / 2.25))
        : desired === "Sprint"
          ? Math.max(1.35, Math.min(2, speed / 3))
          : desired === "Crouch"
            ? speed < 0.15
              ? 0
              : Math.max(0.45, Math.min(1.15, speed / 2))
            : 1;
    this.play(a, desired, animationSpeed);
    repose(a, dt);
    // Aim the runtime-driven bones on top of the pose the mixer just wrote.
    let pose: { l?: number; r?: number; head?: number } | null = null;
    if (a.emote) {
      const dur = EMOTES.find((e) => e.id === a.emote!.id)?.duration ?? 2000;
      const t = (performance.now() - a.emote.start) / dur;
      if (t >= 1) a.emote = null;
      else pose = this.emotePose(a.emote.id, t);
    }
    hinge(
      a.head,
      Math.max(-1.2, Math.min(1.2, s.pitch)) * HEAD_TILT + (pose?.head ?? 0),
    );
    if (pose) {
      // One hinge per arm per frame: the emote replaces, never compounds on,
      // the held-prop pose.
      if (pose.l !== undefined) hinge(a.armL, pose.l);
      if (pose.r !== undefined) hinge(a.armR, pose.r);
    } else {
      // A punch rides the same rule: one angle per arm per frame, so a driven
      // arm never rotates away from the pose the mixer recorded.
      let l: number | undefined, r: number | undefined;
      if (s.held) l = r = HOLD_LIFT;
      const swung = this.clock - a.punch;
      if (swung < 0.42) {
        const t = Math.sin(Math.min(1, swung / 0.34) * Math.PI);
        r = (r ?? 0) - 1.55 * t;
        l = (l ?? 0) - 0.45 * t;
      }
      if (l !== undefined) hinge(a.armL, l);
      if (r !== undefined) hinge(a.armR, r);
    }
    return a;
  }
  /** Put the camera on a collision-aware boom behind a player. */
  thirdPersonCamera(
    target: { x: number; y: number; z: number },
    yaw: number,
    pitch: number,
  ) {
    const focus = this.cameraFocus.set(target.x, target.y + 0.35, target.z);
    const boom = this.cameraBoom
      .set(
        Math.sin(yaw) * Math.cos(pitch),
        Math.sin(pitch),
        Math.cos(yaw) * Math.cos(pitch),
      )
      .normalize();
    this.cameraRay.set(focus, boom);
    let distance = THIRD_PERSON_DISTANCE;
    const test = (center: readonly number[], size: readonly number[]) => {
      this.cameraBox
        .setFromCenterAndSize(
          this.cameraHit.set(center[0], center[1], center[2]),
          this.cameraSize.set(size[0], size[1], size[2]),
        )
        .expandByScalar(THIRD_PERSON_PADDING);
      if (this.cameraBox.containsPoint(focus)) return;
      const hit = this.cameraRay.intersectBox(this.cameraBox, this.cameraHit);
      if (hit)
        distance = Math.min(
          distance,
          Math.max(0.4, hit.distanceTo(focus) - 0.08),
        );
    };
    for (const box of this.arena.level) test(box.p, box.s);
    for (const door of this.arena.doors) {
      const leaf = this.doors.get(door.id);
      if (leaf) test(leaf.position.toArray(), door.s);
    }
    this.camera.position.copy(focus).addScaledVector(boom, distance);
    this.camera.lookAt(focus.x, focus.y - 0.12, focus.z);
  }
  removePlayer(id: number) {
    const a = this.avatars.get(id);
    if (!a) return;
    this.scene.remove(a.root);
    a.label.remove();
    a.mixer.stopAllAction();
    this.avatars.delete(id);
  }
  speaking(id: number, on: boolean) {
    const a = this.avatars.get(id);
    if (!a) return;
    a.label.classList.toggle("speaking", on);
    a.speaking = on;
  }
  /** Voice level for one player, or -1 when it cannot be metered; opens their mouth. */
  setMouth(id: number, loudness: number) {
    const a = this.avatars.get(id);
    if (a) a.loudness = loudness;
  }
  /** One shared material per colour; hot rounds draw additively so they burn
   *  through the dark sky instead of shading with it. */
  private lookMat(color: string, hot: boolean) {
    let m = this.lookMats.get(color);
    if (!m) {
      m = new THREE.MeshBasicMaterial({
        color,
        toneMapped: false,
        transparent: true,
        opacity: 0.95,
        blending: hot ? THREE.AdditiveBlending : THREE.NormalBlending,
        depthWrite: !hot,
      });
      this.lookMats.set(color, m);
    }
    return m;
  }
  /** The shot message says which gun fired which ids. That is the only place a
   *  round's gun is known — snapshots carry position and nothing else — so it
   *  also seeds the round at the muzzle, flying, instead of waiting up to 50 ms
   *  for the snapshot that first carries it. */
  pelletArms(
    ids: number[],
    kind: GunKind,
    dirs?: { dx: number; dy: number; dz: number }[],
    muzzle?: { x: number; y: number; z: number },
  ) {
    const look = LOOKS[kind],
      speed = GUNS[kind].pelletSpeed,
      now = performance.now();
    ids.forEach((id, i) => {
      this.pelletLooks.set(id, kind);
      if (this.pelletFlight.has(id)) return;
      const d = dirs?.[i];
      if (muzzle) {
        // The round is on screen this frame, not whenever the next snapshot
        // feels like arriving.
        const m = new THREE.Mesh(
          this.pelletGeos[look.shape],
          this.lookMat(look.color, look.hot),
        );
        m.position.set(muzzle.x, muzzle.y, muzzle.z);
        m.scale.setScalar(look.size);
        if (d) m.lookAt(muzzle.x + d.dx, muzzle.y + d.dy, muzzle.z + d.dz);
        this.scene.add(m);
        this.pellets.set(id, m);
      }
      this.pelletFlight.set(id, {
        x: muzzle?.x ?? 0,
        y: muzzle?.y ?? 0,
        z: muzzle?.z ?? 0,
        px: muzzle?.x ?? 0,
        py: muzzle?.y ?? 0,
        pz: muzzle?.z ?? 0,
        vx: (d?.dx ?? 0) * speed,
        vy: (d?.dy ?? 0) * speed,
        vz: (d?.dz ?? 0) * speed,
        ax: 0,
        ay: 0,
        az: 0,
        at: muzzle ? now - PELLET_LAG * 1000 : 0,
        armed: true,
        ox: 0,
        oy: 0,
        oz: 0,
        ot: 0,
        size: look.size,
        look,
      });
    });
  }
  /** Which gun a live round came from, for effects keyed off it. */
  pelletGun(id: number) {
    return this.pelletLooks.get(id);
  }
  /** Snapshots are 20 Hz; frames are not. Fly each round along its own velocity
   *  until the next snapshot rebases it, capped so a round that died between
   *  two snapshots only overshoots a little. This is what stops fast rounds
   *  from stepping across the screen in five-centimetre judders. */
  private advancePellets() {
    for (const [id, m] of this.pellets) {
      const f = this.pelletFlight.get(id);
      if (!f || !f.at) continue;
      const e = Math.min(0.12, Math.max(0, (performance.now() - f.at) / 1000 - PELLET_LAG));
      // A round armed on the trigger frame was painted ahead of where truth says
      // it is; that gap eases away instead of popping at the first snapshot.
      const k = f.ot ? Math.max(0, 1 - (performance.now() - f.ot) / 80) : 0;
      const x = f.x + f.vx * e + 0.5 * f.ax * e * e + f.ox * k,
        y = f.y + f.vy * e + 0.5 * f.ay * e * e + f.oy * k,
        z = f.z + f.vz * e + 0.5 * f.az * e * e + f.oz * k;
      m.position.set(x, y, z);
      const vx = f.vx + f.ax * e,
        vy = f.vy + f.ay * e,
        vz = f.vz + f.az * e,
        sp = Math.hypot(vx, vy, vz);
      const pulse = f.look.hot ? 1 + Math.sin(this.clock * 14 + id) * 0.1 : 1;
      if (sp > 0.2) {
        m.scale.set(
          0.75 * f.size * pulse,
          0.75 * f.size * pulse,
          f.look.stretch * f.size,
        );
        m.lookAt(x + vx, y + vy, z + vz);
        if (f.look.spin) m.rotateZ(this.clock * 3);
      } else m.scale.setScalar(f.size * pulse);
    }
  }
  updateProps(props: PropState[], builds?: Map<number, number>) {
    const seen = new Set<number>();
    for (const p of props) {
      if (p.id >= PELLET_ID_BASE) {
        const kind = this.pelletLooks.get(p.id);
        const look = kind ? LOOKS[kind] : FALLBACK_LOOK;
        // A shot string, not seven copies: the rounds of a fan vary a little in
        // size so the sheet has grain.
        const size =
          look.size *
          (1 + ((p.id % 3) - 1) * 0.12) *
          ((builds?.get(p.owner) ?? 0) & cardBit("big-ball") ? 0.3 / 0.09 : 1);
        let m = this.pellets.get(p.id);
        if (!m) {
          m = new THREE.Mesh(
            this.pelletGeos[look.shape],
            this.lookMat(look.color, look.hot),
          );
          m.position.set(p.x, p.y, p.z);
          m.scale.setScalar(size);
          this.scene.add(m);
          this.pellets.set(p.id, m);
        }
        const was = this.pelletFlight.get(p.id);
        seen.add(p.id);
        // Frames between snapshots hand us the same 20 Hz truth, merely
        // interpolated. Rebasing on that zeroes the velocity and freezes the
        // round — the judder. Only coordinates that actually moved are news.
        if (was && Math.hypot(p.x - was.px, p.y - was.py, p.z - was.pz) < 0.002)
          continue;
        const dt = was?.at ? (performance.now() - was.at) / 1000 : 0;
        let vx = was?.vx ?? 0,
          vy = was?.vy ?? 0,
          vz = was?.vz ?? 0,
          ax = was?.ax ?? 0,
          ay = was?.ay ?? 0,
          az = was?.az ?? 0;
        // Two coordinates a frame apart are 16 ms apart; dividing a difference by
        // that turns one correction into thousands of m/s² and the round then
        // flies metres away from where it was. Derive acceleration only from a
        // real gap between reports, and cap it: gravity, an arc and a seeker's
        // bend are all well under this, a reconciliation spike is not.
        if (was && dt > 0.025) {
          const nx = (p.x - was.x) / dt,
            ny = (p.y - was.y) / dt,
            nz = (p.z - was.z) / dt;
          // Acceleration keeps the launcher's arc and a seeker's bend flying
          // through the gap between snapshots; blended so one bounce cannot
          // spike it into a wild streak.
          ax = Math.max(-ACCEL_CAP, Math.min(ACCEL_CAP, was.ax * 0.35 + ((nx - was.vx) / dt) * 0.65));
          ay = Math.max(-ACCEL_CAP, Math.min(ACCEL_CAP, was.ay * 0.35 + ((ny - was.vy) / dt) * 0.65));
          az = Math.max(-ACCEL_CAP, Math.min(ACCEL_CAP, was.az * 0.35 + ((nz - was.vz) / dt) * 0.65));
          vx = nx;
          vy = ny;
          vz = nz;
        }
        // A trigger-press ghost is a round the authority has only just begun.
        // Capture the gap between where it was painted and where truth says it
        // is, and let that gap ease away over ~80 ms. Snapping it instead is the
        // half-metre pop a shot used to feel at every snapshot.
        const armed = was?.armed ?? false;
        const ox = armed ? m.position.x - p.x : 0,
          oy = armed ? m.position.y - p.y : 0,
          oz = armed ? m.position.z - p.z : 0,
          ot = armed ? performance.now() : 0;
        if (!armed) m.position.set(p.x, p.y, p.z);
        this.pelletFlight.set(p.id, {
          x: p.x,
          y: p.y,
          z: p.z,
          vx,
          vy,
          vz,
          ax,
          ay,
          az,
          at: performance.now() - PELLET_LAG * 1000,
          px: p.x,
          py: p.y,
          pz: p.z,
          armed: false,
          ox,
          oy,
          oz,
          ot,
          size,
          look,
        });
        seen.add(p.id);
        continue;
      }
      const m = this.props.get(p.id);
      if (!m) continue;
      m.position.set(p.x, p.y, p.z);
      m.quaternion.set(p.qx, p.qy, p.qz, p.qw).normalize();
      this.propBases.set(p.id, {
        position: m.position.clone(),
        rotation: m.quaternion.clone(),
      });
      const tag = this.supplyLabels.get(p.id);
      // In someone's hands it needs no tag; back on the ground it grows one.
      if (tag) tag.hidden = p.owner !== 0;
    }
    const stamp = performance.now();
    for (const [id, m] of [...this.pellets]) {
      if (seen.has(id)) continue;
      const f = this.pelletFlight.get(id);
      // A round painted at the muzzle on the trigger press has no snapshot yet.
      // Let it fly for a moment — the first snapshot lands well inside this — and
      // the window carries the delayed clock the round is drawn on as well.
      if (f?.armed && stamp - f.at < 350) continue;
      this.scene.remove(m);
      this.pellets.delete(id);
      if (f) this.pelletFlight.delete(id);
      this.pelletLooks.delete(id);
    }
  }
  setHighlight(id: number) {
    if (id === this.highlight) return;
    for (const [key, group] of this.props) {
      // Props the client can't build a mesh for (a kind this arena never uses)
      // have no tintable body; skip them instead of killing the frame loop.
      const body = group.children[0] as THREE.Mesh | undefined;
      const mat = body?.material as THREE.MeshStandardMaterial | undefined;
      if (!mat) continue;
      mat.emissive.set(key === id ? "#a5c666" : "#000000");
      mat.emissiveIntensity = key === id ? 0.28 : 0;
    }
    this.highlight = id;
  }
  resize() {
    this.renderer.setSize(innerWidth, innerHeight);
    this.camera.aspect = innerWidth / innerHeight;
    this.camera.updateProjectionMatrix();
  }
  render(dt: number) {
    this.clock += dt;
    // Rounds fly every frame, not every snapshot.
    this.advancePellets();
    // The dome drifts almost imperceptibly; the cloud banks are what you notice.
    if (!this.calm) this.scene.backgroundRotation.y += dt * 0.008;
    for (let i = this.effects.length - 1; i >= 0; i--) {
      const e = this.effects[i];
      e.life += dt;
      const left = 1 - e.life / e.ttl;
      if (left <= 0) {
        this.scene.remove(e.mesh);
        e.mesh.geometry.dispose();
        (e.mesh.material as THREE.Material).dispose();
        this.effects.splice(i, 1);
        continue;
      }
      (e.mesh.material as THREE.MeshBasicMaterial).opacity = left;
      if (e.shrink) e.mesh.scale.setScalar(0.4 + left * 0.8);
      else if (e.grow !== undefined) e.mesh.scale.setScalar(0.3 + (1 - left) * e.grow);
    }
    for (let i = this.shards.length - 1; i >= 0; i--) {
      const sh = this.shards[i];
      sh.life += dt;
      if (sh.life >= sh.ttl) {
        this.scene.remove(sh.mesh);
        sh.mesh.geometry.dispose();
        (sh.mesh.material as THREE.Material).dispose();
        this.shards.splice(i, 1);
        continue;
      }
      sh.vel.y -= 18 * dt;
      sh.mesh.position.addScaledVector(sh.vel, dt);
      sh.mesh.rotateX(sh.spin.x * dt);
      sh.mesh.rotateY(sh.spin.y * dt);
      sh.mesh.rotateZ(sh.spin.z * dt);
      (sh.mesh.material as THREE.MeshStandardMaterial).opacity = 1 - sh.life / sh.ttl;
    }
    if (!this.playing) this.animatePreview(dt);
    for (const [id, use] of this.propUses) {
      const prop = this.props.get(id),
        base = this.propBases.get(id),
        age = this.clock - use.started;
      if (!prop || !base || age > 0.46) {
        this.propUses.delete(id);
        continue;
      }
      prop.position.copy(base.position);
      prop.quaternion.copy(base.rotation);
      if (use.kind === "swing") {
        const swing = Math.sin(Math.min(1, age / 0.34) * Math.PI) * 1.2;
        prop.rotateY(-swing);
        prop.rotateX(swing * 0.28);
      } else if (use.kind === "horn") {
        const squeeze = 1 - Math.sin(Math.min(1, age / 0.25) * Math.PI) * 0.08;
        prop.scale.set(1, 1, squeeze);
      }
    }
    for (const [id, a] of this.avatars) {
      // Lobby stand-ins natter to themselves; live players follow their own voice level,
      // falling back to babble for speakers this client cannot meter.
      const target =
        id >= 60000
          ? Math.max(0, Math.sin(this.clock * 0.55 + id * 2.1)) *
            chatter(this.clock, id)
          : a.loudness >= 0
            ? Math.min(1, Math.max(0, (a.loudness - 0.012) * 8))
            : a.speaking
              ? chatter(this.clock, id)
              : 0;
      a.mouth += (target - a.mouth) * Math.min(1, dt * 24);
      hinge(a.jaw, -a.mouth * MOUTH_OPEN);
    }
    for (const [id, a] of this.avatars) {
      if (id >= 60000) continue;
      const p = a.root.position
        .clone()
        .add(new THREE.Vector3(0, 1.95, 0))
        .project(this.camera);
      const visible =
        this.playing &&
        !a.label.hidden &&
        p.z < 1 &&
        p.z > -1 &&
        Math.abs(p.x) < 1 &&
        Math.abs(p.y) < 1;
      a.label.style.display = visible ? "block" : "none";
      a.label.style.transform = `translate(-50%,-100%) translate(${(p.x * 0.5 + 0.5) * innerWidth}px,${(-p.y * 0.5 + 0.5) * innerHeight}px)`;
    }
    // The sky-dropped guns get the same treatment: a name hovering over them
    // so a scramble for a fresh gun has something to aim at.
    const tagPos = new THREE.Vector3();
    for (const [id, el] of this.supplyLabels) {
      const mesh = this.props.get(id);
      if (!mesh || el.hidden) {
        el.style.display = "none";
        continue;
      }
      mesh.getWorldPosition(tagPos);
      tagPos.y += 0.7;
      tagPos.project(this.camera);
      const visible =
        this.playing &&
        tagPos.z < 1 &&
        tagPos.z > -1 &&
        Math.abs(tagPos.x) < 1 &&
        Math.abs(tagPos.y) < 1;
      el.style.display = visible ? "block" : "none";
      if (visible) el.style.transform = `translate(-50%,-100%) translate(${(tagPos.x * 0.5 + 0.5) * innerWidth}px,${(-tagPos.y * 0.5 + 0.5) * innerHeight}px)`;
    }
    this.renderer.render(this.scene, this.camera);
  }
}
