

# Auto-Combat System: Continuous Combat Loop

## Overview

Replace the current single-click-per-exchange combat with a persistent auto-combat loop. When combat starts (via Attack button or aggressive creature), the player and creature exchange blows automatically at intervals until one dies. Combat resumes when re-entering a node with living creatures you've previously engaged (or aggressive ones).

## How It Works

1. **Starting combat**: Click "Attack" on a creature, or enter a node with aggressive creatures
2. **Combat loop**: Player and creature take turns attacking automatically on a timer
3. **Attack speed**: Interval between player attacks is based on DEX -- higher DEX = faster attacks (e.g., base 3s, reduced by DEX modifier, minimum 1s). Creature attack speed is fixed (e.g., 2.5s)
4. **Ending combat**: Combat ends when the creature dies (rewards granted) or the player dies (death/respawn flow)
5. **Resuming**: If a player leaves and returns to a node with a creature they were fighting (or an aggressive creature), combat auto-resumes
6. **UI**: The Attack button changes to show combat is active (e.g., "In Combat..." with a pulsing indicator). Player cannot manually click attack while auto-combat is running. Moving away triggers attack of opportunity as before.

## Technical Plan

### 1. New Hook: `useCombat.ts`

Create a dedicated hook to manage the combat loop state:

- **State**: `activeCombatCreatureId` (the creature currently being fought), `inCombat` boolean
- **Core loop**: Uses `setInterval` with the DEX-based attack speed
- Each tick:
  - Player attacks creature (same roll logic as current `handleAttack`)
  - If creature survives, creature counterattacks (same logic)
  - If creature dies, award XP/gold/loot, clear combat, auto-target next aggressive creature if any
  - If player dies, clear combat, trigger death flow
- **Start combat**: Called from Attack button click or aggressive creature detection
- **Stop combat**: Called on creature death, player death, or node change
- **Attack speed calculation**: `Math.max(3000 - (dexMod * 250), 1000)` ms -- so DEX 10 (mod 0) = 3s, DEX 18 (mod +4) = 2s, DEX 22 (mod +6) = 1.5s, capped at 1s minimum

### 2. Refactor `GamePage.tsx`

- Extract all combat logic (the current `handleAttack` body) into the `useCombat` hook
- Remove the manual `handleAttack` callback; replace with `startCombat(creatureId)` from the hook
- Update aggressive creature auto-attack effect to call `startCombat` instead of doing a one-off exchange
- Keep attack of opportunity on movement (one-time strikes when fleeing, not a loop)
- Pass `inCombat` and `activeCombatCreatureId` to NodeView for UI updates

### 3. Update `NodeView.tsx`

- When `inCombat` is true and the creature matches `activeCombatCreatureId`, show "In Combat..." instead of the Attack button (with a pulsing/animated indicator)
- Other creatures still show the Attack button (clicking switches target)
- Add a "Flee" button during combat that triggers movement (with attack of opportunity)

### 4. Combat Resume on Node Re-entry

- When creatures load for a node, check if any are aggressive and alive -- if so, auto-start combat after a short delay (500ms)
- This reuses the existing aggressive creature detection but now calls `startCombat` instead of doing a single exchange

### 5. Attack Speed Formula

```
Base interval: 3000ms
DEX modifier: Math.floor((dex - 10) / 2)
Interval: Math.max(3000 - (dexMod * 250), 1000)

Examples:
  DEX 8  (mod -1) -> 3250ms (capped display, actual 3250)
  DEX 10 (mod  0) -> 3000ms
  DEX 14 (mod +2) -> 2500ms
  DEX 18 (mod +4) -> 2000ms
  DEX 22 (mod +6) -> 1500ms
  DEX 30 (mod +10) -> 1000ms (minimum)
```

### Files Changed

| File | Change |
|---|---|
| `src/hooks/useCombat.ts` | **New** -- combat loop hook with start/stop, auto-attack interval, all hit/damage/kill/loot logic |
| `src/pages/GamePage.tsx` | Refactor to use `useCombat` hook; remove inline `handleAttack`; update aggro effect to call `startCombat` |
| `src/components/game/NodeView.tsx` | Add `inCombat`/`activeCombatCreatureId` props; show combat status indicator; add Flee button |

