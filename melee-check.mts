// Scratch: why do the crouch and gun-shove browser specs fail after the
// melee/throw change? Print the authority's state each beat.
// NOTE: every evaluate body is a STRING — tsx/esbuild injects `__name` around
// arrow functions, which does not exist in the page.
import { chromium } from "playwright";

const BASE = "http://localhost:3000";
const say = (s: string) => console.log(s);

async function create(page: any, name: string) {
  await page.goto(`${BASE}/?test=1`);
  await page.waitForSelector("#loading", { state: "hidden", timeout: 30000 });
  await page.getByLabel("Your name").fill(name);
  await page.getByRole("button", { name: "Create a room" }).click();
  await page.waitForSelector("#hud", { timeout: 30000 });
  return (await page.locator("#room-code").textContent())!;
}
async function join(page: any, code: string, name: string) {
  await page.goto(`${BASE}/?test=1&fresh=1&room=${code}`);
  await page.waitForSelector("#loading", { state: "hidden", timeout: 30000 });
  await page.getByLabel("Your name").fill(name);
  await page.getByRole("button", { name: "Join →", exact: true }).click();
  await page.waitForSelector("#hud", { timeout: 30000 });
}
async function controls(page: any) {
  await page.evaluate(`(() => {
    const d = window.__friendslop;
    window.walkTo = async (tx, tz, timeout = 14000) => {
      const started = performance.now();
      d.input("ShiftLeft", true);
      d.input("KeyW", true);
      while (performance.now() - started < timeout) {
        const s = d.state;
        if (s.out) break;
        if (Math.hypot(tx - s.x, tz - s.z) < 0.7) break;
        d.look(Math.atan2(-(tx - s.x), -(tz - s.z)), 0);
        await new Promise((r) => requestAnimationFrame(r));
      }
      d.input("KeyW", false);
      d.input("ShiftLeft", false);
      await new Promise((r) => setTimeout(r, 260));
      return { ...d.state };
    };
    window.aimAt = async (x, y, z) => {
      const s = d.state;
      d.look(
        Math.atan2(-(x - s.x), -(z - s.z)),
        Math.atan2(-(y - (s.y + 0.65)), Math.hypot(x - s.x, z - s.z)),
      );
      await new Promise((r) => setTimeout(r, 260));
    };
  })()`);
}
const grab = (page: any) =>
  page.evaluate(`(() => {
    const s = window.__friendslop.state;
    const r = (v) => Math.round(v * 10) / 10;
    return { x: r(s.x), y: r(s.y), z: r(s.z), flags: s.flags, held: s.held,
      out: s.out, stagger: s.stagger, hp: s.hp, pool: s.pool, ammo: s.ammo };
  })()`);

const pickSource = (onlyGuns: boolean) => `(async () => {
  const d = window.__friendslop, s = d.state;
  const top = (b) => b.p[1] + b.s[1] / 2;
  const over = (b) => Math.abs(s.x - b.p[0]) <= b.s[0] / 2 && Math.abs(s.z - b.p[2]) <= b.s[2] / 2;
  const box = d.sim.arena.level.filter((b) => over(b) && top(b) <= s.y + 0.6)
    .sort((a, b) => top(b) - top(a))[0];
  if (!box) return 0;
  const all = d.sim.arena.props.filter((p) => ${onlyGuns ? "p.kind in d.GUNS" : "true"})
    .map((p, i) => ({
      id: d.sim.arena.props.indexOf(p) + 1, x: p.p[0], z: p.p[2],
      d: (p.p[0] - s.x) ** 2 + (p.p[2] - s.z) ** 2,
      ok: Math.abs(p.p[1] - (top(box) + 0.5)) <= 0.01 &&
        Math.abs(p.p[0] - box.p[0]) <= box.s[0] / 2 &&
        Math.abs(p.p[2] - box.p[2]) <= box.s[2] / 2,
    })).sort((a, b) => a.d - b.d);
  const near = (all.filter((c) => c.ok).length ? all.filter((c) => c.ok) : all).slice(0, 5);
  for (const c of near) {
    await window.walkTo(c.x, c.z);
    const mesh = d.scene.props.get(c.id)?.position;
    if (!mesh) continue;
    for (let i = 0; i < 4; i++) {
      await window.aimAt(mesh.x, mesh.y + (i - 1) * 0.1, mesh.z);
      if (d.sim.target(d.state) === c.id) return c.id;
    }
  }
  return 0;
})()`;

const browser = await chromium.launch({
  channel: "chrome",
  headless: true,
  args: ["--autoplay-policy=no-user-gesture-required", "--disable-background-timer-throttling"],
});
const ctx = await browser.newContext({ permissions: ["microphone"] });
const a = await ctx.newPage();
a.on("pageerror", (e: Error) => say(`PAGEERROR A: ${e.message}\n${e.stack}`));
const b = await ctx.newPage();
b.on("pageerror", (e: Error) => say(`PAGEERROR B: ${e.message}`));
const code = await create(a, "Ash");
await join(b, code, "Birch");
say(`room ${code}`);
await controls(a);
await controls(b);
await a.bringToFront();
await new Promise((r) => setTimeout(r, 1500));

const picked = await a.evaluate(pickSource(false));
say(`picked prop ${picked}`);
await a.evaluate(`(() => window.__friendslop.action())()`);
await new Promise((r) => setTimeout(r, 800));
say(`after pickup ${JSON.stringify(await grab(a))}`);
const dump = await a.evaluate(`(() => {
  const d = window.__friendslop, rows = [];
  d.scene.props.forEach((g, id) => rows.push({
    id,
    sceneKind: d.scene.arena.props[id - 1]?.kind ?? "?",
    simKind: d.sim.arena.props[id - 1]?.kind ?? (d.sim.drops.has(id) ? "drop" : "?"),
    kids: g.children.length,
  }));
  return {
    rows,
    sceneProps: d.scene.arena.props.length,
    simProps: d.sim.arena.props.length,
    map: d.scene.props.size,
    raw: JSON.stringify(d.scene.arena.props.slice(12)),
    target: d.sim.target(d.state),
    drops: [...d.sim.drops.keys()],
  };
})()`);
say(`props ${JSON.stringify(dump)}`);
await a.evaluate(`(() => window.__friendslop.action(true))()`);
for (let i = 0; i < 24; i++) {
  await new Promise((r) => setTimeout(r, 250));
  say(`A t${i} ${JSON.stringify(await grab(a))}`);
}
await a.evaluate(`(() => window.__friendslop.input("KeyC", true))()`);
await new Promise((r) => setTimeout(r, 1200));
say(`crouch held ${JSON.stringify(await grab(a))}`);
await a.evaluate(`(() => window.__friendslop.input("KeyC", false))()`);

await a.waitForFunction(`(() => window.__friendslop.state.out === 0)()`, undefined, { timeout: 60000 });
await b.evaluate(`(() => window.walkTo(0, 0))()`);
const gun = await a.evaluate(pickSource(true));
say(`gun ${gun} A=${JSON.stringify(await grab(a))}`);
await a.evaluate(`(() => window.__friendslop.action())()`);
await new Promise((r) => setTimeout(r, 800));
const before = await grab(b);
say(`B before ${JSON.stringify(before)}`);
await a.evaluate(`(() => window.aimAt(${before.x}, 1.5, ${before.z}))()`);
await a.evaluate(`(() => window.__friendslop.shoot())()`);
for (let i = 0; i < 16; i++) {
  await new Promise((r) => setTimeout(r, 250));
  say(`B t${i} ${JSON.stringify(await grab(b))} | A ${JSON.stringify(await grab(a))}`);
}
await browser.close();
