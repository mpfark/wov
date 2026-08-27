# Authoritative Boss-Cast State Machine

Replace the loosely coupled telegraph handling (timestamp predicates plus a per-target ID exception) with one explicit lifecycle owned by the resolver and durable state, and give departure/re-entry real semantics so a character who leaves and returns can never be caught by a cast that was aimed at their previous visit.

## What is wrong today

- A cast's eligibility is decided at resolution time from `joinedAtMs <= startedAtMs`, plus a special case that always re-admits the cast's own frozen primary target. A character who left the node and walked back in keeps the same participant row (intake preserves `joined_at`) and is still the frozen target, so the expired Granite Slam landed on their new visit 47 seconds later.
- Departure is engagement-only: the client calls `leave_encounter_engagements`, never anything that ends participation, so "who was here when the channel began" has no authoritative answer.
- The cast cooldown ledger lives only in per-tick working memory and is loaded as `0`, so a boss can resolve a cast and immediately start another on the same tick.
- A boss can act twice in one tick: resolve a cast (step 4) and, because `pausedByCast` is only set while channeling, also swing (step 5).

## The new lifecycle

One boss action per tick, per creature, in one place:

```text
Ready ──start──▶ Casting ──(due)──▶ Resolve ──▶ Recovering ──(readyAtMs)──▶ Ready
                    │
                    └── caster gone ──▶ Fizzle ──▶ Recovering
```

- Start, channel and resolve each mark the creature as having acted this tick. A creature that acted cannot also autoattack, and cannot start a second cast in the same tick.
- Recovery is durable, not in-memory: when a channel starts, the frozen contract stores `readyAtMs = resolvesAtMs + cooldownTicks * tickRateMs`. The snapshot exposes each creature's `castReadyAtMs` from its cast rows, so the gate survives restarts, catch-up and lease retries. Multi-tick runs also refresh the in-memory ledger on resolution.
- Membership is decided once, at cast start. The channel freezes the exact roster it can reach as `(characterId, participationGeneration)` pairs. At resolution a participant is eligible only if they are alive, present at the node, and still carry the generation frozen with the cast. No timestamps, no per-character exception.

## Participation generations and departure

- `encounter_participants` gains a `generation` column fed by a sequence. `encounter_intake` issues a new generation when a row is created or moves to a different encounter, and leaves it untouched for someone who never left.
- A new `encounter_leave_node(character_id, node_id)` RPC is the authoritative departure: it drops the character's engagements and their participant row for that node's encounter, cancels their pending actions and arms the effects catch-up for the node they left. Re-entry then goes through intake and receives a fresh generation.
- The client calls it exactly where a departure is already detected: the node-change teardown in the combat lifecycle hook, scoped to the node just left (this covers movement, flee and teleport). All other `stopCombat` reasons (party dissolution, death, follower timeout) keep today's behaviour and do not end participation.

## Technical changes

Database migration
- `encounter_participants.generation bigint` + sequence, backfilled for existing rows.
- `encounter_intake`: assign a new generation on insert or encounter change.
- New `public.encounter_leave_node(uuid, uuid)`, security definer, ownership-checked, granted to `authenticated` and `service_role`.
- `encounter_snapshot_v2`: participants expose `generation`; creatures expose `castReadyAtMs`, derived from the frozen `readyAtMs` on that creature's cast rows.

Shared combat code (mirrored to `supabase/functions/_shared/combat`)
- `pure/types.ts`: `ParticipantSnapshot.generation`, `CreatureSnapshot.castReadyAtMs`, `ActiveCastSnapshot.readyAtMs` and `frozenRoster`.
- `c3/decode-snapshot.ts`: decode the new keys; `decodeActiveCast` reads the frozen roster and recovery boundary from `payload.config`, with a documented legacy fallback for casts already in flight (roster absent → the old join fence, without the primary-target exception).
- `pure/resolver.ts`: single `bossActed` gate replacing `pausedByCast`; cooldown seeded from `castReadyAtMs`; roster frozen at start; eligibility from generations; recovery written back on resolve/fizzle.
- Commit payload already persists `config` verbatim, so no change to `commit_encounter_tick_v2` is needed.

Client
- `useCombatLifecycle` node-change teardown invokes the departure RPC for the previous node, through a callback wired in `useCombatDriver`.

## Verification

- New deterministic tests: resolve and start never share a tick; a resolved cast cannot restart until `readyAtMs`; a creature that acted does not autoattack; a character who leaves and re-enters mid-channel is excluded while a character who never left is hit; legacy in-flight casts still resolve.
- Existing combat suites must stay green, plus the shared-mirror identity test.
- Live check on one boss node after release: a single boss action per tick, correct exclusion on leave/re-enter, and no back-to-back casts.
