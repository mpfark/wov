

# usePartyCombat.ts Responsibility-Reduction Pass (Revised)

## Single Revision Applied

Renamed `processTickResult.ts` → `interpretCombatTickResult.ts` to reflect that it is a pure interpretation layer with no React dependencies or side effects.

## Files

| File | Action | Owns |
|------|--------|------|
| `src/features/combat/utils/interpretCombatTickResult.ts` | Create | Pure interpretation of server combat responses into structured update instructions |
| `src/features/combat/utils/combat-predictor.ts` | Extend | Add prediction build/cleanup helpers |
| `src/features/combat/hooks/useCombatAggroEffects.ts` | Create | Auto-aggro and re-engagement logic |
| `src/features/combat/hooks/useCombatLifecycle.ts` | Create | Node-change, death, timeout, unmount cleanup |
| `src/features/combat/hooks/usePartyCombat.ts` | Modify | Compose extracted pieces, ~400 lines |

## `interpretCombatTickResult.ts` Constraints

- Completely pure: no refs, no setters, no side effects
- No React dependency
- Takes server `CombatTickResponse` data + identifiers as input
- Returns a structured result object describing what the hook should apply:
  - `creatureHpUpdates`, `killedCreatureIds`, `formattedLogMessages`
  - `characterUpdates`, `consumedBuffs`, `clearedDots`
  - `poisonProcs`, `igniteProcs`, `activeEffectsSnapshot`
  - `dotsByChar`, `hasLootDrop`, `sessionEnded`, `aliveEngagedIds`

The hook's `processTickResult` callback becomes a thin wrapper (~30 lines) that calls `interpretCombatTickResult` and applies results to state/refs.

## Everything Else Unchanged

- `combat-predictor.ts` extension (prediction build/cleanup helpers)
- `useCombatAggroEffects.ts` (auto-aggro, re-engage, initial aggro)
- `useCombatLifecycle.ts` (node-change, death, timeout, unmount, flee cleanup)
- `usePartyCombat.ts` remains orchestration layer (~400 lines)
- No combat behavior, timing, prediction, or party model changes

