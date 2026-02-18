

## Warrior Tier 2 & Tier 3 Abilities

### New Abilities

**Battle Cry (Tier 2, Level 10)** -- `battle_cry` type
- Lets out a war cry that temporarily boosts the warrior's AC based on STR modifier
- AC bonus: max(2, strMod) for a duration of 20-30 seconds (scaling with CON)
- Cooldown: 60 seconds
- Also requires being in combat

**Rend (Tier 3, Level 15)** -- `dot_debuff` type
- Slices the current target, applying a damage-over-time bleed effect
- Deals STR-based damage every 3 seconds for 12-18 seconds (scaling with STR)
- Damage per tick: max(2, floor(strMod * 1.5))
- Cooldown: 90 seconds
- Requires being in combat with a valid target

---

### Files to Change

**1. `src/lib/class-abilities.ts`**
- Add `'battle_cry' | 'dot_debuff'` to the `ClassAbility.type` union
- Add Battle Cry and Rend entries to the warrior ability array

**2. `src/pages/GamePage.tsx`**
- Add `acBuff` state: `{ bonus: number; expiresAt: number } | null`
- Add `dotDebuff` state: `{ damagePerTick: number; intervalMs: number; expiresAt: number; creatureId: string } | null`
- Modify `effectiveAC` calculation to include `acBuff` bonus when active
- Add `battle_cry` handler in `handleUseAbility`: sets `acBuff` state, logs the AC boost
- Add `dot_debuff` handler in `handleUseAbility`: sets `dotDebuff` state, logs the bleed application
- Add a `useEffect` for the DoT tick interval: every 3 seconds while `dotDebuff` is active, deal damage to the target creature via `supabase.rpc('damage_creature')` and log each tick
- Pass `acBuff` to `CharacterPanel` for buff display
- Pass `acBuff` to `useCombat` so the effective AC used in combat counterattack calculations includes the buff

**3. `src/hooks/useCombat.ts`**
- Add `acBuff` to `UseCombatParams` interface
- Add a ref for `acBuff` and sync it like other buff refs
- In the counterattack section, add the AC buff bonus to `_effectiveAC` when calculating if the creature hits

**4. `src/components/game/CharacterPanel.tsx`**
- Add `acBuff` to `Props` and `ActiveBuffs` component
- Display a shield icon buff indicator showing remaining duration and AC bonus

