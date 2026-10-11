# Rebrand plan — Friendslop Base → BassSpace Brawl

Status: **implemented** (see checklist at the bottom). Kept for future reference.

The game's content is already BassSpace Brawl (rounds, HP, Bucks, upgrade cards,
modes in the HUD). This rebrand updates the shell: name, mark, palette, copy,
docs and meta. Decided 2026-10-10.

## Decisions

| Question | Decision |
| --- | --- |
| Palette direction | **Acid house** — keep the light cream base, swap sage for acid lime + deep violet-charcoal ink |
| Logo concept | **Speaker cone + impact arcs**, keeping the tilted rounded-tile silhouette |
| Rename depth | **UI + docs only** — all code identifiers stay (`window.__friendslop`, PeerJS prefix `"friendslop-"`, `friendslop:*` storage keys, `__friendslopPhysicsReady`) |
| GitHub URL | **Keep** `github.com/larshurrelb/friendslop-base` (repo not renamed); only the button label changes |

## 1. Palette

`src/client/style.css` `:root`, `theme-color` in `index.html`, and every
hardcoded sage hex in `style.css` / inline styles in `main.ts`.

| Token | Old | New |
| --- | --- | --- |
| page bg | `#f0f4ee` | keep |
| `--cream` | `#f3f1e6` | keep |
| `--ink` | `#293c32` (sage) | `#2b2545` (deep violet-charcoal) |
| `--green` (accent) | `#d5ec99` (muted sage) | `#c9f24f` (acid lime) |
| `--line` | `#d4d8c8` | `#d7d2c9` (warm neutral) |
| focus outline | `#87a455` | `#96bd2e` (darker lime for contrast on light bg) |
| theme-color | `#192727` | `#2b2545` |

Remapping of other hardcoded hexes: SVG tile `#26382d` → `#2b2545`,
`.brand small` border `#9ea992` → `#b0a6c4`, friends-drawer leave button
`#637554`/`#c4d0b6` → `#8f88ad`/`#cfcbdd`, plus anything else found in the audit.

## 2. Mark

Same 192×192 viewBox, same tilted rounded tile (−11° rotation, rx 46). Inside:
a filled speaker cone (lime disc + ink dome hole) left of centre, two thick
impact arcs fanning right, lime on ink. Must read at 16 px.

Applied **identically** to `public/favicon.svg` and the inline SVG in the
`main.ts` topbar (deliberate duplication — AGENTS.md §6: change both).

```svg
<rect x="17" y="17" width="158" height="158" rx="46" fill="#2b2545" transform="rotate(-11 96 96)"/>
<g stroke="#c9f24f" stroke-width="13" stroke-linecap="round" fill="none">
  <path d="M107.8 62.6A52 52 0 0 1 107.8 129.4"/>
  <path d="M133.5 50.1A80 80 0 0 1 133.5 141.9"/>
</g>
<circle cx="68" cy="96" r="30" fill="#c9f24f"/>
<circle cx="68" cy="96" r="13" fill="#2b2545"/>
```

`aria-label` → "BassSpace Brawl".

## 3. Copy (before → after)

| Surface | New text |
| --- | --- |
| `index.html` title | `BassSpace Brawl` |
| Brand button | aria "About BassSpace Brawl"; wordmark `bassspace <b>brawl</b>` |
| Lobby eyebrow | `2–8 players · one shared house` |
| Lobby H1 | `Turn the bass up.` / `Throw them <em>out.</em>` |
| Intro | `Shove guns, throwable furniture and upgrades that break every round.<br>Built with Three.js, Rapier physics, and proximity voice.` |
| GitHub button | href unchanged; aria-label "Get BassSpace Brawl on GitHub" |
| Lobby foot | `2–8 players` · `Proximity voice` · `Cards between rounds` |
| Footer | `Every round makes the house worse.` + `BASSSPACE BRAWL / v0.1` |
| Pause overlay | eyebrow `The yard is open`, h2 `Break something.`, p `Test the weapons and break the furniture.<br>Then ready up and start the brawl.` (replaces "There's nothing to win. Yet.") |
| About drawer | h3 `A house with a temper.` + one paragraph describing the actual game (replaces starter-kit framing) |
| Loading | `Warming up the bass…` |

Kept (diegetic / still true): zone name "The common room", "No accounts. Just
a room code.", friends drawer ("In good company"), "or find your friends".

## 4. Tests

`tests/browser/multiplayer.spec.ts`: GitHub button aria-label assertion →
"Get BassSpace Brawl on GitHub" (href untouched). No identifier changes, so the
`__friendslop` usages across all suites stay as-is.

## 5. Docs & meta

- **README.md**: logo alt, H1, intro paragraph rewritten to describe the real
  game (fixes the stale "no health, or deaths" claim), image alts, license line.
- **AGENTS.md / CLAUDE.md**: title lines → "BassSpace Brawl" (`__friendslop`
  references stay — still accurate).
- **LICENSE**: `Copyright (c) 2026 BassSpace Brawl contributors`.
- **package.json** + package-lock.json: `"name": "bassspace-brawl"` (two spots in the lock file).
- **Console logs**: `tools/dev.ts`, `src/server/index.ts` → "BassSpace Brawl …".
- **docs/deployment.md**: docker example tags/container names → `bassspace-brawl`;
  Pages URLs stay (repo not renamed).
- **docs/architecture.md / docs/voice.md**: minor "starter" phrasing adjusted to match the game framing.

## Out of scope (explicit)

`window.__friendslop`, PeerJS `"friendslop-"` prefix, `friendslop:*` storage
keys, `__friendslopPhysicsReady`, repo URL, `render.yaml` service name
(renaming is a manual Render-dashboard step), `tools/generate-assets.py` temp dir.

## Verification & media

- Gates: `npm run typecheck && npm test && npm run test:server && npm run test:browser`
- Visual check in browser: lobby, topbar wordmark, favicon at 16 px and 34 px,
  button contrast on acid lime.
- Media: `docs/media/lobby.png` replaced with a new lobby shot (PNG — no WebP
  encoder available; old `lobby.webp` preserved in the scratchpad).
  `character.webp` kept as-is: it is a clean in-game view with no UI chrome,
  and the world visuals are unchanged by this rebrand.

## Implementation order & status

1. Palette (`style.css`, `index.html` theme-color, inline hexes in `main.ts`) — done
2. Mark (`favicon.svg` + inline SVG in `main.ts`) — done
3. Copy (`main.ts` template, `index.html` title) — done
4. Test assertion (`multiplayer.spec.ts`) — done
5. Docs & meta (README, AGENTS/CLAUDE, LICENSE, package name, console logs, docs/*.md) — done
6. Gates (typecheck / test / test:server / test:browser + visual check) — done
   (4 pre-existing failures in tests/core.test.ts junk-card tests, unrelated to the rebrand)
7. Media (`docs/media/lobby.png` swapped; `character.webp` kept) — done
