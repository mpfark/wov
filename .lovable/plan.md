

# Multi-Creature Combat Fix

## Problem
The combat system only tracks a single active creature (`activeCombatCreatureId`). When a player switches targets (e.g., clicking Attack on a passive creature), the previous aggressive creature stops counterattacking entirely. Both creatures should hit the player if the player has engaged both.

## Solution
Track a **set of engaged creature IDs** alongside the single active (player-targeted) creature. Each combat tick, the player attacks the active target, but **all engaged creatures** counterattack.

## Changes

### `src/hooks/useCombat.ts`

1. **Add `engagedCreatureIds` state** (a `Set<string>` via ref + state) to track all creatures currently in combat with the player.

2. **Update `startCombat`**: Add the new creature to `engagedCreatureIds` without removing existing entries. Set `activeCombatCreatureId` to the newly clicked creature (player's attack target).

3. **Update `doCombatTick`**:
   - Player attack phase: attacks only `activeCombatCreatureId` (unchanged).
   - Creature counterattack phase: loop over ALL `engagedCreatureIds` and run the counterattack logic for each living creature, not just the active target.

4. **Update creature death handling**: Remove dead creatures from `engagedCreatureIds`. If the active target dies, pick the next engaged creature as the new active target. If no engaged creatures remain, stop combat.

5. **Update `stopCombat`**: Clear `engagedCreatureIds`.

6. **Update the auto-aggro effect** (lines 211-224, 238-249): When an aggressive creature auto-engages, add it to the engaged set.

### `src/components/game/NodeView.tsx`

7. **Update UI indicator**: Accept `engagedCreatureIds` as a prop. Show the crossed-swords icon on ALL engaged creatures (not just the single active one). Highlight the primary target differently (e.g., destructive border for active, subtler indicator for other engaged creatures).

### `src/pages/GamePage.tsx`

8. **Pass `engagedCreatureIds`** from `useCombat` return value down to `NodeView`.

## Technical Details

```text
Before:
  Player clicks Creature A (aggressive) -> attacks A, A counterattacks
  Player clicks Creature B (passive)    -> attacks B, A stops counterattacking

After:
  Player clicks Creature A (aggressive) -> attacks A, A counterattacks
  Player clicks Creature B (passive)    -> attacks B, BOTH A and B counterattack
  Creature A dies                       -> attacks B, only B counterattacks
```

The engaged set is managed via a `useRef<Set<string>>` (for access inside the interval) mirrored to a state array for rendering. Each counterattack in the loop is independent -- each creature rolls its own attack against the player's AC.

