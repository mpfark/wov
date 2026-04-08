

# Simplify HP & CP Regen: Same Base, Different Stat Scaling

## Problem
HP regen uses a `× 0.27` scaling factor (legacy compensation) making the numbers look weird and inconsistent with CP regen. The two formulas are completely different, which is confusing.

## Current Formulas (per 4s tick)
- **HP**: `(1 + floor((CON-10)/4) + gear + food + milestone + inn) × 0.27` — at CON 20 with no extras: ~1/tick
- **CP**: `(1 + floor(mod/2)×0.5 + food + milestone + inn)` — at primary 20: ~2/tick, plus food can push to ~19

## Proposed: One Unified Formula
Use the **same base regen function** for both, just driven by different stats:

```
statRegen(stat) = 1 + floor((stat - 10) / 3)
```

- **HP regen** uses **CON** → at CON 20: `1 + 3 = 4` per tick
- **CP regen** uses **INT** → at INT 20: `1 + 3 = 4` per tick (no more class primary stat lookup)

**No 0.27 multiplier. No class primary stat for CP.** Both use the same clean function.

Full tick formula (same for both):
```
regenAmount = max(floor((statRegen + gearRegen + foodRegen + milestoneFlat + innFlat) × combatMult), 1)
```

### Reference values (base only, no gear/food):
| Stat value | Regen/tick |
|-----------|-----------|
| 10 | 1 |
| 13 | 2 |
| 16 | 3 |
| 20 | 4 |
| 25 | 6 |
| 30 | 7 |
| 40 | 11 |

## Files Changed

### 1. `src/lib/game-data.ts`
- Replace `getBaseRegen()` with a generic `getStatRegen(stat)` using `1 + floor((stat-10)/3)`
- Remove `getCpRegenRate()` and `CLASS_PRIMARY_STAT` (no longer needed)

### 2. `src/features/combat/hooks/useGameLoop.ts`
- **HP regen**: Use `getStatRegen(conWithGear)` directly — remove the `× 0.27` multiplier
- **CP regen**: Use `getStatRegen(intWithGear)` instead of `getCpRegenRate(primaryVal)` — remove `CLASS_PRIMARY_STAT` lookup
- Simplify refs (no need for `cpStatRef` to look up arbitrary primary stat)

### 3. `src/components/admin/GameManual.tsx`
- Update regen documentation to show the unified formula

### 4. Other references
- Search for any imports of `getBaseRegen`, `getCpRegenRate`, `CLASS_PRIMARY_STAT` and update them

