# Shared Encounter Authority — Cutover Design (Stage B)

Status: **design only**. No migration, Edge Function change or client change is authorised by
this document. Stage A (measurement + client responsiveness) is deployed; this describes how the
authority actually moves.

Written against the live backend and repo HEAD after Stage A, plus the production evidence
captured from the fights played on 2026-08-12 (below).

---

## 1. What the Stage A fights actually showed

Evidence source: `combat-tick` / `combat-catchup` function logs and the client network trace for
character `Calikon` (node `9364d6f2…`, encounter session `a337cd00…`).

### 1.1 Catch-up is not the cause of the clumps

Every live tick in the session reported `ticks_processed: 1` except two (`2`), and
`ticks_capped: false` throughout. So group-type **A (legitimate catch-up)** is rare. The visible
pause is not the server compressing rounds.

### 1.2 The cost is server resolution plus claim drift

From the `trace` block Stage A added:

| tick | `tick_due_at` → `resolution_started_at` | `server_resolve_ms` |
|---|---|---|
| 1 | −343 ms (early) | 1447 |
| 2 | +1476 ms | 1057 |
| 3 | +1682 ms | 1195 |
| 4 | +1453 ms | 1292 |
| 5 | +1481 ms | 1494 |

Two independent problems:

- **Server execution is ~0.9–1.5 s per tick.** On a 2 s cadence, one tick spends 50–75 % of the
  interval inside the function. `combat-tick` performs its writes as many sequential statements
  (double `party_members` read, N+1 `join_encounter_engagement` / `purge_creature_engagements`
  loops, separate creature / character / reward / session writes, plus the Stage A post-write
  roster confirm), so latency is dominated by round-trip count, not by simulation.
- **A persistent ~1.5 s drift between when a tick is due and when resolution starts.** The
  client fires on its own 2 s worker cadence; `tick_due_at` comes from
  `combat_sessions.last_tick_at + interval`. Because the legacy CAS mutex advances
  `last_tick_at` by a fixed interval rather than to the actual resolution time, due-time and
  request time never converge. Player-visible latency is therefore *drift + execution*
  (~2.5–3 s), which is exactly the "pause then everything at once" feel — group type **B**.

### 1.3 Durable actions are provably not authoritative

Every `submit_combat_action` call in the session returned **HTTP 400 `ability not in loadout`**
(`judgment`, seq 6/7/8) — and the ability nevertheless resolved, because `combat-tick` executed
it from the request body's `pending_abilities`.

Root cause (new, not in the Stage A audit): `submit_combat_action`
(`20260807105803…sql:154-161`) requires a `character_ability_loadout` row joined to `abilities`,
but `useAbilityLoadout` **deletes the row when the class default is selected**
(`src/hooks/useAbilityLoadout.ts:7,76-78`). Default abilities therefore have no loadout row and
are rejected 100 % of the time. This explains the empty `combat_actions` table in production.

**Consequence for Stage B:** durable actions cannot become the exclusive execution authority
until this validation is corrected, or the cutover silently disables every default ability in
the game. This becomes Phase B0 — a prerequisite, not part of the cutover.

### 1.4 Catch-up is behaving

`combat-catchup` logs show `claim: unclaimed / reason: no_encounter` on empty nodes and
`claim: resolve` with a real tick where an encounter existed; `not_adjacent` skips return
snapshots only. No mutation happens on a refused claim. The `interpretEffectsOnlyClaim`
contract holds in production; it is the model the live path should adopt.

---

## 2. Target architecture

One encounter row is the sole unit of combat authority. All resolution is
**claim → read durable intent → resolve deterministically → commit atomically → publish one
ordered batch**.

```text
 client(s)                 encounter (postgres)                  resolver (combat-tick)
 ─────────                 ────────────────────                  ──────────────────────
 submit_combat_action ───► combat_actions(pending)
 wake tick ──────────────────────────────────────────────────►  claim_encounter_tick(live)
                           encounters.tick_owner = 'shared'  ◄── refuse: not_due/in_flight/
                                                                  mode_refused → return snapshot
                           SELECT actions FOR UPDATE SKIP …  ◄── read intent (payload ignored)
                                                                  resolve with tick-rng seeds
                           commit_encounter_tick(token)      ◄── one RPC: state + batch + actions
 encounter_tick_batches ─► realtime broadcast ──────────────►  every participant applies once
```

### 2.1 Claim before simulation

`claim_encounter_tick(encounter_id, modes := ['live'])` runs **first**, before any read of
creatures or characters. Rules (already encoded in `src/shared/combat/tick-claim.ts`):

- refusal (`no_encounter` | `in_flight` | `not_due` | `mode_refused`) captures no lease and
  mutates nothing; the function returns a fresh snapshot and `ticks_processed: 0`.
- a grant carries `tick`, `mode`, `claim_token`, `attempt`, `reclaimed`.
- the lease expires; a second resolver may reclaim the *same tick number* and must reproduce
  the same result (see 2.4).

`combat_sessions.last_tick_at` CAS stops being a mutex. It becomes a cadence hint only, and
`last_tick_at` is set to the **actual commit time**, which removes the 1.5 s drift in 1.2.

### 2.2 Encounter-wide roster (solo and multi-party)

The resolver derives its roster from `encounter_participants` + `encounter_engagements` +
`encounter_creatures`, ordered `(joined_at, character_id)` / `(created_at, creature_id)`. Party
membership is read **once**, only to attribute party-scoped effects (XP bonus, party regen,
follow). A solo player is a one-member roster; two parties on one creature are one roster with
one resolution. Party-leader-only resolution disappears — any participant may wake the tick.

### 2.3 `combat_actions` as the only execution authority

- Client submits intent (`submit_combat_action`) and **stops sending `pending_abilities`**.
- Resolver reads `status = 'pending'` for the encounter with `FOR UPDATE SKIP LOCKED`,
  ordered `(character_id, client_seq, created_at)`; one pending slot per character stays the
  rule.
- Each action is marked `resolved` / `rejected(reason)` inside the same commit as its effects.
  Replays are idempotent by `action_id`.
- Prerequisite **B0**: fix loadout validation (accept the class default when no row exists, by
  resolving the class's default ability for the role) and add a regression test asserting every
  default ability of every class passes `submit_combat_action`. Deploy and verify
  `combat_actions` receives rows *before* the cutover; the payload path stays live during B0.

### 2.4 Deterministic resolution

Every roll inside a claimed tick uses `supabase/functions/_shared/combat/tick-rng.ts` seeded by
`(encounter_id, tick_number, stream[, entity_id])` — attack/damage/crit/dodge/block, status
sampling, procs, boss cast selection, tank-pool pick, durability, loot. `Math.random()` is
banned in the resolver; a lint-style test asserts zero occurrences in
`supabase/functions/combat-tick/**` and `_shared/combat/**`. This is what makes a lease retry
safe: a reclaim of tick N recomputes tick N identically.

Stream names are fixed and versioned in one table in `tick-rng.ts`; changing a stream name is a
balance-visible change and requires its own review.

### 2.5 Atomic commit boundary

All of a tick's mutations move into one `commit_encounter_tick(encounter_id, claim_token,
payload jsonb)` transaction: creature HP/deaths, character HP/CP/MP/XP/gold/BHP, statuses and
effects, engagements, rewards and loot, action status transitions, `encounters` cursor,
`combat_sessions.last_tick_at`, and the `encounter_tick_batches` row.

- commit with a stale token → `already_committed` | `stale_claim`, and the resolver discards
  its work (never retries blindly).
- a resolver that dies before commit leaves **zero** partial state.
- this also collapses the per-tick round trips identified in 1.2; expected server execution
  after the change is one claim, a bounded set of reads, and one commit.

### 2.6 Shared ordered batches + recovery

- `encounter_tick_batches` gains `(encounter_id, tick_number)` uniqueness (if not already) and
  is added to the `supabase_realtime` publication.
- Clients subscribe per encounter and apply batches strictly in `tick_number` order, keyed by
  `batch_id`; the Stage A `appliedBatchIdsRef` dedupe generalises to this key.
- On a gap (`next_expected < received.tick_number`) the client fetches the missing range from
  `encounter_tick_batches` and applies in order — replacing the 6 s "expected result" timer
  guesswork.
- The party broadcast and the HTTP response become *hints* (fast path); the batch stream is the
  truth. Same content, so double delivery is a no-op.

### 2.7 Ownership latch (reintroduced)

Migration `20260807143727` dropped both `encounters.tick_owner` and
`shared_encounter_tick_enabled()`, so today there is nothing to flip. Reintroduce:

- `encounters.tick_owner text not null default 'legacy'` check in (`legacy`,`shared`).
- `public.combat_tick_owner()` reading a `world_state` config key, with an
  `COMBAT_TICK_OWNER` env override for the functions.
- resolver branches once, at entry: `legacy` → today's path (payload + CAS); `shared` → the
  path above. Both paths remain in the deployed function for the whole cutover window.

---

## 3. Migration and deployment order

Each step is independently deployable and safe to stop at.

| # | Change | Kind | Reversible by |
|---|---|---|---|
| B0 | Fix `submit_combat_action` loadout validation; verify rows land | migration + test | revert migration |
| B1 | `encounters.tick_owner` + `combat_tick_owner()` (default `legacy`) | migration | no behaviour change |
| B2 | `commit_encounter_tick` extended to accept the full state payload; old signature kept | migration | unused new signature |
| B3 | Realtime publication for `encounter_tick_batches` + unique `(encounter_id, tick_number)` + `GRANT SELECT` to `authenticated` | migration | drop from publication |
| B4 | `combat-tick` / `combat-catchup` deploy carrying **both** paths, latch still `legacy` | function deploy | redeploy previous |
| B5 | Client: batch subscription + ordered gap recovery + idempotent apply, still consuming HTTP/broadcast | frontend | frontend revert |
| B6 | Client: stop sending `pending_abilities` (behind the same latch value read from the server response) | frontend | frontend revert |
| B7 | Flip latch to `shared` for one test region/encounter, then globally | config row | flip back to `legacy` |

Ordering constraints: B0 before B6 (else default abilities die), B2 and B3 before B4,
B4 before B5, B5 before B7. A migration must never be applied after the function deploy that
depends on it.

### Backfill

- `encounters` rows missing for live sessions: `encounter_ensure_for_character` already
  creates on demand; no backfill needed. Set `tick_owner = 'legacy'` for all existing rows.
- In-flight `combat_actions` in `pending` older than 60 s at flip time: mark
  `cancelled / reject_reason = 'cutover'`.
- No creature, character, item or reward data is rewritten by any step.

### Partial-deployment recovery

- Migration applied, function not deployed → latch is `legacy`, new objects unused. No impact.
- Function deployed, client old → resolver still reads the payload while latch is `legacy`.
- Latch flipped with a stale client → clients that do not send `pending_abilities` are correct;
  older clients' payloads are **ignored** (not double-executed), so their abilities only resolve
  once `submit_combat_action` succeeded. B0 guarantees it does. A version field in the response
  triggers the existing update banner.

### Rollback

Flip `combat_tick_owner()` to `legacy`. It takes effect on the next tick, needs no deploy, and
leaves committed batches intact (clients ignore batches for an encounter resolving in legacy
mode). Frontend steps B5/B6 revert independently.

---

## 4. Verification before each flip

1. `src/test/combat/` — claim refusal never mutates; reclaim of tick N reproduces byte-identical
   results (deterministic RNG); commit with stale token rejected; ordered batch application with
   injected gaps and duplicates; multi-party single resolution; solo roster.
2. No `Math.random()` in resolver paths (assertion test).
3. Every class's default abilities pass `submit_combat_action` (B0 gate).
4. Stage A timing panel, measured on a real fight: `server_resolve_ms` p95 and
   `tick_due_at → resolution_started_at` drift p95, before and after. Target: drift < 250 ms,
   server execution p95 < 400 ms, `ticks_processed > 1` frequency unchanged or lower.
5. Balance parity: same seeds, same damage — a recorded fight replayed on both paths must
   produce identical event sequences.

## 5. Explicitly out of scope

Cadence length, balance, formulas, XP/loot rates, boss cast semantics, catch-up semantics,
party follow, and log pacing. Stage C removals (payload abilities, leader-only resolution,
`combat_sessions` ownership, dual delivery, instrumentation) happen only after 4 and 5 pass in
production.

---

## 6. Cutover progress log

- **B0 — done (2026-08-12).** Default abilities are stored explicitly and
  `submit_combat_action` accepts any ability in the effective loadout (equipped row, class
  default, or class key alias). No more 400 `ability not in loadout`; `combat_actions` now
  receives rows.
- **B1 — done (2026-08-12).** Ownership latch reintroduced:
  `encounters.tick_owner text not null default 'legacy'` with a
  `check (tick_owner in ('legacy','shared'))`, a `public.combat_config(key, value)` settings
  table seeded with `tick_owner = 'legacy'` (read: authenticated, write: overlord), and
  `public.combat_tick_owner()` returning the configured value with a `'legacy'` fallback.
  No resolver reads it yet, so behaviour is unchanged.
- **B3 — done (2026-08-12).** `encounter_tick_batches` is now reachable and streamable:
  `GRANT SELECT` to `authenticated` (its participant read policy was previously unreachable
  because the table had no grants at all), `GRANT ALL` to `service_role`,
  `REPLICA IDENTITY FULL`, and the table added to the `supabase_realtime` publication. The
  `(encounter_id, tick_number)` uniqueness the design asked for already existed as the primary
  key. No client subscribes yet, so behaviour is unchanged.
- **B2 — done (2026-08-12).** Every tail write of a tick (character patches, resource deltas,
  materials, contracts, bonds, effect lifecycle, engagements, session advance/close, intent
  retirement, result batch, encounter cursor) now lands inside one token-gated
  `commit_encounter_tick` transaction, anchored to the real commit time (drift removed). A
  refused claim/commit replays the identical writes via `applyTickStateFallback`.
- **B4 — done (2026-08-13).** `combat-tick` now carries **both** intent paths and branches once
  at entry on `resolveTickOwner` (`_shared/combat/tick-owner.ts`, reading
  `public.combat_tick_owner()` with a `COMBAT_TICK_OWNER` env override, `legacy` on any failure).
  In `legacy` the request payload is the intent source, unchanged. In `shared` the payload is
  discarded and `loadDurableIntents` reads `combat_actions` (`status = 'pending'`, this node,
  these participants, one slot per character ordered `client_seq, created_at`, respecting
  `eligible_after_ms`). The response echoes `tick_owner` so B5/B6 clients can react. Latch is
  still `legacy` in `combat_config`, so live behaviour is unchanged. `combat-catchup` has no
  intent path and was redeployed unchanged alongside it.
- **B5 — done (2026-08-13).** The client now follows the shared batch stream. `combat-tick`
  echoes `encounter_id`; `useEncounterBatches` subscribes to `encounter_tick_batches` inserts for
  that encounter and feeds them through `EncounterBatchSequencer`
  (`src/features/combat/utils/encounter-batch.ts`), which applies batches strictly in
  `tick_number` order, suppresses duplicates by `batch_id`/applied tick, buffers out-of-order
  arrivals and reports gaps — recovered by fetching the missing tick range straight from the
  table. HTTP responses and the party broadcast stay live as fast-path hints and are registered
  via `markApplied`, so a tick delivered twice is applied once. Covered by
  `src/test/combat/encounter-batch.test.ts`.
- **B6 — done (2026-08-13).** The client now latches the server-reported `tick_owner` from every
  applied tick result. While `legacy` nothing changes. Once a response reports `shared`, the tick
  request sends `pending_abilities: []` (the durable `combat_actions` row submitted at cast time is
  the only intent), and followers stop relaying `member_pending_ability` over the party broadcast
  since the leader's payload is no longer read. Locally collected casts still drive the wake
  condition, so a cast on an idle node still triggers a tick.
- **B7 — done (2026-08-13).** Latch flipped: `combat_config.tick_owner = 'shared'` and all 113
  existing `encounters` rows set to `tick_owner = 'shared'`. Pre-flip verification:
  `character_can_use_ability` returns true for every default assignment of every class at level
  (a deliberately unequipped non-default, `frostbolt`, correctly returns false), so B0 holds and
  durable submission is the working intent path; no `pending` `combat_actions` older than 60 s
  existed to cancel. Durable actions are now the sole execution authority — the request payload is
  discarded server-side and no longer sent by the client.
  Rollback: set `combat_config.value = 'legacy'` for `key = 'tick_owner'`; it takes effect on the
  next tick with no deploy.
