# Streamlining Live Solo and Party Combat

Same 2s rhythm, same numbers. One shared authoritative tick per node, per-creature engagements that each act once, durable player actions, recoverable single-tick claims, and no browser acting as transport for anyone else's action.

## Part 1 — Audit (verified against current code)

### Solo request flow
`useCombatDriver.doTick` (worker timer, 2000ms) → `functions.invoke('combat-tick')` with `{ character_id, node_id, member_buffs, engaged_creature_ids, pending_abilities[], client_cp }`. Server verifies JWT, loads the character, loads/creates the `combat_sessions` row keyed by `character_id`, computes `ticks = min(floor((now - last_tick_at)/2000), 3)`, simulates, writes, returns `{ events, creature_states, member_states, active_effects, ticks_processed }`.

### Party leader flow
Same body with `{ party_id }`. The server rejects anyone who is not `parties.leader_id` ("Not the party leader"). Members are re-derived from `party_members` filtered to `current_node_id === node_id AND hp > 0`. The leader rebroadcasts the whole response on `party-combat-<partyId>` as `combat_tick_result`.

### Follower flow
A follower never calls the tick. It sends `engage_request`, `member_pending_ability` and `member_buff_state` (every 1800ms) on the party channel. The leader holds these in `memberAbilitiesRef` / `memberBuffsRef` (in-memory only), drains the abilities into its next request body, and the follower learns the outcome only from the leader's rebroadcast.

### Authoritative-looking values supplied by a client
Discarded server-side: `ability_type`, `cp_cost`, `client_cp_before`, `client_expected_cp_after` (re-derived by `authorizeQueuedAbility`).
Still trusted: `client_cp` (allowed to *lower* CP via `min(client_cp, dbCp)`), `engaged_creature_ids`, `target_creature_id`, `consume_stacks`, and the whole `member_buffs` bag (crit_buff, stealth_buff, damage_buff, evasion_buff, absorb_buff, sunder_target/reduction, root_debuff, battle_cry_dr, holy_shield, aura_pulse, divine_challenge, disengage_next_hit). Stances are already re-hydrated from `characters.reserved_buffs` / `stance_state`; nothing else is.

### Failure behaviour today
Dropped `member_pending_ability` → action silently lost, follower already debited CP locally. Leader backgrounded → the party's combat stalls. Leader disconnect → session lingers until node-change / stale-reuse deletion; followers stop after `useCombatLifecycle`'s 6s no-tick timeout. Leadership change mid-fight → new leader starts with empty refs. Follower retransmit → duplicate action, no dedupe. Duplicated/reordered `combat_tick_result` → reprocessed; only the leader filters stale via `tickSeqRef`, followers have no batch identity at all.

### Duplicate-tick safety — evidence against
`last_tick_at` is read, then written as `previousLastTickAt + ticks * TICK_RATE` with a plain `UPDATE ... WHERE id`. No CAS, no `FOR UPDATE`, no lock around the round. Two concurrent invocations (two leader tabs, or `invokeWithRetry` / the in-hook 3-attempt retry after a request that actually succeeded but returned 502/503) read the same `last_tick_at` and both resolve the same interval: creature attacks twice, CP charged twice, statuses refreshed twice, `pending_abilities` executed twice. Only individual HP writes are safe — `encounter_apply_damage` and `encounter_apply_character_damage` take `pg_advisory_xact_lock(encounter_lock_key(...))` plus `SELECT ... FOR UPDATE`. Boss cast starts are guarded by `encounter_boss_start_cast`'s unresolved-cast check; kill rewards by the `rewards_awarded_at` claim. Ability execution has no idempotency key.

### Cross-party behaviour today
`combat_sessions` is keyed `character_id` XOR `party_id`, never by node or creature. Every solo player and every party fighting one creature runs an **independent** tick cursor: separate snapshots, one creature action *per session*, boss casts advanced by whichever session runs, statuses refreshed per session, a different event batch per session. Only `creatures.hp` converges, via the locked delta RPC.

### Engagement storage today — audited
- `encounter_participants(encounter_id, character_id, joined_at, last_action_at)` — no creature column. It cannot say *which* creature a character fights.
- `encounter_creatures(encounter_id, creature_id)` — creature → encounter only.
- The only per-character-per-creature record is `combat_sessions.engaged_creature_ids uuid[]`, which is party/character-scoped and merged from client-supplied `engaged_creature_ids` on every request.

So the durable participant-to-creature relationship **does not exist yet** and must be added.

### Creature targeting today
`selectPrimaryTarget(candidates, { mode: tankAtNode ? 'tank_strict' : 'random_alive', tankId })`, where `tankId = parties.tank_id || parties.leader_id`, candidates being that session's members at the node. Boss casts and stored-power sourcing use `tank_preferred`. No threat accumulation.

### Live vs catch-up overlap
`combat-catchup` calls `encounter_reconcile(node_id)`, which sets `last_tick_at = now()` on **every** `combat_sessions` row for the node — silently discarding a live interval mid-fight.

### Cron reality (verified)
`cron.job` currently contains exactly one job, `prune-combat-audit` (hourly, gated on `world_is_awake()`); the rest are unscheduled while the world sleeps and re-created by `wake_world()`. There is no sub-minute job and no generic sweeper to piggyback on.

## Part 2 — Required ownership model

```text
node encounter                       (encounters row, encounter_key='default')
  → one shared logical world tick    (tick_number, monotonic)
    → one or more creature engagements
      → each engaged creature acts exactly once during that tick
      → each character participates only in the engagements it joined
    → one status and boss-cast progression
    → one ordered authoritative result batch for the whole tick
```

There is no contradiction between the node encounter and per-creature action: the encounter owns *time*, the engagement owns *who fights what*. A node tick resolves every engaged creature once and every character only inside its own engagements.

### Precise ownership division

| Concern | Owner |
| --- | --- |
| Logical tick cursor, tick number, claim/lease, mode, commit | `encounters` |
| Creature HP, alive, aggro, death | `creatures`, written only via `encounter_apply_damage` under `encounter_lock_key` |
| Creature ↔ encounter attachment | `encounter_creatures` (`UNIQUE(creature_id)`) |
| Presence at the encounter | `encounter_participants` |
| **Who fights which creature** | `encounter_engagements` (new) |
| Durable player intents | `combat_actions.encounter_id` + `target_creature_id` |
| Enemy statuses, DoTs, amps | `active_effects` (node/target-scoped, already shared) |
| Boss casts, stored power | `encounter_cast_events`, `encounters.stored_power` |
| Damage/heal ledger, kill-credit inputs | `encounter_contributions` |
| Party membership, friendly targeting, party buffs/heals, party XP bonus | `parties` / `party_members` |
| Per-client heartbeat and UI lifecycle only | `combat_sessions` |

`combat_sessions` loses all tick authority (`last_tick_at` becomes advisory, then the cursor use is dropped) and keeps only "this client is present and polling", which is what `useCombatLifecycle` and the OOC-regen / Force-Shield-freeze RPCs need. Party identity controls **friendly** behaviour only; it never creates a second enemy tick progression.

### `encounter_engagements` (smallest engagement model)
`(encounter_id, creature_id, character_id)` PK, plus `joined_at`, `last_action_at`, `party_id_at_join` (diagnostic only). GRANT `SELECT` to `authenticated` (own rows / same-node via RLS), `ALL` to `service_role`; writes through RPCs only.

Created by: `engage_request`/auto-aggro (`join_encounter_engagement`), `submit_combat_action` (implicitly, for its target), and creature-initiated aggro server-side.
Removed by: target death (that creature's rows for everyone), movement, flee, death, explicit disengage, and heartbeat expiry beyond the grace window.

This is what lets the resolver auto-attack the right creature on ticks where a character submits nothing: **auto-attacks follow engagements, not actions.** An engagement row is the durable statement "this character is fighting this creature", so a silent tick still produces its autoattack against exactly that creature.

Multiple creatures at one node: the tick iterates the encounter's engaged creatures in a deterministic order (`joined_at, creature_id`); each acts once against the living characters engaged with *it*; a character engaged with two creatures autoattacks its primary (most recently acted-on) target and is a valid victim for both.

## Part 3 — Proposed changes

### Durable actions: `combat_actions`
`id uuid PK` (client-supplied idempotency key), `encounter_id`, `character_id`, `node_id`, `ability_key`, `target_creature_id`, `target_character_id` (friendly abilities), `client_seq int`, `submitted_at`, `eligible_after_ms`, `status` (`pending|consumed|rejected|cancelled`), `consumed_tick bigint`, `reject_reason text`, timestamps + update trigger. GRANT `SELECT` to `authenticated` (own rows via RLS), `ALL` to `service_role`.

`submit_combat_action(...)` (SECURITY DEFINER, `search_path = public`) derives `encounter_id` from the target creature via `encounter_ensure_for_creature`, upserts `encounter_participants` + `encounter_engagements`, and validates ownership, alive, node match, loadout/assignment membership, target validity and CP as a pre-check. A solo player's, Party A's and Party B's actions all queue on the same encounter. Re-submitting the same `id` is a no-op returning the stored row. A new submission cancels the caller's existing `pending` row (single pending slot, matching today's feel).

### Removing the remaining client-authoritative inputs
Authority corrections only; no numbers change.
- `client_cp` no longer lowers authoritative CP once durable submission is live — CP comes from `characters.cp` minus `sumReservedCp(reserved_buffs)`.
- `consume_stacks` is derived from `active_effects` (the authoritative stack rows) for the target and stack type, not from the client.
- Targeting eligibility comes from `encounter_engagements` + `creatures`, not `engaged_creature_ids`.
- Buffs/stances from `reserved_buffs`, `stance_state`, `active_effects`; costs and mechanics from the ability configuration.
- `member_buffs`, `member_buff_state`, `client_cp`, `consume_stacks` and `engaged_creature_ids` all leave the request body by the end of migration.

### Recoverable claim — one logical tick at a time
New `encounters` columns: `tick_number bigint`, `tick_at bigint`, `tick_state text` (`idle|resolving`), `resolving_tick bigint`, `tick_mode text` (`live|effects_only`), `resolver_id uuid`, `lease_until bigint`, `attempt int`.

`claim_encounter_tick(_encounter_id, _rate_ms, _lease_ms, _caller text)` — advisory xact lock, then:
- `resolving` with a live lease → `claimed=false, reason='in_flight'`.
- `resolving` with an expired lease → returns the **same** `resolving_tick` and `tick_mode` again with a fresh lease and `attempt+1`. Same resolution contract, so a retry cannot silently switch modes.
- `idle` and `now - tick_at >= rate` → claim exactly **one** step: `resolving_tick = tick_number + 1`, mode computed as below.
- otherwise `claimed=false, reason='not_due'`.

It never advances `tick_at`. `commit_encounter_tick(_encounter_id, _tick, _batch_id, deltas...)` — same lock — verifies `resolving_tick = _tick`, applies **all** deltas for that one tick in a single transaction (creature HP/deaths, character HP/CP/resources, status rows, action consumption, contributions, reward claims, batch row), sets `tick_number = _tick`, `tick_at = tick_at + rate`, `tick_state='idle'`. A commit for an already-committed tick is a no-op.

An invocation loops `claim N → resolve N → commit N` up to the existing three-step cap, each with its own snapshot, action consumption, creature actions, batch and recoverable claim. **Recovery if the resolver dies after committing N but before N+1:** N is durable and published, N+1 was never claimed, so the next invocation (or the next heartbeat) claims N+1 normally. If it dies *inside* N, nothing from N is applied; the lease expires and the identical tick N is re-resolved and committed once. Under a held lease other callers get `claimed=false` and return the current snapshot, so nothing double-advances.

### Resolution mode — derived, not first-come
`tick_mode` is computed **inside the claim** from authoritative state, never from which function called:
- `live` when the encounter has at least one eligible participant: alive, `current_node_id = encounter node`, at least one engagement, and a `combat_sessions` heartbeat within the grace window.
- `effects_only` when there is none.

Consequences: `combat-catchup` can never claim an active combat interval — with eligible participants present the claim returns `live`, and catch-up (which does not resolve player/creature actions) refuses a `live` claim and returns `claimed=false, reason='live_encounter'`, leaving the interval for the live resolver. Equally, `combat-tick` refuses an `effects_only` claim. `encounter_reconcile` stops resetting any cursor; offscreen effect intervals advance only through `claim/commit`, so live and catch-up can never hold the same interval. The mode is stored, so an expired-lease retry repeats the same contract.

### Dual-delivery safety during migration
The resolver executes `combat_actions` rows **exclusively**. `member_pending_ability` becomes a presentation-only "Elyra prepares Frost Bolt" message carrying the *same* action `id`, purely so clients can match preparing → resolved. No resolver path reads, reconstructs or executes an action from a broadcast.

### Participant and cancellation rules
- Leaving a party does **not** leave the enemy encounter: `encounter_participants` and `encounter_engagements` are untouched.
- Enemy-targeted pending actions stay valid for a now-solo character still present and engaged.
- Party-targeted (friendly) abilities are revalidated against current `party_members` at resolution; failing that they are `rejected` with a reason.
- Target death cancels only the actions and engagements for that creature; other engagements survive.
- Movement, flee, death and explicit disengage remove the relevant engagement (flee removes only the engagement fled from) and cancel its pending actions.
- Brief disconnection follows the existing heartbeat/grace behaviour: engagements survive the grace window and expire after it, and the existing 3s XP-grace for kill credit is preserved.

### Cross-party rules: current → proposed

| Case | Current | Proposed |
| --- | --- | --- |
| Two solo players, one creature | Two cursors, creature attacks in each | One node tick; both engaged; one snapshot |
| Solo + party | Two cursors | Same tick, resolved together |
| Multiple parties | One cursor per party | One shared tick for all |
| Two creatures at the node | Whatever each session engaged | Each engaged creature acts once per tick, against its own engaged characters |
| Several designated tanks | Session sees only its own tank | Ordered tank pool of every present party tank |
| Creature targeting | `tank_strict` if own tank present, else `random_alive` | Per creature: candidates = characters engaged with it, ordered `(joined_at, character_id)`. Tank pool non-empty → deterministic pick seeded by `tick_number`; else `random_alive`. No threat accumulation, no new system |
| Creature action count | Once per session | Exactly once per creature per logical tick |
| Enemy statuses | Refreshed per session | Applied/ticked once; amplify for all attackers |
| Party buffs, heals, party XP bonus | Party-scoped | Unchanged, strictly party-scoped |
| Joining / leaving | Ad-hoc per session | Engagement rows; purge on move/death/flee/disengage |
| Contribution, XP, kill credit, loot | Session-derived | `encounter_contributions` + engaged roster; existing formulas unchanged |
| Death and rewards | `rewards_awarded_at` claim | Same claim, now inside one committed tick |

### Batch publication, retention and recovery
`encounter_tick_batches(encounter_id, creature_scope?, tick_number, batch_id, payload jsonb, created_at)`, `PRIMARY KEY (encounter_id, tick_number)`. GRANT `SELECT` to `authenticated` (participants only via RLS), `ALL` to `service_role`.

Retention is **self-cleaning, not cron-dependent** (verified: the only scheduled job is hourly `prune-combat-audit`, and `wake_world()` recreates the rest — nothing runs sub-minute). `commit_encounter_tick` deletes that encounter's batches older than 60s in the same transaction, and `encounter_end` clears the rest. The migration adds this bounded cleanup explicitly; no new cron.

Publication happens **after** commit: the edge function broadcasts the committed batch on the node/encounter channel. A publication failure is logged and never rolls back or repeats the tick — the batch is already durable, and any client that missed the broadcast (gap in `tick_number`) fetches the missing batches by tick number and renders their ordered events. Outside the 60s window, clients fall back to a state snapshot plus an explicit log-gap line.

### Decomposition of `combat-tick` (behaviour-neutral)
`request.ts` (auth + validation) → `encounter.ts` (acquire/attach/engagements) → `claim.ts` → `actions.ts` → `snapshot.ts` → `resolve-players.ts` / `resolve-auto.ts` / `resolve-creatures.ts` / `resolve-boss.ts` / `resolve-status.ts` → `deaths.ts` → `commit.ts` → `events.ts` → `publish.ts`. `index.ts` becomes the `claim → resolve → commit → publish` loop.

## Part 4 — Migration phases

1. `combat_actions`, `encounter_engagements`, `submit_combat_action`, `join_encounter_engagement`. Clients submit durably and also emit the presentation broadcast with the same action `id`; the resolver reads only the DB rows.
2. Auto-attacks and targeting driven by `encounter_engagements` instead of `engaged_creature_ids`.
3. Encounter tick columns + `claim_encounter_tick` / `commit_encounter_tick` with derived mode; `combat-tick` resolves one tick per claim inside the loop. `combat_sessions.last_tick_at` becomes advisory.
4. Roster cutover: all engaged participants across parties and solos resolve in one tick; per-tick batches; `encounter_tick_batches` with inline retention; server-side publication; client duplicate/gap handling and batch fetch.
5. Authority corrections: authoritative buffs, server-derived `consume_stacks`, removal of `client_cp` lowering.
6. Any eligible participant may wake the tick (drop the leader-only check; keep the heartbeat).
7. Catch-up moved onto the shared claim in `effects_only` mode; `encounter_reconcile` cursor reset removed.
8. Module decomposition; drop compatibility fields, refs and broadcasts; demote `combat_sessions` to heartbeat state.

Compatibility safeguard throughout: only durable action rows execute, and every applied side effect is keyed by `(encounter_id, tick_number)` or a stable action `id`.

## Part 5 — Validation

Automated (vitest + edge tests):
- Solo combat numerically unchanged against recorded fixtures.
- Two independent solo participants cannot each advance the same creature.
- A solo player and a party resolve in the same encounter tick.
- Two parties receive the same `tick_number`, snapshot and batch.
- Two different creatures active at one node; different players/parties engaged with different creatures; several groups converging on one of them.
- Each active creature acts exactly once per tick — not once per party, and not once for the whole node.
- Auto-attacks continue against the correct creature on ticks with no newly submitted action.
- Fleeing one engagement leaves the character's other engagement intact.
- Failure after tick N commits but before N+1 is claimed: N durable, N+1 resolved cleanly next invocation.
- Crash inside tick N: nothing applied, lease expires, N re-resolved and committed once.
- Catch-up racing live resolution with active participants present: catch-up gets `claimed=false`, no effects-only resolution of a live interval.
- Leaving a party mid-combat keeps the enemy engagement; party-targeted actions are revalidated and rejected with a reason.
- Publication failure followed by batch recovery by tick number.
- Duplicate action `id` executes once; retry idempotent; CP charged once; rejected actions reconcile optimistic CP.
- Shared statuses and boss casts advance once per tick; Chilled still activates on the following tick regardless of participant order.
- Tank-pool targeting deterministic for a given tick number; tank departure falls back exactly once.
- Deaths and rewards resolve exactly once. No emoji.

Manual multi-browser script: 5 clients at a node with two creatures — Party A (2) on creature 1, Party B (1) on creature 2, two solos converging on creature 1. Verify identical tick numbers, one attack per creature per beat, party-scoped heals/buffs, correct kill credit and loot. Then: follower acts with the leader's tab hidden; leader hard-refresh; duplicate leader tab; leadership handover; a member leaves the party mid-fight; tank leaves; flee from one creature; target dies with an action queued; client offline 5s and back (batch recovery).

Observability: structured logs for claim outcome (`claimed|in_flight|not_due|mode_refused`), `tick_mode`, `attempt`, tick number, engaged creature and participant counts, commit latency, publication failures, rejected/cancelled action counts.

## Assumptions needing approval

- One `encounters` row per node owns the tick cursor; per-creature action is scoped by `encounter_engagements`.
- Single pending action per character, not a queue.
- New schema: `combat_actions`, `encounter_engagements`, `encounter_tick_batches`, encounter tick/lease/mode columns.
- 60s batch retention, pruned inline by `commit_encounter_tick` (no new cron).
- A character engaged with two creatures autoattacks its most recent target.

## Deliberately unchanged

2s cadence, all formulas, CP costs and regen, status behaviour, class assignments and loadouts, combat UI, reward and party-sharing math, world sleep, offscreen DoT behaviour.

## Incidental balance observations (out of scope)

- Sharing one tick means a creature attacks the combined engaged roster once per beat instead of once per party — a real, intended difficulty change for multi-party fights.
- `getXpPenaltySolo` remains dead code in `shared/formulas/xp.ts`.
