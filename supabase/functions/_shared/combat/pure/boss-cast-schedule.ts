/**
 * pure/boss-cast-schedule.ts — the boss-cast start gate as a pure state step.
 *
 * The resolver keeps its cooldown ledger in per-tick working state, which no
 * result surface exposes. Extracting the transition here means the historical
 * semantics can be asserted directly instead of inferred from the absence of a
 * cast event:
 *
 *   1. channeling      -> cooldown frozen (it only runs from resolution),
 *   2. cooldown > 0    -> one tick consumed, no start opportunity,
 *   3. no valid target -> nothing happens, the chance stream is untouched,
 *   4. chance refused  -> nothing happens, cooldown untouched, eligible next tick,
 *   5. start           -> cooldown set to the configured span (min one tick).
 */

export type BossCastGateOutcome =
  | 'channeling'
  | 'cooling_down'
  | 'no_target'
  | 'refused'
  | 'start';

export interface BossCastGateInput {
  /** A cast is already in flight for this creature. */
  readonly channeling: boolean;
  /** Cooldown ticks remaining before this tick is evaluated. */
  readonly cooldownTicks: number;
  /** A living, present, engaged target was selected. */
  readonly hasTarget: boolean;
  /** Authored per-tick start chance, already clamped to [0, 1]. */
  readonly chance: number;
  /**
   * The deterministic roll from the named `boss_cast_start` stream, or null
   * when no roll is drawn (chance <= 0 or chance >= 1 consume no randomness).
   */
  readonly roll: number | null;
  /** Authored cooldown span applied when a cast starts. */
  readonly configuredCooldownTicks: number;
}

export interface BossCastGateResult {
  readonly outcome: BossCastGateOutcome;
  /** Cooldown ticks remaining after this tick. */
  readonly cooldownTicksAfter: number;
}

/** True when the gate needs a roll — the only case that touches the RNG. */
export function bossCastNeedsChanceRoll(chance: number): boolean {
  return chance > 0 && chance < 1;
}

export function stepBossCastSchedule(input: BossCastGateInput): BossCastGateResult {
  const cooldown = Math.max(0, input.cooldownTicks);
  if (input.channeling) return { outcome: 'channeling', cooldownTicksAfter: cooldown };
  if (cooldown > 0) return { outcome: 'cooling_down', cooldownTicksAfter: cooldown - 1 };
  if (!input.hasTarget) return { outcome: 'no_target', cooldownTicksAfter: cooldown };
  if (input.chance <= 0) return { outcome: 'refused', cooldownTicksAfter: cooldown };
  if (bossCastNeedsChanceRoll(input.chance) && (input.roll ?? 1) > input.chance) {
    return { outcome: 'refused', cooldownTicksAfter: cooldown };
  }
  return {
    outcome: 'start',
    cooldownTicksAfter: Math.max(1, Math.floor(input.configuredCooldownTicks)),
  };
}
