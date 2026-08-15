/**
 * c3/loader.ts — builds the `SnapshotAux` the snapshot decoder needs.
 *
 * The loader performs NO database reads. Everything it needs is either
 * authoritative context supplied by the orchestration (mode, time, ticks) or
 * carried by `encounter_snapshot_v2` itself — including the configuration block
 * (`config`), which is covered by the same `stateDigest.configVersion` the
 * commit re-checks. Nothing outside that contract may influence ability
 * magnitude, procs, XP, progression, tank selection or salvage.
 *
 * Rules:
 *  1. Every value is read once, from the pinned snapshot, and frozen into the
 *     aux object. The resolver never reads anything live.
 *  2. Randomness is never produced here. Ability calcs evaluate in
 *     deterministic `average` mode (see `ability-resolve.ts`); every roll that
 *     must be random happens inside the pure resolver via seeded RNG.
 *  3. Configuration is the only source of numbers. A pending action whose
 *     ability is unknown to the catalog is reported as an actionable failure,
 *     never resolved to zero.
 *  4. The injected ability catalog carries the configuration version it was
 *     built from; the orchestration refuses the tick when it disagrees with the
 *     snapshot (`config_conflict`).
 */

import { getStatModifier } from '../../formulas/stats';
import { GEM_DROP_CHANCE } from '../../formulas/gems';
import {
  resolveAbilityConfig,
  type AbilityConfigEntry,
  type ResolvedAbilityConfig,
} from './ability-resolve';
import { abilityConfigKey, type SnapshotAux } from './decode-snapshot';
import { C3Error } from './errors';
import type { Attributes, ProcSnapshot, ResolutionMode, ResolverConfig } from '../pure/types';

/**
 * Configured-ability lookup. Implemented in the Edge Function by
 * `_shared/load-ability-calcs.ts` (`getServerAbilityCalcs`), and by a fixture
 * map in tests. Keeping it injected means the loader performs no registry IO.
 *
 * `configVersion` is `public.ability_config_version()` as read when the catalog
 * was built. It is compared against the value the snapshot pinned.
 */
export interface AbilityCatalog {
  readonly configVersion: string;
  lookup(classKey: string, abilityKey: string): AbilityConfigEntry | null;
  /**
   * Authored-status contract problems found when the catalog was built
   * (`missing_status_definition` / `invalid_status_definition`). Non-empty means
   * combat must refuse rather than resolve statuses to zero.
   */
  readonly statusProblems?: readonly string[];
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

/**
 * The pinned configuration block. Missing or malformed configuration is a
 * contract defect, not something to guess around: the snapshot function always
 * emits it, so absence means the deployed SQL and this code disagree.
 */
function configBlock(root: Record<string, unknown>): Record<string, unknown> {
  const raw = root.config;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new C3Error('decode_failed', '$.config: snapshot carries no configuration block', {
      retryable: false,
    });
  }
  return raw as Record<string, unknown>;
}

function pinnedXpBoost(config: Record<string, unknown>): number {
  const mult = num(config.xpBoostMultiplier, NaN);
  if (!Number.isFinite(mult) || mult <= 0) {
    throw new C3Error('decode_failed', '$.config.xpBoostMultiplier: not a positive number', {
      retryable: false,
    });
  }
  return mult;
}

function pinnedWeaponProgression(
  config: Record<string, unknown>,
): ResolverConfig['weaponProgression'] {
  const raw = config.weaponProgression;
  if (!raw || typeof raw !== 'object') {
    throw new C3Error('decode_failed', '$.config.weaponProgression: missing', { retryable: false });
  }
  const row = raw as Record<string, unknown>;
  return {
    tier1_level: num(row.tier1_level, DEFAULT_WEAPON_PROGRESSION.tier1_level),
    tier2_level: num(row.tier2_level, DEFAULT_WEAPON_PROGRESSION.tier2_level),
    tier3_level: num(row.tier3_level, DEFAULT_WEAPON_PROGRESSION.tier3_level),
  };
}

/** `parties.tank_id` (else leader), as pinned by the snapshot's config block. */
function pinnedTanks(config: Record<string, unknown>): Map<string, string> {
  const tanks = new Map<string, string>();
  for (const row of asArray(config.tanks)) {
    const partyId = row?.partyId;
    const tank = row?.tankCharacterId;
    if (typeof partyId === 'string' && typeof tank === 'string') tanks.set(partyId, tank);
  }
  return tanks;
}

/** The ability-configuration version this snapshot resolved against. */
export function snapshotAbilityConfigVersion(snapshotRoot: unknown): string {
  const config = configBlock((snapshotRoot ?? {}) as Record<string, unknown>);
  const version = config.abilityConfigVersion;
  if (typeof version !== 'string' || version.length === 0) {
    throw new C3Error('decode_failed', '$.config.abilityConfigVersion: missing', {
      retryable: false,
    });
  }
  return version;
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
  // Reservation-backed stances resolve through the exact same path as a queued
  // action: same catalog entry, same caster-scoped magnitudes. A stance key IS
  // its ability key, so no second mapping table can drift from the first.
  const stanceIntents = participants.flatMap((p: any) =>
    stanceKeysOf(p).map((abilityKey) => ({ characterId: String(p?.id ?? ''), abilityKey })),
  );
  actions = [...actions, ...stanceIntents];
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
    // A configured use whose applied status is not authored would resolve to
    // zero duration and zero magnitude. Refuse the tick with a diagnosable
    // reason instead of silently disabling the mechanic.
    const missingStatus = (entry.effectConfig as Record<string, unknown>)
      ?.status_definition_missing;
    if (typeof missingStatus === 'string' && missingStatus.length > 0) {
      throw new C3Error(
        'status_config_invalid',
        `missing_status_definition: ${classKey}:${abilityKey} applies "${missingStatus}", which is not authored`,
        { retryable: false },
      );
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

/**
 * Stance keys switched on for a participant, read from the raw snapshot rows.
 * The reservation is the single authority; this is a read, never a derivation.
 */
export function stanceKeysOf(participant: any): string[] {
  const keys = new Set<string>();
  for (const source of ['reservedBuffs', 'stanceState'] as const) {
    const raw = participant?.[source];
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue;
    for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
      if (value === null || value === undefined) continue;
      keys.add(key);
    }
  }
  return [...keys].sort();
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
 * Build the aux bundle. Performs ZERO database reads: every configuration value
 * comes from the pinned snapshot, so the commit digest covers all of it.
 */
export function loadSnapshotAux(input: LoadAuxInput): LoadedAux {
  const root = (input.snapshotRoot ?? {}) as Record<string, unknown>;
  const participants = asArray(root.participants);
  const actions = asArray(root.actions);
  const creatures = asArray(root.creatures);

  const config = configBlock(root);
  const xpBoostMultiplier = pinnedXpBoost(config);
  const weaponProgression = pinnedWeaponProgression(config);
  const tankByPartyId = pinnedTanks(config);

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
    stanceKeysByCharacterId: new Map(
      participants.map((p: any) => [String(p?.id ?? ''), stanceKeysOf(p)]),
    ),
  };

  return { aux, configFailures };
}
