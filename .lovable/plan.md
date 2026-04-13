

# Gameplay Validation & Polish Pass

## Audit Findings

### Bug 1: Re-engagement after combat never triggers (CONFIRMED BUG)

In `useCombatAggroEffects.ts`, `justStoppedRef` is **never set to `true`**. The re-engage effect (line 66) guards on `!justStoppedRef.current`, so it never fires. The tracking effect (lines 58-62) only sets it to `false` when `inCombat` is true — when `inCombat` goes false, nothing sets it to `true`.

**Impact**: If aggressive creatures spawn/respawn while the player is between fights at the same node, re-engagement won't trigger. Mid-fight joining (lines 83-98) partially masks this because it adds aggressives during combat, but the gap exists for post-combat scenarios.

**Fix**: Add a `wasInCombatRef` to detect the `true→false` transition and set `justStoppedRef.current = true`.

### Bug 2: Sunder debuff only shows on one creature at a time (CONFIRMED BUG)

`sunderDebuff` is a single `{ creatureId, acReduction, expiresAt }` object. In party play where multiple creatures are sundered (by different warriors or from `syncCreatureDebuffs`), the loop in `syncCreatureDebuffs` calls `setSunderDebuff` for each creature — React batches these, so only the last one survives.

Poison, ignite, and bleed are all `Record<string, ...>` (keyed by creature ID) and display correctly. Sunder is the odd one out.

**Fix**: Convert sunder from single-object to `Record<string, SunderDebuff>` matching the pattern used by other debuffs. Touch points:
- `useGameLoop.ts` (type)
- `useBuffState.ts` (state, gatherBuffs, syncCreatureDebuffs)
- `useCombatActions.ts` (setSunderDebuff call)
- `NodeView.tsx` (prop type + lookup)
- `GamePage.tsx` (passing prop, status bar indicator)

### Validated as Working Correctly

| System | Status |
|--------|--------|
| Party combat tick pipeline | Non-leaders enter combat state on broadcast ✅ |
| Creature HP sync | mergedCreatureHpOverrides priority chain correct ✅ |
| Poison/ignite/bleed display (party) | Per-creature records, shared via creatureDebuffs ✅ |
| Follow grace window | 1000ms window, 2-miss tolerance, origin check ✅ |
| Follow breaking | Only after 2 consecutive misses ✅ |
| Server moveFollowers | Parallel DB writes, leader-authoritative ✅ |
| Boss defense pipeline | block → absorb → battle cry DR, correct order ✅ |
| Shield block frequency | DEX-based chance via `getShieldBlockChance` ✅ |
| Anti-crit (Awareness) | WIS + shield bonus, checked before crit resolution ✅ |
| Battle Cry DR | Percentage reduction with crit bonus ✅ |
| Hit quality grading | AC determines tier, no overflow damage reduction ✅ |
| Creature counterattack | Level-gap multiplier, STR modifier, correct ✅ |
| Party reward broadcasts | Server-originated, client refetches on event ✅ |
| Combat log dedup | ownLogIdsRef + seenIdsRef dual-gate ✅ |

## Changes

### File: `src/features/combat/hooks/useCombatAggroEffects.ts`
Add `wasInCombatRef` to detect the `inCombat` true→false transition and set `justStoppedRef.current = true`, enabling re-engagement with remaining aggressives after combat ends.

### File: `src/features/combat/hooks/useGameLoop.ts`
No change to `SunderDebuff` type — instead introduce `SunderStacks = Record<string, SunderDebuff>` as a new type export.

### File: `src/features/combat/hooks/useBuffState.ts`
- Change `sunderDebuff` state from `SunderDebuff | null` to `Record<string, SunderDebuff>`
- Update `gatherBuffs` to pick the first active sunder entry (server only needs the target)
- Update `syncCreatureDebuffs` to build the record correctly instead of overwriting a single value
- Update `BuffState` and `BuffSetters` interfaces

### File: `src/features/combat/hooks/useCombatActions.ts`
- Update `setSunderDebuff` call to use record-based setter: `prev => ({ ...prev, [creatureId]: entry })`

### File: `src/features/world/components/NodeView.tsx`
- Change `sunderDebuff` prop from single object to `Record<string, SunderDebuff>`
- Change creature sunder check from `sunderDebuff?.creatureId === c.id` to `sunderStacks[c.id]`

### File: `src/pages/GamePage.tsx`
- Update `sunderDebuff` destructuring usage: status bar indicator checks any active entry
- Pass the record to NodeView

### File: `src/features/combat/index.ts`
- No change needed (SunderDebuff type still valid)

## Not Changed
- Combat formulas, tick rates, server authority
- Movement rules, follow mechanics
- Loot, progression, class balance
- Boss damage numbers (validated as reasonable)
- No new systems introduced

## Summary for Next Pass
- `GamePage.tsx` follower-sync effect (lines 210-253) remains a candidate for extraction into a dedicated hook
- `usePartyCombat.processTickResult` still a future extraction target
- No other half-wired paths found beyond bugs 1 and 2

