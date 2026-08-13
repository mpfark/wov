/**
 * c3/loader.ts — builds the `SnapshotAux` the snapshot decoder needs.
 *
 * `encounter_snapshot_v2` returns encounter *state*. Four things are not state
 * and therefore never appear in it: the authoritative mode/time (owned by the
 * claim and the orchestration), configured ability magnitudes, weapon procs,
 * and encounter-wide configuration. This module is the ONE place those are
 * assembled.
 *
 * Rules:
 *  1. Every value is read once, before simulation, and frozen into the aux
 *     object. The resolver never reads anything live.
 *  2. Randomness is never produced here. Ability calcs evaluate in
 *     deterministic `average` mode (see `ability-resolve.ts`); every roll that
 *     must be random happens inside the pure resolver via seeded RNG.
 *  3. Configuration is the only source of numbers. A pending action whose
 *     ability is unknown to the catalog is reported as an actionable failure,
 *     never resolved to zero.
 */

import { getStatModifier } from '../../formulas/stats.ts';
import { GEM_DROP_CHANCE } from '../../formulas/gems.ts';
import {
  resolveAbilityConfig,
  type AbilityConfigEntry,
  type ResolvedAbilityConfig,
} from './ability-resolve.ts';
import { abilityConfigKey, type SnapshotAux } from './decode-snapshot.ts';
import { C3Error } from './errors.ts';
import type { Attributes, ProcSnapshot, ResolutionMode, ResolverConfig } from '../pure/types.ts';

/** Minimal supabase-js surface the loader uses. */
export interface LoaderDb {
  from: (table: string) => any;
}

/**
 * Configured-ability lookup. Implemented in the Edge Function by
 * `_shared/load-ability-calcs.ts` (`getServerAbilityCalcs`), and by a fixture
 * map in tests. Keeping it injected means the loader performs no registry IO.
 */
export interface AbilityCatalog {
  lookup(classKey: string, abilityKey: string): AbilityConfigEntry | null;
}

export interface LoadAuxInput {
  /** Raw `encounter_snapshot_v2` payload (not yet decoded). */
  readonly snapshotRoot: unknown;
  /** Authoritative mode, from the claim. */
  readonly mode: ResolutionMode;
  /** Authoritative time, from the orchestration. */
  readonly nowMs: number;
  readonly ticksToSimulate: number;
  readonly catalog: AbilityCatalog;
  /** Boss cast cooldowns carried by the encounter row, in ticks. */
  readonly castCooldownTicksByCreatureId?: ReadonlyMap<string, number>;
}

export interface LoadedAux {
  readonly aux: SnapshotAux;
  /** Actionable configuration problems found while resolving abilities. */
  readonly configFailures: readonly string[];
}

const ATTR_KEYS = ['str', 'dex', 'con', 'int', 'wis', 'cha'] as const;

const DEFAULT_WEAPON_PROGRESSION: ResolverConfig['weaponProgression'] = {
  tier1_level: 1,
  tier2_level: 10,
  tier3_level: 20,
};

function asArray(value: unknown): any[] {
  return Array.isArray(value) ? value : [];
}

function num(value: unknown, fallback: number): number {
  const n = typeof value === 'string' ? Number(value) : value;
  return typeof n === 'number' && Number.isFinite(n) ? n : fallback;
}

/**
 * Effective attribute scores = snapshotted base scores + equipped item stats +
 * applied gems. Mirrors the aggregation the snapshot decoder performs for
 * level-up recalculation; ability calcs must see the same numbers.
 */
function effectiveAttrs(participant: any): Attributes {
  const out: Record<string, number> = {};
  for (const key of ATTR_KEYS) out[key] = num(participant?.attrs?.[key], 10);
  for (const eq of asArray(participant?.equipment)) {
    for (const source of ['stats', 'appliedGems'] as const) {
      const raw = eq?.[source];
      if (!raw) continue;
      for (const row of Array.isArray(raw) ? raw : [raw]) {
        if (!row || typeof row !== 'object') continue;
        for (const key of ATTR_KEYS) {
          const v = (row as Record<string, unknown>)[key];
          if (v === undefined || v === null) continue;
          out[key] += num(v, 0);
        }
      }
    }
  }
  return out as unknown as Attributes;
}

function attrMods(attrs: Attributes): Attributes {
  const mods: Record<string, number> = {};
  for (const key of ATTR_KEYS) {
    mods[key] = getStatModifier((attrs as unknown as Record<string, number>)[key] ?? 10);
  }
  return mods as unknown as Attributes;
}

function mainHandWeaponDie(participant: any): number | null {
  const mainHand = asArray(participant?.equipment).find((e) => e?.slot === 'main_hand');
  const die = mainHand ? num(mainHand.weaponDie, 0) : 0;
  return die > 0 ? die : null;
}

/**
 * Weapon procs from equipped items.
 *
 * Only proc types the pure resolver models are mapped, and the mapping is
 * explicit: `lifesteal` heals the wielder, `burst_damage` is bonus elemental
 * damage. Anything else (e.g. `buff_ac` on `on_taken`) is skipped rather than
 * silently coerced into a damage proc.
 */
function procsFromSnapshot(participants: readonly any[]): ProcSnapshot[] {
  const procs: ProcSnapshot[] = [];
  for (const p of participants) {
    const characterId = String(p?.id ?? '');
    if (!characterId) continue;
    for (const eq of asArray(p?.equipment)) {
      const rows = asArray(eq?.procs);
      rows.forEach((raw, index) => {
        if (!raw || typeof raw !== 'object') return;
        const type = String((raw as Record<string, unknown>).type ?? '');
        const kind: ProcSnapshot['kind'] | null =
          type === 'lifesteal' ? 'lifesteal' : type === 'burst_damage' ? 'elemental' : null;
        if (!kind) return;
        const chance = num((raw as Record<string, unknown>).chance, 0);
        const amount = num((raw as Record<string, unknown>).value, 0);
        if (chance <= 0 || amount <= 0) return;
        procs.push({
          // Stable, snapshot-derived id: the seeded RNG streams key off it.
          id: `${eq.inventoryId}:${index}`,
          characterId,
          kind,
          chance,
          amount,
          weight: num((raw as Record<string, unknown>).weight, 1),
          damageType: typeof (raw as Record<string, unknown>).damage_type === 'string'
            ? String((raw as Record<string, unknown>).damage_type)
            : null,
          label: typeof (raw as Record<string, unknown>).text === 'string'
            ? String((raw as Record<string, unknown>).text)
            : (eq.weaponTag ?? 'Weapon'),
        });
      });
    }
  }
  // Deterministic order regardless of database row order.
  procs.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return procs;
}

/** Global XP boost, expired boosts ignored. Any read problem means "no boost". */
async function loadXpBoost(db: LoaderDb, nowMs: number): Promise<number> {
  try {
    const { data } = await db
      .from('xp_boost')
      .select('multiplier, expires_at')
      .limit(1)
      .maybeSingle();
    if (!data) return 1;
    const expires = data.expires_at ? Date.parse(data.expires_at) : 0;
    if (!expires || expires <= nowMs) return 1;
    const mult = num(data.multiplier, 1);
    return mult > 0 ? mult : 1;
  } catch {
    return 1;
  }
}

async function loadWeaponProgression(db: LoaderDb): Promise<ResolverConfig['weaponProgression']> {
  try {
    const { data } = await db
      .from('weapon_progression_config')
      .select('tier1_level, tier2_level, tier3_level')
      .eq('id', 1)
      .maybeSingle();
    if (!data) return DEFAULT_WEAPON_PROGRESSION;
    return {
      tier1_level: num(data.tier1_level, DEFAULT_WEAPON_PROGRESSION.tier1_level),
      tier2_level: num(data.tier2_level, DEFAULT_WEAPON_PROGRESSION.tier2_level),
      tier3_level: num(data.tier3_level, DEFAULT_WEAPON_PROGRESSION.tier3_level),
    };
  } catch {
    return DEFAULT_WEAPON_PROGRESSION;
  }
}

/** `parties.tank_id`, falling back to the leader, for every party present. */
async function loadTanks(
  db: LoaderDb,
  partyIds: readonly string[],
): Promise<Map<string, string>> {
  const tanks = new Map<string, string>();
  if (partyIds.length === 0) return tanks;
  const { data, error } = await db
    .from('parties')
    .select('id, tank_id, leader_id')
    .in('id', partyIds as string[]);
  if (error) {
    throw new C3Error('internal', `party tank load failed: ${error.message}`);
  }
  for (const row of asArray(data)) {
    const tank = row?.tank_id ?? row?.leader_id;
    if (row?.id && tank) tanks.set(String(row.id), String(tank));
  }
  return tanks;
}

/**
 * Resolve every pending action's ability configuration against its caster.
 * Keyed exactly as the decoder looks it up, so a miss is impossible unless the
 * ability is genuinely unconfigured — which is reported, not defaulted.
 */
function resolveAbilityConfigs(
  participants: readonly any[],
  actions: readonly any[],
  catalog: AbilityCatalog,
  failures: string[],
): Map<string, ResolvedAbilityConfig> {
  const byId = new Map<string, any>();
  for (const p of participants) byId.set(String(p?.id ?? ''), p);

  const resolved = new Map<string, ResolvedAbilityConfig>();
  for (const action of actions) {
    const characterId = String(action?.characterId ?? '');
    const abilityKey = String(action?.abilityKey ?? '');
    if (!characterId || !abilityKey) continue;
    const key = abilityConfigKey(characterId, abilityKey);
    if (resolved.has(key)) continue;

    const caster = byId.get(characterId);
    if (!caster) {
      failures.push(`${abilityKey}: no participant ${characterId} in snapshot`);
      continue;
    }
    const classKey = String(caster.classKey ?? '');
    const entry = catalog.lookup(classKey, abilityKey);
    if (!entry) {
      failures.push(`${classKey}:${abilityKey}: not present in the ability catalog`);
      continue;
    }
    const attrs = effectiveAttrs(caster);
    const config = resolveAbilityConfig(entry, {
      level: num(caster.level, 1),
      attrMods: attrMods(attrs),
      weaponDie: mainHandWeaponDie(caster),
    });
    for (const f of config.failures) failures.push(f);
    resolved.set(key, config);
  }
  return resolved;
}

/** Per-creature salvage key: non-humanoids yield generic salvage, humanoids none. */
function salvageKeys(creatures: readonly any[]): Map<string, string | null> {
  const out = new Map<string, string | null>();
  for (const c of creatures) {
    if (!c?.id) continue;
    out.set(String(c.id), c.isHumanoid === true ? null : 'salvage');
  }
  return out;
}

/**
 * Build the aux bundle. Performs exactly three database reads, all of them
 * configuration, all of them before simulation.
 */
export async function loadSnapshotAux(db: LoaderDb, input: LoadAuxInput): Promise<LoadedAux> {
  const root = (input.snapshotRoot ?? {}) as Record<string, unknown>;
  const participants = asArray(root.participants);
  const actions = asArray(root.actions);
  const creatures = asArray(root.creatures);

  const partyIds = Array.from(
    new Set(
      participants
        .map((p) => (typeof p?.partyId === 'string' ? p.partyId : null))
        .filter((id): id is string => Boolean(id)),
    ),
  ).sort();

  const [xpBoostMultiplier, weaponProgression, tankByPartyId] = await Promise.all([
    loadXpBoost(db, input.nowMs),
    loadWeaponProgression(db),
    loadTanks(db, partyIds),
  ]);

  const configFailures: string[] = [];
  const abilityConfig = resolveAbilityConfigs(
    participants,
    actions,
    input.catalog,
    configFailures,
  );

  const aux: SnapshotAux = {
    mode: input.mode,
    nowMs: input.nowMs,
    ticksToSimulate: input.ticksToSimulate,
    abilityConfig,
    procs: procsFromSnapshot(participants),
    xpBoostMultiplier,
    gemDropChance: GEM_DROP_CHANCE,
    weaponProgression,
    tankByPartyId,
    // No character is exempt from the level-difference XP penalty: the legacy
    // rule applies it to everyone. Kept as an explicit empty list so the
    // exemption path stays visible rather than implied.
    uncappedXpCharacterIds: [],
    salvageMaterialKeyByCreatureId: salvageKeys(creatures),
    castCooldownTicksByCreatureId: input.castCooldownTicksByCreatureId ?? new Map(),
  };

  return { aux, configFailures };
}
