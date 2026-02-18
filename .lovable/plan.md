

## Slow Down Leveling via Creature HP Increase

### The Problem
Creatures die too quickly, making leveling feel too fast. Currently a level 5 regular creature has only 35 HP.

### The Change
Increase the base HP formula in `src/lib/game-data.ts` from:

```text
HP = (10 + level * 5) * rarity_multiplier
```

to:

```text
HP = (15 + level * 8) * rarity_multiplier
```

### HP Comparison (Regular creatures)

| Level | Current HP | New HP |
|-------|-----------|--------|
| 1     | 15        | 23     |
| 5     | 35        | 55     |
| 10    | 60        | 95     |
| 15    | 85        | 135    |
| 20    | 110       | 175    |

Rare creatures get 1.5x and Bosses get 2.5x these values, so a level 10 Boss goes from 150 to 238 HP.

### Files to Change

**`src/lib/game-data.ts`** (1 line change)
- Update the HP calculation in `generateCreatureStats` from `(10 + level * 5)` to `(15 + level * 8)`

### Impact
- Fights take roughly 1.5-2x longer
- XP rate effectively halved since kills take longer
- No changes needed to XP formulas, creature damage, or any other systems
- Existing creatures in the database with manually set HP are unaffected (this only changes the auto-generate formula used by the admin creature editor)

