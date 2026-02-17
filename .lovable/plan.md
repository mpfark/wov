

# Wizard Ability: Arcane Surge

## Overview

Add a Tier 1 ability for the Wizard class called **Arcane Surge** -- a self-buff aura that temporarily increases spell damage output. This follows the same pattern as existing abilities (Rogue's Shadowstep, Ranger's Eagle Eye, Bard's Inspire).

## Ability Details

- **Name**: Arcane Surge
- **Emoji**: `✨`
- **Type**: `damage_buff` (new type)
- **Effect**: For a duration, the Wizard's attacks deal 1.5x damage
- **Duration**: Base 15 seconds + INT modifier (capped at 25s)
- **Cooldown**: 60 seconds
- **Tier**: 1 (unlocks at Level 5)

## Changes

### 1. Update ability data (`src/lib/class-abilities.ts`)

- Add `damage_buff` to the type union in `ClassAbility`
- Add Wizard entry to `CLASS_ABILITIES`:
  ```
  wizard: {
    label: 'Arcane Surge',
    emoji: '✨',
    description: 'Channel raw arcane energy to amplify your spell damage',
    cooldownMs: 60000,
    type: 'damage_buff',
    tier: 1,
    levelRequired: 5,
  }
  ```

### 2. Add damage buff state (`src/pages/GamePage.tsx`)

- Add `damageBuff` state: `{ expiresAt: number } | null` (same pattern as `critBuff`, `stealthBuff`, `regenBuff`)
- In `handleUseAbility`, add the `damage_buff` branch:
  - Calculate duration: base 15s + INT modifier, capped at 25s
  - Set `damageBuff` state with expiry timestamp
  - Log an activation message
- Pass `damageBuff` into the combat hook

### 3. Apply damage multiplier in combat (`src/hooks/useCombat.ts`)

- Accept a `damageBuff` parameter (same pattern as `stealthBuff` and `critBuff`)
- During the player attack step, if `damageBuff` is active (not expired), multiply final damage by 1.5x
- Unlike stealth, the buff does NOT clear on first hit -- it persists until the timer expires
- Log a special message when the buff is active (e.g., "Arcane energy surges through your attack!")

### 4. Show buff indicator in UI (`src/components/game/NodeView.tsx`)

- The ability button and level-gating already work generically for all classes, so the Wizard's ability will appear automatically
- The buff expiry visual (if one exists for other buffs) will apply here too

### 5. Admin display (`src/components/admin/RaceClassManager.tsx`)

- No changes needed -- the component already reads from `CLASS_ABILITIES` dynamically, so the Wizard entry will appear automatically

## Technical Details

```text
New type added to union:
  type: 'heal' | 'regen_buff' | 'self_heal' | 'crit_buff' | 'stealth_buff' | 'damage_buff'

State shape:
  damageBuff: { expiresAt: number } | null

Combat logic (pseudocode):
  if damageBuff active (Date.now() < expiresAt):
    finalDmg = Math.floor(finalDmg * 1.5)
    log "Arcane energy amplifies your attack!"
  // buff persists until timer expires (no clear on hit)

Activation logic:
  const intMod = getStatModifier(stats.int)
  const duration = Math.min(25, 15 + intMod) * 1000
  setDamageBuff({ expiresAt: Date.now() + duration })
```

