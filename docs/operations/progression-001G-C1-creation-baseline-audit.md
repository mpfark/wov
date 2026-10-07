# ENG-PROGRESSION-001G-C1 — Character creation baseline audit

**AUDIT / DESIGN INPUT COMPLETE. Creation not implemented; STOP before C2.**

Source checkpoint and synchronized main: `215f91f86ec176dac8119ea208651e085dbfe1a6`.
Fetch found no incoming changes; clean checkout at intake. Recorded baseline is
an ancestor. Recovery stash: `0a5529d5227675319b166881b10f1c91edd7486b`, preserved.
No hosted inspection, player-data read, secret inspection, gameplay write,
runtime/SQL/migration/fixture/test/config change, deployment, activation or publication.

Authority: [O7/O13 owner policy](../design/progression-001G-B-admin-policy.md),
[B contracts](../design/progression-001G-B-command-contracts.md), [B phase plan](progression-001G-B-execution-plan.md),
[A audit](progression-001G-A-admin-creation-audit.md), [operating contract](lovable-supabase-operating-contract.md).
Affected engine sections: Resources; Progression and rewards; Resources, provenance
and trainer; Transactional authority. Roadmap ENG-PROGRESSION-001G/C1. This task
preserves approved rules and the one authoritative world heartbeat; recommendations
and numerical examples are not new owner-approved defaults.

Evidence classes: **S** inspected executable local source; **M** frozen historical
migration text; **H** retained timestamped operator metadata; **I** installed-state
unknown requiring separately authorized inspection; **O** owner decision. M is
not the current database. H is not new/current Codex hosted verification.

## Findings

1. The frontend supplies permanent attributes, class/classless, HP/maxHP and AC.
   The frozen RPC derives owner/location but accepts those computed values.
   Authenticated browser table INSERT is revoked in that source, but the
   owner-definer RPC can INSERT. The progression fence covers UPDATE, not INSERT.
2. Page-generated CP is discarded by the hook; RPC omits CP/MP. Retained installed
   metadata reports CP100/100 and MP100/100 defaults. Conditional unarmed L1
   calculations below yield CP30 for all six fallback races. This establishes a
   source omission and discrepancy, **not a fresh production failure**.
3. Source creation has no canonical sidecar/creation receipt or stable UUID.
   The existing progression receipt vocabulary also excludes creation; simply
   inserting a version0 receipt would conflict with F continuity checks.
4. Historical gold200/material-trigger salvage40 conflict with UI gold100/salvage42.
   Removed May starter code granted salvage42 and gold+30; its existence does
   not authorize restoring those amounts.
5. No currently authoritative starter equipment manifest is established locally.
   The old function and both catalogs were explicitly dropped. O7 requires gear;
   exact items/configuration remain a blocker rather than an empty approved kit.
6. Family is a separate optional request after creation. Its failure can leave
   a usable character while the success message still prints the requested family.
   Recommend optional idempotent setup, subject to owner approval.
7. No delegated admin character creation route was found in the reviewed admin
   UI/endpoint. Normal RPC targets auth.uid(); Overlord does not imply permission
   to create for another user. Installed definitions and external callers remain I.

## A. Complete request, INSERT and initialization trace

| Stage | Exact evidence | Proven behavior / uncertainty |
|---|---|---|
| Entry | [Index:74](../../src/pages/Index.tsx#L74), [CharacterSelect:125](../../src/pages/CharacterSelect.tsx#L125) | Auth/onboarding/loading gates; no characters or Create New renders creation. Browser startingNode must exist; server uses respawn-config node instead. Admin-only session redirects to admin atIndex:43. No character-slot cap found in this path. |
| Choice/preview | [CharacterCreation:22](../../src/pages/CharacterCreation.tsx#L22), [registry](../../src/hooks/useRaceRegistry.ts#L13), [calculateStats:68](../../src/lib/game-data.ts#L68) | Fixed classless preview; race selection based on mutable client registry/fallbacks. Name whitespace stripped/max24 in UI; gender male/female; optional family validation. Server must independently validate every choice. |
| Command construction | [page:98](../../src/pages/CharacterCreation.tsx#L98) | Sends name/gender/race/class, six computed stats, HP/maxHP/AC, browser startnode, CP/maxCP, is_classless=true. No UUID, catalog revision or receipt expectation. |
| Adapter | [useCharacter:356](../../src/features/character/hooks/useCharacter.ts#L356) | Only proceeds with current user; sends fourteen RPC arguments. CP/maxCP and startnode are discarded. Missing gender defaults male; missing classless defaults false. Appends returned character to local list. |
| Authority | [character_create:18](../../supabase/migrations/20260908175256_2e41c1c0-9b14-40a2-9627-68f6cf7dbc2b.sql#L18) | S-call/M-body: VOLATILE SECURITY DEFINER, search_path=public,auth,pg_temp; auth.uid() nonnull; server startnode from respawn config, rejects null/arena; trimmedname1..40; negative numeric inputs and hp!=maxhp refuse. No derivation or race active/selectable check, no classless consistency enforcement, upper stat envelope or UUID. Null handling relies on SQL expressions/NOT NULL constraints rather than complete explicit validation. |
| INSERT | [RPC:32](../../supabase/migrations/20260908175256_2e41c1c0-9b14-40a2-9627-68f6cf7dbc2b.sql#L32) | Inserts user/name/race/class/gender/sixstats/hp/maxhp/ac/currentnode/classless. Level/XP/points/tokens/RP/resources otherwise defaults; no explicit gear/family/sidecar init. Includes casts to character_race/character_class/gender. |
| Defaults/constraints | [C installed schema](progression-001C-installed-preflight.md#a--character-schema) H2026-10-04 | Sixstats10; L1 XP0; class/race textFK; classlessfalse; pool/tokens/RP/lifetime0,ranks{}; HP20/20 CP100/100 MP100/100 AC10. Checks level1..100,pool0..200,hp>=0,maxhp>=1,ac0..50,gold>=0; unique name. No checks then on XP/sixstats/CP/MP/tokens/RP. Latest installed definitions I. |
| Trigger | [materials:1–25](../../supabase/migrations/20260803232302_acc7c4e5-4148-48c0-8f35-8c2299e23944.sql#L1), [H trigger inventory](progression-001C-installed-preflight.md#c--character-update-triggers) | AFTER INSERT grants materials in the INSERT transaction. H inventory reports it enabled; no creation resource-sync trigger listed. Other present constraints/triggers/delegation I; inspect rather than infer absent. |
| Return and family | [Index:84](../../src/pages/Index.tsx#L84), [page:115](../../src/pages/CharacterCreation.tsx#L115), [family:160](../../supabase/migrations/20260610100423_3b7b3bc3-161e-4cb6-a48b-1150b5cd57f3.sql#L160) | Parent clears create screen before optional family finishes. Separate RPC may found family or attach existing membership; failure cannot roll back creation. Selection follows; success text uses requested family even on error. Family private records are not inspected here. |

Client inputs needing removal as authority: sixstats, class/classless, HP/maxHP,
AC, CP/maxCP and location. Name/race/gender/family remain choices but require
server validation, canonical normalization and current catalog/ownership checks.
Owner is already derived in M; no user_id argument. Client catalog revisions may
support a stale-preview refusal but never choose unapproved server baseline values.

[Class migration:58](../../supabase/migrations/20260731134850_336008d6-3bf4-4dcc-8f5d-53498b5591bf.sql#L58)
drops character_class after converting column to text; [race migration:54](../../supabase/migrations/20260809195546_5964d9fa-3b48-4be2-bdcd-4668d0b5a18c.sql#L54)
converts race to textFK but leaves historical enum casting in later creation text.
Removed class enum/custom race incompatibility is a **likely regression**, not
proof the hosted RPC fails. Earlier supplied B/E reports preserved RPC identity;
they do not supply enough current full body evidence to settle this.

Creation INSERT inventory from repository search: this current RPC plus historical
`c2_harness_run`/`c2_harness_run_c` fixture INSERTs in
[August harness](../../supabase/migrations/20260813111901_0280af33-fbbd-496a-8686-e18f39c5626c.sql#L59)
and [second harness](../../supabase/migrations/20260813123556_def190db-e5b8-4122-ae7d-1e2737cee161.sql#L51).
[Cleanup:12](../../supabase/migrations/20260813123836_c4974ea6-8fad-4ccd-b5e2-252f5e9cdb82.sql#L12)
drops those harness functions; E supplied preflight reports harness absent.
No current browser direct character INSERT or admin-users creation action found.
Search covers src, Edge and Supabase/Drizzle SQL; dynamic/external installed
callers remain I. Nothing in this inventory authorizes fixture creation on hosted DB.

## B. Race/class and progression baseline

All six **fallback-defined/source-seeded** races below match current fallback
[races:29](../../src/shared/formulas/races.ts#L29) and [historical seed:46](../../supabase/migrations/20260809195546_5964d9fa-3b48-4be2-bdcd-4668d0b5a18c.sql#L46).
They are the complete static source list, **not the complete current hosted list**:
catalog CRUD permits additional races. Registry replacement clears fallback keys;
getSelectableRaceKeys requires is_selectable and status=active once loaded
([registry:67](../../src/shared/formulas/races.ts#L67), [selection:103](../../src/shared/formulas/races.ts#L103)).
Before load all fallbacks are selectable; after failure fallback remains. Creation
does not wait for confirmed catalog loading. Catalog updated_at is not an immutable
applied version; no creation catalog version/provenance is persisted in this path.

| Race | STR,DEX,CON,INT,WIS,CHA modifier | Conditional attributes = base8+modifier |
|---|---|---|
| Human | 1,1,1,1,1,1 | 9,9,9,9,9,9 |
| Elf | -1,2,-1,2,3,0 | 7,10,7,10,11,8 |
| Dwarf | 2,-1,4,0,1,-2 | 10,7,12,8,9,6 |
| Halfling | -2,3,1,0,1,2 | 6,11,9,8,9,10 |
| Edain | 1,0,3,1,1,1 | 9,8,11,9,9,9 |
| Half-Elf | 0,1,0,1,2,3 | 8,9,8,9,10,11 |

Base8 is S calculateStats; column default10 is H/M fallback, not an alternative
approved baseline. Old admin reset race constants are not creation authority.
Valid selectable current race rows/revisions and their validation remain I/O.

| Field | Source / approved ordinary-rule evidence | C2 interpretation |
|---|---|---|
| Class | Pageclassless, classless=true; [class seed:40](../../supabase/migrations/20260731134850_336008d6-3bf4-4dcc-8f5d-53498b5591bf.sql#L40) Wayfarer/pre-class/active, baseHP18/baseAC10 | O7 classless Wayfarer fixed by server; verify class row even though it is not a normal selectable class. |
| Level/XP | H defaults1/0; [engine ordinary rules](../design/game-engine.md#progression-and-rewards) L1 start, XP remainder, cap42 | Explicit1/0, not mutable input or schema's historical100 upper bound. |
| Discretionary/class growth | Canonical no L1 grant; first point L2, growth destinations3/6/…42; classless growth0 | Initial pool0/invested counters0; no earned growth rows atL1. Do not fabricate milestones. |
| Tokens | H respec_points0; earned10/20/30/40 later | Explicit0 unless separately approved starting reward; empty earned milestones. |
| Renown | H bhp0,bhp_trained{},lifetime0; no current creation writer | Explicit reviewed0/empty-ranks/0; no training, HMAC or RP earning on creation. |
| Version/baseline | [C sidecars:6](../../drizzle/migrations/0001_progression_001c_dormant_authority.sql#L6) lazy opaque_baseline/counters/version0 | New creation should have proved origin recorded separately and initialized compatible state; never relabel legacy opaque baseline canonical. |
| Applied catalog | Current create captures none; canonical growth fingerprints at later XP transitions | O13 capture exact race deltas/class/resource inputs and immutable semantic revision in creation proof; no retroactive race/growth rewrite. |

## C. Resources, AC, regeneration and ordering

Let m(x)=floor((x−10)/2), p(x)=max(m(x),0). Verified S:
[stats:11](../../src/shared/formulas/stats.ts#L11), [resources:17](../../src/shared/formulas/resources.ts#L17),
[AC:230](../../src/shared/formulas/combat.ts#L230), [class fallbacks:26](../../src/shared/formulas/classes.ts#L26).
Canonical private [resource authority:82](../../drizzle/migrations/0001_progression_001c_dormant_authority.sql#L82)
uses classes.base_hp and usable equipped inventory; ordinary
[sync:4](../../supabase/migrations/20260922112544_a2d63b3d-4f07-4641-a911-f6cf25ee1b45.sql#L4)
uses historical CASE baseHP, owns_character and clamp-only current pools. H C
reported their classless values agreeing then; current catalog equality remains I.

- MaxHP=clamp(class baseHP+2m(effectiveCON)+5(L−1)+flat gearHP,1,10000).
- MaxCP=clamp(30+3(L−1)+3[p(effectiveINT)+p(effectiveWIS)],0,5000).
- MaxMP=clamp(100+10p(effectiveDEX)+floor(2(L−1)),0,5000).
- Preview baseAC=class baseAC+m(DEX); S effectiveAC adds effective gearDEX,
  flatgearAC and shield+1. Private canonical resource sync **does not write AC**.
  Persisted base versus effective AC initialization needs explicit C2 design;
  avoid persisting gear-effective AC then adding equipment twice in consumers.

**Conditional examples only:** L1, base8 plus the listed seed race, classless
baseHP18/baseAC10, no equipment/gems/effects. Values below are formula derivations,
not an approved kit or current production catalog. Current initial pool fill
policy needs approval; maxima do not imply current pool amounts.

| Race | MaxHP | MaxCP | MaxMP | BaseAC | Base HP regen / CP regen / MP base rate |
|---|---|---|---|---|---|
| Human | 16 | 30 | 100 | 9 | 2 / 2 / 3 |
| Elf | 14 | 30 | 100 | 10 | 2 / 3 / 3 |
| Dwarf | 20 | 30 | 100 | 8 | 3 / 2 / 3 |
| Halfling | 16 | 30 | 100 | 10 | 2 / 2 / 3 |
| Edain | 18 | 30 | 100 | 9 | 3 / 2 / 3 |
| Half-Elf | 16 | 30 | 100 | 9 | 2 / 2 / 3 |

Base HP regen=2+floor(sqrt(max(0,effectiveCON−10))); CP analog with WIS;
MP base rate=round((5+p(DEX))×0.67). L1 HP/CP milestone bonuses0. Source
[OOC settlement:159](../../supabase/migrations/20260923100000_authoritative_ooc_resource_settlement.sql#L159)
applies four-second buckets, gearHPregen, inn+10 and MP two base intervals.
Engine excludes dead/arena/unsafe lifecycle and bounds catch-up. Existing class
CASE versus current catalog is a compatibility dependency, not permission to
rewrite settlement. Creation must not invoke scheduler/settlement, wake world,
bank past regen or create a second heartbeat/cursor. New individual resource
state, if any installed mechanism requires it, must be identified by metadata;
the settlement cursor in reviewed source is world singleton, not per new hero.

Historical CP100 default exceeds conditional30. MP100 happens to agree for these
unequipped races, but additional races/gear may not. No creation sync is proven.
Later settlement computes caps but only increments resources below caps in this
source, so it is not a guaranteed repair of excess CP. Calling public sync later
can clamp but would not make creation atomic. HP fixed “18”/AC“10” prose in the
page differs from race-dependent previews; do not turn prose into a rule.

Required proposed order: pin catalog/manifest and ownership → serialize request,
owner slot/name constraints → construct permanent race/classless baseline →
INSERT row and reviewed trigger effects → initialize materials/approved gear
exactly once with valid equip state → calculate **final** gear-dependent caps
and approved current pools/AC representation → compatible sidecars/provenance/
creation receipt → mandatory family if selected by policy → commit → return
authorized actual projection. Any hidden INSERT trigger that sees provisional
resources requires design reconciliation before implementation.

## D. Starting economy and equipment

| Input | Evidence | Status / reconciliation |
|---|---|---|
| Gold | [June default](../../supabase/migrations/20260624095137_39c3be11-82fa-4bd0-8384-7004403b09e8.sql#L1)200; [UI:307](../../src/pages/CharacterCreation.tsx#L307)100 | M/S conflict; exact amount O and current default I. RPC omits gold. |
| Salvage | [August trigger:10](../../supabase/migrations/20260803232302_acc7c4e5-4148-48c0-8f35-8c2299e23944.sql#L10)40; UI42 | M/S conflict; exact amount O. Trigger UPSERT DO NOTHING does not validate an existing conflicting count. |
| Primary gems | Same trigger1 each garnet/topaz/emerald/sapphire/pearl/amethyst; UI ×6 | Six total agrees with M but UI hides per-type detail; current installed grant I/owner approval O. Gems in materials are not already socketed gear. |
| Other economy | No other creation grant found in current caller/trigger | Absence of current source writer is not installed absence. Material catalog defaults/other INSERT triggers I; no invented soul/ring/boss currencies. |
| Historical grant | [May function:1](../../supabase/migrations/20260522222430_f6b0db55-476f-498e-80e7-ac8c00506502.sql#L1): class weapon durability100/main_hand, gold+30,salvage42,primarygems1 by additive UPSERT | Removed July; plausible provenance of stale42 text, not proof or approval of current kit. |

Double-grant risks: calling a new explicit grant while old trigger remains;
reviving removed additive May code; replay with fresh UUID; unconditional recovery
top-up. Missing grants: disabled/absent trigger or obsolete defaults, trigger
ONCONFLICT skipping preexisting incompatible row, optional postcommit grant
failure. Same INSERT+enabled trigger is one transaction: trigger failure rolls
it back, rather than a proven partial materials commit.

Gear history: [class catalog February](../../supabase/migrations/20260212224152_81ff0949-9f2b-4ce0-87fe-d0d6fb805990.sql#L3),
[universal catalog February](../../supabase/migrations/20260220185538_ee454996-c7e9-4afd-be62-b73eda880289.sql#L3),
[March combined grant](../../supabase/migrations/20260317101118_fb985c3b-0988-4e4e-8f5c-2680944c913f.sql#L118),
May replacement above, then [July explicit DROP](../../supabase/migrations/20260730085821_18900070-315c-4ac1-8fec-fe778a52ca2d.sql#L1).
No current create caller invokes gear; no current authoritative replacement
manifest found. Generic items catalog is not a starter selection policy.

[Inventory equip authority:85](../../supabase/migrations/20260908213420_bbfa1b05-0000-4dbf-b662-1ab7e37699c9.sql#L85)
requires durable equipment, template-compatible slot/ring2, two-hand/offhand
compatibility and exclusive slot state. Historical slot revision:
[June enum:22](../../supabase/migrations/20260611091420_a96cef21-271d-47ea-94c5-c00c06e71e71.sql#L22)
head,chest,gloves,pants,ring,ring_2,trinket,main_hand,off_hand; current enum I.
Inventory default durability100 and [repair helper:125](../../src/shared/formulas/items.ts#L125)
fixed100 comment coexist with SQL repair using item.max_durability. Exact template
durability and limits must be verified, not copied from old admin INSERT100.
[Unique holder triggers:188](../../supabase/migrations/20260915190000_combat2_authoritative_reward_model.sql#L188)
and deferred constraints can affect INSERT; no approved unique starter item is
assumed. Equipment manifest fields and exclusion/version rules are proposed in
[the manifest](../design/progression-001G-C1-creation-manifest-proposal.md).

## E. Sidecars, receipt, atomicity and retry design

Current creation has no explicit C state, receipt, respec or growth milestone
writer. C lazy init is expected for existing opaque characters. For newly created
characters propose compatible version0 state with six invested counters0 and a
separately linked proved-origin snapshot; no growth/respec earned rows atL1.
Do not relabel C's `opaque_baseline` field or claim it reconstructs old characters.
[F operation check:209](../../drizzle/migrations/0005_progression_001f_canonical_renown_respec_authority.sql#L209)
allows xp/permanent/order/respec/renown only. [F continuity:257](../../drizzle/migrations/0005_progression_001f_canonical_renown_respec_authority.sql#L257)
refuses existing progression receipts atversion0. Recommendation: a distinct
private creation receipt/request ledger linked to version0 origin, rather than
pretending creation is a zero-XP or permanent adjustment. Exact schema/privileges/
proof retention belong to separately authorized C2; no migration authored here.

Proposed atomic boundary includes character, all required sidecars, actual initial
pools/caps, approved currency/materials, starter inventory/equipped state, applied
catalog evidence, immutable creation request/receipt and mandatory family if
chosen. Single authority must account for every enabled trigger/delegate. Existing
receipt keys include character_id, so cannot deduplicate before creating it;
proposed creation intent identity is actor+stableUUID, pinned targetowner/mode/
normalized choices. Same actorUUID binds exactly one result even under concurrency.

| Scenario | Required proposed behavior |
|---|---|
| SameUUID/same normalized input | Return original character/receipt, no new INSERT/grants/catalog derivation. Authorize read before returning; original applied revision stays frozen. |
| SameUUID/different input/target | Refuse conflict; client cannot change name/race/adminowner to overwrite committed intent. |
| Failed grant/derived init/deferred constraint | Whole creation rolls back, including triggers/proof. No publicly selectable provisional row. |
| Response lost after commit | Retry originalUUID or own authenticated receipt lookup; no newUUID duplicate creation. |
| Two calls same intent | Lock unique intent before creation, serialize commit/replay. Read-then-insert alone is insufficient. |
| Distinct intents same name | Database normalized-name uniqueness arbitrates; loser rolls back; exact current normalization/index/collation I/O. No name auto-renaming. |
| Distinct names same owner/slot limit | Serialize on owner quota boundary if an approved slot limit exists; no limit found in source. Decide whether tombstones count under O8. Never invent a cap. |
| Partial old character | Separate evidence-led recovery case; do not re-run full creation/gear grants or infer missing amounts from current state. |
| Catalog changes during creation | Pin validated revision and concrete values in transaction; reject incompatible expected preview; replay old committed revision. |
| Deleted result | No resurrection on replay; return authorized historical status under O8/privacy contract, not a second hero. Retention/replay tombstone design unresolved. |

Family models: mandatory atomic linkage makes selected family success part of
creation; it serializes founder-name claims and rolls back the character on
reserved name/membership conflict. Optional idempotent setup commits complete
character first; separate server-owned family request has its own UUID/version,
normalized name, owner/membership checks and truthful pending/refused/replayed
result. **Recommend optional model**, consistent with current optional field and
avoiding social approval blocking an otherwise valid hero, but owner chooses.
Do not claim current apply_family RPC is idempotent: it has family-name advisory
lock but no stable request receipt/character version; it also exposes clear-family
behavior separately from the one-time change wrapper. Household means reviewed
families/members/requests only; no separate household creation authority found.

## F. Admin parity, decisions and C2 gate

Inspected [admin endpoint](../../supabase/functions/admin-users/index.ts#L56),
[UserManager](../../src/components/admin/users/UserManager.tsx#L43) and AdminPage:
character editing/grants, no create-character command/UI. An admin with a normal
player session can call the same auth.uid()-owned creation source; the admin-only
session UI redirects away from that flow. Service_role EXECUTE does not confer
an arbitrary targetowner argument or satisfy auth.uid() automatically. No role
check in current RPC grants another user's ownership. Current hosted routes I.

Future player/admin modes must share the same private baseline builder/manifest/
transaction. Ordinary mode derives targetowner=verifiedactor. A future delegated
mode must independently authorize actor role, approved target user/delegation,
reason/evidence and approval, record both identities, enforce target quota/name
rules and deny spoofed ownership. **No admin delegation permission chosen here**;
absence of approved delegation means no create-for-other route.

Owner decision checklist:

1. Approve exact base attribute source and selectable race/classless catalog
   revision after metadata; reconcile base8 versus schema10, never choose by age.
2. Approve initial HP/CP/MP fill policy and base/effective AC representation,
   after final starter gear; maxima alone do not decide current resources.
3. Approve exact gold/salvage/gems/other starting amounts and single grant owner;
   explicitly settle200/40 versus100/42 rather than selecting one silently.
4. Supply/approve exact starter item manifest, quantities, equip state/slots,
   template revision, durability, eligibility and ownership; no valid starter
   catalog established, so C2 cannot invent items or treat no gear as approved.
5. Choose optional idempotent family setup (recommendation) or mandatory atomic
   selected-family linkage; define founder/membership races and truthful outcomes.
6. Confirm name normalization/case/length/uniqueness and character-slot policy,
   including deleted-character quota handling. Source UI24 versus RPC40 is a gap.
7. Decide if any role may create for another user and exact delegation/evidence/
   approval/target checks. O7 parity alone grants no delegation.
8. Review immutable catalog version/publication authority underO13 and creation
   proof/replay retention compatible withO8/O11. Creation ledger design requires
   continuity review, not reopening existing receipt checks.
9. Separately authorize the [read-only metadata request](progression-001G-C1-hosted-metadata-request.md)
   and later bounded C2 local implementation. Unrelated D award decisions remain
   deferred; no OverlordXP cap decision is needed to inspect creation metadata.

**C2 gate:** owner-authorized, timestamped installed metadata settles exact creation
body/types/defaults/constraints/triggers/delegates/ACL/FKs/current catalogs and
grant mechanisms; owner approves a complete reconciled manifest and unresolved
creation policy; local C2 scope separately authorized with rollback/replay/sidecar
compatibility acceptance. Any unknown baseline, missing kit, unexpected definer
capability, mandatory linkage or trigger side effect stops affected implementation.
Lovable inspection, SQL installation, Edge deployment, activation, gameplay writes
and Mik's manual frontend publication each remain separately authorized.

## Validation, handoff and retained limits

Fresh validation:35 existing tests passed (formula-parity26, character-location
authority6, project-state3); project-state generated and checked;66 relative
document/source links and their anchors/line ranges resolved. Direct in-memory
execution of the inspected TypeScript formula helpers confirmed all six
conditional example rows; no artifact/fixture was written. Manifest coverage
review checked baseline, resource/AC/regen, economy, all starter-entry fields,
sidecars/origin, family/delegation and retention againstO7/O13/B. Docs-only
path/diff checks passed. Vitest's existing configuration deprecation warning is
not a product failure; no baseline test failed in these limited C1 suites.
Tests check source contracts,
not installed creation execution; no production character is created. No build
or typecheck is needed for this documentation task. A's217passes/1 archival
baseline failure and B's3passes are historical evidence, not new C1 runs.

Handoff fields: starting/synchronized SHA above; final local/remote SHA returned
after normal commit/push; ancestry verified; cleanworktree/stash rechecked. Only
three C1 documents, project-state JSON/generatedMarkdown and roadmap pointers
change. Migrations authored/installed:none; generated types unchanged; Edge and
frontend unchanged; Cloud/gameplay operations:none. No deviations from read-only
scope. Next safe action is owner review and separately authorized metadata intake.

[F closure](progression-001F-closure.md) remains **CLOSED / INSTALLED / VERIFIED /
EDGE DEPLOYED / COMMANDS PAUSED / FRONTEND NOT PUBLISHED**. Retain:

```text
HOSTED MULTI-SESSION BEHAVIOR UNPROVEN
NATURAL RUNTIME PATH NOT YET OBSERVED
AUTHENTICATED COMMANDS-PAUSED RUNTIME PROBE NOT EXECUTED
RP EARNING AUTHORITY GAP
```
