
# Add "Transfer Health" Ability for Healer

## Overview
Add a new tier 1 healer ability called **Transfer Health** that lets the healer sacrifice their own HP to heal a targeted party member. The existing **Heal** ability moves to tier 2 (unlocking at a higher level). This requires restructuring the ability system to support multiple abilities per class.

## What It Does
- **Transfer Health**: The healer gives a portion of their own HP to a targeted ally. Short cooldown (15s). Unlocks at level 5.
- **Heal** (existing): Moves to tier 2, unlocking at level 10 instead of 5.

## Technical Details

### 1. Restructure ability data (`src/lib/class-abilities.ts`)
- Add a new ability type `'hp_transfer'` to the `ClassAbility` type union.
- Change `CLASS_ABILITIES` from `Record<string, ClassAbility>` (one per class) to `Record<string, ClassAbility[]>` (array per class).
- Add the healer's Transfer Health entry as tier 1 (level 5, ~15s cooldown).
- Move Heal to tier 2 (level 10).
- All other classes get their existing ability wrapped in an array.

### 2. Update `handleUseAbility` logic (`src/pages/GamePage.tsx`)
- Accept an ability index or identifier so the player can choose which ability to use.
- Add the `'hp_transfer'` handler: deduct HP from the healer, then heal the target using the existing `heal_party_member` RPC (or direct update for self-targeting -- though self-targeting would be pointless here). The transfer amount will scale with WIS and level.
- Prevent the healer from killing themselves (enforce a minimum HP floor of 1).
- Track separate cooldowns per ability.

### 3. Update ability UI (`src/components/game/NodeView.tsx`)
- Render multiple ability buttons when a class has more than one ability.
- Each button has its own cooldown timer and level-lock check.
- The target selector (party member dropdown) appears when either Transfer Health or Heal is selected, since both are targeted abilities.

### 4. Update props and references
- Update `GamePage.tsx` to pass the abilities array instead of a single ability.
- Update `NodeView.tsx` props to accept `ClassAbility[]`.
- Update `CharacterPanel.tsx` if it references ability data for buff display.
- Update `RaceClassManager.tsx` admin panel to display the new multi-ability structure.

### Transfer Health Formula
- Transfer amount: `max(3, wisMod * 2 + floor(level / 2))`
- The healer loses that exact amount of HP (capped so HP cannot go below 1).
- The target gains that amount (capped at their max HP).
- Cooldown: 15 seconds.

### Cooldown Tracking
- Change `abilityCooldownEnd` from a single number to a `Record<number, number>` (keyed by ability index) so each ability tracks its own cooldown independently.
