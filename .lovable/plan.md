

# Creature XP Rewards, Rarity Multipliers & XP Curve Adjustment

## Overview
Three changes: (1) add rarity-based XP multipliers to creature kills, (2) adjust the XP curve so higher levels require progressively more effort, and (3) document all of this in the Game Manual.

## 1. XP Curve Change

**Current:** XP to next level = `level * 100` (linear -- always 10 same-level kills)

**New:** XP to next level = `floor(level^1.5 * 50)` (progressive -- early levels stay fast, late levels require more grinding)

| Level | Old XP Req | New XP Req | Same-Level Regular Kills (old) | Same-Level Regular Kills (new) |
|-------|-----------|-----------|-------------------------------|-------------------------------|
| 1     | 100       | 50        | 10                            | 5                             |
| 5     | 500       | 559       | 10                            | 11                            |
| 10    | 1,000     | 1,581     | 10                            | 16                            |
| 20    | 2,000     | 4,472     | 10                            | 22                            |
| 30    | 3,000     | 8,216     | 10                            | 27                            |
| 40    | 4,000     | 12,649    | 10                            | 32                            |

This makes early levels feel snappy while late-game progression requires real commitment.

## 2. Rarity XP Multipliers

Add multipliers to creature XP rewards based on rarity:

| Rarity  | Multiplier | Level 10 Regular Kills Equivalent |
|---------|-----------|----------------------------------|
| Regular | 1.0x      | baseline                         |
| Rare    | 1.5x      | worth 1.5 regulars               |
| Boss    | 2.5x      | worth 2.5 regulars               |

Formula becomes: `baseXp = creature.level * 10 * rarityMult`

## 3. Game Manual Updates

Add a new "XP & Rewards" section (or expand Combat) showing:
- The XP curve formula
- Creature XP by rarity with example table
- Kills-to-level reference at key milestones
- Level penalty reminder

---

## Technical Details

### File: `src/lib/game-data.ts`
- Add `XP_RARITY_MULTIPLIER` constant: `{ regular: 1, rare: 1.5, boss: 2.5 }`
- Add `getXpForLevel(level)` function: `Math.floor(Math.pow(level, 1.5) * 50)`
- Add `getCreatureXp(level, rarity)` function: `Math.floor(level * 10 * (XP_RARITY_MULTIPLIER[rarity] || 1))`

### File: `src/hooks/useCombat.ts`
- Import `XP_RARITY_MULTIPLIER` from game-data
- Change line 337 from `const baseXp = creature.level * 10` to use the rarity multiplier: `const baseXp = Math.floor(creature.level * 10 * (XP_RARITY_MULTIPLIER[creature.rarity] || 1))`

### File: `src/hooks/useCharacter.ts` (or wherever level-up XP threshold is checked)
- Replace `level * 100` with the new `getXpForLevel(level)` function

### File: `src/components/admin/GameManual.tsx`
- Update the level progression table to use the new `getXpForLevel` function for XP Required and Total XP columns
- Add a new accordion section "XP & Creature Rewards" between Combat and Class Abilities, containing:
  - XP curve formula
  - Rarity XP multiplier table
  - Kills-to-level examples at levels 1, 5, 10, 20, 30, 40
  - Level penalty formula reminder

### File: `src/components/admin/CreatureManager.tsx`
- Optionally show the XP reward value in the creature properties panel for reference

