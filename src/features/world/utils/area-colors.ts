/**
 * Area colors — derived from an explicit per-area-type color stored on
 * `area_types.color` as an `H S L` triplet (e.g. `120 40 45`).
 *
 * This is the WORLD/MAP color system. It is deliberately separate from the
 * combat damage-type color system (`src/shared/combat/damage-types.ts` +
 * event-log tokens): the two must never share a registry or influence each
 * other. Color here is always accompanied by a text label in the UI — it is
 * never the only signal.
 */

export type AreaHsl = [number, number, number];

/** Neutral fallback used for missing, empty or malformed values. */
export const NEUTRAL_AREA_COLOR = '200 15 50';
const NEUTRAL_HSL: AreaHsl = [200, 15, 50];

const TRIPLET_RE = /^(\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)$/;

/** Parse a stored `H S L` triplet. Returns the neutral fallback when invalid. */
export function parseAreaColor(color?: string | null): AreaHsl {
  const m = TRIPLET_RE.exec(String(color ?? '').trim());
  if (!m) return NEUTRAL_HSL;
  const h = Number(m[1]);
  const s = Number(m[2]);
  const l = Number(m[3]);
  if (h > 360 || s > 100 || l > 100) return NEUTRAL_HSL;
  return [h, s, l];
}

/** True when `color` is a well-formed, in-range `H S L` triplet. */
export function isValidAreaColor(color?: string | null): boolean {
  const m = TRIPLET_RE.exec(String(color ?? '').trim());
  if (!m) return false;
  return Number(m[1]) <= 360 && Number(m[2]) <= 100 && Number(m[3]) <= 100;
}

/** Normalize any input to a storable triplet, falling back to neutral. */
export function normalizeAreaColor(color?: string | null): string {
  const [h, s, l] = parseAreaColor(color);
  return `${Math.round(h)} ${Math.round(s)} ${Math.round(l)}`;
}

/** `#rrggbb` → stored `H S L` triplet (for the admin color picker). */
export function hexToAreaColor(hex: string): string {
  const clean = hex.replace('#', '').trim();
  if (clean.length !== 6) return NEUTRAL_AREA_COLOR;
  const r = parseInt(clean.slice(0, 2), 16) / 255;
  const g = parseInt(clean.slice(2, 4), 16) / 255;
  const b = parseInt(clean.slice(4, 6), 16) / 255;
  if ([r, g, b].some(Number.isNaN)) return NEUTRAL_AREA_COLOR;

  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  let h = 0;
  let s = 0;
  if (d !== 0) {
    s = d / (1 - Math.abs(2 * l - 1));
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return `${Math.round(h)} ${Math.round(s * 100)} ${Math.round(l * 100)}`;
}

/** Stored `H S L` triplet → `#rrggbb` (for the admin color picker value). */
export function areaColorToHex(color?: string | null): string {
  const [h, sPct, lPct] = parseAreaColor(color);
  const s = sPct / 100;
  const l = lPct / 100;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const hp = h / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  let [r, g, b] = [0, 0, 0];
  if (hp < 1) [r, g, b] = [c, x, 0];
  else if (hp < 2) [r, g, b] = [x, c, 0];
  else if (hp < 3) [r, g, b] = [0, c, x];
  else if (hp < 4) [r, g, b] = [0, x, c];
  else if (hp < 5) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  const m = l - c / 2;
  const to = (v: number) =>
    Math.round((v + m) * 255).toString(16).padStart(2, '0');
  return `#${to(r)}${to(g)}${to(b)}`;
}

/** Solid color for headers / text (full opacity, brighter) */
export function getAreaHeaderColor(color?: string | null): string {
  const [h, s, l] = parseAreaColor(color);
  return `hsl(${h} ${s}% ${l + 10}%)`;
}

/** Semi-transparent fill for map regions */
export function getAreaFillColor(color?: string | null): string {
  const [h, s, l] = parseAreaColor(color);
  return `hsl(${h} ${Math.max(s - 10, 10)}% ${Math.max(l - 15, 20)}% / 0.15)`;
}

/** Semi-transparent stroke for map region outlines */
export function getAreaStrokeColor(color?: string | null): string {
  const [h, s, l] = parseAreaColor(color);
  return `hsl(${h} ${s}% ${l}% / 0.6)`;
}

/** Solid color for preview graph rings (50% opacity) */
export function getAreaPreviewColor(color?: string | null): string {
  const [h, s, l] = parseAreaColor(color);
  return `hsl(${h} ${s}% ${l}% / 0.5)`;
}
