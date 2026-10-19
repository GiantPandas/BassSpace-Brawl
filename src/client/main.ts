import { detect, type NetworkConfig } from "../net/mode";
import type { Channel } from "../net/channel";
import { openSocket } from "../net/ws-client";
import { RoomClient } from "../net/peer";
import { startHosting, type Hosting } from "./hosting";
import "./style.css";
import { MovementSounds } from "./audio/movement";
import * as THREE from "three";
import {
  initPhysics,
  Simulation,
  PELLET_ID_BASE,
  type Character,
} from "../shared/simulation";
import { STEP, PALETTE, CHARACTER_PALETTE, WEAPON, MELEE, HORN } from "../shared/level";
import { DEFAULT_ARENA, buildArena } from "../shared/arena";
import { CARDS, cardBit, buildStats } from "../shared/upgrades";
import {
  EMOTES,
  HATS,
  MAX_EMOTE_SLOTS,
  SKINS,
  VOICE_EFFECTS,
  sanitizeCosmetics,
  type Cosmetics,
} from "../shared/cosmetics";
import { chaosModifierFor, modifierName, COMBAT } from "../shared/match";
import {
  BUTTON,
  decodeSnapshot,
  encodeInputs,
  type Input,
  type Snapshot,
  type PropState,
} from "../shared/protocol";
import { GameScene } from "./rendering/scene";
import { Voice } from "./audio/voice";
const $ = <T extends HTMLElement = HTMLElement>(id: string) =>
  document.getElementById(id) as T;
$("app").innerHTML = `<div id="world"></div><div id="shade" class="shade"></div>
<header class="topbar"><button id="about-button" class="brand" aria-label="About BassSpace Brawl"><span class="brand-mark"><svg viewBox="0 0 192 192" aria-hidden="true"><rect x="17" y="17" width="158" height="158" rx="46" fill="#2b2545" transform="rotate(-11 96 96)"/><g stroke="#c9f24f" stroke-width="13" stroke-linecap="round" fill="none"><path d="M107.8 62.6A52 52 0 0 1 107.8 129.4"/><path d="M133.5 50.1A80 80 0 0 1 133.5 141.9"/></g><circle cx="68" cy="96" r="30" fill="#c9f24f"/><circle cx="68" cy="96" r="13" fill="#2b2545"/></svg></span><span class="brand-word">bassspace <b>brawl</b></span><small></small></button><div id="top-actions" class="top-actions"><span id="net-mode" class="pill net-mode" hidden><i class="dot"></i> <span id="net-mode-text"></span></span><button id="help-button" class="icon-button" aria-label="Controls and help">?</button></div></header>
<main id="lobby" class="lobby"><div class="eyebrow">2–8 players · an arena shaped by the room code</div><h1><span class="line"><span>Turn the bass up.</span></span><span class="line"><span>Throw them <em>out.</em></span></span></h1><p class="intro">Shove guns, throwable furniture and upgrades that break every round.<br>Built with Three.js, Rapier physics, and proximity voice.</p><a class="github-button" href="https://github.com/larshurrelb/friendslop-base" target="_blank" rel="noopener noreferrer" aria-label="Get BassSpace Brawl on GitHub">Get it on GitHub <span class="github-arrow" aria-hidden="true">↗</span></a><form id="entry" class="entry-card"><label for="name">WHAT SHOULD WE CALL YOU?</label><div class="name-input"><div class="avatar-chip">✳</div><input id="name" aria-label="Your name" autocomplete="nickname" maxlength="20" placeholder="Your name" required value="Guest"></div><button class="primary" id="create" type="submit">Create a room <span>↗</span></button><div class="separator">or find your friends</div><div class="join-row"><input id="join-code" aria-label="Room code" placeholder="ROOM CODE" maxlength="6" autocomplete="off"><button id="join" type="button">Join →</button></div><div class="entry-note">No accounts. Just a room code.</div><p id="entry-error" class="error" hidden></p></form><div class="lobby-foot"><span>2–8 players</span><span>Proximity voice</span><span>Cards between rounds</span></div><p class="mobile-notice">A keyboard and mouse are required to play.</p></main>
<footer id="footer" class="footer"><span>Every round makes the brawl worse.</span><span class="version">BASSSPACE BRAWL &nbsp; / &nbsp; v0.1</span></footer>
<div id="hud" class="hud" hidden><div class="room-bar"><div><small>YOUR ROOM</small><span id="room-code" class="room-code">------</span></div><button id="copy-room" aria-label="Copy room invite">Copy invite ↗</button><span id="player-count" class="count">1 / 8</span><span id="match-timer" class="count"></span><span id="bucks" class="count" title="Bucks — win rounds to earn more">💰 0</span><select id="mode-select" aria-label="Game mode" hidden><option value="ffa">Free for all</option><option value="teams-2">Teams 2v2</option><option value="teams-3">Teams 3v3</option><option value="teams-4">Teams 4v4</option><option value="king">King of the Yard</option><option value="chaos">Chaos Mode</option></select><button id="ready-button">Ready up</button></div><div id="ammo" class="ammo" hidden></div><div id="crosshair" class="crosshair"></div><div id="shield-gauge" class="shield-gauge" hidden></div><div id="hitflash" class="hitflash"></div><div id="interact" class="interact" hidden></div><div class="bottom-left"><span class="zone-icon">◈</span><div><div id="zone-name" class="zone-name">The stage</div><div id="zone-desc" class="zone-desc">CENTER RING · OPEN SKY</div></div></div><div class="voice-controls"><button id="enable-voice">Enable voice</button><button id="mute" hidden aria-label="Mute microphone">Mic on</button><select id="voice-mode" aria-label="Microphone mode"><option value="open">Open mic</option><option value="ptt">Push to talk</option></select><span id="speaking-light" class="speaking-light"></span></div><div class="bottom-right"><button id="locker-button">Locker <span>✦</span></button><button id="friends-button">Friends <span id="friend-number">1</span></button><button id="debug-button">Diagnostics <span>⌁</span></button></div><div id="pause" class="pause"><div class="eyebrow" style="justify-content:center">The stage is open</div><h2>Break something.</h2><p>Test the weapons and break the furniture.<br>Then ready up and start the brawl.</p><button id="resume" class="primary">Click to explore →</button><small>WASD to move · Mouse to look · Esc to pause</small></div><div id="countdown" class="countdown" hidden></div><div id="round-banner" class="banner" hidden></div><div id="build" class="build" hidden><div class="eyebrow">CHOOSE AN UPGRADE</div><div id="build-cards" class="build-cards"></div></div></div>
<aside id="friends" class="drawer" hidden><button class="close" data-close="friends" aria-label="Close friends">×</button><h3>In good company</h3><div id="member-list"></div><button id="solo-tab" class="primary">Open a second player <span>↗</span></button><p class="debug-note">Test solo in another tab. Use headphones when testing microphones.</p><button id="leave" class="primary" style="background:transparent;color:#8f88ad;border-color:#cfcbdd">Leave room</button></aside>
<aside id="debug" class="drawer" hidden><button class="close" data-close="debug" aria-label="Close diagnostics">×</button><h3>Under the hood</h3><div id="metrics" class="metrics"></div><div id="peer-debug"></div><p id="codec-status" class="debug-note"></p><p id="net-detail" class="debug-note"></p></aside>
<aside id="help" class="drawer" hidden><button class="close" data-close="help" aria-label="Close help">×</button><h3>A little field guide</h3><div class="help-grid"><div><kbd class="key">W A S D</kbd></div><span>Move around</span><div><kbd class="key">Mouse</kbd></div><span>Look around</span><div><kbd class="key">Tab</kbd></div><span>First / third person</span><div><kbd class="key">Shift</kbd></div><span>Sprint</span><div><kbd class="key">Ctrl / C</kbd></div><span>Crouch</span><div><kbd class="key">Space</kbd></div><span>Jump</span><div><kbd class="key">E</kbd></div><span>Pick up / drop</span><div><kbd class="key">Q</kbd></div><span>Throw held object</span><div><kbd class="key">B</kbd></div><span>Air dash (with the card)</span><div><kbd class="key">1 – 4</kbd></div><span>Play a bound emote</span><div><kbd class="key">Click / F</kbd></div><span>Fire, swing or honk</span><div><kbd class="key">Right click</kbd></div><span>Raise shield bubble — deflects shots and throws; 4 s cooldown</span><div><kbd class="key">V</kbd></div><span>Push to talk</span><div><kbd class="key">M</kbd></div><span>Mute microphone</span><div><kbd class="key">Esc</kbd></div><span>Release mouse</span></div><p class="about-copy">Voices carry across the open sky; the void under the stage carries nothing back.</p><p class="about-copy">Bounce pads fling you onto the perches. Hits drain health and launch you — the edge of the stage and the void below finish the job.</p></aside>
<aside id="about" class="drawer" hidden><button class="close" data-close="about" aria-label="Close about">×</button><h3>A stage with a temper.</h3><p class="about-copy">BassSpace Brawl is a 2–8 player physics arena brawler. Shove guns, throwable furniture, proximity voice and upgrade cards that make every round more broken than the last.</p><p class="debug-note">Three.js · Rapier · TypeScript<br>Original Blender characters & synthetic acoustics</p></aside>
<aside id="locker" class="drawer" hidden><button class="close" data-close="locker" aria-label="Close locker">×</button><h3>The Locker</h3><p class="debug-note">Cosmetics only — nothing here hits harder. Win rounds to earn 💰.</p><div id="shop-skins" class="shop-section"><h4>Skins</h4></div><div id="shop-hats" class="shop-section"><h4>Hats</h4></div><div id="shop-emotes" class="shop-section"><h4>Emotes <small>(keys 1–4)</small></h4></div><div id="shop-voice" class="shop-section"><h4>Voice</h4></div></aside><div id="toast" class="toast" hidden></div><div id="loading" class="loading">Warming up the bass…</div>`;
const scene = new GameScene($("world"));
// The room's arena: the Stage until a welcome brings the generated layout.
let arena = DEFAULT_ARENA;
/** Prop kind by id for the current arena — ids are positions in `arena.props`. */
const kindOf = (id: number) => arena.props[id - 1]?.kind;
let sim: Simulation | undefined,
  local: Character | undefined,
  socket: Channel | undefined,
  id = 0,
  code = "",
  token = "",
  name = "Guest",
  seq = 0,
  baseline = 0,
  action = 0;
let connected = false,
  intentional = false;
let cameraMode: "first" | "third" = "first";
let yaw = 0,
  pitch = 0,
  cameraYaw = 0,
  cameraPitch = 0,
  acc = 0,
  last = performance.now(),
  ping = 0,
  tickRate = 60,
  tickCost = 0,
  rx = 0,
  tx = 0,
  correction = 0,
  latestTick = 0,
  lastStagger = 0,
  shake = 0;
let members: {
  id: number;
  color: number;
  name: string;
  connected: boolean;
  voiceReady: boolean;
  cosmetics?: Cosmetics;
}[] = [];
/** The local locker (design doc §18): bucks are earned client-side only. */
let locker: { bucks: number; owned: string[]; equipped: Cosmetics } = loadLocker();
let eliminatedThisRound = false,
  seenRound = 0,
  awardedRound = 0;
function loadLocker() {
  try {
    const raw = JSON.parse(localStorage.getItem("bassspace:locker") ?? "");
    const owned = Array.isArray(raw.owned)
      ? raw.owned.filter((x: unknown) => typeof x === "string")
      : [];
    if (!owned.includes("classic")) owned.unshift("classic");
    return {
      bucks: Number.isFinite(raw.bucks) ? Math.max(0, raw.bucks | 0) : 0,
      owned,
      equipped: sanitizeCosmetics(raw.equipped),
    };
  } catch {
    return {
      bucks: 0,
      owned: ["classic"],
      equipped: { skin: "classic", hat: null, emotes: [], voice: null },
    };
  }
}
function saveLocker() {
  localStorage.setItem("bassspace:locker", JSON.stringify(locker));
  renderBucks();
  renderShop();
}
function renderBucks() {
  $("bucks").textContent = `💰 ${locker.bucks}`;
}
function award(n: number, reason?: string) {
  locker.bucks += n;
  saveLocker();
  if (reason) toast(`+${n} 💰 — ${reason}`);
}
let match: {
  phase: "lobby" | "countdown" | "round" | "break" | "match-end";
  round: number;
  rounds: number;
  until: number;
  ready: number[];
  winner: number;
  offers?: { id: number; cards: string[] }[];
  mode?: string;
  teams?: Record<string, number>;
  king?: number;
  modifier?: string;
} | null = null,
  matchUi = "";
const keys = new Set<string>(),
  ballHeights = new Map<number, { y: number; dy: number }>(),
  outStates = new Map<number, { out: number; hp: number }>(),
  pending: Input[] = [],
  outgoing: Input[] = [],
  baselines = new Map<number, PropState[]>(),
  snapshots: { s: Snapshot; time: number }[] = [];
const offset = new THREE.Vector3();
let noticeTimer: ReturnType<typeof setTimeout>,
  hitTimer: ReturnType<typeof setTimeout>,
  lastUse = 0,
  // Client mirror of the authority's reload gate, for trigger sound only.
  reloadUntil = 0;
function toast(message: string) {
  $("toast").textContent = message;
  $("toast").hidden = false;
  clearTimeout(noticeTimer);
  noticeTimer = setTimeout(() => ($("toast").hidden = true), 3500);
}
function send(data: unknown) {
  if (socket?.open) {
    socket.send(JSON.stringify(data));
    tx++;
  }
}
const voice = new Voice(
  send,
  (who, on) => {
    scene.speaking(who, on);
    if (who === id) $("speaking-light").classList.toggle("on", on);
  },
  () => {
    if (voice.enabled) {
      $("enable-voice").textContent = "Audio on";
      $("mute").hidden = false;
      $("mute").textContent = voice.muted
        ? "Mic muted"
        : voice.mode === "ptt"
          ? "Hold V to talk"
          : "Mic on";
      $("mute").classList.toggle("muted", voice.muted);
      $("mute").classList.toggle("active", voice.gate);
    }
    $("enable-voice").title = voice.status;
  },
);
const params = new URLSearchParams(location.search);
let network: NetworkConfig;
const networkReady = detect(params).then((config) => {
  network = config;
  voice.iceServers = config.iceServers;
  const server = config.mode === "server";
  const badge = $("net-mode");
  $("net-mode-text").textContent = server
    ? "LIVE SERVER"
    : "STATIC · BROWSER-HOSTED";
  badge.title = server
    ? "A server owns this room's physics, so anyone can join."
    : "No game server: whoever creates a room hosts it in their browser. Very strict networks may not be able to connect.";
  badge.dataset.mode = config.mode;
  badge.hidden = false;
  $("net-detail").innerHTML = server
    ? "Game /ws + voice /voice<br>One Node process. One HTTP port."
    : "Game + voice over WebRTC to the host<br>No server. The host's browser owns the room.";
});
$("join-code").setAttribute("value", params.get("room") ?? "");
if (localStorage.getItem("friendslop:name"))
  $("name").setAttribute("value", localStorage.getItem("friendslop:name")!);
if (params.get("name")) $("name").setAttribute("value", params.get("name")!);
if (params.has("fresh")) {
  sessionStorage.removeItem("friendslop:session");
  const clean = new URL(location.href);
  clean.searchParams.delete("fresh");
  history.replaceState(null, "", clean);
}
const movementSounds = new MovementSounds((position, kind) => voice.spatial?.effect(position, kind));
function setPlaying(value: boolean) {
  movementSounds.clear();
  document.body.classList.toggle("playing", value);
  for (const name of ["lobby", "shade", "footer", "top-actions"])
    $(name).hidden = value;
  $("hud").hidden = !value;
  scene.setPlaying(value);
  if (value) $("pause").hidden = false;
}
async function join(wanted: string) {
  if (connected) return;
  name = $<HTMLInputElement>("name").value.trim() || "Guest";
  localStorage.setItem("friendslop:name", name);
  $("entry-error").hidden = true;
  $<HTMLButtonElement>("create").disabled = true;
  intentional = false;
  code = wanted;
  token = "";
  const saved = JSON.parse(
    sessionStorage.getItem("friendslop:session") ?? "null",
  );
  if (saved?.code === code) token = saved.token;
  await connect();
}
let hosting: Hosting | undefined;
let rooms: RoomClient | undefined;
/** In p2p mode an empty code means "create a room", which means host it. */
async function openChannel(kind: "game" | "voice") {
  if (network.mode === "server")
    return openSocket(kind === "game" ? "/ws" : "/voice");
  if (kind === "game" && !code) {
    hosting?.dispose();
    hosting = await startHosting(network.broker);
    code = hosting.code;
  }
  if (hosting && code === hosting.code) return hosting.local(kind);
  return (rooms ??= new RoomClient(network.broker)).open(code, kind);
}
async function connect() {
  await networkReady;
  let channel: Channel;
  try {
    channel = await openChannel("game");
  } catch (e) {
    const message =
      e instanceof Error ? e.message : "Could not reach that room.";
    $("entry-error").textContent = message;
    $("entry-error").hidden = false;
    toast(message);
    $<HTMLButtonElement>("create").disabled = false;
    return;
  }
  socket = channel;
  voice.openTransport = () => openChannel("voice");
  send({ type: "join", code, name, token });
  channel.onmessage = (data) => {
    rx++;
    try {
      if (typeof data !== "string") {
        snapshot(decodeSnapshot(data));
        return;
      }
      const m = JSON.parse(data);
      if (m.type === "welcome") {
        id = m.id;
        code = m.code;
        token = m.token;
        seq = m.seq;
        pending.length = outgoing.length = snapshots.length = 0;
        baselines.clear();
        baseline = 0;
        sim?.dispose();
        arena = buildArena(code);
        scene.renderArena(arena);
        sim = new Simulation(true, arena);
        if (Array.isArray(m.doors)) sim.syncDoors(m.doors);
        if (Array.isArray(m.windows)) sim.syncWindows(m.windows);
        local = sim.addPlayer(id);
        match = null;
        lastStagger = 0;
        outStates.clear();
        eliminatedThisRound = false;
        seenRound = 0;
        awardedRound = 0;
        connected = true;
        send({ type: "cosmetics", cosmetics: locker.equipped });
        sessionStorage.setItem(
          "friendslop:session",
          JSON.stringify({ code, token }),
        );
        $("room-code").textContent = code;
        setPlaying(true);
        voice.configure(id, code, m.ticket);
        $<HTMLButtonElement>("create").disabled = false;
        if (import.meta.env.DEV)
          (window as any).__friendslop = {
            get state() {
              return local?.state;
            },
            get members() {
              return members;
            },
            get voice() {
              return voice;
            },
            get scene() {
              return scene;
            },
            get sim() {
              return sim;
            },
            get cameraMode() {
              return cameraMode;
            },
            input: (key: string, down: boolean) =>
              down ? keys.add(key) : keys.delete(key),
            action: interact,
            shoot: fire,
            get doors() {
              return sim?.doorStates();
            },
            look: (y: number, p: number) => {
              yaw = y;
              pitch = p;
              cameraYaw = y;
              cameraPitch = p;
            },
            join,
            send,
          };
      }
      if (m.type === "members") {
        members = m.members;
        $("player-count").textContent =
          `${members.filter((m) => m.connected).length} / 8`;
        $("friend-number").textContent = String(members.length);
        for (const [pid] of scene.avatars)
          if (pid < 60000 && !members.some((m) => m.id === pid))
            scene.removePlayer(pid);
        for (const m of members)
          if (m.cosmetics) {
            scene.setCosmetics(m.id, m.cosmetics);
            applyVoiceFx(m.id, m.cosmetics);
          }
        voice.updateMembers(members);
        renderMembers();
      }
      if (m.type === "pong") {
        ping = Math.round(performance.now() - m.time);
        tickCost = Number.isFinite(m.cost) ? m.cost : 0;
        tickRate = Number.isFinite(m.rate) ? m.rate : 0;
      }
      if (m.type === "signal") voice.signal(m.peer, m.data);
      if (m.type === "route")
        voice.route(m.peer, m.relay, m.epoch, m.reason, m.forced);
      if (m.type === "speaking") voice.speakingFrom(m.id, m.active);
      if (m.type === "match") {
        match = m;
        // Between rounds the mouse goes free: the build cards are DOM buttons
        // and nothing is clickable while pointer lock holds its cursor. The
        // countdown of the next round takes the lock back so aiming resumes.
        if (m.phase === "break" || m.phase === "match-end") {
          if (document.pointerLockElement) document.exitPointerLock();
        } else if (m.phase === "countdown" && !document.pointerLockElement) {
          if (connected && !previewControls) void lock();
        }
        // The lobby is where the mode is picked; keep the select in sync.
        if (m.phase === "lobby")
          ($("mode-select") as HTMLSelectElement).value = m.mode ?? "ffa";
        // Both sides derive the chaos modifier; apply it to our prediction.
        const env =
          m.mode === "chaos" &&
          (m.phase === "countdown" || m.phase === "round")
            ? chaosModifierFor(code, m.round)
            : "none";
        sim?.setEnv(env);
        scene.setEnv(env);
        scene.setKing(m.king ?? 0);
        updateMatchUI();
        // Bucks (design doc §18): cosmetic currency, awarded client-side only.
        if (
          (m.phase === "countdown" || m.phase === "round") &&
          m.round !== seenRound
        ) {
          seenRound = m.round;
          eliminatedThisRound = false;
        }
        if (
          (m.phase === "break" || m.phase === "match-end") &&
          m.round !== awardedRound
        ) {
          awardedRound = m.round;
          const iWon =
            m.winner === id ||
            (m.teams?.[String(id)] !== undefined &&
              m.teams[String(m.winner)] === m.teams[String(id)]);
          if (iWon) award(10, "round won");
          if (!eliminatedThisRound) award(2, "survived the round");
          if (m.phase === "match-end" && iWon) award(25, "match won");
        }
      }
      if (m.type === "sound") {
        const s =
          m.id === id
            ? local?.state
            : snapshots.at(-1)?.s.players.find((p) => p.id === m.id);
        if (s) voice.spatial?.effect(s, m.kind);
        if (m.kind === "honk" && m.object) scene.useProp(m.object, "horn");
      }
      if (m.type === "shot") {
        // The pellet itself rides the snapshot; a shove gun draws no tracer.
        if (m.id !== id) voice.spatial?.effect(m, "shoot");
        if (m.hit) {
          const struck =
            m.hit === id
              ? local?.state
              : snapshots.at(-1)?.s.players.find((p) => p.id === m.hit);
          if (struck) voice.spatial?.effect(sim!.eye(struck), "hit");
          if (m.hit === id) {
            $("hitflash").classList.add("on");
            clearTimeout(hitTimer);
            hitTimer = setTimeout(
              () => $("hitflash").classList.remove("on"),
              260,
            );
            shake = Math.max(shake, 0.45);
          }
        }
      }
      if (m.type === "swing") {
        scene.useProp(m.object, "bat");
        const swinger =
          m.id === id
            ? local?.state
            : snapshots.at(-1)?.s.players.find((p) => p.id === m.id);
        if (swinger) voice.spatial?.effect(sim!.eye(swinger), "swing");
        if (m.hit) {
          const struck =
            m.hit === id
              ? local?.state
              : snapshots.at(-1)?.s.players.find((p) => p.id === m.hit);
          if (struck) voice.spatial?.effect(sim!.eye(struck), "hit");
          if (m.hit === id) {
            $("hitflash").classList.add("on");
            clearTimeout(hitTimer);
            hitTimer = setTimeout(() => $("hitflash").classList.remove("on"), 260);
            shake = Math.max(shake, 0.45);
          }
        }
      }
      if (m.type === "door") {
        sim?.setDoor(m.id, m.open);
        const door = arena.doors.find((d) => d.id === m.id);
        if (door)
          voice.spatial?.effect(
            { x: door.p[0], y: door.p[1], z: door.p[2] },
            m.open ? "door" : "slam",
          );
      }
      if (m.type === "window" && m.broken) {
        sim?.setWindow(m.id, true);
        const win = arena.windows.find((w) => w.id === m.id);
        if (win) {
          scene.breakWindow(m.id);
          voice.spatial?.effect(
            { x: win.p[0], y: win.p[1], z: win.p[2] },
            "glass",
          );
        }
      }
      if (m.type === "explosion") {
        scene.boomAt(m.x, m.y, m.z);
        voice.spatial?.effect({ x: m.x, y: m.y, z: m.z }, "boom");
      }
      if (m.type === "impact") {
        for (const h of m.hits) {
          // The stronger the physics interaction, the bigger it sounds (§17).
          voice.spatial?.effect(
            { x: h.x, y: h.y, z: h.z },
            h.s < 0.25 ? "clack" : h.s < 0.6 ? "thud" : "crash",
            h.s,
          );
          scene.impactAt(h.x, h.y, h.z, h.s);
          if (local && h.s > 0.6) {
            const d = Math.hypot(
              local.state.x - h.x,
              local.state.y - h.y,
              local.state.z - h.z,
            );
            if (d < 7) shake = Math.max(shake, h.s * 0.5);
          }
        }
      }
      if (m.type === "cosmetics") {
        const c = sanitizeCosmetics(m.cosmetics);
        scene.setCosmetics(m.id, c);
        applyVoiceFx(m.id, c);
      }
      if (m.type === "emote") {
        // My own emote was already performed locally; ignore the echo.
        if (m.id !== id) scene.emote(m.id, m.emote);
      }
      if (m.type === "action-result" && !m.accepted)
        toast(
          ["shoot", "swing", "honk"].includes(m.action)
            ? "That item is not ready yet."
            : m.action === "door"
              ? "That door will not budge from here."
              : "That object is out of reach or already held.",
        );
      if (m.type === "error") {
        $("entry-error").textContent = m.message;
        $("entry-error").hidden = false;
        toast(m.message);
        $<HTMLButtonElement>("create").disabled = false;
        if (!connected) {
          intentional = true;
          sessionStorage.removeItem("friendslop:session");
          voice.disconnect();
          setPlaying(false);
          document.exitPointerLock();
        }
      }
    } catch (err) {
      console.error(err);
    }
  };
  channel.onclose = () => {
    if (socket !== channel) return;
    connected = false;
    keys.clear();
    voice.disconnect();
    $<HTMLButtonElement>("create").disabled = false;
    if (intentional) return;
    toast("Connection interrupted. Rejoining your room…");
    setTimeout(() => {
      if (!intentional && socket === channel) void connect();
    }, 1500);
  };
}
function snapshot(s: Snapshot) {
  if (!sim || !local) return;
  latestTick = s.tick;
  let props: PropState[];
  if (s.full) {
    baselines.set(s.baseline, s.props);
    baseline = s.baseline;
    while (baselines.size > 5) baselines.delete(baselines.keys().next().value!);
    props = s.props;
  } else {
    const base = baselines.get(s.baseline);
    if (!base) {
      baseline = 0;
      return;
    }
    const changes = new Map(s.props.map((p) => [p.id, p]));
    props = base.map((p) => changes.get(p.id) ?? p);
    for (const p of s.props) if (!base.some((q) => q.id === p.id)) props.push(p);
  }
  // Balls announce themselves: a reversal in the authoritative height is a bounce.
  for (const p of props) {
    if (kindOf(p.id) !== "ball") continue;
    const previous = ballHeights.get(p.id),
      dy = previous ? p.y - previous.y : 0;
    if (previous && !p.owner && previous.dy < -0.05 && dy > 0.015)
      voice.spatial?.effect(p, "bounce");
    ballHeights.set(p.id, { y: p.y, dy });
  }
  // Eliminations get a comedic reaction (design doc §17): a falling whistle
  // for whoever left the arena, a womp-womp for everyone else, plus a poof.
  for (const p of s.players) {
    const previous = outStates.get(p.id);
    if (previous && !previous.out && p.out) {
      voice.spatial?.reaction(
        { x: p.x, y: Math.max(p.y, 0.6), z: p.z },
        p.y < -4 ? "fall" : "womp",
      );
      scene.poofAt(p.x, Math.max(p.y, 0.6), p.z);
      if (p.id === id) {
        shake = Math.max(shake, 1);
        eliminatedThisRound = true;
      }
    }
    outStates.set(p.id, { out: p.out, hp: p.hp });
  }
  const prev = snapshots.at(-1)?.s.props;
  const full = { ...s, props };
  snapshots.push({ s: full, time: performance.now() });
  while (snapshots.length > 25) snapshots.shift();
  sim.syncProps(props);
  if (prev)
    for (const p of prev)
      if (p.id >= PELLET_ID_BASE && !props.some((q) => q.id === p.id))
        scene.pelletImpact(p);
  const own = s.players.find((p) => p.id === id);
  if (!own) return;
  const before = new THREE.Vector3(local.state.x, local.state.y, local.state.z);
  sim.restore(local, own);
  while (pending.length && pending[0].seq <= own.ack) pending.shift();
  for (const input of pending) {
    sim.motor(local, input);
    sim.step();
  }
  const after = new THREE.Vector3(local.state.x, local.state.y, local.state.z);
  correction = before.distanceTo(after);
  if (correction < 1) offset.add(before.sub(after));
  else offset.set(0, 0, 0);
  if (local.state.stagger > 0 && lastStagger === 0) {
    $("hitflash").classList.add("on");
    clearTimeout(hitTimer);
    hitTimer = setTimeout(() => $("hitflash").classList.remove("on"), 260);
  }
  lastStagger = local.state.stagger;
}
function interact(throwing = false) {
  if (!local || !sim) return;
  const s = local.state;
  if (!s.held && !sim.target(s)) {
    const door = sim.doorTarget(s);
    if (door && !arena.doors.find((d) => d.id === door)?.auto) {
      send({ type: "action", request: ++action, action: "door", object: door });
      return;
    }
  }
  send({
    type: "action",
    request: ++action,
    action: s.held ? (throwing ? "throw" : "drop") : "pickup",
    object: sim.target(s),
  });
}
/** Use the held tool immediately; the authority still decides hits and cooldowns. */
function fire() {
  if (!local || !sim) return;
  const held = local.state.held,
    kind = kindOf(held);
  if (kind !== "gun" && kind !== "bat" && kind !== "horn") return;
  const now = performance.now();
  const cooldown =
    (kind === "gun" ? WEAPON.cooldown : kind === "bat" ? MELEE.cooldown : HORN.cooldown) *
    STEP * 1000;
  if (now - lastUse < cooldown) return;
  lastUse = now;
  send({
    type: "action",
    request: ++action,
    action: kind === "gun" ? "shoot" : kind === "bat" ? "swing" : "honk",
  });
  if (kind !== "gun") {
    scene.useProp(held, kind);
    return;
  }
  const s = local.state,
    muzzle = scene.muzzle(held) ?? sim.muzzle(s);
  // The shove gun shows only the live pellet, which rides the snapshots;
  // scene.tracer is kept in the effects kit for a future laser weapon.
  if (local.state.ammo > 0 && performance.now() >= reloadUntil) {
    local.state.ammo--;
    scene.pelletGhost(muzzle);
    voice.spatial?.effect(muzzle, "shoot");
  } else {
    // Empty or mid-reload: a metallic click instead of the report.
    voice.spatial?.effect(muzzle, "clack");
  }
}
$("entry").addEventListener("submit", (e) => {
  e.preventDefault();
  void join("");
});
$("join").onclick = () => {
  const value = $<HTMLInputElement>("join-code").value.trim().toUpperCase();
  if (value.length !== 6) {
    $("entry-error").textContent = "Enter the six-character room code.";
    $("entry-error").hidden = false;
    return;
  }
  void join(value);
};
let previewControls = false;
const canvas = scene.renderer.domElement;
canvas.tabIndex = 0;
canvas.setAttribute("aria-label", "Game world — click to move, WASD and mouse");
function pauseControls() {
  previewControls = false;
  keys.clear();
  voice.setTalk(false);
  canvas.style.cursor = "";
  $("pause").hidden = false;
  document.exitPointerLock();
}
function previewFallback() {
  if (!connected) return;
  previewControls = true;
  canvas.focus({ preventScroll: true });
  canvas.style.cursor = "grab";
  $("pause").hidden = true;
  toast("Preview controls: WASD to move · drag to look · Esc to pause");
}
async function lock() {
  if (!connected) return;
  void voice.prepareAudio().catch(() => toast("Game audio could not start. Click the world to retry."));
  canvas.focus({ preventScroll: true });
  if (typeof canvas.requestPointerLock !== "function") {
    previewFallback();
    return;
  }
  try {
    await canvas.requestPointerLock();
  } catch {
    previewFallback();
  }
}
$("resume").onclick = () => void lock();
/**
 * The lobby's backdrop is a camera you can turn. Anywhere that is not a control is a drag
 * handle, and only before you join — once you are in a room the pointer belongs to the game.
 */
const CONTROLS = "input, button, select, textarea, a, .entry-card, .drawer";
let drag: { id: number; x: number; y: number; time: number } | undefined;
const inLobby = (e: PointerEvent) =>
  !connected && !(e.target as Element | null)?.closest?.(CONTROLS);
addEventListener("pointerdown", (e) => {
  if (e.button !== 0 || !inLobby(e)) return;
  // Claim the gesture so a drag that starts over the headline turns the room, not the text.
  e.preventDefault();
  drag = { id: e.pointerId, x: e.clientX, y: e.clientY, time: e.timeStamp };
  scene.grab();
  document.body.classList.add("turning");
});
addEventListener("pointermove", (e) => {
  if (!drag || e.pointerId !== drag.id) {
    if (!connected)
      scene.aim(
        (e.clientX / innerWidth) * 2 - 1,
        (e.clientY / innerHeight) * 2 - 1,
      );
    return;
  }
  if (!(e.buttons & 1)) return stopTurning();
  scene.orbitBy(
    e.clientX - drag.x,
    e.clientY - drag.y,
    (e.timeStamp - drag.time) / 1000,
  );
  drag = { id: drag.id, x: e.clientX, y: e.clientY, time: e.timeStamp };
});
function stopTurning() {
  if (!drag) return;
  drag = undefined;
  scene.letGo();
  document.body.classList.remove("turning");
}
// A button released outside the window never reaches us, so a move with nothing held ends it.
for (const end of ["pointerup", "pointercancel", "blur"])
  addEventListener(end, stopTurning);
addEventListener(
  "wheel",
  (e) => {
    if (!connected) scene.zoomBy(e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY);
  },
  { passive: true },
);
canvas.onclick = () => {
  if (connected && !document.pointerLockElement && !previewControls)
    void lock();
};
document.addEventListener("pointerlockchange", () => {
  if (document.pointerLockElement) {
    previewControls = false;
    $("pause").hidden = true;
  } else if (!previewControls &&
    !(match?.phase === "break" || match?.phase === "match-end")) {
    keys.clear();
    voice.setTalk(false);
    $("pause").hidden = false;
  }
});
addEventListener("mousemove", (e) => {
  if (document.pointerLockElement || (previewControls && e.buttons === 1)) {
    if (cameraMode === "third") {
      cameraYaw -= e.movementX * 0.002;
      cameraPitch = Math.max(
        -1.5,
        Math.min(1.5, cameraPitch + e.movementY * 0.002),
      );
    } else {
      yaw -= e.movementX * 0.002;
      pitch = Math.max(-1.5, Math.min(1.5, pitch + e.movementY * 0.002));
    }
  }
});
addEventListener("keydown", (e) => {
  if (
    e.target instanceof HTMLInputElement ||
    e.target instanceof HTMLSelectElement
  )
    return;
  if (e.code === "Escape" && previewControls) {
    pauseControls();
    return;
  }
  if (e.code === "KeyV") voice.setTalk(true);
  if (e.code === "KeyM" && !e.repeat) voice.setMuted(!voice.muted);
  if (
    !document.pointerLockElement &&
    !previewControls &&
    !(import.meta.env.DEV && params.has("test"))
  )
    return;
  if (e.code === "Tab") {
    e.preventDefault();
    if (!e.repeat) {
      cameraMode = cameraMode === "first" ? "third" : "first";
      if (cameraMode === "third") {
        cameraYaw = yaw;
        cameraPitch = pitch;
      } else {
        yaw = cameraYaw;
        pitch = cameraPitch;
        scene.removePlayer(id);
      }
      toast(cameraMode === "third" ? "Third-person view" : "First-person view");
    }
    return;
  }
  keys.add(e.code);
  if (["Space", "ControlLeft", "Tab"].includes(e.code)) e.preventDefault();
  if (!e.repeat && e.code === "KeyE") interact();
  if (!e.repeat && e.code === "KeyQ") interact(true);
  if (!e.repeat && e.code === "KeyF") fire();
  if (!e.repeat && e.code === "KeyR") {
    send({ type: "action", request: ++action, action: "reload" });
    reloadUntil =
      performance.now() + buildStats(local?.state.build ?? 0).reloadTicks * STEP * 1000;
  }
  // Emotes ride Digit1..4, bound to whatever is equipped in the locker.
  if (!e.repeat && e.code.startsWith("Digit")) {
    const emoteId = locker.equipped.emotes[Number(e.code.slice(5)) - 1];
    if (emoteId) {
      scene.emote(id, emoteId);
      send({ type: "emote", emote: emoteId });
    }
  }
});
// A right-click arms the shield exactly once: the next input packet carries
// the raise, and the authority decides everything else about it.
let blockArmed = false;
addEventListener("mousedown", (e) => {
  if (e.button === 0 && connected && document.pointerLockElement) fire();
  else if (e.button === 2 && connected && document.pointerLockElement)
    blockArmed = true;
});
addEventListener("keyup", (e) => {
  keys.delete(e.code);
  if (e.code === "KeyV") voice.setTalk(false);
});
addEventListener("blur", () => {
  keys.clear();
  voice.setTalk(false);
});
$("enable-voice").onclick = () =>
  void voice.enable().then(() => {
    if (voice.status.startsWith("Audio unavailable")) toast(voice.status);
  });
$("mute").onclick = () => voice.setMuted(!voice.muted);
$("voice-mode").onchange = () =>
  voice.setMode($<HTMLSelectElement>("voice-mode").value as "open" | "ptt");
$("ready-button").onclick = () => {
  if (!connected) return;
  send({ type: "ready", active: !(match?.ready.includes(id)) });
};
$("mode-select").onchange = () => {
  if (!connected) return;
  send({ type: "mode", mode: $<HTMLSelectElement>("mode-select").value });
};
for (const name of ["friends", "debug", "help", "about", "locker"]) {
  $(`${name}-button`).onclick = () => {
    const open = $(name).hidden;
    for (const n of ["friends", "debug", "help", "about", "locker"])
      $(n).hidden = true;
    $(name).hidden = !open;
    if (name === "locker") renderShop();
    pauseControls();
  };
}
document
  .querySelectorAll<HTMLElement>("[data-close]")
  .forEach((b) => (b.onclick = () => ($(b.dataset.close!).hidden = true)));
$("copy-room").onclick = async () => {
  try {
    await navigator.clipboard.writeText(
      new URL(`?room=${code}`, document.baseURI).href,
    );
    toast("Invite link copied. Bring your people.");
  } catch {
    toast(`Your room code is ${code}`);
  }
};
$("solo-tab").onclick = () =>
  window.open(
    new URL(
      `?room=${code}&name=Guest%20${members.length + 1}&fresh=1`,
      document.baseURI,
    ).href,
    "_blank",
    "noopener",
  );
$("leave").onclick = () => {
  intentional = true;
  send({ type: "leave" });
  socket?.close();
  hosting?.dispose();
  hosting = undefined;
  rooms?.dispose();
  rooms = undefined;
  code = "";
  voice.disconnect();
  connected = false;
  cameraMode = "first";
  sessionStorage.removeItem("friendslop:session");
  pauseControls();
  for (const [pid] of scene.avatars) if (pid < 60000) scene.removePlayer(pid);
  sim?.dispose();
  sim = undefined;
  local = undefined;
  setPlaying(false);
  $("friends").hidden = true;
};
function renderMembers() {
  const list = $("member-list");
  list.replaceChildren();
  for (const m of members) {
    const row = document.createElement("div");
    row.className = "member";
    const dot = document.createElement("i");
    dot.className = "member-dot";
    dot.style.background = CHARACTER_PALETTE[m.color];
    const info = document.createElement("div"),
      label = document.createElement("div"),
      status = document.createElement("small");
    label.textContent = m.name + (m.id === id ? " (you)" : "");
    const team = match?.teams?.[String(m.id)];
    if (team !== undefined) {
      const badge = document.createElement("span");
      badge.className = "team-badge";
      badge.textContent = team === 0 ? "A" : "B";
      label.append(badge);
    }
    status.textContent = !m.connected
      ? "Reconnecting…"
      : m.voiceReady
        ? "Voice enabled"
        : "Exploring quietly";
    info.append(label, status);
    row.append(dot, info);
    list.append(row);
  }
}
/** The locker shop: buy once with Bucks, equip and unequip freely. */
function renderShop() {
  const sections = [
    ["shop-skins", SKINS, "skin"],
    ["shop-hats", HATS, "hat"],
    ["shop-emotes", EMOTES, "emote"],
    ["shop-voice", VOICE_EFFECTS, "voice"],
  ] as const;
  for (const [elId, items, kind] of sections) {
    const el = $(elId);
    while (el.children.length > 1) el.lastElementChild!.remove();
    for (const item of items) {
      const owned = locker.owned.includes(item.id);
      const equipped =
        kind === "skin"
          ? locker.equipped.skin === item.id
          : kind === "hat"
            ? locker.equipped.hat === item.id
            : kind === "voice"
              ? locker.equipped.voice === item.id
              : locker.equipped.emotes.includes(item.id);
      const row = document.createElement("div");
      row.className = "shop-row" + (equipped ? " equipped" : "");
      const label = document.createElement("span");
      label.textContent = item.name;
      const btn = document.createElement("button");
      if (!owned) {
        btn.textContent = `💰 ${item.price}`;
        btn.disabled = locker.bucks < item.price;
        btn.onclick = () => {
          if (locker.bucks < item.price) return;
          locker.bucks -= item.price;
          locker.owned.push(item.id);
          equip(kind, item.id);
        };
      } else if (equipped) {
        btn.textContent = kind === "skin" ? "Wearing" : kind === "emote" ? "Bound" : "On";
        btn.onclick = () => unequip(kind, item.id);
      } else {
        btn.textContent = kind === "emote" ? "Bind 1–4" : "Equip";
        btn.onclick = () => equip(kind, item.id);
      }
      row.append(label, btn);
      el.append(row);
    }
  }
}
function equip(kind: string, itemId: string) {
  if (kind === "skin") locker.equipped.skin = itemId;
  else if (kind === "hat") locker.equipped.hat = itemId;
  else if (kind === "voice") locker.equipped.voice = itemId;
  else {
    if (locker.equipped.emotes.length >= MAX_EMOTE_SLOTS) {
      toast(`Emote slots are full (keys 1–${MAX_EMOTE_SLOTS}).`);
      return;
    }
    locker.equipped.emotes.push(itemId);
  }
  saveLocker();
  send({ type: "cosmetics", cosmetics: locker.equipped });
}
function unequip(kind: string, itemId: string) {
  if (kind === "skin") locker.equipped.skin = "classic";
  else if (kind === "hat") locker.equipped.hat = null;
  else if (kind === "voice") locker.equipped.voice = null;
  else
    locker.equipped.emotes = locker.equipped.emotes.filter((e) => e !== itemId);
  saveLocker();
  send({ type: "cosmetics", cosmetics: locker.equipped });
}
/** Apply a peer's equipped voice effect, or clear it when none is worn. */
function applyVoiceFx(pid: number, c: Cosmetics) {
  const fx = VOICE_EFFECTS.find((v) => v.id === c.voice);
  if (fx) voice.setFx(pid, fx.rate, fx.radio);
  else voice.setFx(pid);
}
/** Where you are, in the words the HUD uses. Mirrors the arena layout. */
function zone(s: { x: number; y: number; z: number }): [string, string] {
  const m = Math.max(Math.abs(s.x), Math.abs(s.z));
  if (s.y > 2.4) return ["The perches", "UP HIGH · NO HANDHOLDING"];
  if (m >= 7) return ["The satellites", "OUT ON A LIMB · MIND THE EDGE"];
  return [
    arena.name,
    arena === DEFAULT_ARENA ? "CENTER RING · OPEN SKY" : "HELD BY CODE · MIND THE VOID",
  ];
}
let debugTime = 0;
function debug(now: number) {
  if (now - debugTime < 500) return;
  debugTime = now;
  $("metrics").innerHTML =
    `<div>ROUND TRIP<strong>${ping} <small>ms</small></strong></div><div>SERVER TICK<strong>${tickRate.toFixed(0)} <small>Hz</small></strong></div><div>TICK WORK<strong>${tickCost.toFixed(1)} <small>ms</small></strong></div><div>CORRECTION<strong>${(correction * 100).toFixed(1)} <small>cm</small></strong></div><div>GAME PACKETS<strong>${tx} ↑ ${rx} ↓</strong></div><div>VOICE PACKETS<strong>${voice.sent} ↑ ${voice.received} ↓</strong></div>`;
  $("codec-status").textContent =
    `${voice.codec} · ${voice.dropped} expired frames · ${voice.status}`;
  const peers = $("peer-debug");
  peers.replaceChildren();
  for (const p of voice.peers.values()) {
    const row = document.createElement("div");
    row.className = "debug-peer";
    const title = document.createElement("b");
    title.textContent =
      members.find((m) => m.id === p.id)?.name ?? `Player ${p.id}`;
    const button = document.createElement("button");
    button.textContent = p.forced ? "Allow P2P" : "Force relay";
    button.onclick = () => voice.force(p.id, !p.forced);
    const text = document.createElement("div");
    text.textContent = `${p.relay ? "Relayed" : "P2P"} · ${p.state}`;
    const detail = document.createElement("small");
    detail.textContent = `${p.bufferMs.toFixed(0)} ms buffered · ${p.packets} RTP packets · ${p.reason}`;
    row.append(button, title, text, detail);
    peers.append(row);
  }
}
function updateMatchUI() {
  if (!match) {
    if (matchUi !== "") {
      matchUi = "";
      $("countdown").hidden = true;
      $("round-banner").hidden = true;
      $("match-timer").textContent = "";
    }
    return;
  }
  const seconds = Math.max(0, match.until - latestTick);
  const ready = match.ready.includes(id);
  const mine =
    match.phase === "break"
      ? (match.offers?.find((o) => o.id === id)?.cards ?? [])
      : [];
  const buildTaken = mine.filter(
    (c) => (local?.state.build ?? 0) & cardBit(c),
  ).length;
  const key = [
    match.phase,
    match.round,
    seconds | 0,
    ready,
    match.winner,
    mine.join(","),
    buildTaken,
    match.mode ?? "",
    JSON.stringify(match.teams ?? {}),
    match.king ?? 0,
    match.modifier ?? "",
  ].join("|");
  if (key === matchUi) return;
  matchUi = key;
  renderMembers(); // Team badges ride the match state, not just member changes.
  $("ready-button").textContent = ready ? "Ready ✓" : "Ready up";
  // The mode is picked in the lobby only; after that the select hides.
  const select = $("mode-select") as HTMLSelectElement;
  if (match.phase === "lobby") {
    select.hidden = false;
    select.value = match.mode ?? "ffa";
  } else select.hidden = true;
  if (match.phase === "countdown") {
    $("countdown").hidden = false;
    $("countdown").textContent = String(Math.ceil(seconds / 60));
  } else $("countdown").hidden = true;
  const winnerId = match.winner;
  const name = members.find((m) => m.id === winnerId)?.name;
  const teams = match.teams;
  const kingId = match.king ?? 0;
  const teamName = (pid: number) => {
    const t = teams?.[String(pid)];
    return t === 0 ? "Team One" : t === 1 ? "Team Two" : null;
  };
  if (match.phase === "break") {
    $("round-banner").hidden = false;
    $("round-banner").textContent = `Round ${match.round - 1} — ${teamName(winnerId) ?? name ?? "Nobody"}`;
    const cardsEl = $("build-cards");
    cardsEl.innerHTML = "";
    for (const cardId of mine) {
      const card = CARDS.find((c) => c.id === cardId);
      if (!card) continue;
      const taken = !!((local?.state.build ?? 0) & cardBit(cardId));
      const b = document.createElement("button");
      b.className = "build-card" + (taken ? " taken" : "");
      const t = document.createElement("b");
      t.textContent = card.name;
      const p = document.createElement("p");
      p.textContent = card.blurb;
      b.append(t, p);
      if (!taken) b.onclick = () => send({ type: "pick", card: cardId });
      cardsEl.append(b);
    }
    $("build").hidden = false;
  } else {
    $("build").hidden = true;
  }
  if (match.phase === "match-end") {
    $("round-banner").hidden = false;
    $("round-banner").textContent = `${teamName(winnerId) ?? name ?? "Nobody"} wins the match`;
  } else if (match.phase === "round" && match.mode === "king" && match.king) {
    // King of the Yard: the crown is on display for the whole round.
    $("round-banner").hidden = false;
    $("round-banner").textContent = `👑 ${members.find((m) => m.id === kingId)?.name ?? "Nobody"} is the King`;
  } else if (
    (match.phase === "countdown" || match.phase === "round") &&
    match.mode === "chaos" &&
    match.modifier
  ) {
    $("round-banner").hidden = false;
    $("round-banner").textContent = `⚡ ${modifierName(match.modifier)}`;
  } else if (match.phase !== "break") $("round-banner").hidden = true;
  $("match-timer").textContent =
    match.phase === "round"
      ? `R${match.round}/${match.rounds} · ${Math.ceil(seconds / 60)}s`
      : match.phase === "countdown"
        ? "Get ready"
        : match.phase === "break"
          ? `BUILD · ${Math.ceil(seconds / 60)}s`
          : "";
}
function frame(now: number) {
  const dt = Math.min(0.08, (now - last) / 1000);
  last = now;
  acc += dt;
  if (connected && sim && local) {
    let steps = 0;
    while (acc >= STEP && steps++ < 5) {
      acc -= STEP;
      if (
        cameraMode === "third" &&
        ["KeyW", "KeyA", "KeyS", "KeyD"].some((key) => keys.has(key))
      ) {
        yaw = cameraYaw;
        pitch = cameraPitch;
      }
      const input: Input = {
        seq: ++seq,
        x: Number(keys.has("KeyD")) - Number(keys.has("KeyA")),
        z: Number(keys.has("KeyW")) - Number(keys.has("KeyS")),
        yaw,
        pitch,
        buttons:
          (keys.has("Space") ? BUTTON.JUMP : 0) |
          (keys.has("ShiftLeft") || keys.has("ShiftRight")
            ? BUTTON.SPRINT
            : 0) |
          (keys.has("ControlLeft") || keys.has("KeyC") ? BUTTON.CROUCH : 0) |
          (keys.has("KeyB") ? BUTTON.DASH : 0) |
          (blockArmed ? BUTTON.BLOCK : 0),
      };
      blockArmed = false;
      pending.push(input);
      outgoing.push(input);
      sim.motor(local, input);
      sim.step();
      if (pending.length > 120) pending.shift();
      if (outgoing.length >= 2 && socket?.open) {
        socket.send(encodeInputs(outgoing.splice(0), baseline));
        tx++;
      }
    }
    offset.multiplyScalar(Math.exp(-dt * 16));
    // Hit feedback: a decaying camera shake on hits and nearby big impacts.
    shake *= Math.exp(-dt * 7);
    const jx = (Math.random() - 0.5) * shake * 0.22,
      jy = (Math.random() - 0.5) * shake * 0.22,
      jz = (Math.random() - 0.5) * shake * 0.22;
    const s = local.state,
      eye = sim.eye(s);
    const gunHeld = kindOf(s.held) === "gun";
    $("ammo").hidden = !gunHeld;
    if (gunHeld)
      $("ammo").textContent = s.ammo > 0 ? String(s.ammo) : "RELOADING";
    // The bubble is on the avatar — invisible from the default first-person
    // seat — so the HUD carries the state: full green bar while it is up,
    // amber progress while the cooldown behind it recharges.
    const gauge = $("shield-gauge");
    if (s.block > 0) {
      gauge.hidden = false;
      gauge.className = "shield-gauge up";
      gauge.style.setProperty("--fill", "100%");
    } else if (s.cool > 0) {
      gauge.hidden = false;
      gauge.className = "shield-gauge";
      gauge.style.setProperty(
        "--fill",
        `${((COMBAT.blockCooldown - s.cool) / COMBAT.blockCooldown) * 100}%`,
      );
    } else {
      gauge.hidden = true;
    }
    movementSounds.update(s, now);
    if (cameraMode === "third") {
      scene.updatePlayer(
        s,
        name,
        dt,
        members.find((m) => m.id === id)?.color,
        false,
      );
      scene.thirdPersonCamera(
        { x: s.x + offset.x + jx, y: s.y + offset.y + jy, z: s.z + offset.z + jz },
        cameraYaw,
        cameraPitch,
      );
    } else {
      scene.camera.position.set(
        eye.x + offset.x + jx,
        eye.y + offset.y + jy,
        eye.z + offset.z + jz,
      );
      scene.camera.rotation.set(-pitch, yaw, 0, "YXZ");
    }
    const targetTime = now - 100;
    let a = snapshots[0],
      b = snapshots.at(-1);
    for (let i = 1; i < snapshots.length; i++) {
      if (snapshots[i].time >= targetTime) {
        a = snapshots[i - 1];
        b = snapshots[i];
        break;
      }
    }
    if (a && b) {
      const t = Math.max(
        0,
        Math.min(1, (targetTime - a.time) / Math.max(1, b.time - a.time)),
      );
      for (const remote of b.s.players) {
        if (remote.id === id) continue;
        const prev = a.s.players.find((p) => p.id === remote.id) ?? remote;
        const r = {
          ...remote,
          x: THREE.MathUtils.lerp(prev.x, remote.x, t),
          y: THREE.MathUtils.lerp(prev.y, remote.y, t),
          z: THREE.MathUtils.lerp(prev.z, remote.z, t),
          yaw:
            prev.yaw +
            Math.atan2(
              Math.sin(remote.yaw - prev.yaw),
              Math.cos(remote.yaw - prev.yaw),
            ) *
              t,
          pitch: THREE.MathUtils.lerp(prev.pitch, remote.pitch, t),
        };
        scene.updatePlayer(
          r,
          members.find((m) => m.id === r.id)?.name ?? "Guest",
          dt,
          members.find((m) => m.id === r.id)?.color,
        );
        scene.setMouth(r.id, voice.loudness(r.id));
        voice.updatePosition(r.id, { x: r.x, y: r.y + 0.65, z: r.z });
        movementSounds.update(r, now);
      }
      const props = b.s.props.map((p) => {
        if (p.owner === id)
          return sim!.propStates().find((x) => x.id === p.id) ?? p;
        const prev = a.s.props.find((x) => x.id === p.id) ?? p;
        const q = new THREE.Quaternion(prev.qx, prev.qy, prev.qz, prev.qw)
          .normalize()
          .slerp(new THREE.Quaternion(p.qx, p.qy, p.qz, p.qw).normalize(), t);
        return {
          ...p,
          x: THREE.MathUtils.lerp(prev.x, p.x, t),
          y: THREE.MathUtils.lerp(prev.y, p.y, t),
          z: THREE.MathUtils.lerp(prev.z, p.z, t),
          qx: q.x,
          qy: q.y,
          qz: q.z,
          qw: q.w,
        };
      });
      scene.updateProps(
        props,
        new Map<number, number>(b.s.players.map((p) => [p.id, p.build])),
      );
    }
    scene.updateDoors(sim.doorStates());
    scene.updateWindows(sim.windowStates());
    const target = s.held ? 0 : sim.target(s);
    const door = s.held || target ? 0 : sim.doorTarget(s);
    scene.setHighlight(target);
    $("crosshair").classList.toggle("target", !!target || !!door);
    $("crosshair").classList.toggle(
      "armed",
      ["gun", "bat", "horn"].includes(kindOf(s.held) ?? ""),
    );
    $("interact").hidden =
      (!target && !door && !s.held) ||
      (!document.pointerLockElement && !previewControls);
    $("interact").innerHTML = s.held
      ? `<kbd class="key">E</kbd> Drop <span style="margin-left:10px"><kbd class="key">Q</kbd> Throw</span>${
          ["gun", "bat", "horn"].includes(kindOf(s.held) ?? "")
            ? `<span style="margin-left:10px"><kbd class="key">Click</kbd> ${
                kindOf(s.held) === "gun"
                  ? "Fire"
                  : kindOf(s.held) === "bat"
                    ? "Swing"
                    : "Honk"
              }</span>`
            : ""
        }`
      : door
        ? arena.doors.find((d) => d.id === door)?.auto
          ? "Opens by itself"
          : `<kbd class="key">E</kbd> ${arena.doors.find((d) => d.id === door)!.zone}`
        : `<kbd class="key">E</kbd> Pick up the ${kindOf(target) ?? "thing"}`;
    const [zoneName, zoneDesc] = zone(s);
    $("zone-name").textContent = zoneName;
    $("zone-desc").textContent = zoneDesc;
    voice.spatial?.update(
      scene.camera.position,
      cameraMode === "third" ? cameraYaw : yaw,
      cameraMode === "third" ? cameraPitch : pitch,
    );
    updateMatchUI();
  } else {
    acc = 0;
    scene.overview(dt);
  }
  scene.render(dt);
  debug(now);
  requestAnimationFrame(frame);
}
try {
  await Promise.all([initPhysics(), scene.loaded, networkReady]);
  $("loading").hidden = true;
  // The copy is held back until the world behind it is ready, then arrives with the camera.
  document.body.classList.add("ready");
  requestAnimationFrame(frame);
} catch (e) {
  $("loading").textContent = `Could not open the room: ${String(e)}`;
  console.error(e);
}
setInterval(() => {
  if (connected) send({ type: "ping", time: performance.now() });
}, 1000);
addEventListener("beforeunload", () => voice.dispose());
