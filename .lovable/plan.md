

## Audit: HP/CP/MP Calculation Consistency

### Findings

1. **HP rounding bug in `getEffectiveMaxHp`** — The current formula `maxHp + floor(gearCon / 2)` is an approximation that produces wrong results when both base CON and gear CON are odd. The correct approach (used in StatPlannerDialog) passes the combined CON into the full modifier formula: `floor((baseCon + gearCon - 10) / 2)` vs `floor((baseCon - 10) / 2) + floor(gearCon / 2)`. Example: baseCon=15, gearCon=3 yields effective max HP off by 1.

2. **CharacterPanel attributes tab (line 985)** — Uses the same broken inline formula instead of calling the shared helper.

3. **CP and MP** — No issues found. Both `getEffectiveMaxCp` and `getEffectiveMaxMp` correctly pass gear-adjusted stats into `getMaxCp`/`getMaxMp`, matching what StatPlannerDialog does.

4. **Admin views** — `CharacterSummaryCard` and `AdminCharacterSheet` display raw database `max_hp`/`max_cp` without gear bonuses. This is acceptable for admin inspection of base DB values.

### Fix

Change `getEffectiveMaxHp` to accept `charClass`, `baseCon`, and `level` so it can use the proper `getMaxHp` formula with combined CON, eliminating the rounding error. Update all callsites to pass the additional parameters.

### New signature

```typescript
export function getEffectiveMaxHp(
  charClass: string,
  baseCon: number,
  level: number,
  equipmentBonuses: Record<string, number>
): number {
  return getMaxHp(charClass, baseCon + (equipmentBonuses.con || 0), level) + (equipmentBonuses.hp || 0);
}
```

### Callsites to update

| File | Change |
|------|--------|
| `src/lib/game-data.ts` | Update `getEffectiveMaxHp` signature and formula |
| `src/features/character/components/StatusBarsStrip.tsx` | Pass `character.class`, `character.con`, `character.level` to new signature |
| `src/features/combat/hooks/useGameLoop.ts` | Pass class, con, level from `regenCharRef` to new signature |
| `src/features/combat/hooks/useCombatActions.ts` | Pass class, con, level in heal and self_heal branches |
| `src/features/inventory/hooks/useConsumableActions.ts` | Pass class, con, level when computing potion cap |
| `src/pages/GamePage.tsx` | Pass class, con, level for HP broadcast |
| `src/features/character/components/CharacterPanel.tsx` (line 985) | Replace inline formula with `getEffectiveMaxHp(character.class, character.con, character.level, equipmentBonuses)` |
| `src/features/character/components/StatPlannerDialog.tsx` (line 79) | Replace inline `calculateHP(class, eCon) + (level-1)*5 + hp` with `getEffectiveMaxHp` using planned stats |

