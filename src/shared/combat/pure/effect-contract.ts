/**
 * pure/effect-contract.ts — the ONE typed contract for semantic combat effects
 * that persist across ticks.
 *
 * Separation of concerns this module exists to enforce:
 *
 *  - `characters.reserved_buffs` / `characters.stance_state`
 *      Stance *activation* and CP-*reservation* bookkeeping. They record which
 *      stance a character has switched on and how much CP that reservation
 *      costs. They are NEVER a numeric/boolean combat buff bag and must never
 *      be interpreted as one.
 *
 *  - `public.active_effects`
 *      The authoritative semantic combat state. Every effect that must survive
 *      a tick boundary — absorb pools, mitigation, offence, stealth, block,
 *      evasion, reactive retaliation, regeneration pulses, stack appliers,
 *      DoTs and control debuffs — lives here as a typed row and is rebuilt
 *      into a `ParticipantBuffSnapshot` on every single tick.
 *
 * The registry below is the closed vocabulary. It defines, per mechanic:
 *   - the allowed target kind and source rule,
 *   - whether the row is periodic (cadence semantics),
 *   - magnitude requirement and numeric bounds,
 *   - the meaning of the mutable `remaining` pool/charge column,
 *   - stack / refresh / replacement behaviour,
 *   - the required and allowed parameter keys with their bounds,
 *   - which fields are immutable from application and which may change per tick.
 *
 * Unknown mechanics and unknown/out-of-bounds parameters FAIL CLOSED with a
 * path-specific error. There is no unrestricted JSON escape hatch: `params` is
 * validated key-by-key against this registry both in TypeScript (decoder and
 * committer input) and in SQL (`public.active_effects_validate` trigger).
 */

import type { ParticipantBuffSnapshot, StackApplierSnapshot } from './types';

/** Version of the `params` vocabulary. Bump on any breaking key change. */
export const EFFECT_PARAMS_VERSION = 1 as const;

export type EffectTargetKind = 'character' | 'creature';

export interface EffectParamSpec {
  readonly kind: 'number' | 'boolean' | 'string' | 'enum';
  readonly required?: boolean;
  readonly min?: number;
  readonly max?: number;
  readonly integer?: boolean;
  readonly values?: readonly string[];
}

/** How a re-application interacts with an existing row of the same identity. */
export type EffectStackPolicy =
  /** One row per (source, target, effect_type); recast replaces it outright. */
  | 'replace'
  /** Recast replaces the window but never weakens a live magnitude. */
  | 'best_of'
  /** Recast accumulates `stacks` up to `params.maxStacks`. */
  | 'stacking';

export interface EffectMechanicSpec {
  /** Semantic family, mirrored from MECHANIC_FAMILY for cross-checking. */
  readonly family: string;
  readonly target: EffectTargetKind;
  /** Every persistent effect is attributed to the character that applied it. */
  readonly sourceMustBeCharacter: boolean;
  /** `true` ⇒ the row ticks on `next_tick_at` cadence (`intervalMs` > 0). */
  readonly periodic: boolean;
  readonly magnitude: { readonly required: boolean; readonly min: number; readonly max: number };
  /** Meaning of the mutable `remaining` column. */
  readonly remaining: 'unused' | 'pool' | 'charges';
  readonly stackPolicy: EffectStackPolicy;
  /** Fields the committer may change on an existing row. */
  readonly mutable: readonly ('remaining' | 'stacks' | 'nextTickAtMs' | 'expiresAtMs' | 'magnitude' | 'amountPerTick')[];
  readonly params: Readonly<Record<string, EffectParamSpec>>;
}

const DAMAGE_TYPE: EffectParamSpec = { kind: 'string' };

/**
 * Allowed mechanics for `active_effects.mechanic`. A row whose mechanic is not
 * a key of this record cannot be written, snapshotted or decoded.
 */
export const EFFECT_MECHANIC_REGISTRY: Readonly<Record<string, EffectMechanicSpec>> = {
  // ── Persistent friendly state ─────────────────────────────────────
  absorb_buff: {
    family: 'friendly_state',
    target: 'character',
    sourceMustBeCharacter: true,
    periodic: false,
    magnitude: { required: true, min: 0, max: 1_000_000 },
    remaining: 'pool',
    stackPolicy: 'best_of',
    mutable: ['remaining', 'expiresAtMs'],
    params: {},
  },
  mitigation_buff: {
    family: 'friendly_state',
    target: 'character',
    sourceMustBeCharacter: true,
    periodic: false,
    magnitude: { required: true, min: 0, max: 1_000_000 },
    remaining: 'unused',
    stackPolicy: 'best_of',
    mutable: ['expiresAtMs', 'magnitude'],
    params: {
      mode: { kind: 'enum', required: true, values: ['percent', 'flat'] },
      taunt: { kind: 'boolean' },
    },
  },
  offense_buff: {
    family: 'friendly_state',
    target: 'character',
    sourceMustBeCharacter: true,
    periodic: false,
    magnitude: { required: true, min: 0, max: 100 },
    remaining: 'unused',
    stackPolicy: 'best_of',
    mutable: ['expiresAtMs', 'magnitude'],
    params: {
      offenseMode: { kind: 'enum', required: true, values: ['damage_mult', 'crit_edge'] },
    },
  },
  stealth_buff: {
    family: 'stealth_state',
    target: 'character',
    sourceMustBeCharacter: true,
    periodic: false,
    magnitude: { required: true, min: 1, max: 100 },
    remaining: 'charges',
    stackPolicy: 'replace',
    mutable: ['remaining', 'expiresAtMs', 'magnitude'],
    params: {},
  },
  block_buff: {
    family: 'defensive_state',
    target: 'character',
    sourceMustBeCharacter: true,
    periodic: false,
    magnitude: { required: true, min: 0, max: 1 },
    remaining: 'unused',
    stackPolicy: 'replace',
    mutable: ['expiresAtMs', 'magnitude'],
    params: {
      // Flat block points added to the shield's rolled block amount, NOT a
      // fraction: Shield Wall's configured bonus is single-digit HP, so a 0..1
      // bound would refuse the real row on rehydration.
      blockAmount: { kind: 'number', min: 0, max: 1000 },
      blockChanceCap: { kind: 'number', min: 0, max: 1 },
    },

  },
  evasion_buff: {
    family: 'defensive_state',
    target: 'character',
    sourceMustBeCharacter: true,
    periodic: false,
    magnitude: { required: true, min: 0, max: 100 },
    remaining: 'charges',
    stackPolicy: 'replace',
    mutable: ['remaining', 'expiresAtMs', 'magnitude'],
    params: {
      kind: { kind: 'enum', required: true, values: ['dodge', 'next_hit'] },
      evasionSource: { kind: 'enum', required: true, values: ['cloak', 'disengage'] },
    },
  },
  reactive_holy: {
    family: 'reactive_state',
    target: 'character',
    sourceMustBeCharacter: true,
    periodic: false,
    magnitude: { required: true, min: 1, max: 1_000_000 },
    remaining: 'unused',
    stackPolicy: 'best_of',
    mutable: ['expiresAtMs', 'magnitude'],
    params: { damageType: DAMAGE_TYPE },
  },
  regen_buff: {
    family: 'periodic_friendly_state',
    target: 'character',
    sourceMustBeCharacter: true,
    periodic: true,
    magnitude: { required: false, min: 0, max: 1_000_000 },
    remaining: 'unused',
    stackPolicy: 'best_of',
    mutable: ['nextTickAtMs', 'expiresAtMs', 'amountPerTick'],
    params: {
      cpPerTick: { kind: 'number', min: 0, max: 100_000, integer: true },
      healsAllies: { kind: 'boolean' },
      damagesEnemies: { kind: 'boolean' },
    },
  },
  party_regen: {
    family: 'party_regen',
    target: 'character',
    sourceMustBeCharacter: true,
    periodic: true,
    magnitude: { required: false, min: 0, max: 1_000_000 },
    remaining: 'unused',
    stackPolicy: 'best_of',
    mutable: ['nextTickAtMs', 'expiresAtMs', 'amountPerTick'],
    params: {
      cpPerTick: { kind: 'number', min: 0, max: 100_000, integer: true },
      healsAllies: { kind: 'boolean' },
      damagesEnemies: { kind: 'boolean' },
    },
  },
  aura_pulse: {
    family: 'persistent_area',
    target: 'character',
    sourceMustBeCharacter: true,
    periodic: true,
    magnitude: { required: false, min: 0, max: 1_000_000 },
    remaining: 'unused',
    stackPolicy: 'replace',
    mutable: ['nextTickAtMs', 'expiresAtMs', 'amountPerTick'],
    params: {
      cpPerTick: { kind: 'number', min: 0, max: 100_000, integer: true },
      healsAllies: { kind: 'boolean' },
      damagesEnemies: { kind: 'boolean' },
    },
  },
  /**
   * Stance bookkeeping for on-hit/pulse appliers (Envenom, Ignite/Orbs). The
   * applier row is the *source of the proc*; the stacks it lands are separate
   * `dot_debuff` rows on the creature.
   */
  stack_apply: {
    family: 'stack_source',
    target: 'character',
    sourceMustBeCharacter: true,
    periodic: false,
    magnitude: { required: true, min: 0, max: 1 },
    remaining: 'unused',
    stackPolicy: 'replace',
    mutable: ['expiresAtMs', 'magnitude'],
    params: {
      stackEffectType: { kind: 'string', required: true },
      trigger: { kind: 'enum', required: true, values: ['weapon_hit', 'successful_pulse_hit'] },
      dotPerTick: { kind: 'number', required: true, min: 0, max: 1_000_000 },
      durationMs: { kind: 'number', required: true, min: 0, max: 3_600_000, integer: true },
      intervalMs: { kind: 'number', required: true, min: 250, max: 600_000, integer: true },
      maxStacks: { kind: 'number', required: true, min: 1, max: 99, integer: true },
      pulseDamage: { kind: 'number', min: 0, max: 1_000_000 },
      damageType: DAMAGE_TYPE,
    },
  },

  // ── Hostile state ────────────────────────────────────────────────
  dot_debuff: {
    family: 'hostile_periodic',
    target: 'creature',
    sourceMustBeCharacter: true,
    periodic: true,
    magnitude: { required: false, min: 0, max: 1_000_000 },
    remaining: 'unused',
    stackPolicy: 'stacking',
    mutable: ['stacks', 'nextTickAtMs', 'expiresAtMs', 'amountPerTick'],
    params: {
      maxStacks: { kind: 'number', min: 1, max: 99, integer: true },
      damageType: DAMAGE_TYPE,
    },
  },
  control_debuff: {
    family: 'hostile_state',
    target: 'creature',
    sourceMustBeCharacter: true,
    periodic: false,
    // `damage_reduction` magnitudes are fractions (0..1); `ac_reduction`
    // magnitudes are whole AC points, so the bound covers both.
    magnitude: { required: false, min: 0, max: 1000 },
    remaining: 'unused',
    stackPolicy: 'replace',
    mutable: ['expiresAtMs', 'magnitude'],
    params: {
      controlMode: { kind: 'enum', values: ['ac_reduction', 'damage_reduction'] },
      ampPct: { kind: 'number', min: 0, max: 10 },
    },
  },
};

export type EffectMechanic = keyof typeof EFFECT_MECHANIC_REGISTRY;

export type EffectParams = Readonly<Record<string, number | boolean | string>>;

export class EffectContractError extends Error {
  readonly code = 'effect_contract';
  constructor(readonly path: string, message: string) {
    super(`${path}: ${message}`);
    this.name = 'EffectContractError';
  }
}

export function isEffectMechanic(key: unknown): key is EffectMechanic {
  return typeof key === 'string' && Object.prototype.hasOwnProperty.call(EFFECT_MECHANIC_REGISTRY, key);
}

export function effectSpec(mechanic: string, path: string): EffectMechanicSpec {
  const spec = EFFECT_MECHANIC_REGISTRY[mechanic];
  if (!spec) {
    throw new EffectContractError(
      path,
      `unknown effect mechanic "${mechanic}"; add it to EFFECT_MECHANIC_REGISTRY before it can persist`,
    );
  }
  return spec;
}

/**
 * Validate one persisted effect row against the registry. Fails closed on an
 * unknown mechanic, an unknown/missing parameter, a wrong type, or a value
 * outside the declared bounds. Returns the normalised params.
 */
export function validateEffectRow(
  row: {
    mechanic: string;
    targetKind: EffectTargetKind;
    sourceCharacterId: string | null;
    magnitude?: number | null;
    remaining?: number | null;
    intervalMs: number;
    paramsVersion?: number | null;
    params?: unknown;
  },
  path: string,
): EffectParams {
  const spec = effectSpec(row.mechanic, `${path}.mechanic`);

  if (row.targetKind !== spec.target) {
    throw new EffectContractError(
      `${path}.targetKind`,
      `mechanic "${row.mechanic}" targets ${spec.target}, received ${row.targetKind}`,
    );
  }
  if (spec.sourceMustBeCharacter && !row.sourceCharacterId) {
    throw new EffectContractError(`${path}.sourceCharacterId`, `mechanic "${row.mechanic}" requires a character source`);
  }
  if (spec.periodic && !(row.intervalMs > 0)) {
    throw new EffectContractError(`${path}.intervalMs`, `periodic mechanic "${row.mechanic}" requires intervalMs > 0`);
  }

  const version = row.paramsVersion ?? EFFECT_PARAMS_VERSION;
  if (version !== EFFECT_PARAMS_VERSION) {
    throw new EffectContractError(`${path}.paramsVersion`, `expected ${EFFECT_PARAMS_VERSION}, received ${version}`);
  }

  const mag = row.magnitude ?? null;
  if (spec.magnitude.required && (mag === null || !Number.isFinite(mag))) {
    throw new EffectContractError(`${path}.magnitude`, `mechanic "${row.mechanic}" requires a finite magnitude`);
  }
  if (mag !== null && (mag < spec.magnitude.min || mag > spec.magnitude.max)) {
    throw new EffectContractError(
      `${path}.magnitude`,
      `expected ${spec.magnitude.min}..${spec.magnitude.max}, received ${mag}`,
    );
  }

  const remaining = row.remaining ?? null;
  if (remaining !== null) {
    if (spec.remaining === 'unused') {
      throw new EffectContractError(`${path}.remaining`, `mechanic "${row.mechanic}" has no remaining pool/charges`);
    }
    if (!Number.isFinite(remaining) || remaining < 0) {
      throw new EffectContractError(`${path}.remaining`, `expected a finite value >= 0, received ${remaining}`);
    }
  }

  const raw = row.params ?? {};
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new EffectContractError(`${path}.params`, 'expected an object');
  }
  const params = raw as Record<string, unknown>;

  for (const key of Object.keys(params)) {
    if (!Object.prototype.hasOwnProperty.call(spec.params, key)) {
      throw new EffectContractError(
        `${path}.params.${key}`,
        `parameter is not allowed for mechanic "${row.mechanic}"`,
      );
    }
  }

  const out: Record<string, number | boolean | string> = {};
  for (const [key, ps] of Object.entries(spec.params)) {
    const v = params[key];
    if (v === undefined || v === null) {
      if (ps.required) {
        throw new EffectContractError(`${path}.params.${key}`, `required parameter for mechanic "${row.mechanic}"`);
      }
      continue;
    }
    const p = `${path}.params.${key}`;
    if (ps.kind === 'boolean') {
      if (typeof v !== 'boolean') throw new EffectContractError(p, `expected boolean, received ${typeof v}`);
      out[key] = v;
      continue;
    }
    if (ps.kind === 'string') {
      if (typeof v !== 'string' || v.length === 0) {
        throw new EffectContractError(p, 'expected non-empty string');
      }
      out[key] = v;
      continue;
    }
    if (ps.kind === 'enum') {
      if (typeof v !== 'string' || !(ps.values ?? []).includes(v)) {
        throw new EffectContractError(p, `expected one of ${(ps.values ?? []).join(' | ')}, received ${String(v)}`);
      }
      out[key] = v;
      continue;
    }
    const n = typeof v === 'string' ? Number(v) : v;
    if (typeof n !== 'number' || !Number.isFinite(n)) {
      throw new EffectContractError(p, `expected finite number, received ${String(v)}`);
    }
    if (ps.integer && !Number.isInteger(n)) throw new EffectContractError(p, `expected an integer, received ${n}`);
    if (ps.min !== undefined && n < ps.min) throw new EffectContractError(p, `expected >= ${ps.min}, received ${n}`);
    if (ps.max !== undefined && n > ps.max) throw new EffectContractError(p, `expected <= ${ps.max}, received ${n}`);
    out[key] = n;
  }
  return out;
}

// ── Semantic buff reconstruction ───────────────────────────────────

/** Minimal shape the rebuild needs — a decoded `EffectSnapshot` satisfies it. */
export interface PersistedEffectView {
  readonly targetKind: EffectTargetKind;
  readonly targetId: string;
  readonly effectType: string;
  readonly expiresAtMs: number;
  readonly intervalMs: number;
  readonly amountPerTick: number;
  readonly mechanic?: string | null;
  readonly abilityKey?: string | null;
  readonly magnitude?: number | null;
  readonly remaining?: number | null;
  readonly params?: EffectParams;
  readonly damageType?: string | null;
  readonly stacks?: number;
}

const EMPTY_BUFFS = {
  stealth: false,
  damageBuff: false,
  mitigationPct: 0,
  mitigationFlat: 0,
  absorbShield: 0,
  dodgeChance: 0,
  critBuffBonus: 0,
  blockBuff: false,
  rooted: false,
};

/**
 * Rebuild the semantic buff bag for one character from its persisted effect
 * rows. This is the ONLY way a `ParticipantBuffSnapshot` is produced: stance
 * activation state never contributes a numeric or boolean value.
 *
 * Expired rows are ignored (the committer deletes them; a snapshot taken in
 * the same tick may still carry them). Pools/charges at zero are inert.
 */
export function buildBuffSnapshotFromEffects(
  characterId: string,
  effects: readonly PersistedEffectView[],
  nowMs: number,
): ParticipantBuffSnapshot {
  const buffs: {
    stealth: boolean;
    damageBuff: boolean;
    mitigationPct: number;
    mitigationFlat: number;
    absorbShield: number;
    dodgeChance: number;
    critBuffBonus: number;
    blockBuff: boolean;
    rooted: boolean;
    stealthMult?: number;
    nextHitBonusMult?: number;
    blockChanceBonus?: number;
    blockAmountBonus?: number;
    blockChanceCap?: number;
    reactiveHolyDamage?: number | null;
    reactiveHolyDamageType?: string | null;
    stackAppliers?: StackApplierSnapshot[];
  } = { ...EMPTY_BUFFS };

  const appliers: StackApplierSnapshot[] = [];

  for (const e of effects) {
    if (e.targetKind !== 'character' || e.targetId !== characterId) continue;
    if (!e.mechanic) continue;
    if (e.expiresAtMs <= nowMs) continue;
    const params = e.params ?? {};
    const mag = Number(e.magnitude ?? 0);
    const remaining = e.remaining === null || e.remaining === undefined ? null : Number(e.remaining);

    switch (e.mechanic) {
      case 'absorb_buff': {
        const pool = remaining === null ? mag : remaining;
        if (pool > 0) buffs.absorbShield += pool;
        break;
      }
      case 'mitigation_buff': {
        if (params.mode === 'flat') buffs.mitigationFlat = Math.max(buffs.mitigationFlat, mag);
        else buffs.mitigationPct = Math.max(buffs.mitigationPct, mag);
        break;
      }
      case 'offense_buff': {
        if (params.offenseMode === 'crit_edge') buffs.critBuffBonus = Math.max(buffs.critBuffBonus, mag);
        else if (mag > 0) buffs.damageBuff = true;
        break;
      }
      case 'stealth_buff': {
        if (remaining !== null && remaining <= 0) break;
        buffs.stealth = true;
        buffs.stealthMult = Math.max(buffs.stealthMult ?? 0, mag > 1 ? mag : 2);
        break;
      }
      case 'block_buff': {
        buffs.blockBuff = true;
        buffs.blockChanceBonus = Math.max(buffs.blockChanceBonus ?? 0, mag);
        if (typeof params.blockAmount === 'number') {
          buffs.blockAmountBonus = Math.max(buffs.blockAmountBonus ?? 0, params.blockAmount);
        }
        if (typeof params.blockChanceCap === 'number') {
          buffs.blockChanceCap = params.blockChanceCap;
        }
        break;
      }
      case 'evasion_buff': {
        if (params.kind === 'next_hit') {
          if (remaining !== null && remaining <= 0) break;
          buffs.nextHitBonusMult = Math.max(buffs.nextHitBonusMult ?? 0, mag);
        } else {
          buffs.dodgeChance = Math.max(buffs.dodgeChance, Math.min(1, mag));
        }
        break;
      }
      case 'reactive_holy': {
        const dmg = Math.max(1, Math.floor(mag));
        if (dmg > (buffs.reactiveHolyDamage ?? 0)) {
          buffs.reactiveHolyDamage = dmg;
          buffs.reactiveHolyDamageType =
            typeof params.damageType === 'string' ? params.damageType : (e.damageType ?? 'holy');
        }
        break;
      }
      case 'stack_apply': {
        appliers.push({
          abilityKey: e.abilityKey ?? e.effectType,
          effectType: String(params.stackEffectType),
          trigger: params.trigger === 'successful_pulse_hit' ? 'successful_pulse_hit' : 'weapon_hit',
          chance: Math.max(0, Math.min(1, mag)),
          dotPerTick: Number(params.dotPerTick ?? 0),
          durationMs: Number(params.durationMs ?? 0),
          intervalMs: Number(params.intervalMs ?? 0),
          maxStacks: Number(params.maxStacks ?? 1),
          damageType: typeof params.damageType === 'string' ? params.damageType : (e.damageType ?? null),
          pulseDamage: Number(params.pulseDamage ?? 0),
        });
        break;
      }
      default:
        // Periodic friendly states (`regen_buff`, `party_regen`, `aura_pulse`)
        // are driven directly from their effect rows by the resolver, not
        // through the buff bag. Hostile mechanics never target a character.
        break;
    }
  }

  if (appliers.length > 0) {
    appliers.sort((a, b) => (a.abilityKey < b.abilityKey ? -1 : a.abilityKey > b.abilityKey ? 1 : 0));
    buffs.stackAppliers = appliers;
  }
  return buffs;
}

// ── Hostile creature state (control_debuff) ───────────────────────
/** Strongest active weakening on one creature, by control mode. */
export interface CreatureControlSnapshot {
  /** Whole AC points the creature's effective AC is lowered by. */
  readonly acReduction: number;
  /** Fraction (0..1) the creature's outgoing damage is lowered by. */
  readonly outgoingDamageReduction: number;
}

export const EMPTY_CREATURE_CONTROL: CreatureControlSnapshot = {
  acReduction: 0,
  outgoingDamageReduction: 0,
};

/**
 * Rebuild per-creature control state from persisted rows.
 *
 * Multiple simultaneous debuffs never sum: the strongest active reduction of
 * each mode wins. Rows whose mode was written before the typed contract fall
 * back to `damage_reduction`, the only behaviour the untyped rows ever had.
 */
export function buildCreatureControlSnapshot(
  effects: readonly PersistedEffectView[],
  nowMs: number,
): Map<string, CreatureControlSnapshot> {
  const out = new Map<string, { acReduction: number; outgoingDamageReduction: number }>();
  for (const e of effects) {
    if (e.targetKind !== 'creature' || e.mechanic !== 'control_debuff') continue;
    if (e.expiresAtMs <= nowMs) continue;
    const mag = Math.max(0, Number(e.magnitude ?? 0));
    if (!(mag > 0)) continue;
    const mode = (e.params ?? {}).controlMode === 'ac_reduction'
      ? 'ac_reduction'
      : 'damage_reduction';
    const cur = out.get(e.targetId) ?? { acReduction: 0, outgoingDamageReduction: 0 };
    if (mode === 'ac_reduction') {
      cur.acReduction = Math.max(cur.acReduction, Math.floor(mag));
    } else {
      cur.outgoingDamageReduction = Math.max(cur.outgoingDamageReduction, Math.min(0.9, mag));
    }
    out.set(e.targetId, cur);
  }
  return new Map([...out].map(([k, v]) => [k, { ...v } as CreatureControlSnapshot]));
}
