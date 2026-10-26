import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { WebSocket } from "ws";
import { attachApplication } from "../../src/server/app.js";
import {
  voicePacket,
  readVoice,
  encodeInputs,
  type Input,
} from "../../src/shared/protocol.js";
import { buildArena } from "../../src/shared/arena.js";
let server: http.Server,
  app: Awaited<ReturnType<typeof attachApplication>>,
  url: string;
const openSockets: WebSocket[] = [];
before(async () => {
  server = http.createServer();
  app = await attachApplication(server);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  url = `ws://127.0.0.1:${(server.address() as any).port}`;
});
after(async () => {
  for (const s of openSockets) s.terminate();
  app.dispose();
  await new Promise<void>((r) => server.close(() => r()));
});
function wait(
  ws: WebSocket,
  predicate: (m: any, binary: boolean) => boolean,
  timeout = 3000,
) {
  return new Promise<any>((resolve, reject) => {
    const timer = setTimeout(() => {
      ws.off("message", receive);
      reject(Error("Timed out waiting for message"));
    }, timeout);
    function receive(raw: any, binary: boolean) {
      const m = binary
        ? Uint8Array.from(raw).buffer
        : JSON.parse(raw.toString());
      if (predicate(m, binary)) {
        clearTimeout(timer);
        ws.off("message", receive);
        resolve(m);
      }
    }
    ws.on("message", receive);
  });
}
async function member(code = "") {
  const ws = new WebSocket(url + "/ws");
  openSockets.push(ws);
  await new Promise<void>((r) => ws.on("open", r));
  const result = wait(ws, (m) => m.type === "welcome" || m.type === "error");
  ws.send(JSON.stringify({ type: "join", code, name: "Test player" }));
  return { ws, welcome: await result };
}
async function media(m: Awaited<ReturnType<typeof member>>) {
  const ws = new WebSocket(url + "/voice");
  openSockets.push(ws);
  await new Promise<void>((r) => ws.on("open", r));
  const ready = wait(ws, (x) => x.type === "ready");
  ws.send(
    JSON.stringify({
      id: m.welcome.id,
      code: m.welcome.code,
      ticket: m.welcome.ticket,
    }),
  );
  await ready;
  return ws;
}
test("eight-player room cap and server-controlled moderator reassignment", async () => {
  const a = await member(),
    code = a.welcome.code;
  const clients = [a];
  for (let i = 1; i < 8; i++) clients.push(await member(code));
  const ninth = await member(code);
  assert.match(ninth.welcome.message, /full/);
  const update = wait(
    clients[1].ws,
    (m) => m.type === "members" && m.host === clients[1].welcome.id,
  );
  a.ws.close();
  await update;
  assert.equal(app.rooms.get(code)!.sim.players.size, 8);
});
test("relay isolation, authenticated source stamping, two-sided upgrade", async () => {
  const a = await member(),
    b = await member(a.welcome.code),
    c = await member(a.welcome.code);
  const av = await media(a),
    bv = await media(b),
    cv = await media(c);
  const route = wait(a.ws, (m) => m.type === "route" && m.relay);
  a.ws.send(
    JSON.stringify({ type: "route-request", peer: b.welcome.id, relay: true }),
  );
  await route;
  let cPackets = 0;
  cv.on("message", (_m, binary) => {
    if (binary) cPackets++;
  });
  const received = wait(bv, (_m, binary) => binary);
  const packet = voicePacket(10, 1, 960, new Uint8Array([1, 2]));
  new DataView(packet).setUint16(2, 65000, true);
  av.send(packet);
  const audio = readVoice(await received);
  assert.equal(audio.id, a.welcome.id);
  await new Promise((r) => setTimeout(r, 80));
  assert.equal(cPackets, 0);
  a.ws.send(
    JSON.stringify({ type: "route-request", peer: b.welcome.id, relay: false }),
  );
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(
    app.rooms.get(a.welcome.code)!.pairs.values().next().value!.relay,
    true,
  );
  const upgraded = wait(a.ws, (m) => m.type === "route" && !m.relay);
  b.ws.send(
    JSON.stringify({ type: "route-request", peer: a.welcome.id, relay: false }),
  );
  await upgraded;
});
test("voice ticket rejection and identity-preserving resume", async () => {
  const a = await member();
  const bad = new WebSocket(url + "/voice");
  openSockets.push(bad);
  await new Promise<void>((r) => bad.on("open", r));
  const closed = new Promise<number>((r) => bad.on("close", r));
  bad.send(
    JSON.stringify({
      id: a.welcome.id,
      code: a.welcome.code,
      ticket: "invalid",
    }),
  );
  assert.equal(await closed, 1008);
  a.ws.close();
  const ws = new WebSocket(url + "/ws");
  openSockets.push(ws);
  await new Promise<void>((r) => ws.on("open", r));
  const resumed = wait(ws, (m) => m.type === "welcome");
  ws.send(
    JSON.stringify({
      type: "join",
      code: a.welcome.code,
      token: a.welcome.token,
      name: "Same player",
    }),
  );
  const result = await resumed;
  assert.equal(result.id, a.welcome.id);
  assert.notEqual(result.ticket, a.welcome.ticket);
});
test("relay tolerates a delayed audio burst while rejecting a sustained flood", async () => {
  const a = await member(),
    b = await member(a.welcome.code);
  const av = await media(a),
    bv = await media(b);
  const route = wait(a.ws, (m) => m.type === "route" && m.relay);
  a.ws.send(
    JSON.stringify({ type: "route-request", peer: b.welcome.id, relay: true }),
  );
  await route;
  const delivered = wait(bv, (m, binary) => binary && readVoice(m).seq === 80);
  for (let i = 1; i <= 80; i++)
    av.send(voicePacket(1, i, i * 960, new Uint8Array([1, 2])));
  await delivered;
  assert.equal(av.readyState, WebSocket.OPEN);
  const closed = new Promise<number>((r) => av.on("close", r));
  for (let i = 81; i <= 500; i++)
    av.send(voicePacket(1, i, i * 960, new Uint8Array([1, 2])));
  assert.equal(await closed, 1008);
});

test("clothing colors stay unique and freed colors are reused by later joins", async () => {
  const first = await member(),
    code = first.welcome.code;
  const clients = [first];
  for (let i = 1; i < 8; i++) clients.push(await member(code));
  const room = app.rooms.get(code)!;
  const originalColor = room.members.get(first.welcome.id)!.color;
  assert.equal(new Set([...room.members.values()].map((m) => m.color)).size, 8);
  // "leave" only marks the slot expired; the 5 s maintenance sweep frees the
  // colour. Outlast it rather than racing it.
  const removed = wait(
    clients[1].ws,
    (m) =>
      m.type === "members" &&
      !m.members.some((p: any) => p.id === first.welcome.id),
    8000,
  );
  first.ws.send(JSON.stringify({ type: "leave" }));
  await removed;
  const newcomer = await member(code);
  assert.equal(room.members.get(newcomer.welcome.id)!.color, originalColor);
  assert.equal(new Set([...room.members.values()].map((m) => m.color)).size, 8);
});

/** Aim a member by sending real inputs: the motor overwrites yaw and pitch each tick. */
function aim(
  ws: WebSocket,
  from: number,
  yaw: number,
  pitch: number,
  count = 6,
) {
  const inputs: Input[] = Array.from({ length: count }, (_, i) => ({
    seq: from + i,
    x: 0,
    z: 0,
    yaw,
    pitch,
    buttons: 0,
  }));
  ws.send(encodeInputs(inputs.slice(0, 8), 0));
  return from + count;
}
test("the server decides every shot, and the whole room hears it", async () => {
  const a = await member(),
    b = await member(a.welcome.code);
  const room = app.rooms.get(a.welcome.code)!;
  const empty = wait(
    a.ws,
    (m) => m.type === "action-result" && m.request === 1,
  );
  a.ws.send(JSON.stringify({ type: "action", request: 1, action: "shoot" }));
  assert.equal((await empty).accepted, false, "an empty hand fires nothing");
  // Lay a gun on open floor and stand both players either side of it.
  const arena = buildArena(a.welcome.code),
    gun = arena.props.findIndex((p) => p.kind === "gun") + 1;
  // Away from the bounce pads: standing on one would slide the shooter off.
  room.sim.props.get(gun)!.setTranslation({ x: 0, y: 0.5, z: 1.5 }, true);
  await new Promise((r) => setTimeout(r, 250));
  const rest = room.sim.props.get(gun)!.translation();
  const shooter = room.sim.players.get(a.welcome.id)!,
    victim = room.sim.players.get(b.welcome.id)!;
  room.sim.restore(shooter, {
    ...shooter.state,
    x: rest.x,
    y: 0.87,
    z: rest.z + 1.5,
  });
  room.sim.restore(victim, {
    ...victim.state,
    x: rest.x,
    y: 0.87,
    z: rest.z - 3,
  });
  let seq = aim(a.ws, 1, 0, Math.atan2(0.87 + 0.65 - rest.y, 1.5));
  await new Promise((r) => setTimeout(r, 200));
  const picked = wait(a.ws, (m) => m.type === "action-result" && m.request === 2);
  a.ws.send(
    JSON.stringify({ type: "action", request: 2, action: "pickup", object: gun }),
  );
  assert.equal((await picked).accepted, true);
  aim(a.ws, seq, 0, 0);
  await new Promise((r) => setTimeout(r, 200));
  const announced = wait(b.ws, (m) => m.type === "shot");
  a.ws.send(JSON.stringify({ type: "action", request: 3, action: "shoot" }));
  const shot = await announced;
  assert.equal(shot.id, a.welcome.id);
  assert.equal(shot.object, gun, "the shot names its rendered muzzle");
  assert.ok(
    shot.pellet !== undefined && shot.pellet >= 1000,
    "and it carries the live pellet",
  );
  // The pellet reaches the victim a few ticks later; poll the authority.
  for (let i = 0; i < 240 && victim.state.stagger === 0; i++)
    await new Promise((r) => setTimeout(r, 50));
  assert.equal(victim.state.stagger > 0, true);
  assert.equal(room.members.has(b.welcome.id), true, "and nobody is removed");

  const bat = arena.props.findIndex((p) => p.kind === "bat") + 1;
  shooter.state.held = bat;
  room.sim.owners.set(gun, 0);
  room.sim.props.get(gun)!.setTranslation({ x: -20, y: 1, z: -20 }, true);
  room.sim.props
    .get(gun)!
    .setNextKinematicTranslation({ x: -20, y: 1, z: -20 });
  room.sim.owners.set(bat, a.welcome.id);
  room.sim.restore(victim, {
    ...victim.state,
    x: shooter.state.x + 0.3,
    y: 0.87,
    z: shooter.state.z - 1.8,
  });
  const swung = wait(b.ws, (m) => m.type === "swing");
  a.ws.send(JSON.stringify({ type: "action", request: 4, action: "swing" }));
  assert.equal((await swung).object, bat, "the room sees the authoritative swing");

  const horn = arena.props.findIndex((p) => p.kind === "horn") + 1;
  shooter.state.held = horn;
  room.sim.owners.set(bat, 0);
  room.sim.owners.set(horn, a.welcome.id);
  const honked = wait(
    b.ws,
    (m) => m.type === "sound" && m.kind === "honk",
  );
  a.ws.send(JSON.stringify({ type: "action", request: 5, action: "honk" }));
  assert.equal((await honked).object, horn);
});
test("mode proposals are lobby-only and ride the match broadcast", async () => {
  const a = await member(),
    code = a.welcome.code,
    b = await member(code);
  const probe = wait(a.ws, (m) => m.type === "match" && m.mode === "teams-2");
  a.ws.send(JSON.stringify({ type: "mode", mode: "teams-2" }));
  assert.equal((await probe).phase, "lobby");
  assert.equal(app.rooms.get(code)!.mode, "teams-2");
});
test("a fall through the stage while the lobby waits is not an elimination", async () => {
  const a = await member();
  const room = app.rooms.get(a.welcome.code)!;
  const player = room.sim.players.get(a.welcome.id)!;
  // Drop them under the world: the motor runs every tick and flags the fall,
  // so the lobby machine has to catch it and put them back on their spawn.
  room.sim.restore(player, { ...player.state, x: 0, y: -30, z: 0 });
  for (let i = 0; i < 60 && player.state.y < 0; i++)
    await new Promise((r) => setTimeout(r, 50));
  const spawn = buildArena(a.welcome.code).spawns[(a.welcome.id - 1) % 8];
  assert.equal(player.state.x, spawn[0]);
  assert.ok(Math.abs(player.state.y - spawn[1]) < 0.5, "back on top of the slab");
  assert.equal(player.state.z, spawn[2]);
  assert.equal(player.state.out, 0, "still in, waiting for the ready gate");
});
/**
 * Ready both members and get to the countdown. A match now opens on a card
 * board, so each side takes a card from its own deal — the board closes as
 * soon as both have picked and the countdown follows.
 */
async function startMatch(
  a: Awaited<ReturnType<typeof member>>,
  b: Awaited<ReturnType<typeof member>>,
) {
  const waiting = [a, b].map((m) => ({
    deal: wait(
      m.ws,
      (x) => x.type === "match" && x.phase === "build" && !!x.offers,
    ),
    pick: wait(m.ws, (x) => x.type === "pick-result" && x.accepted),
  }));
  const countdown = wait(
    a.ws,
    (x) => x.type === "match" && x.phase === "countdown",
  );
  a.ws.send(JSON.stringify({ type: "ready", active: true }));
  b.ws.send(JSON.stringify({ type: "ready", active: true }));
  const deals = await Promise.all(waiting.map((w) => w.deal));
  [a, b].forEach((m, i) => {
    const mine = deals[i].offers.find((o: any) => o.id === m.welcome.id);
    assert.ok(mine?.cards.length, "every side is dealt a board");
    m.ws.send(JSON.stringify({ type: "pick", card: mine.cards[0] }));
  });
  const picks = await Promise.all(waiting.map((w) => w.pick));
  return { match: await countdown, deals, picks };
}
test("the match deals a card board before round 1", async () => {
  const a = await member(),
    code = a.welcome.code,
    b = await member(code);
  const { match, deals, picks } = await startMatch(a, b);
  assert.equal(match.phase, "countdown", "both picks opened the round");
  assert.equal(deals[0].offers.length, 2, "the deal covers both members");
  for (const d of deals)
    for (const o of d.offers) assert.equal(o.cards.length, 3, "three cards each");
  assert.deepEqual(
    picks.map((p: any) => p.accepted),
    [true, true],
  );
  const room = app.rooms.get(code)!;
  for (const m of [a, b]) {
    const build = room.members.get(m.welcome.id)!.build;
    assert.ok(build, "the card is owned before the round starts");
    assert.equal(room.sim.players.get(m.welcome.id)!.state.build, build);
  }
});
test("teams modes split the lobby and share every victory", async () => {
  const a = await member(),
    code = a.welcome.code,
    b = await member(code);
  a.ws.send(JSON.stringify({ type: "mode", mode: "teams-3" }));
  const { match: m } = await startMatch(a, b);
  assert.deepEqual(m.teams, { [String(a.welcome.id)]: 0, [String(b.welcome.id)]: 1 });
  assert.equal(app.rooms.get(code)!.teams.get(a.welcome.id), 0);
});
test("king of the yard crowns one of the lobby", async () => {
  const a = await member(),
    code = a.welcome.code,
    b = await member(code);
  a.ws.send(JSON.stringify({ type: "mode", mode: "king" }));
  const { match: m } = await startMatch(a, b);
  assert.ok([a.welcome.id, b.welcome.id].includes(m.king), "the crown goes to a player");
  assert.equal(app.rooms.get(code)!.king, m.king);
});
test("chaos mode rolls a modifier for the first round", async () => {
  const a = await member(),
    code = a.welcome.code,
    b = await member(code);
  a.ws.send(JSON.stringify({ type: "mode", mode: "chaos" }));
  const { match: m } = await startMatch(a, b);
  assert.ok(m.modifier && m.modifier !== "none", "the modifier rides the broadcast");
  assert.equal(app.rooms.get(code)!.sim.env, m.modifier);
});
