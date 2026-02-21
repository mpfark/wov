

# Reduced XP Penalty at Lower Levels

## Problem
The current XP level penalty is a flat 20% reduction per level above the creature, with a minimum of 10% reward. At low levels (1-5), players quickly outlevel the starting creatures and get heavily penalized before they can reasonably move to higher-level areas or unlock abilities.

## Solution
Introduce a **graduated penalty system** that is lenient at low levels and scales to the current harshness at higher levels:

- **Levels 1-5**: 10% penalty per level difference (half the current rate)
- **Levels 6-10**: 15% penalty per level difference
- **Levels 11+**: 20% penalty per level difference (current behavior)

The minimum reward floor stays at 10%.

## Example Impact

| Player Lvl | Creature Lvl | Current XP% | New XP% |
|------------|-------------|-------------|---------|
| 3          | 1           | 60%         | 80%     |
| 5          | 2           | 40%         | 70%     |
| 5          | 3           | 60%         | 80%     |
| 8          | 5           | 40%         | 55%     |
| 15         | 10          | 10%         | 10%     |

## Technical Details

Three locations need updating:

1. **`src/hooks/useCombat.ts`** (~line 338-339): Extract penalty calculation into a helper or inline the graduated formula.

2. **`src/pages/GamePage.tsx`** (~line 1075-1076): Same update for the Barrage ability kill reward logic.

3. **`src/lib/game-data.ts`**: Add a new exported function `getXpPenalty(playerLevel, creatureLevel)` to centralize the logic and avoid duplication:
```
function getXpPenalty(playerLevel, creatureLevel):
  levelDiff = max(playerLevel - creatureLevel, 0)
  if playerLevel <= 5: penaltyRate = 0.10
  else if playerLevel <= 10: penaltyRate = 0.15
  else: penaltyRate = 0.20
  return max(1 - levelDiff * penaltyRate, 0.10)
```

4. **`src/components/admin/GameManual.tsx`** (~line 335, 371): Update the documentation text to reflect the graduated penalty system.

