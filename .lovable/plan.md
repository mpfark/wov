

## Technical Refactors Inspired by LPMud Architecture

After reviewing the codebase, three architectural pain points stand out that map directly to patterns LPMuds solved decades ago.

### Problem 1: The God Component (GamePage = 2046 lines)

LPMuds split logic into layers: the "mudlib" (shared engine), "room" objects, and "player" objects. GamePage currently owns combat, movement, regen, loot, abilities, chat, buffs, death, and UI rendering all in one file.

**Refactor**: Extract game logic into a `useGameLoop` hook that consolidates the scattered `useEffect` intervals (regen, combat, buff expiry) into a single tick-based loop — mirroring LPMud's `heart_beat()`. This hook would own all buff/debuff state, regen timers, and action handlers, returning only the data and callbacks the UI needs.

Additionally, extract the action handlers (`handleMove`, `handleSearch`, `handleUseAbility`, `handleUseConsumable`, `rollLoot`, `awardKillRewards`) into a `useActions` hook.

### Problem 2: The Ref Mirror Anti-Pattern (useCombat = 30+ refs)

`useCombat` takes 30+ parameters and mirrors every single one into a `useRef` + `useEffect` pair to avoid stale closures in the combat interval. This is fragile and verbose.

**Refactor**: Replace with a `useReducer` pattern. All combat-relevant state lives in a single reducer. The combat tick reads from `stateRef.current` (one ref) instead of 30 individual refs. Buff/debuff state moves into the reducer as well, eliminating the prop-drilling of `poisonBuff`, `igniteBuff`, `absorbBuff`, `sunderDebuff`, etc. from GamePage → useCombat.

### Problem 3: No Central Event Bus

LPMuds route events (damage, death, loot, chat) through a central dispatcher. Currently, combat results are threaded through callbacks (`addLog`, `broadcastDamage`, `broadcastHp`, `broadcastReward`) passed as props through multiple layers.

**Refactor**: Introduce a lightweight pub/sub event emitter (a React context + `useRef` holding subscribers). Components subscribe to events like `'combat:hit'`, `'combat:kill'`, `'player:levelup'`, `'loot:drop'`. The combat hook emits events; the log, broadcast, and UI hooks subscribe independently. This decouples producers from consumers.

### Implementation Order

1. **Event bus** first (small, foundational, unblocks the others)
2. **Combat reducer** (consolidates the 30-ref problem)  
3. **useGameLoop + useActions extraction** (breaks up GamePage)

### Estimated scope per step

| Step | Files touched | Risk |
|------|--------------|------|
| Event bus | 1 new hook + 3-4 consumers | Low |
| Combat reducer | `useCombat.ts` + `GamePage.tsx` | Medium |
| GameLoop extraction | `GamePage.tsx` → 2 new hooks | Medium |

### What stays the same

All database queries, Supabase realtime subscriptions, RLS policies, and UI components remain unchanged. This is purely a code organization refactor with no backend changes.

