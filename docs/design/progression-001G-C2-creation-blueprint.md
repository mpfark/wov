# ENG-PROGRESSION-001G-C2 — Revised creation implementation blueprint

**BLUEPRINT REVIEWED / DESIGN ONLY / IMPLEMENTATION NOT AUTHORIZED.**

Owner's revised C2 request supersedes Walking Staff/socket requirements: new
characters have **no equipment and no inventory items**. Materials are separate.
This is the current creation policy where earlier [B policy](progression-001G-B-admin-policy.md),
[B contracts](progression-001G-B-command-contracts.md), [B plan](../operations/progression-001G-B-execution-plan.md)
and historical [C1 audit](../operations/progression-001G-C1-creation-baseline-audit.md)/
[manifest proposal](progression-001G-C1-creation-manifest-proposal.md) required gear
or left now-approved choices open. Those earlier documents retain their historical
evidence; no staff/socket catalog inquiry is a current C2 gate.

Source checkpoint: `2245354612807b18d58d8f502fc2cbde3fea4b62`, clean main at intake,
equal to fetched origin/main; recorded baseline ancestor preserved. Recovery stash
`0a5529d5227675319b166881b10f1c91edd7486b` unchanged. Guidance:
[operating contract](../operations/lovable-supabase-operating-contract.md),
[AI guide](../operations/ai-operating-guide.md), engine Resources/Progression/
Transactional authority; roadmap ENG-PROGRESSION-001G. Prospective creation and
family rules are intentionally revised by owner; ordinary progression, combat
mechanics and the one authoritative world heartbeat remain unchanged.

## 1. Revised policy and scope

| ID | Binding requirement / disposition |
|---|---|
| C2-01 | Gold 200, salvage 40, one each garnet/topaz/emerald/sapphire/pearl/amethyst; one authoritative material grant. |
| C2-02 | Full calculated initial HP/CP/MP; server-owned maxima and AC. |
| C2-03 | **Previous staff/socket requirement SUPERSEDED.** No equipment, no inventory items, no substitute weapon, no item catalog/socket fields or enforcement; no crafting XP. |
| C2-04 | No family at creation; gameplay joining from L1, founding from L10 in shared server authority. |
| C2-05 | Global case-insensitive unique names enforced in database. |
| C2-06 | At most five characters/account, serialized on target account. |
| C2-07 | Only Overlord creates for another account; required reason/audit, identical baseline/quota. |
| C2-08 | Existing characters unchanged; no automatic normalization/backfill/rename. |
| C2-09 | Immutable versioned creation snapshot and separate receipt. |
| C2-10 | Atomic/idempotent UUID-bound creation, concurrency-safe exactly-once grants. |
| C2-11 | Soft-deleted characters count until permanent purge. |
| C2-12 | Staff/item-definition work **DEFERRED to ENG-ITEMS-001**, outside C2. This label is a deferred tracking entry, not an additional approved item rule. |
| C2-13 | Socket-capacity representation/enforcement **DEFERRED to ENG-ITEMS-001**, outside C2. No new socket system approved here. |

Deletion/restore/purge remains a separate scoped dependency. No crafting reactivation,
item-system redesign, combat redesign or automatic existing-character update.

## 2. Evidence matrix

S=verified local source; M=frozen migration text; H=owner-supplied summary of
Lovable read-only observation 2026-10-08 approximately 09:19–09:21 UTC; U=unknown;
P=proposed design. Original full hosted report unavailable. H is reported metadata,
not independent Codex inspection or successful runtime proof. Prior C2 audit and
reconciliation were conversation reports, not committed repository files.

| Finding | Evidence / exact source | Design consequence |
|---|---|---|
| Client computes baseline/CP omitted | S [page:98](../../src/pages/CharacterCreation.tsx#L98), [hook:356](../../src/features/character/hooks/useCharacter.ts#L356) | Choice-only adapter; remove family/stat/resource/class inputs. |
| RPC trusts stats/HP/AC, Auth owner/start config | M [RPC:18](../../supabase/migrations/20260908175256_2e41c1c0-9b14-40a2-9627-68f6cf7dbc2b.sql#L18), H matching behavior/one overload/postgres definer/auth+service EXECUTE | Replace narrow entry and fence old signature after caller review. |
| Missing class enum cast | M same RPC and [type drop:58](../../supabase/migrations/20260731134850_336008d6-3bf4-4dcc-8f5d-53498b5591bf.sql#L58); H absent type/text FK | Installed inconsistency reported; runtime failure U. Use validated textFK/catalog, not old casts. |
| Gold 200/material grant40/six gems | M [gold](../../supabase/migrations/20260624095137_39c3be11-82fa-4bd0-8384-7004403b09e8.sql#L1), [trigger](../../supabase/migrations/20260803232302_acc7c4e5-4148-48c0-8f35-8c2299e23944.sql#L1); H enabled trigger/default 200 | Keep trigger sole material writer if exact dependency evidence agrees; assert final values. |
| Six races/Wayfarer 18 HP/10 AC | S [races](../../src/shared/formulas/races.ts#L26)/[classes](../../src/shared/formulas/classes.ts#L26), M seeds, H active/selectable races and active pre-class/not selectable Wayfarer | Server validates current race and captures actual values; classless start is not a user-selected class. |
| Defaults CP100/MP100, six stats 10 | H and [older C metadata](../operations/progression-001C-installed-preflight.md#a--character-schema) | Do not confuse defaults with canonical base 8 + race or full calculated capacity. |
| No quota, case-sensitive unique name, service character/inventory INSERT | H; M [name constraint](../../supabase/migrations/20260213142629_aa4f9fa2-4fd6-455e-962a-e2ab0ea0efc9.sql#L1) | Shared account lock, new name enforcement, narrow INSERT containment. Effective inherited paths U. |
| Family founding ungated | M [apply:160](../../supabase/migrations/20260610100423_3b7b3bc3-161e-4cb6-a48b-1150b5cd57f3.sql#L160), H ownership/no L10 gate | Gate actual founding branch; preserve existing-family membership branch. |
| No automatic gear/sidecar initialization reported | H; M removedgear/C lazy sidecars | Explicit no-item result; initialize proved new origin only. |
| Version0/opaque baseline/receipt vocabulary | S/M [C schema](../../drizzle/migrations/0001_progression_001c_dormant_authority.sql#L6), [F check:209](../../drizzle/migrations/0005_progression_001f_canonical_renown_respec_authority.sql#L209), H | Separate creation ledger; no syntheticXP or new operation in existing receipts. |
| Current delete/restore/purge, collisions, external writers | U; M [harddelete](../../supabase/migrations/20260623072204_ba238bbb-a55c-4000-8b35-69eb36bb3cba.sql#L1) | Separate lifecycle intake and activation containment; no live-data claim. |

## 3. No-equipment and unarmed compatibility

| Boundary | Verified source / limits |
|---|---|
| Character without items | Reviewed creation has no inventory INSERT; H no automatic kit. No mandatory main-hand FK/creation condition found. Fresh installed constraints U. |
| Resources | [C calculator:82](../../drizzle/migrations/0001_progression_001c_dormant_authority.sql#L82) aggregates equipped durable items with COALESCE(sum,0); empty equipment yields zero bonuses. [resource formulas](../../src/shared/formulas/resources.ts#L17) and [AC](../../src/shared/formulas/combat.ts#L230) need no item. |
| Combat snapshot/decoder | [snapshot type:65](../../src/shared/combat2/types.ts#L65) distinguishes absent mainhand from broken equipped data; [decoder:586](../../src/shared/combat2/decode.ts#L586) validates present entries, not a required slot. Empty array is valid; malformed/missing required snapshot structure is not silently treated as empty. |
| Entry | [combat_enter wrapper:13](../../supabase/migrations/20260922140000_combat2_engagement_release_lifecycle.sql#L13) checks mode/owner/request/engagement, no weapon requirement. Delegated installed entry chain and actual no-item snapshot projection need exact dependency verification; no live entry performed. |
| Canonical basic attack | [resolveMainHandDie:187](../../src/shared/combat2/mechanics.ts#L187) with no main returns unarmed; [UNARMED_DIE:47](../../src/shared/formulas/combat.ts#L47)=3. [basic attack:452](../../src/shared/combat2/mechanics.ts#L452) uses that die, STR modifier, minimum 1 and existing hit/crit/mitigation—not flat damage3. Authored ability unarmed overrides are distinct from basic attack. Broken equipped data refuses rather than falling back. Mirrored Edge mechanics contain same branch. |
| Inventory/equip | [useInventory:90](../../src/features/inventory/hooks/useInventory.ts#L90) permits no main; offhand guard only rejects existing two-hand conflict. [RPC equip:85](../../supabase/migrations/20260908213420_bbfa1b05-0000-4dbf-b662-1ab7e37699c9.sql#L85) validates actual items; no starter mainhand required. |
| Existing test evidence | [catalog test:153](../../src/shared/combat2/__tests__/catalog.test.ts#L153) expects empty equipment to resolve unarmed; resolver fixtures use equipment[]. Source tests, not hosted execution. |

No inspected source blocker requires granting a weapon. Remaining entry-chain/
snapshot metadata gaps must be reported/refused if contradictory, never worked
around with starter gear or relaxed combat validation. Hosted runtime compatibility
and multi-session behavior remain unproven.

## 4. Transaction, calculation and replay architecture (P)

Proposed public owner entry and distinct Overlord delegated entry both call one
private creation authority. Inputs: UUID/name/race/gender/optional expected published
manifest revision; admin additionally target account and nonempty reason. Family,
class/stats/resources/XP/Renown/items are not accepted authoritative inputs.
Verified identity/role and target owner are server derived. Service credential alone
is not Overlord authorization. Exact adapter (direct owner RPC or verified Edge)
must be reviewed against installed caller context and effective privileges.

Order: authenticate/authorize → serialize actor UUID and compare normalized payload
→ replay committed result or refuse conflict → lock target account → count all
retained characters → pin catalogs/manifest/name key → insert familyless L1/XP0
Wayfarer with explicit gold 200 → trigger-only materials → assert no inventory and
exact materials → calculate/write full HP/CP/MP and base AC → compatible C state
and immutable snapshot/separate receipt → commit → authorized result projection.
All triggers/deferred constraints participate; any failed substep rolls back all.

Request ledger unique(actor,request UUID), binding mode/target/name/race/gender/
expected revision/reason. Same payload replays original applied snapshot even after
catalog changes; changed payload refuses. Lost response retains UUID; UI never
creates a fresh intent automatically. Lock order request then target account and
stable catalog rows; separately review shared role/deletion locks to avoid cycles.
New hero has no encounter lifecycle to acquire; creation never invokes settlement,
claims, world wake or combat entry. Existing-character commands keep established
encounter-before-character ordering.

One private creation calculation path reads validated classless base HP/base AC and
server race modifiers; use canonical numeric expressions, checked arithmetic and
caps. **Do not call C's private mutating sync directly:** it rejects nonnull
auth.uid(), clamps CP/MP and is not initial-full-pool policy. Do not clear JWT/Auth
context, forge trusted flags or simulate level gain to bypass it. A reviewed
creation calculation adapter owns initial-fill policy with parity against C;
any future extraction shared with existing progression requires separate reviewed
forward replacements preserving behavior/ACLs, not opportunistic C refactoring.

m(x)=floor((x−10)/2). No equipment bonuses:
HPmax=clamp(class base HP+2m(CON),1,10000);
CPmax=clamp(30+3[max(m(INT),0)+max(m(WIS),0)],0,5000);
MPmax=clamp(100+10max(m(DEX),0),0,5000); base AC=class base AC+m(DEX).
Initialize currents exactly to maxima. Persist base AC; equipment consumers apply
later effective modifiers once. No regen/crafting XP earned by creation.

Using reported races, verified source base8 and reported classless18/10:

| Race | HP=current/max | CP=current/max | MP=current/max | AC |
|---|---|---|---|---|
| Human |16/16|30/30|100/100|9|
| Elf |14/14|30/30|100/100|10|
| Dwarf |20/20|30/30|100/100|8|
| Halfling |16/16|30/30|100/100|10|
| Edain |18/18|30/30|100/100|9|
| Half-Elf |16/16|30/30|100/100|9|

These are source-derived acceptance vectors for the reported catalog values,
not a current hosted runtime observation or permission to hardcode race tables.
Base 8 is current calculateStats source; schema 10 remains a default. Pin the accepted
server baseline/manifest at package review; no fallback catalog on missing row.

## 5. Name, quota, family and delegation authority (P)

Database unique normalized casefold key (proposed lower(btrim(name)) under reviewed
collation/Unicode policy); same normalization in creation/edit/lookups. Existing
collision groups block installation; no auto-renaming or partial “new only” index
that claims global uniqueness. Preflight aggregate-only counts immediately before
installation; database uniqueness arbitrates concurrent contenders.

Shared target-account lock (reviewed stable row/private account lock) before
count+INSERT. Count all retained rows without filtering tombstones. Existing
accounts above five remain unchanged; fresh creation refuses at>=5. Owner/admin/
permitted service paths share serialization. Restore does not add a slot; purge
must serialize on same account. No browser count check as security authority.

Family operations are outside creation. [apply](../../supabase/migrations/20260610100423_3b7b3bc3-161e-4cb6-a48b-1150b5cd57f3.sql#L160)
is the actual founder INSERT; [Heraldry delegate](../../supabase/migrations/20260610100423_3b7b3bc3-161e-4cb6-a48b-1150b5cd57f3.sql#L245)
and [panel](../../src/features/character/components/HeraldryPanel.tsx#L130) already exist.
At founding branch lock/revalidate acting owned nondeleted character L>=10 and
family-name identity; existing-family membership/attachment permits L1. Review
direct service family INSERT and delegates so the shared gate cannot be bypassed.
Preserve existing membership approval/one-change semantics unless separately
changed; no NPC creation implied. Family commands need their own safe lifecycle/
replay design, not a new family founding branch inside creation.

Delegated command: recheck authoritative Overlord role and valid target account,
required reason, approval context if existing admin policy requires it; record actor
and target distinctly. Steward/player/service-only identity cannot choose another
owner. Same quota/name/manifest, no parameter granting privileged starts.

## 6. Origin snapshot, receipt, audit and deletion boundary (P)

Propose private immutable creation snapshot, schema/policy/manifest version,
actor/target/mode/reason, normalized input, concrete base/race deltas, class/resource
inputs and formula identity, initial fields/materials, inventory=[], family=null,
creation timestamp and version0 link. Applied-value snapshot plus semantic identity
is mandatory even if current catalogs lack immutable revisions. Publication/version
mechanism needs review; updated_at alone is not immutable provenance.

Separate creation receipt/request result, not a new progression operation. C state
version0/opaque_baseline exact initial projection, invested counters 0; empty earned
growth/token milestones, initial point pool/tokens/RP/lifetime 0/ranks{}. New proved
origin linkage does not relabel legacy opaque baselines. [F continuity:257](../../drizzle/migrations/0005_progression_001f_canonical_renown_respec_authority.sql#L257)
must still accept first canonical event with no synthetic version0 progression
receipt. Private ACL/RLS/fixed search_path; no ordinary UPDATE/DELETE snapshot
permission. Immutable gameplay content and separately governed privacy linkage
must coexist with lawful anonymization; no indefinite identifying retention assumed.

O8 deletion dependency remains soft delete/30-day restore/Overlord restore/controlled
purge. C2 adds no full lifecycle implementation. **Activation stop:** old
delete_character_cascade or other exposed harddelete may bypass restoration window,
free quota or erase proof. Resolve by separately authorized lifecycle implementation
or explicitly reviewed fail-closed containment of affected deletion capabilities;
UI hiding alone is insufficient. Deletion metadata/cascade graph and cross-command
account locks required. No creation replay resurrects deleted/purged characters;
retain justified replay tombstone. Receipt retention/purge/name reuse details remain
owner decisions where O8/O11 do not settle them.

## 7. Reviewable packages and forward migration sequence

Each row requires separate authorization. Codex local preparation/tests; Lovable
metadata/install/types/deploy only separately authorized. Preserve canonical
Supabase historical record and all installed Drizzle SQL/journal/snapshots; use
established Lovable standard forward Drizzle lane, no tooling/history change.
Migration numbers assigned only against then-current journal. No SQL authored now.

| Package / modules | Forward change and security | Local proof / hosted prerequisite | Stop/go and recovery |
|---|---|---|---|
| P0 evidence intake/contract review | Docs only; obtain missing exact nonsecret schema/dependency/ACL definitions, role checks, safe entry/snapshot chain and deletion metadata; no staff/socket inquiry | Reconcile supplied H with exact relevant bodies; account/name normalization/retention decisions | First recommended package. Stop if unknowns cannot be scoped; no installation/mutation. |
| P1 identity/quota/origin storage | New forward private request/snapshot/receipt/account serialization schema and casefold uniqueness; explicit grants/RLS/FKs. Candidate local creation SQL/test modules, generated types later | Aggregate collision preflight before install; local distinct-intent quota/name races, immutable origin/replay storage and unchanged old characters | Stop on collisions/unsafe FK indices/incomplete quota serialization. Failed transaction rollback; installed correction forward-only. No existing-character backfill. |
| P2 private creation authority | New forward calculator/transaction/owner+Overlord entries; sole material trigger, no inventory, full resources and C state 0. New narrow SQL plus adapter if needed; no broad serviceUPDATE grants | Exact trigger/delegates/directINSERT callers; six-race vectors; every-substep rollback; version0/first XP parity; authority/refusal tests | Stop if hidden grant/resource Auth constraint/privileged bypass remains. Keep new entry disabled until reviewed; committed failures use linked recovery after fresh evidence, no blind rewind. |
| P3 family gameplay gate | Forward shared founding authority/delegate privileges; existing family SQL and HeraldryPanel/GamePage; no creation family | L1 join/L9 deny/L10 found, owner/spoof/delegate/directwriter cases; installed functions/roles required | Stop if deeper founder bypass or lock cycle remains. Preserve old data/membership; forward gate repair, no bulk detach. |
| P4 client/admin cutover and containment | CharacterCreation/useCharacter/Index, UserManager/admin adapter; migration to fence old creation signature/directINSERT after caller proof; no Edge config changes unless separately scoped | Stable UUID/timeout/replay/refusal/no items/no family/200-40 summary; Overlord target/reason; target switch and stale-response tests | Old API cannot compete. Install backend before client availability; fail closed incompatible caller, never restore raw baseline RPC as convenience rollback. Deployment/publication separate. |
| D dependency (separate) | Existing deletion RPC/useCharacter/CharacterSelect and lifecycle domain; exact forward migrations separately designed | Tombstones count; restore/purge locks/proof retention/lifecycle exclusion; fresh metadata | Required safe activation boundary; scope/owner approval separate. No C2 full deletion rewrite or automatic existing-row edits. |
| P5 bounded verification/acceptance | Source/docs/test evidence only unless further authorized | New identities/effective ACL/private containment/aggregate preflight; safe hosted refusal/runtime evidence only scoped separately | No automatic activation. Explicit owner acceptance of remaining limits; frontend Mik only. Fixes return to relevant approved package. |

Dependencies: P0 precedes P1 and P2; P2 requires P1 storage and constraints.
P3 can proceed independently after its P0 evidence is settled. P4 requires P2 and
P3 to be verified. P5 requires P4 plus the resolved deletion dependency D;
activation/publication still require separate authorization.

## 8. Acceptance coverage and remaining gates

Required future tests: six-races/classless; zero inventory/equipment; empty snapshot
decoder/basic attack d3 and ordinary empty-inventory equip behavior; full currents/
maxima/AC; exact gold/materials; rollback including trigger/deferred constraints;
same UUID replay/conflict/lost response/catalog changes; concurrent request/quota/name
races; tombstones count/restore/purge interaction; Overlord-only delegation/invalid
target/reason/spoof; L1join/L10found; immutable origin/first XP/version0; old characters
unchanged; service INSERT/definer/default grant/inherited privilege containment;
protected 15 denied/unprotected 38 allowed/no service table UPDATE/browser six preserved.
Use local disposable database concurrency tests where supported; hosted true
multi-session proof remains unavailable, not an unsafe fixture requirement.

Remaining evidence: omitted exact current constraints/index collation/triggers/FKs,
role/delegation/account validation, effective INSERT/delegate rights, relevant
entry/snapshot/resource definitions and full deletion boundary. Completed C1
defaults/races/material facts do not need blanket reinspection; get original safe
output or targeted missing definitions. Name collision/over-quota aggregate counts
are pre-installation evidence, not public row reports.

Remaining owner decisions: unspecified name normalization/length (UI 24 versus RPC 40),
catalog publication/version approval, origin/privacy/purge/name-reuse particulars,
and case-specific existing collisions if detected. Package review pins source base 8
as explicit manifest rule; do not silently treat default 10 as equivalent. No staff,
socket, equipment, economy, family-level, quota or delegation policy is reopened.

Fresh documentation checks/results are recorded in task return. No implementation
tests, hosted access or gameplay commands run for this blueprint. Documentation
review preserves approved C2 policies and P0–P5 gates; Git synchronization, ancestry,
links, project-state generation and documentation-only scope must pass before commit. F remains
**CLOSED / INSTALLED / VERIFIED / EDGE DEPLOYED / COMMANDS PAUSED /
FRONTEND NOT PUBLISHED**, under [closure](../operations/progression-001F-closure.md).

```text
HOSTED MULTI-SESSION BEHAVIOR UNPROVEN
NATURAL RUNTIME PATH NOT YET OBSERVED
AUTHENTICATED COMMANDS-PAUSED RUNTIME PROBE NOT EXECUTED
RP EARNING AUTHORITY GAP
```

Owner authorized documentation review, necessary corrections and a documentation-only
commit/push on 2026-10-08. That authorization does not cover P0 or implementation.
STOP after the documentation commit report; no implementation, migration, hosted
installation, deployment, activation or frontend publication authorized.
