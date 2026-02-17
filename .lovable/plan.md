

## Remove Stat Cap, Change Progression After Level 30

### Problem
Currently all stats are capped at 30, and every level gives +1 to all six stats. This means every class ends up identical at high levels. Class bonuses every 3 levels are also wasted once the cap is hit.

### New Progression Rules
- **Levels 1-29**: +1 to all six stats per level (no cap). Class bonus every 3 levels on top.
- **Level 30+**: No more +1 to all stats. Only class-specific bonuses every 3 levels (uncapped) and +5 max HP.
- **Remove the hard cap of 30** entirely from all stat assignments.

### Changes Required

**1. `src/hooks/useCombat.ts` (client-side level-up logic)**
- Remove the `< 30` check on the per-level stat loop
- Add a condition: only apply the "+1 all stats" if `newLevel < 30`
- Remove `Math.min(..., 30)` from class bonus application
- Update log messages accordingly (e.g., "Stats no longer increase" at level 30+)

**2. `award_party_member` database function (migration)**
- Same logic change server-side: only add +1 to all stats when `_new_level < 30`
- Remove `LEAST(..., 30)` caps from all stat updates
- Class bonuses every 3 levels remain uncapped

**3. Reset existing characters (data update)**
- Recalculate all existing character stats using the new formula:
  - For characters level 1-29: base(10) + (level - 1) + class_bonuses
  - For characters level 30+: base(10) + 29 + class_bonuses_through_all_levels
- This ensures existing characters are consistent with the new system

### Technical Details

Client-side change (useCombat.ts lines ~293-321):
```typescript
// Only increase all stats before level 30
if (newLevel < 30) {
  for (const stat of statKeys) {
    const current = (char as any)[stat] || 10;
    (levelUpUpdates as any)[stat] = current + 1;
    boostedStats.push(stat.toUpperCase());
  }
}

// Class bonus every 3 levels (no cap)
if (newLevel % 3 === 0) {
  const bonuses = CLASS_LEVEL_BONUSES[char.class] || {};
  for (const [stat, amount] of Object.entries(bonuses)) {
    const currentVal = (levelUpUpdates as any)[stat] ?? (char as any)[stat] ?? 10;
    (levelUpUpdates as any)[stat] = currentVal + amount;
  }
}
```

Database function change:
```sql
-- Only +1 all stats for levels under 30
IF _new_level < 30 THEN
  -- add +1 to each stat (no cap)
END IF;
-- Class bonus every 3 levels always applies (no cap)
```

