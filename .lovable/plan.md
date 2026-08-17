# Internal Effects-Only / Offscreen Catch-up Owner (revised)

Gate 3 accepted. Delayed-delivery / two-tab remains open C5 coverage. Combat stays in maintenance; nothing is implemented, no soak access is enabled, C5 is not restarted.

The revision below resolves the seven blocking contract gaps. One item (sleep policy) needs an explicit decision from you before implementation.

## 1. Departure lifecycle — traced, and it is broken today

Verified deployed behaviour:

- `leave_encounter_engagements(_character_id, _creature_id)` deletes `encounter_engagements` rows and cancels that character's pending `combat_actions`. It does **not** end the encounter and does not consider effects.
- `commit_encounter_tick_v2` computes `v_alive_engaged` from `encounter_engagements` joined to the surviving creature set and then does exactly:
  `v_ended := jsonb_array_length(v_alive_engaged) = 0;` … `IF v_ended THEN PERFORM public.encounter_end(_encounter_id); END IF;`
- `encounter_end(id)` sets `status = 'ended', ended_at = now()` when status is `active`. It has **no knowledge of pending effects or active casts**.
- `encounter_for_node(node)` selects only `status IN ('active','idle')` (reviving `idle` → `active`) and otherwise **inserts a brand-new encounter row** for that node.
- `encounter_reconcile(node)` is the only function that does consider effects: with zero participants and zero `active_effects` at the node it sets `idle`, and `ended` only after 30 idle minutes. With effects present it forces `active`. It is not called by the commit path.

Consequences, answering the questions directly:

- Does `leave_encounter_engagements` end the encounter when due effects remain? No — but the **next commit does**, because the engaged set is then empty.
- Does `encounter_end` distinguish "no engagements" from "no pending effects"? No.
- Can an encounter be `idle` with zero engagements while effects remain? Only via `encounter_reconcile`; the commit path jumps straight to `ended`.
- Does `encounter_for_node` reuse, revive or create? Reuses `active`, revives `idle`, and **creates a new encounter when the previous one is `ended`**.
- If it creates a new encounter, how do old effects/participants/contributions/death attribution attach? They do not. `active_effects` is keyed by `node_id` so those rows follow the node, but `encounter_participants`, `encounter_contributions`, `encounter_engagements`, `encounter_kill_awards` and `encounter_death_loot` are keyed by the old `encounter_id`. A new generation would decode a snapshot with node effects but **no participants**, so DoT kill attribution and rewards for the fled source cannot be resolved.
- Can `status = 'active'`-only discovery permanently miss work? Yes — the common case (last engaged creature dies or the last player leaves and one more tick commits) leaves `ended` encounters with live `active_effects` rows that nothing will ever advance.

So this must be fixed **before** the scheduler exists. Intended lifecycle, made explicit in SQL:

```text
no live engagements + pending finite effects/casts
   -> encounter stays effects-pending (status 'active', tick_owner unchanged)
   -> internal effects-only owner advances it
   -> encounter ends only when engagements, pending effects and active casts are all empty
```

Implementation (migration 1, before anything else):

1. New helper `public.encounter_has_pending_work(_encounter_id uuid) returns boolean` — true when any `active_effects` row exists at the encounter's node with `expires_at > now_ms`, or any unresolved `encounter_cast_events` row exists. SECURITY DEFINER, `search_path = public`, service-role only.
2. Change the commit end-condition to `v_ended := jsonb_array_length(v_alive_engaged) = 0 AND NOT public.encounter_has_pending_work(_encounter_id);`. This is the single behavioural change to the commit contract, and it only *delays* an end that already had no live driver.
3. `encounter_end` keeps its current signature but refuses to end while `encounter_has_pending_work` is true (defence in depth, so no other caller can strand effects).
4. Discovery therefore covers `status IN ('active','idle')` and never needs to resurrect an `ended` encounter. A one-off repair migration re-opens any existing `ended` encounter that still has unexpired effects at its node (currently zero rows: `encounters` is empty after Gate 3 teardown, so the repair is a no-op safety net).

Permanent coverage added in this step, before the scheduler: departure-with-pending-DoT keeps the encounter open; the encounter ends on the first tick after the last effect expires; a commit with zero engagements and zero effects still ends immediately; `encounter_for_node` never creates a second generation while effects remain.

## 2. Authoritative due-work discovery — no hint column

`encounters.next_effect_due_at` is dropped from the plan. Discovery reads `active_effects` directly:

```sql
-- index: active_effects (next_tick_at) and (node_id, next_tick_at)
select e.id, e.node_id, min(ae.next_tick_at) as due_at_ms, count(*) as effect_count
from public.active_effects ae
join public.encounters e
  on e.node_id = ae.node_id and e.encounter_key = 'default'
 and e.status in ('active','idle')
where ae.next_tick_at <= _now_ms and ae.expires_at > _now_ms
group by e.id, e.node_id
order by min(ae.next_tick_at)
limit _limit
```

`active_effects` is small and bounded by live encounters, and both indexes make this a bounded index scan — no world-wide creature/effect sweep. No denormalised column means no hint/state divergence and therefore no reconciliation-repair machinery to maintain. If measurements later prove a denormalised column is needed, it would come with a repair job that compares the column to `min(next_tick_at)` per node and a test that fails on divergence — but it is not in this plan.

## 3. Internal scope contract: encounter + node + generation, no character

- `combat-catchup` gains a second, internal-only request shape: `{ scope: 'encounter', encounter_id, node_id, due_at_ms }`. The existing `{ character_id }` shape is retained only for harness/manual use and is not what the scheduler sends.
- For the encounter shape the endpoint does **not** call `catchup_scope_check` (a player-oriented, character-scoped gate). It calls a new `public.effects_scope_revalidate(_encounter_id, _node_id, _due_at_ms)` which re-checks server-side, at request time, that: the encounter exists, is `active`/`idle`, belongs to that node, and still has at least one effect row with `next_tick_at <= now_ms` and `expires_at > now_ms`. Refusal reasons: `no_encounter`, `node_mismatch`, `nothing_due`, `world_asleep`, `maintenance`.
- `orchestrateCombatResolution` already supports `{ role: 'catchup', nodeId }` without a character, so no orchestration change is needed; `characterId` is simply omitted.
- This removes every failure mode of character-derived scope: multiple sources in one scope, deleted or offline sources, source-less/world/creature effects, source state changes, and the selected source's effect expiring before the request lands. All due effects at the node are advanced by the one authoritative tick regardless of who owns them; attribution stays per-effect via `active_effects.source_id`.

## 4. Sleep policy — separated thresholds, and a decision to make

Documented facts (verified):

| Event | Trigger | Authoritative timestamp |
| --- | --- | --- |
| creature ticking stops | `world_watchdog` (*/5) sees `world_is_awake() = false`, i.e. no `characters.last_online` within **5 minutes**, and unschedules `tick-creatures` | `max(characters.last_online)` |
| effects-only scheduling stops | same watchdog decision (this plan arms/disarms `effects-catchup` on the same signal) | `max(characters.last_online)` |
| `world_state.state = 'asleep'` | `idle_shutdown_check` (*/30) when no `last_online` within **30 minutes**, then `shutdown_world()` | `world_state.changed_at` |
| wake | `wake_world()` from an authenticated client / wake trigger | `world_state.changed_at` |

So there are two distinct boundaries: simulation ownership pauses at ~5 minutes of no presence; the *world* is formally asleep at 30–60 minutes. Paused simulation begins at the last `tick-creatures`/effects-catchup run before disarm and ends at the first run after `wake_world()` re-arms. I am not calling any of this "approved pause semantics" — nothing currently defines effect behaviour across the boundary.

Legacy behaviour (what actually happened before): `active_effects.next_tick_at` / `expires_at` are absolute epoch-ms. Nothing shifted them, and the only owner was the deleted client wake-up hook. So in practice sleep consumed effect duration, and whatever the returning client happened to trigger was bounded by `MAX_CATCHUP_TICKS = 30`. That is an accident, not a policy.

Choose one:

- **A. Frozen simulation** — on wake, shift `next_tick_at` and `expires_at` of all surviving effects forward by the measured sleep duration. No effect time passes while asleep; a 30s DoT resumes with its full remainder. Most faithful to "the world pauses", but rewrites effect rows and can revive damage a player left behind hours ago.
- **B. Bounded elapsed catch-up** — real time passed; on wake resolve at most 30 missed ticks per effect and discard the remainder, expiring the row. Closest to legacy accident; a long sleep still delivers a burst of offscreen damage and possible kills long after the fact.
- **C. Expire-without-damage across a sleep boundary (recommended)** — real time passed and the duration is consumed: on wake, any effect whose `expires_at` is already past is deleted with no ticks and no rewards; an effect still within its window resumes from `now` and is bounded by the existing 30-tick cap. Deterministic, no row rewriting, no retroactive damage or loot, and it matches the short (~30s) lifetime of DoTs where a sleep boundary is always vastly longer than the effect.

I recommend **C**. Implementation of C needs one addition: expiry-without-damage on wake must still be an authoritative write, so `wake_world()` calls a new `public.expire_stale_effects()` (service-role/definer, deletes `active_effects` with `expires_at <= now_ms`, logs a count) before re-arming the jobs — never a client and never the resolver. Whichever option you approve, it is written into the plan and covered by a permanent test before implementation starts.

## 5. Cron units and cadence

- `pg_cron` deployed version is **1.6.4**, which supports sub-minute schedules via the interval form (`'2 seconds'`); the five-field form is standard cron and `*/1 * * * *` means once per **minute**.
- Existing `tick-creatures` uses exactly `*/2 * * * *` — every two minutes, not two seconds.
- A one-minute effects-only cadence would mean up to ~60s delay on offscreen damage/kills, up to 30 ticks bursting at once, rewards and loot arriving much later than live combat, and players often returning before the owner ran. That is not acceptable for DoTs whose whole lifetime is ~30s.

**Chosen cadence: self-arming short-cadence job**, mirroring the deployed `process-email-queue` pattern.

- Job `effects-catchup`, schedule `'2 seconds'`, created only when due work exists.
- The dispatcher self-disarms (`cron.unschedule('effects-catchup')`) when a discovery pass finds zero due scopes, guarded by `pg_advisory_xact_lock` and a re-read under the lock — exactly the `email_queue_dispatch` disarm race fix.
- Arming happens from (a) `commit_encounter_tick_v2` when the committed tick leaves any unexpired effect behind, (b) `wake_world()`, (c) `world_watchdog()` as a repair when the world is awake and due work exists but the job is missing. All three go through idempotent `schedule_effects_catchup()` (`if not exists`), so duplicate workers cannot be scheduled.
- `world_watchdog()` disarms it when `world_is_awake()` is false; `shutdown_world()` adds `effects-catchup` to its owned-job list.
- Per invocation: at most 5 scopes; per scope one claim and the existing `MAX_CATCHUP_TICKS = 30`.

This gives near-live effect cadence while due work exists and zero standing cost when it does not.

## 6. Durable dispatch ownership

`FOR UPDATE SKIP LOCKED` is explicitly **not** relied on: `net.http_post` is asynchronous and the transaction's locks are gone before the Edge request runs. Instead:

1. New table `public.effects_catchup_dispatch(encounter_id uuid primary key, lease_until bigint not null, due_at_ms bigint not null, attempt int not null default 0, last_outcome text, last_error text, updated_at timestamptz default now())`. Service-role grants only, RLS enabled, no player policy.
2. Discovery and lease acquisition happen in **one** transaction: a scope is dispatchable only if it has no dispatch row or its `lease_until <= now_ms`. The row is upserted with `lease_until = now_ms + 10000` (longer than the encounter lease) before `net.http_post` is issued. The lease is durable across the dispatcher's own crash and across concurrent scheduler invocations.
3. Idempotency key `(encounter_id, due_at_ms)` travels in the request body and is stored on the dispatch row; a duplicate arrival for the same key is refused by `effects_scope_revalidate` (`nothing_due`, because the tick already advanced `next_tick_at`).
4. Duplicate HTTP delivery is therefore **possible but bounded**: at most one in-flight dispatch per encounter per 10s lease, and correctness is guaranteed by the existing claim/digest contract (`claim_encounter_tick` in_flight refusal, `stale_claim`, `already_committed`, `duplicate_batch`). This plan makes no claim that duplicates are impossible — only that they are bounded and non-mutating.

Recovery cases:
- `net.http_post` enqueued but delivery failed → lease expires in 10s, `net._http_response` failure is recorded by the next pass, work is retried; after 5 consecutive failures the scope's cadence backs off to 30s and the failure is surfaced in the log table.
- Edge resolved but result logging failed → the tick already committed authoritatively; the dispatch row simply expires and the next pass finds nothing due (no-op), counted as `unlogged_success`.
- Dispatcher crashed after leasing → lease expiry reclaims it; nothing was mutated because no tick was claimed.
- Request arrives after live combat consumed the effect → `effects_scope_revalidate` returns `nothing_due` and zero writes occur.

## 7. Maintenance and soak isolation is scope-wide

- In `combat_mode = 'open'` the scheduler runs normally — that is the production condition.
- Under maintenance the dispatcher refuses **unless the entire scope is fixture-isolated**: new table `public.combat_soak_scopes(encounter_id uuid, node_id uuid, expires_at timestamptz, granted_by uuid)` (service-role only, unexpired rows only). Dispatch requires: an unexpired grant for that encounter/node, **and** every `active_effects` row at the node has a `source_id` in the soak character allowlist (or is source-less and belongs to a fixture creature), **and** every creature at the node is a fixture creature. Permission is never inferred from one selected effect source.
- So during maintenance no permanent character's effect, no non-fixture creature or encounter and no neighbouring node can be advanced. `combat_soak_access_check` keeps its current role for the live path and is unchanged.

## 8. Migrations, functions, tests, deployment

Migrations, in order:
1. **Lifecycle fix** — `encounter_has_pending_work`, commit end-condition change, `encounter_end` guard, repair of `ended` encounters holding live effects.
2. **Discovery** — indexes on `active_effects (next_tick_at)` and `(node_id, next_tick_at)`; `effects_due_scopes(_limit int, _now_ms bigint)`; `effects_scope_revalidate(...)`.
3. **Dispatch durability** — `effects_catchup_dispatch`, `effects_catchup_log` (scope, encounter, node, outcome, reason, ticks, effects, deaths, duration_ms, due_age_ms, created_at), `record_effects_catchup_result(...)`, prune job entry.
4. **Dispatcher + schedule** — `effects_due_dispatch(_max_scopes int default 5)` (maintenance/soak-scope gate, world-awake gate, lease acquisition, `net.http_post` with the vault key, self-disarm on empty), `schedule_effects_catchup()` / `unschedule_effects_catchup()`, wiring into `wake_world()`, `world_watchdog()`, `shutdown_world()`, and the arming hook in `commit_encounter_tick_v2`.
5. **Sleep policy** — `expire_stale_effects()` (or the shift function, if you approve option A) called from `wake_world()`.

Code changes: `supabase/functions/combat-catchup/index.ts` accepts the encounter-scope body, revalidates via `effects_scope_revalidate`, reports outcomes through `record_effects_catchup_result`, keeps `internalCaller` unchanged; shared mirror sync (`scripts/sync-combat-shared.py`). No resolver, decoder, RNG or commit-authority change beyond the end-condition above. Secret: vault `effects_catchup_service_role_key`, created like `email_queue_service_role_key`, rotated by updating the vault row, torn down by dropping the secret and unscheduling the job.

Test matrix (permanent, `src/test/combat/c6/*` plus SQL-parity cases):
- Lifecycle: departure with pending DoT keeps the encounter open; end only after engagements + effects + casts are all empty; `encounter_for_node` never creates a second generation while effects remain; prior-generation effect rows can never be adopted by a new encounter.
- Access: anonymous 401; player JWT 403; internal service-role accepted; discovery/revalidate/dispatch/commit functions unreachable to `anon`/`authenticated`.
- Scope: encounter-scope body revalidated server-side; `node_mismatch` and `nothing_due` refusals write nothing; no character parameter required.
- Behaviour: fled owner's DoT continues; DoT kills offscreen; exactly-once XP/gold/bond/loot per `encounter_death_id`; ground loot at the creature's node; multiple casters keep separate ownership; rewards do not require the source online/alive/present (approved offscreen attribution preserved).
- Negatives: effects-only originates no autoattack, ability, creature attack, stack, stance or new boss cast; pending actions unconsumed and never abort decoding; existing cast handled only per approved policy; zero durability change.
- Robustness: duplicate dispatch cannot double-commit; concurrent live/effects-only claims produce one winner; crash after lease recovers; stale `spawn_seq` writes nothing; respawned creature unaffected; expiry removes rows once; effect already consumed → no-op.
- System: chosen sleep policy behaviour across a simulated sleep/wake; bounded catch-up respects the 30-tick and 5-scope caps; zero due work → job self-disarms and no encounter churn; missing job while awake is detected and re-armed; maintenance dispatch refused without a full-scope soak grant; teardown leaves no credential or probe surface.

Deployment order: migration 1 + lifecycle tests → migration 2/3 → worker change + full suite (including the unchanged 4,000-encounter parity sweep) → migration 4 with the job **not** armed → deployed service-role validation of `effects_due_scopes` and one manual `effects_due_dispatch` → anonymous/player denial probes → arm the job → fled-DoT deployed scenario with a fixture-isolated encounter grant (still `combat_mode = maintenance`) → sleep/wake validation of the approved policy → failure/retry/idempotency validation → short monitoring window on `effects_catchup_log` → teardown of fixtures, grants and probes.

Rollback: `unschedule_effects_catchup()` stops all internal effects-only progression while live authority and the claim contract stay intact — the DB claim remains the single arbiter, so ownership is never ambiguous. Full rollback additionally drops the dispatch/log tables and the new functions; the lifecycle fix (item 1) is kept, since reverting it would strand effects again.

## C5 entry criteria (updated)

1. Lifecycle fix deployed with permanent departure-with-DoT coverage green.
2. Discovery proven to read `active_effects` directly; no hint column exists.
3. Encounter-scope internal contract deployed; no character-scoped scheduler path.
4. Sleep policy explicitly approved by you and covered by a test.
5. Cadence self-arming/disarming verified: job present only while due work exists.
6. Dispatch lease + idempotency validated, including a forced duplicate dispatch with a single authoritative commit.
7. Anonymous and player denial probes return 401/403 on every new surface.
8. One deployed fled-DoT offscreen kill with exactly-once rewards and node-local ground loot, inside a fixture-isolated soak scope.
9. Monitoring window clean: no orphaned claims, leases, dispatch rows, actions, effects or sessions.
10. `combat_soak = off`, allowlist and soak scopes empty, `combat_mode = maintenance`; delayed-delivery/two-tab still listed as open C5 coverage.

Then, and only on your explicit approval, C5 restarts from a fresh baseline.
