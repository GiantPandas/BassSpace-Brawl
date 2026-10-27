/**
 * BassSpace Brawl upgrade cards (design doc §7). The MVP list is locked here;
 * all implemented effects are wired in the simulation (Phases 2–3, 8).
 */
import { WEAPON } from "./level.js";

export type CardCategory = "projectile" | "knockback" | "movement" | "junk" | "melee";

export type Card = {
  id: string;
  name: string;
  blurb: string;
  category: CardCategory;
};

export const CARDS: Card[] = [
  // Projectile (design doc §7)
  {
    id: "bouncy",
    name: "BOUNCY",
    blurb: "Pellets keep bouncing instead of dying on first contact.",
    category: "projectile",
  },
  {
    id: "triple-shot",
    name: "TRIPLE SHOT",
    blurb: "Fire three pellets in a spread.",
    category: "projectile",
  },
  {
    id: "ricochet",
    name: "RICOCHET",
    blurb: "Pellets change direction after every hit.",
    category: "projectile",
  },
  {
    id: "homing",
    name: "HOMING",
    blurb: "Pellets drift toward the nearest player.",
    category: "projectile",
  },
  {
    id: "big-ball",
    name: "BIG BALL",
    blurb: "Pellets are dramatically bigger.",
    category: "projectile",
  },
  {
    id: "explosive",
    name: "EXPLOSIVE",
    blurb: "Pellet impacts create a powerful physics impulse.",
    category: "projectile",
  },
  {
    id: "speed-round",
    name: "SPEED ROUND",
    blurb: "+50% pellet speed.",
    category: "projectile",
  },
  // Knockback (design doc §7)
  {
    id: "yeet",
    name: "YEET",
    blurb: "+50% knockback from everything you hit with.",
    category: "knockback",
  },
  {
    id: "mega-yeet",
    name: "MEGA YEET",
    blurb: "+100% knockback from everything you hit with.",
    category: "knockback",
  },
  {
    id: "wall-bonk",
    name: "WALL BONK",
    blurb: "Pellets that hit a wall emit a second knockback pulse.",
    category: "knockback",
  },
  {
    id: "chain-reaction",
    name: "CHAIN REACTION",
    blurb: "Knocking a player into another transfers some force.",
    category: "knockback",
  },
  {
    id: "quick-draw",
    name: "QUICK DRAW",
    blurb: "Reload 40% faster.",
    category: "knockback",
  },
  {
    id: "door-slammer",
    name: "DOOR SLAMMER",
    blurb: "Sliding doors launch the players they hit.",
    category: "knockback",
  },
  // Movement (design doc §7)
  {
    id: "bunny-hop",
    name: "BUNNY HOP",
    blurb: "Extra air control.",
    category: "movement",
  },
  {
    id: "super-jump",
    name: "SUPER JUMP",
    blurb: "Massively increased jump force.",
    category: "movement",
  },
  {
    id: "air-dash",
    name: "AIR DASH",
    blurb: "Gain a midair dash (B), once per jump.",
    category: "movement",
  },
  {
    id: "slippery",
    name: "SLIPPERY",
    blurb: "You retain horizontal momentum much longer.",
    category: "movement",
  },
  {
    id: "rocket-legs",
    name: "ROCKET LEGS",
    blurb: "Jumping creates a downward shockwave around you.",
    category: "movement",
  },
  {
    id: "moon-boots",
    name: "MOON BOOTS",
    blurb: "Your gravity is weaker. You are floaty.",
    category: "movement",
  },
  // Junk — thrown props become part of the fight (design doc §8 build C)
  {
    id: "angry-ball",
    name: "ANGRY BALL",
    blurb: "Thrown balls accelerate toward nearby players.",
    category: "junk",
  },
  {
    id: "heavy-junk",
    name: "HEAVY JUNK",
    blurb: "Props you throw hit dramatically harder.",
    category: "junk",
  },
  {
    id: "bounce-junk",
    name: "BOUNCE JUNK",
    blurb: "Props bounce off everything.",
    category: "junk",
  },
  {
    id: "dangerous-junk",
    name: "DANGEROUS JUNK",
    blurb: "Prop impacts create a small physics impulse.",
    category: "junk",
  },
  {
    id: "magnet-glove",
    name: "MAGNET GLOVE",
    blurb: "Dropped props drift back toward your hand.",
    category: "junk",
  },
  // Appended last so the wire bits above never move (design doc §2).
  {
    id: "rubber-bullet",
    name: "RUBBER BULLET",
    blurb: "Projectiles bounce twice before disappearing.",
    category: "projectile",
  },
  // Melee (design doc §8's unarmed lane): the punch is the fallback verb, so it
  // gets a build of its own. Everything here scales `FIST` inside swing().
  {
    id: "iron-fist",
    name: "IRON FIST",
    blurb: "Your punches shove half again as far and wound deeper.",
    category: "melee",
  },
  {
    id: "rapid-jab",
    name: "RAPID JAB",
    blurb: "Your punches recover in half the time.",
    category: "melee",
  },
  {
    id: "long-reach",
    name: "LONG REACH",
    blurb: "Your punch lane is longer and wider.",
    category: "melee",
  },
  {
    id: "rising-cut",
    name: "RISING CUT",
    blurb: "Punches throw their target upward instead of sideways.",
    category: "melee",
  },
  {
    id: "hammer-hands",
    name: "HAMMER HANDS",
    blurb: "A punch that lands creates a small physics impulse.",
    category: "melee",
  },
];

/** Cards whose effects the simulation actually applies (Phases 2–3). */
export const IMPLEMENTED_CARDS = new Set([
  "yeet",
  "mega-yeet",
  "wall-bonk",
  "chain-reaction",
  "quick-draw",
  "bunny-hop",
  "super-jump",
  "slippery",
  "rocket-legs",
  "moon-boots",
  // Projectile cards (Phase 3).
  "bouncy",
  "triple-shot",
  "ricochet",
  "homing",
  "big-ball",
  "explosive",
  "speed-round",
  "rubber-bullet",
  "door-slammer",
  // Junk and air-dash (Phase 8): thrown props carry their thrower's build.
  "air-dash",
  "angry-ball",
  "heavy-junk",
  "bounce-junk",
  "dangerous-junk",
  "magnet-glove",
  // Melee: punch-only, all scaled inside `Simulation.swing()`.
  "iron-fist",
  "rapid-jab",
  "long-reach",
  "rising-cut",
  "hammer-hands",
]);

const CARD_BITS = new Map(CARDS.map((c) => [c.id, 1 << CARDS.indexOf(c)]));
/** Bit for a card id inside the u32 `build` field; 0 for unknown ids. */
export function cardBit(id: string): number {
  return CARD_BITS.get(id) ?? 0;
}

export type BuildStats = {
  /** Multiplicative knockback on everything this player hits with. */
  knockMult: number;
  /** Ground-jump vertical velocity. */
  jumpVel: number;
  /** Air jumps available per airborne arc (bunny-hop). */
  airJumps: number;
  /** Horizontal steering lerp rate (slippery keeps momentum). */
  steerRate: number;
  /** Gravity acceleration in m/s² (moon-boots is floaty). */
  gravity: number;
  /** Ticks a full reload takes. */
  reloadTicks: number;
  rocketLegs: boolean;
  wallBonk: boolean;
  chainReaction: boolean;
  /** Multiplied into the pellet muzzle speed (SPEED ROUND). */
  pelletSpeedMult: number;
  bouncy: boolean;
  ricochet: boolean;
  homing: boolean;
  bigBall: boolean;
  explosive: boolean;
  tripleShot: boolean;
  rubberBullet: boolean;
  doorSlammer: boolean;
  airDash: boolean;
  angryBall: boolean;
  heavyJunk: boolean;
  bounceJunk: boolean;
  dangerousJunk: boolean;
  magnetGlove: boolean;
  /** Punch shove, on top of YEET/MEGA YEET (IRON FIST). */
  meleeKnock: number;
  /** Punch wound, on top of the knockback cards (IRON FIST). */
  meleeImpact: number;
  /** Punch recovery multiplier — RAPID JAB swings again sooner. */
  meleeCooldown: number;
  /** Punch lane length and width together (LONG REACH). */
  meleeReach: number;
  /** Vertical launch on a landed punch (RISING CUT). */
  meleeLift: number;
  /** HAMMER HANDS: a punch that lands bellows outward. */
  hammerHands: boolean;
};

/** Resolve a u32 build bitmask into the numbers the simulation applies. */
export function buildStats(build: number): BuildStats {
  const has = (id: string) => !!(build & cardBit(id));
  let knockMult = 1;
  if (has("yeet")) knockMult *= 1.5;
  if (has("mega-yeet")) knockMult *= 2;
  return {
    knockMult,
    jumpVel: has("super-jump") ? 10 : 6.5,
    airJumps: has("bunny-hop") ? 1 : 0,
    steerRate: has("slippery") ? 7 : 18,
    gravity: has("moon-boots") ? 12 : 18,
    reloadTicks: has("quick-draw")
      ? Math.ceil(WEAPON.reload * 0.6)
      : WEAPON.reload,
    rocketLegs: has("rocket-legs"),
    wallBonk: has("wall-bonk"),
    chainReaction: has("chain-reaction"),
    pelletSpeedMult: has("speed-round") ? 1.5 : 1,
    bouncy: has("bouncy"),
    ricochet: has("ricochet"),
    homing: has("homing"),
    bigBall: has("big-ball"),
    explosive: has("explosive"),
    tripleShot: has("triple-shot"),
    rubberBullet: has("rubber-bullet"),
    doorSlammer: has("door-slammer"),
    airDash: has("air-dash"),
    angryBall: has("angry-ball"),
    heavyJunk: has("heavy-junk"),
    bounceJunk: has("bounce-junk"),
    dangerousJunk: has("dangerous-junk"),
    magnetGlove: has("magnet-glove"),
    meleeKnock: has("iron-fist") ? 1.5 : 1,
    meleeImpact: has("iron-fist") ? 1.4 : 1,
    meleeCooldown: has("rapid-jab") ? 0.5 : 1,
    meleeReach: has("long-reach") ? 1.4 : 1,
    meleeLift: has("rising-cut") ? 2.2 : 1,
    hammerHands: has("hammer-hands"),
  };
}
