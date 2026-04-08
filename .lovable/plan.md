

# Change Envenom Icon to Avoid Duplicate with Potion

## Problem
Both Potion (regen consumable) and Envenom (rogue ability) use the 🧪 emoji. No other duplicate icons exist that don't make sense.

## Solution
Change Envenom's emoji from 🧪 to 🐍 (snake — fits the poison/venom theme). Update all references.

## Files to Change

### 1. `src/features/combat/utils/class-abilities.ts`
- Change Envenom emoji from `'🧪'` to `'🐍'`

### 2. `src/features/character/components/CharacterPanel.tsx`
- Change the Envenom buff icon from `'🧪'` to `'🐍'` (line ~221)

### 3. `src/features/party/components/PartyPanel.tsx`
- Change the poison BUFF_ICONS entry from `'🧪'` to `'🐍'` (line ~49)

### 4. `src/components/admin/GameManual.tsx`
- Update the Envenom entry emoji from `🧪` to `🐍`

**Note**: The 🧪 emoji used in combat log messages for poison DoT procs (combat-resolver, combat-tick) stays — those represent the poison effect itself and don't conflict with the Potion buff icon contextually. But if preferred, those can also change to 🐍 for consistency with the ability.

