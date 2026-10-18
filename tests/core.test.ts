import { test } from "node:test";
import assert from "node:assert/strict";
import {
  encodeInputs,
  decodeInputs,
  encodeSnapshot,
  decodeSnapshot,
  voicePacket,
  readVoice,
  BUTTON,
  changedProp,
} from "../src/shared/protocol.js";
import { PELLET_ID_BASE, initPhysics, Simulation } from "../src/shared/simulation.js";
import { HORN, MELEE, PADS, PROPS, STEP, WEAPON } from "../src/shared/level.js";
import { cardBit } from "../src/shared/upgrades.js";
import {
  DEFAULT_COSMETICS,
  EMOTES,
  HATS,
  MAX_EMOTE_SLOTS,
  SKINS,
  VOICE_EFFECTS,
  sanitizeCosmetics,
} from "../src/shared/cosmetics.js";
import { assignTeams, chaosModifierFor, COMBAT, MODIFIERS } from "../src/shared/match.js";
import { createEncoder, createDecoder } from "libopus-wasm";
await initPhysics();
test("binary input round trip and malformed packet rejection", () => {
  const input = { seq: 51, x: -1, z: 0.5, yaw: 1.2, pitch: -0.4, buttons: 5 };
  const result = decodeInputs(encodeInputs([input], 30));
  assert.equal(result.baseline, 30);
  assert.equal(result.inputs[0].seq, 51);
  assert.ok(Math.abs(result.inputs[0].z - 0.5) < 0.0001);
  assert.throws(() => decodeInputs(new ArrayBuffer(2)));
  const bad = encodeInputs([input], 0);
  new DataView(bad).setFloat32(15, NaN, true);
  assert.throws(() => decodeInputs(bad));
});
test("snapshot and voice packets preserve identity and reject truncated audio", () => {
  const sim = new Simulation();
  sim.addPlayer(1);
  const s = {
    tick: 20,
    baseline: 20,
    full: true,
    players: [sim.players.get(1)!.state],
    props: sim.propStates(),
  };
  const round = decodeSnapshot(encodeSnapshot(s));
  assert.equal(round.players[0].id, 1);
  assert.equal(round.props.length, PROPS.length);
  assert.ok(Math.abs(round.props[0].x - s.props[0].x) < 0.011);
  assert.equal(round.players[0].stagger, 0);
  const b = voicePacket(22, 3, 960, new Uint8Array([1, 2, 3]));
  const f = readVoice(b);
  assert.equal(f.epoch, 22);
  assert.deepEqual([...f.payload], [1, 2, 3]);
  assert.throws(() => readVoice(b.slice(0, -1)));
  sim.dispose();
});
test("motor settles, walks at fixed speed and jumps on the stage", () => {
  const sim = new Simulation(),
    c = sim.addPlayer(1);
  let seq = 0;
  const step = (buttons = 0, x = 0, z = 0) => {
    sim.motor(c, { seq: ++seq, x, z, yaw: 0, pitch: 0, buttons });
    sim.step();
  };
  sim.restore(c, { ...c.state, x: 2, y: 0.87, z: 0, vx: 0, vy: 0, vz: 0, yaw: 0, pitch: 0 });
  for (let i = 0; i < 120; i++) step();
  assert.ok(c.state.flags & 1);
  assert.ok(Math.abs(c.state.y - 0.87) < 0.08);
  const start = c.state.z;
  for (let i = 0; i < 60; i++) step(0, 0, 1);
  assert.ok(start - c.state.z > 3 && start - c.state.z < 4);
  step(BUTTON.JUMP);
  for (let i = 0; i < 12; i++) step();
  assert.ok(c.state.y > 1.5);
  // Walk off the west edge of the stage and into the void below.
  sim.restore(c, { ...c.state, x: -4.5, y: 0.87, z: 0, vx: 0, vy: 0, vz: 0 });
  for (let i = 0; i < 90; i++) step(0, -1, 0);
  assert.ok(c.state.y < 0 || c.state.out === 1, "off the edge means falling");
  sim.dispose();
});
test("pickup validation, single ownership and disconnect release", () => {
  const sim = new Simulation(),
    a = sim.addPlayer(1),
    b = sim.addPlayer(2);
  for (let i = 0; i < 90; i++) sim.step();
  const prop = sim.props.get(1)!.translation();
  for (const c of [a, b]) {
    sim.restore(c, {
      ...c.state,
      x: prop.x,
      y: 0.87,
      z: prop.z + 1.5,
      pitch: 0.7,
    });
  }
  sim.step();
  assert.equal(sim.pickup(1, 8), false);
  assert.equal(sim.pickup(1, 1), true);
  assert.equal(sim.pickup(2, 1), false);
  sim.removePlayer(1);
  assert.equal(sim.owners.get(1), 0);
  sim.dispose();
});
test("replaying acknowledged state reproduces static movement", () => {
  const a = new Simulation(true),
    b = new Simulation(true),
    ca = a.addPlayer(1),
    cb = b.addPlayer(1);
  const inputs = Array.from({ length: 60 }, (_, i) => ({
    seq: i + 1,
    x: 1,
    z: 1,
    yaw: 0.2,
    pitch: 0,
    buttons: 0,
  }));
  let saved = { ...ca.state };
  for (const i of inputs) {
    a.motor(ca, i);
    a.step();
    if (i.seq === 30) saved = { ...ca.state };
  }
  b.restore(cb, saved);
  for (const i of inputs.slice(30)) {
    b.motor(cb, i);
    b.step();
  }
  assert.ok(
    Math.hypot(
      ca.state.x - cb.state.x,
      ca.state.y - cb.state.y,
      ca.state.z - cb.state.z,
    ) < 0.05,
  );
  a.dispose();
  b.dispose();
});
test("raw Opus WASM round trip and loss concealment", async () => {
  const e = await createEncoder({ channels: 1, bitrate: 24000 }),
    d = await createDecoder({ channels: 1 });
  const wave = Float32Array.from(
    { length: 960 },
    (_, i) => Math.sin((i * 2 * Math.PI * 440) / 48000) * 0.2,
  );
  let decoded: Float32Array = new Float32Array();
  for (let i = 0; i < 5; i++) decoded = d.decodeFloat(e.encodeFloat(wave));
  assert.equal(decoded.length, 960);
  assert.ok(decoded.some((v) => Math.abs(v) > 0.05));
  assert.equal(d.decodePacketLossFloat(960).length, 960);
  e.free();
  d.free();
});
test("delta comparison matches wire quantization", () => {
  const p = { id: 1, x: 1, y: 2, z: 3, qx: 0, qy: 0, qz: 0, qw: 1, owner: 0 };
  assert.equal(changedProp(p, { ...p, x: 1.001 }), false);
  assert.equal(changedProp(p, { ...p, owner: 2 }), true);
});
test("holding across motor queries keeps Rapier borrow state valid through cleanup", () => {
  const sim = new Simulation(),
    c = sim.addPlayer(1);
  for (let i = 0; i < 90; i++) sim.step();
  const prop = sim.props.get(1)!.translation();
  sim.restore(c, {
    ...c.state,
    x: prop.x,
    y: 0.87,
    z: prop.z + 1.5,
    pitch: 0.7,
  });
  sim.step();
  assert.equal(sim.pickup(1, 1), true);
  for (let i = 0; i < 180; i++) {
    sim.motor(c, { seq: i + 1, x: 1, z: 0, yaw: 0, pitch: 0.7, buttons: 0 });
    sim.step();
  }
  sim.removePlayer(1);
  sim.dispose();
});
test("reverb volumes blend at the doorway and keep distant outside positions dry", async () => {
  const { regionWeights } = await import("../src/shared/acoustics.js");
  assert.equal(regionWeights({ x: 0, y: 1.5, z: 0 }).get("room"), 1);
  const doorway = regionWeights({ x: 5, y: 1.5, z: 0 });
  assert.equal(doorway.get("room"), 0.5);
  assert.equal(doorway.get("hall"), 0.5);
  assert.equal(regionWeights({ x: 9, y: 1.5, z: 0 }).get("hall"), 1);
  assert.equal(regionWeights({ x: 50, y: 1.5, z: 0 }).get("hall"), 0);
});

test("a gun fires a live pellet that shoves and damages on contact", () => {
  const sim = new Simulation(),
    shooter = sim.addPlayer(1),
    victim = sim.addPlayer(2);
  const gun = PROPS.findIndex((p) => p.kind === "gun") + 1;
  // Put a gun on open floor rather than fighting the workbench it starts on.
  sim.props.get(gun)!.setTranslation({ x: 3.5, y: 0.5, z: 1.5 }, true);
  for (let i = 0; i < 60; i++) sim.step();
  const rest = sim.props.get(gun)!.translation();
  sim.restore(shooter, {
    ...shooter.state,
    x: rest.x,
    y: 0.87,
    z: rest.z + 1.5,
    yaw: 0,
    pitch: Math.atan2(0.87 + 0.65 - rest.y, 1.5),
  });
  sim.restore(victim, { ...victim.state, x: rest.x, y: 0.87, z: rest.z - 4.5 });
  sim.step();
  assert.equal(sim.pickup(1, gun), true);
  // Level the crosshair on the other player and pull the trigger.
  sim.restore(shooter, { ...shooter.state, pitch: 0, held: gun });
  sim.step();
  const before = { ...victim.state };
  const shot = sim.shoot(1);
  assert.ok(shot, "the shot is accepted");
  assert.ok(shot.pellet !== undefined && shot.pellet >= PELLET_ID_BASE, "it spawns a live pellet");
  assert.equal(shot.hit, 0, "the ray no longer decides the hit");
  assert.equal(shooter.state.ammo, WEAPON.ammo - 1, "one round is spent");
  assert.equal(sim.shoot(1), null, "the gun has a cooldown");
  const still = { seq: 0, x: 0, z: 0, yaw: 0, pitch: 0, buttons: 0 };
  for (let i = 0; i < 90 && victim.state.stagger === 0; i++) {
    sim.motor(shooter, { ...still, seq: i + 1, pitch: 0 });
    sim.motor(victim, { ...still, seq: i + 1 });
    sim.step();
  }
  assert.ok(victim.state.stagger > 0, "the pellet reached the victim");
  assert.ok(victim.state.hp < before.hp, "impact damage came with it");
  assert.equal(sim.pellets.size, 0, "the spent pellet is gone");
  for (let i = 0; i < 45; i++) {
    sim.motor(shooter, { ...still, seq: i + 1, pitch: 0 });
    sim.motor(victim, { ...still, seq: i + 1 });
    sim.step();
  }
  assert.ok(before.z - victim.state.z > 1.5, "pushed back a good way");
  assert.equal(victim.state.stagger, 0, "and back on their feet after");
  assert.ok(sim.players.has(2) && victim.state.y > -1, "nobody is removed");
  for (let i = 0; i < WEAPON.cooldown; i++) sim.step();
  assert.ok(sim.shoot(1), "the gun is ready again");
  sim.dispose();
});
test("ammo runs dry, the reload refills it, and R starts it early", () => {
  const sim = new Simulation(),
    shooter = sim.addPlayer(1);
  const gun = PROPS.findIndex((p) => p.kind === "gun") + 1;
  sim.owners.set(gun, 1);
  shooter.state.held = gun;
  for (let i = 0; i < WEAPON.ammo; i++) {
    assert.ok(sim.shoot(1), `shot ${i + 1} is accepted`);
    for (let j = 0; j < WEAPON.cooldown; j++) sim.step();
  }
  assert.equal(shooter.state.ammo, 0, "the magazine is empty");
  assert.equal(sim.shoot(1), null, "a dry trigger starts the reload instead");
  assert.equal(sim.reload(1), false, "it cannot start twice");
  for (let i = 0; i < WEAPON.reload; i++) sim.step();
  assert.equal(shooter.state.ammo, WEAPON.ammo, "the reload finished");
  // A partial magazine can be topped up early.
  assert.ok(sim.shoot(1));
  for (let j = 0; j < WEAPON.cooldown; j++) sim.step();
  assert.equal(sim.reload(1), true, "R tops it up early");
  assert.equal(sim.reload(1), false, "already reloading");
  for (let i = 0; i < WEAPON.reload; i++) sim.step();
  assert.equal(shooter.state.ammo, WEAPON.ammo);
  sim.dispose();
});
test("leaving the arena is an elimination and leaves the player inert", () => {
  const sim = new Simulation(),
    c = sim.addPlayer(1);
  sim.restore(c, { ...c.state, x: 40, y: 1, z: 0 });
  const still = { seq: 1, x: 1, z: 0, yaw: 0, pitch: 0, buttons: 0 };
  sim.motor(c, still);
  assert.equal(c.state.out, 1, "outside the fence is out");
  assert.equal(c.state.hp, 0);
  const x = c.state.x;
  for (let i = 0; i < 30; i++) {
    sim.motor(c, { ...still, seq: i + 2 });
    sim.step();
  }
  assert.equal(c.state.out, 1);
  assert.ok(Math.abs(c.state.x - x) < 0.5, "inert: the input no longer moves them");
  sim.respawn();
  assert.equal(c.state.out, 0);
  assert.equal(c.state.hp, 100);
  assert.equal(c.state.ammo, WEAPON.ammo);
  sim.dispose();
});
test("the arena is a bounded square around the stage", () => {
  const sim = new Simulation(),
    c = sim.addPlayer(1);
  const still = { seq: 1, x: 0, z: 0, yaw: 0, pitch: 0, buttons: 0 };
  for (const [x, z] of [
    [0, 0], // the stage centre
    [9, 0], // the east satellite
    [0, -9], // the south satellite
    [8, 8], // over the NE perch, still in bounds
  ]) {
    sim.restore(c, { ...c.state, x, y: 1, z });
    sim.motor(c, still);
    assert.equal(c.state.out, 0, `(${x}, ${z}) is in the arena`);
  }
  for (const [x, z] of [
    [17, 0], // beyond the east edge
    [0, 17], // beyond the north edge
    [-17, -17], // beyond the SW corner
  ]) {
    sim.restore(c, { ...c.state, x, y: 1, z });
    sim.motor(c, still);
    assert.equal(c.state.out, 1, `(${x}, ${z}) is out`);
  }
  sim.dispose();
});
test("a bat has a short forgiving shove and a horn is rate-limited", () => {
  const sim = new Simulation(),
    hitter = sim.addPlayer(1),
    victim = sim.addPlayer(2),
    bat = PROPS.findIndex((p) => p.kind === "bat") + 1,
    horn = PROPS.findIndex((p) => p.kind === "horn") + 1;
  sim.restore(hitter, {
    ...hitter.state,
    x: 0,
    y: 0.87,
    z: 2,
    yaw: 0,
    pitch: 0,
    held: bat,
  });
  sim.restore(victim, { ...victim.state, x: 0.35, y: 0.87, z: 0.15 });
  sim.owners.set(bat, 1);
  sim.step();
  const swing = sim.swing(1);
  assert.equal(swing?.hit, 2);
  assert.equal(sim.swing(1), null, "the bat cannot be spammed every tick");
  assert.equal(victim.state.stagger, MELEE.stagger);
  assert.ok(victim.state.vz < -8, "the bat launches away from its hitter");

  hitter.state.held = horn;
  sim.owners.set(bat, 0);
  sim.owners.set(horn, 1);
  assert.equal(sim.honk(1), true);
  assert.equal(sim.honk(1), false, "the horn is authority-rate-limited");
  for (let i = 0; i < HORN.cooldown; i++) sim.step();
  assert.equal(sim.honk(1), true);
  sim.dispose();
});
test("staggered players keep only a fraction of their own steering", () => {
  const sim = new Simulation(),
    c = sim.addPlayer(1);
  for (let i = 0; i < 30; i++) sim.step();
  // Measured inside the stagger window, where the damping actually applies.
  const run = (stagger: number) => {
    sim.restore(c, { ...c.state, x: 0, y: 0.87, z: 2, vx: 0, vz: 0, stagger });
    for (let i = 0; i < WEAPON.stagger - 2; i++) {
      sim.motor(c, { seq: i + 1, x: 0, z: 1, yaw: 0, pitch: 0, buttons: 0 });
      sim.step();
    }
    return 2 - c.state.z;
  };
  const free = run(0),
    shoved = run(WEAPON.stagger);
  assert.ok(free > 1.1, `walked ${free}`);
  assert.ok(shoved < free * 0.45, `staggered ${shoved} against ${free}`);
  sim.dispose();
});
test("a dropped ball bounces back up where a crate lands flat", () => {
  const sim = new Simulation();
  const drop = (id: number) => {
    const body = sim.props.get(id)!;
    body.setTranslation({ x: -5, y: 3, z: 2 }, true);
    body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    let landed = false,
      rebound = 0;
    for (let i = 0; i < 150; i++) {
      sim.step();
      const y = body.translation().y;
      if (y < 0.45) landed = true;
      if (landed) rebound = Math.max(rebound, y);
    }
    return rebound;
  };
  const ball = PROPS.findIndex((p) => p.kind === "ball") + 1,
    crate = PROPS.findIndex((p) => p.kind === "crate") + 1;
  assert.ok(drop(ball) > 0.9, "a ball comes back to you");
  assert.ok(drop(crate) < 0.55, "a crate stays where it fell");
  sim.dispose();
});
test("hard impacts are recorded for sound and sparks, soft ones are not", () => {
  const sim = new Simulation();
  const crate = PROPS.findIndex((p) => p.kind === "crate") + 1;
  const body = sim.props.get(crate)!;
  // A hard drop into the floor is loud.
  body.setTranslation({ x: -5, y: 3, z: 2 }, true);
  body.setLinvel({ x: 0, y: 0, z: 0 }, true);
  for (let i = 0; i < 90; i++) sim.step();
  assert.ok(sim.impactEvents.length > 0, "the hard landing is recorded");
  const hit = sim.impactEvents.reduce((m, e) => (e.s > m.s ? e : m));
  assert.ok(hit.s >= 0.5, "it reads as a strong impact");
  assert.ok(
    Math.abs(hit.x + 5) < 2 && hit.y < 2 && Math.abs(hit.z - 2) < 2,
    "at the landing spot",
  );
  // ...while a gentle set-down stays quiet.
  sim.impactEvents.length = 0;
  body.setTranslation({ x: -5, y: 0.35, z: 2 }, true);
  body.setLinvel({ x: 0, y: 0, z: 0 }, true);
  for (let i = 0; i < 60; i++) sim.step();
  assert.equal(sim.impactEvents.length, 0, "a soft landing is below the floor");
  sim.dispose();
});
test("snapshots carry the picked build and the air-jump counter", () => {
  const sim = new Simulation(),
    c = sim.addPlayer(1);
  c.state.build = cardBit("yeet") | cardBit("super-jump");
  c.state.jumps = 1;
  const s = { tick: 5, baseline: 5, full: true, players: [c.state], props: sim.propStates() };
  const round = decodeSnapshot(encodeSnapshot(s));
  assert.equal(round.players[0].build, c.state.build);
  assert.equal(round.players[0].jumps, 1);
  sim.dispose();
});
test("super jump and moon boots change how the air feels", () => {
  const sim = new Simulation(),
    c = sim.addPlayer(1);
  let seq = 0;
  const settle = () => {
    for (let i = 0; i < 30; i++) {
      sim.motor(c, { seq: ++seq, x: 0, z: 0, yaw: 0, pitch: 0, buttons: 0 });
      sim.step();
    }
  };
  // Open floor with headroom, so the apex is the whole arc.
  const jumpApex = (build: number) => {
    sim.restore(c, { ...c.state, x: 0, y: 0.87, z: 2, vx: 0, vy: 0, vz: 0 });
    c.state.build = build;
    c.state.jumps = 0;
    settle();
    let apex = -Infinity;
    for (let i = 0; i < 120; i++) {
      sim.motor(c, { seq: ++seq, x: 0, z: 0, yaw: 0, pitch: 0, buttons: i === 0 ? BUTTON.JUMP : 0 });
      sim.step();
      apex = Math.max(apex, c.state.y);
    }
    return apex;
  };
  const normal = jumpApex(0);
  assert.ok(jumpApex(cardBit("super-jump")) > normal + 1.5, "super jump clears higher");
  assert.ok(jumpApex(cardBit("moon-boots")) > normal + 0.5, "moon boots hang longer");
  sim.dispose();
});
test("bunny hop spends one air jump and lands back on its feet", () => {
  const sim = new Simulation(),
    c = sim.addPlayer(1);
  let seq = 0;
  sim.restore(c, { ...c.state, x: 0, y: 0.87, z: 2, vx: 0, vy: 0, vz: 0 });
  c.state.build = cardBit("bunny-hop");
  c.state.jumps = 0;
  for (let i = 0; i < 30; i++) {
    sim.motor(c, { seq: ++seq, x: 0, z: 0, yaw: 0, pitch: 0, buttons: 0 });
    sim.step();
  }
  let airJumped = false;
  for (let i = 0; i < 120; i++) {
    sim.motor(c, { seq: ++seq, x: 0, z: 0, yaw: 0, pitch: 0, buttons: i === 0 || i === 25 ? BUTTON.JUMP : 0 });
    sim.step();
    if (c.state.jumps === 1) airJumped = true;
  }
  assert.ok(airJumped, "the extra jump happened in the air");
  assert.equal(c.state.jumps, 0, "landing resets the counter");
  sim.dispose();
});
test("quick draw refills the magazine sooner", () => {
  const sim = new Simulation(),
    shooter = sim.addPlayer(1);
  const gun = PROPS.findIndex((p) => p.kind === "gun") + 1;
  sim.owners.set(gun, 1);
  shooter.state.held = gun;
  shooter.state.build = cardBit("quick-draw");
  assert.ok(sim.shoot(1), "the first shot is accepted");
  for (let i = 0; i < WEAPON.cooldown; i++) sim.step();
  assert.equal(sim.reload(1), true, "R starts the reload");
  let refilled = -1;
  for (let i = 0; i < WEAPON.reload && shooter.state.ammo !== WEAPON.ammo; i++) {
    sim.step();
    if (shooter.state.ammo === WEAPON.ammo) refilled = i + 1;
  }
  assert.equal(refilled, Math.ceil(WEAPON.reload * 0.6), "quick draw lands early");
  sim.dispose();
});
test("yeet multiplies the knockback of every hit", () => {
  const sim = new Simulation(),
    hitter = sim.addPlayer(1),
    victim = sim.addPlayer(2),
    bat = PROPS.findIndex((p) => p.kind === "bat") + 1;
  sim.owners.set(bat, 1);
  const swingAt = (build: number) => {
    hitter.state.build = build;
    sim.restore(hitter, { ...hitter.state, x: 0, y: 0.87, z: 2, yaw: 0, pitch: 0, vx: 0, vy: 0, vz: 0, held: bat });
    sim.restore(victim, { ...victim.state, x: 0.35, y: 0.87, z: 0.15, vx: 0, vy: 0, vz: 0, stagger: 0, out: 0 });
    sim.step();
    const swing = sim.swing(1);
    assert.equal(swing?.hit, 2, "the bat still finds the victim");
    return victim.state.vz;
  };
  const free = swingAt(0);
  assert.ok(free < -8, "a plain bat already launches");
  for (let i = 0; i < MELEE.cooldown + 5; i++) sim.step();
  assert.ok(Math.abs(swingAt(cardBit("yeet"))) > Math.abs(free) * 1.45, "yeet hits harder");
  sim.dispose();
});
test("rocket legs launch the player who jumps next to you", () => {
  const sim = new Simulation(),
    a = sim.addPlayer(1),
    b = sim.addPlayer(2);
  sim.restore(a, { ...a.state, x: 0, y: 0.87, z: 2, vx: 0, vy: 0, vz: 0 });
  a.state.build = cardBit("rocket-legs");
  sim.restore(b, { ...b.state, x: 1.5, y: 0.87, z: 2, vx: 0, vy: 0, vz: 0 });
  sim.step();
  const still = { seq: 1, x: 0, z: 0, yaw: 0, pitch: 0, buttons: 0 };
  sim.motor(a, still);
  assert.ok(a.state.flags & 1, "settled on the ground");
  sim.motor(a, { ...still, seq: 2, buttons: BUTTON.JUMP });
  assert.equal(b.state.stagger, 18, "the bang staggers a neighbour");
  assert.ok(Math.abs(b.state.vx) > 1, "and shoves them away");
  sim.dispose();
});
test("triple shot fans three pellets out of one trigger pull", () => {
  const sim = new Simulation(),
    shooter = sim.addPlayer(1);
  const gun = PROPS.findIndex((p) => p.kind === "gun") + 1;
  sim.owners.set(gun, 1);
  shooter.state.held = gun;
  shooter.state.build = cardBit("triple-shot");
  const shot = sim.shoot(1);
  assert.ok(shot, "the shot is accepted");
  assert.equal(sim.pellets.size, 3, "three pellets are live");
  assert.equal(shooter.state.ammo, WEAPON.ammo - 1, "one round is spent");
  assert.equal(shot.dirs?.length, 3, "every direction rides the message");
  assert.equal(shot.dz, -1, "the center keeps the aim direction");
  assert.ok(Math.abs(shot.dx) < 1e-9);
  assert.equal(new Set((shot.dirs ?? []).map((d) => d.dx)).size, 3, "the fan is distinct");
  sim.dispose();
});
test("speed round flies the pellet fifty percent faster", () => {
  const speedOf = (build: number) => {
    const sim = new Simulation(),
      shooter = sim.addPlayer(1);
    const gun = PROPS.findIndex((p) => p.kind === "gun") + 1;
    sim.owners.set(gun, 1);
    shooter.state.held = gun;
    sim.restore(shooter, { ...shooter.state, x: 0, y: 0.87, z: 2, yaw: 0, pitch: 0, vx: 0, vy: 0, vz: 0 });
    shooter.state.build = build;
    assert.ok(sim.shoot(1));
    const v = [...sim.pellets.values()][0].v;
    sim.dispose();
    return Math.hypot(v.x, v.y, v.z);
  };
  const plain = speedOf(0);
  assert.equal(plain, WEAPON.pelletSpeed, "a plain round uses the base speed");
  assert.ok(speedOf(cardBit("speed-round")) > plain * 1.49, "the card is a clear +50%");
});
test("bouncy keeps flying after every contact", () => {
  const run = (build: number, steps: number) => {
    const sim = new Simulation(),
      shooter = sim.addPlayer(1);
    const gun = PROPS.findIndex((p) => p.kind === "gun") + 1;
    sim.owners.set(gun, 1);
    shooter.state.held = gun;
    // From stage centre, up at the NE perch's underside — a solid face in both envs.
    sim.restore(shooter, { ...shooter.state, x: 0, y: 0.87, z: 0, yaw: -3 * Math.PI / 4, pitch: -0.08, vx: 0, vy: 0, vz: 0 });
    shooter.state.build = build;
    assert.ok(sim.shoot(1));
    sim.step();
    for (let i = 0; i < steps; i++) sim.step();
    const size = sim.pellets.size;
    sim.dispose();
    return size;
  };
  assert.equal(run(0, 60), 0, "a plain pellet dies on the perch");
  assert.ok(run(cardBit("bouncy"), 45) >= 1, "the bouncy one is still flying");
});
test("rubber bullet survives two bounces and only two", () => {
  const sim = new Simulation(),
    shooter = sim.addPlayer(1);
  const gun = PROPS.findIndex((p) => p.kind === "gun") + 1;
  sim.owners.set(gun, 1);
  shooter.state.held = gun;
  sim.restore(shooter, { ...shooter.state, x: 0, y: 0.87, z: 0, yaw: -3 * Math.PI / 4, pitch: -0.08, vx: 0, vy: 0, vz: 0 });
  shooter.state.build = cardBit("rubber-bullet");
  assert.ok(sim.shoot(1));
  assert.equal([...sim.pellets.values()][0].bounces, 2, "it starts with two lives");
  sim.step();
  let sawOne = false;
  for (let i = 0; i < 200 && sim.pellets.size > 0; i++) {
    if ([...sim.pellets.values()][0].bounces === 1) sawOne = true;
    sim.step();
  }
  assert.ok(sawOne, "a bounce was spent");
  assert.equal(sim.pellets.size, 0, "and the third contact ends it");
  sim.dispose();
});
test("ricochet turns a wall hit into a shot at the nearest player", () => {
  const sim = new Simulation(),
    shooter = sim.addPlayer(1),
    victim = sim.addPlayer(2);
  const gun = PROPS.findIndex((p) => p.kind === "gun") + 1;
  sim.owners.set(gun, 1);
  shooter.state.held = gun;
  sim.restore(shooter, { ...shooter.state, x: 0, y: 0.87, z: 0, yaw: -3 * Math.PI / 4, pitch: -0.08, vx: 0, vy: 0, vz: 0 });
  shooter.state.build = cardBit("ricochet");
  sim.restore(victim, { ...victim.state, x: 4, y: 0.87, z: -2, vx: 0, vy: 0, vz: 0, stagger: 0, out: 0 });
  assert.ok(sim.shoot(1));
  sim.step();
  for (let i = 0; i < 120 && victim.state.stagger === 0; i++) sim.step();
  assert.ok(victim.state.stagger > 0, "the redirected pellet finds the victim");
  sim.dispose();
});
test("homing drags a straight shot onto an off-axis player", () => {
  const run = (build: number) => {
    const sim = new Simulation(),
      shooter = sim.addPlayer(1),
      victim = sim.addPlayer(2);
    const gun = PROPS.findIndex((p) => p.kind === "gun") + 1;
    sim.owners.set(gun, 1);
    shooter.state.held = gun;
    sim.restore(shooter, { ...shooter.state, x: 0, y: 0.87, z: 2, yaw: 0, pitch: 0, vx: 0, vy: 0, vz: 0 });
    shooter.state.build = build;
    sim.restore(victim, { ...victim.state, x: 2, y: 0.87, z: -6, vx: 0, vy: 0, vz: 0, stagger: 0, out: 0 });
    assert.ok(sim.shoot(1));
    sim.step();
    for (let i = 0; i < 240 && victim.state.stagger === 0; i++) sim.step();
    const hit = victim.state.stagger > 0;
    sim.dispose();
    return hit;
  };
  assert.equal(run(0), false, "a plain pellet misses the off-axis player");
  assert.equal(run(cardBit("homing")), true, "the homing one curves onto them");
});
test("explosive detonates on first contact and blasts everyone in radius", () => {
  const run = (build: number) => {
    const sim = new Simulation(),
      shooter = sim.addPlayer(1),
      victim = sim.addPlayer(2),
      bystander = sim.addPlayer(3);
    const gun = PROPS.findIndex((p) => p.kind === "gun") + 1;
    sim.owners.set(gun, 1);
    shooter.state.held = gun;
    sim.restore(shooter, { ...shooter.state, x: 0, y: 0.87, z: 2, yaw: 0, pitch: 0, vx: 0, vy: 0, vz: 0 });
    shooter.state.build = build;
    sim.restore(victim, { ...victim.state, x: 0, y: 0.87, z: -4, vx: 0, vy: 0, vz: 0, stagger: 0, out: 0 });
    sim.restore(bystander, { ...bystander.state, x: 1.5, y: 0.87, z: -3, vx: 0, vy: 0, vz: 0, stagger: 0, out: 0 });
    assert.ok(sim.shoot(1));
    sim.step();
    for (let i = 0; i < 90 && sim.pellets.size > 0; i++) sim.step();
    const r = {
      dead: victim.state.out,
      victimHp: victim.state.hp,
      victimStagger: victim.state.stagger,
      bystanderVx: bystander.state.vx,
      bystanderStagger: bystander.state.stagger,
    };
    sim.dispose();
    return r;
  };
  const card = run(cardBit("explosive"));
  assert.ok(card.victimHp < COMBAT.hpMax, "the blast drained HP");
  assert.equal(card.dead, 0, "one blast staggers but does not eliminate");
  assert.ok(card.victimStagger > 0, "the victim is caught in the radius");
  assert.ok(card.bystanderVx > 1, "the bystander is shoved by the wave");
  assert.equal(card.bystanderStagger, WEAPON.stagger);
  const plain = run(0);
  assert.ok(plain.victimStagger > 0, "a plain hit still staggers");
  assert.ok(Math.abs(plain.bystanderVx) < 0.5, "and nothing reaches the bystander");
});
test("big ball swells the pellet to three times the radius", () => {
  const radiusOf = (build: number) => {
    const sim = new Simulation(),
      shooter = sim.addPlayer(1);
    const gun = PROPS.findIndex((p) => p.kind === "gun") + 1;
    sim.owners.set(gun, 1);
    shooter.state.held = gun;
    shooter.state.build = build;
    assert.ok(sim.shoot(1));
    const r = [...sim.pellets.values()][0].body.collider(0).radius();
    sim.dispose();
    return r;
  };
  assert.ok(Math.abs(radiusOf(0) - 0.1) < 1e-6, "a plain pellet is small");
  assert.ok(Math.abs(radiusOf(cardBit("big-ball")) - 0.3) < 1e-6, "the card triples it");
});
test("a bounce pad launches you toward its perch", () => {
  const sim = new Simulation(),
    c = sim.addPlayer(1);
  let seq = 0;
  const pad = PADS[0];
  // Drop onto the pad from just above it, feet-first and dead slow.
  sim.restore(c, { ...c.state, x: pad.x, y: 1.5, z: pad.z, vx: 0, vy: 0, vz: 0 });
  for (let i = 0; i < 60 && !(c.state.flags & 1); i++) {
    sim.motor(c, { seq: ++seq, x: 0, z: 0, yaw: 0, pitch: 0, buttons: 0 });
    sim.step();
  }
  assert.ok(c.state.flags & 1, "the landing is on the pad");
  assert.ok(Math.abs(c.state.vx - pad.vx) < 0.5, "launched along the pad's x shove");
  assert.ok(Math.abs(c.state.vz - pad.vz) < 0.5, "launched along the pad's z shove");
  assert.ok(c.state.vy >= pad.bounce - 1, "and up at near-pad speed");
  sim.dispose();
});
test("junk props exist and rest on the floor", () => {
  const sim = new Simulation();
  sim.addPlayer(1);
  for (let i = 0; i < 30; i++) sim.step();
  for (const kind of ["chair", "table", "trashcan", "bottle", "bucket"] as const) {
    const id = PROPS.findIndex((p) => p.kind === kind) + 1;
    assert.ok(id >= 2, `${kind} is in PROPS`);
    const st = sim.propStates().find((p) => p.id === id)!;
    assert.ok(st.y > 0.05 && st.y < 1.2, `${kind} rests on the floor`);
  }
  assert.equal(sim.propStates().length, PROPS.length, "every prop is simulated");
  sim.dispose();
});
test("teams fill both sides evenly and spill onto the smaller one", () => {
  assert.deepEqual(assignTeams([1, 2, 3, 4], 2), { 1: 0, 2: 1, 3: 0, 4: 1 });
  const five = assignTeams([1, 2, 3, 4, 5], 2);
  assert.equal(five[5], 0, "the fifth joins the tied side first");
  assert.equal(Object.values(five).filter((t) => t === 0).length, 3, "A takes the overflow");
});
test("chaos modifiers are stable per room and round", () => {
  const a = chaosModifierFor("AB12CD", 3);
  assert.equal(a, chaosModifierFor("AB12CD", 3), "the same roll twice");
  assert.ok(MODIFIERS.some((m) => m.id === a), "a real modifier");
});
test("low gravity lets a fall take longer", () => {
  const fall = (env: string) => {
    const sim = new Simulation(),
      c = sim.addPlayer(1);
    sim.setEnv(env);
    // Open sky over the void: no platform below to land on.
    sim.restore(c, { ...c.state, x: 0, y: 8, z: -15, vx: 0, vy: 0, vz: 0 });
    for (let i = 0; i < 60; i++) {
      sim.motor(c, { seq: i + 1, x: 0, z: 0, yaw: 0, pitch: 0, buttons: 0 });
      sim.step();
    }
    const y = c.state.y;
    sim.dispose();
    return y;
  };
  const normal = fall("none");
  assert.ok(fall("low-gravity") > normal + 1, "the moon lets you hang in the air");
});
test("tiny arena shrinks the floor to the centre stage", () => {
  const sim = new Simulation(),
    c = sim.addPlayer(1);
  sim.setEnv("tiny-arena");
  sim.restore(c, { ...c.state, x: 12, y: 0.85, z: 0, vx: 0, vy: 0, vz: 0 });
  sim.motor(c, { seq: 1, x: 0, z: 0, yaw: 0, pitch: 0, buttons: 0 });
  sim.step();
  assert.equal(c.state.out, 1, "x=12 is out of the shrunken arena");
  sim.dispose();
});
test("everything bounces keeps a plain pellet flying", () => {
  const run = (env: string, steps: number) => {
    const sim = new Simulation(),
      shooter = sim.addPlayer(1);
    const gun = PROPS.findIndex((p) => p.kind === "gun") + 1;
    sim.owners.set(gun, 1);
    shooter.state.held = gun;
    // From stage centre, up at the NE perch's underside — a solid face in both envs.
    sim.restore(shooter, { ...shooter.state, x: 0, y: 0.87, z: 0, yaw: -3 * Math.PI / 4, pitch: -0.08, vx: 0, vy: 0, vz: 0 });
    sim.setEnv(env);
    assert.ok(sim.shoot(1));
    for (let i = 0; i < steps; i++) sim.step();
    const size = sim.pellets.size;
    sim.dispose();
    return size;
  };
  assert.equal(run("none", 60), 0, "a plain pellet dies on the perch");
  assert.ok(run("bounce", 45) >= 1, "the chaos floor keeps it flying");
});
test("huge projectiles leave the muzzle bigger and faster", () => {
  const shot = (env: string) => {
    const sim = new Simulation(),
      shooter = sim.addPlayer(1);
    const gun = PROPS.findIndex((p) => p.kind === "gun") + 1;
    sim.owners.set(gun, 1);
    shooter.state.held = gun;
    sim.restore(shooter, { ...shooter.state, x: 0, y: 0.87, z: 2, yaw: 0, pitch: 0, vx: 0, vy: 0, vz: 0 });
    sim.setEnv(env);
    assert.ok(sim.shoot(1));
    const v = [...sim.pellets.values()][0].v;
    sim.dispose();
    return Math.hypot(v.x, v.y, v.z);
  };
  const plain = shot("none");
  assert.equal(plain, WEAPON.pelletSpeed, "a plain round uses the base speed");
  assert.ok(shot("huge-pellets") > plain * 1.49, "the chaos round is a clear +50%");
});
test("slippery floor cuts steering across the whole arena", () => {
  const run = (env: string) => {
    const sim = new Simulation(),
      c = sim.addPlayer(1);
    sim.setEnv(env);
    sim.restore(c, { ...c.state, x: 0, y: 0.85, z: 0, vx: 0, vy: 0, vz: 0 });
    let seq = 0;
    // Measure before both walks fully converge on the target speed.
    for (let i = 0; i < 10; i++) {
      sim.motor(c, { seq: ++seq, x: 0, z: 1, yaw: 0, pitch: 0, buttons: 0 });
      sim.step();
    }
    const vz = Math.abs(c.state.vz);
    sim.dispose();
    return vz;
  };
  const dry = run("none");
  assert.ok(dry > 1, "walking works on dry ground");
  assert.ok(dry - run("slippery") > 0.5, "the chaos floor barely bites");
});
test("cosmetic catalogue is complete and sanitisation strips unknown ids", () => {
  const all = [...SKINS, ...HATS, ...EMOTES, ...VOICE_EFFECTS];
  const ids = new Set(all.map((c) => c.id));
  assert.equal(ids.size, all.length, "ids are unique across the catalogue");
  for (const c of all) assert.ok(c.price >= 0, `${c.id} has a non-negative price`);
  assert.ok(SKINS.some((s) => s.id === DEFAULT_COSMETICS.skin));
  assert.ok(EMOTES.length >= 1 && VOICE_EFFECTS.length >= 1);
  for (const e of EMOTES) assert.ok(e.duration > 0, `${e.id} has a duration`);
  // Garbage reduces to the defaults; known ids survive.
  assert.deepEqual(sanitizeCosmetics(null), DEFAULT_COSMETICS);
  assert.deepEqual(
    sanitizeCosmetics({
      skin: "nope",
      hat: "???",
      voice: "x",
      emotes: ["wave", "dance", "nope"],
    }),
    { ...DEFAULT_COSMETICS, emotes: ["wave", "dance"] },
  );
  // Emote slots are capped and deduplicated.
  const many = sanitizeCosmetics({
    emotes: ["wave", "flex", "taunt", "dance", "wave"],
  });
  assert.equal(many.emotes.length, MAX_EMOTE_SLOTS);
});
test("air dash gives one hard shove per airborne arc", () => {
  const run = (build: number) => {
    const sim = new Simulation(),
      c = sim.addPlayer(1);
    for (let i = 0; i < 30; i++) sim.step();
    c.state.build = build;
    sim.restore(c, { ...c.state, x: 0, y: 0.87, z: 2, vx: 0, vy: 0, vz: 0 });
    sim.motor(c, { seq: 1, x: 0, z: 0, yaw: 0, pitch: 0, buttons: BUTTON.JUMP });
    sim.step();
    const before = c.state.vx;
    sim.motor(c, { seq: 2, x: 1, z: 0, yaw: 0, pitch: 0, buttons: BUTTON.DASH });
    sim.step();
    const first = c.state.vx - before;
    sim.motor(c, { seq: 3, x: 1, z: 0, yaw: 0, pitch: 0, buttons: BUTTON.DASH });
    sim.step();
    const second = c.state.vx - (before + first);
    sim.dispose();
    return { first, second };
  };
  assert.ok(Math.abs(run(0).first) < 2, "without the card, B does nothing");
  const { first, second } = run(cardBit("air-dash"));
  assert.ok(first > 5, `the dash is a hard shove along your steering (${first})`);
  assert.ok(second < first * 0.3, `and it only fires once per arc (${second} vs ${first})`);
});
/** Put a prop in the thrower's eye line and pick it up for real. */
function hold(sim: Simulation, playerId: number, kind: string) {
  const id = PROPS.findIndex((p) => p.kind === kind) + 1;
  const body = sim.props.get(id)!;
  body.setTranslation({ x: 0, y: 1.52, z: 0.5 }, true);
  body.setLinvel({ x: 0, y: 0, z: 0 }, true);
  body.setAngvel({ x: 0, y: 0, z: 0 }, true);
  sim.step();
  assert.ok(sim.pickup(playerId, id), `picking up the ${kind} is accepted`);
  return id;
}
test("angry balls accelerate toward the nearest other player", () => {
  const run = (build: number) => {
    const sim = new Simulation(),
      thrower = sim.addPlayer(1),
      victim = sim.addPlayer(2);
    sim.restore(thrower, { ...thrower.state, x: 0, y: 0.87, z: 2, yaw: 0, pitch: 0, vx: 0, vy: 0, vz: 0 });
    thrower.state.build = build;
    sim.restore(victim, { ...victim.state, x: 3, y: 0.87, z: -3, vx: 0, vy: 0, vz: 0, out: 0 });
    const ball = hold(sim, 1, "ball");
    sim.step();
    assert.ok(sim.release(1, true), "the throw goes through");
    let minDist = Infinity;
    for (let i = 0; i < 240; i++) {
      sim.step();
      const t = sim.props.get(ball)!.translation();
      minDist = Math.min(minDist, Math.hypot(t.x - victim.state.x, t.z - victim.state.z));
    }
    sim.dispose();
    return minDist;
  };
  const plain = run(0),
    angry = run(cardBit("angry-ball"));
  assert.ok(plain > 2.5, `a plain throw flies straight past (${plain})`);
  assert.ok(angry < 1.2, `the angry one homes in on the victim (${angry})`);
});
test("heavy junk makes thrown props hit dramatically harder", () => {
  const run = (build: number) => {
    const sim = new Simulation(),
      thrower = sim.addPlayer(1),
      victim = sim.addPlayer(2);
    sim.restore(thrower, { ...thrower.state, x: 0, y: 0.87, z: 2, yaw: 0, pitch: 0, vx: 0, vy: 0, vz: 0 });
    thrower.state.build = build;
    sim.restore(victim, { ...victim.state, x: 0, y: 0.87, z: -0.5, vx: 0, vy: 0, vz: 0, stagger: 0, out: 0 });
    hold(sim, 1, "crate");
    sim.step();
    assert.ok(sim.release(1, true), "the throw goes through");
    for (let i = 0; i < 240 && victim.state.stagger === 0; i++) sim.step();
    const hp = victim.state.hp;
    sim.dispose();
    return hp;
  };
  const plain = run(0),
    heavy = run(cardBit("heavy-junk"));
  assert.ok(plain < COMBAT.hpMax, "a hard crate hit hurts at all");
  assert.ok(heavy < plain - 10, `heavy junk hurts more (${heavy} vs ${plain})`);
});
test("bounce junk makes props springy until someone picks them up", () => {
  const sim = new Simulation(),
    thrower = sim.addPlayer(1);
  const crate = PROPS.findIndex((p) => p.kind === "crate") + 1;
  sim.owners.set(crate, 1);
  thrower.state.held = crate;
  sim.restore(thrower, { ...thrower.state, x: 0, y: 0.87, z: 2, yaw: 0, pitch: 0, vx: 0, vy: 0, vz: 0 });
  thrower.state.build = cardBit("bounce-junk");
  assert.ok(sim.release(1), "the drop goes through");
  const col = sim.propColliders.get(crate)!;
  assert.ok(Math.abs(col.restitution() - 0.92) < 1e-6, "the dropped crate is springy");
  // Pick it up again and the kind's base bounce comes back.
  const body = sim.props.get(crate)!;
  body.setTranslation({ x: 0, y: 1.52, z: 0.6 }, true);
  body.setLinvel({ x: 0, y: 0, z: 0 }, true);
  sim.step();
  assert.ok(sim.pickup(1, crate), "the re-pick is accepted");
  assert.ok(Math.abs(col.restitution() - 0.18) < 1e-6, "the crate bounces like a crate again");
  sim.dispose();
});
test("dangerous junk turns hard prop hits into a small blast", () => {
  const run = (build: number) => {
    const sim = new Simulation(),
      thrower = sim.addPlayer(1),
      victim = sim.addPlayer(2),
      bystander = sim.addPlayer(3);
    const crate = PROPS.findIndex((p) => p.kind === "crate") + 1;
    sim.owners.set(crate, 1);
    thrower.state.held = crate;
    sim.restore(thrower, { ...thrower.state, x: 0, y: 0.87, z: 2, yaw: 0, pitch: 0, vx: 0, vy: 0, vz: 0 });
    thrower.state.build = build;
    const body = sim.props.get(crate)!;
    body.setTranslation({ x: 0, y: 0.87, z: 0.5 }, true);
    body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    sim.restore(victim, { ...victim.state, x: 0, y: 0.87, z: -0.5, vx: 0, vy: 0, vz: 0, stagger: 0, out: 0 });
    sim.restore(bystander, { ...bystander.state, x: 1.2, y: 0.87, z: -0.5, vx: 0, vy: 0, vz: 0, stagger: 0, out: 0 });
    sim.step();
    assert.ok(sim.release(1, true), "the throw goes through");
    for (let i = 0; i < 240 && victim.state.stagger === 0; i++) sim.step();
    const blast = bystander.state.stagger > 0 || bystander.state.hp < COMBAT.hpMax;
    sim.dispose();
    return blast;
  };
  assert.equal(run(0), false, "a plain throw only hurts whoever it touches");
  assert.equal(run(cardBit("dangerous-junk")), true, "the dangerous one blasts the bystander");
});
test("magnet glove drifts dropped props back to the thrower", () => {
  const sim = new Simulation(),
    thrower = sim.addPlayer(1);
  const crate = PROPS.findIndex((p) => p.kind === "crate") + 1;
  sim.owners.set(crate, 1);
  thrower.state.held = crate;
  sim.restore(thrower, { ...thrower.state, x: 0, y: 0.87, z: 2, vx: 0, vy: 0, vz: 0 });
  thrower.state.build = cardBit("magnet-glove");
  assert.ok(sim.release(1), "the drop goes through");
  const body = sim.props.get(crate)!;
  // Start the crate a few metres out so the drift has something to cover.
  body.setTranslation({ x: 3, y: 0.5, z: 2 }, true);
  body.setLinvel({ x: 0, y: 0, z: 0 }, true);
  let minDist = Infinity;
  for (let i = 0; i < 360; i++) {
    sim.step();
    const t = body.translation();
    minDist = Math.min(minDist, Math.hypot(t.x - thrower.state.x, t.z - thrower.state.z));
  }
  assert.ok(minDist < 1.5, `the crate drifts home (${minDist})`);
  sim.dispose();
});
