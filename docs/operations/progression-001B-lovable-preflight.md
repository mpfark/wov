# ENG-PROGRESSION-001B — Installed Preflight and Migration Runner Gate

Prepared by ENG-PROGRESSION-001A. **Not dispatched. Not authorized for execution by preparation.** When Mik separately authorizes 001B, Lovable must perform a read-only, metadata-first inspection. 001B installs nothing and changes no ledger, function, trigger, ACL/RLS, gameplay row, job, deployment or publication.

## Handoff record

- Starting SHA: `8f07262429846399faab987156532294662b5228`.
- Synchronized SHA: same checkpoint; initial sandbox fetch failed, authorized network retry succeeded and origin/main matched starting HEAD. Reconfirm remote freshness when beginning 001B.
- Final local SHA: starting SHA until an explicitly approved commit; 001A changes are a reviewable uncommitted working diff.
- Final remote SHA: `8f07262429846399faab987156532294662b5228` at the successful 001A fetch; no push performed.
- Recorded-baseline ancestry result: `b2afa063c75d5e03d6afce5fb76751a2317cb85b` is an ancestor of starting HEAD.
- Worktree state/files changed: see project state and 001A report; canonical specification/roadmap, source-only types/reference/golden tests and this package. Current runtime writers unchanged.
- Migrations authored: zero. Migrations installed by 001A: zero; historical installs remain attributed evidence.
- Generated Supabase types status: untouched; any historical installed provenance is unchanged.
- Edge deployment status: no 001A deployment; obtain read-only identity where exposed.
- Frontend status: no 001A publication; only Mik publishes frontend.
- Tests and build: 001A local results recorded in project state/report; never substitute these for installed SQL proof.
- Cloud/gameplay operations: none in 001A; 001B permits only separately authorized reads.
- Deviations: no direct local Supabase/PostgreSQL access; all hosted work stays with Lovable. No automatic Lovable message sent.
- Blockers: migration history/runner routing pause; unverified installed progression definitions and execution contexts.
- Next safe action: Mik reviews001A, separately authorizes this read-only001B task and supplies the approved source revision/artifact hashes. Do not begin 001C.

Canonical rules: [game-engine.md, Progression and rewards](../design/game-engine.md#progression-and-rewards). Maintained task sequence: [roadmap](../roadmap/game-engine-roadmap.md#eng-progression-001--canonical-character-progression-authority). This document is an inspection protocol, not a second gameplay specification.

## Rules for Lovable

Use existing authorized Cloud tools; never discover/print credentials, service keys, connection strings, Vault contents or personal/player data. Establish project identity through nonsecret metadata. Expected historical project reference is `gpclaklkaolyzfnooajt`; verify independently before proceeding. Record UTC timestamp/server version/read principal and visibility limits. Do not invoke a gameplay/service RPC, worker, schedule or trigger to discover behavior. Do not run migration files, repair commands, DDL, UPDATE/INSERT/DELETE, SET ROLE, job changes or an otherwise mutating tool. A rollback-only mutation test is still outside001B.

Use catalog reads and tool-provided deployed identity. If definitions contain embedded secrets, do not return their plaintext; retain a securely scoped hash/redacted artifact and state the visibility limitation. Do not expand inspection into secret tables. Missing permissions are evidence of a limitation, not a reason to find another credential path.

## H0 — Migration runner/history gate

Reconfirm both histories and compare exact source/artifact hashes. Prior observations are historical inputs, never presumed current facts:

| Prior evidence | Value to reconfirm |
|---|---|
| Supabase batch C source | `supabase/migrations/20261002190000_combat2_legacy_browser_privileges.sql` |
| Drizzle retained copy | `drizzle/migrations/0000_combat2_legacy_browser_privileges.sql` |
| Matching source/Git-blob SHA-256 | `73df81b17ee54a0294e231d2f91a70ecc3a9da37508c027f00674d8181b92b65` |
| Rejected artifact | `1fc1314088a3b48184c354f568046abadfc795c50f15c5a753f01088affb762f`, SQLSTATE42501 at cron lock, reported no effect |
| Previous Supabase history | 510 entries; newest 20261001230000; batch C absent |
| Previous Drizzle history | one row id 1, hash above, created_at1791021613818; equals local journal `when`, not recovered execution time |
| Previous runner route | Lovable migration tool contract delegates to Drizzle's migrator, automatic Drizzle history; exact command not recovered |
| Selected future target | Supabase migration history; selection alone does not change tool routing |

001A verified both committed Git blobs have the `73df…` hash above. The Supabase working file also has that exact hash; the existing Drizzle working checkout has CRLF bytes and SHA-256 `85f3c27140fcabbaffc01e34c7628bd1d9d6ba6fec3b0979d4d0d75056864b55`. Newline-normalized contents match the committed blob; neither file was edited. Distinguish exact Git/source, working-file and executed-artifact hashes rather than treating text equivalence as byte identity. Do not normalize or replay either copy in 001B.

Read existing migration history schemas/columns first, then return relevant versions/timestamps/hashes and complete discrepancy inventory. Inspect repository journals/config/tool descriptions without reading their secret environment values. Distinguish tool contract, actual recorded history and recovered command evidence. Preserve both copies, tooling and rejected/permission-error evidence. Reconfirm current effect on all five batch-C signatures:

- `public.effects_catchup_send(uuid,uuid,bigint,uuid,integer)`
- `public.effects_catchup_dispatch_one(uuid)`
- `public.effects_catchup_reconcile(integer)`
- `public.effects_catchup_credential_health()` (metadata/hash only; do not call or expose secret health inputs)
- `public.clear_stances(uuid)`

Return full definition/security fingerprints, effective PUBLIC/anon/authenticated/service_role rights and retained nonbrowser grants/membership paths. Verify no second runner can accidentally replay batch C; identify runner discovery rules and limitations. A ledger row alone does not establish current bodies/ACLs.

**STOP before any repair.** If needed, report the exact minimal metadata-only repair, required separately authorized capability and preservation assertions. No hand-authored ledger INSERT, replacement migration, replay, deletion of Drizzle tooling or assumption that `migration repair --status applied` is available/safe. Reconcile all version/hash differences, not only batch C. Return `pause_resolution: supported_by_evidence | remains_blocked` with reasons; do not silently clear project-state blockers. 001B itself performs no repair even if a proposed repair is safe.

## H1 — Installed progression inventory

For every relevant routine and all overloads, return schema/name/identity arguments/result type, language, owner, SECURITY DEFINER/invoker, volatility, full search_path/proconfig, complete body/definition artifact plus full hash, direct/effective EXECUTE grants including PUBLIC/default/inherited, dependencies and callers. Resolve every wrapper recursively; an outer wrapper is insufficient.

Source-known entry signatures are starting points, not an exhaustive installed allowlist:

| Entry | Inspect with all helpers/predecessors |
|---|---|
| `character_create(text,text,text,text,integer,integer,integer,integer,integer,integer,integer,integer,integer,boolean)` | owns_character, races, enum/text compatibility, creation defaults/INSERT triggers, entry resource sync |
| `join_order(uuid,text)`, `switch_order(uuid,text)` | bonds, classless/class changes, stance class guard, resource sync |
| `train_renown_stat(uuid,text)` | owner-JWT identity, cost/roll/rank/attribute path, owner protection, resource sync |
| `apply_crafting_xp(uuid,integer)` | forge base/gem and stonebinder-fuse deployed callers/receipt shape; PUBLIC/default execution; service-JWT distinction |
| `sync_character_resources(uuid)` | equipment override/gem/durability/config semantics, ownership helper, maxima/current resources, AC behavior |
| `node_tick_commit(uuid,uuid,integer,integer,bigint,uuid[],jsonb)` | complete wrapper/reward/progression/persistence chain, uniqueness keys and lock/version fencing |
| `restrict_party_leader_updates()` | attachment `restrict_party_leader_character_updates`, owner/trusted semantics and all interactions |
| `settle_out_of_combat_resources(timestamptz)` | all wrappers, settlement cursor and role scope; do not presume XP advancement |
| `combat2_refuse_invalid_stance_class_change()` | attachments, lifecycle dependencies and guarded switch behavior |

Known commit predecessor names include `node_tick_commit_without_character_stances`, `_without_authoritative_arrival`, `_without_boss_timing`, `_without_bounded_failure`; also inspect installed claim wrappers, snapshot fields and their actual identities. Do not assume installation order or stitch an old source body into the current chain.

Inventory additional XP/level/attribute/unspent/respec/Renown/max-resource writers via installed catalog body/dependency search and supported deployed source metadata. Include historical `combat_tick_commit`, `award_party_member`, all admin-users actions (grant-xp/set-level/update-character/reset-stats), old trainer/respec paths, scheduled/background jobs and external/dynamic caller limitations. Refusal-shell deployment, source reachability and SQL capability are separate findings.

For `characters`, inventory table/column ACLs, RLS/FORCE RLS and all policies, nullable/default/type/check/FK constraints, race/class/gender enum/text types, replica/publication visibility if relevant, all enabled/disabled/internal/deferred BEFORE/AFTER triggers, update-column/WHEN conditions, actual firing order and complete trigger function definitions. Do the same for provenance/receipts if already present, reward claims, class/race config, bonds and inventory/resource dependencies. Trigger inventory must include lifecycle/arrival/location, Arena, stance death/synchronization and creation material triggers; do not infer a party-leader branch from a historical function name.

Return class `level_bonuses`/base HP/AC/config revisions and race definitions as current timestamped config, without player data. Identify whether trusted service calls carry auth.uid or a separate service client. Source SECURITY DEFINER alone is not proof that the owner UPDATE trigger is bypassed. Establish exact table grants and ownership helper behavior rather than granting new rights.

Read-only catalog example (do not invoke the functions returned):

```sql
SELECT n.nspname, p.proname, pg_get_function_identity_arguments(p.oid) AS arguments,
       pg_get_function_result(p.oid) AS result, r.rolname AS owner,
       l.lanname, p.prosecdef, p.provolatile, p.proconfig, p.proacl,
       md5(pg_get_functiondef(p.oid)) AS definition_md5,
       pg_get_functiondef(p.oid) AS definition
FROM pg_proc p
JOIN pg_namespace n ON n.oid=p.pronamespace
JOIN pg_roles r ON r.oid=p.proowner
JOIN pg_language l ON l.oid=p.prolang
WHERE n.nspname='public' AND p.prokind='f'
  AND (p.proname IN ('character_create','join_order','switch_order',
       'train_renown_stat','apply_crafting_xp','sync_character_resources',
       'restrict_party_leader_updates','settle_out_of_combat_resources',
       'combat2_refuse_invalid_stance_class_change','owns_character','award_party_member')
       OR p.proname LIKE 'node_tick_commit%'
       OR p.proname LIKE 'node_tick_claim%');
```

Expand to discovered helpers before declaring inventory complete. Decode `aclexplode(COALESCE(proacl,acldefault('f',proowner)))`; inspect pg_default_acl and role membership/effective privileges separately. Catalog rows alone cannot prove dynamic/external reachability. Supply complete fingerprint/metadata evidence with visibility limitations rather than “looks correct”.

## Aggregate existing-character anomalies — no repair

Confirm installed columns/types first. If the standard scalar character columns exist as expected, use an authorized read-only aggregate; do not call synchronization functions to obtain expected maxima:

```sql
SELECT count(*) AS characters,
 count(*) FILTER (WHERE level IS NULL OR level<1 OR level>42) AS invalid_levels,
 count(*) FILTER (WHERE xp IS NULL OR xp<0) AS invalid_xp,
 count(*) FILTER (WHERE level=42 AND xp<>0) AS cap_nonzero_xp,
 count(*) FILTER (WHERE level BETWEEN 1 AND 41
   AND xp>=floor(50*power(level::numeric,2))) AS xp_backlog,
 count(*) FILTER (WHERE unspent_stat_points IS NULL OR unspent_stat_points<0) AS invalid_unspent,
 count(*) FILTER (WHERE respec_points IS NULL OR respec_points<0) AS invalid_respec,
 count(*) FILTER (WHERE bhp IS NULL OR bhp<0) AS invalid_renown_balance,
 count(*) FILTER (WHERE class IS NULL OR is_classless IS NULL
   OR is_classless IS DISTINCT FROM (class::text='classless')) AS class_flag_mismatch,
 count(*) FILTER (WHERE class::text='rogue') AS obsolete_rogue_key,
 count(*) FILTER (WHERE level BETWEEN 1 AND 42 AND unspent_stat_points>level-1)
   AS unspent_exceeds_level_earned_budget
FROM public.characters;
```

The budget count is a review signal, not a proven anomaly: legitimate admin/quest grants may explain it. Counts can overlap. Null/negative ranks need JSON shape inspection before casts; never blindly cast malformed JSON. Report trained keys outside the six stats, nonobject/null maps, noninteger/negative rank values and any known training receipts that claim success without matching recorded delivery. Without historical stat deltas, present rank/stat values alone cannot prove lost training or infer discretionary investment.

Resource comparison worksheet after schema/config inspection:

1. Read eligible durable equipped instances; aggregate actual override/template and gems once, respecting slot validity. Report any missing templates, illegal slots/instances and empty overrides. Calculate both empty-override interpretations if discrepancy remains; label ambiguity, do not choose a repair.
2. Join actual configured class bases; report missing class config rather than silently use current-class historical defaults. Derive HP/CP/MP with canonical formulas/defensive caps from the specification, plus effective AC/shield where comparable. Do not double-add race/Renown; character attributes are materialized totals.
3. Return aggregate counts for each stored-maximum mismatch and current outside[0,max], plus dead HP/state inconsistency where death is explicitly observable. AC differences require explicit persisted-versus-effective semantics; do not label them proven corruption without that contract.
4. Inventory source/version/evidence for milestone claims/material history. Return duplicate/missing evidence counts only if durable identity/history supports them. Being L40/L42 or holding/no longer holding an item does not prove whether a reward was granted/consumed. Unknown historical receipt coverage is unknown, not zero missing rewards.
5. Inspect any existing provenance/override receipts before computing spent+unspent budgets. No subtraction of race + current class×level + trained ranks. Return unsupported analyses as `not_provable_from_available_history`.

Return only counts and evidence confidence by default; no names, user identifiers, credentials, inventories or full player rows. If individual reconciliation later becomes necessary, obtain separate scope for pseudonymous IDs. Do not normalize XP, attributes, ranks, pools, class flags or resource caches.

## Required evidence return and stop conditions

Return a timestamped report plus safe definition/metadata artifacts and hashes:

- H0 project/read principal/visibility, both histories, exact source/journal hashes, runner routing/discovery evidence, discrepancies and whether pause resolution is supportable. Any repair is proposal-only.
- H1 object list/all overloads and complete recursive chain, body/hash/owner/security/search-path/grant/RLS/trigger/constraint evidence; exact remaining blind spots.
- XP/craft/admin/trainer/Renown/create/resource/class caller map with auth context and deployed revision evidence where accessible. No RPC probes.
- Aggregate anomaly counts/query text/config assumptions and unknown historical provenance; no suggested automatic reconstruction.
- Protected-state preservation statement: reads only; zero migrations/ledger changes/gameplay calls/deployments; any failed reads recorded. Existing migration pause is not lifted without review.
- Recommendation for 001C based on evidence, or a precise blocker. No implementation SQL/install prepared by guessing.

**STOP and report** uncertain project identity, ambiguous histories, unexpected wrapper/dependency chain, inaccessible required objects, a read requiring mutation or an installation that would require guessing. Safe unrelated reads can be reported, but do not represent partial visibility as preflight passed. 001B ends after its report; no 001C implementation, repair, install, scheduling or publication follows automatically.

## Later tests — explicitly outside001B

Future SQL/integration gates must execute isolated role-context, lock/concurrency, retry/payload-conflict, rollback/injected-failure, milestone uniqueness, successful/failed Renown rank+actual-attribute delivery, Combat2 party/offscreen DoT/dead recipient, crafting/fusion atomic completion or outbox, trainer/provenance respec and equipment/resource parity tests. Pure001A vectors are the expected calculation oracle; they do not prove database transactionality or exactly-once behavior. Stance-respec cleanup and destructive/downward admin semantics remain open decisions.
