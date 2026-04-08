

# Update Shield Block Amount Formula

## Change
Replace `10 + mod * 2` with `Math.round(11 + 2.5 * Math.sqrt(Math.max(strMod, 0)))` in all three mirrors of `getShieldBlockAmount`, and update the Game Manual formula text.

## Files

### 1. `src/features/combat/utils/combat-math.ts` (line ~167-168)
```typescript
return Math.round(11 + 2.5 * Math.sqrt(Math.max(mod, 0)));
```

### 2. `supabase/functions/_shared/combat-math.ts` (line ~167-168)
Same change.

### 3. `src/lib/game-data.ts` (line ~308-309)
Same change.

### 4. `src/components/admin/GameManual.tsx` (line ~545)
Update the block formula display from `min(8, 2 + floor(√STR_mod × 1.5))` to `round(11 + 2.5 × √STR_mod)`.

### 5. Redeploy `combat-tick` edge function

## Reference values
- STR mod 0 → 11
- STR mod 4 → 16
- STR mod 7 → 18
- STR mod 30 → 25

