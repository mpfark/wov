

## Fix: Status Bar HP/CP/MP Not Including Equipment Bonuses

### Problem

The status bars (HP, CP, MP) in the center panel use `character.max_hp` directly from the database, which is the **base** max HP without gear bonuses. The Attributes tab correctly adds equipment bonuses (flat HP bonus + CON gear modifier) on top. This causes the bars to show a lower max than the Attributes panel.

The same issue likely applies to CP and MP if there are gear bonuses affecting INT, WIS, or DEX.

### Fix

**`src/features/character/components/StatusBarsStrip.tsx`** -- Use the already-passed `equipmentBonuses` prop to calculate effective max values that include gear:

- `effectiveMaxHp` = `character.max_hp + (equipmentBonuses.hp || 0) + floor((equipmentBonuses.con || 0) / 2)`
- `effectiveMaxCp` = recalculate using `getMaxCp` with gear-adjusted INT/WIS, or add the delta from gear
- `effectiveMaxMp` = recalculate using `getMaxMp` with gear-adjusted DEX, or add the delta from gear

This matches exactly what the Attributes panel already computes, ensuring both views are consistent.

### Files

| File | Action |
|------|--------|
| `src/features/character/components/StatusBarsStrip.tsx` | Include equipment bonuses in effective max HP/CP/MP calculations |

