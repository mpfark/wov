# Streamlining Live Solo and Party Combat

Same 2s rhythm, same numbers. One shared authoritative tick per creature, durable player actions, recoverable tick claims, and no browser acting as transport for anyone else's action.

## Part 1 — Audit (verified against current code)

### Solo request flow
`useCombatDriver.doTick` (worker timer, 2000ms) → `functions.invoke('combat-tick')` with `{ character_id, node_id, member_buffs, engaged_creature_ids, pending_abilities[], client_cp }`. Server verifies JWT, loads the character, loads/creates the `combat_sessions` row keyed by `character_id`, computes `ticks = min(floor((now - last_tick_at)/2000), 3)`, simulates, writes, returns `{ events, creature_states, member_states, active_effects, ticks_processed }`.

### Party leader flow
Same body with `{ party_id }`. The server rejects anyone who is not `parties.leader_id` ("Not the party leader"). Members are re-derived from `party_members` filtered to `current_node_id === node_id AND hp > 0`. The leader rebroadcasts the whole response on `party-combat-<partyId>` as `combat_tick_result`.

### Follower flow
A follower never calls the tick. It sends `engage_request`, `member_pending_ability` and `member_buff_state` (every 1800ms) on the party channel. The leader holds these in `memberAbilitiesRef` / `memberBuffsRef` (in-memory only), drains the abilities into its next request body, and the follower learns the outcome only from the leader's rebroadcast.

### Authoritative-looking values supplied by a client
Discarded server-side: `ability_type`, `cp_cost`, `client_cp_before`, `client_expected_cp_after` (re-derived by `authorizeQueuedAbility`); `client_cp` may only *lower* CP (`min(client_cp, dbCp)`).
Still trusted: `engaged_creature_ids`, `target_creature_id`, `consume_stacks`, and the whole `member_buffs` bag (crit_buff, stealth_buff, damage_buff, evasion_buff, absorb_buff, sunder_target/reduction, root_debuff, battle_cry_dr, holy_shield, aura_pulse, divine_challenge, disengage_next_hit). Stances are already re-hydrated from `characters.reserved_buffs` / `stance_state`; nothing else is.

### Failure behaviour today
Dropped `member_pending_ability` → action silently lost, follower already debited CP locally. Leader backgrounded → the party's combat stalls. Leader disconnect → session lingers until node-change / stale-reuse deletion; followers stop after `useCombatLifecycle`'s 6s no-tick timeout. Leadership change mid-fight → new leader starts with empty refs. Follower retransmit → duplicate action, no dedupe. Duplicated/reordered `combat_tick_result` → reprocessed; only the leader filters stale via `tickSeqRef`, followers have no batch identity at all.

### Duplicate-tick safety — evidence against
`last_tick_at` is read, then written as `previousLastTickAt + ticks * TICK_RATE` with a plain `UPDATE ... WHERE id`. No CAS, no `FOR UPDATE`, no lock around the round. Two concurrent invocations (two leader tabs, or the built-in 3-attempt transient retry after a request that actually succeeded but returned 502/503) read the same `last_tick_at` and both resolve the same interval: creature attacks twice, CP charged twice, statuses refreshed twice, `pending_abilities` executed twice. Only individual HP writes are safe — `encounter_apply_damage` and `encounter_apply_character_damage` take `pg_advisory_xact_lock(encounter_lock_key(...))` plus `SELECT ... FOR UPDATE`. Boss cast starts are guarded by `encounter_boss_start_cast`'s unresolved-cast check; kill rewards by the `rewards_awarded_at` claim. Ability execution has no idempotency key at all.

### Cross-party behaviour today
`combat_sessions` is keyed `character_id` XOR `party_id`, never by node or creature. So every solo player and every party fighting one creature runs an **independent** tick cursor: separate tick-start snapshots, one creature action *per session*, boss casts advanced by whichever session runs (partially deduped by the unresolved-cast check), statuses refreshed per session, and a different event batch per session. Only `creatures.hp` converges, via the locked delta RPC. Cross-party visibility is presentation-only (`creature_damage` broadcast + `softDeadIds`).

### Creature targeting today
`selectPrimaryTarget(candidates, { mode: tankAtNode ? 'tank_strict' : 'random_alive', tankId })`, where `tankId = parties.tank_id || parties.leader_id` and candidates are that session's members at the node. Boss casts and stored-power sourcing use `tank_preferred`. There is no threat accumulation.

### Live vs catch-up overlap
`combat-catchup` calls `encounter_reconcile(node_id)`, which sets `last_tick_at = now()` on **every** `combat_sessions` row for the node — silently discarding a live interval mid-fight. Real overlapping ownership of the same effect interval.

## Part 2 — Required ownership model

```text
shared node/creature encounter  (encounters row)
  → one logical tick identity   (tick_number, monotonic)
  → all eligible engaged players across parties and solos
  → one tick-start snapshot
  → one creature action per logical tick
  → one status and boss-cast progression
  → one ordered authoritative result batch
```

### Precise ownership division

| Concern | Owner |
| --- | --- |
| Logical tick cursor, tick number, claim/lease, commit | `encounters` (node + `encounter_key='default'`) |
| Creature HP, alive, aggro, death | `creatures`, written only via `encounter_apply_damage` under `encounter_lock_key` |
| Creature ↔ encounter attachment | `encounter_creatures` (already `UNIQUE(creature_id)`) |
| Authoritative combatant roster for the snapshot | `encounter_participants` (any party, or none) |
| Durable player intents | `combat_actions.encounter_id` |
| Enemy statuses, DoTs, amps | `active_effects`, node/target-scoped (already shared) |
| Boss cast progression, stored power | `encounter_cast_events`, `encounters.stored_power` |
| Damage/heal ledger, kill credit inputs | `encounter_contributions` |
| Party membership, friendly targeting, party buffs/heals, party XP bonus | `parties` / `party_members` |
| Per-client heartbeat and UI lifecycle only | `combat_sessions` |

`combat_sessions` loses all tick authority: `last_tick_at` stops being read as a cursor (kept nullable for one migration phase, then dropped along with `tick_rate_ms` cursor use). It remains only as "this client/party is present and polling", which is what `useCombatLifecycle` and the OOC-regen / Force-Shield-freeze RPCs actually need.

Party identity therefore controls **friendly** behaviour only. It never creates a second enemy tick progression.

## Part 3 — Proposed changes

### Durable actions: `combat_actions`
Columns: `id uuid PK` (client-supplied, the idempotency key), `encounter_id` **(not session_id)**, `character_id`, `node_id`, `ability_key`, `target_creature_id`, `client_seq int`, `submitted_at`, `eligible_after_ms`, `status` (`pending|consumed|rejected|cancelled`), `consumed_tick int`, `reject_reason text`, timestamps + update trigger. GRANTs: `SELECT` to `authenticated` (own rows via RLS), `ALL` to `service_role`; every write goes through the RPC.

`submit_combat_action(...)` (SECURITY DEFINER, `search_path = public`) derives `encounter_id` from the target creature via `encounter_ensure_for_creature`, so a solo player's action and Party A's and Party B's actions all land in the **same** encounter queue. It validates ownership, alive, node match, that the ability is in the character's loadout/assignment, and CP availability as a pre-check only. It also upserts `encounter_participants` for the submitter. Re-submitting the same `id` is a no-op returning the stored row.

Replacement semantics (matches today's single pending slot): a new submission cancels the caller's existing `pending` row for the same encounter. No queue growth.

Cancellation → `cancelled`: movement, flee, death, target death, loadout/class change, leaving the party, leaving the encounter. Insufficient CP at resolution → `rejected` with a reason; the client reverts its optimistic CP.

### Recoverable tick claim (two-phase, lease-based)
New `encounters` columns: `tick_number bigint`, `tick_at bigint` (ms cursor), `tick_state text` (`idle|resolving`), `resolving_from`/`resolving_to bigint`, `resolver_id uuid`, `lease_until bigint`, `attempt int`.

`claim_encounter_tick(_encounter_id, _rate_ms, _lease_ms)` — advisory xact lock on `encounter_lock_key`, then:
- `tick_state='resolving'` and `lease_until > now()` → `claimed=false` (another resolver holds it); caller returns the current snapshot without resolving.
- `tick_state='resolving'` and lease expired → return the **same** `resolving_from/to` range again with a fresh lease and `attempt+1`. The interval is recovered, never skipped.
- `idle` → compute `steps = min(floor((now - tick_at)/rate), 3)`; if 0, `claimed=false`; else mark `resolving` with that range and a lease.

**It does not advance `tick_at`.** Only `commit_encounter_tick(_encounter_id, _tick_number, _batch_id, ...)` advances `tick_at` and `tick_number` and flips back to `idle`, under the same lock. So a crash after claim and before commit loses nothing: the lease expires and the identical interval is re-resolved.

At-most-once side effects: resolution is computed in memory against the tick-start snapshot and persisted by a single `commit_encounter_tick` transaction carrying the deltas (creature HP/deaths, character HP/CP/resources, status rows, action consumption, contributions, reward claims, batch row). A crash before commit applies nothing; a duplicate commit for an already-committed `tick_number` is rejected as a no-op. Action consumption is `UPDATE combat_actions SET status='consumed', consumed_tick=$n WHERE id=$id AND status='pending'`. Existing guards stay: `rewards_awarded_at` for kill rewards, the unresolved-cast check for boss casts.

### Logical tick identity across multiple elapsed steps
Each 2s step gets its **own** monotonic `tick_number` and its own result batch. A claim may cover up to 3 steps; the resolver simulates them in order and commits each with its own `commit_encounter_tick` call, so nothing is ambiguously collapsed. Every event and every `consumed_tick` carries its logical tick number. `ticks_processed` stays in the response for compatibility during migration, then goes away.

### Batch identity, publication and missed-result recovery
Response and broadcast carry `{ encounter_id, tick_number, tick_at, batch_id, events[], creature_states, member_states }`, published server-side on the node/encounter channel so no client is a relay.

**Decision: bounded event recovery (option B).** `encounter_tick_batches(encounter_id, tick_number, batch_id, payload jsonb, created_at)` with `PRIMARY KEY (encounter_id, tick_number)`, retained ~60 seconds and pruned by the existing prune cron. A client that detects a gap in `tick_number` fetches the missing batches and renders their ordered events; anything older than the window falls back to a state snapshot with an explicit "log gap" line. This is bounded short-lived retention, not event sourcing.

### Authoritative buffs
Move the trusted half of `member_buffs` to server reads: `characters.reserved_buffs`, `characters.stance_state`, `active_effects` (including `item_buff:*`). Any value with no persisted home is first written to `stance_state`/`active_effects` by the ability that grants it. The client bag degrades to presentation hints, then is removed from the request together with `member_buff_state`.

### Cross-party rules: current → proposed

| Case | Current | Proposed |
| --- | --- | --- |
| Two solo players, one creature | Two cursors, two snapshots, creature attacks in each | One encounter tick; both are participants; one snapshot |
| Solo + party | Two cursors | Same encounter tick, resolved together |
| Multiple parties | One cursor per party | One shared tick for all |
| Several designated tanks | Each session sees only its own tank | Ordered tank pool (all present `parties.tank_id`/leader fallback) |
| Creature targeting | `tank_strict` if own tank present, else `random_alive` | Tank pool non-empty → deterministic pick from it seeded by `tick_number`; otherwise `random_alive` over the whole roster ordered by `(joined_at, character_id)`. No threat accumulation, no new system |
| Creature action count | Once per session | Exactly once per logical tick |
| Enemy statuses | Refreshed per session | Applied/ticked once; visible to and amplifying for all attackers (already node/target-scoped) |
| Party buffs, heals, party XP bonus | Party-scoped | Unchanged, strictly party-scoped via `party_members` |
| Joining / leaving | Ad-hoc per session | `encounter_participants` upsert on engage/submit; purge on move/death/flee (existing `encounter_reconcile` step 1) |
| Contribution, XP, kill credit, loot | Session-derived, per session | `encounter_contributions` plus the participant roster; existing reward and party-sharing formulas unchanged |
| Death and rewards | `rewards_awarded_at` claim | Unchanged claim, now inside a single committed tick |

### Live and catch-up integration
`encounter_reconcile` stops resetting any cursor. Offscreen effect reconciliation goes through the **same** authority: `combat-catchup` calls `claim_encounter_tick` in effects-only mode and commits through `commit_encounter_tick`, advancing the one shared cursor. Live resolution and catch-up therefore cannot hold the same interval — one of them gets `claimed=false`.

### Decomposition of `combat-tick` (behaviour-neutral)
`request.ts` (auth + validation) → `encounter.ts` (acquire/attach) → `claim.ts` → `actions.ts` (load/validate durable intents) → `snapshot.ts` → `resolve-players.ts` / `resolve-auto.ts` / `resolve-creatures.ts` / `resolve-boss.ts` / `resolve-status.ts` → `deaths.ts` → `commit.ts` → `events.ts` → `publish.ts`. `index.ts` becomes the pipeline.

## Part 4 — Migration phases

1. `combat_actions` + `submit_combat_action`; clients submit durably **and** still broadcast; the leader prefers the DB row when the action `id` matches, so nothing double-executes.
2. Leader consumes DB actions only; `member_pending_ability` becomes presentation ("Elyra prepares Frost Bolt").
3. Encounter tick columns + `claim_encounter_tick` / `commit_encounter_tick`; `combat-tick` resolves only inside a claim, still per-session-triggered. `combat_sessions.last_tick_at` becomes advisory.
4. Cut the resolver over to the encounter roster: participants across parties and solos resolve in one tick; per-step tick numbers and batches; `encounter_tick_batches`; server-side publication; client duplicate/gap handling.
5. Authoritative buff loading; remove `member_buffs` / `member_buff_state`.
6. Any eligible participant may wake the tick (drop the leader-only check; keep the leader/solo heartbeat).
7. Catch-up moved onto the shared claim; `encounter_reconcile` cursor reset removed.
8. Module decomposition; drop compatibility fields, refs and broadcasts; demote `combat_sessions` to heartbeat state.

Compatibility safeguard throughout: a resolver only ever applies an action row, never a broadcast payload, and every applied side effect is keyed by `(encounter_id, tick_number)` or a stable action `id`.

## Part 5 — Validation

Automated (vitest + edge tests):
- Solo combat numerically unchanged against recorded fixtures.
- Two independent solo participants cannot each advance the same creature.
- A solo player and a party resolve in the same encounter tick.
- Two parties receive the same `tick_number`, snapshot and batch.
- The creature attacks exactly once per logical tick, not once per party.
- Shared statuses and boss casts advance once per tick.
- Resolver crash after claim, before commit: nothing applied; the same interval is re-resolved after lease expiry and commits once.
- Three elapsed steps produce three distinct tick numbers and batches.
- Catch-up and live resolution cannot claim the same interval.
- A missed batch is recoverable from `encounter_tick_batches` inside the window; outside it, state-only recovery with a log-gap line.
- Duplicate action `id` executes once; retry idempotent; CP charged once; rejected actions carry a reason and reconcile optimistic CP.
- Chilled still activates on the following tick regardless of participant order.
- Tank-pool targeting is deterministic for a given tick number; tank departure falls back exactly once.
- Deaths and rewards resolve exactly once.
- No emoji.

Manual multi-browser script: 4 clients — Party A (2), Party B (1), one solo — all on one creature. Verify identical tick numbers, HP, one creature attack per beat, party-scoped heals/buffs, kill credit and loot. Then: follower acts with the leader's tab hidden; leader hard-refresh mid-fight; duplicate leader tab; leadership handover; tank leaves; target dies as an action is queued; follower offline 5s and back.

Observability during rollout: structured logs for `claim` outcome (`claimed|busy|recovered`), `attempt`, tick range, participant count, party count, commit latency, and rejected/cancelled action counts.

## Assumptions needing approval

- One `encounters` row per node (`encounter_key='default'`) is the tick owner for every creature at that node, i.e. node-level ticking rather than per-creature ticking. This matches the existing `encounter_ensure_for_creature` shape and keeps one creature action per beat.
- Single pending action per character, not a queue.
- New schema: `combat_actions`, `encounter_tick_batches`, encounter tick/lease columns.
- 60s batch retention window.

## Deliberately unchanged

2s cadence, all formulas, CP costs and regen, status behaviour, class assignments and loadouts, combat UI, reward and party-sharing math, world sleep, offscreen DoT behaviour.

## Incidental balance observations (out of scope)

- Sharing one tick means a creature attacks the combined roster once per beat instead of once per party — a real (and intended) difficulty change for multi-party fights; flagging it explicitly.
- `consume_stacks` is still client-supplied for finishers; server-side stack counting would be a small behaviour change.
- `getXpPenaltySolo` remains dead code in `shared/formulas/xp.ts`.
