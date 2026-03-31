

# Phase 1: Hybrid Combat Model — Refined Behavior Plan

## Goal

Deliver Phase 1 of the MUD-inspired combat model:
- Active same-node combat stays smooth and immediate (protected)
- No full offscreen combat rounds
- Persistent effects survive independently as creature-owned world state
- Clients can selectively trigger server-side reconciliation for relevant nodes
- Creatures can be found already wounded or dead from offscreen DoTs
- Server persists all final world state

---

## Change 1: Selective Adjacent-Node Wake-Up

**Problem**: Blindly reconciling all adjacent nodes wastes resources and creates unnecessary traffic. Most adjacent nodes have no active effects.

**Solution**: Only reconcile adjacent nodes that are likely to have active effects.

**`src/features/creatures/hooks/useCreatures.ts`**:
- Modify the existing adjacent-node prefetch effect to be selective
- Instead of querying all adjacent nodes for creatures, first check which adjacent nodes have active effects via a lightweight query: `select node_id from active_effects where node_id in (...adjacentIds) limit 1` (grouped by node_id)
- Only call `reconcileNode` for nodes that actually have active effects
- Nodes with no effects continue using the existing direct creature prefetch (cheap DB read)

**Wake-up eligibility rules**:
- Current node: always reconcile on entry (already implemented)
- Adjacent nodes: only if they have active effects in the database
- Party leader's node: only if different from current and has active effects
- Recently visited: not tracked in Phase 1 (future enhancement)

**`reconcileNode` function** (new export):
- Client-side throttle map: 10s minimum between calls per node
- Sends only `{ node_id }` — no damage, timing, or tick data
- Returns reconciled creatures

---

## Change 2: Server-Side Throttle as Best-Effort Only

**`supabase/functions/combat-catchup/index.ts`**:
- The module-level `Map<string, number>` throttle is explicitly **best-effort, per-isolate optimization only**
- It may be evicted, reset, or absent on cold starts — correctness must not depend on it
- When the throttle fires, return a fresh DB read of creatures (not stale cached data) — just skip effect reprocessing
- **Real safety layers**: client-side 10s throttle + idempotent server reconciliation (reprocessing the same effects twice produces the same result)
- Log `throttled: true` when skipping, but never skip on a request that includes a flag like `force: true` (reserved for node-entry)

---

## Change 3: Full Reconciliation on Node Entry, Partial as Emergency Only

**`supabase/functions/combat-catchup/index.ts`**:
- Remove hard `TICK_CAP = 30` — replace with a high defensive cap (1000)
- Add a wall-clock safety limit (3 seconds) as an **emergency fallback only**
- If the wall-clock limit triggers:
  - Write partial results immediately (creature HP updates so far)
  - Log aggressively: `partial_resolution: true, ticks_completed, ticks_remaining, elapsed_ms`
  - Return `partial: true` in the response
- **Client behavior on `partial: true`**: immediately re-call `reconcileNode` (bypassing throttle) to continue resolution. Loop until `partial: false` or max 3 retries
- This ensures node-entry state converges to fully reconciled, even in pathological cases
- Under normal gameplay conditions (effects with 2s tick rate, minutes of absence), partial resolution should never trigger — log it as a warning if it does

---

## Change 4: Effects as Creature-Owned World State (cleanup)

**`supabase/functions/combat-tick/index.ts`**:
- Set `session_id: null` on new effect creation (poison, ignite)
- Effects are world state; session linkage is conceptual clutter
- No behavioral change — effects already survive session deletion

---

## Change 5: Stale Comment Cleanup

Remove references to `isDotOnly` and old session-continuation logic in:
- `supabase/functions/combat-tick/index.ts`
- `src/features/combat/hooks/usePartyCombat.ts`

---

## Change 6: Update `.lovable/plan.md`

Rewrite to document Phase 1 behavior model, wake-up policy, and reconciliation guarantees.

---

## What Does NOT Change

- Combat formulas, class balance, abilities, tick rate (2s)
- Active same-node combat feel (immediate first round, responsive party combat)
- Session lifecycle rules (end on node change / no members / no creatures)
- `_shared/combat-resolver.ts`, `useBuffState`, `NodeView`, `GamePage`
- Loot, XP, gold, salvage, equipment degradation
- Skeleton loading on node entry
- `useCreatures` authoritative-first reconciliation flow

## Files Changed

| File | Change |
|------|--------|
| `supabase/functions/combat-catchup/index.ts` | Best-effort throttle; remove hard TICK_CAP; wall-clock emergency fallback with `partial` flag; diagnostics |
| `src/features/creatures/hooks/useCreatures.ts` | Export `reconcileNode`; selective adjacent-node reconciliation (only nodes with active effects); client throttle; partial-resolution retry loop |
| `supabase/functions/combat-tick/index.ts` | Set `session_id: null` on new effects; stale comment cleanup |
| `src/features/combat/hooks/usePartyCombat.ts` | Stale comment cleanup |
| `.lovable/plan.md` | Phase 1 behavior documentation |

## Success Criteria

1. Same-node combat remains smooth and immediate
2. No full offscreen combat rounds processed
3. Persistent effects survive independently of sessions
4. Adjacent-node reconciliation only fires for nodes with active effects
5. Creatures can be found already wounded or dead from offscreen DoTs
6. Node-entry always shows fully reconciled state (partial resolution auto-retries to completion)
7. Server remains final persistence authority
8. Server-side throttle failure does not break correctness

