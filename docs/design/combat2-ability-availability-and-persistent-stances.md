# Combat2 ability availability and persistent stances

Status: approved design with Lovable-reported stance installation and Edge deployment; frontend publication and stance live verification pending. ACL-only helper follow-up is authored but not installed. Detailed engine invariants remain owned by [game-engine.md](game-engine.md), while operational evidence remains owned by [project-state.json](../operations/project-state.json).

## Pre-implementation audit baseline

The generated inventory in `src/shared/combat/inventory/active-abilities.json` contains 36 authored abilities. `src/shared/combat2/ability-support.ts` excludes none of them, and `src/shared/combat2/catalog.ts` derives support from authored mechanic, activation and target fields rather than labels.

The browser readiness and submission path is `action-readiness.ts` -> `routeCombat2Action.ts` -> `useCombat2IntentSession.ts` / `intent.ts`. With no active authoritative encounter, only a valid enemy-targeted action can call `combat2_hostile_action`, which atomically enters and queues that exact action. Target selection alone remains inert. Every other ability is currently refused as requiring active combat. In an encounter, `combat_intent` validates the fighter, authored ability, target, spendable CP and request identity and writes a tick-owned intent.

Stance activation currently becomes encounter-scoped `node_effect` rows: one reservation row plus one or more mechanic rows. Claim projects those rows, resolver consumes them and commit owns their changes. Immediate departure deletes character-targeted effects for the departing fighter. Therefore stance state and reservation do not survive ordinary movement or encounter completion.

The older `characters.reserved_buffs` and `characters.stance_state` JSON fields, `activate_stance`, `drop_stance` and `apply_force_shield_regen` still exist. The legacy browser also calls Force Shield regeneration on a four-second timer. Those records are not the Combat2 encounter authority and must not become a second writer during the cutover.

## Authored ability matrix

`CP` is an activation cost. `reserve` is the authored fraction of maximum CP. “Hostile entry” means the installed atomic entry-and-intent path; it never means selection alone. “Encounter” means the existing intent/resolver/commit path.

| Class | Key / label | Mechanic; target; cost | Current outside combat / owner | Proposed availability / owner | Decision or boundary |
|---|---|---|---|---|---|
| Assassin | `backstab` / Backstab | weapon attack; enemy; CP 10 | hostile entry / entry + encounter tick | unchanged | queued hostile action |
| Assassin | `cloak_of_shadows` / Cloak of Shadows | evasion buff; self; CP 60 | unavailable / encounter only | remain encounter-only | OOC timed-effect lifecycle is not designed |
| Assassin | `envenom` / Envenom | stack source stance; self; CP 50, reserve 20% | unavailable / encounter effects | OOC activate/drop / character stance transaction; hits remain encounter-resolved | mutually exclusive with Ignite |
| Assassin | `eviscerate` / Eviscerate | stack consume; enemy; CP 40 | hostile entry / entry + encounter tick | unchanged | consumes authoritative stacks at resolution |
| Assassin | `shadowstep` / Shadowstep | stealth buff; self; CP 15 | unavailable / encounter only | remain encounter-only | OOC timed-effect lifecycle unresolved |
| Bard | `crescendo` / Crescendo | party regeneration; party; CP 40 | unavailable / encounter only | remain encounter-only | periodic party eligibility needs a separate owner |
| Bard | `cutting_words` / Cutting Words | spell attack; enemy; CP 10 | hostile entry / entry + encounter tick | unchanged | queued hostile action |
| Bard | `dissonance` / Dissonance | control debuff; enemy; CP 25 | hostile entry / entry + encounter tick | unchanged | queued hostile action |
| Bard | `grand_finale` / Grand Finale | burst damage; enemy; CP 60 | hostile entry / entry + encounter tick | unchanged | queued hostile action |
| Bard | `inspire` / Inspire | regeneration buff; party; CP 15 | unavailable / encounter only | remain encounter-only | party and expiry lifecycle unresolved |
| Healer | `divine_aegis` / Divine Aegis | absorb buff; ally; CP 60 | unavailable / encounter only | remain encounter-only | OOC ally presence/effect owner unresolved |
| Healer | `heal` / Heal | heal; self; CP 15 | unavailable / encounter only | candidate for a later direct transaction | not part of the stance slice; combat action-slot semantics must remain explicit |
| Healer | `purifying_light` / Purifying Light | party regeneration; party; CP 40 | unavailable / encounter only | remain encounter-only | periodic party eligibility needs a separate owner |
| Healer | `smite` / Smite | spell attack; enemy; CP 10 | hostile entry / entry + encounter tick | unchanged | queued hostile action |
| Healer | `transfer_health` / Transfer Health | HP transfer; ally; CP 25 | unavailable / encounter only | remain encounter-only | OOC ally eligibility and atomic dual-resource change unresolved |
| Ranger | `aimed_shot` / Aimed Shot | weapon attack; enemy; CP 10 | hostile entry / entry + encounter tick | unchanged | queued hostile action |
| Ranger | `barrage` / Barrage | multi-attack; enemy; CP 25 | hostile entry / entry + encounter tick | unchanged | queued hostile action |
| Ranger | `disengage` / Disengage | evasion buff; self; CP 60 | unavailable / encounter only | remain encounter-only | OOC timed-effect lifecycle unresolved |
| Ranger | `eagle_eye` / Eagle Eye | offense stance; self; CP 15, reserve 10% | unavailable / encounter effects | OOC activate/drop / character stance transaction | combat bonus is projected into encounter resolution |
| Ranger | `natures_snare` / Nature's Snare | control debuff; enemy; CP 40 | hostile entry / entry + encounter tick | unchanged | queued hostile action |
| Templar | `consecrate` / Consecrate | aura pulse; node; CP 40 | unavailable / encounter only | remain encounter-only | node ownership and OOC pulse policy unresolved |
| Templar | `divine_challenge` / Divine Challenge | mitigation buff; self; CP 60 | unavailable / encounter only | remain encounter-only | OOC timed-effect lifecycle unresolved |
| Templar | `holy_shield` / Holy Shield | reactive stance; self; CP 15, reserve 10% | unavailable / encounter effects | OOC activate/drop / character stance transaction; retaliation encounter-resolved | one badge despite reservation + reactive projection |
| Templar | `judgment` / Judgment | spell attack; enemy; CP 10 | hostile entry / entry + encounter tick | unchanged | queued hostile action |
| Templar | `shield_wall` / Shield Wall | block stance; self; CP 25, reserve 15% | unavailable / encounter effects | OOC activate/drop / character stance transaction | encounter projects mitigation |
| Warrior | `battle_cry` / Battle Cry | mitigation stance; self; CP 25, reserve 15% | unavailable / encounter effects | OOC activate/drop / character stance transaction | encounter projects mitigation |
| Warrior | `power_strike` / Power Strike | weapon attack; enemy; CP 10 | hostile entry / entry + encounter tick | unchanged | queued hostile action |
| Warrior | `rend` / Rend | periodic damage debuff; enemy; CP 40 | hostile entry / entry + encounter tick | unchanged | pulses remain heartbeat/resolver-owned |
| Warrior | `second_wind` / Second Wind | heal; self; CP 15 | unavailable / encounter only | candidate for a later direct transaction | not part of the stance slice; combat action-slot semantics must remain explicit |
| Warrior | `sunder_armor` / Sunder Armor | control debuff; enemy; CP 60 | hostile entry / entry + encounter tick | unchanged | queued hostile action |
| Wizard | `arcane_surge` / Arcane Surge | offense stance; self; CP 25, reserve 15% | unavailable / encounter effects | OOC activate/drop / character stance transaction | encounter projects offense |
| Wizard | `conflagrate` / Conflagrate | stack consume; enemy; CP 60 | hostile entry / entry + encounter tick | unchanged | consumes authoritative stacks at resolution |
| Wizard | `fireball` / Fireball | spell attack; enemy; CP 10 | hostile entry / entry + encounter tick | unchanged | queued hostile action |
| Wizard | `force_shield` / Force Shield | absorb stance; self; CP 15, reserve 10% | unavailable / encounter effects | OOC activate/drop / character stance transaction; absorb encounter-resolved | ward state needs one persistent owner; remove browser regeneration writer |
| Wizard | `frostbolt` / Frostbolt | spell attack; enemy; CP 10 | hostile entry / entry + encounter tick | unchanged | queued hostile action |
| Wizard | `ignite` / Orbs of Fire | stack source stance; self; CP 50, reserve 20% | unavailable / encounter effects | OOC activate/drop / character stance transaction; hits remain encounter-resolved | mutually exclusive with Envenom |

Periodic and reactive execution does not change activation authority: Rend and encounter auras pulse only through an encounter tick; Holy Shield reacts only inside deterministic resolution; Envenom and Ignite supply stacks only when an eligible hit resolves. No browser timer may create a pulse, absorb or stack.

## Recommended character stance authority

Use one normalized server-only `character_stance` relation keyed by `(character_id, ability_key)`. Store the authored identity and percentage, activation evidence, authoritative state needed by that stance (for example Force Shield's remaining ward), activation/version timestamps and an optimistic state version. The integer reservation is always derived from current effective maximum CP rather than frozen. Do not copy labels or formulas as authority. RLS is enabled, browser table writes are absent, and client state comes from a bounded authenticated projection/RPC.

Do not make encounter rows co-own a stance. Claim reads the character stance rows for claim-present fighters and freezes them into the snapshot with character/stance version fences. Resolver derives the existing mechanic projections in memory. Any encounter-local rows needed for a pulse, target-specific debuff or event carry stance provenance and a uniqueness fence; they do not create another reservation. Commit validates the frozen character-stance version. The UI groups the authoritative stance plus its derived mechanics into one badge.

Activation/drop uses one idempotent authenticated RPC with a deliberate request UUID. It derives caller ownership and the authored catalogue server-side, takes the established node/encounter lock before the character and stance rows, and records a durable replay result. Activation validates class/loadout eligibility, mutual exclusion, current total CP and all active reservations, charges the authored activation cost once and creates exactly one reservation. Repeated identical requests replay; a different payload with the same request ID conflicts; already-active activation refuses. Drop removes the stance and reservation atomically, is allowed at zero spendable CP and never refunds activation cost.

When the character is in an active encounter, the transaction fences any live claim and advances the encounter state version so a stale proposal cannot commit across the stance change. The stance state changes immediately; heartbeat resolution remains the sole owner of attacks, pulses, absorbs, reactions and combat presentation. To preserve today's action-slot rule, activation/drop during combat must also create one fenced transition intent/marker that consumes that tick's player action without charging or reserving again. This is the recommended contract, pending Mik's explicit approval below.

### Lifecycle and races

- **Movement and completion:** character stance rows survive; departure removes only encounter-derived projections. Entry claims the same stance state. No activation depends on a heartbeat.
- **Tick first / departure first:** common node/encounter-before-character lock order and stance version fencing make one transaction win. A committed tick uses its frozen stance; otherwise the stale proposal refuses and retries from the new state.
- **Death and respawn:** authoritative death atomically clears all active stances, reservations and stance-owned persistent state; respawn observes the cleared state and never restores it.
- **Logout/reconnect:** no change; state persists and is re-projected by character identity. Late client responses are fenced by character/session/request/version.
- **Class or loadout change:** the mutation refuses while an incompatible stance is active; compatible changes remain allowed. Silent retention of an unusable stance is forbidden.
- **Maximum CP/equipment change:** the integer reservation is recalculated atomically from current effective maximum CP without charge or refund. A lower cap can make spendable CP zero but does not silently drop the stance.
- **Party/node eligibility:** an active character stance has no effect on absent or ineligible participants. Claim/resolver evaluates present fighter, party and node eligibility at the frozen tick. No out-of-combat aura pulse is introduced.
- **Test Arena:** snapshot/restore or arena-scoped isolation must include character stance rows and their request/version state. Reset restores the exact pre-run state; arena actions cannot leak a stance into ordinary play.
- **Existing state (Mik-approved one-time reset):** install with processing disabled; do not migrate existing stances. Reset only the eight exact authored identities, their self-owned mechanic effects and CP reservations, and legacy Force Shield ward fields. New character stance authority starts empty; players reactivate after release. Unrelated buffs/debuffs, creature-targeted offscreen stacks, mixed JSON entries and history survive. Raw HP/CP/MP remain unchanged: releasing reservations may increase spendable CP, but activation costs are never refunded. Unclassifiable state still fails closed. Reset and schema installation must share one atomic runner transaction.

## Authority and timing

The browser can present eligibility and disabled reasons but never writes CP, reservations, ward state or effects. Pointer and keyboard submission call the same RPC. Healthy syncing retains the last identity-checked projection; stale state and late responses fail closed.

Activation/drop is an immediate authoritative transaction, like movement, not a browser timer and not a second resolver. Combat consequences remain aligned to the two-second encounter cadence. Out-of-combat settlement remains four seconds and computes spendable CP from the character stance reservations; it neither activates nor drops a stance. Existing hostile initiation, request replay, claim/commit fencing and deterministic resolver rules remain unchanged.

## Bounded implementation batches

### Batch 1 — ENG-STANCE-001 vertical slice

Add the normalized table, replay ledger, projection and activate/drop RPC; reset only positively identified old state for the eight authored stances and initialize empty authority; make resource/spendable-CP validation read it; project it through claim/resolver/commit; remove Combat2 and legacy browser writes/timers; adapt the UI to one semantic badge. Preserve node/encounter-before-character lock order and deploy generated mirrors only after deterministic parity. Required proof: migration guard/rollback compilation in PostgreSQL, ACL/RLS/Realtime checks, activation/drop/replay/conflict/zero-CP tests, departure-first/tick-first tests, death/respawn and cap-change tests, movement/reconnect/arena isolation, all eight mechanics and no duplicate reservation/effect/pulse. Install with processing disabled, compare protected fingerprints, deploy proven Edge consumers, then perform bounded solo live checks before multiplayer.

### Batch 2 — ENG-STANCE-002 eligibility and presentation

Expose explicit server classifications and a bounded character stance projection outside combat. Route only the eight catalogue stances through the new RPC, with shared pointer/keyboard disabled reasons and session fences. Verify activate before entry, movement, completion, reconnect, drop at zero CP, mutual exclusion and one badge. No other ability becomes OOC-capable.

### Batch 3 — non-stance ability decisions

Design a separate authoritative owner for immediate self heals and for timed self, ally, party and node effects. Decide action-slot behavior, duration clock, party/node eligibility and cancellation before enabling any one category. Deliver one coherent vertical slice rather than extending the stance table into a generic effect store.

### Batch 4 — legacy retirement

After installed and live verification, prove no runtime consumer remains, then remove or freeze `reserved_buffs`, `stance_state`, legacy stance RPCs and browser Force Shield regeneration through a separately guarded migration/source change. Preserve historical evidence and avoid data cleanup without an approved policy.

## Approved lifecycle decisions

### Installation reset and Lovable verification

Lovable reports `20261001130000_combat2_character_persistent_stances.sql` installed once as `20261001213148_dec8975a-1fb3-43c9-b5a8-73620bd1e0e8.sql`, resetting three stance mechanics and three reservations after complete rollback compilation. Both installed source and ledger bytes are retained unchanged. The reset contract below is historical installation evidence, not an instruction to rerun it. The reset is capped at 10,000 affected node-effect, legacy-effect and character rows combined, with a five-second lock-acquisition timeout; larger or unknown state stops with aggregate counts. Preflight/postflight notices report mechanic rows, reservation rows, legacy effects, affected characters, legacy reservation entries and Force Shield ward fields, never character identities or gameplay payloads.

Exact scope: `envenom`, `eagle_eye`, `holy_shield`, `shield_wall`, `battle_cry`, `arcane_surge`, `force_shield`, `ignite`. Node rows require exact authored mechanic kind/effect type, self source/target and no creature target; reservation rows require `reservation`/`cp_reservation`. Legacy effects require an exact stance effect key, self ownership and `lifetime=stance`, or `lifetime=timed` with matching `source_ability_key`. Only these JSON reservation keys and `stance_state.force_shield_hp` / `force_shield_updated_at` are subtracted. Labels, arbitrary mitigation/absorb rows and creature-targeted Poison/Ignite stacks are not deletion predicates.

The historical `sync_stance_effects` trigger can delete stance effects after reservation updates, so identified effects are removed first and unknown stance lifetimes refuse. The `UPDATE OF hp`, location and activity triggers are not fired by JSON-only updates. The existing trusted-RPC marker prevents legacy resource clamping; unknown relevant update/delete triggers, deferred triggers or effect deletion dependencies refuse. Protected fingerprints check complete expected character rows (including unchanged raw resources and ordinary `updated_at=now()` metadata), inventory, remaining effects, encounter/participation/reward/intent/event/departure records and every existing `combat2_test_*` table. Reset DML and subsequent DDL have no internal commit or swallowed error.

Local tests are catalogue/static-SQL and JSON-subtraction fixture checks, **not executable PostgreSQL proof**. Historical installation checklist (Lovable reports full compilation completed; synthetic behavioral fixtures remain unavailable):

1. Confirm this version is absent from the ledger and the reviewed full file hash matches; retain maintenance/asleep/soak-off, no schedules, live claims, recordings or arena processing. Do not invoke gameplay to prepare it.
2. Inspect installed column types and trigger definitions against the historical contracts above (especially `update_updated_at`, `restrict_party_leader_updates`, `sync_stance_effects`), incoming effect FKs and wrapper/security/ACL predecessors. Report only aggregate classified/unknown counts. Unknown state requires a separate decision; supported state is approved for reset.
3. Compile the **entire corrected file** in a rollback-only transaction, not isolated auto-committed statements, and reach an external final verification sentinel after every statement. Lovable's previous complete attempt failed inside `combat2_change_stance` with SQLSTATE `42601` (composite multiple-target `INTO`); later statements were not compiled. Cleanup rolled back, the six supported node-effect rows remained, `character_stance` was absent and no ledger entry existed. Inspect those real six rows only within the rollback-only transaction, capture aggregate reset counts/protected comparisons and verify their restoration after rollback. Do not manufacture auth accounts or fake characters: synthetic Cloud fixtures are unavailable through the sandbox connection, so synthetic behavioral coverage remains a limitation. Local text/fixture tests are not PostgreSQL compilation.
4. Install once using an atomic migration-runner transaction. Capture preflight/postflight aggregate notices and verify zero remaining identified state, empty new stance/replay tables, unchanged protected surfaces (except the specified JSON and normal character update timestamp), intact RLS/ACL/Realtime isolation and wrapper composition. A notice from a rolled-back run is not installation evidence.
5. Regenerate official types only after installation; retain the existing proven Edge deployment list and manual frontend-publication requirement. Installation and bounded live stance checks remain separate evidence.

### ACL-only follow-up installation gate

`20261001230000_combat2_stance_helper_privileges.sql` denies PUBLIC/anon/authenticated execution on `drop_stance(uuid,text)` and both renamed `combat2_test_stop_without_character_stances(uuid,uuid)` / `combat2_test_reset_without_character_stances(uuid,uuid,boolean)` helpers. The Stop sibling inherited the same authenticated predecessor grant as Reset. Existing `activate_stance(uuid,text,integer)` and `apply_force_shield_regen(uuid)` already deny browsers through historical PUBLIC/anon revocations plus the installed authenticated revocation; other renamed helpers are explicitly server-only. The new migration checks these facts and refuses unexpected overload/security/path/wrapper drift. Canonical stance projection/change and Arena Stop/Reset remain authenticated/service-role callable; server-side ownership/admin checks remain in their unchanged bodies. No browser regeneration timer or RPC is restored.

Lovable must compile the **entire new ACL migration** rollback-only through an external final sentinel, inspect exact signatures, owner postgres, security mode, volatility, search paths and effective role privileges (including PUBLIC/default/inherited grants), and confirm rollback restores old ACLs. After separately authorized atomic installation, verify anon/authenticated denial on obsolete drop and both helpers; postgres/service_role access; retained canonical authenticated access; unchanged function bodies/metadata and wrapper delegation plus stance restore. Do not invoke mutators, manufacture fixtures or replay the installed reset. No Edge redeployment is needed for this ACL-only follow-up: both consumers are already reported deployed from `09cd8934`. Mik's stance frontend publication and bounded live checks remain separate pending steps.

`clear_stances(uuid)` is retained only for explicit Combat2-flag-off entry compatibility in `GameRoute`; ENG-LEGACY-002 skips it throughout the enabled rollout. Its historical SQL/grants/Arena dependencies are unchanged. Combat2 OOC ward display reads `state.ward_remaining` through the existing stance projection, refreshed by authoritative resource delivery; combat uses attached effects. No browser regeneration or guessed capacity is added. Resources retain combat/OOC ownership and acknowledgement fences. Source awaits Mik's manual publication; live ward/party transitions remain pending.

Mik approved immediate, idempotent stance activation/drop with one combat action slot consumed when an encounter is active. Authoritative death clears every stance, reservation and persistent ward; respawn never restores them. Class/loadout changes that would invalidate a stance refuse until it is dropped, while compatible changes remain allowed. Reservations dynamically follow current effective maximum CP using the authored percentage and rounding. Cap changes neither charge nor refund CP; if reservations exceed raw CP the stance remains active and spendable CP is zero, and dropping remains possible at zero spendable CP.
