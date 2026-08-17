# Internal Effects-Only / Offscreen Catch-up Owner (final)

Sleep policy **C — expire without damage across a genuine simulation pause** is approved and written in below. Combat stays in maintenance, C5 is not restarted, combat is not reopened. The seven final corrections are incorporated.

## 0. What is already true (verified in the deployed database)

- `leave_encounter_engagements` deletes engagements and cancels that character's pending actions; it does not touch the encounter or effects.
- `commit_encounter_tick_v2` ends the encounter purely on `v_alive_engaged = 0` → `encounter_end`, which knows nothing about effects or casts.
- `encounter_for_node` reuses `active`, revives `idle`, otherwise **creates a new encounter**; participants/contributions/awards stay on the old id, so a new generation cannot attribute a fled source's DoT kill.
- `encounter_reconcile` is the only effect-aware lifecycle function and is not on the commit path.
- `pg_cron 1.6.4`, `pg_net 0.19.5`. `tick-creatures` is `*/2 * * * *` (two **minutes**). `email_queue_dispatch` is the deployed vault + `net.http_post` + self-disarm pattern.
- `world_is_awake()` = any `characters.last_online` within **5 minutes**; `world_watchdog` (*/5) arms/disarms `tick-creatures`; `idle_shutdown_check` (*/30) sleeps the world at **30 minutes**.
- The pure resolver already expires effects without ticking them (`effectLive` false → `effectDeleteIds`), and already advances periodic cadence from the *due* time. Policy C therefore needs one narrow, explicit addition (§4), not a new lifecycle.

## 1. Encounter lifecycle correction (stage 1)

Intended lifecycle:

```text
no live engagements + pending finite effects/casts
  -> encounter stays effects-pending (status 'active')
  -> internal effects-only owner advances it
  -> encounter ends only when engagements, pending effects and unresolved casts are all empty
```

`public.encounter_has_pending_work(_encounter_id)` returns true when, at the encounter's node, any of these exist:

- an `active_effects` row with `next_tick_at <= now_ms` (due),
- an `active_effects` row with `next_tick_at > now_ms` and `expires_at > now_ms` (future finite work),
- an `active_effects` row with `expires_at <= now_ms` (expired, still awaiting authoritative expiry),
- an unresolved `encounter_cast_events` row.

Explicitly **excluded** so an abandoned encounter cannot be held open forever:

- `lifetime = 'stance'` rows (persistent character stances) — they never expire and are not encounter work,
- rows whose target creature no longer exists or whose `spawn_seq` differs from the current generation — those are stale and are proposed for expiry once, then never again,
- rows already deleted/consumed (absent by definition).

Changes: commit end-condition becomes `v_alive_engaged = 0 AND NOT encounter_has_pending_work(...)`; `encounter_end` refuses while pending work exists (defence in depth); a repair statement re-opens any `ended` encounter still holding non-stance effects (currently a no-op — `encounters` is empty). Tests land in this stage, before any scheduler exists: departure with a pending DoT keeps the encounter open; end on the first tick after the last effect resolves; zero-effect departure still ends immediately; a stance-only node does **not** keep an abandoned encounter open; a stale-`spawn_seq` effect is expired once and stops counting as pending.

## 2. Due-work discovery and internal scope (stage 2)

Discovery reads `active_effects` directly — no hint column, no denormalised due time, so nothing can silently become authoritative:

```sql
-- indexes: active_effects (next_tick_at), (node_id, next_tick_at), (node_id, expires_at)
select e.id as encounter_id, e.node_id,
       min(ae.next_tick_at)                    as due_at_ms,
       min(least(ae.next_tick_at, ae.expires_at)) as earliest_ms,
       count(*) filter (where ae.next_tick_at <= _now_ms or ae.expires_at <= _now_ms) as due_count,
       count(*) as pending_count
from public.active_effects ae
join public.encounters e
  on e.node_id = ae.node_id and e.encounter_key = 'default' and e.status in ('active','idle')
where ae.lifetime <> 'stance'
group by e.id, e.node_id
```

Expired-but-unexpired-yet rows (`expires_at <= now`) are **due work**, per correction 1: they are resolved through the resolver and C2, never deleted by SQL.

Internal scope contract: `combat-catchup` accepts `{ scope: 'encounter', encounter_id, node_id, due_at_ms, dispatch_id }`. It does **not** use `catchup_scope_check` for this shape; it calls `public.effects_scope_revalidate(_encounter_id, _node_id, _due_at_ms)`, which re-checks server-side that the encounter exists, is `active`/`idle`, belongs to that node and still has eligible due work. Refusals: `no_encounter`, `node_mismatch`, `nothing_due`, `world_asleep`, `maintenance`, `scope_not_granted`. No character parameter: `orchestrateCombatResolution({ role: 'catchup', nodeId })` already supports character-less catch-up, so multiple sources, deleted sources, source-less effects and source state changes are all handled by one tick over the whole node scope, with attribution staying per-effect via `active_effects.source_id`.

## 3. Live/effects-only handoff and arming (correction 5)

Discovery uses the **same eligibility semantics as `claim_encounter_tick`**, so discovery and claim do not disagree: a scope is dispatchable only when no live driver is eligible, expressed as a new `public.encounter_live_owner_active(_encounter_id)` — true while any engagement exists whose character is present at the node and within the existing presence grace, or while a live claim/lease is held. Healthy live combat therefore produces **zero** effects-only dispatches; live ticks advance the effects.

Arming is wired to the authoritative presence/ownership transition, not to effect creation:

- `leave_encounter_engagements` (and `encounter_disengage`) arm the worker when the departure empties the eligible live set and pending work remains.
- `commit_encounter_tick_v2` arms only when the committed tick leaves pending work **and** `encounter_live_owner_active` is false (the abandoned-tab case where nothing called leave).
- `world_watchdog` re-arms as repair when the world is awake, pending work exists and the job is missing (covers a browser that vanished: once the presence grace lapses, `encounter_live_owner_active` turns false and the scope becomes eligible).
- `wake_world()` arms after recording the resume boundary (§4) — it never mutates effect rows.

All arming goes through idempotent `schedule_effects_catchup()`.

## 4. Policy C: authoritative expiry across a real pause

Persisted pause boundary — new single-row table `public.simulation_pause_state(id int primary key default 1, last_sim_at_ms bigint, suspended_at_ms bigint, resumed_at_ms bigint, updated_at timestamptz)`, service-role only:

- every successful `tick-creatures` and every effects-only dispatch pass writes `last_sim_at_ms`,
- `world_watchdog` writes `suspended_at_ms = last_sim_at_ms` when it disarms because `world_is_awake()` became false (and clears it on re-arm),
- `wake_world()` writes `resumed_at_ms = now_ms` and arms the worker. It performs **no effect mutation**.

Resolution: the orchestration passes `pauseBoundary = { suspendedAtMs, resumedAtMs }` into the effects-only snapshot. Inside the resolver's effects step (already the single place that both ticks and expires effects):

- a due tick whose `dueAt` falls **inside** `[suspendedAtMs, resumedAtMs)` is skipped — the schedule advances, no damage, no rewards;
- an effect whose `expires_at` also falls inside that window is proposed for deletion via the existing `effectDeleteIds` path, so C2 deletes it in the atomic committed batch with a normal `effect_expired` event and normal realtime delivery;
- an effect that is merely late while the world stayed awake (worker delay, Edge retry, claim contention, short outage) takes the **ordinary bounded catch-up** path — up to `MAX_CATCHUP_TICKS = 30` ticks, full damage. Lateness alone never suppresses damage.

Because ordinary DoTs run 25–34s and suspension only happens after the ~5-minute presence grace, effects normally finish long before any boundary exists; policy C is protection against state surviving a genuine long pause. Parity tests pin both branches (`src/test/combat/pure/pause-boundary.test.ts` plus the existing effects-only sweep), and no SQL path may ever delete an `active_effects` row outside `commit_encounter_tick_v2`.

## 5. Cadence, self-disarm race, durable dispatch (stage 3)

Cadence: job `effects-catchup` on the pg_cron interval form `'2 seconds'` (the five-field `*/1 * * * *` would be once per minute and is rejected as too slow for ~30s DoTs). Per invocation: at most 5 scopes; per scope one claim and the existing 30-tick cap.

Self-disarm (correction 3): a pass distinguishes three states — **due now** (dispatch), **future pending** (`next_tick_at > now` or `expires_at > now` for any effects-pending encounter → stay armed), **no pending work at all** (disarm). Disarm happens only after a `pg_advisory_xact_lock`-guarded re-read proves the third state, mirroring `email_queue_dispatch`'s disarm race fix. Re-arming never depends on another commit happening. Permanent race test: a pass that runs before `next_tick_at` must leave the job armed and the later due tick must still be processed.

Durable dispatch (corrections 4 and 6): `public.effects_catchup_dispatch(encounter_id uuid primary key, dispatch_id uuid not null, attempt int not null default 0, due_at_ms bigint not null, lease_until bigint not null, last_outcome text, last_error text, backoff_until bigint, updated_at timestamptz)`, service-role only, RLS on, no player policy.

- Discovery + lease acquisition happen in one transaction; a scope is dispatchable only with no row, an expired `lease_until`, or a lapsed `backoff_until`. Each dispatch mints a fresh `dispatch_id` and bumps `attempt`. `FOR UPDATE SKIP LOCKED` is **not** relied on for dispatch exclusivity — the durable lease is.
- `record_effects_catchup_result(_dispatch_id, _encounter_id, _outcome, _reason, _ticks, _effects, _deaths, _duration_ms)` atomically: validates `dispatch_id` identity (a late callback carrying an older `dispatch_id` is recorded as `stale_callback` and **must not** clear a newer lease), writes `effects_catchup_log`, and **immediately releases the lease** (`lease_until = 0`) whenever the HTTP request completed — so a success at t is followed by the next due tick 2s later, not after a 10s lease. Failure outcomes keep backoff metadata: 5 consecutive failures set `backoff_until = now + 30s`.
- Covered cases: successful commit then another due tick 2s later; `nothing_due`/`not_due` refusal; live-mode conflict (`mode_refused`); `stale_claim`; HTTP failure with no callback (lease expiry reclaims, `net._http_response` failure recorded); late callback after a newer lease exists.
- Duplicate HTTP delivery remains **possible but bounded** (at most one in-flight dispatch per encounter per lease) and non-mutating: correctness comes from `claim_encounter_tick` `in_flight`, `stale_claim`, `already_committed` and `duplicate_batch`.

## 6. Security and explicit fixture isolation (stage 5)

Production: `combat_mode = 'open'` is the normal internal scheduling condition. Under maintenance, dispatch refuses unless the **whole scope** is explicitly granted:

`public.combat_soak_scopes(id uuid, encounter_id uuid, node_id uuid, character_ids uuid[], creature_ids uuid[], expires_at timestamptz, granted_by uuid)` — service-role only, unexpired rows only. Dispatch refuses (`scope_not_granted`) if any effect source, any effect target, any creature at the node or any participant is not listed in that exact grant. No name matching, no implicit "fixture" notion, no permission inferred from one effect source. Grants are deleted at teardown.

Every new function (`encounter_has_pending_work`, `encounter_live_owner_active`, `effects_due_scopes`, `effects_scope_revalidate`, `effects_due_dispatch`, `record_effects_catchup_result`, `schedule_/unschedule_effects_catchup`) is SECURITY DEFINER with `search_path = public`, `revoke execute from public, anon, authenticated`, `grant execute to service_role`. `combat-catchup` keeps `internalCaller` (401 anonymous, 403 player). The credential is vault secret `effects_catchup_service_role_key`, read only inside definer SQL, rotated by updating the vault row, dropped at teardown. Internal calls carry `Lovable-Context: cron` and a distinct `caller` for log separation. No generic maintenance bypass; no user-controlled scope.

## 7. Migrations, code and tests

Migrations, in staged order: (1) lifecycle — `encounter_has_pending_work`, `encounter_live_owner_active`, commit end-condition, `encounter_end` guard, repair; (2) discovery — indexes, `effects_due_scopes`, `effects_scope_revalidate`; (3) dispatch — `effects_catchup_dispatch`, `effects_catchup_log`, `record_effects_catchup_result`, `effects_due_dispatch`, `schedule_/unschedule_effects_catchup`, wiring into `wake_world`, `world_watchdog`, `shutdown_world`, `leave_encounter_engagements`, `encounter_disengage`, `commit_encounter_tick_v2` arming, prune entry; (4) policy C — `simulation_pause_state` plus boundary writes and snapshot exposure; (5) grants and `combat_soak_scopes`.

Code: `supabase/functions/combat-catchup/index.ts` (encounter-scope body, revalidate, result callback, unchanged authority), resolver pause-boundary branch and snapshot/decoder/`loadSnapshotAux` field, shared mirror sync via `scripts/sync-combat-shared.py`. No other change to resolver authority, RNG, decoder or commit.

Test matrix (permanent): lifecycle (departure with DoT, end only when fully clear, stance does not hold an encounter, stale `spawn_seq`, no second generation); access (anonymous 401, player 403, internal accepted, every function unreachable to anon/authenticated); scope (revalidation, `node_mismatch`, `nothing_due`, no character parameter, grant-scoped maintenance refusal); behaviour (fled DoT continues, offscreen kill, exactly-once rewards per `encounter_death_id`, node-local ground loot, multiple casters separate, rewards independent of source online/alive/present); negatives (no autoattack/ability/creature attack/new stack/stance/new cast, pending actions unconsumed, zero durability); robustness (duplicate dispatch single commit, live vs effects-only single winner, crash after lease, late callback cannot clear a newer lease, lease released after success so the next 2s tick is not delayed, stale-dispatch callback); scheduling (early pass keeps the job armed and the later due tick lands, disarm only with zero pending work, missing job re-armed, no due work → no churn, healthy live driver produces zero dispatches); policy C (tick inside the pause window suppressed, expiry proposed by the resolver and committed by C2, late-while-awake keeps full damage, bounded 30-tick cap).

## 8. Deployment, validation, rollback

Staged exactly as authorised: lifecycle + tests → discovery/scope → dispatch/scheduling (job **not** armed) → policy-C expiry support → security/fixture gates → full combat and application suites including the unchanged 4,000-encounter parity sweep → deployed validation (service-role discovery, one manual dispatch, anonymous/player denial probes, fled-DoT offscreen kill inside a granted scope, sleep/wake boundary, duplicate dispatch, failure/retry/idempotency) → monitoring window on `effects_catchup_log` → teardown (grants, fixtures, probes, temporary credentials) and baseline comparison.

Stop-on-defect: any product defect or authority ambiguity halts the stage and is reported instead of worked around. Rollback: `unschedule_effects_catchup()` stops all internal effects-only progression with live authority and the claim contract untouched; full rollback drops the dispatch/log/pause tables and new functions but keeps the lifecycle fix, since reverting that would strand effects again.

## 9. C5 entry criteria

Lifecycle fix green; discovery authoritative with no hint column; encounter-scope internal contract deployed; policy C implemented through resolver + C2 only, with no SQL-side effect deletion; scheduler self-arming with the early-pass race test green; dispatch lease released per result and late callbacks proven harmless; healthy live combat produces zero effects-only dispatches; denial probes 401/403 on every surface; one deployed fled-DoT offscreen kill with exactly-once rewards and node-local loot inside an explicit grant; monitoring window free of orphaned claims, leases, dispatch rows, actions, effects and sessions; `combat_soak = off`, allowlist and soak scopes empty, `combat_mode = maintenance`; delayed-delivery/two-tab still listed as open C5 coverage. C5 restarts only on your explicit approval afterwards.
