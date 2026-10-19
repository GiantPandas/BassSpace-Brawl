import * as THREE from "three";
import { GLTFLoader, type GLTF } from "three/addons/loaders/GLTFLoader.js";
import { clone } from "three/addons/utils/SkeletonUtils.js";
import { CHARACTER_PALETTE, PALETTE, type Box, type PropKind, type Vec3 } from "../../shared/level";
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
const LOBBY_SKY = new THREE.Color("#f0f4ee");
const GAME_SKY = new THREE.Color("#b9d9e8");
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
  doors = new Map<number, THREE.Group>();
  windows = new Map<number, { glass: THREE.Mesh; root: THREE.Group }>();
  /** Shards from shattered panes; they spray out and delete themselves. */
  private shards: { mesh: THREE.Mesh; vel: THREE.Vector3; spin: THREE.Vector3; life: number; ttl: number }[] = [];
  /** Muzzle flashes, tracers and impact sparks; they fade out and delete themselves. */
  effects: { mesh: THREE.Mesh; life: number; ttl: number; shrink: boolean; grow?: number }[] = [];
  private propBases = new Map<number, { position: THREE.Vector3; rotation: THREE.Quaternion }>();
  private propUses = new Map<number, { kind: PropKind; started: number }>();
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
  private pelletGeo = new THREE.SphereGeometry(0.09, 8, 6);
  private pelletMat = new THREE.MeshBasicMaterial({ color: "#ffcf8a", toneMapped: false });
  asset?: GLTF;
  playing = false;
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
    this.renderer.setClearColor(LOBBY_SKY);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.2;
    container.append(this.renderer.domElement);
    this.labels = document.createElement("div");
    this.labels.className = "world-labels";
    container.append(this.labels);
    this.scene.fog = new THREE.Fog(LOBBY_SKY, 35, 90);
    this.scene.add(new THREE.HemisphereLight("#f6eedb", "#728078", 2.3));
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
    this.renderArena();
    this.loaded = new GLTFLoader()
      .loadAsync(new URL("models/common-worker.glb", document.baseURI).href)
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
    const root = new THREE.Group(),
      kind = this.arena.props[i].kind;
    if (kind === "ball") {
      const ball = new THREE.Mesh(
        new THREE.SphereGeometry(0.3, 32, 24),
        new THREE.MeshStandardMaterial({
          color: PALETTE[i % 8],
          roughness: 0.42,
        }),
      );
      ball.castShadow = true;
      ball.receiveShadow = true;
      root.add(ball);
      for (const axis of [0, 1]) {
        const seam = new THREE.Mesh(
          new THREE.TorusGeometry(0.301, 0.016, 10, 48),
          new THREE.MeshStandardMaterial({ color: "#f4ecd8", roughness: 0.55 }),
        );
        if (axis === 0) seam.rotation.x = Math.PI / 2;
        else seam.rotation.y = Math.PI / 2;
        root.add(seam);
      }
      const valve = new THREE.Mesh(
        new THREE.SphereGeometry(0.034, 12, 8),
        new THREE.MeshStandardMaterial({ color: "#2e2a26", roughness: 0.5 }),
      );
      valve.position.set(0, 0.29, 0.05);
      root.add(valve);
      return root;
    }
    if (kind === "gun") {
      // Modelled pointing down -z, which is where its holder is looking.
      const body = new THREE.Mesh(
        new THREE.BoxGeometry(0.11, 0.16, 0.56),
        new THREE.MeshStandardMaterial({
          color: "#414b54",
          roughness: 0.45,
          metalness: 0.45,
        }),
      );
      body.castShadow = true;
      root.add(body);
      const barrel = new THREE.Mesh(
        new THREE.CylinderGeometry(0.045, 0.05, 0.42, 10),
        new THREE.MeshStandardMaterial({
          color: "#2b3238",
          roughness: 0.35,
          metalness: 0.6,
        }),
      );
      barrel.rotation.x = Math.PI / 2;
      barrel.position.set(0, 0.02, -0.42);
      barrel.castShadow = true;
      const grip = new THREE.Mesh(
        new THREE.BoxGeometry(0.1, 0.28, 0.13),
        new THREE.MeshStandardMaterial({ color: "#6b5137", roughness: 0.8 }),
      );
      grip.position.set(0, -0.2, 0.14);
      grip.rotation.x = -0.22;
      grip.castShadow = true;
      const sight = new THREE.Mesh(
        new THREE.BoxGeometry(0.05, 0.05, 0.2),
        new THREE.MeshStandardMaterial({
          color: PALETTE[i % 8],
          roughness: 0.6,
        }),
      );
      sight.position.set(0, 0.11, -0.02);
      root.add(barrel, grip, sight);
      const brake = new THREE.Mesh(
        new THREE.CylinderGeometry(0.055, 0.055, 0.06, 10),
        new THREE.MeshStandardMaterial({ color: "#2b3238", roughness: 0.35, metalness: 0.6 }),
      );
      brake.rotation.x = Math.PI / 2;
      brake.position.set(0, 0.02, -0.62);
      brake.castShadow = true;
      const pump = new THREE.Mesh(
        new THREE.BoxGeometry(0.09, 0.05, 0.18),
        new THREE.MeshStandardMaterial({ color: "#6b5137", roughness: 0.8 }),
      );
      pump.position.set(0, -0.09, -0.3);
      pump.castShadow = true;
      const mag = new THREE.Mesh(
        new THREE.BoxGeometry(0.07, 0.12, 0.09),
        new THREE.MeshStandardMaterial({ color: "#3b2b22", roughness: 0.8 }),
      );
      mag.position.set(0, -0.16, 0.0);
      mag.castShadow = true;
      const notch = new THREE.Mesh(
        new THREE.BoxGeometry(0.055, 0.035, 0.03),
        new THREE.MeshStandardMaterial({ color: PALETTE[i % 8], roughness: 0.6 }),
      );
      notch.position.set(0, 0.11, 0.24);
      root.add(brake, pump, mag, notch);
      return root;
    }
    if (kind === "bat") {
      // The handle is at +z and the barrel reaches forward along -z.
      const barrel = new THREE.Mesh(
        new THREE.CylinderGeometry(0.1, 0.055, 0.9, 14),
        new THREE.MeshStandardMaterial({
          color: PALETTE[i % 8],
          roughness: 0.72,
        }),
      );
      barrel.rotation.x = Math.PI / 2;
      barrel.position.z = -0.18;
      barrel.castShadow = true;
      root.add(barrel);
      const grip = new THREE.Mesh(
        new THREE.CylinderGeometry(0.043, 0.043, 0.34, 12),
        new THREE.MeshStandardMaterial({ color: "#3b2b22", roughness: 0.9 }),
      );
      grip.rotation.x = Math.PI / 2;
      grip.position.z = 0.43;
      root.add(grip);
      const bandMat = new THREE.MeshStandardMaterial({ color: "#ece0bc", roughness: 0.7 });
      const band = new THREE.Mesh(
        new THREE.TorusGeometry(0.087, 0.011, 8, 20),
        bandMat,
      );
      band.rotation.x = Math.PI / 2;
      band.position.z = -0.5;
      root.add(band);
      for (const gz of [0.34, 0.44, 0.54] as const) {
        const wrap = new THREE.Mesh(new THREE.TorusGeometry(0.045, 0.008, 8, 16), bandMat);
        wrap.rotation.x = Math.PI / 2;
        wrap.position.z = gz;
        root.add(wrap);
      }
      const knob = new THREE.Mesh(
        new THREE.CylinderGeometry(0.058, 0.05, 0.05, 12),
        new THREE.MeshStandardMaterial({ color: "#3b2b22", roughness: 0.9 }),
      );
      knob.rotation.x = Math.PI / 2;
      knob.position.z = 0.615;
      knob.castShadow = true;
      root.add(knob);
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
      const tint = new THREE.MeshStandardMaterial({ color: PALETTE[i % 8], roughness: 0.8 });
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
      const tint = new THREE.MeshStandardMaterial({ color: PALETTE[i % 8], roughness: 0.8 });
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
      const tint = new THREE.MeshStandardMaterial({ color: PALETTE[i % 8], roughness: 0.55, side: THREE.DoubleSide });
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
      const tint = new THREE.MeshStandardMaterial({ color: PALETTE[i % 8], roughness: 0.3 });
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
    if (kind === "bucket") {
      const tint = new THREE.MeshStandardMaterial({ color: PALETTE[i % 8], roughness: 0.4, metalness: 0.3, side: THREE.DoubleSide });
      const body = new THREE.Mesh(new THREE.CylinderGeometry(0.19, 0.155, 0.3, 12, 1, true), tint);
      body.position.y = -0.02;
      body.castShadow = true;
      root.add(body);
      const steel = new THREE.MeshStandardMaterial({ color: "#8a8f96", roughness: 0.35, metalness: 0.5 });
      const rim = new THREE.Mesh(new THREE.TorusGeometry(0.175, 0.018, 8, 24), steel);
      rim.rotation.x = Math.PI / 2;
      rim.position.y = 0.14;
      root.add(rim);
      const handle = new THREE.Mesh(new THREE.TorusGeometry(0.16, 0.01, 6, 20, Math.PI), steel);
      handle.position.y = 0.14;
      handle.castShadow = true;
      root.add(handle);
      for (const lx of [-0.175, 0.175] as const) {
        const lug = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.04, 0.03), steel);
        lug.position.set(lx, 0.14, 0);
        root.add(lug);
      }
      return root;
    }
    const mat = new THREE.MeshStandardMaterial({
      color: PALETTE[i % 8],
      roughness: 0.8,
    });
    // Board crate: the tinted box reads as boards, framed by a dark wood cage
    // of corner posts and edge rails so tumbles catch the light. Children[0]
    // stays the tintable body so `setHighlight` still writes its emissive.
    const box = new THREE.Mesh(new THREE.BoxGeometry(0.56, 0.56, 0.56), mat);
    box.castShadow = true;
    box.receiveShadow = true;
    root.add(box);
    const wood = new THREE.MeshStandardMaterial({ color: "#54402c", roughness: 0.95 });
    // Plank seams: thin belts a hair proud of every face.
    for (const y of [-0.28, 0.28] as const) {
      const seam = new THREE.Mesh(new THREE.BoxGeometry(0.565, 0.02, 0.565), wood);
      seam.position.y = y;
      root.add(seam);
    }
    for (const [cx, cz] of [[-0.29, -0.29], [0.29, -0.29], [-0.29, 0.29], [0.29, 0.29]] as const) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.055, 0.6, 0.055), wood);
      post.position.set(cx, 0, cz);
      post.castShadow = true;
      root.add(post);
    }
    for (const y of [-0.29, 0.29] as const) {
      for (const s of [-1, 1] as const) {
        const railX = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.05, 0.05), wood);
        railX.position.set(0, y, s * 0.29);
        railX.castShadow = true;
        root.add(railX);
        const railZ = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.05, 0.62), wood);
        railZ.position.set(s * 0.29, y, 0);
        railZ.castShadow = true;
        root.add(railZ);
      }
    }
    // Stamped stencil: a pale patch slashed through, on the two z faces.
    const stencil = new THREE.MeshStandardMaterial({ color: "#ece0bc", roughness: 0.9 });
    for (const sz of [-1, 1] as const) {
      const patch = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.2, 0.012), stencil);
      patch.position.set(0, 0.02, sz * 0.282);
      root.add(patch);
      const slash = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.05, 0.008), stencil);
      slash.position.set(0, 0.02, sz * 0.288);
      slash.rotation.z = 0.79;
      root.add(slash);
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
  pelletGhost(muzzle: { x: number; y: number; z: number }) {
    this.spark(
      "#ffd27a",
      0.14,
      new THREE.Vector3(muzzle.x, muzzle.y, muzzle.z),
      0.16,
    );
  }
  /** Impact spark where a live pellet was consumed. */
  pelletImpact(pos: { x: number; y: number; z: number }) {
    this.spark(
      "#ffcf8a",
      0.12,
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
  /** Exact rendered barrel tip, after interpolation, for a tracer with no side gap. */
  muzzle(id: number): Vec3 | undefined {
    const gun = this.props.get(id);
    if (!gun || this.arena.props[id - 1]?.kind !== "gun") return;
    gun.updateMatrixWorld(true);
    const p = gun.localToWorld(new THREE.Vector3(0, 0.02, -0.64));
    return { x: p.x, y: p.y, z: p.z };
  }
  useProp(id: number, kind: PropKind) {
    this.propUses.set(id, { kind, started: this.clock });
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
          } else if (m.name.startsWith("Mouth")) {
            const hsl = { h: 0, s: 0, l: 0 };
            baseColor.getHSL(hsl);
            copy.color.setHSL(
              (hsl.h + 0.5) % 1.0,
              1.0,
              0.48,
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
        } else if (n.startsWith("Mouth")) {
          const hsl = { h: 0, s: 0, l: 0 };
          base.getHSL(hsl);
          mat.color.setHSL((hsl.h + 0.5) % 1.0, 1.0, 0.48);
        }
      }
    });
  }
  /** Swap the hat; every wearer's clone shares the proto's geometry. */
  private applyHat(a: Avatar, hatId: string | null) {
    if (a.hatGroup) {
      a.root.remove(a.hatGroup);
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
    a.root.add(g);
    a.hatGroup = g;
  }
  /** Procedural hat geometry — no GLB regeneration needed. */
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
        1.84,
      );
      dome.scale.set(1, 0.75, 1);
      part(new THREE.BoxGeometry(0.36, 0.03, 0.24), "#35528c", 1.85, 0.26);
    } else if (id === "party") {
      part(new THREE.ConeGeometry(0.2, 0.5, 16), "#ff5da2", 2.03);
      part(new THREE.SphereGeometry(0.07, 10, 8), "#ffd800", 2.3);
    } else if (id === "tophat") {
      part(new THREE.CylinderGeometry(0.34, 0.34, 0.03, 20), "#1c1c22", 1.9);
      part(new THREE.CylinderGeometry(0.2, 0.22, 0.4, 20), "#1c1c22", 2.11);
    } else if (id === "halo") {
      const h = part(new THREE.TorusGeometry(0.2, 0.035, 8, 24), "#ffd800", 2.06, 0, {
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
    const sky = playing ? GAME_SKY : LOBBY_SKY;
    this.renderer.setClearColor(sky);
    if (this.scene.fog instanceof THREE.Fog) {
      this.scene.fog.color.copy(sky);
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
    } else if (s.held) {
      hinge(a.armL, HOLD_LIFT);
      hinge(a.armR, HOLD_LIFT);
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
  updateProps(props: PropState[], builds?: Map<number, number>) {
    const seen = new Set<number>();
    for (const p of props) {
      if (p.id >= PELLET_ID_BASE) {
        let m = this.pellets.get(p.id);
        if (!m) {
          m = new THREE.Mesh(this.pelletGeo, this.pelletMat);
          this.scene.add(m);
          this.pellets.set(p.id, m);
        }
        const big = !!((builds?.get(p.owner) ?? 0) & cardBit("big-ball"));
        m.scale.setScalar(big ? 0.3 / 0.09 : 1);
        m.position.set(p.x, p.y, p.z);
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
    }
    for (const [id, m] of [...this.pellets]) {
      if (!seen.has(id)) {
        this.scene.remove(m);
        this.pellets.delete(id);
      }
    }
  }
  setHighlight(id: number) {
    if (id === this.highlight) return;
    for (const [key, group] of this.props) {
      const mat = (group.children[0] as THREE.Mesh)
        .material as THREE.MeshStandardMaterial;
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
      if (use.kind === "bat") {
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
    this.renderer.render(this.scene, this.camera);
  }
}
