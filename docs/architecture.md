# Architecture and wire format

## Runtime boundaries

The authority is `createHost()` in `src/host/index.ts`. It speaks only the
`Channel` interface — send, close, message, close-notification, backpressure —
so the same code serves both deployments.

Deployed on Node, one HTTP(S) listener serves compiled client assets,
`/healthz`, game and signaling WebSocket `/ws`, and encoded voice WebSocket
`/voice`. Vite middleware replaces static serving in development.

Deployed as static files, the room creator's browser runs `createHost()` in a
dedicated worker; joining players reach it over WebRTC DataChannels brokered by
PeerJS, one channel per kind. WebRTC is unavailable inside a worker, so every
peer connection is held on the main thread and proxied across `postMessage` by
`src/net/worker-bridge.ts`, which also feeds real `bufferedAmount` back so the
host's backpressure checks still mean something. The host joins itself over
`linkedChannels()` rather than reading the authority directly.

The client chooses at boot by probing `/healthz`, overridable with `?net=`.

Each room owns a Rapier world. At 60 Hz the server consumes at most one fixed
input step per player, applies the shared motor, clamps held-object anchors,
and steps physics. At 20 Hz it emits snapshots. A bounded accumulator avoids a
spiral of catch-up work after an event-loop stall. Hidden or disconnected
clients stop moving after 250 ms without fresh input.

A client keeps unacknowledged inputs and a prediction world with kinematic
prop proxies. On a snapshot, it resets its capsule and motor state to the
server's full-precision state, updates prop proxies, and replays unacknowledged
inputs. The render camera blends small corrections. Remote entities use a
100 ms interpolation buffer and hold the latest state when the buffer runs out.
There is currently no remote extrapolation. Player capsules do not block one
another. Dynamic prop contacts are authoritative and may cause corrections.

## Protocol v5

All numeric binary fields are little-endian. A WebSocket message is a complete
application packet, so no outer length framing is required. Physics never
travels as JSON. Low-frequency lobby, signaling, route control and action
messages use bounded JSON for inspectability.

### Inputs (type 1)

| Field                                         | Bytes |
| --------------------------------------------- | ----: |
| Version = 7, type = 1, input count (max 8)    |     3 |
| Acknowledged baseline tick                    |     4 |
| Repeated: sequence u32                        |     4 |
| Movement x/z: signed i16 normalized to [-1,1] |     4 |
| Yaw/pitch: f32 radians                        |     8 |
| Jump/sprint/crouch/dash bitfield              |     1 |

Two inputs normally travel every 1/30 s. The server caps queued inputs and
rejects non-finite numbers, invalid lengths, duplicate steps and implausibly
far-ahead sequence numbers. The fixed server clock determines movement speed.
The button bits are JUMP = 1, SPRINT = 2, CROUCH = 4, DASH = 8 and BLOCK = 16;
the dash bit is only meaningful with the air-dash card and fires once per
airborne arc on the authority. The block bit raises the shield bubble for
`COMBAT.blockTicks` ticks and the client sends it exactly once per right-click.

### Snapshots (type 2)

Header: version u8, type u8, full flag u8, server tick u32, baseline tick u32,
player count u8, changed-prop count u16.

Each player record is 51 bytes: ID u16, position 3×f32, velocity 3×f32,
yaw/pitch 2×i16 scaled by π/32767, state flags u8, held-item ID u16, stagger
u8, air jumps `jumps` u8, health `hp` u8, eliminated flag `out` u8,
magazine `ammo` u8, spare rounds `reserve` u8, upgrade build `build` u32,
acknowledged input sequence
u32, pool timer `pool` u8, pool launch timer `launch` u8, shield ticks `block`
u8, shield cooldown `cool` u8. Flags encode grounded, crouched, sprinting, and prior jump-button state
for edge-triggered
jumps. Stagger counts the ticks of lost footing left after being struck; while
it runs the motor keeps only `WEAPON.control` of the player's own steering, so
the client replays a shove the same way the server applied it. Version 3 added
the three combat bytes: `hp` is remaining health (0–100), `out` marks a player
eliminated this round (zero health or out of bounds) and inert until respawn,
and `ammo` is the gun's live magazine count. Version 4 adds `jumps`, the air
jumps spent on the current airborne arc (bunny-hop; reset on landing), and
`build`, a bitmask over the upgrade-card list in `src/shared/upgrades.ts` — one
bit per card, kept across respawns and cleared when a new match starts.
Version 5 adds `pool`, the ticks left in the pool basin: falling into the
yard's pool removes the player from combat (no damage taken or dealt, no
firing) until the timer runs out and the water spits them out, and `launch`,
the ticks left on that ballistic flight toward their own spawn. The client
predicts entry and the flight locally and adopts both timers from each snapshot.
Version 6 adds `block`, the ticks left on the right-click shield bubble: the
raise comes from an input (one packet per click) and both sides run the same
motor countdown, so an incoming shot or thrown prop meets the same shield state
on either side and is deflected back toward its source by the authority. Version
7 adds `cool`, the ticks left before the next raise: the raise also starts it,
both sides run the same motor countdown, and a raise seen while `cool` runs is
ignored, so client and authority agree on when the next bubble may go up.
Version 8 adds `reserve`, the rounds left behind the magazine of the gun in hand:
`GUNS[kind].reloads` magazines when the gun is fresh, drained one magazine per
reload the authority completes. Zero means the gun is spent — it reloads nothing,
fires nothing, and throwing it hits as dead weight (`AIR.club`). The supply
belongs to the gun and not to the player: releasing or dropping a gun stores what
is left of it, and picking one up adopts those numbers.

Each prop record is 18 bytes: ID u16, position 3×i16 in centimeters,
quaternion 4×i16 scaled by 32767, owner u16 (0 = free). Normalize reconstructed
quaternions. The room must fit ±327.67 m on each axis. IDs are not reused within
a room lifetime.

All players appear in every snapshot; prop records are sparse. This deliberately
keeps full-precision local reconciliation simple at the eight-player limit.
There are no variable per-field masks or smallest-three quaternions in v5.

Full baselines are sent on join, every two seconds and when resynchronization
is required. Each delta includes every prop that differs from the acknowledged
baseline, not the immediately previous snapshot. Applying delta B to baseline A
therefore does not require receiving an earlier delta. Clients retain a small
baseline history. A missing baseline requests resynchronization by sending 0
in the next input batch. Full player arrays carry player removals. Prop records otherwise describe the
fixed room props; live gun pellets are the exception — they spawn and despawn
mid-room and ride the same sparse prop channel under IDs at or above
`PELLET_ID_BASE`, so a client adds a mesh for an ID it has not seen and removes
one when it vanishes. A prop's kind — crate, ball, gun, bat, horn, chair,
table, trashcan, bottle or bucket — is static, read from `PROPS` by ID on both
sides, and never travels on the wire; a pellet is recognised purely by its ID
range.

### Actions, shots and doors (JSON)

`{type:"action", request, action}` covers `pickup`, `drop`, `throw`, `shoot`,
`swing`, `honk`, `door` and `reload`, deduplicated by `request`. The reply is
`{type:"action-result", request, action, accepted}`.

`shoot` requires a held gun with `ammo > 0` and a server-owned cooldown of that
gun's `cooldown` ticks; a dry trigger reloads only while `reserve` (the gun's own
spare rounds) is above zero. `GUNS` in `level.ts` is the whole arsenal — magazine,
`reloads`, reload, range, pellet speed and lifetime, pellets per shot and spread,
knock,
lift, damage scale, stagger, recoil, blast, gravity arc, radius and sound per
kind — and which gun is in hand is derived from `object`, never sent: kinds are
static and both sides read the same arena. An accepted shot decrements `ammo` and
spawns one live pellet per line — a small dynamic Rapier body that flies from the
muzzle at the gun's speed (gravity off unless the gun arcs, as the launcher does)
and dies on first contact, after the gun's lifetime in ticks, or if it leaves the
arena. The impact is decided by the authority: striking a player adds the gun's
knockback, lift and stagger, and drains health in proportion to the pellet's
pre-bounce speed, scaled by the gun and capped at `COMBAT.maxPerHit`. An armed
pellet — the launcher's shells, or any round under the EXPLOSIVE card — bursts on
contact instead of transferring a hit, and the blast is announced once as
`{type:"explosion", x, y, z}`. A player is eliminated
when health reaches zero or it leaves the arena, leaving it inert until the next
respawn. Every accepted shot is broadcast as `{type:"shot", id, object, x, y, z,
dx, dy, dz, distance, hit, pellet}` — the muzzle origin and direction the clients
draw the tracer from, with `pellet` the live prop's new ID and `dirs` the fan's
directions whenever the gun fires more than one round. Cards override the gun
without touching the wire: TRIPLE SHOT adds two pellets to any fan, HOMING curves
any round, and picking a gun up loads its own magazine and whatever rounds are
left inside it. A shooter draws its
own tracer on the trigger press and ignores the echo of its own shot.

Resupply is authority-side and rides the JSON channel: every `AIR.period` ticks
of a live round the host drops one gun (up to `AIR.max` at once) above a spawn
and broadcasts `{type:"airdrop", id, kind, x, y, z}`. The id is a prop id in the
500–999 band — above the arena's own props, below the pellets — so the gun
travels on the ordinary prop channel and every snapshot moves it. Clients create
a prediction body and a mesh from that message; nothing else is derived
client-side. An untouched gun dissolves after `AIR.linger` ticks and everyone
gets `{type:"airdrop-gone", ids}`; a gun someone picked up is an ordinary prop
from then on, and the countdown retires whatever is left in the air.

`swing` requires a held bat and uses an authority-owned swept sphere over the
short `MELEE.range`; a struck player gets the same kind of shove and stagger as
a gun hit. `{type:"swing", id, object, hit}` drives the visible swing and impact
effects. `honk` requires a held horn and is authority-rate-limited by
`HORN.cooldown`; accepted uses are broadcast as spatial `sound` events.

`door` toggles one hand-worked leaf and is accepted only when that leaf is under
the player's crosshair. Automatic leaves open for anyone within `AUTO_RANGE`,
which both the authority and each client's prediction world compute in
`Simulation.step()`. Every change is broadcast as `{type:"door", id, open}`, and
the join `welcome` carries the full door state. A client applies the broadcast
as the authoritative value and may additionally hold an automatic leaf open for
its own player, so a leaf never flickers between the two sources.

Windows are static level data, not props: each pane's geometry and colour come
from `WINDOWS` in `level.ts`, read by ID on both sides. A pane is a heavy
dynamic body the character cannot push; an impact whose relative speed passes
`WINDOW.break` shatters it — pellets never reach that branch (they die or bounce
on glass) — and the authority removes the collider, so the opening becomes
passable and flying through is the usual out-of-arena elimination. A smashing
player takes impact HP through the ordinary damage path. A break persists for
the whole match: respawns do not reglaze a pane, and only a fresh `Simulation`
does. Every break is broadcast as `{type:"window", id, broken:true}`, and the
join `welcome` carries the full window state, so a late joiner never sees glass
that has already gone.

Impact events are presentation only (design doc §17): while the authority pays
out damage it records every contact whose relative speed passes `IMPACT.floor`
metres per second, with a normalized strength that reaches 1 at `IMPACT.full`,
and tells them as one `{type:"impact", hits:[{x,y,z,s}]}` message per tick
(positions rounded to decimetres, strengths to fifteenths). Pellet-on-player
pairs are left out — the shot broadcast already carries those. Nothing in the
message is physics state; clients only play spatial sound and impact sparks
from it, scaled by `s`.

The lawn mower is a moving hazard on the authority's own patrol loop
(`MOWER` in `level.ts`): each tick it walks its waypoint rectangle, shoves any
player inside its blade radius along its heading (directional shove + lift +
stagger + HP, with a per-player immunity cooldown so one pass hurts once), and
flings loose props in its way. The host tells the room where it is ten times a
second with `{type:"mower", x, z}` (decimetres); clients walk a rendered mower
toward the latest broadcast at patrol speed and play an engine chug that grows
as it closes in. A clip also lands in `impactEvents`, so a mowed player makes
the usual impact sound.

Cosmetics are presentation only (design doc §18 — progression must not increase
combat power). The catalogue lives in `src/shared/cosmetics.ts`; a client tells
the host what it wears with `{type:"cosmetics", cosmetics:{skin,hat,emotes,voice}}`
(on join and on every change), the host validates each id against the catalogue
(`sanitizeCosmetics` drops unknowns) and echoes it back as
`{type:"cosmetics", id, cosmetics}`; `members` carries the same field so late
joiners see what everyone wears. Performing an emote is
`{type:"emote", emote}`, accepted only when that emote is in the sender's
equipped list and the sender last performed one more than 10 s ago, then
broadcast as `{type:"emote", id, emote}`. Nothing here ever reaches the
simulation: skins recolour the avatar clone, hats are procedural meshes, emotes
are runtime bone poses, and voice effects (chipmunk/deep/walkie-talkie) run in
an `AudioWorkletNode` on the receiving client's playback path.

### Match flow (JSON)

The room runs a match machine:
`lobby → build → countdown → round → break → … → match-end`. It starts when at
least two connected members are all ready and re-arms the same way after a match
ends. A `{type:"ready", active}` message
toggles one member's flag; the host rebroadcasts the room state as
`{type:"match", phase, round, rounds, until, ready, winner}` on join, on every
ready toggle and on each transition. `until` is the server tick the current
phase ends at (0 in lobby/match-end); clients derive displayed seconds from
`until − latestTick`. `build` is the upgrade board dealt before round 1, so a
match is fought with a build from the first round; `break` is the same board
between rounds. At a countdown's start the authority respawns everyone to
their spawn; a round ends early when one or fewer players remain, or on timeout,
and the healthiest survivor wins (a tie goes to the lower ID). After the final
round the match winner is whoever took the most rounds. Player slots and IDs
persist across rounds; reconnecting restores the same player.

The authority deals each connected member `MATCH.cardsOffered` cards they do not
already own at the start of a `build` or a `break` and puts that deal on the
wire as `offers: [{id, cards}]` on the same `match` broadcast; the field is
present only while a board is open. A member joining mid-board is dealt their
own cards alone — re-dealing everyone would take back the picks already made.
A `{type:"pick", card}` message claims one card from it; the authority validates
the phase, the deal and
the bitmask, then answers `{type:"pick-result", accepted, card}` and
rebroadcasts the match state. One card per board: once the member owns anything
from the current deal, further picks come back `accepted: false`. The build
itself never needs its own message — it rides the tick as the `build` bitmask in
the player record. The board ends when every connected member holds a card from
the deal, or at `until`, when a random card is handed to whoever is still
browsing; the King is then stacked with one extra card. During `build` anyone
who leaves the arena is respawned rather than eliminated — the yard is still a
playground before round 1.

### Game modes

The machine runs in one of six modes, all defined in `src/shared/match.ts`:
`ffa`, `teams-2/3/4`, `king` and `chaos`. The mode is picked in the lobby only,
by a `{type:"mode", mode}` message from any connected member — last write wins,
validated against the known list. Every `match` broadcast therefore carries
`mode`, plus (in teams modes) `teams`, a record of player ID → 0|1, and (in
king/chaos) `king` and `modifier`.

In teams modes the start gate splits the connected members into two balanced
sides by join order; a mid-match joiner lands on the smaller side. A round goes
to the team with more survivors, then the higher total HP, then the lower
minimum member ID, and every member of the winning team is credited one win —
the shared victory. The match itself ends when one side has taken more rounds;
a dead heat crowns nobody.

In King of the Yard one connected member is drawn at random when the match
starts (re-drawn if the king leaves mid-match). Only the king can win a round:
surviving to timeout, or outlasting everyone else, credits the king; dying does
not credit anyone. In exchange the king is stacked — each break automatically
adds one extra random card they do not already own.

Chaos Mode picks one global environmental modifier per round. Both sides derive
it from the room code and round number (`chaosModifierFor`, a stable hash), so
no physics state crosses the wire: clients apply it to their prediction with
`Simulation.setEnv()` whenever a `match` broadcast names a countdown or round.
The modifiers (low gravity, giant heads, slippery floor, everything bounces,
tiny arena, huge projectiles, random explosions, fast doors) live in the shared
`CHAOS` table; giant heads is purely cosmetic on the client. The `explosions`
modifier additionally booms at a random yard point on an authority-only timer,
broadcast as `{type:"explosion", x, y, z}` exactly like the grill.

### Voice packets (type 3)

| Field                                   |    Bytes |
| --------------------------------------- | -------: |
| Version, type                           |        2 |
| Source player ID, overwritten by server |        2 |
| Capture stream epoch u32                |        4 |
| Packet sequence u32                     |        4 |
| Capture timestamp in 48 kHz samples u32 |        4 |
| Opus payload length u16                 |        2 |
| Raw mono 20 ms Opus packet              | Variable |

Frames are capped at 1500 bytes. A sender uploads once; the server forwards to
peers selected by its pair-route table. Recipients never accept a sender ID
chosen by the originating client. The voice socket authenticates with a random
per-connection ticket issued over the game socket, not a token in the URL.

## Reliability and lifecycle

In server mode both sockets are reliable ordered TCP. In browser-hosted mode
the game channel is a reliable ordered DataChannel and the voice channel is
unordered; peerjs exposes `ordered` but not `maxRetransmits`, so neither is a
true datagram even though the protocol tolerates loss (baseline acks and input
sequence numbers). Inputs, snapshots and voice do not become unreliable by
using binary encoding. Backpressure can prevent sending a new
snapshot, and voice frames can be dropped before sending or expired on playback;
bytes already in the socket cannot be withdrawn. Separate sockets prevent a
large game queue from directly ordering voice behind it, but share the same
underlying network bottleneck.

Room codes locate rooms; random reconnect tokens establish player continuity.
A dead socket neutralizes inputs, drops held objects and reserves the slot for
30 seconds. Lobby moderation passes to a connected member. Rejoining rotates
the voice ticket and reinitializes the client world. A process restart loses
all rooms. In browser-hosted mode the room ends when the host's tab does: there
is no physics-host migration, and reconnect tokens live only in the host's
memory, so a host reload invalidates every token in that room.

WebSocket origins are checked against the request host. Payload sizes, input
queues, action deduplication history and outgoing media buffers are bounded.
Membership is checked before relaying signaling or audio. This is a game
server, not a hardened public matchmaking/abuse-management platform.
