

# Fix Regen: Add Base Floor + Sqrt Scaling

## Problems
1. A warrior with low INT gets absurdly low CP regen (0.1/tick) because `getStatRegen(10) = 1` and the display formula can produce tiny values.
2. High-stat characters (e.g. wizard with 45 INT) get enormous regen with linear scaling.
3. The CharacterPanel tooltip still says "×0.27 scaling" — leftover from the old system.

## New Formula

Replace the linear `getStatRegen`:

```
// Old: 1 + floor((stat - 10) / 3)  → stat 10 = 1, stat 40 = 11

// New: base floor of 2 + sqrt of stat modifier
getStatRegen(stat) = 2 + floor(sqrt(max(0, stat - 10)))
```

Reference values:
| Stat | Regen/tick |
|------|-----------|
| 10   | 2         |
| 13   | 3         |
| 16   | 4         |
| 20   | 5         |
| 25   | 5         |
| 30   | 6         |
| 40   | 7         |
| 50   | 8         |

Everyone gets at least 2/tick base. High stats still help but won't snowball.

## Files Changed

### 1. `src/lib/game-data.ts`
- Update `getStatRegen`: `return 2 + Math.floor(Math.sqrt(Math.max(0, stat - 10)));`

### 2. `src/features/character/components/CharacterPanel.tsx`
- **Line 980**: Remove "×0.27 scaling" from HP Regen tooltip — replace with just "(every 4s)"
- **Line 984**: The CP regen display formula has a leftover `0.1` minimum and `toFixed(1)` that makes it look fractional — simplify to use integers like HP regen does
- **Line 989**: Stamina tooltip still says "every 6s" — fix to "every 4s"

### 3. `src/components/admin/GameManual.tsx`
- Update the regen formula documentation to show the new `2 + √(stat - 10)` formula and reference table

