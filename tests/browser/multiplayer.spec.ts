import { test, expect, type Page } from "@playwright/test";
async function create(page: Page, name: string) {
  await page.goto("/?test=1");
  await expect(page.locator("#loading")).toBeHidden();
  await page.getByLabel("Your name").fill(name);
  await page.getByRole("button", { name: "Create a room" }).click();
  await expect(page.locator("#hud")).toBeVisible();
  return (await page.locator("#room-code").textContent())!;
}
async function join(page: Page, code: string, name: string, wasm = false) {
  await page.goto(`/?test=1&fresh=1&room=${code}${wasm ? "&wasm=1" : ""}`);
  await expect(page.locator("#loading")).toBeHidden();
  await page.getByLabel("Your name").fill(name);
  await page.getByRole("button", { name: "Join →", exact: true }).click();
  await expect(page.locator("#hud")).toBeVisible();
}
const state = (page: Page) =>
  page.evaluate(() => (window as any).__friendslop.state);
/** Drive a client the way a player would: hold W and steer toward a point. */
async function controls(page: Page) {
  await page.evaluate(() => {
    const d = (window as any).__friendslop;
    (window as any).walkTo = async (tx: number, tz: number, timeout = 14000) => {
      const started = performance.now();
      d.input("ShiftLeft", true);
      d.input("KeyW", true);
      while (performance.now() - started < timeout) {
        const s = d.state,
          dx = tx - s.x,
          dz = tz - s.z;
        if (Math.hypot(dx, dz) < 0.7) break;
        d.look(Math.atan2(-dx, -dz), 0);
        await new Promise((r) => requestAnimationFrame(r));
      }
      d.input("KeyW", false);
      d.input("ShiftLeft", false);
      await new Promise((r) => setTimeout(r, 260));
      return d.state;
    };
    // Aim at a thing rather than at a guessed angle; props settle where they like.
    (window as any).aimAt = async (x: number, y: number, z: number) => {
      const s = d.state;
      d.look(
        Math.atan2(-(x - s.x), -(z - s.z)),
        Math.atan2(-(y - (s.y + 0.65)), Math.hypot(x - s.x, z - s.z)),
      );
      await new Promise((r) => setTimeout(r, 260));
    };
    (window as any).aimAtProp = async (id: number) => {
      const p = d.scene.props.get(id).position;
      await (window as any).aimAt(p.x, p.y, p.z);
      return d.sim.target(d.state);
    };
  });
}
const walkTo = (page: Page, x: number, z: number) =>
  page.evaluate(([x, z]) => (window as any).walkTo(x, z), [x, z] as const);
test("Chrome lobby, authoritative movement and reconnect", async ({
  page,
  context,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await expect(page.locator("#loading")).toBeHidden();
  const github = page.getByRole("link", {
    name: "Get BassSpace Brawl on GitHub",
  });
  await expect(github).toHaveAttribute(
    "href",
    "https://github.com/larshurrelb/friendslop-base",
  );
  await expect(github).toHaveAttribute("target", "_blank");
  await page.screenshot({ path: "test-results/lobby.png" });
  const code = await create(page, "Scout");
  const friend = await context.newPage();
  await join(friend, code, "Moss");
  await expect(page.locator("#player-count")).toHaveText("2 / 8");
  const friendId = (await state(friend)).id;
  const before = await state(page);
  // Face the centre: generated arenas keep the ring around it walkable.
  await page.evaluate(() => {
    const s = (window as any).__friendslop.state;
    (window as any).__friendslop.look(Math.atan2(s.x, s.z), 0);
  });
  await page.evaluate(() => (window as any).__friendslop.input("KeyW", true));
  await expect
    .poll(async () => {
      const now = await state(page);
      return Math.hypot(now.x - before.x, now.z - before.z);
    })
    .toBeGreaterThan(2);
  await page.evaluate(() => (window as any).__friendslop.input("KeyW", false));
  await page.screenshot({ path: "test-results/room.png" });
  await friend.reload();
  await expect(friend.locator("#loading")).toBeHidden();
  await friend.getByRole("button", { name: "Join →", exact: true }).click();
  await expect(friend.locator("#hud")).toBeVisible();
  await expect(page.locator("#player-count")).toHaveText("2 / 8");
  expect((await state(friend)).id).toBe(friendId);
  expect(errors).toEqual([]);
});
test("three Chrome peers: native P2P, WASM relay, isolated failure and upgrade", async ({
  context,
}) => {
  const a = await context.newPage(),
    b = await context.newPage(),
    c = await context.newPage();
  const errors: string[] = [];
  for (const p of [a, b, c]) p.on("pageerror", (e) => errors.push(e.message));
  const code = await create(a, "Ash");
  await join(b, code, "Birch", true);
  await join(c, code, "Cedar");
  for (const p of [a, b, c]) {
    await p.getByRole("button", { name: "Enable voice", exact: true }).click();
    await expect
      .poll(
        async () =>
          p.evaluate(() => (window as any).__friendslop?.voice.status),
        { timeout: 15000 },
      )
      .not.toMatch(/Preparing|unavailable/);
    await expect(
      p.getByRole("button", { name: "Audio on", exact: true }),
    ).toBeVisible();
  }
  const routes = (p: Page) =>
    p.evaluate(() =>
      [...(window as any).__friendslop.voice.peers.values()].map((x: any) => ({
        id: x.id,
        state: x.state,
        relay: x.relay,
        packets: x.packets,
        pcm: x.pcm,
        buffer: x.bufferMs,
        rms: x.rms,
      })),
    );
  await expect
    .poll(
      async () => (await routes(a)).filter((x) => x.state === "DIRECT").length,
      { timeout: 30000 },
    )
    .toBe(2);
  await expect
    .poll(
      async () => (await routes(b)).filter((x) => x.state === "DIRECT").length,
      { timeout: 30000 },
    )
    .toBe(2);
  await a.evaluate(() => (window as any).__friendslop.voice.force(2, true));
  await expect
    .poll(async () => (await routes(a)).find((x) => x.id === 2)?.state)
    .toBe("RELAY");
  await expect
    .poll(
      async () =>
        await b.evaluate(() => (window as any).__friendslop.voice.received),
    )
    .toBeGreaterThan(20);
  await expect
    .poll(async () => (await routes(b)).find((x) => x.id === 1)?.rms ?? 0)
    .toBeGreaterThan(0.001);
  expect((await routes(a)).find((x) => x.id === 3)?.state).toBe("DIRECT");
  await a.evaluate(() => (window as any).__friendslop.voice.force(2, false));
  await expect
    .poll(async () => (await routes(a)).find((x) => x.id === 2)?.state, {
      timeout: 45000,
    })
    .toBe("DIRECT");
  await b.getByRole("button", { name: "Mute microphone" }).click();
  expect(await b.evaluate(() => (window as any).__friendslop.voice.gate)).toBe(
    false,
  );
  // Abrupt one-pair media failure triggers automatic relay, without a room-wide switch.
  await a.evaluate(() => {
    const p = (window as any).__friendslop.voice.peers.get(2);
    p.pc.close();
  });
  await expect
    .poll(async () => (await routes(a)).find((x) => x.id === 2)?.relay, {
      timeout: 10000,
    })
    .toBe(true);
  expect((await routes(a)).find((x) => x.id === 3)?.relay).toBe(false);
  await expect
    .poll(async () => (await routes(a)).find((x) => x.id === 2)?.state, {
      timeout: 45000,
    })
    .toBe("DIRECT");
  expect(errors).toEqual([]);
});
test("Chrome pointer lock, Blender character, pickup, throw and crouch", async ({
  page,
  context,
}) => {
  const code = await create(page, "Fern");
  const friend = await context.newPage();
  await join(friend, code, "Clay");
  await controls(page);
  const backed = await state(page);
  await page.evaluate(() => (window as any).__friendslop.input("KeyS", true));
  // Back up a little on the slab. Any generated arena may put a perch, a pad
  // or cover wall in the old straight-line path, so measure distance moved.
  await expect
    .poll(async () => {
      const now = await state(page);
      return Math.hypot(now.x - backed.x, now.z - backed.z);
    })
    .toBeGreaterThan(1.5);
  await page.evaluate(() => {
    (window as any).__friendslop.input("KeyS", false);
    (window as any).__friendslop.look(0.6, 0.05);
  });
  await page.bringToFront();
  await page.getByRole("button", { name: "Click to explore →" }).click();
  await expect
    .poll(() => page.evaluate(() => !!document.pointerLockElement))
    .toBe(true);
  await expect(page.locator("#pause")).toBeHidden();
  await page.keyboard.press("Tab");
  await expect
    .poll(() =>
      page.evaluate(() => {
        const d = (window as any).__friendslop;
        return d.cameraMode === "third" && d.scene.avatars.has(d.state.id);
      }),
    )
    .toBe(true);
  await page.keyboard.press("Tab");
  await expect
    .poll(() =>
      page.evaluate(() => {
        const d = (window as any).__friendslop;
        return d.cameraMode === "first" && !d.scene.avatars.has(d.state.id);
      }),
    )
    .toBe(true);
  await page.screenshot({ path: "test-results/character.png" });
  const faced = await state(page);
  await page.evaluate(() => {
    (window as any).__friendslop.look(0, 0.55);
    (window as any).__friendslop.input("KeyW", true);
  });
  await expect
    .poll(async () => {
      const now = await state(page);
      return Math.hypot(now.x - faced.x, now.z - faced.z);
    }, { timeout: 15000 })
    .toBeGreaterThan(1.5);
  await page.evaluate(() => (window as any).__friendslop.input("KeyW", false));
  // Aim at a real prop rather than a guessed angle; props settle where they like.
  const picked = await page.evaluate(async () => {
    const d = (window as any).__friendslop,
      s = d.state;
    // Props on the slab the player is actually standing on: walking to another
    // level means crossing the void, which eliminates them mid-test.
    const top = (b: any) => b.p[1] + b.s[1] / 2;
    // The slab you are standing on: it must contain you, not merely sit below.
    const over = (b: any) =>
      Math.abs(s.x - b.p[0]) <= b.s[0] / 2 && Math.abs(s.z - b.p[2]) <= b.s[2] / 2;
    const box = d.sim.arena.level
      .filter((b: any) => over(b) && top(b) <= s.y + 0.6)
      .sort((a: any, b: any) => top(b) - top(a))[0];
    if (!box) return 0;
    const all = d.sim.arena.props
      .map((p: any, i: number) => ({
        id: i + 1,
        x: p.p[0],
        z: p.p[2],
        d: (p.p[0] - s.x) ** 2 + (p.p[2] - s.z) ** 2,
        ok:
          Math.abs(p.p[1] - (top(box) + 0.5)) <= 0.01 &&
          Math.abs(p.p[0] - box.p[0]) <= box.s[0] / 2 &&
          Math.abs(p.p[2] - box.p[2]) <= box.s[2] / 2,
      }))
      .sort((a: any, b: any) => a.d - b.d);
    // Nothing on your own slab? The nearest one elsewhere still beats failing,
    // and a short walk across a gap is survivable.
    const near = (all.filter((c: any) => c.ok).length
      ? all.filter((c: any) => c.ok)
      : all
    ).slice(0, 5);
    // Props settle where they like and a pad or cover wall can sit in the way:
    // walk to each nearby one and sweep the aim until the eye ray lands on it.
    for (const c of near) {
      await (window as any).walkTo(c.x, c.z);
      const mesh = d.scene.props.get(c.id)?.position;
      if (!mesh) continue;
      for (let i = 0; i < 4; i++) {
        await (window as any).aimAt(mesh.x, mesh.y + (i - 1) * 0.1, mesh.z);
        if (d.sim.target(d.state) === c.id) return c.id;
      }
    }
    return 0;
  });
  expect(picked).toBeGreaterThan(0);
  await page.evaluate(() => (window as any).__friendslop.action());
  await expect.poll(async () => (await state(page)).held).toBeGreaterThan(0);
  const held = (await state(page)).held;
  await expect
    .poll(() =>
      friend.evaluate(
        (object) => (window as any).__friendslop.sim.owners.get(object),
        held,
      ),
    )
    .toBe(1);
  await page.screenshot({ path: "test-results/holding.png" });
  await page.evaluate(() => (window as any).__friendslop.action(true));
  await expect.poll(async () => (await state(page)).held).toBe(0);
  // Crouch somewhere nothing hangs overhead. A player wedged under a table
  // cannot stand, and every room code scatters its furniture differently, so
  // the open centre slab is the one spot this assertion can rely on.
  await walkTo(page, 0, 0);
  await page.evaluate(() => (window as any).__friendslop.input("KeyC", true));
  await expect.poll(async () => (await state(page)).flags & 2).toBe(2);
  await page.evaluate(() => (window as any).__friendslop.input("KeyC", false));
  await expect.poll(async () => (await state(page)).flags & 2).toBe(0);
});
test("eight Chrome players sustain the mesh and all-relay room", async ({
  context,
}) => {
  test.setTimeout(150000);
  const pages: Page[] = [];
  for (let i = 0; i < 8; i++) pages.push(await context.newPage());
  const code = await create(pages[0], "Player 1");
  for (let i = 1; i < 8; i++)
    await join(pages[i], code, `Player ${i + 1}`, i % 2 === 1);
  // Eight audio stacks share one machine: pause game animation/physics in this voice-only stress test.
  for (const p of pages)
    await p.evaluate(() => {
      window.requestAnimationFrame = () => 0;
    });
  for (const p of pages) {
    await p.getByRole("button", { name: "Enable voice", exact: true }).click();
    await expect(
      p.getByRole("button", { name: "Audio on", exact: true }),
    ).toBeVisible();
  }
  for (const p of pages)
    await expect
      .poll(
        () =>
          p.evaluate(
            () =>
              [...(window as any).__friendslop.voice.peers.values()].filter(
                (p: any) => p.state === "DIRECT" || p.state === "RELAY",
              ).length,
          ),
        { timeout: 40000 },
      )
      .toBe(7);
  for (const p of pages)
    await p.evaluate(() => {
      const d = (window as any).__friendslop;
      for (const id of d.voice.peers.keys())
        if (d.state.id < id) d.voice.force(id, true);
    });
  try {
    for (const p of pages) {
      await expect
        .poll(
          () =>
            p.evaluate(
              () =>
                [...(window as any).__friendslop.voice.peers.values()].filter(
                  (p: any) => p.relay && p.pcm > 2880 && p.rms > 0.001,
                ).length,
            ),
          { timeout: 25000 },
        )
        .toBe(7);
    }
  } catch (error) {
    for (const p of pages)
      console.log(
        "VOICE DIAGNOSTICS",
        await p.evaluate(() => {
          const v = (window as any).__friendslop.voice;
          return {
            id: v.identity,
            received: v.received,
            sent: v.sent,
            level: v.level,
            gate: v.gate,
            status: v.status,
            context: v.spatial.context.state,
            peers: [...v.peers.values()].map((p: any) => ({
              id: p.id,
              state: p.state,
              relay: p.relay,
              pcm: p.pcm,
              rms: p.rms,
              active: p.active,
              reason: p.reason,
              buffer: p.bufferMs,
              underruns: p.underruns,
            })),
          };
        }),
      );
    throw error;
  }
  const start = await pages[0].evaluate(
    () => (window as any).__friendslop.voice.received,
  );
  await expect
    .poll(
      () =>
        pages[0].evaluate(() => (window as any).__friendslop.voice.received),
      { timeout: 10000 },
    )
    .toBeGreaterThan(start + 700);
  expect(await pages[0].locator("#player-count").textContent()).toBe("8 / 8");
});
test("embedded preview fallback enables real WASD and drag-look after a canvas click", async ({
  page,
}) => {
  await page.addInitScript(() => {
    Element.prototype.requestPointerLock = () =>
      Promise.reject(
        new DOMException(
          "Embedded preview does not support capture",
          "NotSupportedError",
        ),
      );
  });
  await page.goto("/");
  await expect(page.locator("#loading")).toBeHidden();
  await page.getByRole("button", { name: "Create a room" }).click();
  await expect(page.locator("#hud")).toBeVisible();
  await page.bringToFront();
  await page.locator("canvas").click({ position: { x: 180, y: 260 } });
  await expect(page.locator("#pause")).toBeHidden();
  await expect(page.locator("#toast")).toContainText("Preview controls");
  const before = await state(page);
  await page.keyboard.down("w");
  await expect
    .poll(async () => (await state(page)).z)
    .toBeLessThan(before.z - 0.5);
  await page.keyboard.up("w");
  await page.mouse.move(250, 300);
  await page.mouse.down();
  await page.mouse.move(420, 330, { steps: 6 });
  await page.mouse.up();
  await expect
    .poll(async () => Math.abs((await state(page)).yaw - before.yaw))
    .toBeGreaterThan(0.2);
  await page.keyboard.press("Escape");
  await expect(page.locator("#pause")).toBeVisible();
});

test("original jump and footstep audio works without enabling the microphone", async ({
  page,
}) => {
  await create(page, "Pip");
  await page.getByRole("button", { name: "Click to explore →" }).click();
  await expect
    .poll(() =>
      page.evaluate(
        () => (window as any).__friendslop.voice.spatial?.context.state,
      ),
    )
    .toBe("running");
  await page.evaluate(() => {
    const d = (window as any).__friendslop,
      spatial = d.voice.spatial;
    const played: string[] = [];
    (window as any).__sounds = played;
    const original = spatial.effect.bind(spatial);
    spatial.effect = (p: any, kind: string) => {
      played.push(kind);
      original(p, kind);
    };
    const analyser = spatial.context.createAnalyser();
    analyser.fftSize = 512;
    spatial.master.connect(analyser);
    (window as any).__audioPeak = 0;
    setInterval(() => {
      const samples = new Float32Array(512);
      analyser.getFloatTimeDomainData(samples);
      (window as any).__audioPeak = Math.max(
        (window as any).__audioPeak,
        ...samples.map(Math.abs),
      );
    }, 20);
  });
  // Generated arenas put spawn a couple of metres from an edge: face the
  // centre slab before walking, or the walker backs into the void.
  await page.evaluate(() => {
    const s = (window as any).__friendslop.state;
    (window as any).__friendslop.look(Math.atan2(s.x, s.z), 0);
  });
  await page.keyboard.down("w");
  await expect
    .poll(() => page.evaluate(() => (window as any).__sounds.includes("step")))
    .toBe(true);
  await page.keyboard.up("w");
  // A generated arena can launch the walker on a bounce pad: a jump pressed
  // mid-air is rejected by the motor, so the sound never fires, and the pad
  // launch itself plays a jump. Land, then count jumps made after the press.
  await expect
    .poll(() =>
      page.evaluate(() => (window as any).__friendslop.state.flags & 1),
    )
    .toBe(1);
  const jumps = () =>
    page.evaluate(
      () =>
        (window as any).__sounds.filter((s: string) => s === "jump").length,
    );
  const before = await jumps();
  await page.keyboard.press("Space", { delay: 100 });
  await expect.poll(() => jumps()).toBeGreaterThan(before);
  await expect
    .poll(() => page.evaluate(() => (window as any).__audioPeak))
    .toBeGreaterThan(0.005);
  expect(
    await page.evaluate(() => (window as any).__friendslop.voice.stream),
  ).toBeUndefined();
});

test("refined Blender wardrobe, articulated crouch and talking mouth", async ({
  page,
}) => {
  await create(page, "Model review");
  const poses = await page.evaluate(async () => {
    const nextFrame = window.requestAnimationFrame.bind(window);
    window.requestAnimationFrame = () => 0;
    await new Promise<void>((resolve) => nextFrame(() => resolve()));
    const d = (window as any).__friendslop,
      scene = d.scene;
    for (const element of document.querySelectorAll<HTMLElement>(
      "#hud, #pause, header, .world-labels",
    ))
      element.style.display = "none";
    const states = [0, 1, 2].map((i) => ({
      ...d.state,
      id: 101 + i,
      x: -1.05 + i * 1.05,
      y: 0.85,
      z: 5,
      yaw: Math.PI + (i === 2 ? -0.85 : 0),
      pitch: 0,
      flags: 1,
      held: 0,
      vx: 0,
      vz: 0,
    }));
    const avatars = states.map((s, i) => scene.updatePlayer(s, "", 0.2, i));
    const bonePosition = (a: any, name: string) =>
      a.root
        .getObjectByName(name)
        .getWorldPosition(scene.camera.position.clone())
        .toArray();
    scene.scene.updateMatrixWorld(true);
    const standingHead = bonePosition(avatars[2], "head"),
      standingFoot = bonePosition(avatars[2], "footL");
    states[2].flags = 3;
    states[2].y = 0.5;
    for (let i = 0; i < 6; i++) scene.updatePlayer(states[2], "", 0.1, 2);
    scene.scene.updateMatrixWorld(true);
    const crouchedHead = bonePosition(avatars[2], "head"),
      crouchedFoot = bonePosition(avatars[2], "footL");
    avatars[1].loudness = 0.07;
    scene.camera.position.set(0, 1.62, 8.4);
    scene.camera.lookAt(0, 1.04, 5);
    scene.render(0.1);
    const mouthOpen = avatars[1].mouth;
    const colors = avatars.map((a: any) => {
      let color = "";
      a.root.traverse((o: any) => {
        for (const m of Array.isArray(o.material)
          ? o.material
          : o.material
            ? [o.material]
            : [])
          if (m.name.startsWith("Jacket")) color = m.color.getHexString();
      });
      return color;
    });
    return {
      standingHead,
      standingFoot,
      crouchedHead,
      crouchedFoot,
      scale: avatars[2].root.scale.toArray(),
      mouthOpen,
      colors,
    };
  });
  await page.screenshot({ path: "artifacts/refined-characters.png" });
  expect(poses.scale).toEqual([1, 1, 1]);
  expect(poses.standingHead[1] - poses.crouchedHead[1]).toBeGreaterThan(0.25);
  expect(Math.abs(poses.standingFoot[1] - poses.crouchedFoot[1])).toBeLessThan(
    0.06,
  );
  expect(poses.mouthOpen).toBeGreaterThan(0.2);
  expect(new Set(poses.colors).size).toBe(3);
});

test("a gun shove, then a bounce pad flings you at the perch", async ({
  page,
  context,
}) => {
  test.setTimeout(150000);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const code = await create(page, "Ranger");
  const friend = await context.newPage();
  await join(friend, code, "Sparrow");
  await controls(page);
  await controls(friend);
  await page.bringToFront();
  // Both start on solid ground: use a gun on that same slab — a different level
  // means crossing the void — and prefer the plain pistol, which shoves rather
  // than detonating.
  const gun = await page.evaluate(async () => {
    const d = (window as any).__friendslop,
      s = d.state;
    const top = (b: any) => b.p[1] + b.s[1] / 2;
    // The slab you are standing on: it must contain you, not merely sit below.
    const over = (b: any) =>
      Math.abs(s.x - b.p[0]) <= b.s[0] / 2 && Math.abs(s.z - b.p[2]) <= b.s[2] / 2;
    const box = d.sim.arena.level
      .filter((b: any) => over(b) && top(b) <= s.y + 0.6)
      .sort((a: any, b: any) => top(b) - top(a))[0];
    if (!box) return 0;
    const all = d.sim.arena.props.map((p: any, i: number) => ({
      id: i + 1,
      kind: p.kind,
      x: p.p[0],
      z: p.p[2],
      d: (p.p[0] - s.x) ** 2 + (p.p[2] - s.z) ** 2,
      gun: p.kind in d.GUNS,
      onSlab:
        Math.abs(p.p[1] - (top(box) + 0.5)) <= 0.01 &&
        Math.abs(p.p[0] - box.p[0]) <= box.s[0] / 2 &&
        Math.abs(p.p[2] - box.p[2]) <= box.s[2] / 2,
    }));
    const guns = all.filter((c: any) => c.gun);
    // Prefer the same slab, then the plain pistol, then whatever is nearest.
    const near = (guns.filter((c: any) => c.onSlab).length
      ? guns.filter((c: any) => c.onSlab)
      : guns
    )
      .sort(
        (a: any, b: any) =>
          (a.kind === "gun" ? 0 : 1) - (b.kind === "gun" ? 0 : 1) || a.d - b.d,
      )
      .slice(0, 5);
    for (const c of near) {
      await (window as any).walkTo(c.x, c.z);
      const mesh = d.scene.props.get(c.id)?.position;
      if (!mesh) continue;
      // Props settle where they like; sweep the aim until the eye ray lands.
      for (let i = 0; i < 4; i++) {
        await (window as any).aimAt(mesh.x, mesh.y + (i - 1) * 0.1, mesh.z);
        if (d.sim.target(d.state) === c.id) return c.id;
      }
    }
    return 0;
  });
  expect(gun).toBeGreaterThan(0);
  await friend.evaluate(() => (window as any).walkTo(0, 0));
  await page.evaluate(() => (window as any).__friendslop.action());
  await expect.poll(async () => (await state(page)).held).toBe(gun);
  await page.screenshot({ path: "test-results/gun.png" });
  // A cover wall may stand between them: sidestep along it, staying clear of
  // bounce pads, and try again from another angle.
  let before = await state(friend),
    staggered = false;
  for (let shot = 0; shot < 4 && !staggered; shot++) {
    before = await state(friend);
    await page.evaluate(
      ([x, z]) => (window as any).aimAt(x, 1.5, z),
      [before.x, before.z] as const,
    );
    await page.evaluate(() => (window as any).__friendslop.shoot());
    try {
      await expect
        .poll(async () => (await state(friend)).stagger, { timeout: 1500 })
        .toBeGreaterThan(0);
      staggered = true;
    } catch {
      await page.evaluate(
        async ([fx, fz]) => {
          const d = (window as any).__friendslop,
            s = d.state;
          const dx = s.x - fx,
            dz = s.z - fz,
            len = Math.hypot(dx, dz) || 1;
          const cands: number[][] = [
            [s.x - (dz / len) * 1.6, s.z + (dx / len) * 1.6],
            [s.x + (dz / len) * 1.6, s.z - (dx / len) * 1.6],
            [s.x + (dx / len) * 0.9, s.z + (dz / len) * 0.9],
          ];
          const clear = (x: number, z: number) =>
            d.sim.arena.pads.every(
              (p: any) => Math.hypot(p.x - x, p.z - z) > 1.4,
            );
          const pick = cands.find(([x, z]) => clear(x, z)) ?? [s.x, s.z];
          await (window as any).walkTo(pick[0], pick[1]);
        },
        [before.x, before.z] as const,
      );
    }
  }
  expect(staggered).toBe(true);
  await page.screenshot({ path: "test-results/shot.png" });
  await expect
    .poll(async () => {
      const now = await state(friend);
      return Math.hypot(now.x - before.x, now.z - before.z);
    })
    .toBeGreaterThan(1);
  // Nobody dies here: they keep their slot, their name and their footing.
  expect((await state(friend)).y).toBeGreaterThan(0);
  await expect(page.locator("#player-count")).toHaveText("2 / 8");
  // Drop the gun, then stand on the centre-slab pad and ride it toward its perch.
  await page.evaluate(() => (window as any).__friendslop.action());
  await expect.poll(async () => (await state(page)).held).toBe(0);
  const launched = await page.evaluate(async () => {
    const d = (window as any).__friendslop;
    const stage = d.sim.arena.level.find((b: any) => b.kind === "stage");
    const pad = d.sim.arena.pads.find(
      (p: any) =>
        stage &&
          Math.abs(p.x - stage.p[0]) < stage.s[0] / 2 &&
          Math.abs(p.z - stage.p[2]) < stage.s[2] / 2,
    );
    if (pad) await (window as any).walkTo(pad.x, pad.z);
    let maxY = d.state.y;
    const until = performance.now() + 2000;
    while (performance.now() < until) {
      maxY = Math.max(maxY, d.state.y);
      await new Promise((r) => requestAnimationFrame(r));
    }
    return maxY;
  });
  expect(launched).toBeGreaterThan(1.5);
  expect(errors).toEqual([]);
});
test("teams modes split the lobby and wear their badges", async ({
  page,
  context,
}) => {
  const code = await create(page, "Scout");
  const friend = await context.newPage();
  await join(friend, code, "Moss");
  // The mode select is only live in the lobby; both ends stay in sync.
  await expect(page.locator("#mode-select")).toBeVisible();
  await page.locator("#mode-select").selectOption({ value: "teams-3" });
  await expect(friend.locator("#mode-select")).toHaveValue("teams-3");
  await page.getByRole("button", { name: "Ready up" }).click();
  await friend.getByRole("button", { name: "Ready up" }).click();
  // The gate opens: the select hides and both badges appear.
  await expect(page.locator("#mode-select")).toBeHidden();
  await expect(friend.locator("#mode-select")).toBeHidden();
  const badges = page.locator(".team-badge");
  await expect(badges).toHaveCount(2);
  await expect(badges.first()).toHaveText("A");
});
test("the match opens on an upgrade board before round 1", async ({
  page,
  context,
}) => {
  const code = await create(page, "Scout");
  const friend = await context.newPage();
  await join(friend, code, "Moss");
  await page.getByRole("button", { name: "Ready up" }).click();
  await friend.getByRole("button", { name: "Ready up" }).click();
  // The gate opens on a card board, not straight on the countdown.
  await expect(page.locator("#build")).toBeVisible();
  await expect(page.locator("#build-title")).toHaveText("CHOOSE YOUR FIRST UPGRADE");
  await expect(page.locator(".build-card")).toHaveCount(3);
  await expect(friend.locator(".build-card")).toHaveCount(3);
  const card = page.locator(".build-card").nth(1);
  const name = (await card.locator("b").textContent())!;
  // The "Click to explore" panel sits in the same spot as the board. It used to
  // stay up over the middle card and swallow its clicks, so a card could look
  // dead. The board also answers on the click itself: taken, stamped, locked.
  await expect(page.locator("#pause")).toBeHidden();
  await card.click();
  await expect(card).toHaveClass(/taken/);
  await expect(card.locator(".pick-mark")).toHaveText("✓ Locked in");
  await expect(page.locator(".build-cards")).toHaveClass(/locked/);
  await expect(page.locator("#build-title")).toHaveText("CARD LOCKED IN");
  await expect(page.locator("#build-taken")).toHaveText(`Your build: ${name}`);
  await expect(page.locator("#toast")).toHaveText(`Locked in: ${name}`);
  // The rest of the board is spent: the siblings dim and cannot be pressed.
  const spent = page.locator(".build-card").first();
  await expect(spent).not.toHaveClass(/taken/);
  await expect(spent.locator(".pick-mark")).toHaveCount(0);
  // One card each closes the board; the build stays readable through the count.
  await friend.locator(".build-card").first().click();
  await expect(page.locator("#countdown")).toBeVisible();
  await expect(page.locator("#build-title")).toHaveText("YOUR BUILD");
  await expect(page.locator(".build-card")).toHaveCount(0);
  await expect(page.locator("#build-taken")).toHaveText(name);
});
