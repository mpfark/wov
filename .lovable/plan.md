

# Two-Handed Weapon +25% Damage Multiplier

## Summary

Add a flat 1.25× damage multiplier to main-hand auto-attacks when the character is wielding a two-handed weapon (`items.hands = 2`). Server-only change — no client modifications needed.

## Detection

The `items` table already has a `hands` column (1, 2, or null). The equipment query in `combat-tick/index.ts` (line 204) currently selects only `stats, weapon_tag` from items. We need to also fetch `hands` to detect two-handed weapons server-side.

## Changes

### `supabase/functions/combat-tick/index.ts`

**1. Expand equipment query** (line 204)

Add `hands` to the item select:
```
.select('character_id, equipped_slot, item:items(stats, weapon_tag, hands)')
```

**2. Track two-handed status per character** (lines 208-229)

Add a `isTwoHanded` record alongside `mainHandTag` and `offHandTag`:
```typescript
const isTwoHanded: Record<string, boolean> = {};
```
Set it during the equipment loop:
```typescript
if (e.equipped_slot === 'main_hand' && (e.item as any)?.hands === 2) {
  isTwoHanded[cid] = true;
}
```

**3. Apply multiplier to main-hand auto-attack damage** (around line 605, after affinity mult, before stealth/buff multipliers)

```typescript
if (isTwoHanded[m.id]) dmg = Math.floor(dmg * 1.25);
```

This ensures the 1.25× applies to the base+crit+affinity damage, and then stealth (2×), damage buff (1.5×), focus strike, and disengage all stack on top of it correctly. The resulting `dmg` value is the same one used for HP subtraction (line 625) and the event's `damage` field (line 633).

**4. No change to off-hand section** (line 697+)

The off-hand attack block already gates on `isOffhandWeapon(offHandTag[m.id])` — a two-handed weapon user will have no off-hand weapon, so this section is naturally skipped. No guard needed.

### `supabase/functions/_shared/combat-math.ts`

Add a constant for the multiplier so it's centrally defined:
```typescript
export const TWO_HANDED_DAMAGE_MULT = 1.25;
```

Import and use this constant in `combat-tick` instead of a magic number.

Mirror the constant to `src/features/combat/utils/combat-math.ts` for the client copy (used by prediction/tooltips if needed later).

## Files Modified

| File | Change |
|------|------|
| `supabase/functions/_shared/combat-math.ts` | Add `TWO_HANDED_DAMAGE_MULT = 1.25` constant |
| `src/features/combat/utils/combat-math.ts` | Mirror the constant |
| `supabase/functions/combat-tick/index.ts` | Fetch `hands`, track `isTwoHanded`, apply 1.25× to main-hand auto-attacks |

## What Does NOT Change

- Off-hand attack logic, dual-wield behavior
- Shield setups
- Ability damage (barrage, execute, ignite consume, burst, rend)
- Combat architecture, tick rate, server authority
- Stat formulas, equipment stat budgets
- Client-side code (no UI changes needed)
- Database schema (the `hands` column already exists)

