

# Tiered Abilities + Rogue "Sneak" Ability

## Overview

All current class abilities (Warrior's Second Wind, Healer's Heal, Ranger's Eagle Eye, Bard's Inspire) plus a new Rogue ability will be converted into a **tiered system**. Existing abilities become **Tier 1** and unlock at **level 5**. The Rogue gets a brand new ability: **Shadowstep** -- entering stealth to avoid attacks of opportunity when traveling and dealing bonus damage on the first combat strike.

## Rogue Ability: Shadowstep

- **Name**: Shadowstep
- **Emoji**: `🌑`
- **Type**: `stealth_buff`
- **Effect**: For 15 seconds, the Rogue is cloaked in shadow:
  - **No attacks of opportunity** when moving between nodes
  - **First attack deals 2x damage** (like an ambush strike)
- **Cooldown**: 60 seconds
- **Scaling**: Duration increases slightly with DEX modifier (base 15s + dexMod seconds, capped at 25s)

## Changes

### 1. Update ability data model (`src/lib/class-abilities.ts`)

- Add `tier` and `levelRequired` fields to the `ClassAbility` interface
- Add `stealth_buff` to the ability type union
- Set all existing abilities to `tier: 1, levelRequired: 5`
- Add the Rogue's Shadowstep ability with the same tier/level requirement

### 2. Add stealth buff state (`src/pages/GamePage.tsx`)

- Add a `stealthBuff` state: `{ expiresAt: number }` (similar pattern to `critBuff`, `regenBuff`, `foodBuff`)
- In `handleUseAbility`, add the `stealth_buff` branch that activates the buff with a DEX-scaled duration
- Gate ability usage behind the level requirement check -- if `character.level < ability.levelRequired`, show a log message instead

### 3. Apply stealth to movement (`src/pages/GamePage.tsx` -- `handleMove`)

- Before the "Attack of Opportunity" loop, check if `stealthBuff` is active (`Date.now() < stealthBuff.expiresAt`)
- If active, skip attacks of opportunity and log: "You slip through the shadows unnoticed..."
- Clear the stealth buff after moving (one use per activation for travel benefit)

### 4. Apply stealth bonus damage to combat (`src/hooks/useCombat.ts`)

- Accept a new `stealthBuff` parameter (same pattern as `critBuff`)
- On the **first attack only** while stealth is active, double the damage and log an ambush message
- Clear the stealth buff after the first strike (passed via a callback or ref)

### 5. Update ability button in UI (`src/components/game/NodeView.tsx`)

- Check `character.level >= ability.levelRequired` to show/disable the ability button
- If below required level, show a tooltip like "Unlocks at level 5"

### 6. Update admin display (`src/components/admin/RaceClassManager.tsx`)

- Show the tier and level requirement alongside each class ability card
- Display the Rogue's new Shadowstep ability in the class overview

---

## Technical Details

```text
ClassAbility interface changes:
+  tier: number;
+  levelRequired: number;
   type: 'heal' | 'regen_buff' | 'self_heal' | 'crit_buff' | 'stealth_buff';

New ability entry:
  rogue: {
    label: 'Shadowstep',
    emoji: '🌑',
    description: 'Vanish into shadow -- avoid attacks when fleeing and deal bonus damage on your next strike',
    cooldownMs: 60000,
    type: 'stealth_buff',
    tier: 1,
    levelRequired: 5,
  }

State shape:
  stealthBuff: { expiresAt: number } | null

Movement logic (pseudocode):
  if stealthBuff active:
    skip attacks of opportunity
    log shadow travel message
    clear stealthBuff

Combat logic (pseudocode):
  if stealthBuff active on first hit:
    finalDmg *= 2
    log ambush message
    clear stealthBuff
```

