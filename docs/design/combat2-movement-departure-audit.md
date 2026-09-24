# Combat2 Movement and Departure Source Audit

Date: 2026-09-24. Baseline: `f1f8a0251c72d9d64dc46a25672cd124939f89e8`.

This is a static repository audit. It proves source contracts only. Installation and live behaviour remain governed by [project state](../operations/project-state.md). No Cloud inspection or gameplay invocation was performed.

## Finding

Ordinary out-of-combat adjacent movement is already an immediate authoritative database transaction. Combat-owned solo departure, coordinated party members in combat, and `combat_flee` are not immediate: they insert a pending event and return `queued`; a later world-heartbeat worker claim decodes the event, the resolver computes the exit opportunity/death outcome, and `node_tick_commit` applies fighter release, cleanup, relocation and MP charge atomically.

That differs from the approved rule in [the engine specification](game-engine.md). A safe source-only correction is not a small SQL wrapper change: exit opportunity mechanics and effects live in TypeScript, while the browser-callable RPC is PostgreSQL. Calling the worker from the RPC would introduce an Edge/network mutation into the transaction; duplicating resolution in SQL would create a second combat engine; relocating before the worker would bypass the established commit owner. The required immediate transition therefore needs an explicit architecture design that preserves one resolver and one commit boundary. No speculative migration was authored.

## Source-of-truth matrix

| Transition | Initiating surface / public RPC | Authoritative owner and lock order | Heartbeat wait | Exactly-once/retry | MP, exit and cleanup |
|---|---|---|---|---|---|
| Solo OOC adjacent move | `GamePage.authorizeCombat2Depart` → `useCombat2DepartureSession` → `combat2_depart` | request advisory → origin-node advisory → active encounter row (if any) → character row; underlying function in `20260905194227…sql` | No | `combat2_departure_request.request_id`; identical replay returns `already_moved`, changed reuse returns `request_id_conflict` | validates route/key/MP; guarded character update moves and charges once; no exit event; no fighter cleanup needed |
| Solo move while present fighter | same | same locks, then fighter row; it inserts departure/event, rejects pending intents, clears claim and makes encounter due | **Yes: returns `queued`** | request row + unique pending-event request + fighter `exit_request_id`; polling uses `combat2_departure_state` | resolver resolves opportunity at next tick; commit records `dead` without movement/charge or `moved` with one relocation/charge; resolver/commit owns fighter/effect/lifecycle cleanup |
| Explicit flee without destination | `useCombat2FleeSession` → `combat_flee` | encounter row → fighter row | **Yes: returns `queued`** | `node_pending_event.request_id`; identical replay reports queued/fled/dead, conflict fails | resolver owns opportunity/death and fighter release; no ordinary destination/MP transition |
| Party OOC move | party-aware adapter → `combat2_party_depart` | party-lifecycle advisory → request advisory → origin-node advisory → encounter → character UUID order → fighter UUID order | No when no member is combat-owned | parent request plus deterministic child request IDs; conflict/pending fail closed | followers ordered before leader; each guarded update charges/moves once; trigger finalizes parent |
| Party with combat-owned member(s) | same | same deterministic order; per-member fighter locks | **Yes for queued members** | parent/member rows plus deterministic child departure/event IDs | non-combat members are `waiting`; queued members resolve through tick/commit; finalizer then moves waiting survivors follower-first, leader last; dead/remaining outcomes preserved |
| State recovery | `combat2_departure_state`, `combat2_party_departure_state`; two-second client polling while pending | read-only owner-filtered projections | observes, does not advance | latest durable request/result | client never performs location/resource cleanup |
| Test Arena | same public movement path; `combat2_movement_scope_eligible` admits two active nodes in one active arena | same movement/departure owners; stop/reset separately finalize pending evidence | same as ordinary contract | same request/event fences | Test stop marks unconsumed events consumed for evidence integrity; it is not an alternate movement resolver |

## Concrete owners and data

- Public RPCs: `combat2_depart(uuid,uuid,uuid)`, `combat2_party_depart(uuid,uuid,uuid)`, `combat_flee(uuid,uuid,uuid)`, `combat2_departure_state(uuid)`, `combat2_party_departure_state(uuid)`.
- Internal/wrapped SQL: `combat2_depart_without_canary_gate`, `combat2_party_depart_without_canary_gate`, `combat2_movement_scope_eligible`, `combat2_party_departure_finalize`, `node_tick_claim`, `node_tick_commit` and their installed wrapper chain.
- Durable rows: `combat2_departure_request`, `combat2_party_departure_request`, `combat2_party_departure_member`, `node_pending_event`, `node_fighter`, `node_encounter`, `node_intent`, `node_effect`, `characters`.
- Guard: `combat2_guard_owned_location_write` prevents an authenticated browser location update from bypassing departure.
- Resolver/worker: `src/shared/combat2/resolver.ts` consumes `fighter_depart_requested`/`fighter_exit_requested`; `src/server/combat2/process-node-tick-once.ts` performs one claim/decode/resolve/commit.
- Frontend: `src/features/combat2/departure.ts`, `party-departure.ts`, `flee.ts`, their session hooks, `Combat2ClientSession.tsx`, `src/pages/GamePage.tsx`, and `src/features/world/hooks/useMovementActions.ts`.

## Locking and race findings

The repository comments claim departure's order matches entry's node advisory and commit's encounter-first order. Static source proves these behaviours, but it does **not** prove the installed composed function bodies have one globally checked lock graph; that needs executable-schema and installed inspection.

| Race | Current source result | Approved immediate-rule gap |
|---|---|---|
| Departure locks first | creates event, clears claim and increments version; an old claim cannot commit | fighter is not excluded until the replacement tick consumes the event |
| Tick locks first | departure blocks on encounter; the tick commits, then departure queues against new state | departure still needs another tick instead of resolving immediately afterward |
| Identical replay | returns durable queued/moved/dead result | safe |
| Changed request-ID reuse | returns conflict | safe |
| Death during exit | resolver proposes `dead`; commit does not relocate or charge MP | safe once tick runs |
| Insufficient MP / invalid destination | refused before event insertion | safe |
| Solo versus party | follower solo departure is refused; queued rows/unique children fence collisions | executable concurrency proof still needed |
| Encounter ends during submission | encounter/fighter re-read under lock; absent fighter takes OOC immediate path | installed behaviour needs verification |
| Late client response | session key/generation fences node/character/encounter changes | safe in focused client source |

The current commit boundary prevents duplicate MP, relocation, event consumption, fighter release, effect cleanup and encounter completion. It also means a combat departure deliberately waits for the next eligible tick. No catch-up loop exists in the worker; one invocation resolves at most one candidate tick.

## Related mutation boundaries

- `combat_enter` uses the node advisory, then encounter and fighter locks. `combat2_engage` composes entry/intent authority.
- `combat_intent` writes only a pending intention inside the authoritative cutoff/fence; final success belongs to the claimed snapshot.
- `combat2_respawn`, special transitions, arena stop/reset and party lifecycle each have separate guards. Their source contracts must be included in the lock-graph design before `ENG-MOVE-001` leaves `blocked`.
- Settlement locks its singleton cursor, then characters in UUID order and deliberately locks no encounter; it re-reads encounter/departure ownership after the character lock. This avoids adding a reversed encounter/character pair.

## Required next design

`ENG-MOVE-001` must choose a single server-side orchestration boundary capable of invoking the existing deterministic resolver and atomic commit synchronously after acquiring the same serialized ownership. It must define one lock order across claim/commit, entry, intent, solo/party departure, flee, respawn, arena lifecycle, party mutation and settlement. It may not duplicate resolver rules in SQL, call back into Edge from a database transaction, or expose service credentials to the browser.

