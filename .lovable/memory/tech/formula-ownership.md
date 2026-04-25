---
name: formula-ownership
description: Single source of truth for every gameplay formula lives in src/shared/formulas/, mirrored byte-for-byte to supabase/functions/_shared/formulas/. game-data.ts and combat-math.ts are barrels.
type: feature
---
Canonical owners (one place to change a number):

- `src/shared/formulas/stats.ts`     — getStatModifier, dice, diminishing returns
- `src/shared/formulas/classes.ts`   — CLASS_BASE_HP/AC, CLASS_LEVEL_BONUSES, CLASS_COMBAT_PROFILES, weapon affinity, shield/offhand constants
- `src/shared/formulas/resources.ts` — getMaxHp/Cp/Mp + getEffectiveMax* + regen
- `src/shared/formulas/combat.ts`    — calculateAC, anti-crit, shield block, hit quality, attack/defense pipeline
- `src/shared/formulas/xp.ts`        — XP curve + getXpPenaltySolo + getXpPenaltyParty (legacy `getXpPenalty` = solo alias)
- `src/shared/formulas/items.ts`     — stat budget, caps, repair, suggested gold value
- `src/shared/formulas/creatures.ts` — generateCreatureStats, calculateHumanoidGold
- `src/shared/formulas/economy.ts`   — CHA price multipliers, encumbrance, teleport CP cost

Mirror rule: `supabase/functions/_shared/formulas/*.ts` is byte-mirrored from `src/shared/formulas/*.ts` with the only mechanical change being `.ts` suffixes on relative imports. Never edit the Deno copy directly.

Barrels (do NOT add new logic, only re-exports + UI-only static data):
- `src/lib/game-data.ts` — re-exports + race/class labels/descriptions/stats, MILESTONE_TITLES, calculateStats
- `src/features/combat/utils/combat-math.ts` — pure barrel
- `supabase/functions/_shared/combat-math.ts` — pure barrel + 2 deprecated shims (`getWisDodgeChance`, `getDexMultiAttack`)

XP penalty has TWO curves (intentional): solo (lenient 0.06/0.09/0.12) used by client `useCombatActions.awardKillRewards`, party (harsh 0.10/0.15/0.20) used by server `reward-calculator.ts`. Renaming surfaced a previously silent split.

SQL mirror: `public.sync_character_resources()` mirrors getMaxHp/Cp/Mp in PL/pgSQL — must be updated alongside `resources.ts`.

Safeguard: `src/shared/formulas/__tests__/formula-parity.test.ts` snapshots key numeric outputs and verifies the barrels re-export the canonical implementations.
