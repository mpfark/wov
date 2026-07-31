/**
 * Phase 5b — shared status-application primitives.
 *
 * All stacking, refreshing damage-over-time effects (bleed, poison, ignite,
 * and any future mechanic) go through `applyStackingEffect` so the two rules
 * that were previously re-typed at each call site can't drift:
 *
 *   1. Re-applying adds a stack, capped at the mechanic's max.
 *   2. Refreshing NEVER resets cadence — `next_tick_at` is preserved, so
 *      repeated procs in consecutive heartbeats can't push the next tick
 *      forward forever and starve the DoT.
 *
 * Mirrored to `supabase/functions/_shared/combat/status.ts`.
 */

export interface StackingEffectState {
  stacks: number;
  damage_per_tick: number;
  next_tick_at: number;
  expires_at: number;
  tick_rate_ms: number;
}

export function applyStackingEffect(
  existing: Pick<StackingEffectState, 'stacks' | 'next_tick_at'> | null | undefined,
  input: {
    /** Reference time for the refresh (tick time, not wall clock). */
    now: number;
    durationMs: number;
    damagePerTick: number;
    maxStacks: number;
    tickRateMs: number;
  },
): StackingEffectState {
  const maxStacks = Math.max(1, Math.floor(input.maxStacks));
  const stacks = existing
    ? Math.min(Math.max(1, Math.floor(existing.stacks)) + 1, maxStacks)
    : 1;

  return {
    stacks,
    damage_per_tick: Math.max(1, Math.floor(input.damagePerTick)),
    next_tick_at: existing ? existing.next_tick_at : input.now + input.tickRateMs,
    expires_at: input.now + Math.max(0, Math.floor(input.durationMs)),
    tick_rate_ms: input.tickRateMs,
  };
}

/** True when an effect row has run out at the given reference time. */
export function isEffectExpired(
  effect: Pick<StackingEffectState, 'expires_at'>,
  now: number,
): boolean {
  return (effect.expires_at ?? 0) <= now;
}
