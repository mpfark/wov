## Why Camdria has 6 unspent points at L3

Camdria is a **halfling assassin, level 3, 6 unspent stat points**. Expected at L3 = **2** (one per level-up). The extra 4 came from a recent backfill migration that miscounted the starting-stat budget for non-classless characters.

### Root cause

New characters are now created as **classless** (`STARTING_CLASS = 'classless'` in `CharacterCreation.tsx`), and the class stat bonus (e.g. assassin: +3 DEX, +1 INT, +2 CHA = 6 pts) is **never granted** when the player later picks a class at the Order Hall (`join_order` only sets `class` + `is_classless = false`).

The backfill migration `20260630083258_…sql` (and its sibling `20260630083700`) computes the expected stat budget as:

```
48 + race_sum + class_sum + (level-1)/3 * class_level_bonus_sum + (level-1)
```

It assumes the class stat bonus was applied at creation. For every non-classless character it then top-ups `unspent_stat_points` by the "missing" amount — over-granting by exactly the class-stat sum (4–6 points depending on class).

Camdria check:
- Halfling classless baseline: 8 + race = `6/11/9/8/9/10` = sum 53
- Current stats: `7/12/9/8/9/10` = sum 55 (player allocated +1 STR, +1 DEX from the two L1→L3 points)
- Backfill thought baseline should be 53 + assassin class bonus (6) + 2 level-ups = 61, saw 55, granted 6.
- Correct value should have been 0 unspent (player already spent both).

### Affected characters
Every character whose class is **not** `classless` and that existed when the backfill ran. They all received the class-stat sum (warrior 6, wizard 6, ranger 7, assassin 6, healer 7, bard 5, templar 7) too many points.

### Plan

1. **Reverse the over-grant** with a corrective migration:
   - For every character, recompute the correct expected budget using the **classless** baseline (`48 + race_sum + (level-1)`) plus per-3-level class bonuses earned since reaching their class.
   - Compare against `current_stat_sum + unspent_stat_points`, subtract any positive overage from `unspent_stat_points` (floor at 0, never touch already-spent stats so nobody loses a stat they put a point in).
   - Skip `classless` characters entirely; their budget is already correct.

2. **Fix `useStatAllocation.handleFullRespec`** so it doesn't restore stats to a baseline that includes a class bonus the character never received:
   - Compute `creationStats` with `'classless'` instead of `character.class` (level-up class bonuses every 3 levels are still added separately and remain correct).

3. **Add a regression test** (or at least a comment) on the budget formula noting that the class stat bonus is **not** applied on Order-Hall recruitment, so all server/client math must start from the classless baseline.

### Out of scope
- No change to how class bonuses are granted at level milestones (every 3rd level via `CLASS_LEVEL_BONUSES`) — that path is correct.
- No retroactive grant of the class stat bonus on join_order (would be a separate design decision; current design intentionally keeps recruitment cosmetic).

### Files touched
- New migration `…_fix_stat_point_overgrant.sql` (corrective top-down recompute).
- `src/features/character/hooks/useStatAllocation.ts` (respec baseline fix).