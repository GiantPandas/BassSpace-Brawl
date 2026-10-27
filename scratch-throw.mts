import { Simulation } from "file:///C:/Users/Raver/Documents/OpenCodeProjects/BassSpace%20Brawl/src/shared/simulation.ts";
import { PROPS } from "file:///C:/Users/Raver/Documents/OpenCodeProjects/BassSpace%20Brawl/src/shared/level.ts";
import { initPhysics, Simulation } from "./src/shared/simulation.js";

await initPhysics();

const sim = new Simulation();
const thrower = sim.addPlayer(1);
const victim = sim.addPlayer(2);
sim.restore(thrower, { ...thrower.state, x: 0, y: 0.87, z: 2, yaw: 0, pitch: 0, vx: 0, vy: 0, vz: 0 });
sim.restore(victim, { ...victim.state, x: 0, y: 0.87, z: -0.5, vx: 0, vy: 0, vz: 0, stagger: 0, out: 0 });

const id = PROPS.findIndex((p) => p.kind === "trashcan") + 1;
const body = sim.props.get(id)!;
body.setTranslation({ x: 0, y: 1.52, z: 0.5 }, true);
body.setLinvel({ x: 0, y: 0, z: 0 }, true);
body.setAngvel({ x: 0, y: 0, z: 0 }, true);
sim.step();
console.log("pickup:", sim.pickup(1, id));
sim.step();
console.log("release:", sim.release(1, true));
for (let i = 0; i < 90; i++) {
  sim.step();
  const t = sim.props.get(id)?.translation();
  const v = sim.props.get(id)?.linvel();
  if (i < 24 || victim.state.stagger)
    console.log(
      i,
      `can ${t ? `${t.x.toFixed(2)},${t.y.toFixed(2)},${t.z.toFixed(2)}` : "gone"} v ${v ? `${v.x.toFixed(1)},${v.y.toFixed(1)},${v.z.toFixed(1)}` : "-"}`,
      `victim ${victim.state.x.toFixed(2)},${victim.state.y.toFixed(2)},${victim.state.z.toFixed(2)} hp ${victim.state.hp} stagger ${victim.state.stagger}`,
    );
}
sim.dispose();
