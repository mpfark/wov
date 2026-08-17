# Internal Effects-Only / Offscreen Catch-up Owner

Gate 3 is accepted. The delayed-delivery / two-tab case stays recorded as remaining C5 coverage (not claimed as passed). Combat stays in maintenance; nothing here is implemented, no soak access is enabled, C5 is not restarted.

The single blocking gap: `combat-catchup` exists, is correct, and is service-role-only — but **no deployed internal caller invokes it**, so a finite effect committed by a player who then leaves the node never advances.

## 1. Current ownership map (verified)

Live path (working):
- `src/features/combat/hooks/useCombatDriver.ts` → `combat-tick` → `supabase/functions/combat-tick/index.ts`
- shared pipeline `supabase/functions/_shared/combat/c3/orchestration.ts` (mirror `src/shared/combat/c3/orchestration.ts`)
- `encounter_intake` → `claim_encounter_tick` (`_supported_modes = ['live']`) → `encounter_snapshot_v2` → `loadSnapshotAux` + `decodeEncounterSnapshot` → `resolveTickPure` → `commit_encounter_tick_v2` → `release_encounter_tick` on failure
- roster read: `node_creature_roster` RPC (`src/features/creatures/hooks/useCreatures.ts`), server-resolved node, no player catch-up

Effects-only path (built, unowned):
- `supabase/functions/combat-catchup/index.ts`: requires `Authorization` that is either the service-role key or a JWT with `role = service_role` (`internalCaller`); otherwise 401/403. Body requires `character_id` (uuid), optional `node_id`. Owner is read from `characters.user_id`, then `public.catchup_scope_check(_user_id, _character_id, _node_id)` returns `ok:<node>` / `not_owned` / `no_node` / `out_of_scope`. It then calls `orchestrateCombatResolution({ role: 'catchup', nodeId, characterId })`, which uses `encounter_for_node` (never intake) and claims with `_supported_modes = ['effects_only']`.
- What it expects from its caller: a service-role credential **plus a character id whose scope resolves**. That is the mismatch with an internal scheduler, which naturally knows *encounters/nodes with due effects*, not characters. `catchup_scope_check` clause 3 (character still sources an unexpired effect at that node) is exactly the intended offscreen case, so a scheduler can satisfy the contract by passing a **source character derived from the due effect row**, not from a client.

World cadence (verified in DB):
- cron jobs today: `world-watchdog` (*/5), `expire-timed-state` (*/15), `prune-logs`, `return-unique-items`, `idle-shutdown-check` (*/30), `prune-encounter-tick-batches` (* * * * *), `prune-encounter-access-grants` (*/5), `purge-ground-loot` (*/5), plus `tick-creatures` (*/2) armed by `schedule_tick_creatures()`.
- `wake_world()` re-arms watchdog + `schedule_tick_creatures()`; `world_watchdog()` arms/disarms `tick-creatures` from `world_is_awake()` (any character `last_online` within 5 min); `shutdown_world()` unschedules the owned job list; `idle_shutdown_check()` sleeps the world after 30 min idle.
- Existing secure internal HTTP-call pattern already deployed: `email_queue_dispatch()` uses `net.http_post` with `Authorization: Bearer <vault.decrypted_secrets 'email_queue_service_role_key'>` and self-disarms its cron job when the queue drains (advisory-lock guarded).

Removed player-side callers (all previously in/around `useOffscreenDotWakeup`, deleted in the roster-authority correction) and what each was attempting:
1. departure wake-up timer — predicted a DoT-lethal timestamp at node exit and called catch-up then, to make offscreen DoT kills land.
2. reschedule loop (max 3) — retried when the creature survived the prediction.
3. reconcile-on-arrival — called catch-up when re-entering a node to flush pending effects before rendering the roster.
4. periodic safety sweep during live combat — nudged effects when live ticks stalled.
5. session-end flush — one final catch-up when the client stopped combat.
Every one of these is a *client-originated effects-only progression* and must not come back; the internal owner replaces (1)–(3) and (5); (4) is already covered because live ticks resolve effects.

## 2. Intended lifecycle (files/contracts per step)

| Step | Owner today |
| --- | --- |
| finite effect committed | `commit_encounter_tick_v2` writes `active_effects` (`next_tick_at`, `expires_at`, `remaining`, `mechanic`, `magnitude`, `source_id`, `node_id`) |
| source leaves node / live stops | `leave_encounter_engagements`; participation preserved (presence-vs-participation memory) |
| effect becomes due | `active_effects.next_tick_at <= now_ms` — **no owner** |
| internal work discovered | **missing — this plan** |
| effects-only scope established | `encounter_for_node` (catchup role never creates via intake) |
| tick claimed | `claim_encounter_tick(_supported_modes := ['effects_only'])` |
| strict snapshot decoded | `encounter_snapshot_v2` + `loadSnapshotAux` + `decodeEncounterSnapshot` |
| pure resolver, effects_only | `pure/resolver.ts` (`snapshot.mode`) |
| atomic commit | `commit_encounter_tick_v2` (digest + claim token + spawn_seq one-way death) |
| effect advances/expires | resolver effect step + commit effect delete/update |
| creature may die | commit death path, `encounter_death_id`, `bump_creature_spawn_seq` |
| source attribution retained | `active_effects.source_id` + participation rows |
| rewards/loot written once | shared kill-resolver, `encounter_kill_awards`, `encounter_death_loot`, `node_ground_loot` at creature node |
| observable | `encounter_tick_batches` + realtime, `useEncounterBatches` |
| nothing due → no work | **missing — this plan** |

## 3. Work discovery options and trade-offs

- **A. Scheduled Edge worker with an external scheduler** — needs a scheduler that does not exist in this stack; adds a second scheduling system and a second secret surface. Rejected as primary.
- **B. pg_cron + pg_net dispatch (matches deployed `email_queue_dispatch`)** — reuses vault credential, cron arming/disarming, world-sleep integration. Discovery in SQL, invocation over HTTP to the existing Edge orchestration. Strong fit.
- **C. Commit-created outbox** — most bounded, but duplicates truth already in `active_effects` and needs invalidation on expiry/consumption/earlier due time. Too much new state for the gain.
- **D. Extend an existing internal owner** — `tick-creatures` / `world-watchdog` already own world-driven progression, arming and sleep policy.

**Recommendation: B implemented as D — a bounded SQL due-work view + claim function, dispatched by a new cron job armed exactly like `tick-creatures`, calling the existing `combat-catchup` over `net.http_post` with the vault service-role key.** No outbox table; boundedness comes from a partial index on `active_effects (next_tick_at)` and a per-invocation scope cap. A `next_effect_due_at` column on `encounters` is added as a cheap denormalised hint maintained by commit, used only to order/limit discovery — never as authority.

## 4. Design

Migrations (additive):
1. `alter table public.encounters add column next_effect_due_at bigint`, index `on encounters (next_effect_due_at) where status = 'active' and next_effect_due_at is not null`.
2. index `on active_effects (next_tick_at)` and `(node_id, next_tick_at)`.
3. `public.effects_due_scopes(_limit int)` — SECURITY DEFINER, `search_path = public`, service-role-only: returns at most `_limit` rows `(encounter_id, node_id, source_character_id, due_at_ms, effect_count)` for active encounters whose oldest due `active_effects` row is due, whose `tick_state` is not `resolving` with a live lease, and whose last tick is at least one rate interval old. Ordered by oldest due age (fairness), `for update skip locked` on the encounter row hint.
4. `public.effects_due_dispatch(_max_scopes int default 5)` — SECURITY DEFINER, service-role-only. Refuses when `combat_mode <> 'open'` unless soak allowlist applies, refuses when `not world_is_awake()`, then for each discovered scope issues one `net.http_post` to `/functions/v1/combat-catchup` with the vault key and body `{ character_id, node_id }`, and records a diagnostic row.
5. `public.effects_catchup_log` (scope, encounter, node, outcome kind/reason, ticks, effects, duration ms, due age ms, created_at) with grants to `service_role` only, RLS enabled, no player policy; pruned by an existing prune job pattern.
6. `schedule_effects_catchup()` / `unschedule_effects_catchup()` mirroring `schedule_tick_creatures()`, job `effects-catchup` at `*/1` (SQL cadence floor) with internal spacing enforced by `claim_encounter_tick` `_rate_ms`; added to `wake_world()`, `world_watchdog()` (arm when awake, disarm when asleep) and to the `shutdown_world()` owned-job list. Arming is idempotent (`if not exists`) so repeated wake calls cannot duplicate workers.

Worker changes (`supabase/functions/combat-catchup/index.ts`): unchanged authority; accept an optional `scope_id`/`due_at_ms` echoed into the response and logged, and post the outcome back via a `record_effects_catchup_result` RPC so diagnostics are durable even when the tick is refused. No new bypass, no relaxed gate.

Credential: reuse a vault secret named `effects_catchup_service_role_key` (created the same way as `email_queue_service_role_key`; rotate by updating the vault row only; teardown = drop the secret plus unschedule the job). It never leaves the database or the Edge runtime.

## 5. Authority, cadence and handoff

- Effects-only authority is entirely the existing contract: real C3 orchestration, strict decoder, `resolveTickPure` in `effects_only`, C2 commit, existing seeded RNG, existing claim/lease. No parallel resolver, no alternate commit.
- Prohibitions are already enforced in the resolver's `effects_only` branch: no pending-action decode/consume, no autoattacks or abilities, no creature attacks, no new stacks/stances, no new boss casts (only closure of an already-started cast per the approved policy), no durability, no stance regeneration, no inferred presence.
- Cadence: discovery every minute; per invocation at most 5 scopes; per scope one claim, and the existing `MAX_CATCHUP_TICKS = 30` cap plus `ticksToSimulate` bounds elapsed simulation.
- Handoff: `claim_encounter_tick` is the single arbiter. A live driver holds `live` mode, so effects-only is refused (`mode_refused`) and the scope is skipped with no writes; when live stops, the same encounter becomes claimable as `effects_only`. If a player returns mid-resolution the effects-only commit either lands first or is refused as `stale_claim` — never both. Simultaneous live and effects-only commits for one encounter/tick are impossible by construction.
- Scope complete when no `active_effects` remain due at the node; `next_effect_due_at` is cleared by commit and the encounter drops out of discovery, producing zero further work and no encounter churn.
- Backlog surfaced as oldest-due-age and consecutive-failure counts in `effects_catchup_log`.

## 6. Sleep/wake policy (matches approved world-pause design)

- World sleeps when nobody has been online for 30 minutes; effects-only work is disarmed with `tick-creatures`.
- Effect time is **not** converted wholesale into damage after a long sleep. On wake, effects whose `expires_at` is already in the past are expired without retroactive ticks; still-live effects resume from `now`, with at most the existing tick cap of catch-up ticks applied. This preserves the approved pause semantics and prevents unbounded immediate damage.
- `wake_world()` re-arms both `tick-creatures` and `effects-catchup`; the watchdog may suspend but never permanently removes ownership (the schedule functions re-create the job); a missing job while the world is awake is itself logged as a detection signal.

## 7. Attribution and lifecycle rules (unchanged from approved offscreen attribution)

Source leaves the node, logs out, dies, changes party or class: the DoT continues and `active_effects.source_id` remains the reward owner. Rewards do **not** require the source to be online, alive, in range or still engaged — that is the already-approved offscreen attribution and this plan does not change it. Multiple casters keep separate effect rows and separate ownership. DoT kills attribute XP, salvage/gold, bond and contribution to the effect's source via the shared kill-resolver, exactly once per `encounter_death_id`. Ground loot is written to the creature's node. Effect expiry without death removes the row once. Already-consumed stacks are simply absent, producing a no-op. Respawn bumps `spawn_seq`; prior-generation proposals are refused at commit with zero writes.

## 8. Security proof

`combat-catchup` keeps `internalCaller` (service-role key or `role = service_role` JWT); anonymous → 401, authenticated player → 403. `effects_due_scopes`, `effects_due_dispatch`, `record_effects_catchup_result` and `commit_encounter_tick_v2` are `revoke execute ... from public, anon, authenticated` with `grant ... to service_role`, SECURITY DEFINER, fixed `search_path = public`. Scope is derived from server-side due-effect rows only; no user-controlled node, character or encounter. The credential lives in vault, is read only inside SECURITY DEFINER SQL, and never appears in a client bundle or a log line. Maintenance stays global with no bypass; the soak allowlist remains the only exception and is unchanged. Internal requests carry a `Lovable-Context: cron` header and a distinct `caller` value for log separation.

## 9. Test matrix (permanent)

Refusals: anonymous invocation 401; player JWT 403; valid internal invocation accepted. Behaviour: fled owner's DoT continues; DoT kills offscreen; correct source gets exactly-once XP/gold/bond/loot; ground loot at creature node; multiple casters keep separate ownership. Contract negatives: effects-only originates no stacks/stances/casts/autoattacks; pending actions remain unconsumed and never abort decoding; existing boss cast handled only per approved policy; zero durability change. Lifecycle: expiry removes rows once; duplicate scheduler invocation cannot double-process; concurrent live/effects-only claims yield one winner; worker failure after claim recovers via release/lease expiry; stale `spawn_seq` writes nothing; respawned creature unaffected. System: sleep/wake follows the pause policy; bounded catch-up respects tick and scope caps; no due effects → no encounter/runtime churn; missing/deleted schedule is detected; teardown leaves no temporary credential or probe surface. Placement: `src/test/combat/c6/*` plus SQL-parity cases beside the existing `effects/sql-parity.test.ts`.

## 10. Deployment order

1. Additive migration: column, indexes, `effects_catchup_log`, discovery/claim/dispatch/record functions, grants (no schedule yet).
2. Vault secret creation.
3. Worker diagnostics change in `combat-catchup` + shared mirror sync.
4. Unit/contract/parity/application suites green (including the 4,000-encounter parity sweep unchanged).
5. Deployed service-role validation of `effects_due_scopes` and one manual `effects_due_dispatch` with the schedule still off.
6. Anonymous and player denial probes against `combat-catchup` and every new function.
7. Arm the `effects-catchup` cron via `schedule_effects_catchup()` and wire `wake_world`/`world_watchdog`/`shutdown_world`.
8. Fled-DoT deployed scenario with a temporary allowlisted fixture (soak switch only, still `combat_mode = maintenance`).
9. Sleep/wake validation; failure/retry/idempotency validation.
10. Short monitoring period reading `effects_catchup_log`.
11. Teardown of validation-only fixtures; restore `combat_soak = off`, empty allowlist, keep maintenance.

Rollback: `unschedule_effects_catchup()` alone stops all internal effects-only progression while leaving live authority and the claim contract untouched — ownership is never ambiguous because the DB claim remains the single arbiter. Full rollback additionally drops the new functions/log/column; nothing else depends on them.

## 11. C5 entry criteria

Steps 1–10 complete and green; zero player/anonymous acceptance in denial probes; one fled-DoT deployed kill with exactly-once rewards; no orphaned claims, leases, actions, effects or sessions after the monitoring window; `combat_soak = off`, allowlist empty, `combat_mode = maintenance`; delayed-delivery/two-tab still listed as open C5 coverage. Only then does the fresh C5 soak restart, on explicit approval.
