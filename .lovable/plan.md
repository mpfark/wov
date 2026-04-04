

# Graded Hit Quality System — Revised Plan

## Summary

Three refinements applied to the approved plan. The core system (five quality bands, margin-based multipliers, progression protection) is unchanged.

## Refinement 1: No hit-quality wording in server messages

The server adds a structured `hit_quality` field to all attack events but does **not** modify any `message` strings. Existing message format stays identical. The client can use the `hit_quality` field for presentation if/when desired.

## Refinement 2: Weak hits are not hard-capped

- **Glancing hits**: hard cap at `GLANCING_WEAK_CAP = 3` damage (always).
- **Weak hits**: cap only applies when the defender significantly outscales the attacker. Specifically, weak hits are capped at `GLANCING_WEAK_CAP` only when `margin < -2` (i.e. the attacker barely reached the glancing→weak threshold via crit or buffs but is still well below AC). In normal equal-level fights where `margin >= 0`, weak hits use the 0.60× multiplier with no flat cap.

This preserves progression protection while keeping weak hits visibly distinct from glancing hits.

## Refinement 3: Explicit canonical damage pipeline

One pipeline, followed identically by all three attack paths:

```text
PLAYER MAIN-HAND:
  1. Roll base damage (dice + stat mod)
  2. Hit-quality multiplier (0.25× / 0.60× / 1.0× / 1.25×)
  3. Crit multiplier (2× if crit, replaces the pre-quality raw×2)
  4. STR damage floor (non-crit only, applied to step 1 before quality mult)
  5. Weapon affinity multiplier
  6. Two-handed multiplier (1.25× if 2H)
  7. Offensive buffs (stealth 2×, damage buff 1.5×, focus strike flat, disengage)
  8. Clamp minimum 1
  9. Glancing cap (always 3) / Weak cap (3 only if margin < -2)
  10. → finalAppliedDamage → HP subtraction, event damage field

OFF-HAND:
  1. Roll base damage (dice + stat mod)
  2. Hit-quality multiplier
  3. Crit multiplier (2× if crit)
  4. Off-hand reduction (0.30×)
  5. Clamp minimum 1
  6. Glancing cap / conditional weak cap
  7. → finalAppliedDamage

CREATURE:
  1. Roll base damage (dice + STR mod)
  2. Hit-quality multiplier
  3. Crit multiplier (1.5× if crit, matching existing creature crit)
  4. Level-gap multiplier (existing)
  5. AC overflow reduction (crit below AC, existing)
  6. WIS awareness reduction (existing)
  7. Absorb shield (existing)
  8. Clamp minimum 1
  9. Glancing cap / conditional weak cap
  10. → finalAppliedDamage
```

Key: the hit-quality multiplier is always step 2, immediately after base damage. Everything else layers on top in the same order as today.

## Shared math additions (`combat-math.ts`, both copies)

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

## Changes to `combat-tick/index.ts`

### Player main-hand (lines 599–698)

- Compute `margin = total - creatureAc`
- `quality = getHitQuality(margin, roll === 1, roll >= effCrit)`
- `quality === 'miss'` → existing miss path (unchanged)
- Otherwise: apply pipeline steps 1–9 as defined above
- Add `hit_quality: quality` to the event object (no message string changes)

### Off-hand (lines 701–764)

- Compute margin, quality
- Apply pipeline steps 1–6
- Add `hit_quality` to event (no message changes)

### Creature attacks (`applyCreatureHit`, lines 492–551)

- Compute `margin = roll - tAC`
- `quality = getHitQuality(margin, isNat1, isCrit)`
- `quality === 'miss'` → existing miss path
- Otherwise: apply pipeline steps 1–9
- Add `hit_quality` to event (no message changes)

## Files modified

| File | Change |
|------|--------|
| `supabase/functions/_shared/combat-math.ts` | Add `HitQuality`, `getHitQuality()`, `HIT_QUALITY_MULT`, `GLANCING_WEAK_CAP` |
| `src/features/combat/utils/combat-math.ts` | Mirror same additions |
| `supabase/functions/combat-tick/index.ts` | Apply hit quality to all three attack paths per canonical pipeline; add `hit_quality` field to events; no message string changes |

## What does NOT change

- Combat architecture, tick timing, server authority
- Crit range calculation, crit mitigation (AC overflow)
- Ability damage (barrage, execute, etc.)
- Offscreen DoT system, client-side prediction
- Database schema, buff/debuff system
- Server message string format (backward-compatible)
- Combat text client formatting (`combat-text.ts`)

