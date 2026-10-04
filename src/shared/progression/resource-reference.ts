/** Pure parity reference only. Receives already validated final maxima.
 * Formula derivation remains in formulas/resources.ts and formulas/combat.ts.
 * This is not sync_character_resources and never settles/clamps persisted state.
 */
import type { ResourceProjection } from './contract';
export interface ResourcePolicyInput {
  readonly levelGained: boolean;
  readonly alive: boolean;
  readonly current: Readonly<{ hp: number; cp: number; mp: number }>;
  readonly final: Readonly<{ maxHp: number; maxCp: number; maxMp: number; effectiveAc: number }>;
}
export function applyLevelResourcePolicy(input: ResourcePolicyInput): ResourceProjection {
  const clamp = (value: number, cap: number) => Math.min(Math.max(value, 0), cap);
  return {
    ...input.final,
    hp: !input.alive ? 0 : input.levelGained ? input.final.maxHp : clamp(input.current.hp, input.final.maxHp),
    cp: clamp(input.current.cp, input.final.maxCp),
    mp: clamp(input.current.mp, input.final.maxMp),
  };
}
