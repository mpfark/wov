
## Problem
Two symptoms reported on Warrior character Cithrawiel:
1. Respawn countdown gets stuck (does not resolve to hp=1 / return to starting node).
2. Combat log appears to show ~2× the expected number of attack lines per tick.

Both are unconfirmed root-causes — the plan is scoped as **investigate → fix**, not "apply this fix." I will only patch what the reads confirm.

## Investigation steps

### A. Respawn stuck
1. Pull recent `combat_audit_log` and `combat-tick` edge logs for Cithrawiel around the death event.
2. Check whether `combat-tick` continues to write `hp = 0` after the client’s respawn `updateCharacter({ hp: 1, current_node_id: … })` runs. HP-authority memory says combat-tick is sole HP writer during combat, so if the session is still open when the client tries to respawn, the server will clobber `hp=1` back to `0` and the countdown effect will re-fire (or never clear `isDead`).
3. Verify `useGameLoop`'s death effect (`src/features/combat/hooks/useGameLoop.ts` ~L303–327):
   - Does `stopCombat` actually run before `updateCharacter({ hp: 1 })`? (`useCombatDriver` L780 stops combat when `character.hp <= 0`, but only if `inCombatRef.current` — need to confirm death path always ends the session server-side.)
   - Confirm no other code path is holding `isDead` true.
4. Check whether `combat-tick` clears the encounter/session when the last player dies, and whether creatures continue attacking a `hp=0` character (turning the respawn into an immediate re-death loop).

### B. Doubled attack log lines
1. Read `useCombatDriver` broadcast subscription (already confirmed: followers-only, leader skips). Confirm solo path never subscribes to its own broadcast.
2. Check `processTickResult` / `interpretCombatTickResult` for whether the same events list can be walked twice (e.g. duplicate `formattedLogMessages` push, or event-log echo via `useEventLogDisplay`).
3. Inspect `combat-tick` per-tick attack emission for warriors: recent changes may emit both an auto-attack event and a stance/ability event that reads as a second swing.
4. Check `useEventLogDisplay` / `EventLogPanel` for duplicate keying that visually stacks the same line twice.
5. Also confirm the Cithrawiel character isn't in a party with an active broadcast leader loopback (would produce exact duplicates).

## Likely fixes (apply only what investigation confirms)

- **Respawn**: on death, force `session_ended = true` in `combat-tick` when the last living player at the node hits `hp <= 0`, and/or make the client respawn write happen only after `stopCombat` resolves; guard `useGameLoop` death effect so the respawn `updateCharacter` retries if the server re-writes `hp=0` within the 3s window.
- **Doubled log**: dedupe the offending event type in `interpretCombatTickResult` (mirroring the existing `ignite_proc` skip), or fix the double-emit at the `combat-tick` source.

## Out of scope
- No combat balance changes.
- No changes to kill-resolution, loot, or rewards.
- No schema changes unless the investigation surfaces a missing column.

## Technical notes
- Files likely touched: `src/features/combat/hooks/useGameLoop.ts`, `src/features/combat/hooks/useCombatDriver.ts`, `src/features/combat/utils/interpretCombatTickResult.ts`, `supabase/functions/combat-tick/index.ts`.
- Reference memories: `mem://tech/combat-architecture/hp-authority`, `mem://tech/combat-architecture/kill-resolution`.

## Clarifying question (optional — I can start without an answer)
- Is Cithrawiel currently in a party when this happens, or soloing? (Party leader loopback vs. solo double-emit have different fixes.)
