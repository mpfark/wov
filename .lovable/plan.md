## What I confirmed

Pulled Cithrawiel's audit log. Two real things are happening:

**1. "Double attacks per tick" is a display artifact, not doubled combat.**
When `combat-tick` catches up more than one heartbeat in a single request (`ticks_processed: 2` or `3`), every event in that request is batch-inserted into `combat_audit_log` with the SAME `created_at`. So 2 separate ticks look like 2 hits at the exact same second. In the audit log I see clusters of attack lines all sharing `08:27:50.599369+00`, `08:23:01.790933+00`, etc. The server does not actually swing twice per tick — it's simulating 2+ ticks and stamping them all with the insert time.

The in-game combat log already gets `---tick---` separator events between sub-ticks; the audit panel drops them because `tick_separator` has no `character_id`.

**2. Respawn countdown can stall on solo death.**
When the player hits 0 HP mid-fight, `combat-tick` returns `session_ended: false` (creatures are still alive) and does NOT delete the `combat_sessions` row. The client stops polling via the `character.hp <= 0` guard, but the server-side session lingers. When `useGameLoop` writes the respawn `{ hp: 1, current_node_id: startingNode }` 3 seconds later, any tick response that was in-flight during death still carries `member_states.hp = 0` and the client re-applies it — that clobbers the respawn write and re-fires the death effect. Additionally, at the very next tick call `combat-tick` line 327 returns `ticks_processed: 0` (no `session_ended`) when the char is still dead, so nothing tells the driver combat is truly over.

## Changes

### Backend — `supabase/functions/combat-tick/index.ts`
1. **Solo death early-return** (line 327): also delete the stale `combat_sessions` row for that character and return `session_ended: true` so the client stops polling.
2. **Audit log tick markers**: when a traced character is in the tick, emit `tick_separator` rows into `combat_audit_log` as well (with the traced character's id) so the Overlord audit panel visually breaks each simulated sub-tick apart.

### Client — `src/features/combat/utils/interpretCombatTickResult.ts`
3. **Don't accept stale HP=0 for a respawned character**: expose a small guard so `characterUpdates.hp` from a tick is dropped when the local character is currently in the death/respawn window. Simplest: interpret returns `hp: 0` as normal, but `useCombatDriver.processTickResult` skips the character update when `p.isDead` is already true AND the incoming hp equals 0 (nothing new to learn — we already know we're dead).

### Client — `src/features/combat/hooks/useGameLoop.ts`
4. **Make the respawn effect resilient**: drop the `[character.hp]` dependency retrigger by using an `isDeadRef` gate that only re-arms on a *rising* edge (hp goes from >0 to 0). Keep the countdown interval alive until the respawn write resolves; then clear it. Also ensure the setInterval stops at 0 explicitly.

### Admin — `src/components/admin/CombatAuditPanel.tsx` (small)
5. Render `tick_separator` rows as a thin divider between groups so overlords can see each simulated sub-tick as its own block. No behavior change to combat.

## Not changed

- No formula/damage changes — the "doubled" attacks are real ticks, just batched.
- No changes to party combat driver — the same session-cleanup + stale-HP guard fixes cover it.

## Verification

- Read `combat_audit_log` after a solo death: confirm session is gone (`select * from combat_sessions where character_id=…`) and only one death event per fight.
- Kill Cithrawiel in test, watch respawn: countdown should tick 3→2→1→0 without stalling, then hp jumps to 1 at the starting node.
- Trigger a multi-tick catch-up (backgrounded tab); audit panel should show `---tick---` dividers between the batch's sub-ticks.
