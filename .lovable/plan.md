# Phase 2 report: the Ignite stack stall

## 1. Expected transition (per configured Orbs of Fire / Ignite)

Deployed config (`abilities` row `ignite`): `activation_mode = stance`, `cp_reserve_pct = 0.2`, `duration_calc = null`, `effect_config.max_stacks` resolved to 5, `trigger = pulse`, `dot_duration_ms = 30000` (+WIS, cap 45000).

Per committed tick, one orb pulse on an engaged live target:

| Tick | active_effects.stacks before | proposal stacks | after commit | log |
| --- | --- | --- | --- | --- |
| 1 | no row | 1 | 1 | `[1/5]` |
| 2 | 1 | 2 | 2 | `[2/5]` |
| 3 | 2 | 3 | 3 | `[3/5]` |
| … | 5 | 5 (capped) | 5 | `[5/5]` |

Duration is refreshed to full on every application; cadence (`next_tick_at`) advances by `interval_ms`.

## 2. Actual transition, layer by layer

Measured by driving the real resolver over consecutive ticks, feeding each tick's `effectUpserts` back exactly as the deployed committer persists them.

| Tick | resolver snapshot input | `stacksOf()` | applier proposal pushed | merged `effectUpserts` (what commits) | emitted event | `active_effects.stacks` after | next snapshot |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 0 | (no ignite row) | 0 | 1 | **1** | `[1/5]` | 1 | 1 |
| 1 | stacks=1 | 1 | 2 | **1** | `[2/5]` | 1 | 1 |
| 2 | stacks=1 | 1 | 2 | **1** | `[2/5]` | 1 | 1 |
| 3 | stacks=1 | 1 | 2 | **1** | `[2/5]` | 1 | 1 |
| 4 | stacks=1 | 1 | 2 | **1** | `[2/5]` | 1 | 1 |

The proposal that actually reaches the committer carries `stacks = 1` forever, while the event line reads `[2/5]` forever. Both symptoms have one cause.

### Root cause

`src/shared/combat/pure/resolver.ts`, periodic-schedule writeback, lines 2210-2235:

```ts
for (const e of effects) {
  const advanced = effectNextDue.get(e.id);
  if (advanced === undefined || effectDeleteIds.has(e.id)) continue;
  effectUpserts.push({
    …
    stacks: e.stacks,          // ← stale snapshot value
    expiresAtMs: e.expiresAtMs, // ← stale snapshot value
    nextTickAtMs: advanced,
    …
  });
}
```

This stage runs **after** `runStackAppliers` (line 790-816) and re-sends the same `(sourceCharacterId, targetId, effectType)` identity with the pre-tick `stacks`/`expiresAtMs`. The identity merge at lines 2397-2415 then resolves the duplicate by "later proposal wins for every defined field":

```ts
mergedEffectUpserts[at] = { ...prev, ...definedFieldsOf(up) };
```

So the cadence writeback overwrites the applier's `stacks: 2` with `stacks: 1` (and the refreshed expiry with the old expiry). Only tick 0 escapes, because a brand-new row has no `effectNextDue` entry yet.

### Explicit answers

- Does the resolver calculate the correct next stack? **Yes.** `stacksOf(...) + 1` capped by `maxStacks` is correct (line 790); the `[2/5]` text proves the applier computed 2.
- Does `effectUpserts` contain the correct stack? **No.** The applier's row is correct when pushed, but the merged array that ships to the committer carries `stacks = 1`.
- Does the SQL conflict branch fail to update `stacks`? **No.** Deployed `commit_encounter_tick_v2` runs `ON CONFLICT (source_id, target_id, effect_type) DO UPDATE SET stacks = EXCLUDED.stacks, … expires_at = EXCLUDED.expires_at, next_tick_at = EXCLUDED.next_tick_at, …`. It faithfully persists whatever it is given — which is 1.
- Does the next snapshot receive a stale value? **Only as a consequence.** `encounter_snapshot_v2` correctly returns the committed row; the committed row is itself wrong.
- Is expiry refresh committed correctly? **No.** The same writeback regresses `expires_at` to the pre-tick value, so the burn expires on its original schedule instead of being refreshed by each pulse.
- Identity / scope mismatch creating or reading the wrong row? **No.** The `(source, target, effect_type)` triple matches on all three layers (resolver lookup, proposal identity, SQL conflict target). Live `active_effects` shows one `ignite` row per identity, `stacks = 1`, `params.maxStacks = 5`.

No client prose was used as evidence; the `[2/5]` line is quoted only as a witness that the applier's arithmetic is right.

## 3. Proposed minimal correction (not applied)

**The defect is in the resolver, not in SQL.** No change to `commit_encounter_tick_v2`, `commit_encounter_tick_v3`, fencing, advisory locking, schedule behavior or grants is required or proposed.

Smallest coherent fix — restrict the periodic-schedule writeback to cadence only, so it can never regress a semantic field another stage advanced in the same tick:

```ts
// current: re-sends the whole snapshot row
stacks: e.stacks, expiresAtMs: e.expiresAtMs, …
// proposed: cadence writeback leaves semantic fields undefined, so the
// identity merge keeps whatever the authoritative stage set this tick
stacks: undefined, expiresAtMs: undefined,
```

Equivalent alternative if leaving them unset is awkward for the upsert type: make the merge prefer, per field, the value from the applier stage over the cadence stage (`stacks`/`expiresAtMs` are applier-owned; `nextTickAtMs` is cadence-owned).

Confirmations for the proposed change:

- Conflict identity unchanged: `(source_id, target_id, effect_type)`.
- Stacks are written only from the authoritative committed proposal (the applier stage), never rebuilt from the snapshot.
- Cap stays resolver-owned (`Math.min(cap, …)` at line 790); SQL never clamps.
- Expiry/refresh behavior preserved and, for the first time, actually delivered: full refresh per application.
- Separate creatures, characters, sources and encounters cannot overwrite one another — the merge key already includes source and target, and the committer scopes rows to `v_enc.node_id`.
- Replay stays idempotent: the upsert is value-absolute, and tick-level fencing (`already_committed`, `duplicate_batch`) is untouched.
- A refused or rolled-back commit persists nothing: all refusals return before the first mutation, and mutations share one transaction.
- No SQL, no deploy, no grant change; execution grants remain service-role only.

This is a small prerequisite mechanics correction, kept out of the Phase 3 flavor work.

## 4. Regression test (failing now)

`src/test/combat/pure/ignite-stack-progression.test.ts` is un-skipped and expanded to 8 deterministic cases: first application = 1, next = 2, next = 3, cap at 5, duration refresh per the current rule, next resolver snapshot sees the committed stack, two targets independent, replayed commit does not double-increment.

Current result: **6 failed, 2 passed** — fails exactly where the writeback regresses `stacks`/`expiresAtMs`.

Evidence classes are kept distinct:

- **Executable resolver/reference test** — the above; its `commit` helper mirrors the deployed conflict identity and update list.
- **SQL text-contract assertion** — the quoted deployed `ON CONFLICT` body, which proves intent, not execution.
- **Live database evidence** — deployed `active_effects` inspection (single ignite identity, `stacks = 1`, `max_stacks = 5`).

No SQL text assertion is offered as proof that database execution works.

## 5. Phase 3 clarifications recorded

- **`block`**: emitted by the resolver (`resolver.ts:2154`) but absent from `SERVER_EVENT_TYPES` / `SERVER_EVENT_TYPE_MAP` in `src/features/combat/events/log-event.ts` (the union has `'block'` as a `LogEventType`, with no server mapping). Its decode/presentation registration is added in Phase 3.
- **`absorb`, `shield_block`, `evasion_dodge`, DR events**: types exist in `log-event.ts` with no authoritative emitter. Not activated, not claimed as supported; recorded for the later full ability/mechanics audit.
- **Stance duration wording**: verified against deployed config — `ignite` and `envenom` are `activation_mode = stance` with `cp_reserve_pct = 0.2` and `duration_calc = null`; they persist on CP reservation until dropped or logout. The "5 minutes" wording is therefore false and will be **removed**, not replaced with `{seconds}s`. (The 25-30s values in `effect_config` are the applied burn/poison DoT duration, not the stance.)

## Stop condition

Awaiting explicit approval before applying the resolver writeback correction, deploying anything, or starting Phase 3.
