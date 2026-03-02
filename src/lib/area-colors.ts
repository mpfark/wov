/**
 * Derive area colors from emoji using a predefined palette mapping.
 * Maps common emoji categories to HSL hue/saturation values,
 * then generates fill/stroke/header variants from a single base.
 */

// Map emoji codepoints to HSL [hue, saturation, lightness] base values
const EMOJI_COLOR_MAP: Array<{ emojis: string[]; hsl: [number, number, number] }> = [
  // Nature / Forest
  { emojis: ['🌲', '🌳', '🌿', '🍃', '🍀', '☘️', '🌴', '🎋', '🪵'], hsl: [120, 40, 45] },
  // Town / Village / Castle
  { emojis: ['🏘️', '🏠', '🏡', '🏰', '🏛️', '🛖', '⛪', '🕌', '🏗️', '🏢'], hsl: [35, 50, 55] },
  // Cave / Underground
  { emojis: ['🕳️', '⛏️', '🪨', '💎', '🔮'], hsl: [260, 30, 50] },
  // Ruins / Ancient
  { emojis: ['🏚️', '🗿', '⚱️', '🏺', '🪦'], hsl: [20, 30, 45] },
  // Plains / Grassland
  { emojis: ['🌾', '🌻', '🌼', '🐄', '🐑', '🦬'], hsl: [60, 40, 50] },
  // Mountain / Highland
  { emojis: ['⛰️', '🏔️', '🗻', '🦅', '❄️', '🧊'], hsl: [210, 20, 55] },
  // Swamp / Marsh
  { emojis: ['🐸', '🪷', '🦎', '🐊', '🫧'], hsl: [90, 30, 35] },
  // Desert / Arid
  { emojis: ['🏜️', '🌵', '🐪', '🦂', '☀️'], hsl: [40, 55, 55] },
  // Coast / Water
  { emojis: ['🏖️', '🌊', '⚓', '🐚', '🦀', '🐟', '🎣', '⛵', '🚢'], hsl: [195, 50, 50] },
  // Dungeon / Dark
  { emojis: ['💀', '🦇', '👻', '🕸️', '⚔️', '🗡️', '🔥', '☠️'], hsl: [0, 35, 45] },
  // Ice / Tundra
  { emojis: ['🧊', '🌨️', '⛄', '🐧', '🐺'], hsl: [200, 30, 60] },
  // Volcano / Lava
  { emojis: ['🌋', '🔥', '🧨'], hsl: [15, 60, 45] },
  // Magical / Enchanted
  { emojis: ['✨', '🪄', '🧙', '🌟', '💫', '🌈'], hsl: [280, 45, 55] },
  // Graveyard / Undead
  { emojis: ['⚰️', '🪦', '🧟', '🦴'], hsl: [270, 15, 40] },
  // Farm / Rural
  { emojis: ['🌽', '🥕', '🐓', '🐖', '🚜', '🌱'], hsl: [80, 45, 45] },
  // Port / Harbor
  { emojis: ['⚓', '🚢', '⛵', '🏴‍☠️'], hsl: [205, 45, 50] },
];

// Build a fast lookup: emoji → [h, s, l]
const emojiToHsl = new Map<string, [number, number, number]>();
for (const entry of EMOJI_COLOR_MAP) {
  for (const e of entry.emojis) {
    emojiToHsl.set(e, entry.hsl);
  }
}

const DEFAULT_HSL: [number, number, number] = [200, 15, 50];

/** Get the base [h, s, l] for an emoji string. Falls back to neutral gray. */
export function getEmojiBaseHsl(emoji: string): [number, number, number] {
  // Try exact match first
  const direct = emojiToHsl.get(emoji.trim());
  if (direct) return direct;

  // Try each character (for compound emoji like flags)
  for (const char of emoji) {
    const match = emojiToHsl.get(char);
    if (match) return match;
  }

  return DEFAULT_HSL;
}

/** Solid color for headers / text (full opacity, brighter) */
export function getAreaHeaderColor(emoji: string): string {
  const [h, s, l] = getEmojiBaseHsl(emoji);
  return `hsl(${h} ${s}% ${l + 10}%)`;
}

/** Semi-transparent fill for map regions */
export function getAreaFillColor(emoji: string): string {
  const [h, s, l] = getEmojiBaseHsl(emoji);
  return `hsl(${h} ${Math.max(s - 10, 10)}% ${Math.max(l - 15, 20)}% / 0.15)`;
}

/** Semi-transparent stroke for map region outlines */
export function getAreaStrokeColor(emoji: string): string {
  const [h, s, l] = getEmojiBaseHsl(emoji);
  return `hsl(${h} ${s}% ${l}% / 0.6)`;
}

/** Solid color for preview graph rings (50% opacity) */
export function getAreaPreviewColor(emoji: string): string {
  const [h, s, l] = getEmojiBaseHsl(emoji);
  return `hsl(${h} ${s}% ${l}% / 0.5)`;
}
