

# Extend Envenom & Ignite to 5-Minute Commitment Buffs

## Summary

Transform Envenom (rogue T2) and Ignite (wizard T3) from short stat-scaling buffs into 5-minute commitment buffs that drain all current CP, with a minimum of 50 CP required. Add clear player feedback and clear these buffs on death.

## Changes

### 1. Update ability definitions — `class-abilities.ts`

- Set `cpCost: 50` for both Envenom and Ignite (represents minimum required)
- Update descriptions:
  - Envenom: "Coat your blade in poison for 5 minutes — each hit has a 40% chance to apply a stackable poison DoT (max 5). Costs all your CP (minimum 50)."
  - Ignite: "Imbue your spells with fire for 5 minutes — each hit has a 40% chance to apply a stackable burn DoT (max 5). Costs all your CP (minimum 50)."

### 2. Update action handler — `useCombatActions.ts`

**Poison buff block (line ~651):**
- Add "already active" check → log "Envenom is already active." and return
- Set flat `300_000`ms (5 min) duration instead of stat-scaling
- Log success: "Envenom! Your weapons drip with poison for 5 minutes. (X CP consumed)"

**Ignite buff block (line ~670):**
- Add "already active" check → log "Ignite is already active." and return
- Set flat `300_000`ms duration
- Log success: "Ignite! Your spells burn with fire for 5 minutes. (X CP consumed)"

**CP deduction block (line ~725):**
- For `poison_buff` and `ignite_buff` types, override cost to drain all current CP instead of flat `ability.cpCost`
- The minimum check at line 524 already handles the 50 CP gate since `cpCost` will be 50

### 3. Clear buffs on death — `useCombatLifecycle.ts`

- In the existing death effect (line 64-67), alongside `stopCombat()`, also call `setPoisonBuff(null)` and `setIgniteBuff(null)` via buffSetters
- This fits naturally — just two additional setter calls in the existing death cleanup block
- Requires passing `buffSetters` (or just the two setters) into `useCombatLifecycle` params

### 4. Update Rulebook — `WorldBuilderRulebook.tsx`

- Update any Envenom/Ignite references to reflect the 5-minute duration and all-CP cost

## Files Modified

| File | Change |
|------|--------|
| `src/features/combat/utils/class-abilities.ts` | Update cpCost to 50, update descriptions for Envenom & Ignite |
| `src/features/combat/hooks/useCombatActions.ts` | Flat 5min duration, drain-all-CP override, prevent recast, clear feedback |
| `src/features/combat/hooks/useCombatLifecycle.ts` | Clear poison/ignite buffs on death |
| `src/components/admin/WorldBuilderRulebook.tsx` | Update ability documentation |

