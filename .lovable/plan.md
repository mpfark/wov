# Post–Stage C shared-encounter audit and staged correction plan

Verified against repository HEAD, deployed database objects (`pg_get_functiondef`), live rows and configuration. The progress log was not used as evidence. Edge Function logs are empty (retention expired; world asleep ~6h), so all frequency claims are marked unverifiable.

## Actual current tick flow (`supabase/functions/combat-tick/index.ts`, 3979 lines)

```text
read durable combat_actions (L184-298)      -> intent
stale-session repair, session create (L299-336)
elapsed/ticks from session.last_tick_at (L450-452)
SESSION CAS reservation (L461-477)          <- the real mutex today
roster: session + party + engagements (L390-531)
parallel reads: equipment, creatures, effects, boosts (L532-542)
simulation, Math.random rolls (L600-3200)
stored power RPCs (L2772, L3078, L3094)
boss cast create/resolve (L2816-3130)
node broadcasts (L3182-3190)
session last_tick_at recompute (L3196-3214)
writeCreatureState: creature HP + death (L3215)
equipment durability + unequip (L3510-3536)
loot / kill rewards prep (L944-1051, L3580+)
king/prince world broadcasts (L3693-3736)
encounter lookup (L3845-3854)
claim_encounter_tick (L3860)                <- claim happens HERE, last
commit_encounter_tick (L3876)               <- tail writes + batch + cursor
applyTickStateFallback on ANY refusal (L3924-3944)
```

`combat-catchup` is the opposite: it claims first (L218), interprets (L234), then writes (L481) and commits.

### Answers to the direct questions

- `claim_encounter_tick` does **not** succeed before authoritative mutation. Simulation, creature HP, death, durability, loot, stored power, boss casts and broadcasts all precede it.
- `combat_sessions.last_tick_at` CAS is the operative mutex. Two sessions on the same node each pass their own CAS, so two simulations can resolve the same creature in one wall-clock window; the creature acts once **per surviving session**, not once per shared tick.
- The shared encounter tick is currently a **post-resolution publication cursor**, not an owner. A refused claim mutates nothing only because everything already mutated.

## Mutation boundary table (one ordinary/ability/kill/boss/multi-creature tick)

| Mutation | Boundary |
| --- | --- |
| `combat_sessions.last_tick_at` CAS | Before (pre-simulation) |
| Creature HP / `is_alive` (`writeCreatureState`) | Before |
| Equipment durability, unequip on break | Before |
| Loot rows, unique drop processing | Before |
| Stored Power add/set_cap | Before |
| `encounter_cast_events` boss casts | Before |
| Node/world broadcasts | Before (best-effort, non-authoritative) |
| Character patches (xp, gold, level, RP), hp/cp/mp deltas | Inside commit |
| Materials, contracts, class bond | Inside commit |
| `active_effects` delete/upsert | Inside commit |
| Engagement join/purge, session advance/close | Inside commit |
| `combat_actions` retirement, result batch, encounter cursor | Inside commit |

Consequences confirmed: a crash after `writeCreatureState` leaves creature HP and durability/loot changed with no rewards and no batch; a refused commit still leaves creature/durability/loot changes; a committed batch can therefore describe state that was not committed with it. "Atomic tick" today means the tail only.

## Verdicts

1. **Shared claim after simulation — Confirmed.** L3860 vs L461-477/L3215.
2. **Atomic commit covers only tail writes — Confirmed.** Table above.
3. **Refused-commit fallback violates exclusivity — Confirmed (structural).** L3924 runs `applyTickStateFallback` for every reason including `already_committed` and `stale_claim`, then force-retires durable actions (L3933-3943). Sequence A commits tick N, B refused, B replays its own character patches, hp/cp/mp deltas, xp/gold, materials, bonds, contracts, effects and session advance — duplicate rewards and resource deltas are possible. Frequency: **unable to verify** (no logs). Severity: high.
4. **Deterministic resolution incomplete — Confirmed.** `_shared/combat/tick-rng.ts` is imported by no resolver (only tests). Raw `Math.random()` in authoritative decisions: L1820 status sample, L1836 on-hit effect, L1890 anti-crit, L1901 dodge, L1927 block, L2200 status, L2436 proc, L2610 proc/effect chance, L3006 boss cast chance, L3527 durability slot pick. A reclaimed tick cannot replay identically.
5. **Roster still session-oriented — Confirmed.** Roster derives from `combat_sessions` + invoking character's party + engagements (L390-531); `encounter_participants` / `encounter_creatures` are not the resolution roster. `encounter_participants` currently holds 1 row against 113 encounters.
6. **Stage C removed rollback early — Confirmed (documentation overstatement).** `combat_tick_owner()` still exists and `combat_config.tick_owner = 'shared'`, but no code reads either; `encounters.tick_owner` still defaults to `legacy` (4 live rows are `legacy`) and is unread. Flipping config changes nothing. The legacy path was removed before pre-simulation ownership, full atomicity and deterministic retry existed.
7. **Batches are delivery, not resolution authority — Partially confirmed.** Sequencer ordering/dedup is sound. Real defects: RLS on `encounter_tick_batches` requires an `encounter_participants` row (near-empty today, so recovery and follower delivery can silently fail); first-batch re-anchor (`encounter-batch.ts` L106-108) can skip recoverable ticks; `MAX_BUFFER` overflow drops rows with no reconciliation (L126-131); a gap-recovery request suppressed by `recoveringRef` (`useEncounterBatches.ts` L50-51) is never retried; 60s retention (`commit_encounter_tick`) is short for backgrounded mobile clients.
8. **Cadence/drift claim — Partially confirmed.** Live simulation is gated by `session.last_tick_at` on a fixed 2s grid (L450-477); the encounter cursor is anchored to commit time. The two cadences can disagree, the session CAS can permit a simulation the encounter claim later refuses, and only the encounter cursor gained the anti-drift fix, which also makes the encounter-side interval 2s + server execution time.

Additional issues found: the encounter lookup picks the newest active encounter at the node regardless of the creatures simulated; `claim_encounter_tick` derives `live` mode from session freshness, so the writer model is inferred from the very session authority we intend to retire; the fallback's blanket `combat_actions` retirement can consume intent whose effects were never committed.

## Risk ranking

1. Fallback double-mutation after `already_committed`/`stale_claim` (high severity, unknown likelihood, duplicate rewards).
2. Non-atomic creature/loot/durability writes (high severity, occurs on any crash or refusal).
3. Post-simulation claim / dual-session creature resolution (high severity, needs two sessions at one node).
4. Non-deterministic retry (medium; makes reclaim unsafe).
5. No operational rollback control (medium).
6. Delivery/RLS/recovery gaps (medium-low).

## Staged recovery plan (not implemented)

**R0 — containment (recommended before further live combat).** Make refusal non-mutating: in `combat-tick` delete the `applyTickStateFallback` call and the fallback action retirement (L3924-3944), keep the refusal log with the reason, and return the unchanged HTTP payload with `encounter_tick: null` so clients await the committed batch. Add a `combat_config` kill switch read at request entry (`tick_paused`) that returns an idle response without simulating, pinned per encounter for its lifetime. No migration required beyond a config row read; rollback is deleting the read.

**R1 — pre-simulation ownership.** Move the encounter lookup and `claim_encounter_tick` to immediately after intent load, before any read used for resolution; refuse ⇒ return idle, mutate nothing. Replace the `combat_sessions` CAS with the claim. Build the roster from `encounter_participants` + `encounter_engagements` + `encounter_creatures` and resolve every engaged creature once. Change `claim_encounter_tick` mode derivation to engagement freshness rather than session freshness, and coordinate catch-up through the same claim (it already does).

**R2 — one transaction boundary.** Extend `commit_encounter_tick` to accept creature HP/death, durability and unequip, loot/ground-loot rows, stored power and boss-cast state, plus the existing tail. `writeCreatureState` becomes payload accumulation. Broadcasts become post-commit, idempotent, keyed by `(encounter_id, tick_number)`.

**R3 — deterministic retry.** Wire `tick-rng.ts` into both resolvers seeded by `encounter_id + tick_number + stream + actor/target id + roll index`, replacing every `Math.random()` listed above while preserving draw order and probabilities. Requires your approval where stabilising iteration order could shift outcomes.

**R4 — delivery hardening.** Guarantee an `encounter_participants` row for every participant (and a grace window after leaving) so RLS permits recovery; retry suppressed gap recoveries; reconcile on buffer overflow instead of dropping; raise batch retention to ~180s.

**R5 — cleanup and docs.** Remove session-based authority, redefine `tick_owner` objects as the kill switch, rewrite `docs/design/shared-encounter-cutover.md` to describe real behaviour, keep the timing panel until before/after validation.

Each stage deploys alone: R0 and R1 are Edge-Function-only and old clients stay compatible (they already consume batches); R2 needs the migration first, then the function; R3/R4 are independent. Every stage's rollback is a function revert, since no stage changes stored shapes destructively.

## Tests

Automated: claim refusal mutates nothing; stale token; `already_committed`; lease expiry and reclaim byte-identical replay; crash injected before/during/after commit; same tick resolved twice; creature HP + death + rewards + batch atomicity; durability/loot idempotency; deterministic RNG parity vectors; sequencer re-anchor, buffer overflow, suppressed recovery retry.

Controlled manual: one player one creature; one player multi-creature; one party; two parties sharing a creature; solo plus party sharing a creature; party joining an active encounter; live overlapping catch-up; offscreen DoT death; Consecrate; boss telegraph and Stored Power; duplicate HTTP/realtime/broadcast; missing realtime; mobile background >60s; world sleep/wake; deploy during an active encounter; kill switch during an active encounter.

## Needs your decision

- Approve R0 before further live combat testing (this is the one correctness fix I would not defer).
- Approve R3's possible micro-changes in roll ordering when RNG becomes deterministic.
- Confirm the kill switch is acceptable as the rollback mechanism instead of restoring any legacy path.
