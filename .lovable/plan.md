

# Fix Combat Log Message Breakdowns

## Problem

Two event log messages show incomplete math breakdowns while the actual combat resolution is correct:

1. **Offhand attacks**: Show `Rolled {roll}+{statMod}={total}` but total includes INT hit bonus not shown in breakdown
2. **Creature attacks**: Show `Rolled {d20} + {cStr} STR = {roll}` but roll includes `creatureAtkBonus(level)` not shown

## Changes

### 1. Fix offhand hit/miss messages

**`supabase/functions/combat-tick/index.ts`** — lines 792 and 810

Add INT hit bonus to the displayed breakdown:
- Hit: `Rolled ${roll2}+${sMod2}+${ihb2} INT=${total2} vs AC ...`
- Miss: `Rolled ${roll2}+${sMod2}+${ihb2} INT=${total2} vs AC ...`

### 2. Fix creature hit/miss messages

**`supabase/functions/combat-tick/index.ts`** — lines 575 and 580

Add creature attack bonus to the displayed breakdown:
```
const cab = creatureAtkBonus(creature.level);
// Message: Rolled {d20} + {cStr} STR + {cab} Lvl = {roll} vs AC {tAC}
```

The `cab` variable should be computed once at the start of `applyCreatureHit` (it's already used in the roll calculation).

### 3. Redeploy edge function

Deploy updated `combat-tick`.

## Files Modified

| File | Change |
|------|--------|
| `supabase/functions/combat-tick/index.ts` | Fix 4 message templates to show full breakdown |

