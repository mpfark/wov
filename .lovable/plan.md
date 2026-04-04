

# Widen Glancing Hit Band

## Change

In `getHitQuality()`, change the miss threshold from `margin < -4` to `margin < -8`. This widens the glancing window from 4 points to 8 points below AC.

All other bands (weak, normal, strong) remain identical.

## Files Modified

| File | Change |
|------|--------|
| `supabase/functions/_shared/combat-math.ts` | `margin < -4` → `margin < -8` in `getHitQuality` |
| `src/features/combat/utils/combat-math.ts` | Same change (mirror) |

## Updated Bands

```text
margin < -8   → miss       (was < -4)
margin -8..-1 → glancing   (was -4..-1)
margin  0..+2 → weak       (unchanged)
margin +3..+6 → normal     (unchanged)
margin +7+    → strong     (unchanged)
```

## What Does NOT Change

- Glancing damage multiplier (0.25×) and cap (3 damage) — unchanged
- Weak/normal/strong bands, crit logic, offhand, buffs, abilities — all unchanged
- No server message format changes, no architecture changes

