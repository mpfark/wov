

# Max CP: Lower Base, Steeper Mental Stat Scaling

## Concept
Instead of the current flat `100 + (level - 1) * 3` for all classes, start CP lower and scale it more aggressively with mental stats (INT, WIS, CHA). This creates a meaningful gap between casters (who invest in mental stats) and martial classes (who don't).

## Formula

```
Max CP = 60 + (level - 1) * 3 + mentalMod * 5
```

Where `mentalMod = max(modifier(INT), modifier(WIS), modifier(CHA), 0)` and modifier = `floor((stat - 10) / 2)`.

- **Base lowered** from 100 to 60
- **Mental stat multiplier** set to 5 (up from the previously proposed 3)

## Class Comparison

Starting stats (level 1):

| Class   | Best Mental Stat | Modifier | Bonus | Max CP |
|---------|-----------------|----------|-------|--------|
| Warrior | 8               | -1 (floored to 0) | 0  | 60     |
| Ranger  | 10 (WIS)        | 0        | 0     | 60     |
| Rogue   | 10 (CHA)        | 0        | 0     | 60     |
| Wizard  | 11 (INT)        | 0        | 0     | 60     |
| Healer  | 11 (WIS)        | 0        | 0     | 60     |
| Bard    | 11 (CHA)        | 0        | 0     | 60     |

At level 1 everyone starts even at 60 CP. But as casters gain mental stat bonuses every 3 levels and from gear, the gap opens up:

| Class   | Approx Best Mental at Lv 10 | Mod | Bonus | Max CP |
|---------|----------------------------|-----|-------|--------|
| Warrior | ~10                        | 0   | 0     | 87     |
| Ranger  | ~13 (WIS)                  | +1  | +5    | 92     |
| Wizard  | ~15 (INT)                  | +2  | +10   | 97     |
| Healer  | ~15 (WIS)                  | +2  | +10   | 97     |
| Bard    | ~15 (CHA)                  | +2  | +10   | 97     |

| Class   | Approx Best Mental at Lv 20 | Mod | Bonus | Max CP |
|---------|----------------------------|-----|-------|--------|
| Warrior | ~12                        | +1  | +5    | 122    |
| Wizard  | ~20 (INT)                  | +5  | +25   | 142    |
| Bard    | ~20 (CHA)                  | +5  | +25   | 142    |

A Wizard at level 20 gets roughly **20 more CP** than a Warrior -- enough for one extra Tier 2 ability or two extra Punches. Warriors compensate with higher HP, AC, and physical damage.

## Gameplay Impact
- **Punch (10 CP)**: Warriors get 6 punches at level 1, casters also 6. By level 10, warriors still have ~8 while wizards have ~9.
- **Tier 1 abilities (15 CP)**: At level 5, everyone can use their first ability ~4 times. By level 15, casters can squeeze out 1-2 extra casts.
- **Search (5 CP)**: Still affordable for all classes.
- CP regen (already class-primary-stat-based) remains unchanged, further reinforcing caster advantage.

## Technical Details

### 1. `src/lib/game-data.ts`
Update `getMaxCp` signature and formula:
```
getMaxCp(level, int, wis, cha) ->
  mentalMod = max(floor((int-10)/2), floor((wis-10)/2), floor((cha-10)/2), 0)
  return 60 + (level - 1) * 3 + mentalMod * 5
```

### 2. `src/pages/CharacterCreation.tsx`
Calculate initial `max_cp` and `cp` using the new formula with the character's starting stats.

### 3. `src/hooks/useCombat.ts` (level-up logic, ~line 405)
After computing new stats on level-up, recalculate `max_cp` with the new formula. Adjust current `cp` upward by the difference.

### 4. `src/pages/GamePage.tsx` (Barrage and Punch kill level-up paths)
Same level-up recalculation as above in the two alternative XP-grant code paths.

### 5. `supabase/functions/admin-users/index.ts` (3 locations)
Update the three hardcoded `100 + (level - 1) * 3` references to fetch the character's mental stats and apply the new formula.

### 6. `src/components/game/CharacterPanel.tsx`
Update the CP bar tooltip to show the mental stat contribution (e.g. "Max CP: 60 base + 27 level + 10 mental").

### 7. `src/components/admin/GameManual.tsx`
Update the CP documentation section with the new formula, scaling table, and class comparison.

