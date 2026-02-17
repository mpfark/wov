

## Game Balance Analysis and Improvements

### Current Balance at Level 20

Here is a side-by-side comparison of a Level 20 Warrior (Human) vs a Level 20 Boss creature:

```text
                    Player (Warrior)     Boss Creature
  Primary Stat      ~39 STR              ~29 STR
  HP                ~130                 ~220
  AC                ~19                  ~20
  Attack Roll       d20 + 14             d20 + 9
  Damage            1d10 + 14 (15-24)    1d6 + 9 (10-15)
  Hit Chance        ~85% vs AC 20        ~55% vs AC 19
  DPS (approx)      ~16.5/tick           ~6.9/tick
  Ticks to Kill     ~14 ticks            ~8 ticks
```

The player kills a boss in roughly 14 ticks. The boss needs about 19 ticks to kill the player. Factor in HP regen + abilities and the player wins handily. At higher levels the gap widens.

### Root Causes

1. **Creature damage is hard-coded to 1d6** regardless of level or rarity. A level 1 regular and a level 40 boss both roll 1d6 for damage.
2. **Player stats scale linearly** (+1 all stats per level) while creature stats scale at only 0.5 per level.
3. **Creature AC scaling is slow** (0.4 per level) compared to player stat modifier growth.
4. **No creature ability scaling** -- creatures have no special attacks, abilities, or multi-hit.

### Proposed Improvements

#### 1. Scale Creature Damage Dice by Level and Rarity
Replace the hard-coded `rollDamage(1, 6)` in `useCombat.ts` with a formula based on creature stats:

```text
  Regular:  1d(4 + level/2)  + STR mod
  Rare:     1d(6 + level/2)  + STR mod
  Boss:     1d(8 + level/2)  + STR mod
```

At level 20 boss: 1d18 + 9 = 10-27 damage (up from 10-15).

#### 2. Improve Creature Stat Scaling in `generateCreatureStats`
Increase the per-level stat growth from 0.5 to 0.7:

```text
  Current:  baseStat = 8 + floor(level * 0.5)   -> 18 at level 20
  Proposed: baseStat = 8 + floor(level * 0.7)   -> 22 at level 20
```

This keeps low-level creatures weak but closes the gap at higher levels.

#### 3. Improve Creature AC Scaling
Increase AC growth from 0.4 to 0.6 per level:

```text
  Current:  AC = 8 + floor(level * 0.4) + rarity_bonus  -> 20 for lv20 boss
  Proposed: AC = 8 + floor(level * 0.6) + rarity_bonus  -> 24 for lv20 boss
```

#### 4. Add Creature HP Scaling for Regular Monsters
The current HP formula `(8 + level * 4)` is reasonable for regulars but could use a slight bump:

```text
  Current:  (8 + level * 4) * rarity_mult
  Proposed: (10 + level * 5) * rarity_mult
```

### Revised Balance at Level 20

```text
                    Player (Warrior)     Boss Creature (New)
  Primary Stat      ~39 STR              ~35 STR
  HP                ~130                 ~275
  AC                ~19                  ~24
  Attack Roll       d20 + 14             d20 + 12
  Damage            1d10 + 14 (15-24)    1d18 + 12 (13-30)
  Hit Chance        ~75% vs AC 24        ~70% vs AC 19
  DPS (approx)      ~14.6/tick           ~15.1/tick
  Ticks to Kill     ~19 ticks            ~9 ticks
```

Bosses become genuinely dangerous. Regulars remain farmable. Rare creatures become a challenge worth preparing for.

### Files to Change

1. **`src/lib/game-data.ts`** -- Update `generateCreatureStats` with new scaling constants (baseStat 0.7, AC 0.6, HP `10 + level*5`).
2. **`src/hooks/useCombat.ts`** -- Replace hard-coded `rollDamage(1, 6)` in the creature counterattack section (~lines 344-368) with a level/rarity-based damage formula.
3. **`src/components/admin/CreatureManager.tsx`** -- The admin panel auto-generates stats via `generateCreatureStats`, so existing creatures will get new stats on next save. Optionally run a bulk update on all existing creatures.
4. **`supabase/functions/admin-users/index.ts`** -- No changes needed (admin grant-xp doesn't involve creature combat).
5. **(Optional) Bulk creature stat update** -- SQL to recalculate stats for all existing creatures in the database using the new formula.

### What This Does NOT Change
- Player progression (stats, HP, abilities) stays the same
- Loot tables, gold drops, XP formulas unchanged
- Party mechanics and class abilities unchanged
- Low-level balance (levels 1-5) remains gentle for new players

