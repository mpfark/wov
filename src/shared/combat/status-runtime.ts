/**
 * status-runtime.ts — the ONE implementation of "persist a reusable status".
 *
 * `status-application.ts` decides *whether* a status lands and *how big* it is.
 * This module owns the other half: writing the `active_effects` row, i.e. the
 * stacking, refresh, timing (`started_at` / `expires_at` / `next_tick_at`) and
 * attribution (`source_id` / `source_ability_key`) rules.
 *
 * Both runtimes build a runtime from this factory:
 *   - `combat-tick`      live combat, chance samples from `Math.random()`
 *   - `combat-catchup`   offscreen replay, chance samples from `statusSample()`
 *
 * Because the rules live here and nowhere else, the live and historical paths
 * cannot drift apart: the only difference between them is the supplied sample.
 *
 * `started_at` always marks the beginning of the uninterrupted status instance.
 * It is never an idempotency key — replay safety comes from the reconcile lock
 * and the monotonic catch-up cursor, not from timestamps.
 *
 * Mirrored (modulo Deno `.ts` import specifiers) to
 * `supabase/functions/_shared/combat/status-runtime.ts`.
 */
import { applyStackingEffect } from './status';
import { expiryFromTicks } from './creature-damage-modifiers';
import {
  statusChanceSucceeds,
  statusDamagePerTick,
  statusDurationMs,
  type StatusApplicationSpec,
} from './status-application';

/** A mutable in-memory `active_effects` row. */
export type StatusEffectRow = Record<string, unknown> & {
  id?: string;
  source_id?: string;
  target_id?: string;
  effect_type?: string;
};

export interface StatusRuntimeEnv {
  nodeId: string;
  /** Combat cadence — the unit non-periodic (tick-count) durations are in. */
  tickRateMs: number;
  /** Working set of rows; the runtime mutates it in place. */
  effects: StatusEffectRow[];
  /** Attribute modifier for a raw score (injected so both runtimes agree). */
  statModifier: (score: number) => number;
  /** Optional diminishing/combat-mod hook applied to scaled DoT magnitude. */
  dotStatMod?: (mod: number) => number;
  /** Class-bond magnitude multiplier for the applying character. */
  bondMultFor?: (sourceId: string) => number;
  /** Called with every target that now carries a status (dot target tracking). */
  onTargetTouched?: (targetId: string) => void;
  newId?: () => string;
}

export interface WriteStatusRowInput {
  sourceId: string;
  targetId: string;
  abilityKey: string;
  effectType: string;
  at: number;
  isPeriodic: boolean;
  durationMs?: number;
  durationTicks?: number | null;
  damagePerTick?: number;
  maxStacks?: number;
  tickRateMs?: number;
}

export interface ApplyStatusInput {
  sourceId: string;
  /** Character row of the applier (attribute scores). */
  character: Record<string, unknown>;
  /** Equipment/buff attribute bonuses for that character. */
  eb: Record<string, number>;
  spec: StatusApplicationSpec;
  abilityKey: string;
  targetId: string;
  at: number;
  /** 0..1 chance sample. Live: `Math.random()`. Replay: `statusSample(...)`. */
  sample: number;
  /** Ability-scaled chance (0..1) used only when config leaves chance empty. */
  scaledChance?: number | null;
  maxStacks?: number;
}

export interface StatusRuntime {
  writeStatusRow: (o: WriteStatusRowInput) => { stacks: number; damagePerTick: number };
  applyStatusFromSource: (
    o: ApplyStatusInput,
  ) => { label: string; stacks: number; damagePerTick: number } | null;
}

export function createStatusRuntime(env: StatusRuntimeEnv): StatusRuntime {
  const newId = env.newId ?? (() => crypto.randomUUID());
  const touch = (targetId: string) => env.onTargetTouched?.(targetId);

  /**
   * THE single writer of a reusable status row on a target.
   *
   * Periodic statuses (Bleed / Poison / Ignite / Scorched) stack and refresh
   * through the shared `applyStackingEffect` primitive; non-periodic ones
   * (Chilled and any future amplifier) never stack, and a re-application
   * restarts the window from `at`.
   */
  const writeStatusRow = (o: WriteStatusRowInput) => {
    const existing = env.effects.find(e =>
      e.source_id === o.sourceId && e.target_id === o.targetId && e.effect_type === o.effectType);

    if (!o.isPeriodic) {
      const expiresAt = expiryFromTicks(
        o.at, Math.max(1, o.durationTicks ?? 1), env.tickRateMs,
      );
      if (existing) {
        existing.started_at = o.at;
        existing.expires_at = expiresAt;
        existing.next_tick_at = null;
        existing.source_ability_key = o.abilityKey;
        delete (existing as { _expired?: boolean })._expired;
      } else {
        env.effects.push({
          node_id: env.nodeId, target_id: o.targetId, source_id: o.sourceId,
          session_id: null, effect_type: o.effectType,
          source_ability_key: o.abilityKey,
          stacks: 1, damage_per_tick: 0,
          // Non-periodic: no tick cadence, ever.
          next_tick_at: null, tick_rate_ms: env.tickRateMs,
          started_at: o.at, expires_at: expiresAt,
        });
      }
      touch(o.targetId);
      return { stacks: 1, damagePerTick: 0 };
    }

    const state = applyStackingEffect(
      existing as unknown as { stacks: number; next_tick_at: number } | undefined,
      {
        now: o.at,
        durationMs: Math.max(0, o.durationMs ?? 0),
        damagePerTick: Math.max(1, o.damagePerTick ?? 1),
        maxStacks: Math.max(1, Math.floor(o.maxStacks ?? 1)),
        tickRateMs: o.tickRateMs ?? env.tickRateMs,
      },
    );
    const effData = {
      node_id: env.nodeId, target_id: o.targetId, source_id: o.sourceId,
      session_id: null, effect_type: o.effectType,
      source_ability_key: o.abilityKey,
      ...state,
    };
    if (existing) Object.assign(existing, effData, { _expired: undefined });
    else env.effects.push({ id: newId(), ...effData });
    touch(o.targetId);
    return { stacks: state.stacks, damagePerTick: state.damage_per_tick };
  };

  /**
   * Status Application on a SUCCESSFUL qualifying event.
   *
   * One entry point for every trigger and both runtimes: the caller has already
   * established that the event landed (hit, valid living target, not cancelled)
   * and supplies the chance sample. Compatibility, chance, magnitude, stacking,
   * refresh, timing and attribution therefore cannot diverge between live
   * combat and offscreen replay.
   */
  const applyStatusFromSource = (o: ApplyStatusInput) => {
    const { spec } = o;
    if (!statusChanceSucceeds(spec, o.sample, o.scaledChance)) return null;

    if (!spec.isPeriodic) {
      writeStatusRow({
        sourceId: o.sourceId, targetId: o.targetId, abilityKey: o.abilityKey,
        effectType: spec.effectType, at: o.at, isPeriodic: false,
        durationTicks: spec.durationTicks,
      });
      return { label: spec.label, stacks: 1, damagePerTick: 0 };
    }

    const score = (attr: string) =>
      (Number((o.character as Record<string, unknown>)[attr]) || 10) + (Number(o.eb?.[attr]) || 0);
    const statMod = spec.statAttr ? env.statModifier(score(spec.statAttr)) : 0;
    const durMod = spec.durationStat ? env.statModifier(score(spec.durationStat)) : 0;
    const scaled = Math.max(0, statMod);
    const damagePerTick = statusDamagePerTick(spec, {
      effectiveStatMod: spec.flat !== null
        ? 0
        : (env.dotStatMod ? env.dotStatMod(scaled) : scaled),
      bondMult: env.bondMultFor?.(o.sourceId) ?? 1,
    });
    const written = writeStatusRow({
      sourceId: o.sourceId, targetId: o.targetId, abilityKey: o.abilityKey,
      effectType: spec.effectType, at: o.at, isPeriodic: true,
      durationMs: statusDurationMs(spec, durMod),
      damagePerTick,
      maxStacks: o.maxStacks ?? 1,
      tickRateMs: spec.tickRateMs ?? env.tickRateMs,
    });
    return { label: spec.label, ...written };
  };

  return { writeStatusRow, applyStatusFromSource };
}
