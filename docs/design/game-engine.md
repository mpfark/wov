# Wayfarers of Varneth — Authoritative Game Engine Specification

This is the canonical description of intended game-engine behaviour. Code and installed Cloud state may temporarily lag behind it. [Project state](../operations/project-state.md) records operational evidence; the [engine roadmap](../roadmap/game-engine-roadmap.md) records unfinished work. Contradictions must be reported, not silently resolved. A task that changes an engine rule must update this specification in the same commit. Speculative ideas must never be labelled implemented.

## Information layers

| Layer | Authority | Must not become |
|---|---|---|
| This specification | Stable rules and target architecture | A deployment log |
| Engine roadmap | Planned, pending, blocked and unresolved engine work | A second rules source |
| Project state | Installation, release and verification evidence | A statement of intended design |
| Admin Roadmap/Game Manual | A presentation/filtering layer over versioned information | Separately maintained truth |

The Admin Roadmap currently reads and mutates `roadmap_items` directly in `src/components/admin/RoadmapManager.tsx`. The Admin Game Manual is mostly hard-coded React prose in `src/components/admin/GameManual.tsx`, with selected imported configuration and live counts. Neither is canonical. Integration is deferred to `ENG-ADMIN-001` and `ENG-MANUAL-001`.

## Engine principles and authority

- Gameplay is server-authoritative. Clients submit intentions and render authoritative results.
- Browsers never author persistent HP, CP, MP, position, damage, rewards or effects.
- Resolution is deterministic from a claimed snapshot. Durable request IDs, idempotency, atomic commits and stale-state fences prevent duplicate damage, costs, movement, rewards and effects.
- Validation fails closed. Retries and catch-up are bounded.
- Ordinary gameplay and Test Arena use the same engine unless an explicit isolation boundary is documented.
- Maintenance, world sleep or scheduler absence stops progression and must not create unbounded banked work.
- Presentation state is evidence, not ownership.

The engine keeps these concepts distinct:

| State | Meaning and authority |
|---|---|
| World | sleep/awake, combat mode and scheduler eligibility |
| Heartbeat | authoritative opportunity to process due world work |
| Node | location, visible creatures, movement topology and due encounters |
| Encounter | local committed tick, claim, participants, creatures, intents and effects |
| Character | resources, position, inventory, equipment and durable lifecycle state |
| Presentation | a client projection that may be loading, live, stale or historical |

## One authoritative world heartbeat

The world has one authoritative heartbeat. Its intended base cadence is two seconds. Combat does not own an independent wall-clock timer. Active encounters are processed on heartbeat boundaries; out-of-combat resource settlement runs every second heartbeat, for a four-second cadence. Future systems attach through deterministic divisors/phases, not competing timers. A heartbeat processes only eligible due work, not every node or creature. Maintenance, sleep and scheduler absence halt heartbeat work.

> No gameplay mechanic may introduce an independent wall-clock loop when it can be resolved deterministically on the authoritative world heartbeat. Any exception must be explicit and documented.

```text
world heartbeat       H(n) -------- H(n+1) -------- H(n+2)
due encounter work       claim/resolve/commit          ...
OOC settlement           phase (every second heartbeat)
client intention      accepted/refused now -> resolves at next eligible H
encounter tick        local k commits      -> local k+1 (only on commit)
```

Target behaviour: selecting a target or submitting an attack is accepted or refused immediately, while its outcome waits for the next eligible heartbeat. Normal latency may approach one heartbeat. The UI may show queued/prepared state but may not fabricate a result. Each encounter begins and advances its own local successful-commit sequence; a failed commit does not advance it and a new encounter may start at tick one regardless of global heartbeat number.

Current implementation is semantically close to the target: `combat2_dispatch_scheduler_fire()` is scheduled at two seconds, settlement is phase-gated to four-second buckets, and the dispatcher discovers only due encounters before bounded sequential worker calls. Encounter cadence is stored in encounter-local `next_due_at`/tick state. Settlement uses its own locked cursor. There is no second browser combat loop in the authoritative path. The remaining gap is explicit global heartbeat identity shared by settlement, dispatch and diagnostics; today local encounter ticks and the settlement cursor can obscure which world boundary caused work. See `ENG-HB-001` and `ENG-DIAG-002`.

Sources: `supabase/migrations/20260923100000_authoritative_ooc_resource_settlement.sql`, `src/server/combat2/dispatch-node-ticks-once.ts`, `supabase/functions/combat2-dispatch-once/index.ts`.

## Character ownership and lifecycle

| State | Resource/effect owner | Position/participation/reward owner |
|---|---|---|
| Ordinary out of combat | world settlement owns HP/CP/MP; durable character/equipment state owns effects | movement RPC owns position; no active participation |
| Peaceful co-location | same as out of combat until deliberate engagement | node presence only; no Combat2 ownership |
| Queued deliberate or automatic aggressive entry | entry/engagement RPC and next claimed tick | encounter/fighter creation is authoritative |
| Active Combat2 | resolver/commit owns HP/CP, effects, stances and reward proposals; departure owns MP charge | encounter owns participation; movement is fenced/queued |
| Movement pending | current owner remains until atomic departure finalizes | departure request/party request owns transition |
| Absent/departed fighter | no longer Combat2 resource-owned | historical fighter row remains; position is final destination |
| Encounter completed | world settlement becomes eligible for surviving released fighters | encounter/fighter history remains; rewards materialize exactly once |
| Dead | death/respawn contract owns resources and locks intentions | respawn RPC owns relocation/recovery |
| Test Arena | same resolver; explicit arena lifecycle/admin isolation | arena RPCs own setup, reset and stop |
| Offline/inactive | ordinary authoritative rows remain | no return-home rule yet (`ENG-LIFECYCLE-001`) |

Verified lifecycle rule: combat owns a present fighter; after the creature dies and the encounter completes, the surviving fighter is released while historical rows remain. World settlement then becomes eligible, HP/CP/MP regeneration resumes, and movement becomes possible once MP is sufficient. Only **present** fighters may be excluded by a live encounter claim; historical absent fighters must not remain Combat2-owned. The predicate is implemented by `20260924100000_combat2_post_completion_settlement_ownership.sql`.

Mik has operator-reported successful automatic aggressive and deliberate peaceful completion, release, death/reward presentation, resumed HP/CP/MP regeneration, restored movement and delivery without tab switching. This is operator evidence, not direct repository-agent Cloud verification; detailed evidence belongs in project state.

## Resources and attributes

Canonical source formulas are in `src/shared/formulas/resources.ts`; authoritative settlement is in `20260923100000_authoritative_ooc_resource_settlement.sql`.

| Resource | Capacity and regeneration | Owner/cadence | Exclusions and status |
|---|---|---|---|
| HP | max = class base + `2 × CON modifier + 5 × (level-1)`, plus valid equipped HP; OOC regen = `2 + floor(sqrt(max(0,effective CON-10)))`, gear regen, HP milestone and Inn +10 | OOC settlement every four seconds; Combat2 commit while active | no passive HP in combat; excludes dead, arena, departures, fresh respawn and active present ownership; installed and operator-reported live |
| CP | max = `30 + 3 × (level-1) + 3 × (max(INT mod,0)+max(WIS mod,0))`; Combat2 regen = effective-WIS regen plus CP milestone | OOC settlement every four seconds; Combat2 on every even candidate tick | CP reservation reduces spendable CP without changing persisted total; no double award; installed and operator-reported live |
| MP | max = `100 + 10 × max(DEX mod,0) + floor(2 × (level-1))`; canonical base rate = `round((5+DEX mod)×0.67)` and four-second settlement applies two base intervals plus Inn | OOC settlement; authoritative departure charges movement | no passive MP in combat; installed and operator-reported live |

Effective attributes include only valid equipped durable gear. Gems contribute emerald/CON, sapphire/INT, pearl/WIS and topaz/DEX. Defensive resource caps are HP 10,000, CP 5,000 and MP 5,000. HP milestones are 2/4/6/8/10 and CP milestones 1/2/3/4/5 at levels 20/25/30/35/40. Inspire is a separate Combat2 effect, not passive CP regeneration. Browser-local food is excluded until amount and expiry are authoritative persistent state (`ENG-FOOD-001`). Settlement advances a locked cursor by at most three short catch-up buckets and only one after long downtime; downtime is not banked without bound.

Movement cost is computed and charged atomically by the departure RPC from authoritative route/character state; the client only presents the returned cost. Death/respawn resources are owned by the respawn contract, not client recovery code.

## Creatures, targeting and initiation

Visible node creatures are a location projection. Peaceful co-location does not itself create Combat2 ownership; a deliberate authoritative engage is required. Living aggressive creatures may cause automatic entry. Engaged encounter creatures, not browser list order, define viable combat targets. Client target/session responses are fenced by node, character, encounter and creature identity.

A basic attack or supported ability intention occupies the character's action slot for the claimed tick. Server-owned autoattack selects the first living engaged spawn by stable runtime ordering when no captured intent owns that slot. Target death causes authoritative retargeting to the next eligible engaged creature; encounter completion occurs only when no living engaged creature and no lifecycle-preserving durable effect remains.

Fighter entry, tank candidates and shared encounters are snapshot authority. Current tank is chosen at resolution, allowing party/member changes to be reflected deterministically. Targeting and combat initiation still require focused audit (`ENG-COMBAT-001`), specifically:

- when target selection becomes authoritative;
- whether Attack both engages and queues the first basic attack;
- how selected, queued, engaged and dead are distinguished in UI;
- how target changes near a heartbeat are fenced;
- first-hit ordering for multiple characters;
- expected one-heartbeat delay versus abnormal intermittent latency.

## Combat resolution

`src/server/combat2/process-node-tick-once.ts` performs exactly one `claimNode → strict decode → player catalogue → captured boss catalogue → resolveNodeTick → commit` chain. It neither re-reads mutable combat state after claim nor retries a commit. `src/shared/combat2/resolver.ts` is a pure function: no IO, wall clock or ambient randomness. RNG streams are seeded from claim-fenced encounter/tick identities.

The resolver's effective order is:

1. Decode the frozen snapshot and build working characters/creatures, derived equipment/caps and durable qualification state.
2. Fold out-of-tick pending transitions into this commit batch; expire/tick effects and DoTs; apply encounter-local passive CP on even candidate ticks; resolve claimed entry/exit opportunity events.
3. Consume every intent within the claim cutoff exactly once, including refusals. Validate presence, target, costs, reservations and ability contract; apply player action effects/damage/healing.
4. Maintain or execute the server-owned autoattack action slot; resolve stance-owned Ignite after player actions.
5. Resolve creature actions: due telegraph first, otherwise deterministic available boss-cast selection/wind-up, otherwise ordinary attack. Starting, continuing or resolving a cast replaces the basic creature attack.
6. Apply mitigation, absorbs and reactions in the damage pipeline; reactive retaliation cannot create duplicate death/reward.
7. Resolve creature/player deaths, durable per-spawn reward qualification, XP/gold/salvage/item proposals, and equipped-item durability loss.
8. Persist effect/autoattack cleanup and finish encounter lifecycle/release decisions.

The commit RPC validates frozen fields, consumes intentions/events, applies resources/effects/deaths/durability/rewards and advances the local tick atomically. Claim leases, state versions, cutoff sequences and request ledgers fence stale work. A rejected or transport-uncertain proposal cannot be treated as committed.

## Effects and stances

- Transient effects expire/tick inside the encounter resolver.
- Persistent effects need explicit durable ownership and lifecycle rules.
- A CP reservation is an authoritative reservation effect; spendable CP is total CP minus active reservations.
- Current stances are encounter-scoped intents/effects. Desired character-scoped stances, including safe activation outside combat and persistence across movement/encounters, are not implemented (`ENG-STANCE-001`, `ENG-STANCE-002`).
- Presentation may group multiple authoritative rows into one semantic stance but cannot merge their mechanics.

Holy Shield currently consists of a retaliation effect plus its reservation effect and is presented as one semantic stance. Repeated activation is refused. Dropping a stance removes the reservation and does not refund the original activation cost.

## Movement and party movement

Solo movement validates caller ownership, origin, destination, connection visibility/adjacency, locks/keys, lifecycle fences and MP, then charges and moves atomically under a durable request ID. During combat, departure is queued/finalized through the encounter boundary; reconnect state comes from the departure projection. Replays return the durable outcome and conflicting/stale requests fail closed.

Coordinated party movement snapshots eligible followers and moves followers before the leader, leader last. Each member has its own survival/result outcome; dead, off-node or non-following members remain independent. Party request/member rows preserve the group transition and stable order. Sources: `20260905194227_fbe2e172-650d-43c2-a3d2-b6dff0c3210a.sql`, `20260908122530_e728cbda-72d0-415c-96bf-a8758fe327ac.sql`, `src/features/combat2/departure.ts`, and `src/features/combat2/party-departure.ts`.

Source and installation evidence exists for solo and party contracts; ordinary solo movement is operator-observed. Coordinated party release/live behaviour remains verification work, not inferred from Git (`ENG-PARTY-001`).

## Rewards and unique items

Gold, salvage and item selection are independent reward channels unless a source explicitly excludes another. Item-source selection must be exclusive: world pool, assigned relational table or unique boss drop—never silent fallback between them. Reward qualification is durable per creature spawn and per recipient; proposals and materialization are exactly once.

World-pool eligibility and weights come from item catalogue fields. Assigned tables use relational loot tables/entries. Unique boss drops require immutable global unique-instance identity across physical holding surfaces. Ground loot and pickup are authoritative transfer boundaries. The pending `20260915200000_combat2_authoritative_reward_channels.sql` and related ADM-025B source are **not installed**; project state is authoritative for its operational status.

Unresolved authoring decisions remain explicit: King Aldric's key plus weapon and multiple unique candidates on one creature; Rusty Key as gate access rather than a global unique; and safe authoring of mutually exclusive sources with no fallback. Do not solve these by inference (`ENG-REWARD-001`, `ENG-REWARD-002`).

## Failure, diagnostics and verification

Scheduler, dispatcher and worker are separate failure domains. The scheduler opens a heartbeat opportunity; settlement and dispatch return bounded independent evidence so one failure does not erase the other's successful transaction. The dispatcher discovers bounded due work and processes nodes sequentially without retry loops. The worker owns one claim/decode/resolve/commit attempt. Expired leases can be reclaimed; live claims fence competitors. Deferred database constraints validate cross-row invariants at commit. Operational classifications are bounded and sanitized.

Client timing distinguishes authoritative data age from short presentation transitions. Realtime is the preferred delivery path; bounded polling/reconnect recovery is fallback. Old-session responses cannot replace a current projection. Diagnostic recording is bounded, admin-controlled and must not reveal credentials.

Verification levels are deliberately different:

| Level | Proves |
|---|---|
| Unit | a local function/adapter contract |
| Resolver fixture | deterministic rules and proposals for captured snapshots |
| Static migration contract | required SQL text/shape exists in Git |
| Executable schema test | SQL compiles and behaves in an isolated schema |
| Installed-schema verification | the actual Cloud definitions/grants match |
| Edge parity/package | generated mirror and transitive deployment boundary match source |
| Bounded live diagnostic | installed chain timing/classifications for a controlled run |
| Manual gameplay | player-visible behaviour under the observed conditions |

> “All tests green” proves only the boundaries exercised by those tests. It does not prove an installed production chain unless installed/live boundaries were tested.

An engine change must minimally include focused unit/fixture tests, migration contracts plus executable SQL when SQL changes, strict decoding/typecheck, mirror parity when shared Edge source changes, and project-state evidence separated into source, installed, released and live-verified stages. Manual evidence must say who observed it and may not be promoted to direct Cloud verification.

## Status matrix

Detailed volatile facts belong in [project state](../operations/project-state.md).

| Area | Intended rule | Source | Installed/released/live | Remaining work |
|---|---|---|---|---|
| World heartbeat | one 2s authority; phased due work | implemented semantically | see project state | explicit global identity (`ENG-HB-001`) |
| Combat2 processing | bounded claim/resolve/commit | implemented | live operator evidence | latency measurement |
| Engagement/release | peaceful deliberate, aggressive automatic, present-only ownership | implemented | installed; operator reported live | targeting audit |
| Resource settlement/delivery | OOC 4s settlement and authoritative delivery | implemented | installed; operator reported live | jitter evidence |
| Solo movement | atomic authoritative departure | implemented | installed; operator observed | continued verification |
| Party movement | coordinated atomic ordering | implemented source | see project state | release/live verification |
| Logs/diagnostics | bounded authoritative delivery/recording | implemented | see project state | world-vs-encounter tick label |
| Targeting/initiation | immediate intention, next-heartbeat outcome | partial | operator reports intermittent delay | `ENG-COMBAT-001` |
| Stances | authoritative reservation/effects | encounter-scoped | partial | character scope/out-of-combat |
| Food | authoritative amount/expiry | not complete | not claimed | `ENG-FOOD-001` |
| Rewards/ADM-025B | exclusive item source, exactly once | pending | not installed | `ENG-REWARD-001/002` |
| Inactive return-home | safe authoritative inactivity transition | not designed | not installed | `ENG-LIFECYCLE-001` |

## Maintainer source index

- Heartbeat/settlement: `supabase/migrations/20260923100000_authoritative_ooc_resource_settlement.sql`
- Resource formulas: `src/shared/formulas/resources.ts`
- Resolver: `src/shared/combat2/resolver.ts`
- Worker/dispatcher: `src/server/combat2/process-node-tick-once.ts`, `src/server/combat2/dispatch-node-ticks-once.ts`
- Delivery/presentation: `src/features/combat2/`
- Movement: `src/features/combat2/departure.ts`, `src/features/combat2/party-departure.ts`
- Operational evidence: `docs/operations/project-state.json` (canonical) and generated `project-state.md`

