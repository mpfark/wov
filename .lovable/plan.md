

## Refactor: Extract Shared Effective Max HP/CP/MP Helpers

### Problem

The formula for computing gear-adjusted max HP, CP, and MP is duplicated in 5 locations with slight inconsistencies (e.g. `useConsumableActions` still uses base `max_hp` without gear bonuses).

### Solution

Add three pure helper functions to `src/lib/game-data.ts` and replace all inline calculations.

### New helpers in `src/lib/game-data.ts`

```typescript
export function getEffectiveMaxHp(
  maxHp: number,
  equipmentBonuses: Record<string, number>
): number {
  return maxHp + (equipmentBonuses.hp || 0) + Math.floor((equipmentBonuses.con || 0) / 2);
}

export function getEffectiveMaxCp(
  level: number, int: number, wis: number, cha: number,
  equipmentBonuses: Record<string, number>
): number {
  return getMaxCp(level, int + (equipmentBonuses.int || 0), wis + (equipmentBonuses.wis || 0), cha + (equipmentBonuses.cha || 0));
}

export function getEffectiveMaxMp(
  level: number, dex: number,
  equipmentBonuses: Record<string, number>
): number {
  return getMaxMp(level, dex + (equipmentBonuses.dex || 0));
}
```

### Callsites to update

| File | What changes |
|------|-------------|
| `src/lib/game-data.ts` | Add the three helper functions |
| `src/features/character/components/StatusBarsStrip.tsx` | Replace inline HP/CP/MP max calculations with `getEffectiveMaxHp`, `getEffectiveMaxCp`, `getEffectiveMaxMp` |
| `src/features/combat/hooks/useGameLoop.ts` | Replace inline effective max calculations in HP regen, CP regen, MP regen, and party heal sections |
| `src/features/combat/hooks/useCombatActions.ts` | Replace inline `healEffMaxHp` in heal and self_heal branches |
| `src/pages/GamePage.tsx` | Replace inline `effectiveMaxHp` for HP broadcast |
| `src/features/inventory/hooks/useConsumableActions.ts` | **Bug fix**: use `getEffectiveMaxHp` with `equipmentBonuses` instead of bare `max_hp` (requires adding `equipmentBonuses` to the params interface) |

