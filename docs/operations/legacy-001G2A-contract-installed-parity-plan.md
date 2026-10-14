# ENG-LEGACY-001G2A — Assassin contract installed-parity preparation

2026-10-15; source8cd2116b678d10d4f14efc2d82fa415587ecce9a. **PREPARED, NOT EXECUTED.** This report alone is authored. [G2](legacy-001G2-assassin-contract-authority.md) establishes the source findings; [G1](legacy-001G1-world-creatures-quests-preparation.md) bounds the domain. No hosted calls, gameplay rows/functions, changes to SQL, state, roadmap, idea register or previous closures. ENG-LEGACY-001 OPEN; no G3 or correction starts here.

## Exact targets and why they are necessary

| Initial exact function identity | Comparison / authority question |
|---|---|
| public.assassin_take_contract(uuid) | [June definition](../../supabase/migrations/20260629080249_d6091f9a-cb36-4b1f-9beb-4966956f5e93.sql)113–181: owns_character, character FOR UPDATE, Assassin class, empty slot, server-selected creature UUID and level/area filter; no NPC/node/HP/deleted_at/request check in that body. Resolve installed checks/grants, not a new gameplay requirement. |
| public.assassin_abandon_contract(uuid) | Same file184–202: owned character, trusted marker, NULL update, no assignment/version/request condition. Determine actual installed transaction/check behavior. |
| public.apply_contract_complete(uuid,integer) | [Completion helper](../../supabase/migrations/20260629080345_0227141d-2bef-4bb3-94bb-0bb4b2df1ad9.sql): trusted marker, clear slot, GREATEST supplied count, no kill/contract identity check; historical service-only grant. |
| public.owns_character(uuid) | [Historical helper](../../supabase/migrations/20260211212345_41f57ff6-5254-4fb2-99cf-eccf43f00fc5.sql)158: EXISTS user_id=auth.uid, NULL auth rejects. Establish current helper, not guessed NULL-auth bypass. |
| public.commit_encounter_tick(uuid,bigint,uuid,uuid,integer,jsonb) | [Six-argument August commit](../../supabase/migrations/20260812223147_cb0fb7af-5cd6-4f21-b35a-2c06ad47740d.sql): state.contracts loop calls completion helper after encounter/claim/tick guards. Distinct from node_tick_commit and nine/ten-argument v2/v3. |
| public.node_tick_commit(uuid,uuid,integer,integer,bigint,uuid[],jsonb) | Current canonical outer entry. Identify only its completion-related delegation and guards; [B6 installed guard record](legacy-001B6-combat2-closeout.md)/[0017 source](../../drizzle/migrations/0017_legacy_001b3_stance_encounter_guard.sql) establish earlier composition. Do not re-audit combat mechanics. |
| public.restrict_party_leader_updates() | Character contract-field protection, trusted marker and owner context, not party-table ownership. [F5 archive](legacy-001F5-party-parity-envelope.json) reports postgres/SECURITY DEFINER/search_path public and enabled restrict_party_leader_character_updates binding. |
| public.character_lifecycle_character_fence() | [0013 lifecycle source](../../drizzle/migrations/0013_progression_001g_c2_reset_and_cutover.sql) rejects ordinary updates of already soft-deleted characters; G2 omissions do not alone prove lifecycle bypass. |
| public.update_updated_at() | Contract UPDATE timestamp side effect; [0014 timestamp fix](../../drizzle/migrations/0014_progression_001g_c2_lifecycle_timestamp_fix.sql) checks update_characters_updated_at binding/body. Do not confuse command timestamp correction with a change to this trigger function. |

For each: presence, qualified signature/argument and result types, owner, language, SECURITY DEFINER/INVOKER, volatility, exact proconfig/search_path, complete pg_get_functiondef, normalized full-definition SHA-256, CRLF-normalized prosrc SHA-256, raw proacl and exploded explicit/default ACL entries with grantor/grant option, plus effective EXECUTE for anon/authenticated/service_role/postgres. An explicit NULL ACL is not “no permissions”: use acldefault for effective ACL interpretation. Preserve PUBLIC grantee0 separately. Effective permission includes membership/PUBLIC; do not recurse from browser roles and incorrectly classify postgres as a browser principal. No role-membership or database-wide privilege audit.

Current ownership of the four contract/ownership helpers and six-argument commit is **not established** by historical CREATE statements. Historical settings/grants above are comparison points, not automatic PASS criteria or mutation instructions.

## Read-only metadata snippets — owner authorization required before execution

Only catalog/session metadata SELECT statements below. No BEGIN/DO/DDL/DML, SET ROLE, helper/gameplay execution, credential/session-token reads or table data. Built-in catalog inspection/hash/permission functions are not gameplay calls. Use a role with catalog visibility; permission errors or masked fields are REQUIRES EVIDENCE, not permission to switch to a mutating runner. Never use sandbox_exec or a migration tool as a workaround. Stop if a returned definition unexpectedly embeds sensitive material; do not expose secrets in reports.

Statement1 is one statement snapshot, including its observation envelope. Normalization matches [F7 metadata convention](legacy-001F7-party-preflight.sql): replace CRLF with LF, collapse all whitespace to one space, SHA-256 UTF8, **no additional trim**. This is a drift summary, not semantic equivalence: quoted text/comments can also contain whitespace. Retain full definition and LF-only body hash; never waive a change solely because a summary hash matches. Do not compare a prosrc hash to a whole-definition hash.

```sql
WITH requested(identity) AS (VALUES
 ('public.assassin_take_contract(uuid)'),
 ('public.assassin_abandon_contract(uuid)'),
 ('public.apply_contract_complete(uuid,integer)'),
 ('public.owns_character(uuid)'),
 ('public.commit_encounter_tick(uuid,bigint,uuid,uuid,integer,jsonb)'),
 ('public.node_tick_commit(uuid,uuid,integer,integer,bigint,uuid[],jsonb)'),
 ('public.restrict_party_leader_updates()'),
 ('public.character_lifecycle_character_fence()'),
 ('public.update_updated_at()')
), targets AS (
 SELECT identity, to_regprocedure(identity)::oid AS oid FROM requested
), metadata AS (
 SELECT t.identity, p.oid IS NOT NULL AS present,
        p.oid::regprocedure::text AS installed_identity,
        pg_get_function_identity_arguments(p.oid) AS identity_arguments,
        pg_get_function_result(p.oid) AS result_type,
        pg_get_userbyid(p.proowner) AS owner, l.lanname AS language,
        p.prosecdef AS security_definer, p.provolatile AS volatility,
        p.proconfig AS settings, p.proacl AS raw_explicit_acl,
        pg_get_functiondef(p.oid) AS definition,
        encode(sha256(convert_to(regexp_replace(
          replace(pg_get_functiondef(p.oid), E'\r\n', E'\n'),
          '[[:space:]]+', ' ', 'g'), 'UTF8')), 'hex')
          AS normalized_definition_sha256,
        encode(sha256(convert_to(replace(p.prosrc,E'\r\n',E'\n'),'UTF8')),'hex')
          AS lf_body_sha256,
        (SELECT jsonb_agg(jsonb_build_object(
           'grantee_oid', a.grantee,
           'grantee', CASE WHEN a.grantee=0 THEN 'PUBLIC'
                           ELSE pg_get_userbyid(a.grantee) END,
           'grantor', pg_get_userbyid(a.grantor),
           'privilege', a.privilege_type, 'grantable', a.is_grantable,
           'origin', CASE WHEN p.proacl IS NULL THEN 'default' ELSE 'explicit' END)
           ORDER BY a.grantee,a.grantor,a.privilege_type)
         FROM aclexplode(COALESCE(p.proacl,acldefault('f',p.proowner))) a)
          AS acl_entries,
        (SELECT jsonb_agg(jsonb_build_object(
           'role', r.name, 'role_present', pr.oid IS NOT NULL,
           'execute', CASE WHEN pr.oid IS NOT NULL AND p.oid IS NOT NULL
                    THEN has_function_privilege(pr.oid,p.oid,'EXECUTE') END)
           ORDER BY r.name)
         FROM (VALUES ('anon'),('authenticated'),('service_role'),('postgres')) r(name)
         LEFT JOIN pg_roles pr ON pr.rolname=r.name) AS effective_execute
 FROM targets t LEFT JOIN pg_proc p ON p.oid=t.oid
 LEFT JOIN pg_language l ON l.oid=p.prolang
)
SELECT jsonb_build_object(
 'observed_at', statement_timestamp(), 'role', current_user,
 'session_role', session_user,
 'isolation', current_setting('transaction_isolation'),
 'read_only', current_setting('transaction_read_only'),
 'functions', (SELECT jsonb_agg(to_jsonb(m) ORDER BY identity) FROM metadata m)
) AS contract_metadata;
```

Statement2 lists only **noninternal UPDATE triggers on public.characters**, including user-defined constraint triggers. This bounded binding inventory is necessary to find interception of the two contract columns; it is not an audit of all character-trigger logic or other tables. Return every enabled/disabled/replica/always binding so unknown guards cannot be silently ignored. Identify column-filter/WHEN/constraint differences before requesting any further function body.

```sql
WITH bindings AS (
 SELECT t.tgname AS name, t.tgenabled AS enabled,
        t.tgfoid::regprocedure::text AS function_identity,
        pg_get_triggerdef(t.oid,true) AS definition,
        t.tgdeferrable AS deferrable, t.tginitdeferred AS initially_deferred,
        t.tgconstraint<>0 AS constraint_trigger,
        CASE WHEN t.tgconstraint<>0 THEN pg_get_constraintdef(t.tgconstraint,true)
          END AS constraint_definition
 FROM pg_trigger t
 WHERE t.tgrelid=to_regclass('public.characters')
   AND NOT t.tgisinternal AND (t.tgtype::integer & 16)<>0
)
SELECT jsonb_build_object(
 'observed_at',statement_timestamp(), 'role',current_user,
 'characters_present',to_regclass('public.characters') IS NOT NULL,
 'triggers',(SELECT jsonb_agg(to_jsonb(b) ORDER BY name) FROM bindings b)
) AS contract_character_bindings;
```

Statements1/2 are **separate observations/snapshots**, even under the same read-only role. Do not label the joined evidence one shared snapshot or a concurrency test. If same-snapshot correlation becomes decisive, separately review a single combined SELECT before execution; do not improvise transaction/session commands. Missing table, target, role or masked ACL fields remain explicit. Current query role is observation context, not proof the installer/gameplay role has the same rights.

## Conditional canonical-delegate inspection — no automatic expansion

After reviewing statement1, use the **same metadata SELECT structure** with its requested VALUES list replaced only by demonstrated direct canonical delegates needed to reach the existing reward/completion boundary. Existing B/0002 source chain provides the following bounded candidates, all with arguments `(uuid,uuid,integer,integer,bigint,uuid[],jsonb)`:

1. public.node_tick_commit_without_character_stances — recorded outer direct predecessor.
2. public.node_tick_commit_without_authoritative_arrival.
3. public.node_tick_commit_without_boss_timing.
4. public.node_tick_commit_without_bounded_failure — [0002 source](../../drizzle/migrations/0002_progression_001d_canonical_xp_cutover.sql) replaces its body and gates reward claims→progression/gold.

Inspect only delegates actually linked by the returned definition and recorded chain; do not query all names by prefix. At that reward boundary, public.combat2_apply_claim_progression_internal(uuid,uuid) is a demonstrated delegate: retrieve its same metadata only to classify ordinary XP versus any contract-specific completion. Its source calls private progression_apply_xp_internal; reuse completed Progression evidence rather than recursively opening its entire family. Retain dated B/Progression security evidence; no new ACL interpretation for every combat function.

Return full definitions/fingerprints for those selected targets; exact existing calls, not a text-search absence alone, establish the inspected chain. pg_depend catalog rows may corroborate recorded object dependencies for an exact OID but PL/pgSQL/dynamic textual calls need not have complete catalog edges. No database-wide source search or dependency graph. An unexpected delegate, dynamic execution, trigger or overloaded call that could write contract state is a STOP/REQUIRES EVIDENCE item for a narrowly amended request, not implicit authorization to inspect every legacy function.

The nine-argument commit_encounter_tick_v2 and ten-argument v3 are **not initial metadata targets**. G2 found no explicit contract helper branch in them; [H1](progression-001H1-legacy-dependency-inventory.md) already retains privileged v3→v2 uncertainty. Request their exact metadata only if a returned completion path demonstrates that dependency; direct revocation is not proof of delegation containment. Do not confuse these with the six-argument historical commit.

## Comparison points and evidence reuse

| Existing evidence | Reuse / remaining gap |
|---|---|
| G2 historical take/abandon/owns/complete and six-arg commit definitions | Compare exact validation, locks, marker, target/count, response and exceptions against full installed definitions. No dedicated current installed fingerprints exist in G2 for these helpers; capture first, do not invent expected values or reject harmless formatting automatically. Source bodies can be compared using LF-only body hash after exact extraction; full catalog-rendered definition formatting requires separate interpretation. |
| F5 character trigger metadata, [F7 SQL expected fingerprints](legacy-001F7-party-preflight.sql) | restrict_party_leader_updates normalized definition e7c8011802d0630a7b4fda037856e012e84e8103cc62cd41a9a7ac5b4ac57ca8; lifecycle character fence7cb61d012918dd8d01e3e9f70d794850e7bb654791918245971a6e8783261ff4. These are dated reference values under the F7 normalization, not a claim current parity already passed. Unknown/changed binding requires review. |
| B5/B6 and0017 stance guard | Supplied outer normalized fingerprint fb533882bc10a723135460dbd0416b1a136b7d57e5afaf803183c963e5408bdb; postgres/SECURITY DEFINER/search_path and EXECUTE preserved then. Reconcile returned definition/method before matching;0017 source also uses **LF-only prosrc** guards, a different hash domain. No combat mechanics re-audit. |
| C2/0013 lifecycle and0014 timestamp fix | Disabled/deleted character writes may be fenced by triggers despite old RPC omissions. Timestamp trigger can legitimately modify updated_at. No need to invoke lifecycle commands or retrieve creation/private receipt/player rows. |
| Progression0002/0006 and accepted closure | Canonical reward receipt→XP adapter and additive gold differ from contract completion; v2 owner-only containment and retained service UPDATE on contract columns are historical installed-source evidence, not all indirect rights proof. No raw privilege changes. |
| E13 transferred finding / [E1 map](legacy-001E1-economy-rewards-writer-map.md) | Contract completion/reward authority remains TRANSFERRED, UNRESOLVED. NPC gift0021 correction and accepted caller/concurrency/config limits are reused, not rechecked here. No general quest payout invented. |

## Interpretation and limits

- **PASS — parity for observed object only:** target visible, complete metadata/definition, settings and bindings compared to named source/date, effective rights understood, no unexplained relevant change. Matching historical omission is parity, **not proof of secure event authority** or correct gameplay. Record risk and parity separately.
- **FAIL — concrete assumption contradicted:** e.g. a returned supported completion path demonstrably permits unintended authority, contract protection disabled, a missing expected dependency, or unexpected effective browser EXECUTE on helper believed restricted. A changed hash alone is **review-needed**, not automatically a defect; inspect full definition and owner-authorized expected policy. Do not repair or weaken a guard to obtain PASS.
- **REQUIRES EVIDENCE:** visibility/masking, unknown owner/grants, missing object with uncertain intended replacement, unreviewed delegation/trigger, differing snapshots, dynamic/external caller or deployed-source mismatch. Do not report “no ACL” or “no caller” from missing metadata. Preserve direct versus effective results; masked explicit entries remain a visibility limitation even if effective EXECUTE is observable.

The five additional parity distinctions:

1. Source SQL is frozen historical evidence; returned installed definitions/settings/fingerprints establish observed parity or difference, without running migrations or functions.
2. Six-argument legacy state.contracts completion and current seven-argument canonical node_tick_commit are distinct identities/payload contracts. Inspect their relevant delegates separately; one cannot prove the other installed/active.
3. Database metadata cannot establish actual deployed Edge worker contents. Later separately authorized read-only artifact/source-checkpoint evidence for the **specific active dispatcher/worker/resolver** is required if installation metadata does not resolve the missing producer. [Current source worker](../../src/server/combat2/process-node-tick-once.ts), [resolver](../../src/shared/combat2/resolver.ts) and [Edge mirror](../../supabase/functions/_shared/combat2/resolver.ts) are comparison sources, not live bundle proof. No deployment or gameplay probe requested here.
4. A service_role or postgres grant identifies capability, not legitimate event provenance or an actual external caller. Source caller search, exact delegated calls and owner-supplied external integration information may establish known callers; metadata cannot exclude unknown/dynamic callers globally. Ask for explicit limitation disposition if that remains decisive, not automatic safety acceptance.
5. Ordinary Combat2 kill receipts/XP/gold/loot must not be called contract rewards. Contract-specific evidence needs an explicit active-contract target/event comparison, recipient/count transition and bonus delegate. G2's retired historical producer/manual prose do not establish current contract rewards; no balances, inventory, contracts or reward rows are needed for this metadata phase.

## Minimal later authorization / execution handoff

Proposed next owner authorization: **read-only hosted metadata verification of statement1's nine exact functions and statement2's public.characters UPDATE trigger bindings, then only reviewed demonstrated canonical delegates as bounded above**. No actual execution is authorized by G2A. To execute, the operator should read this report and G2 at the pushed checkpoint, run unchanged SELECTs under an appropriate read-only inspection role, archive raw metadata with statement timestamps/role and preserve masked fields. Compare locally; return PASS/FAIL/REQUIRES EVIDENCE by target and separate authority findings. Stop on scope drift, sensitive content or unknown dependencies. No migration tool, sandbox mutation wrapper, SET ROLE/auth impersonation or fallback gameplay call.

No new gameplay/product decision is necessary to **inspect metadata** once explicitly authorized. Subsequent decisions may concern unknown privileged callers, retention of remaining gaps, replacement-failure semantics or completion correction only after evidence; no implicit approval now. This phase cannot certify absence of runtime completion, independent-session concurrency or all grants/callers. Future deployed-artifact verification needs its own explicit read scope if required; no hosted calls initiated here.

Preserve all prior closures/accepted limits, four OPEN progression F limitations, privileged v3→v2 and Combat1 uncertainty, and OPEN deferred ENG-LEGACY-001F-R3-RETRY. Administrative XP grants remain paused; normal gameplay XP earning is not intentionally disabled or runtime-verified by this plan. No G3, contract redesign, reward rebalance, repairs or automatic execution follows publication.

## Local validation boundary

Validate repository links, exact target list, catalog-only fenced snippets, normalization consistency, unchanged authoritative state/source, project-state synchronization/tests and whitespace. Snippet review/static checks are not PostgreSQL parsing/execution or hosted proof. Publish only this report; preserve recovery stash and await explicit hosted verification authorization.

Executed local validation:19 repository links valid; two metadata-only SELECT snippets and nine initial function targets pass static scope checks;3 project-state tests PASS; existing JSON/Markdown synchronization valid unchanged. SQL snippets have not been parsed/executed against PostgreSQL; no hosted parity result claimed. Only this new report pending; recovery stash unchanged.
