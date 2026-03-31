
# Phase 1: Hybrid Combat Model — Behavior Plan

## Goal

Deliver the first phase of the MUD-inspired combat model:
- Active same-node combat stays smooth and immediate (protected)
- No full offscreen combat rounds
- Persistent effects survive independently as creature-owned world state
- Clients can selectively trigger server-side effect reconciliation for relevant nodes
- Creatures can be found already wounded or dead from offscreen DoTs
- Server persists all final world state

## Architecture Summary

### Active Same-Node Combat
- Combat starts immediately: session initialized one tick in the past (`now - TICK_RATE`)
- Client polls every 2s; server processes only active same-node combat
- Party combat synchronized via broadcast channel
- No dead ticks or delayed first rounds

### Session Lifecycle
A combat session is deleted when ANY of these is true:
1. `session.node_id !== node_id` — player left the node
2. `members.length === 0` — no alive members at the combat node
3. No alive engaged creatures remain after tick processing

### Offscreen Behavior
- Full combat rounds DO NOT continue offscreen
- Persistent effects (DoTs) survive independently in `active_effects`
- Effects are creature-owned world state (session_id set to null)
- Effects are reconciled on demand via `combat-catchup`

### Client-Assisted Wake-Up Policy

**Eligible nodes** — a client may request reconciliation for:
- Current node (always, with `force: true` on entry)
- Adjacent nodes (only if they have active effects in the database)
- Party leader's node (future enhancement)

**Restrictions**:
- Client sends only `{ node_id }` — no damage, timing, or tick data
- Server recalculates everything from stored `active_effects` data
- Server remains sole authority for HP, death, and loot

**Throttling**:
- Client-side: 10s minimum between `reconcileNode` calls per node (via `lastReconcileMap`)
- Server-side: best-effort per-isolate 10s cooldown (optimization only, not correctness guarantee)
- Throttle bypassed for `force: true` (node-entry) and partial-resolution retries

### Effect Reconciliation Guarantees
- All elapsed effect time is resolved (up to 1000-tick defensive cap)
- 3s wall-clock safety limit as emergency fallback only
- If partial resolution occurs: returns `partial: true`, client retries up to 3 times
- Node-entry always converges to fully reconciled state
- Creatures can be found already dead if DoT damage was lethal

## Key Files

| File | Responsibility |
|------|---------------|
| `supabase/functions/combat-tick/index.ts` | Live combat processing, session management, effect creation |
| `supabase/functions/combat-catchup/index.ts` | Offscreen effect reconciliation, creature HP persistence |
| `supabase/functions/_shared/combat-resolver.ts` | Shared DoT resolution, loot, creature state writes |
| `src/features/creatures/hooks/useCreatures.ts` | Client creature state, `reconcileNode` export, selective wake-up |
| `src/features/combat/hooks/usePartyCombat.ts` | Client combat driver, tick polling, party sync |

## What Does NOT Change
- Combat formulas, class balance, abilities, tick rate (2s)
- Loot, XP, gold, salvage, equipment degradation
- Party mechanics, node-based system
- `_shared/combat-resolver.ts` logic
- `useBuffState`, `NodeView`, `GamePage`
- Skeleton loading on node entry

## Success Criteria
1. Same-node combat remains smooth and immediate
2. No full offscreen combat rounds processed
3. Persistent effects survive independently of sessions
4. Adjacent-node reconciliation only fires for nodes with active effects
5. Creatures can be found already wounded or dead from offscreen DoTs
6. Node-entry always shows fully reconciled state
7. Server remains final persistence authority
8. Server-side throttle failure does not break correctness
