
# Add Barrage and Nature's Snare Abilities for Ranger

## Overview
Add two new abilities to the Ranger class:
- **Barrage** (Tier 2, Level 10): Fire 2-3 arrows at 70% damage each, scaling with DEX. A burst damage ability.
- **Nature's Snare** (Tier 3, Level 15): Entangle the current combat target, reducing its damage by ~30% for 15 seconds. A defensive/utility ability.

## Changes

### 1. Data (`src/lib/class-abilities.ts`)
- Add `'multi_attack'` and `'root_debuff'` to the `ClassAbility.type` union.
- Add two new entries to the ranger's ability array:
  - **Barrage**: emoji `🏹🏹`, tier 2, level 10, 45s cooldown, type `'multi_attack'`
  - **Nature's Snare**: emoji `🌿`, tier 3, level 15, 90s cooldown, type `'root_debuff'`

### 2. Ability Logic (`src/pages/GamePage.tsx`)
- Add a new state: `rootDebuff` with `{ damageReduction: number, expiresAt: number }` (similar pattern to existing buffs).
- Pass `rootDebuff` to `useCombat` so creature damage can be reduced.
- **`multi_attack` handler**: Must be in combat. Roll 2-3 attacks (2 base, 3 if DEX modifier >= 3). Each hit deals 70% of normal Shoot damage (using the ranger's combat stats). Each arrow rolls independently to hit. Requires an active combat target.
- **`root_debuff` handler**: Must be in combat. Applies a 30% damage reduction debuff on the current creature for 15 seconds (scales slightly with WIS: duration = 10 + min(wisMod, 5) seconds).

### 3. Combat Integration (`src/hooks/useCombat.ts`)
- Accept a new `rootDebuff` prop (same pattern as `critBuff`, `stealthBuff`, `damageBuff`).
- In the creature counterattack section, if `rootDebuff` is active, reduce creature damage by 30% (multiply by 0.7, floor).

### 4. No UI changes needed
The existing multi-ability rendering in `NodeView.tsx` already handles arrays of abilities with independent cooldowns. Barrage and Nature's Snare are self/combat-targeted (no ally picker needed), so they work with the existing button system. The admin panel (`RaceClassManager.tsx`) also already loops through ability arrays.

## Technical Details

### Barrage Formula
- Arrow count: DEX modifier >= 3 ? 3 : 2
- Per-arrow damage: `floor(rollDamage(1, 8) + dexMod) * 0.7`, minimum 1
- Each arrow rolls to hit independently against creature AC
- Can only be used while in combat

### Nature's Snare Formula
- Damage reduction: 30% (creature deals 70% damage)
- Duration: `(10 + min(wisMod, 5))` seconds, where wisMod is based on WIS
- Can only be used while in combat
- Applies to the currently targeted creature (affects all its attacks)
