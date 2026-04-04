
# Graded Hit Quality System

## Summary

Extend the existing hit/miss resolution with five quality bands based on attack roll margin vs AC. Glancing hits land just below AC, while weak/normal/strong hits land above it. Crits remain a separate layer on top.

## Hit Quality Bands

The margin is `totalAtk - creatureAC`. Current logic: hit if `roll !== 1 && total >= AC` (or crit). New logic keeps this boundary but adds a "near miss" glancing band below it.

```text
margin < -4        → miss        (0.0x)  — unchanged
margin -4 to -1    → glancing    (0.25x) — new "near miss" band
margin 0 to +2     → weak        (0.60x)
margin +3 to +6    → normal      (1.00x)
margin +7+         → strong      (1.25x)
```

Natural 1 always misses. Crits always hit at "normal" quality minimum (then get the 2x crit multiplier on top).

### Progression protection

Glancing/weak hits vs high-AC targets are clamped to max 3 damage (after all multipliers). This prevents weak creatures from threatening strong players.

## New shared function: `combat-math.ts`

```typescript
export type HitQuality = 'miss' | 'glancing' | 'weak' | 'normal' | 'strong';

export function getHitQuality(margin: number, isNat1: boolean, isCrit: boolean): HitQuality {
  if (isNat1) return 'miss';
  if (isCrit) return margin >= 7 ? 'strong' : 'normal';
  if (margin < -4) return 'miss';
  if (margin < 0) return 'glancing';
  if (margin <= 2) return 'weak';
  if (margin <= 6) return 'normal';
  return 'strong';
}

export const HIT_QUALITY_MULT: Record<HitQuality, number> = {
  miss: 0, glancing: 0.25, weak: 0.60, normal: 1.0, strong: 1.25,
};

export const GLANCING_WEAK_CAP = 3;
```

Added to both `supabase/functions/_shared/combat-math.ts` and `src/features/combat/utils/combat-math.ts`.

## Changes to `combat-tick/index.ts`

### Player main-hand attacks (lines 599-698)

Current flow: roll → hit/miss binary → damage calc → buffs → HP subtraction.

New flow:
1. Roll d20, compute `total` and `margin = total - creatureAc`
2. `quality = getHitQuality(margin, roll === 1, roll >= effCrit)`
3. If `quality === 'miss'` → miss event (unchanged)
4. Otherwise: roll base damage → apply `HIT_QUALITY_MULT[quality]` → then crit (if crit, 2x on top) → affinity → 2H mult → stealth/buff multipliers → clamp → cap glancing/weak at 3 → HP subtraction
5. Event includes `hit_quality` field for combat text

### Off-hand attacks (lines 701-764)

Same pattern: compute margin → quality → apply multiplier before offhand 30% reduction → cap glancing/weak at 3.

### Creature counterattacks (`applyCreatureHit`, lines 492-551)

Same pattern: compute `margin = roll - tAC` → quality → apply multiplier after base damage roll → then crit/level-gap/overflow logic → cap glancing/weak at 3 → HP subtraction. Event includes `hit_quality`.

### Event format

All attack events gain a `hit_quality` field (`'miss' | 'glancing' | 'weak' | 'normal' | 'strong'`). Message strings updated to include quality label for non-normal hits (e.g., "glancing blow", "weak hit", "strong hit").

## Combat text integration

The existing `DAMAGE_TIERS` in `combat-text.ts` already maps damage amounts to tier words (graze, nick, hit, wound, etc.). Since glancing hits produce 1-3 damage, they'll naturally fall into "graze" tier. No changes needed to `combat-text.ts` — the damage-based tier system handles it automatically.

## Files Modified

| File | Change |
|------|--------|
| `supabase/functions/_shared/combat-math.ts` | Add `HitQuality` type, `getHitQuality()`, `HIT_QUALITY_MULT`, `GLANCING_WEAK_CAP` |
| `src/features/combat/utils/combat-math.ts` | Mirror the same additions |
| `supabase/functions/combat-tick/index.ts` | Apply hit quality to player attacks, off-hand attacks, and creature counterattacks |

## What Does NOT Change

- Combat architecture, tick timing, server authority
- Crit range calculation, crit mitigation (AC overflow)
- Ability damage (barrage, execute, etc.)
- Offscreen DoT system
- Client-side prediction
- Database schema
- Buff/debuff system
