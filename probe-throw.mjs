import { initPhysics, Simulation } from "./src/shared/simulation.ts";
import { PROPS } from "./src/shared/level.ts";
await initPhysics();
const sim = new Simulation();
const t = sim.addPlayer(1);
const crate = PROPS.findIndex((p) => p.kind === "crate") + 1;
sim.owners.set(crate, 1);
t.state.held = crate;
for (let i = 0; i < 30; i++) sim.step();
sim.restore(t, { ...t.state, x: 0, y: 0.87, z: 2, yaw: 0, pitch: 0, vx: 0, vy: 0, vz: 0 });
sim.step();
const body = sim.props.get(crate);
console.log("held pose after settle:", JSON.stringify(body.translation()));
for (const pitch of [0, -0.25]) {
  const sim2 = new Simulation();
  const t2 = sim2.addPlayer(1);
  sim2.owners.set(crate, 1);
  t2.state.held = crate;
  for (let i = 0; i < 30; i++) sim2.step();
  sim2.restore(t2, { ...t2.state, x: 0, y: 0.87, z: 2, yaw: 0, pitch, vx: 0, vy: 0, vz: 0 });
  sim2.step();
  const b2 = sim2.props.get(crate);
  console.log(`pitch ${pitch}: start`, JSON.stringify(b2.translation()));
  for (let i = 0; i < 90; i++) {
    sim2.step();
    if (i % 10 === 0) console.log(`  t${i}`, JSON.stringify(b2.translation()), "v", JSON.stringify(b2.linvel()));
  }
}
