import { type Channel, type ChannelKind, safeToken, randomHex, roomCode } from "../net/channel.js";
import { initPhysics, Simulation } from "../shared/simulation.js";
import {
  decodeInputs,
  encodeSnapshot,
  changedProp,
  readVoice,
  type Input,
  type PropState,
} from "../shared/protocol.js";
import { MAX_PLAYERS, STEP } from "../shared/level.js";
import { buildArena } from "../shared/arena.js";
import {
  MATCH,
  assignTeams,
  chaosModifierFor,
  isMode,
  teamSize,
} from "../shared/match.js";
import { IMPLEMENTED_CARDS, cardBit } from "../shared/upgrades.js";
import {
  type Cosmetics,
  DEFAULT_COSMETICS,
  EMOTES,
  sanitizeCosmetics,
} from "../shared/cosmetics.js";
/** Ticks per phase: a 3 s countdown; the build phase runs on MATCH. */
const COUNTDOWN_TICKS = 180;
type Member = {
  id: number;
  name: string;
  color: number;
  token: string;
  ticket: string;
  ws: Channel | null;
  voice: Channel | null;
  queue: Input[];
  last: Input;
  lastInput: number;
  expires: number;
  baseline: number;
  voiceReady: boolean;
  actions: Set<number>;
  speaking: boolean;
  ready: boolean;
  /** Bitmask of the upgrade cards this player stacked this match. */
  build: number;
  /** The card ids dealt during the current break (build phase). */
  offer: string[];
  /** Equipped cosmetics, validated against the shared catalogue. */
  cosmetics: Cosmetics;
  /** Date.now() of the last emote this member performed (rate limit). */
  lastEmote: number;
};
type MatchPhase = "lobby" | "countdown" | "round" | "break" | "match-end";
/** The room's match flow. `until` is the tick the phase ends at, if any. */
type Match = {
  phase: MatchPhase;
  round: number;
  until: number;
  winner: number;
};
type Pair = {
  a: number;
  b: number;
  relay: boolean;
  epoch: number;
  ready: Set<number>;
  reason: string;
  linger: number;
  forced: boolean;
};
type Room = {
  code: string;
  sim: Simulation;
  members: Map<number, Member>;
  nextId: number;
  host: number;
  tick: number;
  keyframes: Map<number, PropState[]>;
  pairs: Map<string, Pair>;
  match: Match;
  /** The lobby-picked game mode (design doc §13). */
  mode: string;
  /** Team modes: member id → 0/1. Empty for the other modes. */
  teams: Map<number, 0 | 1>;
  /** King of the Yard: 0 until drawn, re-drawn if the king leaves. */
  king: number;
  /** Team modes' per-team round wins, for the match-end tally. */
  teamWins: [number, number];
  wins: Map<number, number>;
  emptySince: number;
};
const key = (a: number, b: number) => [a, b].sort((x, y) => x - y).join(":");
const send = (ws: Channel | null, data: unknown) => {
  if (ws?.open && ws.bufferedAmount < 128 * 1024)
    ws.send(typeof data === "string" ? data : JSON.stringify(data));
};
export async function createHost(options: { maxRooms?: number } = {}) {
  await initPhysics();
  const rooms = new Map<string, Room>();
  const channels = new Set<Channel>();
  const lastMessages = new Map<Channel, number>();
  let disposed = false;
  function accept(ws: Channel, kind: ChannelKind) {
    if (disposed) { ws.close(1012, "Host closed"); return; }
    channels.add(ws);
    if (kind === "game") acceptGame(ws);
    else acceptVoice(ws);
  }
  function broadcast(r: Room, data: unknown) {
    for (const m of r.members.values()) send(m.ws, data);
  }
  function membership(r: Room) {
    broadcast(r, {
      type: "members",
      host: r.host,
      members: [...r.members.values()].map((m) => ({
        id: m.id,
        name: m.name,
        color: m.color,
        connected: !!m.ws,
        voiceReady: m.voiceReady,
        cosmetics: m.cosmetics,
      })),
    });
  }
  /** The match state as clients render it; they derive the clock from ticks. */
  function matchInfo(r: Room) {
    return {
      type: "match" as const,
      phase: r.match.phase,
      round: r.match.round,
      rounds: MATCH.rounds,
      until: r.match.until,
      ready: [...r.members.values()]
        .filter((m) => m.ready)
        .map((m) => m.id),
      winner: r.match.winner,
      mode: r.mode,
      teams: r.mode.startsWith("teams-")
        ? Object.fromEntries(
            [...r.teams.entries()].map(([id, t]) => [String(id), t]),
          )
        : undefined,
      king: r.king || undefined,
      modifier: r.sim.env === "none" ? undefined : r.sim.env,
      offers:
        r.match.phase === "break"
          ? [...r.members.values()]
              .filter((m) => m.ws)
              .map((m) => ({ id: m.id, cards: m.offer }))
          : undefined,
    };
  }
  /** Deal each connected member three cards they don't already own. */
  function dealOffers(r: Room) {
    const pool = [...IMPLEMENTED_CARDS];
    for (const m of r.members.values()) {
      if (!m.ws) continue;
      const owned = new Set(pool.filter((id) => m.build & cardBit(id)));
      const cards: string[] = [];
      while (
        cards.length < MATCH.cardsOffered &&
        owned.size + cards.length < pool.length
      ) {
        const id = pool[Math.floor(Math.random() * pool.length)];
        if (owned.has(id) || cards.includes(id)) continue;
        cards.push(id);
      }
      m.offer = cards;
    }
  }
  /** The env modifier active during this round; both sides derive it. */
  function envFor(r: Room) {
    return r.mode === "chaos" ? chaosModifierFor(r.code, r.match.round) : "none";
  }
  function startCountdown(r: Room) {
    r.sim.respawn();
    // Chaos rolls its per-round env modifier; every other mode resets it.
    r.sim.setEnv(envFor(r));
    r.match.phase = "countdown";
    r.match.until = r.tick + COUNTDOWN_TICKS;
    r.match.winner = 0;
    broadcast(r, matchInfo(r));
  }
  function beginRound(r: Room) {
    r.sim.setEnv(envFor(r));
    r.match.phase = "round";
    r.match.until = r.tick + MATCH.roundTicks;
    broadcast(r, matchInfo(r));
  }
  function endRound(r: Room) {
    const alive = [...r.sim.players.values()].filter((c) => !c.state.out);
    if (r.mode === "king") {
      // Only the crown scores: the king wins by surviving, death loses it.
      r.match.winner = !r.sim.players.get(r.king)?.state.out ? r.king : 0;
      if (r.match.winner)
        r.wins.set(r.match.winner, (r.wins.get(r.match.winner) ?? 0) + 1);
    } else if (r.mode.startsWith("teams-")) {
      // Teams share the round: more survivors, then more HP, then lower id.
      const tally = ([0, 1] as const).map((t) => {
        let n = 0, hp = 0, min = Infinity;
        for (const c of alive) {
          if (r.teams.get(c.state.id) !== t) continue;
          n++;
          hp += c.state.hp;
          min = Math.min(min, c.state.id);
        }
        return { n, hp, min };
      });
      const w =
        tally[0].n || tally[1].n
          ? tally[0].n === tally[1].n
            ? tally[0].hp === tally[1].hp
              ? (tally[0].min <= tally[1].min ? 0 : 1)
              : tally[0].hp > tally[1].hp ? 0 : 1
            : tally[0].n > tally[1].n ? 0 : 1
          : -1;
      if (w < 0) {
        r.match.winner = 0;
      } else {
        r.teamWins[w as 0 | 1]++;
        for (const [id, team] of r.teams) {
          if (team !== w) continue;
          r.wins.set(id, (r.wins.get(id) ?? 0) + 1);
        }
        // The round's "winner" is the team's lowest id: clients name the team.
        r.match.winner = Math.min(
          ...[...r.teams.entries()]
            .filter(([, t]) => t === w)
            .map(([id]) => id),
        );
      }
    } else {
      // A timeout can leave several standing: the healthiest of them wins.
      r.match.winner = alive.length
        ? alive.reduce((a, b) =>
            b.state.hp > a.state.hp ||
            (b.state.hp === a.state.hp && b.state.id < a.state.id)
              ? b
              : a
          ).state.id
        : 0;
      if (r.match.winner)
        r.wins.set(r.match.winner, (r.wins.get(r.match.winner) ?? 0) + 1);
    }
    // The round is over: everyone goes inert until the next respawn.
    for (const c of r.sim.players.values()) c.state.out = 1;
    if (r.match.round >= MATCH.rounds) {
      let overall = 0,
        top = -1;
      if (r.mode.startsWith("teams-")) {
        // Team modes tally the shared wins; a tie is nobody's.
        if (r.teamWins[0] === r.teamWins[1]) overall = 0;
        else {
          const t = r.teamWins[0] > r.teamWins[1] ? 0 : 1;
          for (const [id, team] of r.teams) {
            if (team !== t) continue;
            overall = id;
            break;
          }
        }
      } else {
        // Most round wins takes the match; a tie goes to the lower id.
        for (const [id, w] of r.wins)
          if (w > top || (w === top && id < overall)) {
            top = w;
            overall = id;
          }
      }
      r.match.phase = "match-end";
      r.match.until = 0;
      r.match.winner = overall;
    } else {
      // Build phase: everyone picks a card before the next round starts.
      r.match.round++;
      r.match.phase = "break";
      r.match.until = r.tick + MATCH.buildPhaseTicks;
      dealOffers(r);
    }
    broadcast(r, matchInfo(r));
  }
  function pair(r: Room, a: number, b: number) {
    const k = key(a, b);
    let p = r.pairs.get(k);
    if (!p) {
      p = {
        a: Math.min(a, b),
        b: Math.max(a, b),
        relay: false,
        epoch: 0,
        ready: new Set(),
        reason: "Connecting",
        linger: 0,
        forced: false,
      };
      r.pairs.set(k, p);
    }
    return p;
  }
  function route(r: Room, p: Pair, relay: boolean, reason: string) {
    p.epoch++;
    p.relay = relay;
    p.reason = reason;
    p.ready.clear();
    p.linger = relay ? 0 : Date.now() + 1000;
    for (const id of [p.a, p.b])
      send(r.members.get(id)?.ws ?? null, {
        type: "route",
        peer: id === p.a ? p.b : p.a,
        relay,
        epoch: p.epoch,
        reason,
        forced: p.forced,
      });
  }
  function retire(r: Room, m: Member, remove = false) {
    m.ws = null;
    m.voice?.close();
    m.voice = null;
    m.voiceReady = false;
    m.queue = [];
    m.last = { ...m.last, x: 0, z: 0, buttons: 0 };
    m.expires = Date.now() + (remove ? 0 : 30000);
    r.sim.release(m.id);
    for (const [k, p] of r.pairs) {
      if (p.a === m.id || p.b === m.id) r.pairs.delete(k);
    }
    // The crown cannot leave the table: redraw for the next seat.
    if (r.mode === "king" && r.king === m.id && r.match.phase !== "lobby") {
      const rest = [...r.members.values()].filter((x) => x.ws);
      r.king = rest.length
        ? rest[Math.floor(Math.random() * rest.length)].id
        : 0;
      broadcast(r, matchInfo(r));
    }
    if (r.host === m.id)
      r.host = [...r.members.values()].find((x) => x.ws)?.id ?? m.id;
    membership(r);
  }
  /** Create a room under a known code, or return the existing one. A browser
   *  host needs this because the broker decides the code before anyone joins. */
  function ensureRoom(code: string) {
    let room = rooms.get(code);
    if (!room) {
      room = {
        code,
        sim: new Simulation(false, buildArena(code)),
        members: new Map(),
        nextId: 1,
        host: 1,
        tick: 0,
        keyframes: new Map(),
        pairs: new Map(),
        match: { phase: "lobby", round: 1, until: 0, winner: 0 },
        mode: "ffa",
        teams: new Map(),
        king: 0,
        teamWins: [0, 0],
        wins: new Map(),
        emptySince: 0,
      };
      rooms.set(code, room);
    }
    return room;
  }
  function acceptGame(ws: Channel) {
    lastMessages.set(ws, Date.now());
    let room: Room | undefined, member: Member | undefined;
    let rate = 0,
      rateTime = Date.now();
    const deadline = setTimeout(() => {
      if (!member) ws.close(1008, "Join required");
    }, 10000);
    ws.onmessage = (raw) => {
      lastMessages.set(ws, Date.now());
      const isBinary = typeof raw !== "string";
      try {
        if (Date.now() - rateTime > 1000) {
          rateTime = Date.now();
          rate = 0;
        }
        if (++rate > 160) throw Error("Rate limit");
        if (isBinary) {
          if (!room || !member) throw Error("Join first");
          const { inputs, baseline } = decodeInputs(
            raw as ArrayBuffer,
          );
          member.baseline = room.keyframes.has(baseline) ? baseline : 0;
          for (const input of inputs) {
            if (
              input.seq <= member.last.seq ||
              member.queue.some((i) => i.seq === input.seq)
            )
              continue;
            if (input.seq > member.last.seq + 240)
              throw Error("Input sequence too far ahead");
            if (member.queue.length < 12) member.queue.push(input);
          }
          member.lastInput = Date.now();
          return;
        }
        const msg = JSON.parse(raw as string);
        if (!msg || typeof msg.type !== "string") throw Error("Bad message");
        if (!member) {
          if (msg.type !== "join") throw Error("Join first");
          if (rooms.size >= (options.maxRooms ?? 16) && !msg.code)
            throw Error("Server full");
          const code =
            typeof msg.code === "string"
              ? msg.code
                  .toUpperCase()
                  .replace(/[^A-Z2-9]/g, "")
                  .slice(0, 6)
              : "";
          room = rooms.get(code);
          if (code && !room)
            throw Error("Room not found. Create a fresh room.");
          if (!room) {
            let next = "";
            do {
              next = roomCode();
            } while (rooms.has(next));
            room = ensureRoom(next);
          }
          if (typeof msg.token === "string" && msg.token.length < 128)
            member = [...room.members.values()].find((m) =>
              safeToken(m.token, msg.token),
            );
          if (member) {
            const old = member.ws;
            member.ws = ws;
            old?.close(4001, "Reconnected elsewhere");
            member.voice?.close();
            member.voice = null;
            member.voiceReady = false;
            member.queue = [];
            member.baseline = 0;
          } else {
            if (room.members.size >= MAX_PLAYERS)
              throw Error("This room is full");
            const id = room.nextId++;
            if (id > 65000) throw Error("Room lifetime exceeded");
            member = {
              id,
              color: Array.from({ length: MAX_PLAYERS }, (_, i) => i).find((color) => ![...room!.members.values()].some((m) => m.color === color))!,
              name:
                String(msg.name || "Guest")
                  .replace(/[\x00-\x1f]/g, "")
                  .trim()
                  .slice(0, 20) || "Guest",
              token: randomHex(24),
              ticket: "",
              ws,
              voice: null,
              queue: [],
              last: { seq: 0, x: 0, z: 0, yaw: 0, pitch: 0, buttons: 0 },
              lastInput: Date.now(),
              expires: 0,
              baseline: 0,
              voiceReady: false,
              actions: new Set(),
              speaking: false,
              ready: false,
              build: 0,
              offer: [],
              cosmetics: { ...DEFAULT_COSMETICS, emotes: [] },
              lastEmote: 0,
            };
            room.members.set(id, member);
            room.sim.addPlayer(id);
            if (room.match.phase === "break") dealOffers(room);
            // A mid-match joiner in a team mode goes to the smaller side.
            if (teamSize(room.mode) && room.match.phase !== "lobby") {
              let a = 0, b = 0;
              for (const t of room.teams.values())
                if (t === 0) a++;
                else b++;
              room.teams.set(id, a <= b ? 0 : 1);
            }
          }
          member.ticket = randomHex(24);
          member.expires = 0;
          room.emptySince = 0;
          if (!room.members.get(room.host)?.ws) room.host = member.id;
          send(ws, {
            type: "welcome",
            id: member.id,
            code: room.code,
            token: member.token,
            ticket: member.ticket,
            seq: member.last.seq,
            doors: room.sim.doorStates(),
            windows: room.sim.windowStates(),
          });
          membership(room);
          broadcast(room, matchInfo(room));
          return;
        }
        if (!room) return;
        if (msg.type === "ping") {
          send(ws, {
            type: "pong",
            time: msg.time,
            tick: room.tick,
            cost: tickCost,
            rate: tickRate,
          });
          return;
        }
        if (msg.type === "mode") {
          // The lobby is where the mode is picked; last write wins.
          if (room.match.phase === "lobby" && isMode(msg.mode)) {
            room.mode = msg.mode;
            broadcast(room, matchInfo(room));
          }
          return;
        }
        if (msg.type === "ready") {
          member.ready = !!msg.active;
          broadcast(room, matchInfo(room));
          return;
        }
        if (msg.type === "cosmetics") {
          // Strictly decorative: validate against the catalogue, store, echo.
          member.cosmetics = sanitizeCosmetics(msg.cosmetics);
          broadcast(room, {
            type: "cosmetics",
            id: member.id,
            cosmetics: member.cosmetics,
          });
          return;
        }
        if (msg.type === "emote") {
          // Only perform emotes that are equipped; the rate limit keeps the
          // yard from becoming a dance floor.
          if (
            typeof msg.emote === "string" &&
            EMOTES.some((e) => e.id === msg.emote) &&
            member.cosmetics.emotes.includes(msg.emote) &&
            Date.now() - member.lastEmote > 10_000
          ) {
            member.lastEmote = Date.now();
            broadcast(room, { type: "emote", id: member.id, emote: msg.emote });
          }
          return;
        }
        if (msg.type === "pick") {
          // One card per break (design doc §2): the board locks as soon as
          // anything from this deal is taken, so a second click is refused.
          // Every answer names the card back — the client marks the button the
          // moment it sends and needs to know which one to unmark. Echo the
          // normalised id only: refuse to bounce back whatever was sent.
          const card = typeof msg.card === "string" ? msg.card : "",
            build = member.build,
            locked = member.offer.some((id) => build & cardBit(id));
          if (
            room.match.phase !== "break" ||
            !IMPLEMENTED_CARDS.has(card) ||
            locked ||
            !member.offer.includes(card) ||
            member.build & cardBit(card)
          ) {
            send(ws, { type: "pick-result", accepted: false, card });
            return;
          }
          member.build |= cardBit(card);
          const c = room.sim.players.get(member.id);
          if (c) c.state.build = member.build;
          send(ws, { type: "pick-result", accepted: true, card });
          broadcast(room, matchInfo(room));
          return;
        }
        if (msg.type === "leave") {
          retire(room, member, true);
          ws.close();
          return;
        }
        if (msg.type === "action") {
          if (
            !Number.isSafeInteger(msg.request) ||
            ![
              "pickup",
              "drop",
              "throw",
              "shoot",
              "swing",
              "honk",
              "door",
              "reload",
            ].includes(msg.action)
          )
            throw Error("Invalid action");
          if (member.actions.has(msg.request)) return;
          member.actions.add(msg.request);
          if (member.actions.size > 64)
            member.actions.delete(member.actions.values().next().value!);
          // Every one of these is decided here: the ray, the owner, the leaf.
          const shot =
            msg.action === "shoot" ? room.sim.shoot(member.id) : null;
          const swing =
            msg.action === "swing" ? room.sim.swing(member.id) : null;
          const opened =
            msg.action === "door"
              ? room.sim.toggleDoor(member.id, Number(msg.object))
              : null;
          const reloaded =
            msg.action === "reload" ? room.sim.reload(member.id) : null;
          const accepted =
            msg.action === "shoot"
              ? !!shot
              : msg.action === "swing"
                ? !!swing
                : msg.action === "honk"
                  ? room.sim.honk(member.id)
                  : msg.action === "door"
                    ? opened !== null
                    : msg.action === "reload"
                      ? reloaded
                      : msg.action === "pickup"
                        ? room.sim.pickup(member.id, Number(msg.object))
                        : room.sim.release(member.id, msg.action === "throw");
          send(ws, {
            type: "action-result",
            request: msg.request,
            action: msg.action,
            accepted,
          });
          if (shot) broadcast(room, { type: "shot", ...shot });
          else if (swing) broadcast(room, { type: "swing", ...swing });
          else if (accepted && msg.action !== "door")
            broadcast(room, {
              type: "sound",
              id: member.id,
              kind: msg.action,
              object: room.sim.players.get(member.id)?.state.held ?? 0,
            });
          return;
        }
        if (msg.type === "voice-ready") {
          member.voiceReady = !!msg.ready;
          membership(room);
          return;
        }
        if (msg.type === "speaking") {
          member.speaking = !!msg.active;
          broadcast(room, {
            type: "speaking",
            id: member.id,
            active: member.speaking,
          });
          return;
        }
        const target = room.members.get(Number(msg.peer));
        if (!target || target.id === member.id || !target.ws) return;
        if (msg.type === "signal") {
          if (JSON.stringify(msg.data).length > 20000)
            throw Error("Signal too large");
          send(target.ws, { type: "signal", peer: member.id, data: msg.data });
          return;
        }
        if (msg.type === "route-request") {
          const p = pair(room, member.id, target.id);
          if (msg.force === true) p.forced = true;
          if (msg.force === false) p.forced = false;
          if (msg.relay) {
            if (!p.relay || msg.force !== undefined)
              route(
                room,
                p,
                true,
                String(msg.reason ?? "Direct unavailable").slice(0, 80),
              );
          } else {
            if (p.forced) return;
            p.ready.add(member.id);
            if (p.ready.has(target.id))
              route(room, p, false, "Direct connection verified");
          }
          return;
        }
      } catch (err) {
        send(ws, {
          type: "error",
          message: err instanceof Error ? err.message : "Invalid message",
        });
        if (!member) ws.close(1008, "Invalid join");
      }
    };
    ws.onclose = () => {
      channels.delete(ws);
      lastMessages.delete(ws);
      clearTimeout(deadline);
      if (!disposed && room && member?.ws === ws) retire(room, member);
    };
  }
  function acceptVoice(ws: Channel) {
    let room: Room | undefined,
      member: Member | undefined,
      tokens = 100,
      last = performance.now();
    const deadline = setTimeout(() => {
      if (!member) ws.close(1008, "Authenticate");
    }, 5000);
    ws.onmessage = (raw) => {
      const binary = typeof raw !== "string";
      try {
        // 50 frames/s normally. Allow bounded delivery bursts after scheduling/TCP stalls.
        const now = performance.now();
        tokens = Math.min(100, tokens + ((now - last) / 1000) * 60);
        last = now;
        if (tokens < 1) throw Error("Voice rate");
        tokens--;
        if (!member) {
          // The voice channel is unordered in p2p mode, so a frame can outrun
          // the auth message. Dropping it is harmless — losing one 20 ms Opus
          // packet is what the jitter buffer is for — and the 5 s deadline
          // still closes a channel that never authenticates. The rate limiter
          // above still closes a pre-auth flood.
          if (binary) return;
          const auth = JSON.parse(raw as string);
          room = rooms.get(String(auth.code));
          member = room?.members.get(Number(auth.id));
          if (
            !member?.ws ||
            typeof auth.ticket !== "string" ||
            !safeToken(member.ticket, auth.ticket)
          )
            throw Error("Authentication failed");
          member.voice?.close(4001);
          member.voice = ws;
          send(ws, { type: "ready" });
          return;
        }
        if (!binary || !room) return;
        const b = (raw as ArrayBuffer).slice(0);
        readVoice(b);
        new DataView(b).setUint16(2, member.id, true);
        for (const p of room.pairs.values()) {
          if (
            !(p.relay || p.linger > Date.now()) ||
            (p.a !== member.id && p.b !== member.id)
          )
            continue;
          const recipient = room.members.get(
            p.a === member.id ? p.b : p.a,
          )?.voice;
          if (
            recipient?.open &&
            recipient.bufferedAmount < 12000
          )
            recipient.send(b);
        }
      } catch {
        ws.close(1008, "Invalid voice message");
      }
    };
    ws.onclose = () => {
      channels.delete(ws);
      lastMessages.delete(ws);
      clearTimeout(deadline);
      if (member?.voice === ws) member.voice = null;
    };
  }
  let previous = performance.now(),
    acc = 0,
    tickCost = 0,
    tickRate = 60,
    rateStart = performance.now(),
    rateTicks = 0;
  const timer = setInterval(() => {
    const now = performance.now();
    acc += Math.min((now - previous) / 1000, 0.1);
    previous = now;
    const begin = performance.now();
    let steps = 0;
    while (acc >= STEP && steps++ < 5) {
      acc -= STEP;
      rateTicks++;
      for (const room of rooms.values()) {
        room.tick++;
        // The match machine runs between physics steps so respawns land clean.
        if (
          room.match.phase === "lobby" ||
          room.match.phase === "match-end"
        ) {
          // Nobody is "in the game" while the lobby waits: the void is a
          // playground hazard there, so a fall just puts you back on your
          // spawn. The round-start respawn in startCountdown keeps the
          // elimination bookkeeping itself untouched.
          if (room.match.phase === "lobby")
            for (const c of room.sim.players.values())
              if (c.state.out) room.sim.respawnPlayer(c.state.id);
          const connected = [...room.members.values()].filter((m) => m.ws);
          if (connected.length >= 2 && connected.every((m) => m.ready)) {
            // A fresh match: every build starts empty and stacks from there.
            for (const m of room.members.values()) {
              m.build = 0;
              m.offer = [];
              const c = room.sim.players.get(m.id);
              if (c) c.state.build = 0;
            }
            // Team modes fill from join order; the king is drawn at random.
            const size = teamSize(room.mode);
            room.teams.clear();
            if (size)
              for (const [id, t] of Object.entries(
                assignTeams(connected.map((m) => m.id), size),
              ))
                room.teams.set(Number(id), t as 0 | 1);
            room.teamWins = [0, 0];
            room.king =
              room.mode === "king"
                ? connected[Math.floor(Math.random() * connected.length)].id
                : 0;
            room.match.round = 1;
            room.wins.clear();
            startCountdown(room);
          }
        } else if (room.match.phase === "countdown") {
          if (room.tick >= room.match.until) beginRound(room);
        } else if (room.match.phase === "round") {
          const alive = [...room.sim.players.values()].filter(
            (c) => !c.state.out,
          ).length;
          if (alive <= 1 || room.tick >= room.match.until) endRound(room);
        } else if (room.match.phase === "break") {
          // The break ends when everyone has picked; the hard cap hands a
          // random card to whoever is still browsing.
          const connected = [...room.members.values()].filter((m) => m.ws),
            picked = (m: Member) =>
              !m.offer.length ||
              m.offer.some((c) => m.build & cardBit(c));
          if (connected.every(picked) || room.tick >= room.match.until) {
            for (const m of room.members.values()) {
              if (!picked(m)) {
                const c = m.offer[Math.floor(Math.random() * m.offer.length)];
                m.build |= cardBit(c);
                const p = room.sim.players.get(m.id);
                if (p) p.state.build = m.build;
              }
            }
            // The king's build bonus: one extra random card, auto-stacked.
            if (room.mode === "king" && room.king) {
              const k = room.members.get(room.king);
              if (k?.ws) {
                const pool = [...IMPLEMENTED_CARDS].filter(
                  (id) => !(k.build & cardBit(id)),
                );
                if (pool.length) {
                  const c = pool[Math.floor(Math.random() * pool.length)];
                  k.build |= cardBit(c);
                  const p = room.sim.players.get(k.id);
                  if (p) p.state.build = k.build;
                }
              }
            }
            startCountdown(room);
          }
        }
        for (const m of room.members.values()) {
          const c = room.sim.players.get(m.id)!;
          if (m.queue.length) {
            m.last = m.queue.shift()!;
          } else m.last = { ...m.last, buttons: m.last.buttons & ~1 };
          if (!m.ws || Date.now() - m.lastInput > 250)
            m.last = { ...m.last, x: 0, z: 0, buttons: 0 };
          room.sim.motor(c, m.last);
        }
        room.sim.step();
        // Automatic leaves open on their own, so the tick is where doors are told.
        if (room.sim.doorEvents.length) {
          const doors = new Map(
            room.sim.doorStates().map((d) => [d.id, d.open]),
          );
          for (const id of room.sim.doorEvents.splice(0))
            broadcast(room, { type: "door", id, open: !!doors.get(id) });
        }
        // Shattered panes are told once; the break itself is in the snapshots.
        if (room.sim.windowEvents.length)
          for (const id of room.sim.windowEvents.splice(0))
            broadcast(room, { type: "window", id, broken: true });
        // Chaos explosions are told once; the shove rides the next snapshot.
        for (const e of room.sim.explosionEvents.splice(0))
          broadcast(room, { type: "explosion", ...e });
        // Impacts worth hearing ride one compact message per tick; nothing in
        // it is physics state — clients only play sound and sparks from it.
        if (room.sim.impactEvents.length) {
          const hits = room.sim.impactEvents.splice(0).map((h) => ({
            x: Math.round(h.x * 10) / 10,
            y: Math.round(h.y * 10) / 10,
            z: Math.round(h.z * 10) / 10,
            s: Math.round(h.s * 20) / 20,
          }));
          broadcast(room, { type: "impact", hits });
        }
        if (room.tick % 3 === 0) {
          const props = room.sim.propStates();
          if (room.tick % 120 === 0 || room.keyframes.size === 0) {
            room.keyframes.set(room.tick, props);
            while (room.keyframes.size > 4)
              room.keyframes.delete(room.keyframes.keys().next().value!);
          }
          for (const m of room.members.values()) {
            if (!m.ws || m.ws.bufferedAmount > 24000) continue;
            const latest = [...room.keyframes.keys()].at(-1)!;
            const full =
              !m.baseline ||
              room.tick % 120 === 0 ||
              !room.keyframes.has(m.baseline);
            const baseline = full ? room.tick : m.baseline;
            if (full) {
              room.keyframes.set(room.tick, props);
            }
            const base = room.keyframes.get(baseline)!;
            m.ws.send(
              encodeSnapshot({
                tick: room.tick,
                full,
                baseline,
                players: [...room.sim.players.values()].map((c) => c.state),
                props: full
                  ? props
                  : props.filter((p) => {
                      const old = base.find((b) => b.id === p.id);
                      return !old || changedProp(p, old);
                    }),
              }),
            );
          }
        }
      }
    }
    if (steps >= 5) acc = 0;
    tickCost = performance.now() - begin;
    if (now - rateStart >= 1000) {
      tickRate = (rateTicks * 1000) / (now - rateStart);
      rateTicks = 0;
      rateStart = now;
    }
  }, 4);
  const maintenance = setInterval(() => {
    for (const [ws, lastMessage] of lastMessages)
      if (Date.now() - lastMessage > 30000)
        ws.close(1001, "Heartbeat expired");
    for (const [code, r] of rooms) {
      for (const [id, m] of r.members) {
        if (!m.ws && m.expires < Date.now()) {
          r.sim.removePlayer(id);
          r.members.delete(id);
          membership(r);
        }
      }
      if (!r.members.size) {
        r.emptySince ||= Date.now();
        if (Date.now() - r.emptySince > 30000) {
          r.sim.dispose();
          rooms.delete(code);
        }
      }
      while (r.keyframes.size > 8)
        r.keyframes.delete(r.keyframes.keys().next().value!);
    }
  }, 5000);
  return {
    accept,
    ensureRoom,
    rooms,
    dispose() {
      if (disposed) return;
      disposed = true;
      clearInterval(timer);
      clearInterval(maintenance);
      for (const ws of channels) ws.close(1012, "Server restarted");
      channels.clear();
      lastMessages.clear();
      for (const r of rooms.values()) r.sim.dispose();
      rooms.clear();
    },
  };
}
