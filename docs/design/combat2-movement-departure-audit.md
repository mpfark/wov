# Combat2 Movement and Departure Source Audit

Date: 2026-09-24. Baseline: `f1f8a0251c72d9d64dc46a25672cd124939f89e8`.

This is a static repository audit. It proves source contracts only. Installation and live behaviour remain governed by [project state](../operations/project-state.md). No Cloud inspection or gameplay invocation was performed.

## Authoritative client reconciliation correction (2026-09-30)

Mik reported that a successful move appeared roughly two seconds late and that a quick following move could be refused as `invalid_destination`. Source tracing proved one shared client ordering defect rather than a heartbeat or server-movement defect. Direction buttons, the minimap, typed movement and keyboard movement all route through `GamePage.authorizeCombat2Depart` to `useCombat2DepartureSession`. The RPC committed relocation immediately, but the success path only wrote a log line: it neither projected the response's authoritative `destination_node_id` nor requested a focused character/party refresh. The visible character and `currentNode.connections` therefore remained at the origin until an unrelated Realtime or periodic delivery updated them. A second input during that window selected an origin connection that was stale relative to the server, so the server correctly refused it.

The frontend now projects only a successful `moved`/`already_moved` response's server-authored destination, then refreshes character and party state. It does not predict movement before acknowledgement and performs no browser database write. The departure fence stays single-flight through this handoff; the known reconciled destination does not pessimistically wait on another state read, while late RPC/state responses remain fenced by character/node generation. Recovered queued movement also projects its terminal authoritative destination if Realtime delivery is absent. Node identity, content and connections rebuild together from the new `character.current_node_id`; refusals, death and uncertain transport never move the display.

Diagnostic session `77253087-e3f0-4cf5-a83a-998c664472bd` (20:27:21–20:28:06 UTC) contained ten Combat2 commits, encounter ticks 1891–1900, correlated with heartbeats 11319–11328 at the intended approximate two-second cadence and no claim/commit refusals. It contained no movement request/response events, so it proves healthy combat cadence only; it neither proves nor disproves movement latency. No SQL, scheduler, heartbeat or gameplay contract changed in this correction.

### Pending-state and presentation race correction (2026-10-01)

Mik subsequently operator-reported that the published reconciliation reaches the destination without the former fixed wait, while an occasional “Movement is being finalized…” state and location flicker remained. Source tracing found frontend races, not delayed server movement. `GamePage` and `Combat2ClientSession` each owned a separate `useCombat2DepartureSession`; the latter treated every recovery read as movement pending, so ordinary node/session attachment could display a false finalizing state. A character refresh begun after one acknowledged move could also resolve after a later move and overwrite the newer projected node. Party refreshes had the same out-of-order-apply risk, and stale party-member rows could briefly route a rapid second leader move through the solo adapter.

The client now has one departure lifecycle. Recovery is fail-closed but distinct from genuine in-flight/queued movement; a reconciled authoritative destination does not reopen recovery from stale durable state. Character and party reads use generation/revision fences, authoritative moved party-member identities bridge only the refresh interval, and node/character/session changes discard late results. Pointer, map, keyboard and command movement share the same pending/recovery input guard, so rerenders or rapid duplicate input cannot create another request or a misleading duplicate log line. Terminal `moved`, `already_moved`, `dead`, refusal and conflict outcomes cannot be reopened by an older read. A later fresh read can still report a genuine external relocation.

This remains presentation and client orchestration only: the browser does not predict a destination, write location or MP, add a cooldown, wait for a heartbeat, or reinterpret the server result. Mik's report verifies the prior solo visible-destination improvement only. Coordinated party movement, multiplayer races and this latest frontend correction still require manual publication and bounded live verification.

### Keyboard-only input delay correction (2026-10-01)

After publishing the preceding correction, Mik operator-reported immediate, error-free minimap movement but noticeable keyboard delay. The two paths already converged at `GamePage.handleMovementInput`; no delay exists in the authoritative departure adapter or RPC submission. The remaining difference was an older 500 ms local cooldown in `useKeyboardMovement`: it invoked the first move synchronously, then silently discarded a subsequent deliberate key press until the timer expired, even if the first authoritative move had already completed and the new origin was rendered. The minimap had no corresponding timer. Git history traces the cooldown to commit `fc3c9d6e` (2026-02-24), whose only recorded rationale was “Movement cooldown — prevent spam”; no follower or party contract used it.

The obsolete timer is removed. A non-repeat movement keydown now calls the same shared router immediately. Native held-key repeat events are explicitly ignored, so removing the timer does not create automatic walking, queue destinations or replay an old connection. The shared departure lifecycle remains the single-flight owner and continues to fence pending/recovery, authoritative origin and destination, uncertain retry UUIDs, stale responses, character/session changes and coordinated party routing. Input, textarea, select and modal exclusions are unchanged. This is a frontend input correction only; server movement, MP, keys, adjacency, ownership, party order and heartbeat behavior are unchanged. Manual publication and bounded keyboard/party verification remain pending.

## Implemented source correction (ENG-MOVE-001)

Forward migration `20260929100000_combat2_immediate_authoritative_departure.sql` replaces the heartbeat wait at the public boundary without copying resolver mechanics. The first authored bytes (`09a497b9bf8aae7f7238162eb4478708eb26c2ccb76cce4d6419bbb01e28f544`) were rejected before installation because the preserved party predecessor locked the leader before followers, creating a real character-row cycle with UUID-ordered resource settlement. The corrected bytes (`9e8a24982a6dae443d18811362f65a04f45d873ea399ddcb394c134a3e6d24f4`) freeze the authoritative mover UUID set under the party-lifecycle boundary, lock the origin/destination encounter pair by UUID, lock the whole mover set by `characters.id ASC`, revalidate, and only then retain the independent follower `joined_at`, UUID tie-breaker, leader-last movement order. Settlement is unchanged.

The installed predecessor remains the owner of caller identity, route/key/MP validation, party membership/order and durable request creation. When that predecessor returns `queued`, one service-role-only finalizer in the same transaction fences the claim, rejects pending intents, consumes the departure event, removes only character-targeted encounter state, marks the fighter absent, refreshes tanks, moves the character and charges MP once. It performs no damage, attack, DoT pulse, regeneration, reward, durability or death resolution.

Public node locks remain first and destination arrival remains the installed character-relocation trigger. A departure-first transaction invalidates the origin claim/version before relocation. A tick-first transaction commits under the same node/encounter serialization; departure then revalidates current HP, location and participation. Party finalization owns all members in stored `movement_order`, so followers arrive before the leader. Historical queued rows remain readable and can be completed by replay. The old destination-less `combat_flee` signature is retained as an explicit `destination_required` refusal; it cannot safely express relocation, and all ordinary browser movement already routes through `combat2_depart`.

Source verification is not installation or live proof. Local PostgreSQL installed-equivalent execution was unavailable; Lovable must compile/apply and inspect the composed definitions before activation.

## Corrected lock graph

| Boundary | Effective order | Cycle result |
|---|---|---|
| Solo departure | sorted origin/destination node advisory → origin encounter → character → fighter/effect/request | Compatible with commit and arrival; one character only. |
| Coordinated departure | sorted node advisory → party-lifecycle/request advisory → origin encounter → frozen mover characters by UUID → per-fighter/effect/request; relocation remains follower `joined_at`, UUID, leader last | Corrected: no leader/follower or follower/follower reversal against settlement. |
| Resource settlement | settlement cursor → all characters by UUID; later ownership reads take no encounter row lock | Unchanged; identical character order removes the proven cycle. |
| Intent / hostile initiation | node advisory where applicable → encounter → intent advisory → character/fighter/intent | Departure's node/encounter serialization prevents a character/intent reversal; stale intent is rejected after the departure fence. |
| Claim / commit | node advisory wrapper → encounter; commit locks proposed characters by UUID before character mutations | Party and commit share node/encounter serialization and UUID character order. |
| Party follow/leave/kick/disband | global party-lifecycle advisory before membership mutation | Serializes mover-set derivation; no membership row can change the frozen set concurrently. |
| Death / respawn | request/transition fencing and character-owned mutation | UUID mover locks force revalidation after an earlier death/respawn; a dead or relocated included mover aborts all movement. No reversed multi-character pair exists. |
| Test Arena stop/reset | arena advisory → encounters by UUID, then arena cleanup/character restore | Solo and party departure now pre-lock origin/destination encounters by UUID before characters, removing the reset encounter→character versus arrival character→destination-encounter cycle. Installed concurrent proof remains pending. |
| Two party departures | sorted node pair plus global party-lifecycle advisory, then UUID mover locks | Same/opposite routes and overlapping sets serialize before character mutation. |
| Destination arrival | sorted node pair already held → destination arrival trigger/encounter → relocated character (already held) | Opposite-direction node pairs cannot reverse; arrival order remains followers first, leader last. |

Static/source and model verification found no remaining reversed character pair or origin/destination-node pair. PostgreSQL concurrent execution, installed function metadata and live races remain explicit Lovable gates.

## Prior audited state (superseded by the source correction above)

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

## Verification remaining

Lovable must execute the migration against the installed schema, inspect owner/SECURITY/search-path/ACL preservation, and prove departure-first and tick-first serialization with rollback-only or disposable fixtures before gameplay activation. Bounded solo and coordinated-party live verification remains separate. No Edge deployment is required by this source change.

## 2026-10-01 equipment-fence follow-up

Lovable's read-only investigation found a separate post-departure defect at node `f974068d-c8e6-4224-a3c9-d7b066ae1b8d` / encounter `ca32f2fb-7d4c-4504-b889-ef5cd0e3d8c8`: the encounter was active at tick 48, claims continued, and commits repeatedly refused `stale_equipment`. Historical absent fighters owned current equipped rows. The installed claim projected those rows for every historical `node_fighter`, the resolver fenced them, and commit correctly required every fenced owner to be present. Reported node prefixes `f45a8b21` and `f7c5881a` show the same refusal; their complete identities are not known and must not be invented. These observations are attributed to Lovable, not rechecked by this source task.

The authored correction defines the dependency at the claim boundary: only claim-present fighters contribute current equipment. They remain fenced even when the same resolution kills or departs them. Historical fighters, entry generations, qualification records and already-frozen offscreen-effect attribution remain; absent fighters' mutable off-node equipment is excluded. Existing commit completeness and value checks continue to reject changed, forged or omitted loadouts for claim-present fighters. Source tests pass; PostgreSQL compilation, installation and automatic recovery of the reported encounters remain pending. Recovery may legitimately consume pending events, advance combat and award already-qualified outcomes; it is not expected to preserve all gameplay rows unchanged.
