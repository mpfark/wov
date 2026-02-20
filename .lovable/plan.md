

## Gear-Focused Character Progression

### Problem
Currently, characters gain +1 to ALL 6 stats every level (up to level 29), resulting in massive base stat inflation. A level 40 healer has 53 WIS from leveling alone -- making gear bonuses of +3-5 feel insignificant. The goal is to shift power so that **gear is the primary source of character strength**, with leveling providing a foundation that gear builds on.

### Current vs Proposed Stat Growth

Using a level 40 Elf Healer as an example (starting WIS = 12):

| Source | Current | Proposed |
|--------|---------|----------|
| Base + Race + Class | 12 | 12 |
| Level-up all-stat gains | +28 (every level to 29) | +5 (every 5 levels: 5,10,15,20,25) |
| Class bonus (WIS every 3 levels) | +13 | +13 |
| **Total (naked)** | **53** | **30** |
| Good gear (+8 WIS) | 61 (15% boost) | 38 (27% boost) |

Gear goes from a minor bonus to a **meaningful power source**.

### Changes

#### 1. Stat Gain Formula
- **Old**: +1 to all 6 stats every level (level 2-29)
- **New**: +1 to all 6 stats every 5th level (levels 5, 10, 15, 20, 25, 30, 35, 40...) -- uncapped
- Class bonuses every 3 levels remain unchanged

#### 2. Code Updates (4 locations handle level-ups)
- **`src/hooks/useCombat.ts`** -- client-side solo level-up logic
- **`award_party_member` DB function** -- server-side party level-up
- **`supabase/functions/admin-users/index.ts`** -- admin grant-xp and set-level actions
- **`src/components/admin/GameManual.tsx`** -- documentation

#### 3. Migrate Existing Characters
A database migration will recalculate every character's stats using the new formula:
- For each character, compute what their stats *should* be: base (8) + race bonus + class bonus + (floor(level/5) for all-stat gains) + (class level bonuses for each 3rd level)
- Add back any unspent stat points
- Recalculate max_hp and ac based on new stats

#### 4. Item Stat Budget Adjustments
Since stats from leveling are lower, item stat caps may need a small bump so higher-level gear can provide more meaningful bonuses. This ensures there is enough gear headroom to compensate for the reduced base stats:
- Primary stat caps: `4 + floor(level/4)` (up from `3 + floor(level/5)`)
- This gives level 20 gear a cap of 9 instead of 7, and level 40 gear a cap of 14 instead of 11

### Technical Details

**useCombat.ts level-up change** (line ~417):
```
// Old: if (newLevel < 30)
// New: if (newLevel % 5 === 0)
```

**award_party_member DB function** level-up change:
```sql
-- Old: IF _new_level < 30 THEN +1 all stats
-- New: IF _new_level % 5 = 0 THEN +1 all stats
```

**Existing character migration SQL** -- recalculate all stats from scratch based on race, class, and level using the new formula.

**admin-users edge function** -- update grant-xp and set-level handlers to use the new every-5-levels rule.

**GameManual** -- update the stat gain column to show "+1 all stats" only on levels divisible by 5.

