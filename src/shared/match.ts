/**
 * BassSpace Brawl match flow and combat numbers (design doc §2/§9/§14).
 * Shared so the client's timers and the host's state machine never drift.
 */
export const MATCH = {
  /** Normal rounds, then one final round (design doc §14). */
  rounds: 5,
  /** Max length of a round in ticks; FFA also ends early on one survivor. */
  roundTicks: 60 * 60,
  /** Build phase after each round: pick a card; unpicked players get a random one. */
  buildPhaseTicks: 15 * 60,
  /** Cards offered per pick. */
  cardsOffered: 3,
};

/** Impact HP: collisions above `threshold` relative m/s do damage (design doc §9). */
export const COMBAT = {
  hpMax: 100,
  /** Relative velocity below which a collision is harmless (m/s). */
  threshold: 7,
  /** Damage per m/s of excess, capped at `maxPerHit` per contact event. */
  damagePerUnit: 3,
  maxPerHit: 30,
  /** Extra shove a wounded fighter takes, as a fraction of the knock they
   * would get at full HP: 1.0 at full HP, 1 + this at zero. */
  knockRamp: 1,
  /** Ticks a raised shield stays up after right-click; u8-safe. */
  blockTicks: 18,
  /** Ticks between shield raises — 4 s; u8-safe. Future upgrade-card packs
   * will scale this gate through buildStats the way knockback cards do. */
  blockCooldown: 240,
};

/** Game modes (design doc §13): FFA default, teams, king, chaos. */
export type ModeId = "ffa" | "teams-2" | "teams-3" | "teams-4" | "king" | "chaos";

export const MODES: { id: ModeId; name: string }[] = [
  { id: "ffa", name: "Free for all" },
  { id: "teams-2", name: "Teams 2v2" },
  { id: "teams-3", name: "Teams 3v3" },
  { id: "teams-4", name: "Teams 4v4" },
  { id: "king", name: "King of the Yard" },
  { id: "chaos", name: "Chaos Mode" },
];

export function isMode(id: unknown): id is ModeId {
  return MODES.some((m) => m.id === id);
}

/** Team size per mode; 0 for non-team modes. */
export function teamSize(mode: string): number {
  return mode === "teams-2" ? 2 : mode === "teams-3" ? 3 : mode === "teams-4" ? 4 : 0;
}

/**
 * Balanced fill for teams modes: `ids` in join order (ascending id), players
 * alternate A/B until one side hits `size`, then the rest go to the smaller
 * side — a tie goes to A. Returns id → 0/1.
 */
export function assignTeams(ids: number[], size: number): Record<number, 0 | 1> {
  const out: Record<number, 0 | 1> = {};
  let a = 0;
  let b = 0;
  for (const id of ids) {
    if (a <= b && a < size) {
      out[id] = 0;
      a++;
    } else if (b < size) {
      out[id] = 1;
      b++;
    } else {
      out[id] = a <= b ? 0 : 1;
      if (out[id] === 0) a++;
      else b++;
    }
  }
  return out;
}

/** Chaos Mode env modifiers (design doc §13). */
export const CHAOS = {
  /** Gravity multiplier for the low-gravity modifier. */
  lowGravityFactor: 0.45,
  /** Grounded steer multiplier for the slippery-floor modifier. */
  slipFactor: 0.35,
  /** Door travel-time multiplier for the fast-doors modifier. */
  doorFactor: 0.35,
  /** Pellet speed / radius multipliers for huge projectiles. */
  pelletSpeedMult: 1.5,
  pelletRadiusMult: 1.8,
  /** Random-explosion boom numbers and cadence (ticks). */
  explosion: { period: 240, radius: 3, force: 7, lift: 3, damage: 15 },
};

export const MODIFIERS = [
  { id: "low-gravity", name: "Low gravity" },
  { id: "giant-heads", name: "Giant heads" },
  { id: "slippery", name: "Slippery floor" },
  { id: "bounce", name: "Everything bounces" },
  { id: "tiny-arena", name: "Tiny arena" },
  { id: "huge-pellets", name: "Huge projectiles" },
  { id: "explosions", name: "Random explosions" },
  { id: "fast-doors", name: "Doors move extremely fast" },
];

/**
 * Deterministic per-round modifier for chaos mode: FNV-1a over the room code,
 * mixed with the round index. Host and every client derive the same id — no
 * wire message needed, only the display name rides the match broadcast.
 */
export function chaosModifierFor(code: string, round: number): string {
  let h = 2166136261 >>> 0;
  for (const ch of code) h = ((h ^ ch.charCodeAt(0)) * 16777619) >>> 0;
  let t = (h ^ (((round - 1) & 0xff) * 0x9e3779b9)) | 0;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  const idx = ((t ^ (t >>> 14)) >>> 0) % MODIFIERS.length;
  return MODIFIERS[idx].id;
}

export function modifierName(id: string): string {
  return MODIFIERS.find((m) => m.id === id)?.name ?? "None";
}
