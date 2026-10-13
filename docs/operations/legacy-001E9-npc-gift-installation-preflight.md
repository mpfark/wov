# ENG-LEGACY-001E9 — minimum remaining NPC gift installation preflight

2026-10-13; local preparation/source publication only. E IN PROGRESS. [Corrected SQL](legacy-001E6-npc-gift-correction.sql) SHA256 **c9265d6845fd6fe325116a7062f34d1601be3e1d4e1a765c1c34ef61d99da65e**, [E6 handoff](legacy-001E6-npc-gift-handoff.md), [E7/E8 disposition](legacy-001E7-npc-gift-review.md). No installation authorized.

## Reuse first; no blanket metadata repeat

E5 supplied summary is PASS with an access finding. Complete E5 output is not present in local repository or this task context: exact times/role/definition/ACL/triggers were not supplied. Lovable should retrieve **its existing full E5 record** first, identify original observation metadata and return references/decisive values, not rerun E3 wholesale. E3 query remains available solely for missing fields; select only relevant sections if new metadata reads are separately authorized. Preserve original and new observations as distinct snapshots, no fabricated same-snapshot claim. No player/inventory/gift-history/config rows or gameplay calls.

## Minimum prerequisite reconciliation

1. **Exact installed function compatibility:** use E5 definition/prosrc hash, settings/defaults/identity/owner/result type. Must match original prosrc9e5c246bb43d458ef7256ba931524178389171a2ce12ffeee9ea0a3dbfaa003b (CRLF→LF only), argument names _character_id/_npc_id/_item_id/_once_per_character, boolean DEFAULT true, SECURITY DEFINER/jsonb, original search_path=public. Owner preserved, not reassigned. If E5 already supplies these and no intervening change is reported, cite it; otherwise one exact-signature metadata SELECT, not all progression or schema functions. NULL settings must now refuse; E8 does not weaken original guard. Any mismatch STOP/FAIL, no expected-hash substitution.
2. **Exact ACL compatibility:** from E5 direct ACL and effective anon/authenticated/service_role/postgres, identify PUBLIC/anon removal, inherited anon capability, current service baseline and required explicit trusted roles/grant options. Candidate preserves direct nonbrowser entries/owner and previous effective service access, adding explicit service grant only if it depended on PUBLIC. It does not guarantee other principals relying solely on PUBLIC remain supported. Metadata can establish permissions, not actual external need. Known required caller depending on removed PUBLIC/anon inheritance is a blocker until separately resolved/accepted; no broad grants.
3. **Installed lock composition:** reuse E5 all noninternal inventory/gift/NPC/items bindings and complete relevant function definitions. Confirm gift-ledger FK cascade to NPC/item, enabled lifecycle child fence using character FOR KEY SHARE, unique holder advisory→registry row order and no additional trigger acquiring an incompatible reverse lock. E8 character FOR NO KEY UPDATE serializes gifts while permitting KEY SHARE. Only missing/drifted exact bindings/functions need new SELECTs; no aggregate-trigger-hash retry required. No multi-session proof claimed. Unexpected reverse character/NPC/ledger/unique locks require narrow dependency disposition before installation.
4. **Known server caller compatibility:** reuse repository NPCDialogPanel and any E5 caller result. Existing direct client sends auth JWT/configured same-pair item/once flag; no repository service caller established. For a missing database-caller list, the optional targeted read below lists public routine bodies mentioning this exact operation. This is a candidate list, not a complete dependency/external audit. pg_depend alone cannot prove no PL/pgSQL/dynamic/external call. Do not run functions or inspect session/auth credentials.

Optional caller-gap metadata SELECT only, execute only if the existing record lacks it:

~~~sql
SELECT statement_timestamp() AS observed_at, current_user AS inspection_role,
       pg_current_snapshot()::text AS snapshot,
       p.oid::regprocedure::text AS candidate_caller,
       pg_get_userbyid(p.proowner) AS owner, p.prosecdef AS security_definer,
       p.proconfig AS settings
FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
WHERE n.nspname='public' AND p.prokind IN ('f','p')
  AND p.proname<>'grant_npc_gift'
  AND p.prosrc ~* '\mgrant_npc_gift\s*\('
ORDER BY candidate_caller;
~~~

No caller body or credentials printed by this discovery query. If a candidate appears, inspect only that known caller's relevant authorization/argument contract using existing record/source or a separately scoped definition read; don't widen to unrelated functions. String match can be false positive or miss dynamic calls; absence means REQUIRES EVIDENCE for external consumers, not DEAD.

## What metadata cannot establish / owner gates

- Actual external/dynamic server usage and valid JWT identity at call time are **proposed accepted verification limitations**, not auto-accepted. Corrected function refuses NULL auth even if service EXECUTE retained. If no supported server consumer is identified, owner must explicitly accept unknown external caller compatibility before installation rather than treat metadata absence as safety. If a known required consumer uses NULL auth/unconfigured gifts, it is an **installation blocker** requiring a separately authorized caller adjustment or explicit decision to retire/refuse that use.
- Actual duplicate/conflicting configured topics cannot be established from metadata shape. E4 explicitly approved deterministic pair refusal and repeatable semantics, so conflicting configuration may refuse legitimately after correction; no automatic NPC-row cleanup or new topic rule. Actual occurrence unknown is a retained visibility limitation, not an excuse to choose an arbitrary flag. Optional future non-player config summary requires separate authorization, not part of this preflight.
- Independent-session deadlock/duplicate behavior and live NPC interaction are **unverified runtime coverage**. E8 source lock compatibility/isolated tests are not production verification. Treat as proposed limited-installation acceptance only at owner authorization; no gameplay probe needed to retrieve metadata. Earlier accepted closures/F limitations remain untouched.

## Explicit interpretation and stop conditions

**PASS:** reused/new metadata covers exact guard/default/security/ACL/schema/trigger assumptions; no unexplained drift/reverse lock; known required consumers compatible. PASS means candidate installation prerequisites fit, not current gift authority safe or runtime verified.

**FAIL:** wrong/missing exact signature or source guard values, source/ACL/owner/default drift, residual effective anon access that planned revoke cannot contain, required server rights lost, incompatible ledger/constraints or credible unresolved trigger lock inversion. Stop; no SQL edits/grants/install to manufacture PASS.

**REQUIRES EVIDENCE:** full E5 unavailable/partial, query visibility/truncation, unknown external requirements or exact installed trigger body. First obtain existing output; only minimum missing metadata reads if separately authorized. Unknown external/runtime coverage must have explicit owner limitation acceptance if proceeding; don't silently classify it safe.

## Exact Lovable-ready prompt (not dispatched)

> At the published E9 source checkpoint, verify candidate SQL SHA256 c9265d6845fd6fe325116a7062f34d1601be3e1d4e1a765c1c34ef61d99da65e and read this handoff. Reuse the complete prior E5 evidence first; report its exact function/default/settings/body hash, owner/direct and effective EXECUTE and relevant inventory/gift/NPC/item lifecycle/unique trigger/constraint results with their original observation times/roles/snapshots. Do not repeat fields already verified without a documented drift/visibility reason. For any remaining missing field, perform only an authorized exact-signature or bound-trigger catalog SELECT from existing E3 sections; optional public-routine exact-name caller discovery above only if needed. Return PASS/FAIL/REQUIRES EVIDENCE by prerequisite and identify required server callers or unknown external compatibility as the owner gate described here. No player rows/config row reads, auth/credential data, gameplay function calls, aggregate-trigger-hash retry, grants, migrations, installation, deployment, frontend publication or probes. On mismatch/error/missing visibility, stop and report; do not correct hosted state. This prompt prepares metadata review only; executing even these reads requires separate authorization from E9 source publication.

Once metadata reconciled and explicit limitations accepted, installation still needs separate owner approval through standard Lovable/Drizzle workflow, reviewed artifact outside migrations, one atomic DO operation, followed by source/hash/journal/ACL/body verification. No migration replay/history repair or same-RPC frontend/Edge change required by valid repository callers. E9 does not dispatch this prompt.

## Validation / preserved scope

12 E6–E8 focused isolated tests including exact inverse diff, NULL/FALSE guard, ACL variants/rollback and lock contract; state tests/synchronization,21-entry migration chain, links/whitespace. No independent-session/hosted proof. Publication contains only pending E6–E9 SQL/docs/tests/state; original E3 metadata SQL unchanged. Prior closures, four OPEN F limitations, v3→v2 uncertainty, administrative-only XP pause and recovery stash preserved.
