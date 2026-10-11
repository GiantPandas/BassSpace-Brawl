// The cosmetic catalogue — pure data, isomorphic. The client's locker
// spends local bucks on these; the host only checks that ids it hears about
// exist in these lists (design doc §18: permanent progression must not
// increase combat power, so nothing here feeds the simulation).

export interface Skin {
  id: string;
  name: string;
  price: number;
  // Hex colors. "classic" leaves the per-player tint alone; any other skin
  // overrides the avatar's jacket/body/nose materials.
  jacket?: string;
  body?: string;
  nose?: string;
}

export interface Hat {
  id: string;
  name: string;
  price: number;
}

export interface Emote {
  id: string;
  name: string;
  price: number;
  // How long the animation plays, in milliseconds.
  duration: number;
}

export interface VoiceEffect {
  id: string;
  name: string;
  price: number;
  // Playback-rate multiplier (tape effect: pitch and speed move together).
  rate?: number;
  // Ring-modulation frequency for the walkie-talkie voice, in Hz.
  radio?: number;
}

export const SKINS: Skin[] = [
  { id: "classic", name: "Classic", price: 0 },
  {
    id: "melon",
    name: "Melon",
    price: 150,
    jacket: "#e34a3f",
    body: "#7cc24b",
    nose: "#fff1d6",
  },
  {
    id: "berry",
    name: "Berry",
    price: 200,
    jacket: "#7a4fd3",
    body: "#ff9ec4",
    nose: "#ffe3f0",
  },
  {
    id: "citrus",
    name: "Citrus",
    price: 200,
    jacket: "#ff8c1a",
    body: "#ffd94a",
    nose: "#fff4d6",
  },
  {
    id: "slime",
    name: "Slime",
    price: 250,
    jacket: "#46c93b",
    body: "#1f7a3d",
    nose: "#d9ffd6",
  },
  {
    id: "midnight",
    name: "Midnight",
    price: 350,
    jacket: "#2b3a67",
    body: "#55617a",
    nose: "#cfd8ea",
  },
];

export const HATS: Hat[] = [
  { id: "cap", name: "Baseball Cap", price: 100 },
  { id: "party", name: "Party Cone", price: 150 },
  { id: "tophat", name: "Top Hat", price: 250 },
  { id: "halo", name: "Halo", price: 400 },
];

export const EMOTES: Emote[] = [
  { id: "wave", name: "Wave", price: 50, duration: 1800 },
  { id: "flex", name: "Flex", price: 100, duration: 2000 },
  { id: "taunt", name: "Taunt", price: 150, duration: 2000 },
  { id: "dance", name: "Dance", price: 250, duration: 3200 },
];

export const VOICE_EFFECTS: VoiceEffect[] = [
  { id: "chipmunk", name: "Chipmunk", price: 200, rate: 1.5 },
  { id: "deep", name: "Deep", price: 200, rate: 0.6 },
  { id: "radio", name: "Walkie-Talkie", price: 300, radio: 42 },
];

/** How many emotes can be bound to hotkeys (Digit1..Digit4). */
export const MAX_EMOTE_SLOTS = 4;

/** What a player currently wears and performs. */
export interface Cosmetics {
  skin: string;
  hat: string | null;
  emotes: string[];
  voice: string | null;
}

export const DEFAULT_COSMETICS: Cosmetics = {
  skin: "classic",
  hat: null,
  emotes: [],
  voice: null,
};

const skins = new Set(SKINS.map((s) => s.id));
const hats = new Set(HATS.map((h) => h.id));
const emotes = new Set(EMOTES.map((e) => e.id));
const voices = new Set(VOICE_EFFECTS.map((v) => v.id));

/**
 * Reduce untrusted input (a JSON message or a localStorage blob) to a valid
 * Cosmetics value. Unknown ids are dropped; the defaults win when in doubt.
 */
export function sanitizeCosmetics(raw: unknown): Cosmetics {
  const out: Cosmetics = { ...DEFAULT_COSMETICS, emotes: [] };
  if (typeof raw !== "object" || raw === null) return out;
  const c = raw as Partial<Cosmetics>;
  if (typeof c.skin === "string" && skins.has(c.skin)) out.skin = c.skin;
  if (typeof c.hat === "string" && hats.has(c.hat)) out.hat = c.hat;
  if (typeof c.voice === "string" && voices.has(c.voice)) out.voice = c.voice;
  if (Array.isArray(c.emotes)) {
    for (const e of c.emotes) {
      if (typeof e === "string" && emotes.has(e) && !out.emotes.includes(e))
        out.emotes.push(e);
      if (out.emotes.length >= MAX_EMOTE_SLOTS) break;
    }
  }
  return out;
}
