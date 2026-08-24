/**
 * pure/ — the C1 encounter simulation boundary.
 *
 * Not wired to production. `resolveTickPure` performs zero external calls and
 * returns a `ProposedTick` that only the C2 committer may apply.
 */

export * from './types.ts';
export { resolveTickPure } from './resolver.ts';
export { createTickRandom, RNG_STREAMS, type RngStream, type TickRandom } from './rng.ts';
export {
  orderActions,
  orderCreatures,
  orderEffects,
  orderEngagements,
  orderParticipants,
  orderProcs,
  orderTankPool,
} from './ordering.ts';
export { getPartyXpBonus } from './party-xp.ts';
export {
  stepBossCastSchedule,
  bossCastNeedsChanceRoll,
  type BossCastGateInput,
  type BossCastGateResult,
  type BossCastGateOutcome,
} from './boss-cast-schedule.ts';

