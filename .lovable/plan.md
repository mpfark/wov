# Streamlining Live Solo and Party Combat

Goal: same 2s rhythm, same numbers, but party actions become durable, each encounter tick resolves exactly once, and no one's browser is the transport for anyone else's action.

## Part 1 — Audit (verified against the current code)

### Solo request flow
`useCombatDriver.doTick` (worker timer, 2000ms) → `supabase.functions.invoke('combat-tick')` with `{ character_id, node_id, member_buffs, engaged_creature_ids, pending_abilities[], client_cp }`. Server verifies JWT, loads the character, loads/creates the `combat_sessions` row keyed by `character_id`, computes `ticks = min(floor((now - last_tick_at)/2000), 3)`, simulates, writes, returns `{ events, creature_states, member_states, active_effects, ticks_processed }`.

### Party leader flow
Identical body but `{ party_id, ... }`. Server refuses anyone who is not `parties.leader_id` ("Not the party leader"). Members are re-derived from `party_members` filtered to `current_node_id === node_id AND hp > 0`. The leader then rebroadcasts the whole response on `party-combat-<partyId>` as `combat_tick_result`.

### Follower flow
Follower never calls the tick. It sends `engage_request`, `member_pending_ability` (its own queued ability payload) and `member_buff_state` (every 1800ms) on the party channel. The leader stores these in `memberAbilitiesRef` / `memberBuffsRef` (in-memory only), drains `memberAbilitiesRef` into the next request body, and the follower learns the outcome only from the leader's rebroadcast.

### Authoritative-looking values currently supplied by a client
Discarded server-side: `ability_type`, `cp_cost`, `client_cp_before`, `client_expected_cp_after` (re-derived by `authorizeQueuedAbility`); `client_cp` is only allowed to *lower* CP (`min(client_cp, dbCp)`).
Still trusted: `engaged_creature_ids`, `target_creature_id`, `consume_stacks`, and the entire `member_buffs` bag (crit_buff, stealth_buff, damage_buff, evasion_buff, absorb_buff, sunder_target/reduction, root_debuff, battle_cry_dr, holy_shield, aura_pulse, divine_challenge, disengage_next_hit). Stances are already re-hydrated from `characters.reserved_buffs` / `stance_state`; the rest are not.

### Failure behaviour today
Dropped `member_pending_ability` → action silently lost, follower already debited CP locally. Leader backgrounded → whole party's combat stalls (worker timer mitigates but visibility handler only re-ticks for the driver). Leader disconnect → session sits until node-change/stale-reuse deletion; followers stop after `useCombatLifecycle`'s 6s no-tick timeout. Leadership change mid-fight → new leader starts with empty `memberAbilitiesRef`/`memberBuffsRef`. Follower retransmit → duplicate action, no dedupe. Duplicated/reordered `combat_tick_result` → reprocessed; only the leader's own in-flight guard (`tickSeqRef`) filters stale, followers have no batch identity at all.

### Duplicate-tick safety — evidence against
`last_tick_at` is read, then written at the end as `previousLastTickAt + ticks * TICK_RATE` with a plain `UPDATE ... WHERE id`. There is no CAS, no `FOR UPDATE`, no advisory lock around the round. Two concurrent invocations (two leader tabs, or the built-in 3-attempt transient retry when a request actually succeeded but returned 502/503) both read the same `last_tick_at` and both resolve the same interval: creature attacks twice, CP charged twice, statuses refreshed twice, `pending_abilities` executed twice. Only individual HP writes are safe — `encounter_apply_damage` and `encounter_apply_character_damage` take `pg_advisory_xact_lock(encounter_lock_key(...))` plus `SELECT ... FOR UPDATE`. Boss casts are partly protected by `encounter_boss_start_cast`'s unresolved-cast check. Kill rewards are protected by the `rewards_awarded_at` claim. Ability execution has no idempotency key at all.

### Live vs catch-up overlap
`combat-catchup` calls `encounter_reconcile(node_id)`, which sets `last_tick_at = now()` on **every** `combat_sessions` row for the node. If a live fight is in progress, that silently discards the current interval — real overlap of interval ownership.

## Part 2 — Target ownership model

```text
client  → submit durable intent (RPC, own action row)
server  → validate + store (pending)
any eligible participant → wake resolver
resolver → claim encounter tick N atomically
         → consume eligible intents, resolve once
         → commit + publish batch (encounter, tick N, ordered events)
clients → render the same batch, ignore duplicates, refetch on gap
```

The leader keeps the heartbeat for now, but stops being transport or the only holder of anyone's action or buff state.

## Part 3 — Proposed changes

### Durable actions: `combat_actions`
`id (client-supplied uuid, PK = idempotency key)`, `character_id`, `session_id`/`encounter_id`, `node_id`, `ability_key`, `target_creature_id`, `client_seq`, `submitted_at`, `eligible_after_ms`, `status` (`pending|consumed|rejected|cancelled`), `consumed_tick`, `reject_reason`. Written only through `submit_combat_action(...)` (SECURITY DEFINER, `search_path = public`): validates ownership, life, node, engagement, that the ability is in the character's loadout, and CP availability at submit time as a *pre-check only*. RLS: owner may read own rows; all writes through the RPC; `service_role` full. Grants per project policy.

Replacement semantics (matches today's single pending slot): submitting cancels the caller's existing `pending` row for the same session and inserts the new one. No queue growth. Retry with the same `id` is a no-op returning the stored row.

Cancellation: movement, flee, death, target death, loadout/class change, leaving party or encounter → `cancelled`. Insufficient CP at resolution → `rejected` with reason, and the client reverts its optimistic CP.

### Atomic tick claim
`claim_encounter_tick(_session_id, _tick_rate_ms)` → `(tick_number, ticks, claimed boolean)`: advisory xact lock on the encounter, `SELECT ... FOR UPDATE` the session, compute `ticks`, and CAS `last_tick_at = last_tick_at + ticks*rate`, incrementing a new `combat_sessions.tick_number`. A caller that loses the race gets `claimed = false` and returns the current snapshot instead of resolving. `combat-tick` resolves only inside a successful claim.

### Tick identity and result batches
Response gains `{ session_id, encounter_id, tick_number, tick_at, batch_id }`. The server publishes the batch on the encounter/node channel; the leader rebroadcast becomes redundant and is removed at the end of migration. Client keeps `lastTickNumber`, drops `<=` duplicates, and on a gap calls the existing snapshot path (`combat-catchup` with `snapshot_only`) rather than replaying. No new permanent event table.

### Authoritative buffs
Move the trusted half of `member_buffs` to server reads: `characters.reserved_buffs`, `characters.stance_state`, `active_effects` (including `item_buff:*`). The client bag degrades to presentation hints and is then deleted from the request. Any value with no persisted home is written to `stance_state`/`active_effects` by the ability that grants it before this step lands.

### Encounter vs party ownership
Keep the tick attached to `combat_sessions` (one per solo character, one per party) and keep the node `encounter` as the shared arena for creature HP, contributions and boss casts — this is already how the RPCs are shaped. So: solo players and separate parties keep independent sessions, and unrelated players at one node stay separate fights that share creature truth. Party members at the node resolve in one tick; a split party resolves only the members at the session's node; a joining member is picked up on the next tick.

### Decomposition of `combat-tick` (behaviour-neutral)
`request.ts` (auth + validation) → `session.ts` (acquire/create/stale rules) → `claim.ts` → `actions.ts` (load/validate durable intents) → `snapshot.ts` → `resolve-players.ts` / `resolve-auto.ts` / `resolve-creatures.ts` / `resolve-boss.ts` / `resolve-status.ts` → `deaths.ts` → `commit.ts` → `events.ts` → `publish.ts`. `index.ts` becomes the pipeline.

## Part 4 — Migration phases

1. `combat_actions` + `submit_combat_action` + client submits durably **and** still broadcasts (leader prefers the DB row when the action `id` matches, so nothing double-executes).
2. Leader consumes DB actions only; `member_pending_ability` becomes presentation ("Elyra prepares Frost Bolt").
3. `tick_number` + `claim_encounter_tick`; tick identity in the response; client duplicate/gap handling.
4. Server-side publication of the batch; followers read from the encounter channel.
5. Authoritative buff loading; remove `member_buffs` and `member_buff_state` from the request path.
6. Any eligible participant may wake the tick (drop the leader-only check, keep leader heartbeat).
7. Refactor into modules; then reassess the heartbeat and remove compatibility reads/broadcasts.

Also in this pass: make `encounter_reconcile` skip sessions whose `last_tick_at` is within one tick, so catch-up can never steal a live interval.

## Part 5 — Validation

Automated (vitest + edge tests): solo numeric parity against recorded fixtures; claim race resolves one tick; duplicate action `id` executes once; retry idempotency; CP charged once; rejected action reason + reconciliation; Chilled still activates on the following tick regardless of party order; three-member shared snapshot; catch-up cannot overlap a live interval; no emoji.

Manual multi-browser script: 3 clients, one party — follower acts with the leader's tab hidden; leader hard-refresh mid-fight; leader duplicate tab; leadership handover; tank leaves; target dies as an action is queued; follower offline 5s and back.

## Assumptions needing approval

- Single pending action per character (today's feel), not a queue.
- `combat_sessions` stays the tick owner; `encounters` stays the arena.
- Adding `combat_sessions.tick_number` and a `combat_actions` table is acceptable new schema.

## Deliberately unchanged

2s cadence, all formulas, CP costs and regen, status behaviour, class assignments/loadouts, combat UI, reward and party-sharing math, world sleep, offscreen DoT behaviour.

## Incidental balance observations (not in scope)

- `consume_stacks` is still client-supplied for finishers; server-side stack counting would be a small behaviour change and is listed separately.
- `getXpPenaltySolo` remains dead code in `shared/formulas/xp.ts`.
