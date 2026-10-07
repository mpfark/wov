# ENG-PROGRESSION-001G-C1 — Prepared hosted metadata request

**NOT EXECUTED / NOT AUTHORIZED FOR EXECUTION BY C1.**

This is a minimal Lovable prompt for Mik to authorize separately. Codex did not
send it to Lovable, access hosted tools or inspect production rows. Companion:
[baseline audit](progression-001G-C1-creation-baseline-audit.md), [unapproved manifest](../design/progression-001G-C1-creation-manifest-proposal.md).
Owner authorization for this inspection would authorize only the read-only scope
below, not C2, installation or gameplay tests. No executable migration/query
package is generated in C1.

## Prompt for later separately authorized Lovable inspection

Task: ENG-PROGRESSION-001G-C1-METADATA — installed creation metadata only.
Execute only after Mik explicitly authorizes this exact read-only task. Follow
[Lovable/Supabase operating contract](lovable-supabase-operating-contract.md) and
[AI guide](ai-operating-guide.md). Begin by recording source SHA, UTC observation
window and inspection principal's role/capabilities without identity secrets.
Confirm all operations below are catalog reads or reads of nonpersonal content
configuration. If the tool cannot meet this boundary, stop and report UNKNOWN.

Do not invoke any gameplay/creation/family/resource/progression/claim/admin RPC,
even with zero values, dummy IDs or an expected refusal. No test character, DML,
DDL, GRANT/REVOKE, role/flag change, migration tool/probe, installation, deployment,
activation, scheduler/world wake or frontend publication. No migration-history
rewrite, snapshots/journal edit, secret facility discovery or alternate runner.
Do not query production characters, inventory, materials, families/membership/
requests, receipts/sidecar rows, Auth/users/profiles or diagnostic/gameplay data.
No row counts, fingerprints, hashes or samples of those private tables.
No secrets/keys/Vault values, environment values, passwords, session tokens,
connection strings, prefixes or hashes of secret material. Read privileges do
not authorize reading private/key values. Key tables are outside this scope.

Inspect only the following dependency closure, recording each exact qualified
signature/object identity and evidence or UNKNOWN:

1. **Creation entry and ownership.** All overloads of public.character_create
   (local signature text,text,text,text,nine integers,boolean); full safe function
   definition/body, args/defaults/result type, language, volatility, owner,
   SECURITY DEFINER/invoker, search_path, direct ACL and effective EXECUTE for
   anon/authenticated/service_role and discovered application members. Resolve
   auth.uid/owns_character-related identity dependencies by definitions only,
   no private rows. Search installed definitions/dependency metadata for other
   character INSERT or wrapper/delegated creation entry within this closure;
   report external/dynamic reachability UNKNOWN rather than global gameplay audit.
2. **Types/schema/constraints.** characters creation-required columns: id/user_id,
   name/race/class/gender, sixstats, level/XP/classless, points/tokens/RP/ranks/
   lifetime, resources/caps/AC/gold/location, family fields and server timestamps.
   Types, NOT NULL, default expressions, generated status, CHECKs, FK actions,
   name/owner quota indexes, collation/normalization and exact enum labels/existence
   for character_race/character_class/character_gender/item_slot. No character
   records. Confirm class/race text FK vs stale enum casts explicitly.
3. **INSERT/initialization dependencies.** All enabled/disabled BEFORE/AFTER/
   constraint/deferred INSERT triggers on characters and creation-touched tables,
   trigger conditions/order, full safe function bodies and transitive delegates.
   Include UPDATE/deferred constraints that fire during creation resource/equip/
   family finalization; identify side effects to other tables or runtime hooks.
   Confirm trg_grant_starting_materials behavior, resource sync/init, world wake,
   progression and inventory unique-holder mechanisms by definitions, not invocation.
4. **Catalog configuration only.** Nonpersonal race rows limited to race_key,
   label, six modifiers, status/is_selectable and available immutable revision
   metadata (updated_at alone not proof). Classless row and relevant class schema:
   class_key,label,status,is_pre_class/is_selectable,base_hp/base_ac,level_bonuses
   and revision metadata. Creation starting-node/respawn singleton config and
   referenced node suitability fields only: configured ID, existence/nonarena,
   relevant flags; no players or arena access rows. Material keys/default/grant
   schema. Identify current starter kit catalog/mechanism or prove no object in
   dependency closure; historical table absence is not an approved empty kit.
   If a current kit exists, return only its entries plus referenced public item
   templates' ID/version,type,slot,hands,eligibility,stats,rarity/maxdurability/
   unique-soulbound flags needed for initialization. Do not dump unrelated item
   catalogs or inventory. If no kit exists, report missing-kit blocker; do not
   choose starter items or amounts.
5. **Family/household linkage.** Definitions and ownership/ACL/search_path of
   check_family_name, apply_family_to_character, change_family_at_heraldry and only
   their creation-relevant delegates; families/members/requests schema/FKs/name
   constraints and locks, with no records. Identify any current mandatory creation
   linkage, founder/membership rules and replay/version evidence from code. Do
   not expose founder IDs, emails, reserved private names or membership data.
6. **Progression and resource dependencies.** Metadata/constraint definitions of
   progression_character_state/receipt/respec_milestone/class_growth_milestone;
   lazy init/projection/resource helpers relevant to new baseline, operation
   vocabulary/version0 checks, owner/ACL/RLS and any initialization trigger.
   No sidecar/receipt/control/key rows. Inspect current resource/AC formulas and
   required settlement-state schema only; never invoke sync/settlement and never
   infer an initial fill from maximum calculations. Other progression functions
   are outside scope unless an actual creation delegate references them.
7. **Effective capability boundary.** characters INSERT direct/effective rights,
   column grants, RLS policies and definer execution; relevant inventory/material/
   family/progression object grants and default function privilege effects.
   Verify service partition protected15 denied/unprotected38 allowed/no table
   UPDATE and authenticated six preference columns using metadata, without DML.
   PUBLIC is ACL grantee zero, not a role to query by name. Show actual transitive
   pg_auth_members edges and effective USAGE/global-data/BYPASSRLS capabilities
   for roles relevant to this closure, not role-name exemptions. NOINHERIT alone
   is not effective access; superuser MEMBER results are not membership edges.
   Direct nonowner/PUBLIC private grants remain leaks. Distinguish platform read
   authority from gameplay capabilities; do not change roles to pass assertions.

Inspect function text only where it can be returned without secret literals;
if unsafe literals or dynamic secret access are encountered, do not print them
or hash/prefix them. Return object identity and “body withheld; evidence incomplete”
with the specific missing nonsecret metadata needed. No log/bundle/credential
inspection is requested. Safe function-definition identity hashing is optional;
it must never be confused with hashing private data or secret material.

## Required response and stop

Return a bounded report with timestamp and source checkpoint, exact object/signature
references, full safe creation/delegate definitions, schema/trigger/FK/ACL matrix,
current nonpersonal baseline/catalog data, and comparison against C1 source.
Classify **confirmed installed metadata**, **local source discrepancy**, **UNKNOWN**
and **owner decision** separately. Confirm no prohibited table records or values
were selected and no functions/mutation/deployment/activation were invoked.
If any capability/object is inaccessible, report it; do not substitute privileged
secret access, gameplay calls, a migration or test character as verification.

Installed metadata proves object state, not natural creation behavior or concurrent
runtime safety. No hosted multi-session fixture or natural-path probe is required.
Preserve F **CLOSED / INSTALLED / VERIFIED / EDGE DEPLOYED / COMMANDS PAUSED /
FRONTEND NOT PUBLISHED** and explicitly retain:

```text
HOSTED MULTI-SESSION BEHAVIOR UNPROVEN
NATURAL RUNTIME PATH NOT YET OBSERVED
AUTHENTICATED COMMANDS-PAUSED RUNTIME PROBE NOT EXECUTED
RP EARNING AUTHORITY GAP
```

STOP after returning read-only evidence. Do not install, repair, authorize C2,
populate a kit, initialize any character/sidecar, deploy or publish anything.
