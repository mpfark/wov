/**
 * races.ts — Race configuration (labels, descriptions, stat modifiers).
 *
 * CANONICAL OWNER for: RACE_LABELS, RACE_DESCRIPTIONS, RACE_STATS.
 *
 * The tables below are *fallback defaults* only. At runtime
 * `setRaceRegistry()` is fed the rows of the `races` table (client: on app
 * boot) and mutates these records in place, so every existing consumer reads
 * the configured values without changing its import.
 */

export const RACE_LABELS: Record<string, string> = {
  human: 'Human', elf: 'Elf', dwarf: 'Dwarf', halfling: 'Halfling',
  edain: 'Edain', half_elf: 'Half-Elf',
};

export const RACE_DESCRIPTIONS: Record<string, string> = {
  human: 'Versatile and balanced — a small bonus to every stat makes Men adaptable to any class.',
  elf: 'Keen-eyed and wise. High DEX sharpens accuracy, AC and crit range; high WIS deepens the CP pool and resists incoming crits.',
  dwarf: 'Stout and unshakeable. Towering CON gives the largest HP pool in the world, and STR fuels heavy weapons and shield blocks.',
  halfling: 'Quick, lucky and likeable. Top-tier DEX for hits and dodging blows, with CHA boosting gold and vendor prices.',
  edain: 'Long-lived nobles of the Old Kingdom. Strong CON for survivability with balanced bonuses across the board.',
  half_elf: 'Diplomats and wanderers. WIS fortifies your CP pool and crit defence while CHA earns better gold and trade rates.',
};

/** D&D-style stat modifiers by race */
export const RACE_STATS: Record<string, Record<string, number>> = {
  human:    { str: 1, dex: 1, con: 1, int: 1, wis: 1, cha: 1 },
  elf:      { str: -1, dex: 2, con: -1, int: 2, wis: 3, cha: 0 },
  dwarf:    { str: 2, dex: -1, con: 4, int: 0, wis: 1, cha: -2 },
  halfling: { str: -2, dex: 3, con: 1, int: 0, wis: 1, cha: 2 },
  edain:    { str: 1, dex: 0, con: 3, int: 1, wis: 1, cha: 1 },
  half_elf: { str: 0, dex: 1, con: 0, int: 1, wis: 2, cha: 3 },
};

export interface RaceConfigRow {
  race_key: string;
  label?: string | null;
  description?: string | null;
  str?: number | null;
  dex?: number | null;
  con?: number | null;
  int?: number | null;
  wis?: number | null
  cha?: number | null;
  portrait_notes?: string | null;
  is_selectable?: boolean | null;
  status?: string | null;
  sort_order?: number | null;
}

interface RaceMeta {
  isSelectable: boolean;
  status: string;
  sortOrder: number;
  portraitNotes: string;
}

let registryLoaded = false;
const registryMeta: Record<string, RaceMeta> = {};

export function isRaceRegistryLoaded(): boolean {
  return registryLoaded;
}

/** Replace the in-memory race tables with configured rows (mutates in place). */
export function setRaceRegistry(rows: RaceConfigRow[]): void {
  if (!rows || rows.length === 0) return;

  const sorted = [...rows].sort(
    (a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0) || a.race_key.localeCompare(b.race_key),
  );

  for (const key of Object.keys(RACE_LABELS)) delete RACE_LABELS[key];
  for (const key of Object.keys(RACE_DESCRIPTIONS)) delete RACE_DESCRIPTIONS[key];
  for (const key of Object.keys(RACE_STATS)) delete RACE_STATS[key];
  for (const key of Object.keys(registryMeta)) delete registryMeta[key];

  for (const row of sorted) {
    RACE_LABELS[row.race_key] = row.label ?? row.race_key;
    RACE_DESCRIPTIONS[row.race_key] = row.description ?? '';
    RACE_STATS[row.race_key] = {
      str: row.str ?? 0, dex: row.dex ?? 0, con: row.con ?? 0,
      int: row.int ?? 0, wis: row.wis ?? 0, cha: row.cha ?? 0,
    };
    registryMeta[row.race_key] = {
      isSelectable: row.is_selectable ?? true,
      status: row.status ?? 'active',
      sortOrder: row.sort_order ?? 0,
      portraitNotes: row.portrait_notes ?? '',
    };
  }

  registryLoaded = true;
}

/** Every known race key, in configured display order. */
export function getRaceKeys(): string[] {
  return Object.keys(RACE_LABELS);
}

/** Race keys a player may pick at character creation. */
export function getSelectableRaceKeys(): string[] {
  return getRaceKeys().filter(key => {
    const meta = registryMeta[key];
    if (!meta) return true; // fallback tables are all selectable
    return meta.isSelectable && meta.status === 'active';
  });
}

/** Extra art direction notes used by the portrait prompt builder. */
export function getRacePortraitNotes(raceKey: string): string {
  return registryMeta[raceKey]?.portraitNotes ?? '';
}
