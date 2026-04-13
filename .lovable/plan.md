

# Refine Combat Initiation Log Messages

## Changes

### 1. Remove "⚔️ Combat begins!" from aggro effects
**File: `src/features/combat/hooks/useCombatAggroEffects.ts`**

Remove the two `addLocalLog('⚔️ Combat begins!')` lines:
- Line 81 (re-engage after combat stops)
- Line 125 (initial aggro on node entry)

The creature aggro phrase (e.g. "⚠️ Crystal-Back Weaver lunges at you!") is sufficient and more immersive on its own.

### 2. Add "You start attacking..." for player-initiated combat
**File: `src/pages/GamePage.tsx`**

In `handleAttackFirst` (~line 629), after finding the creature to attack but before calling `startCombat`, add a log message. Only emit this when the creature is **not aggressive** (passive creature = player-initiated):

```typescript
const target = ...;
if (!target.is_aggressive) {
  addLog(`⚔️ You start attacking ${target.name}.`);
}
startCombat(target.id);
```

Apply this to both the selected-target path and the first-creature fallback path.

### 3. Handle cycle-target attack
**File: `src/pages/GamePage.tsx`**

In `handleCycleTarget` (~line 650), when `startCombat` is called for a non-aggressive creature via target cycling, also add the log:

```typescript
if (!next.is_aggressive) {
  addLog(`⚔️ You start attacking ${next.name}.`);
}
```

## Files

| File | Change |
|------|--------|
| `src/features/combat/hooks/useCombatAggroEffects.ts` | Remove 2× "Combat begins!" log lines |
| `src/pages/GamePage.tsx` | Add "You start attacking..." log for passive creature engagements |

## Not changed
- Combat mechanics, tick logic, server authority
- Party broadcast — the log is local-only via `addLog`
- Mid-fight join messages ("joins the fight!") stay as-is

