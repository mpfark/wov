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

The bounded [legacy runtime retirement audit](combat2-legacy-runtime-retirement-audit.md) separates batch A's Lovable-reported refusal-shell deployment from batch B's source-only browser isolation and pending manual publication/live checks. The [installed SQL dependency audit](combat2-legacy-sql-dependency-audit.md) now supports batch C's authored, uninstalled privilege-only denial on five exact obsolete transport/entry-clear functions. Mik confirms Combat1 is no longer a supported gameplay execution path; retained flag-off source is transitional code, not authority to preserve browser SQL access. Full PostgreSQL compilation, installed ACL checks and later scheduling/function/trigger/column retirement remain separate gates. Active Combat2, resources, movement, stances and shared consumers are unchanged; no engine rule changes.

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

Approved design: the world has one authoritative heartbeat with an intended base cadence of two seconds. Combat does not own an independent wall-clock timer. Active encounters are processed on eligible scheduler opportunities; out-of-combat resource settlement is phase-gated to four-second buckets. Ordinary attacks, queued abilities, AI, periodic effects, combat regeneration and encounter completion resolve through encounter-local claims and commits. Future time-based systems should attach through deterministic divisors/phases, not competing timers. A scheduler opportunity processes only eligible due work, not every node or creature. Maintenance, sleep and scheduler absence halt work.

> No gameplay mechanic may introduce an independent wall-clock loop when it can be resolved deterministically on the authoritative world heartbeat. Any exception must be explicit and documented.

```text
world heartbeat       H(n) -------- H(n+1) -------- H(n+2)
due encounter work       claim/resolve/commit          ...
OOC settlement           phase (every second heartbeat)
client intention      accepted/refused now -> resolves at next eligible H
encounter tick        local k commits      -> local k+1 (only on commit)
```

Target behaviour: direct authoritative transactions do not automatically wait for a heartbeat. Ordinary out-of-combat movement and combat departure/flee are immediate authoritative transactions. Time-based gameplay outcomes still wait for an eligible heartbeat: selecting a target or submitting an attack may have its identity, ownership, shape and obvious static preconditions checked immediately, but a queued combat intent is not finally successful until evaluated against the authoritative heartbeat snapshot. Target death, departure, changed resources or other authoritative changes may deterministically refuse it at resolution. Normal latency may approach one heartbeat. The UI may show queued/prepared state but may not fabricate a result.

Movement/departure serializes against encounter processing through a documented database lock order. If departure obtains ownership first, the fighter is excluded from the next tick. If a tick already owns the relevant state, it commits first and departure resolves immediately afterward. Any exit opportunity resolves exactly once inside that same departure transition. A dead character neither moves nor pays MP; a survivor moves and pays MP exactly once; remaining participants continue. No path may duplicate exit opportunities, relocation, MP charge, cleanup or encounter completion. No missed heartbeat may be replayed as a burst of combat ticks. Requests can arrive between heartbeats without making browser state authoritative.

Each encounter begins and advances its own local successful-commit sequence; a failed commit does not advance it and a new encounter may start at tick one regardless of any future global heartbeat number. The claim token, captured intent cutoff and state version fence exactly one candidate commit. Request UUIDs fence immediate transactions. The delivery cursor orders only one encounter's committed batches.

The installed implementation now has the shared correlation identity without turning it into gameplay order. Each actual `combat2_dispatch_scheduler_fire()` invocation allocates a durable `heartbeat_id`, including an ineligible invocation; no invocation creates no row. The wrapper independently attempts four-second settlement and dispatch, and the deployed dispatcher carries the same id through selected-node and worker diagnostics. Each encounter still owns its own `next_due_at`, candidate tick, claim lease and committed tick. Settlement still owns its locked four-second bucket cursor, the Edge `invocationId` remains per selected node, and `combat2_dispatch_schedule_state.request_id` remains a `pg_net` transport id. Immediate movement and entry can commit between scheduler fires and do not wait for one.

The approved `heartbeat_id` contract and installed-source boundary are specified in [World heartbeat identity](world-heartbeat-identity.md). Migration `20260929130000_combat2_world_heartbeat_identity.sql` retains bounded run evidence for 24 hours and passes the same id to settlement, dispatch and bounded diagnostics. Installation and deployment are recorded. A bounded Lovable-observed live window verifies ordinary eligible fires, settlement, dispatch and encounter commits, while ineligible, retry, failure and catch-up scenarios remain unverified. The identity does not replace existing exactly-once boundaries or make immediate gameplay wait. See `ENG-HB-001` and `ENG-DIAG-002`.

Installed code still schedules an encounter from commit-transaction time with `greatest(now(), next_due_at) + 2 seconds`. Live evidence shows transport latency moves that deadline just past the following scheduler fire, producing an accidental roughly four-second encounter pace despite healthy two-second heartbeats. This is a defect, not an approved timing rule. `ENG-HB-003` authors a forward correction that advances from the previous server deadline, preserves its two-second phase during healthy execution and skips obsolete opportunities after delays. It does not use `heartbeat_id` as a clock and does not change CP regeneration, effect timing, boss timing, claims or immediate transactions. The correction is source-only until separately installed and live-verified. A deliberate three- or four-second cadence remains an unapproved future option.

Sources: `supabase/migrations/20260831133000_combat2_dispatch_scheduler_foundation.sql`, `supabase/migrations/20260923100000_authoritative_ooc_resource_settlement.sql`, `supabase/migrations/20260830064542_10f5dc3d-4931-4a0d-8fd9-2c7faa7bb412.sql`, `src/server/combat2/dispatch-node-ticks-once.ts`, `src/server/combat2/process-node-tick-once.ts`, `supabase/functions/combat2-dispatch-once/handler.ts`.

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

## Progression and rewards

Approved ENG-PROGRESSION-001 rules, encoded by **001A contract/reference work only**. These rules define the future authority; they do not assert that current runtime writers implement them. Installed SQL, deployed consumers and historical character state remain separate verification gates. The reference under `src/shared/progression/` has no runtime importers and must not be used as a browser mutation authority.

### XP and advancement

- Gameplay levels are 1–42. Ordinary progression cannot produce levels above 42; historical/admin exceptions require reconciliation.
- The threshold from L to L+1 is `T(L)=floor(50×L²)`, using `formulas/xp.ts:getXpForLevel` in the pure reference. XP is remainder toward the next level, not lifetime XP. The old admin `100×L` formula is not canonical.
- A legitimate award processes **all** affordable transitions atomically, up to 42. L1 XP0 +250 becomes L3 XP0; +260 becomes L3 XP10. Each destination level grants one unspent discretionary point; no L1 grant. Ordinary L1→ 42 grants 41 points.
- At arrival at 42, playable XP becomes0 and overflow is discarded. Canonical L42 XP0 accepts no further usable XP/rewards. Receipts distinguish offered, applied and discarded XP; `offered=applied+discarded` and `oldXP+applied=thresholdsPaid+finalXP`. Cap presentation reflects applied XP, not merely a proposed award.
- Reject negative, fractional, null, nonfinite or out-of-envelope awards and unsafe arithmetic. Zero awards produce no transition or refill. The initial parity reference uses the current signed-integer envelope (2,147,483,647 for award/current XP and their pre-transition sum); the future DB must confirm column widths/checked arithmetic before installation.
- Historical negative/null/out-of-range level/XP, below-cap XP already at/above its threshold, or nonzero XP at 42 require separate reconciliation; unrelated awards, including zero, never normalize them. Validation does not authorize a repair.
- Future trusted callers supply a validated domain event and stable identity. Same identity+payload replays the original historical receipt; conflicting reuse is refused. A pure calculation is not replay protection or proof of a committed award.

### Class growth and level milestones

At each crossed destination level 3/6/…/42, apply the captured `classes.level_bonuses` configuration of the class held at that transition. Validate six-stat nonnegative integer deltas and retain class/config revision plus concrete deltas. No hardcoded CASE growth owner. Current reference fixture: Warrior STR/DEX; Wizard INT/WIS; Ranger DEX/WIS; Assassin DEX/CHA; Healer WIS/CON; Bard CHA/INT; Templar WIS/CON, +1 each. These are configuration evidence/golden fixtures, not fixed runtime balance.

Classless characters gain normal levels/discretionary points but no automatic class growth. Joining later does not backfill missed classless installments. Switching is forward-only: Warrior L3 STR/DEX remains after switching atL4; Wizard L6 grants INT/WIS. Never reconstruct history from current class×current level.

One respec token is earned once at each destination milestone 10/20/30/40, including all previously unclaimed milestones crossed by one event. Durable character/milestone uniqueness is required independently of the XP receipt. Exceptional admin token grants are separate. Historical crafting L40 `soulmarked_ember` and L42 `corebound_fragment` are **not canonical level rewards**; their current crafting-specific behavior awaits a later explicit decision. Do not universalize or silently remove them during 001A. Regen tier benefits remain derived highest-eligible tiers; ring claims/reforges, utility actions, titles and kill-specific prestige keep their own eligibility/authority, not automatic inventory grants here.

### Resources, provenance and trainer

After all level transitions and permanent growth, recalculate final maxima using the existing resource formulas. Refill living HP once to final MaxHP; dead HP stays0. Preserve CP/MP and clamp to final maxima; never refill them for a level. XP without level does not heal. This is fixed event policy, not a caller-selectable refill flag. Capacity calculation and refill are separate. The reviewed 001C resume establishes `classes.base_hp` as authoritative (current classless row 18), the installed empty `{}` stat-override fallback to item stats, usable-equipment/gem aggregation, and caps MaxHP 10000 / MaxCP 5000 / MaxMP 5000. 001C neither recomputes nor writes AC; persisted/effective AC remains deferred. The browser-owned clamp-only `sync_character_resources` is dependency evidence, not the new authority.

Existing characters retain exact materialized attributes, level/XP, class, Renown/ranks, point pools, equipment and resources as an opaque baseline. No inferred historical composition or automatic rewrite. From cutover forward, six counters record currently invested provably refundable discretionary points. Compact event receipts record identity/source, class/config, permanent deltas, allocation/refund, Renown outcome, milestone identity and before/after progression version. This B+C hybrid is not full event sourcing.

Future allocation/respec use narrow server-authoritative owner RPCs; no broad browser UPDATE reopening. Both are prohibited during active combat and require current trainer/location, ownership, safe lifecycle, positive valid six-stat allocation, sufficient pool, locks/version fencing, atomic resource sync and replay checks. Respec refunds only recorded discretionary investment: subtract counters from attributes, return their total to unspent, clear counters and consume one token only for a valid nonzero refund. Empty refund consumes nothing; inconsistent provenance refuses. Preserve racial/opaque base, automatic mixed-class growth, Renown attributes/ranks, permanent rewards, gear and class history. Unproven pre-cutover spending is not refundable without later independent proof.

ENG-PROGRESSION-001F accepts refusal while a canonical stance is active or a stance request remains uncommitted. Training never clears stance or refunds stance CP. Fresh respec/Renown requires a living character at the same nodes.is_trainer boundary and the accepted E combat/movement/lifecycle exclusions. A zero refund consumes nothing, including when tokens are zero; a real refund requires one token and refuses if the resulting unspent pool exceeds200. No clipping or cap expansion. Destructive/downward admin overrides and historical repairs remain separate decisions.

### Transactional authority and integration

001C primitives are installed; the [001D closure](../operations/progression-001D-closure.md) records the canonical Combat2 XP authority as INSTALLED / VERIFIED / ACTIVATED from supplied operator evidence. Combat2 determines legitimate eligibility and amount; progression owns XP→level consequences in the same transaction only for a newly accepted claim UUID. Historical claim conflicts never backfill. The four original wrappers/lock ordering/resource-domain effects remain, and ordinary callers cannot invoke the private adapter/primitives or internal predecessors.

ENG-PROGRESSION-001D is CLOSED locally. **NATURAL RUNTIME PATH NOT YET OBSERVED** and **HOSTED MULTI-SESSION BEHAVIOR: UNPROVEN** remain explicit; neither is a pass or closure prerequisite under Mik's accepted policy. Automatic Combat2 is permitted when normal world/presence conditions allow it; an asleep world is intentional and normal player presence wakes it, with no added manual-wake gate. Three crafting entries and ordinary admin grant-xp stay paused; apply_crafting_xp and reviewed legacy XP capabilities are owner-only. Privileged set-level/update-character remain noncanonical 001G overrides; train_renown_stat remains 001F. No later domain implementation follows from closure. Rules and the one authoritative world heartbeat are preserved.

001C originally prepared an owner-only dormant SQL payload and [application handoff](../operations/progression-001C-lovable-application.md), outside migration discovery. Three RLS sidecars retain a lazily captured opaque baseline, six initially zero discretionary-investment counters, versioned compact receipts, and unique respec milestones. Installation performs no backfill or character mutation. XP and trusted permanent-delta primitives serialize on the character row; identical stable requests replay the original receipt before current-state/version/config validation, while conflicting identity reuse refuses. 001D subsequently connects only the accepted Combat2 reward branch to these unchanged primitives. Trainer, full respec, class changes, creation, Renown and overrides remain later domain integrations; primitive allocation alone is not trainer authorization.

Class configuration identity is a SHA-256 fingerprint of canonical JSONB semantic values: class key, classless status and all six normalized nonnegative integer `level_bonuses`. Key order, missing zero fields and numeric formatting do not change it; unknown/null/fractional/negative values refuse. Do not use `updated_at` or introduce class event sourcing. Capture `base_hp` separately only when resource synchronization uses it. Historical replay returns captured configuration/deltas even after edits. The private SQL receipt representation is not a new browser API or the published TypeScript DTO; later adapters must preserve the approved 001A semantics.

001E is CLOSED locally and INSTALLED / VERIFIED / EDGE DEPLOYED per the accepted supplied operator evidence recorded in project state. Trainer/Order commands remain paused and frontend is not published. Its authenticated Edge → service-only command → private authority boundary retains one initial node advisory lock before character lock, location revalidation, clamp-only synchronization and refusal of active stance/unsafe lifecycle. Historical R1/R2 artifacts and class-growth proof remain unchanged. F canonical respec/Renown and the R1 ACL correction are installed per supplied operator evidence; service unprotected38 UPDATE is restored and protected15 remain denied. [F closure](../operations/progression-001F-closure.md) records CLOSED / INSTALLED / VERIFIED / EDGE DEPLOYED per supplied operator evidence at2026-10-07T21:06:27Z; commands remain paused and frontend not published. Creation/admin reconciliation remains001G, planned pending explicit exceptional policy approval. HOSTED MULTI-SESSION BEHAVIOR UNPROVEN, NATURAL RUNTIME PATH NOT YET OBSERVED and AUTHENTICATED COMMANDS-PAUSED RUNTIME PROBE NOT EXECUTED remain explicit. All engine rules and the one authoritative world heartbeat are unchanged.

A small private PostgreSQL function family owns one XP advancement contract, one trusted permanent-attribute primitive and shared derived-resource synchronization. Narrow domain entries validate combat/craft/admin/trainer/Renown events. Browser clients cannot submit arbitrary trusted deltas. Permanent sources include creation/race, class growth, discretionary investment, Renown, explicit admin overrides and future permanent rewards.

Renown retains six independent per-stat ranks: L30+, cost `10×(selected rank+1)`, chance `max(5,95−10×selected rank)` percent, integer roll0–99 and success exactly when roll<chance. Both outcomes spend RP; success grants selected rank+1 and actual stat+1, while failure changes neither. Investment and lifetime RP never change. No gameplay rank cap is introduced; arithmetic/storage overflow refuses. One stable command has one version and one receipt. Approved F uses a persistent private versioned key and HMAC-SHA256 with unambiguous length-prefixed canonical input and bounded unbiased rejection sampling; rollback/retry is deterministic and committed replay reads the receipt without another draw. Neither operation heals/refills or resurrects; canonical non-level sync clamps after a stat change, and a failed Renown leaves valid resources untouched. Historical Renown remains opaque and nonrefundable. RP earning is outside F: the canonical Combat2 path currently awards XP/gold only. The [F-R1 report](../operations/progression-001F-R1-service-update-repair.md) records supplied F/R1 installation evidence; R1 ACL verification passed; E/F commands remain paused; F is CLOSED / INSTALLED / VERIFIED / EDGE DEPLOYED per operator evidence, frontend not published. RP EARNING AUTHORITY GAP remains explicit.

Combat2 invokes progression **inside** its accepted exactly-once reward transaction, only for a newly accepted claim. Duplicate claims apply no XP/levels/points/growth/milestones. Preserve frozen tick/lifecycle ordering, offscreen qualification, party semantics and rollback; a progression refill cannot resurrect a dead recipient or be overwritten by a later stale proposal.

Crafting/fusion determines a legitimate XP amount but does not own thresholds, levels, growth, resource formulas or ordinary milestones. Prefer atomic completion+XP; a durable outbox written in the completion transaction is the fallback, with pending delivery represented honestly. Admin XP grants/normal upward advancement consume canonical progression; raw set/lower/reconstruct are explicit privileged overrides, with semantics decided separately.

No intentional dual XP authority during cutover: preparation can be split, activation must coordinate all reachable combat/crafting/admin XP writers. Invariant protection must reject invalid transitions rather than silently partially undo a successful-looking RPC. Local Codex never discovers credentials or administers hosted Supabase; Lovable handles later expressly authorized operations. 001B is read-only installed/runner preflight and installs nothing; the existing Cloud migration pause remains until evidence supports resolution. See the [001B handoff](../operations/progression-001B-lovable-preflight.md) and roadmap001A–H sequence.

## Creatures, targeting and initiation

Visible node creatures are a location projection. Peaceful co-location does not itself create Combat2 ownership; a deliberate authoritative engage is required. Living aggressive creatures may cause automatic entry. Engaged encounter creatures, not browser list order, define viable combat targets. Client target/session responses are fenced by node, character, encounter and creature identity.

A basic attack or supported ability intention occupies the character's action slot for the claimed tick. Server-owned autoattack selects the first living engaged spawn by stable runtime ordering when no captured intent owns that slot. Target death causes authoritative retargeting to the next eligible engaged creature; encounter completion occurs only when no living engaged creature and no lifecycle-preserving durable effect remains.

Fighter entry, tank candidates and shared encounters are snapshot authority. Current tank is chosen at resolution from living, present, identity-matched candidates. Installed `ENG-COMBAT-002` makes newest authoritative `entry_seq` the only priority: re-entry gets a new sequence, departure/death falls back by descending sequence, coordinated party movement remains followers first and leader last, an unrelated newcomer becomes the tank, and fighter UUID is the deterministic impossible-tie fallback. Stored party leadership/tank assignments remain party metadata and do not affect encounter targeting. Project state records installation and operator-reported publication; live multiplayer tank order remains unverified.

Targeting states are deliberately separate:

- `visible` is a living creature projected at the node;
- `selected` is immediate local presentation state only and creates no encounter, fighter, engagement or intent;
- `engaged` is server-owned encounter membership;
- `queued target` is the creature identity frozen into an accepted intent;
- `resolved target` is that identity revalidated against the claimed heartbeat snapshot.

Changing local selection never rewrites a queued intent. A paid/manual intent refuses if its frozen target is dead or invalid; it never silently redirects. Server-owned autoattack may retarget, using runtime creature-row UUID, spawn sequence and creature-definition UUID as deterministic server-derived ordering. Browser list order is irrelevant.

Peaceful co-location, selection, non-hostile abilities and stance input do not start combat. The installed `combat2_hostile_action` boundary accepts Basic Attack or an active authored ability whose server-side target contract is `enemy`; it validates the living target and delegates exact ability, target, replay and spendable-CP validation to the existing `combat_intent` authority. Entry plus that exact intent are one subtransaction, so any refusal leaves no fighter, engagement or intent residue. `combat2_engage` remains the compatible Basic Attack wrapper. Movement-authorized location changes invoke an internal service-only arrival helper: a living relocated character joins for aggressive opposition or an active shared encounter with a living engaged creature, independent of browser presence. Peaceful arrival remains idle. Resolution still waits for the next eligible scheduler opportunity. Project state records installation and operator-reported frontend publication; live arrival and hostile initiation remain unverified.

Client authority is limited to input collection, local selection, pending feedback, prepare animation, interpolation, diagnostics and projection of the latest identity-checked authoritative model. A bounded healthy `syncing` transition may retain that model. Realtime, polling and reconnect only deliver server-owned state. The client never authors or predicts final damage, healing, HP, CP, MP, effects, reservations, rewards, death, creature state or completed movement. It may immediately show `sending`, `engaging`, `queued` and prepare animation; hit, damage, healing, death, activated effects and result animation wait for the authoritative result. Gaps, identity mismatch, reconnect uncertainty and actual stale state fail closed. Every update and late response is fenced by character, node, encounter, target, request and version identity.

At one eligible encounter heartbeat the existing finer order is: due pending transitions/effects, valid captured player intents in server order, server-owned autoattack for a fighter whose slot was not occupied by any captured intent, then creature actions. A captured intent owns the slot even if heartbeat validation refuses it, so no replacement Basic Attack is inserted. Ordinary aggression grants no instant attack; first damage waits for the next eligible heartbeat. A future explicitly authored `ambush` mechanic may define a narrower exception.

Spendable CP is authoritative total CP minus active reservation effects. The client disables and blocks pointer and keyboard input when the known spendable amount is below the authored cost and displays required/available CP, but this is only an input filter. The public intent boundary revalidates the current authoritative amount and queues nothing when insufficiency is already provable; the resolver validates again against the frozen snapshot, and commit fencing prevents double spend. If resources change after a valid queue, resolution refuses the captured intent without cost and without a replacement autoattack.

The complete source audit and source-of-truth matrix are recorded in [the targeting/initiation audit](combat2-targeting-initiation-audit.md). Remaining live verification is tracked by `ENG-COMBAT-002`; it is not inferred from source or installation. Expected initiation latency is at most the wait to the next eligible encounter scheduler opportunity plus delivery time; abnormal intermittent latency remains measurement work under `ENG-DIAG-001`.

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

Equipment is a tick dependency only for fighters who are `present` at the frozen claim boundary. Their complete equipped loadout is projected, used for effective stats and fenced through commit; a fighter who then dies or departs during resolution remains protected for that tick. Absent historical fighters remain available for durable participation, reward attribution and already-frozen offscreen effects, but their mutable current/off-node equipment is neither read by the resolver nor included in the proposal fence. Commit still rejects changed, forged or omitted equipment for every claim-present fighter. Project state records installation and deployment of `20261001100000_combat2_present_equipment_fencing.sql`; recovery evidence is operator-reported and multiplayer coverage remains pending.

## Effects and stances

Ability publication uses shared configured composition and assignment overrides before producing versioned Combat2 records (`ENG-ABILITY-001`). Ratios/multipliers retain precision until consumption; HP/count settlement remains integer. Party-presence regeneration uses one two-second heartbeat with authored intervals and explicit normalization in publication metadata. A configured next-hit multiplier/window is an independent offensive charge consumed by the first landed hit. Resource formulas and percentage stance reservation are unchanged. See [Ability publication and semantics](ability-publication-and-semantics.md) for publication, fallback provenance and unresolved authored/prose discrepancies.

- Transient effects expire/tick inside the encounter resolver.
- Persistent effects need explicit durable ownership and lifecycle rules.
- A CP reservation is an authoritative reservation effect; spendable CP is total CP minus active reservations.
- Source defines one character-owned lifecycle for the eight authored stances (`ENG-STANCE-001/002`), now Lovable-reported installed with both Combat2 Edge consumers deployed. Mik's stance frontend publication and live verification remain pending; a related ACL-only helper correction is authored separately. Activation/drop is an immediate idempotent transaction; in combat it also consumes exactly one action slot. Claim freezes stance versions, resolver derives encounter mechanics without a second reservation owner, and commit fences/persists ward changes or death cleanup.
- Reservation is `floor(current effective max CP × authored percentage)`. Cap/equipment changes dynamically resize it without charge/refund; excess reservation clamps spendable CP to zero and never auto-drops the stance. Movement, completion and reconnect retain living-character stance state; death clears it and respawn does not restore it.
- Mik approved a one-time installation reset of positively identified old stance mechanics, linked reservations and stance-owned Force Shield ward state. Lovable reports complete rollback compilation and atomic installation resetting three mechanics/three reservations with protected data unchanged. New authority starts empty; players reactivate after release. No activation-cost refund or raw HP/CP/MP change is allowed. Synthetic behavior coverage and stance live verification remain pending; the installed reset must not be replayed.
- Presentation may group multiple authoritative rows into one semantic stance but cannot merge their mechanics.

Holy Shield currently consists of a retaliation effect plus its reservation effect and is presented as one semantic stance. Repeated activation is refused. Dropping a stance removes the reservation and does not refund the original activation cost.

The audited ability-availability matrix, approved character-scoped stance authority and release sequence are in [combat2-ability-availability-and-persistent-stances.md](combat2-ability-availability-and-persistent-stances.md). Project state remains authoritative for installation and verification evidence.

## Movement and party movement

Solo movement validates caller ownership, origin, destination, connection visibility/adjacency, locks/keys, lifecycle fences and MP, then charges and moves atomically under a durable request ID. ENG-MOVE-001 source makes a present fighter's valid movement the same immediate transaction: it fences the origin claim, releases only character-scoped encounter state, marks the fighter absent, moves, charges once and permits authoritative destination arrival. It never resolves a combat tick or exit attack. Coordinated departure freezes the complete mover set and locks character rows by UUID, independently from the follower `joined_at`/UUID/leader-last relocation order. Identical replay is durable; conflicts and stale/dead state fail closed. Destination-less `combat_flee` is a compatibility refusal because relocation requires an authoritative adjacent destination. Installation and live status remain governed by project state.

Coordinated party movement snapshots eligible followers and moves followers before the leader, leader last. Each member has its own survival/result outcome; dead, off-node or non-following members remain independent. Party request/member rows preserve the group transition and stable order. Sources: `20260905194227_fbe2e172-650d-43c2-a3d2-b6dff0c3210a.sql`, `20260908122530_e728cbda-72d0-415c-96bf-a8758fe327ac.sql`, `src/features/combat2/departure.ts`, and `src/features/combat2/party-departure.ts`.

Source and installation evidence exists for solo and party contracts; ordinary solo movement is operator-observed. Coordinated party release/live behaviour remains verification work, not inferred from Git (`ENG-PARTY-001`).

## Rewards and unique items

Gold, salvage and item selection are independent reward channels unless a source explicitly excludes another. Item-source selection must be exclusive: world pool, assigned relational table or unique boss drop—never silent fallback between them. Reward qualification is durable per creature spawn and per recipient; proposals and materialization are exactly once.

World-pool eligibility and weights come from item catalogue fields. Assigned tables use relational loot tables/entries. Unique boss drops require immutable global unique-instance identity across physical holding surfaces. Ground loot and pickup are authoritative transfer boundaries. The pending `20260915200000_combat2_authoritative_reward_channels.sql` and related ADM-025B source are **not installed**; project state is authoritative for its operational status.

Unresolved authoring decisions remain explicit: King Aldric's key plus weapon and multiple unique candidates on one creature; Rusty Key as gate access rather than a global unique; and safe authoring of mutually exclusive sources with no fallback. Do not solve these by inference (`ENG-REWARD-001`, `ENG-REWARD-002`).

## Failure, diagnostics and verification

Scheduler, dispatcher and worker are separate failure domains. The scheduler opens an invocation opportunity; settlement and dispatch return bounded independent evidence so one failure does not erase the other's successful transaction. The dispatcher discovers bounded due work and processes nodes sequentially without retry loops. The worker owns one claim/decode/resolve/commit attempt. Expired leases can be reclaimed; live claims fence competitors. Deferred database constraints validate cross-row invariants at commit. Operational classifications are bounded and sanitized. The installed `heartbeat_id` may be used only as correlation metadata; diagnostics must never relabel an encounter tick, settlement bucket, per-node invocation UUID, transport request id or delivery cursor as the heartbeat.

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
| World heartbeat | one 2s authority; phased due work | implemented | identity installed; dispatcher deployed; frontend operator-reported published | bounded live correlation verification (`ENG-HB-001`) |
| Combat2 processing | bounded claim/resolve/commit | implemented | live operator evidence | latency measurement |
| Engagement/release | peaceful deliberate, aggressive automatic, present-only ownership | implemented | installed; operator reported live | targeting audit |
| Resource settlement/delivery | OOC 4s settlement and authoritative delivery | implemented | installed; operator reported live | jitter evidence |
| Solo movement | immediate atomic OOC move; immediate serialized combat departure | implemented | ENG-MOVE-001 installed; frontend operator-reported published | bounded race/live verification |
| Party movement | immediate coordinated transition, follower-first/leader-last | implemented | ENG-MOVE-001 installed; frontend operator-reported published | bounded installed/live verification |
| Logs/diagnostics | bounded authoritative delivery/recording | implemented | see project state | world-vs-encounter tick label |
| Targeting/initiation | immediate intention, next-heartbeat outcome | implemented for ENG-COMBAT-002 | installed; frontend operator-reported published | live arrival/hostile/tank-order verification |
| Stances | character-owned reservation/state; encounter-derived mechanics | implemented ENG-STANCE-001/002 source | Lovable-reported installed/deployed; not published/live-verified | ACL-only helper follow-up, Mik's publication and bounded live verification |
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

ENG-ABILITY-001 follow-up: fresh configured export and eight-stance source-SQL comparison completed locally; installed SQL definitions remain unverified. Battle Cry removes 10 percentage points of incoming enemy crit chance (separate from critical damage softening); Grand Finale has no bonus die; Consecrate keeps eligible hostile living node scope; Rend initial weapon hit awaits balance design. No CP cost/reservation/resource formula or heartbeat change. See [ability publication contract](ability-publication-and-semantics.md).
