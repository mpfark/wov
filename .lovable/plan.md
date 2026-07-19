# Fix: phantom "joins the fight!" on a lone creature

## Root cause

`combat-tick` was recently optimized to return only creatures whose HP changed this tick in `creature_states`. `interpretCombatTickResult` still computes `aliveEngagedIds` purely from `data.creature_states`:

```ts
aliveEngagedIds = data.creature_states
  .filter(cs => cs.alive && currentEngagedIds.includes(cs.id))
  .map(cs => cs.id);
```

On a tick with no HP changes (both sides miss, cooldown-only tick, etc.), `creature_states` is empty → `aliveEngagedIds` is empty → in `useCombatDriver` the "still alive" branch (lines 490–502) filters `engagedCreatureIds` down to `[]`, dropping the live target from the engaged list for a frame.

Next render, `useCombatAggroEffects`'s mid-fight-join effect sees an aggressive/alive creature that is no longer in `engagedCreatureIdsRef` and re-adds it, logging `⚠️ <name> joins the fight!`. The 250 ms cleanup path in `useCombatDriver` (kill-rollover branch) also gets tripped on some no-op ticks, which is the "lost attack tick" the user feels.

Confirms the user's report: one creature on the node, still alive, message fires mid-fight.

## Fix

Treat "missing from `creature_states`" as "unchanged", not "gone". The only authoritative "creature is no longer engaged" signal is `killedCreatureIds` (and the server's `session_ended` when nothing is left).

### `src/features/combat/hooks/useCombatDriver.ts` — around lines 464–502

Replace the "aliveEngagedIds.length === 0" branch logic with:

1. Compute `remainingEngaged = engagedCreatureIdsRef.current.filter(id => !result.killedCreatureIds.includes(id))`.
2. If `remainingEngaged.length === 0` **and** `result.killedCreatureIds.length > 0` → existing kill-rollover path (look for next aggressive creature, else `stopCombat`).
3. If `remainingEngaged.length === 0` **and** no kills → this was a no-op tick before the engaged list was ever populated; just return without touching state.
4. Otherwise → keep `inCombat = true`, set `engagedCreatureIds = remainingEngaged`, and only change `activeCombatCreatureId` when the current active id was killed this tick.

This preserves the live target across no-op ticks and prevents the false "joins the fight!" re-add.

### No other files need to change

`interpretCombatTickResult` can stay as-is — the driver, not the interpreter, is where engagement state is owned. Aggro effects continue to work correctly because `engagedCreatureIdsRef` will no longer be transiently cleared.

## Verification

- Enter a node with one aggressive creature. Watch a fight through several ticks — no "joins the fight!" line should appear, and there should be no ~250 ms pause between ticks.
- Kill the creature on a node with a second aggressive creature present → "joins the fight!" still fires for the actual second creature (kill-rollover path unchanged).
- Party leader/client tick handling is shared, so both solo and party combat get the fix.
