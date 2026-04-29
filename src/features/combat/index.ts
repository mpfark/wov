// Combat feature — hooks, utilities, and types for the combat system

export { usePartyCombat } from './hooks/usePartyCombat';
export { usePartyCombatLog } from './hooks/usePartyCombatLog';
export { useGameLoop } from './hooks/useGameLoop';
export type {
  RegenBuff, FoodBuff, CritBuff, StealthBuff, DamageBuff, RootDebuff, BattleCryBuff,
  DotDebuff, PoisonBuff, EvasionBuff, DisengageNextHit, IgniteBuff, AbsorbBuff,
  PartyRegenBuff, SunderDebuff, PoisonStack, IgniteStack,
} from './hooks/useGameLoop';
export { useCreatureBroadcast } from './hooks/useCreatureBroadcast';
export { useBuffState } from './hooks/useBuffState';
export type { BuffState, BuffSetters } from './hooks/useBuffState';
export { useMergedCreatureHpOverrides } from './hooks/useMergedCreatureState';

// Combat predictor
export { predictConservativeDamage, applyPredictedDamage } from './utils/combat-predictor';
export type { PredictionContext, PredictionResult } from './utils/combat-predictor';

// Combat math utilities
export * from './utils/combat-math';

// Combat resolver (client-side mirror of server logic)
export { resolveEffectTicks } from './utils/combat-resolver';
export type { EffectTickResult } from './utils/combat-resolver';

// Class abilities
export * from './utils/class-abilities';

// Combat action orchestration hook
export { useCombatActions } from './hooks/useCombatActions';
export type { UseCombatActionsParams } from './hooks/useCombatActions';

// Offscreen DoT wake-up scheduler
export { useOffscreenDotWakeup } from './hooks/useOffscreenDotWakeup';
export type { ActiveEffectSnapshot, UseOffscreenDotWakeupParams } from './hooks/useOffscreenDotWakeup';
