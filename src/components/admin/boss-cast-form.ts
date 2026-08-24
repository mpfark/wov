/**
 * admin/boss-cast-form.ts — the admin editor's boss-cast load/save transform,
 * as pure functions.
 *
 * The component owns inputs and toasts; the rules live here so the real
 * behaviour (not a synthetic `buildCanonicalBossCast` call) can be tested:
 *
 *  - the enabled checkbox mirrors *runtime* eligibility exactly, via the shared
 *    `bossCastIsEnabled` helper — never `!!boss_cast`, which would show an
 *    explicitly disabled boss or an opt-in rare as on and silently activate it;
 *  - unchecking never deletes a configured cast: the complete canonical object
 *    is preserved with `enabled: false`, unknown keys and all. Removing a cast
 *    entirely would be a separate, explicit action;
 *  - validation runs only for an enabled cast, so a disabled legacy row can be
 *    preserved without forcing the admin to complete or delete it.
 */

import {
  BOSS_CAST_DEFAULTS,
  buildCanonicalBossCast,
  bossCastIsEnabled,
  deriveCastIdentities,
  validateCanonicalBossCast,
  type BossCastContext,
  type CreatureRarity,
} from '@/shared/combat/c3/boss-cast-contract';
import { FLAVOR_MAX_LEN } from '@shared/proc-log-format';

export interface BossCastFormFields {
  boss_cast_enabled: boolean;
  boss_cast_label: string;
  boss_cast_damage_type: string;
  boss_cast_flavor: string;
  boss_cast_hit_flavor: string;
  boss_cast_ticks: number;
  boss_cast_cooldown_ms: number;
  boss_cast_chance: number;
  boss_cast_lock_ticks: number;
  boss_cast_base_amount: number;
  boss_cast_base_aoe_amount: number;
  boss_cast_primary_share: number;
  boss_cast_aoe_share: number;
  boss_cast_sp_cap: number;
  /** The stored object exactly as loaded, so nothing the form omits is lost. */
  boss_cast_raw: Record<string, unknown> | null;
}

const rec = (v: unknown): Record<string, unknown> | null =>
  typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : null;

const numOr = (v: unknown, fallback: number): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
};

const strOr = (v: unknown, fallback: string): string => (typeof v === 'string' ? v : fallback);

/** Load transform: stored creature row -> form fields. */
export function bossCastFormFromCreature(
  input: { readonly rarity: string | null | undefined; readonly boss_cast: unknown },
  tickRateMs: number,
): BossCastFormFields {
  const raw = rec(input.boss_cast);
  const sp = rec(raw?.stored_power);
  const rate = Number.isFinite(tickRateMs) && tickRateMs > 0 ? tickRateMs : 2000;
  return {
    boss_cast_enabled: bossCastIsEnabled(raw, input.rarity as CreatureRarity | null | undefined),
    boss_cast_label: strOr(raw?.label, BOSS_CAST_DEFAULTS.label) || BOSS_CAST_DEFAULTS.label,
    boss_cast_damage_type: strOr(raw?.damage_type, ''),
    boss_cast_flavor: strOr(raw?.cast_flavor ?? raw?.casting_text, ''),
    boss_cast_hit_flavor: strOr(raw?.hit_flavor ?? raw?.casted_text, ''),
    boss_cast_ticks: Math.max(1, Math.round(numOr(raw?.cast_ms, BOSS_CAST_DEFAULTS.castMs) / rate)),
    boss_cast_cooldown_ms: numOr(raw?.cooldown_ms, BOSS_CAST_DEFAULTS.cooldownMs),
    boss_cast_chance: numOr(raw?.chance, BOSS_CAST_DEFAULTS.chance),
    boss_cast_lock_ticks: Math.max(0, Math.round(numOr(raw?.lock_ms, 0) / rate)),
    boss_cast_base_amount: numOr(raw?.base_amount, numOr(raw?.amount, 0)),
    boss_cast_base_aoe_amount: numOr(raw?.base_aoe_amount, 0),
    boss_cast_primary_share: numOr(sp?.primary_share, BOSS_CAST_DEFAULTS.primaryShare),
    boss_cast_aoe_share: numOr(sp?.aoe_share, BOSS_CAST_DEFAULTS.aoeShare),
    boss_cast_sp_cap: numOr(sp?.cap, 0),
    boss_cast_raw: raw,
  };
}

export interface BossCastSaveResult {
  /** The value to write to `creatures.boss_cast`. */
  readonly payload: Record<string, unknown> | null;
  /** Blocking authoring problems. Only ever populated for an enabled cast. */
  readonly problems: readonly string[];
  /** True when an existing configuration was preserved as disabled. */
  readonly preservedDisabled: boolean;
}

/**
 * Save transform: form fields + creature context -> stored `boss_cast` value.
 * `creatureId` must already be the permanent immutable id (allocated before the
 * insert for a new creature) — the cast identity is anchored to it.
 */
export function buildBossCastSave(
  form: BossCastFormFields,
  ctx: { readonly rarity: string; readonly creatureId: string; readonly level: number; readonly tickRateMs: number },
): BossCastSaveResult {
  const existing = form.boss_cast_raw;
  const hasExisting = existing !== null && Object.keys(existing).length > 0;
  const enabled =
    (ctx.rarity === 'boss' || ctx.rarity === 'rare') && form.boss_cast_enabled;

  if (!enabled && !hasExisting) {
    return { payload: null, problems: [], preservedDisabled: false };
  }

  const label = form.boss_cast_label.trim() || BOSS_CAST_DEFAULTS.label;
  const [identity] = deriveCastIdentities([{
    creatureId: ctx.creatureId,
    label,
    abilityKey: (existing?.ability_key as string | undefined) ?? null,
  }]);
  const sp = rec(existing?.stored_power) ?? {};
  const acc = rec(existing?.accumulate) ?? {};
  const targetModeRaw = existing?.target_mode;

  const payload = buildCanonicalBossCast(
    {
      abilityKey: identity.key,
      enabled,
      label,
      damageType: form.boss_cast_damage_type || null,
      castFlavor: form.boss_cast_flavor.trim().slice(0, FLAVOR_MAX_LEN) || null,
      hitFlavor: form.boss_cast_hit_flavor.trim().slice(0, FLAVOR_MAX_LEN) || null,
      baseAmount: Math.max(0, Math.floor(form.boss_cast_base_amount)),
      baseAoeAmount: Math.max(0, Math.floor(form.boss_cast_base_aoe_amount)),
      castMs: Math.max(1, Math.floor(form.boss_cast_ticks)) * ctx.tickRateMs,
      cooldownMs: Math.max(1000, Math.floor(form.boss_cast_cooldown_ms)),
      chance: Math.max(0, Math.min(1, numOr(form.boss_cast_chance, BOSS_CAST_DEFAULTS.chance))),
      lockMs: Math.max(0, Math.floor(form.boss_cast_lock_ticks)) * ctx.tickRateMs,
      targetMode:
        targetModeRaw === 'tank_strict' || targetModeRaw === 'random_alive'
          ? targetModeRaw
          : 'tank_preferred',
      storedPower: {
        consumeMode: strOr(sp.consume_mode, BOSS_CAST_DEFAULTS.consumeMode),
        consumePct: numOr(sp.consume_pct, BOSS_CAST_DEFAULTS.consumePct),
        consumeAmount: Math.max(0, numOr(sp.consume_amount ?? sp.consume_fixed, 0)),
        primaryShare: Math.max(0, numOr(form.boss_cast_primary_share, BOSS_CAST_DEFAULTS.primaryShare)),
        aoeShare: Math.max(0, numOr(form.boss_cast_aoe_share, BOSS_CAST_DEFAULTS.aoeShare)),
        cap: Math.max(0, Math.floor(form.boss_cast_sp_cap)) || null,
      },
      accumulate: {
        enabled: typeof acc.enabled === 'boolean' ? acc.enabled : true,
        source: strOr(acc.source, 'primary_target'),
        method: strOr(acc.method, 'expected'),
        pauseAutoattacks: typeof acc.pause_autoattacks === 'boolean' ? acc.pause_autoattacks : true,
        critDuringCast: strOr(acc.crit_during_cast, 'disabled'),
      },
    },
    existing ?? undefined,
  );

  if (!enabled) {
    // Preserved verbatim-in-value, explicitly off. No validation: an incomplete
    // legacy row must not be held hostage by the editor.
    return { payload, problems: [], preservedDisabled: true };
  }

  const contractCtx: BossCastContext = {
    rarity: ctx.rarity as CreatureRarity,
    creatureId: ctx.creatureId,
    level: ctx.level,
    tickRateMs: ctx.tickRateMs,
  };
  return {
    payload,
    problems: validateCanonicalBossCast(payload, contractCtx),
    preservedDisabled: false,
  };
}
