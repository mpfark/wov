

# Rebalance AC & Creature Attack Scaling

## Summary

Lower all player base AC by 2, add a level-based creature attack bonus (`+floor(level * 0.4)`), and narrow the miss threshold from `margin < -8` to `margin < -5` (widening glancing band). Update CharacterPanel's defense stats to reflect the new creature attack formula. Target: 45–55% creature hit rate.

## Changes

### 1. Lower Base AC — Three Mirrors

**`src/features/combat/utils/combat-math.ts`**, **`supabase/functions/_shared/combat-math.ts`**, **`src/lib/game-data.ts`**

All three files store `CLASS_BASE_AC`. Update identically:
- warrior: 14 → 12
- ranger: 12 → 10
- rogue: 12 → 10
- wizard: 11 → 9
- healer: 11 → 9
- bard: 11 → 9

### 2. Add Creature Attack Bonus

New function in both combat-math mirrors (`src/features/combat/utils/combat-math.ts` and `supabase/functions/_shared/combat-math.ts`):
```ts
export function getCreatureAttackBonus(level: number): number {
  return Math.floor(level * 0.4);
}
```

**`supabase/functions/combat-tick/index.ts`** — apply bonus in creature attack roll:
```ts
const roll = d20 + cStr + getCreatureAttackBonus(creature.level);
```

### 3. Widen Glancing Band (Narrow Miss Threshold)

In `getHitQuality` (both combat-math mirrors), change:
```ts
// Before: if (margin < -8) return 'miss';
if (margin < -5) return 'miss';
```

Rolls between margin -8 and -5 become glancing hits (0.25x, capped at 3) instead of total misses.

### 4. Update CharacterPanel Defense Stats

**`src/features/character/components/CharacterPanel.tsx`** (~lines 973-981)

The panel currently calculates creature attack mod manually. Update to include the new level-based bonus:
```ts
const creatureAtkMod = Math.floor((creatureBaseStat - 10) / 2) + getCreatureAttackBonus(character.level);
```
Import `getCreatureAttackBonus` from combat-math. This ensures the Dodge %, AC Overflow, and AC tooltip all reflect the actual server-side hit rates.

Also update the AC tooltip to show the new base values and creature attack bonus breakdown.

### 5. Update Game Manual

**`src/components/admin/GameManual.tsx`**
- Update base AC table with new values
- Document miss threshold change (< -5)
- Document creature attack bonus formula

### 6. Deploy Edge Function

Deploy `combat-tick` after updating server-side combat-math and the tick function.

## Files Modified

| File | Change |
|------|--------|
| `src/features/combat/utils/combat-math.ts` | Lower AC, add `getCreatureAttackBonus`, narrow miss to < -5 |
| `supabase/functions/_shared/combat-math.ts` | Same (server mirror) |
| `src/lib/game-data.ts` | Lower `CLASS_BASE_AC` |
| `supabase/functions/combat-tick/index.ts` | Use creature attack bonus in roll |
| `src/features/character/components/CharacterPanel.tsx` | Import and use `getCreatureAttackBonus` in defense stat calculations |
| `src/components/admin/GameManual.tsx` | Document new values and formulas |

## What Does NOT Change

- Player attack formulas (player → creature)
- Crit system, DEX crit bonuses
- Hit quality multipliers (glancing 0.25x, weak 0.60x, normal 1.0x, strong 1.25x)
- Battle Cry DR, abilities, CP system
- Tick rate, server authority

