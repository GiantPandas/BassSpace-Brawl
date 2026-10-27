import { chromium } from "playwright";

const browser = await chromium.launch({
  channel: "chrome",
  headless: true,
  args: ["--autoplay-policy=no-user-gesture-required", "--disable-background-timer-throttling"],
});
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
const page = await ctx.newPage();
page.on("pageerror", (e) => console.log("PAGEERROR", e.stack?.split("\n").slice(0, 6).join("\n")));
await page.goto("http://localhost:3000/?test=1&name=Alice");
await page.waitForSelector("#loading", { state: "hidden" });
await page.getByRole("button", { name: "Create a room" }).click();
await page.waitForFunction(() => document.getElementById("room-code")?.innerText.length > 3);
await page.getByRole("button", { name: "Click to explore →" }).click();
await page.waitForFunction(() => !!document.pointerLockElement);

await page.evaluate(`
  const d = window.__friendslop;
  window.walkTo = async function (tx, tz, timeout) {
    timeout = timeout || 14000;
    const started = performance.now();
    d.input("ShiftLeft", true);
    d.input("KeyW", true);
    while (performance.now() - started < timeout) {
      const s = d.state, dx = tx - s.x, dz = tz - s.z;
      if (Math.hypot(dx, dz) < 0.7) break;
      d.look(Math.atan2(-dx, -dz), 0);
      await new Promise((r) => requestAnimationFrame(r));
    }
    d.input("KeyW", false);
    d.input("ShiftLeft", false);
    await new Promise((r) => setTimeout(r, 260));
    return d.state;
  };
  window.aimAt = async function (x, y, z) {
    const s = d.state;
    d.look(
      Math.atan2(-(x - s.x), -(z - s.z)),
      Math.atan2(-(y - (s.y + 0.65)), Math.hypot(x - s.x, z - s.z)),
    );
    await new Promise((r) => setTimeout(r, 260));
  };
`);

const report = await page.evaluate(`
  (() => {
  const d = window.__friendslop, s = d.state;
  const top = (b) => b.p[1] + b.s[1] / 2;
  const over = (b) => Math.abs(s.x - b.p[0]) <= b.s[0] / 2 && Math.abs(s.z - b.p[2]) <= b.s[2] / 2;
  const box = d.sim.arena.level.filter((b) => over(b) && top(b) <= s.y + 0.6).sort((a, b) => top(b) - top(a))[0];
  const near = d.sim.arena.props
    .map((p, i) => ({
      id: i + 1, kind: p.kind, x: p.p[0], z: p.p[2],
      d: Math.hypot(p.p[0] - s.x, p.p[2] - s.z),
      onSlab: Math.abs(p.p[1] - (top(box) + 0.5)) <= 0.01 &&
        Math.abs(p.p[0] - box.p[0]) <= box.s[0] / 2 && Math.abs(p.p[2] - box.p[2]) <= box.s[2] / 2,
    }))
    .filter((c) => c.onSlab)
    .sort((a, b) => a.d - b.d)
    .slice(0, 5);
  return { spawn: { x: +s.x.toFixed(2), y: +s.y.toFixed(2), z: +s.z.toFixed(2) },
    box: { p: box.p, s: box.s, top: top(box) },
    near: near.map((c) => ({ ...c, d: +c.d.toFixed(2) })),
    all: d.sim.arena.props.length,
    meshed: [...d.scene.props].map(([id, g]) => ({
      id,
      kids: g.children.length,
      kind: d.sim.arena.props[id - 1]?.kind,
      hasMat: !!(g.children[0] && g.children[0].material),
    })),
    kinds: d.sim.arena.props.map((p) => p.kind),
  };
  })();
`);
console.log("candidates:", JSON.stringify(report, null, 1));

await page.evaluate((cands) => {
  (window as any).__candidates = cands;
}, report.near);

const detail = await page.evaluate(`
  (async () => {
  const d = window.__friendslop;
  const out = [];
  for (const c of window.__candidates || []) {
    await window.walkTo(c.x, c.z);
    const mesh = d.scene.props.get(c.id)?.position;
    const body = d.sim.props.get(c.id)?.translation();
    const s = d.state;
    const dist = mesh ? Math.hypot(mesh.x - s.x, mesh.z - s.z) : null;
    if (mesh) await window.aimAt(mesh.x, mesh.y, mesh.z);
    out.push({
      id: c.id, kind: c.kind, dist: dist === null ? null : +dist.toFixed(2),
      mesh: mesh ? [+mesh.x.toFixed(2), +mesh.y.toFixed(2), +mesh.z.toFixed(2)] : null,
      body: body ? [+body.x.toFixed(2), +body.y.toFixed(2), +body.z.toFixed(2)] : null,
      pitch: +d.state.pitch.toFixed(2), yaw: +d.state.yaw.toFixed(2),
      target: d.sim.target(d.state), held: d.state.held, out: d.state.out, y: +d.state.y.toFixed(2),
    });
  }
  return out;
  })();
`);
console.log("walked:", JSON.stringify(detail, null, 1));
await browser.close();
