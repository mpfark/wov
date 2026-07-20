## Root cause (confirmed in edge logs)

The recent `combat-tick` logs show the exact symptom:
```
elapsed_ms: 1,311,283  ticks_processed: 3  ticks_capped: true  session_just_created: false
elapsed_ms: 1,315,851  ticks_processed: 3  ticks_capped: true  session_just_created: false
```

Two ticks in a row came back reporting ~22 minutes of elapsed time and hit the `TICK_CAP = 3` clamp. That's the "stall + 3-tick burst" the user feels: the very first request on entering a fight runs three simulated combat rounds server-side before returning any events, so the client sits waiting ~1s while three swings pile up in one payload.

Why the session was stale even though `combat-tick` deletes the session when combat ends (line 2487):

- Session is only deleted through the normal end-of-combat return path or on a node-change / auth / death cleanup.
- If the player closes the tab, loses connection, or is killed mid-fight before the "no engaged creatures" return runs, the row survives with an old `last_tick_at`.
- Next visit to the same node re-uses that row (line 356: `session = existingSession`) because `session.node_id === node_id`, so `elapsedMs = now - session.last_tick_at` is huge and the loop compresses `TICK_CAP` ticks into the first response.

`session_just_created: false` in the logs confirms this reuse.

## Fix

Small, surgical changes in `supabase/functions/combat-tick/index.ts`. No client changes needed.

1. **Stale-session reset on reuse.** After we load `existingSession` but before computing `elapsedMs`, if the session's `last_tick_at` is older than a stale threshold (e.g. `4 * TICK_RATE = 8s`, more than any legitimate network gap or backgrounded-tab catchup we want to honor), rewrite `session.last_tick_at = now - TICK_RATE` in memory. That guarantees the first tick of a re-entered fight processes exactly one round, not three.
   - Do NOT do this on the normal in-combat path — background-tab catchups within a live fight should still process multiple ticks so DoTs and creature swings stay correct while the tab was throttled. The stale-threshold check gates this to only sessions that were clearly abandoned (no client heartbeat for ≥8s while `session.engaged_creature_ids` is present or empty).

2. **Delete-and-recreate when the stale session has no engaged creatures.** If `existingSession.engaged_creature_ids` is empty AND `elapsedMs > stale threshold`, delete the row and fall into the `!session` branch so a fresh session is created with `last_tick_at: now - TICK_RATE` and `sessionJustCreated: true`. Cleaner than mutating in place, and matches the intent that this is a brand-new fight.

3. **Log the reset** — add a `session_reset_reason: 'stale_reuse'` field in the console.log next to the existing tick log so we can see in edge logs whether the fix is triggering.

## What stays unchanged

- Legitimate in-combat catchup (backgrounded tab during a real fight) still processes up to `TICK_CAP` ticks — the reset only fires when the session has been silent past the threshold, which only happens when combat wasn't cleanly ended.
- `TICK_RATE`, `TICK_CAP`, client heartbeat interval, and `useCombatDriver` are untouched.
- Party path uses the same session logic, so the fix applies there too automatically.

## Verification

1. Simulate the bug: pick a fight, kill the tab mid-combat, reopen after 1+ minute, engage another creature on the same node.
   - Before: first tick returns after ~1s with 3 batched swings.
   - After: first tick returns quickly with a single swing; subsequent ticks stream at 2s cadence.
2. Check `combat-tick` edge logs for `ticks_processed: 3, ticks_capped: true, session_just_created: false` — should be gone in normal play.
3. Backgrounded-tab test: start a real fight, switch tabs for 10s, return — should still catch up multiple ticks (regression guard).

## Technical section

- File: `supabase/functions/combat-tick/index.ts`, around lines 355–395 (session load → elapsedMs calc).
- Threshold constant `STALE_SESSION_MS = 4 * TICK_RATE` (8s). Small enough that any real "player rejoining after abandoning combat" resets, large enough to allow normal mobile backgrounding within a live fight.
- Preferred implementation: if `session && (now - session.last_tick_at) > STALE_SESSION_MS && (!session.engaged_creature_ids || session.engaged_creature_ids.length === 0 || engagedIds.length > 0)`, delete + null out `session`, then let the existing `!session && (action === 'start' || engagedIds.length > 0 …)` branch recreate it. The extra `engagedIds.length > 0` clause covers the specific "player re-engages after abandoning" case even if the abandoned session still held stale engaged ids.
