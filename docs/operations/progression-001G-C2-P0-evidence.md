# ENG-PROGRESSION-001G-C2-P0 — Targeted evidence intake

**LOCAL READ-ONLY INTAKE COMPLETE; P1 GATE OPEN. Documentation only, uncommitted.**

Checkpoint `9489b991b3e4c4be5c443d2fa246d0382ca62c7e` equals fetched origin/main;
clean at intake. Recovery stash `0a5529d5227675319b166881b10f1c91edd7486b` preserved.
Planning authority: [committed C2 blueprint](../design/progression-001G-C2-creation-blueprint.md)
and [operating contract](lovable-supabase-operating-contract.md). P0 changes no rules.
Source references below establish repository behavior, not installed production state.
No hosted query or gameplay invocation was performed. No implementation or P1 authorization.

## Evidence already established

The [C1 audit](progression-001G-C1-creation-baseline-audit.md) and blueprint contain
the baseline investigation; this report does not repeat its six-race calculations,
economy/default inventory, receipt vocabulary or full writer inventory.
The supplied C2 hosted-reconciliation request includes a summary of Lovable's
2026-10-08 approximately 09:19–09:21 UTC inspection. Original full report remains
unavailable. The summary is recorded as operator-reported in project state.

Reported metadata: one postgres SECURITY DEFINER creation overload, Auth-owned
character, authenticated/service EXECUTE, client stats/HP/AC, start configuration;
absent character_class enum despite retained cast; text class FK; case-sensitive
name uniqueness, no five-character enforcement; browser six preferences, service
character/inventory INSERT; enabled sole reported material trigger (40 salvage,
six gems); six active/selectable races, active classless base HP18/AC10; no automatic
gear or creation sidecars reported; family founding has no L10 gate. Defaults and
version0/opaque baseline vocabulary are already established as reported metadata.
None proves successful creation, current effective inherited permissions, complete
trigger closure, deletion behavior or no-equipment hosted integration.

## Minimum dependency gaps

| Boundary | Existing evidence | Still needed / phase |
|---|---|---|
| Creation RPC | [historical definition:18](../../supabase/migrations/20260908175256_2e41c1c0-9b14-40a2-9627-68f6cf7dbc2b.sql#L18), matching reported summary | Exact current signature/body and nonsecret delegates; class/race/gender types, respawn config dependencies. Needed for P2 replacement, not another default/catalog survey. |
| P1 storage/identity | Reported name uniqueness/no quota; [C state schema:6](../../drizzle/migrations/0001_progression_001c_dormant_authority.sql#L6) | Exact index expressions/collation, relevant columns/constraints/FKs, ownership/RLS/ACLs, namespace conflicts and stable account identity/lock boundary. P1 schema gate. |
| Initialization | [material trigger:1](../../supabase/migrations/20260803232302_acc7c4e5-4148-48c0-8f35-8c2299e23944.sql#L1), reported enabled | Catalog list of all character INSERT triggers and inventory/progression-state INSERT triggers; bodies only for those delegates. P1 FK/cascade compatibility; P2 transactional initialization proof. |
| Direct writers | Source browser INSERT/DELETE revoked; reported service INSERT | Current effective INSERT/DELETE, applicable RLS and function EXECUTE including inherited application access. No assumption that revoking browser table writes fences owner-definer RPCs. P1 storage ACL design; complete old creation cutover P4. |
| Raw fence | [E trigger:159](../../drizzle/migrations/0003_progression_001e_command_authority.sql#L159) is BEFORE UPDATE | Creation INSERT is outside this source fence. Preserve protected15 denied/unprotected38 allowed/no service table UPDATE/browser6. New storage requires explicit owner/private ACLs, not broad grants. No new blanket F reinspection requested. |
| Family | Reported apply_family_to_character ownership/no L10 gate; [founder branch:160](../../supabase/migrations/20260610100423_3b7b3bc3-161e-4cb6-a48b-1150b5cd57f3.sql#L160) | Relevant apply/change delegates, direct family INSERT capabilities and role-check identity. P3 gate, not P1 storage prerequisite. |

No installed conflict can be ruled out from local object absence. Existing enum
inconsistency is a reported metadata discrepancy, not a newly proven RPC failure.
Aggregate collision counts require approved normalization and a fresh pre-install
read; over-quota accounts remain unchanged. They are not required for this local intake.

## Source path: creation → empty snapshot → unarmed combat

1. [Creation hook:356](../../src/features/character/hooks/useCharacter.ts#L356)
   calls character_create; historical INSERT creates a character without inventory
   writes. The material trigger creates materials, not items. The hook receives
   the character row; **creation does not itself produce a Combat2 claim snapshot**.
2. [Entry implementation:3](../../supabase/migrations/20260902123413_f5e0f14f-b91d-451a-a267-fbe6fea9665c.sql#L3)
   creates/reuses encounter and fighter under ownership, location, party and replay
   checks; no inventory join or main-hand predicate. Later canary and engagement
   wrappers delegate to it; [engagement gate:13](../../supabase/migrations/20260922140000_combat2_engagement_release_lifecycle.sql#L13)
   requires eligible opposition rather than equipment. Maintenance and node gates
   still apply: no-equipment compatibility does not promise entry while closed.
3. [Claim projection:78](../../supabase/migrations/20260830064542_10f5dc3d-4931-4a0d-8fd9-2c7faa7bb412.sql#L78)
   uses a correlated equipment aggregate with COALESCE(...,'[]'::jsonb), not an
   inner inventory join that drops an unequipped fighter. The later
   [present-equipment patch:88](../../supabase/migrations/20261001100000_combat2_present_equipment_fencing.sql#L88)
   adds nf.present to that aggregate predicate; it does not require an item.
   [Stance wrapper:391](../../supabase/migrations/20261001130000_combat2_character_persistent_stances.sql#L391)
   delegates the claim and adds separate stance arrays. These are source composition
   facts, not a reconstruction or direct inspection of the entire installed body.
4. [Strict decoder:586](../../src/shared/combat2/decode.ts#L586) permits equipment=[];
   [main-hand resolution:187](../../src/shared/combat2/mechanics.ts#L187) returns
   unarmed for no main; [die:47](../../src/shared/formulas/combat.ts#L47) is d3.
   Basic attack then applies existing STR/hit/crit/mitigation semantics. Broken
   equipped data still refuses; empty gear is not a waiver of snapshot structure.
5. [Resources:17](../../src/shared/formulas/resources.ts#L17) and
   [AC:230](../../src/shared/formulas/combat.ts#L230) need no gear; the canonical
   private calculator uses zero aggregate bonuses for empty equipment. Its browser
   Auth-context guard and clamp-only CP/MP semantics remain unchanged. Future
   creation needs its own reviewed full-fill adapter. No mandatory main hand in
   [inventory control:90](../../src/features/inventory/hooks/useInventory.ts#L90).

**Source supports no equipment; no inspected source blocker requires a weapon.**
Exact current entry/claim predecessor definitions, complete snapshot shape and
deployed Edge integration remain uncertain. Metadata can narrow this uncertainty,
not prove gameplay runtime. This is P2/P5 evidence, not a reason to block isolated
P1 storage preparation or restore a staff. No item/socket/crafting inquiry needed.

## Permanent deletion and containment

| Path | Source proof and limitation |
|---|---|
| Player picker → hook → hard-delete RPC | [picker:33](../../src/pages/CharacterSelect.tsx#L33), [hook:339](../../src/features/character/hooks/useCharacter.ts#L339); hook optimistically removes character, invokes RPC, refetches on failure. |
| delete_character_cascade(uuid) | [body:1](../../supabase/migrations/20260623072204_ba238bbb-a55c-4000-8b35-69eb36bb3cba.sql#L1): SECURITY DEFINER, public search_path, owner/Steward/Overlord predicate, deletes related rows then character; no tombstone, age gate, restoration, encounter ordering or account quota lock. Earlier [grant:47](../../supabase/migrations/20260622212522_0bff8a9f-ce25-4a33-b6c7-35929be95daa.sql#L47) gives authenticated EXECUTE. Exact current grants/body remain unknown. |
| Direct table DELETE | [source revocation:3](../../supabase/migrations/20260908175256_2e41c1c0-9b14-40a2-9627-68f6cf7dbc2b.sql#L3) removes PUBLIC/anon/authenticated DML and own-delete policy. Current service/inherited DELETE rights and policies need metadata. Not evidence that the definer RPC is unreachable. |
| Account deletion cascade | [initial FK:96](../../supabase/migrations/20260211212345_41f57ff6-5254-4fb2-99cf-eccf43f00fc5.sql#L96) characters.user_id → auth.users ON DELETE CASCADE. Current FK/deletion triggers must be verified. No exposed account-delete handler found in reviewed local src/Edge search; external Auth administration unknown. |
| Proof cascade | [C FKs:7–18](../../drizzle/migrations/0001_progression_001c_dormant_authority.sql#L7) delete state and receipts with character. New origin/request proof must not casually copy this cascade. |
| Historical harness cleanup | C1 already traces harness INSERT/DELETE and subsequent DROP; reported E harness absence retained. No repeat harness investigation or invocation. |

If installed body/EXECUTE match source, an authenticated owner can bypass the
**future** soft-delete/30-day restore contract by calling the RPC directly; UI
hiding is insufficient. This is a concrete source bypass path, not a hosted exploit
claim or proof that every cascade currently succeeds. There is also a source
null-Auth authorization hazard: IF NOT(owner = auth.uid() OR has_role(...) OR
has_role(...)) does not reject a NULL result. With null Auth and false role checks,
the expression remains NULL, and PL/pgSQL skips the exception branch. The
[source has_role:131](../../supabase/migrations/20260211212345_41f57ff6-5254-4fb2-99cf-eccf43f00fc5.sql#L131)
uses EXISTS and returns false for a null user. A reachable matching definer could
therefore pass this gate without authenticated identity. Earlier SQL grants
authenticated EXECUTE without explicitly revoking default PUBLIC access. Current
anon/PUBLIC/service reachability is unknown; no unauthenticated deletion attempted.
Require exact null-safe identity/role checks and effective ACL containment before
activation, not merely revocation of the picker button.

Before activation: contain every application-accessible hard-delete delegate and
direct DELETE path, including permitted service/external account deletion; coordinate
account locks and protected proof retention. Prefer a separately reviewed fail-closed
fence if full lifecycle is not ready; no broad UPDATE/DELETE grants. Authorized
platform privacy operations need explicit coordination, not gameplay exemptions.
Deletion D owns tombstones, 30-day restoration, Overlord restore, gameplay exclusion,
purge eligibility/cascades and lifecycle safety. C2 owns quota accounting and origin/
replay compatibility with that boundary. P1 need not implement D, but must choose
safe FKs and identity retention before storage is finalized; activation waits for D
or separately approved containment. Existing characters are never backfilled.

## Smallest owner contracts (recommendations, not approvals)

| Decision | Recommended default | Consequence of postponing |
|---|---|---|
| Name key/length | Trim outer whitespace, retain display spelling/interior spaces; key lower(btrim(name)) with explicitly pinned and tested database collation; no accent removal or compatibility folding; 1–24 characters for new names. Define Unicode case behavior explicitly: PostgreSQL lower is not universal Unicode full casefold. Existing names stay unchanged. | P1 unique-index expression and collision preflight cannot be finalized. UI24/RPC40 and whitespace stripping cannot silently choose policy. Any non-ASCII restrictions or NFC step need separate approval/support evidence. |
| Snapshot/version identifiers | Separate versioned creation-policy/formula identifier from catalog row identity; capture concrete applied race/class values in immutable origin JSON. Assign immutable manifest revision under approved publication authority; timestamp or mutable row UUID alone is insufficient. | P1 can model versioned fields, but concrete validation/FK/publication contract remains open. Full catalog redesign is not needed; P2 cannot derive an unapproved manifest. |
| Privacy/retention and FK disposition | Private owner-only proof, separately removable actor/target/reason linkage; no automatic cascading deletion of proof, no public row reads. Apply approved O11 12-month detailed-audit policy; approve minimum lawful replay/origin fields and their retention/anonymization clocks separately. No indefinite identifying replay retention or automatic purge assumed. | P1 FK, payload-binding, audit linkage and post-purge replay schema are blocked. Deleting actor/target must neither silently erase proof nor resurrect a result. Automatic privacy jobs/full lifecycle remain D/later scope. |
| Stable account serialization | Private lock record keyed to canonical account identity, shared create/purge contract; acquire request then account lock as blueprint specifies. Avoid modifying Auth tables. Verify account FK and deletion coordination first. | P1 lock-row FK/cascade design cannot finalize; a per-character lock cannot protect concurrent first-character creation. This is engineering review unless it changes account deletion policy. |

Source base8 remains the recommended explicit creation-manifest baseline from the
blueprint; approval pins it rather than treating schema10 as equivalent. This affects
P2 values, not P1 storage. No approved economy, quota, delegation, family level,
no-equipment or F policy is reopened. Existing normalized-name collisions, if found,
require owner resolution; no automatic rename or grandfathered index presented as
global uniqueness.

## Readiness and recommended first P1 task

**P1 blockers:** exact identity/index/FK/trigger/ACL metadata and prospective namespace
conflicts; owner normalization/length, version identifier and privacy/replay/FK
contracts. Collision count is a mandatory fresh pre-install gate after name policy.
Existing over-quota accounts remain untouched; new creation must refuse at five.

**Later gates:** P2 exact creation/material/resource delegates and empty-snapshot
integration; P3 family founding delegates/roles; P4 old RPC/direct INSERT cutover;
deletion containment before activation; P5 safe verification without hosted
multi-session fixtures. Missing runtime evidence does not authorize gameplay probes.

First separately authorized P1 task: review the targeted metadata response and
approved contracts, then prepare only private identity/request/origin/receipt/account
lock storage and normalized uniqueness in a new forward Drizzle proposal, with
explicit owner/RLS/ACL/FK contracts and local tests. Keep entries inaccessible;
no creation authority, existing-row normalization/backfill, deletion implementation,
installation, deployment or activation in that task. No journal/migration number
assigned until current forward lane is verified. This report authorizes none of it.

The [minimal Lovable request](progression-001G-C2-P0-lovable-request.md) is prepared,
not sent or executed. P0 has bounded the gaps; it has not obtained the missing
hosted evidence or closed the P1 gate.

F remains CLOSED / INSTALLED / VERIFIED / EDGE DEPLOYED / COMMANDS PAUSED /
FRONTEND NOT PUBLISHED. Retain exactly:

```text
HOSTED MULTI-SESSION BEHAVIOR UNPROVEN
NATURAL RUNTIME PATH NOT YET OBSERVED
AUTHENTICATED COMMANDS-PAUSED RUNTIME PROBE NOT EXECUTED
RP EARNING AUTHORITY GAP
```

STOP. No runtime/SQL/test/config change, database access/write, migration, gameplay,
deployment, activation, publication, commit/push or P1 implementation occurred.
