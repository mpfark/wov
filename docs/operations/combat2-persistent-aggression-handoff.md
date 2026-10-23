# Persistent creature-life aggression — revised attempt contract

2026-10-24 ACL correction. **Implemented locally / NOT INSTALLED / NOT DEPLOYED / NOT LIVE-VERIFIED.** Dedicated branch `codex/persistent-aggression-acl-guard`, based on current main `39d28bcccc936052fee4098d2f599e9f8145cbbb` (PR7 squash merge of the reviewed aggression implementation; SQL/resolver bytes compared equal to `04f847da`). Original implementation branch: `codex/persistent-creature-aggression`. The containing commit is the reviewed unit. ENG-COMBAT-001/002 and G4 remain the existing tracking. Owner's revised rule supersedes the earlier positive-direct-damage trigger; previous b43278f test evidence remains historical, not evidence for the new trigger.

## Original implementation files (historical release scope)

- `docs/operations/combat2-persistent-aggression.sql`
- `docs/operations/combat2-persistent-aggression-handoff.md`
- `src/shared/combat2/resolver.ts`
- `src/shared/combat2/types.ts`
- `supabase/functions/_shared/combat2/resolver.ts`
- `supabase/functions/_shared/combat2/types.ts`
- `src/shared/combat2/__tests__/resolver.test.ts`
- `src/server/combat2/__tests__/persistent-aggression-candidate.test.ts`
- `scripts/proofs/creature-aggression.test.mjs`
- `scripts/proofs/g4a12/source-adapters.mjs`
- `docs/design/game-engine.md`
- `docs/roadmap/game-engine-roadmap.md`
- `docs/operations/gameplay-evening-test-checklist.md`
- `docs/operations/project-state.json`
- `docs/operations/project-state.md`

## Authoritative attempt boundary

[Resolver](../../src/shared/combat2/resolver.ts) and its [Edge mirror](../../supabase/functions/_shared/combat2/resolver.ts) set optional `ProposedCreatureState.hostile_attempt=true` only after a non-rejected Basic Attack outcome (explicit intent or server-owned continued swing), or a fully validated, non-rejected ordinary enemy ability outcome. Actor presence/life, target, CP, mechanic support and mechanic refusals are checked first. A rejected engagement opening never sets the marker. A miss/zero-damage outcome forces that exact creature's proposal even without HP change. Resolution alone has no persistent effect: the [canonical commit core](../../drizzle/migrations/0002_progression_001d_canonical_xp_cutover.sql) must accept its claim/token/tick/version/generation and commit the whole transaction. No browser field, queued intent or participation/reward qualification establishes provocation. The service worker remains a trusted proposal producer; SQL does not rerun mechanics.

Current enemy mechanics receive one validated creature. `multi_attack` repeats attacks on that same creature; no encounter-wide fanout is added. Any future multi-creature mechanic must report each independently validated target before it may set this field. Standalone DoT ticks, Ignite/stance pulses, procs and retaliation do not set it; a valid hostile DoT-applying action such as `rend` does. Self/ally/party actions, selection and entry do not. No ordinary-log event is added and existing heartbeat, engagement opening and retaliation order are unchanged.

## SQL scope, locking and lifetime

[Forward candidate](combat2-persistent-aggression.sql), exact SHA-256:
`25b9940bd5ba84dd600715562a00485b211d4df8f463c2328e228f3d25c14c26`

Adds nullable `creatures.provoked_spawn_seq`, patches only the durable creature-mirror SET list and installs private row-local `creature_life_hostility()`. A surviving current-life creature is marked only when its accepted proposal carries `hostile_attempt=true`. No HP reduction or hit-quality inference is used. The existing encounter/projection/generation predicates and all earlier guards remain intact. Marker monotonicity, runtime `is_aggressive`, configured `base_aggressive`, death clearing and ordinary respawn reset are unchanged from the first candidate. No backfill, new RPC, scheduler or retained encounter ownership.

Guarded core: `public.node_tick_commit_without_bounded_failure(uuid,uuid,integer,integer,bigint,uuid[],jsonb)`. Original normalized prosrc MD5 `74d0800a416276d89e6495724c3c82d5` (canonical0002 plus0024 engagement); expected revised result `d17163615c8ce101742c6bb698363a7d`. [Guard test](../../src/server/combat2/__tests__/persistent-aggression-candidate.test.ts) reconstructs the source independently. Core owner/security/settings/ACL are preserved exactly. Core EXECUTE must remain postgres-only, including effective service_role denial; see the ACL reconciliation below. Trigger helper is postgres-owned/DEFINER, fixed search_path and owner-only EXECUTE, including explicit revocation from the two already identified platform principals. Browser column-write denial and unexpected-grant aborts remain required.

Existing [0024 coverage](legacy-001G4A21-public-hp-integration.md) node→encounter→dependent-row locking, claim invalidation and atomic rollback are reused. The trigger reads only OLD/NEW and adds no lock acquisition. Existing [arrival/entry](../../supabase/migrations/20260928100000_combat2_authoritative_arrival_hostile_initiation.sql) reads durable `is_aggressive`; [ordinary respawn](../../supabase/migrations/20260629060824_a75ddfbf-a2d4-4e53-b368-b3f47ef8ebbe.sql) restores configured defaults with generation fencing. No changes to HP, regeneration, rewards, tanks, quiescence or Combat1. Bounded tests are not global deadlock proof.

## Local evidence and limitations

- **23 native cases PASS**, PostgreSQL18.6 (24 including runner container), rerun for the ACL correction: actual resolver damaging Basic Attack, Basic Attack miss, hostile `power_strike` miss and zero-direct-damage `rend`; refusal/no action; standalone DoT exclusion; leave/quiescence/regenerate/re-enter; another character; neighbor/default independence; death/respawn; stale generation; replay/rollback; late installation ACL rollback. Two independent-session cases observe advisory blocking: exact commit replay and following claim versus preceding commit.
- [Proof harness](../../scripts/proofs/creature-aggression.test.mjs) reuses complete selected G4A21/G4A15 source composition, actual decoder/catalogue/Edge resolver. Current runtime graph is explicitly repinned in [source adapters](../../scripts/proofs/g4a12/source-adapters.mjs); historical proof results are not relabeled. Reduced schema/namespace/clock/Auth/INVOKER substitutions remain. Existing intent helper is a double, with its omitted autoattack state explicitly seeded. Test AC/class/CP/intent fixtures exercise real missed rolls and real published ability handlers; they do not hand-edit miss events. `rend` is an accepted non-damaging application, not a fabricated landed zero-damage strike (current direct-damage mechanics enforce minimum1). Stale-generation proposals and rollback setup are synthetic adversarial fixtures. Return relocation/death setup is fixture-only, followed by actual entry/respawn bodies. The new ACL case restores the extracted outer wrapper's SECURITY DEFINER metadata in the reduced local fixture, allows service_role only on that outer function and proves successful delegation while a direct core call is denied. Other fixture substitutions remain. Five negative cases inject PUBLIC/anon/authenticated/service_role/custom-role core grants and prove refusal plus full installation rollback; before/after owner/security/config/ACL are equal. These fixture grants are never proposed for production. Full hosted scheduler/RLS/worker parity is not proven.
- Earlier attempt-revision validation (before this ACL correction): **89 focused Vitest checks PASS**:83 resolver,1 source guard,2 Edge packaging/mirror and3 project-state. Typecheck and production build PASS (existing large-chunk advisory only); state synchronization, documentation references, source/history and whitespace checks PASS. For this SQL/test/documentation-only ACL revision,6 focused checks PASS (3 SQL/invocation guards and3 project-state); no runtime change requires repeating the prior typecheck/build. No gameplay acceptance has been executed. Initial import-extension, graph-pin and fixture-AC errors were corrected locally before the earlier validation.

Run native proof with local PostgreSQL bin in `WOV_LOCAL_PG_BIN`, then `node --test scripts/proofs/creature-aggression.test.mjs`. No hosted URL fallback is accepted.

Reviewed Edge dependency file SHA-256 (exact repository artifact bytes):

- Resolver: `3099daeba7cf83122988391648ecbba02a1b5a3fcffc2e5e82ce8f10d35d6adf`
- Types: `4f9e87bee841d6d9e5ca910282670d36261076564efabb94fe6cd4a1a8319835`
- Normalized complete transitive worker/catalogue source graph: `539fc530fa9ebace9f36b4723ddb699a0f39058d83eb1118df9030074c949263` (proof pin; not a deployed bundle fingerprint).

## ACL reconciliation — owner-supplied production preflight

The owner reports permitted read-only Lovable preflight on **2026-10-23**, with core MD5 `74d0800a416276d89e6495724c3c82d5`, postgres owner, SECURITY DEFINER, `search_path=public`, ACL `{postgres=X/postgres}`, effective service_role EXECUTE false and browser EXECUTE denied. Creature/generation schema matched, marker/helper absent and all30 migrations matched through0029;0030 was the next standard migration. No installation/deployment occurred. Exact observation time/original full report was not supplied here. These are owner-supplied observations, not fresh Codex inspection. The prior SQL hash `0054886416614623b3c5ff01ad0cc8603ea82d2242d7bd7d54671b1189743073` would reject this correct private ACL.

### Confirmed source invocation contract

[Production dispatcher handler](../../supabase/functions/combat2-dispatch-once/handler.ts) and [single-node worker handler](../../supabase/functions/combat2-tick-once/handler.ts) create the existing service-role client and call only `node_tick_commit` through [processNodeTickOnce](../../supabase/functions/_shared/combat2/process-node-tick-once.ts). Exact SQL chain (all share signature `(uuid,uuid,integer,integer,bigint,uuid[],jsonb)`):

1. [node_tick_commit](progression-001D-evidence/node_tick_commit.sql), SECURITY DEFINER outer stance/coverage boundary.
2. [node_tick_commit_without_character_stances](progression-001D-evidence/node_tick_commit_without_character_stances.sql), SECURITY DEFINER arrival/node-lock boundary.
3. [node_tick_commit_without_authoritative_arrival](progression-001D-evidence/node_tick_commit_without_authoritative_arrival.sql), SECURITY DEFINER boss-timing boundary.
4. [node_tick_commit_without_boss_timing](progression-001D-evidence/node_tick_commit_without_boss_timing.sql), SECURITY DEFINER bounded-error wrapper.
5. `node_tick_commit_without_bounded_failure`, the private mutation core, replaced in [0002](../../drizzle/migrations/0002_progression_001d_canonical_xp_cutover.sql).

The final `$acl$` block in0002 explicitly revokes every non-owner grantee from the entire chain and grants service_role only the outer RPC. Its source/security prerequisites establish postgres ownership. [0017](../../drizzle/migrations/0017_legacy_001b3_stance_encounter_guard.sql) and [0024](../../drizzle/migrations/0024_g4a21_shared_creature_hp.sql) patch the outer body while preserving owner/security/config/ACL. Thus SQL delegates execute in the postgres owner's SECURITY DEFINER context; the original Edge role does not need direct EXECUTE on private callees. No additional caller or bypass is introduced.

### Exact local correction

Only the final core ACL predicate/comment changes in the SQL candidate: require effective postgres EXECUTE; deny effective anon/authenticated/**service_role** EXECUTE; reject every non-owner ACL grantee (including PUBLIC/default ACL expansion and unexpected platform/custom roles). Existing before/after metadata equality remains. **No GRANT statement, function-body change, owner/configuration change or historical migration edit.** Original and resulting core-body MD5s above remain unchanged by this guard correction. Helper privilege handling is untouched; no platform exception is extended.

This correction changes six files: SQL, this handoff, focused SQL guard tests, native proof and project-state JSON/generated Markdown. Engine sections Creatures/targeting and ENG-COMBAT-001/002 remain unchanged gameplay rules. The old native fixture's service_role core grant was a test assumption and is removed.

### One remaining bounded metadata check (not executed / needs separate authorization)

Reuse the supplied core/schema/30-entry history observations; do not repeat their audit. The supplied summary does **not** establish fresh installed wrapper definitions/security/ACL. One catalog-only result set for the **four wrappers above** is the remaining evidence gate. Use only a separately approved transactionally enforced read-only route; no sandbox_exec, gameplay rows or function invocation.

```sql
WITH targets(identity) AS (VALUES
 ('public.node_tick_commit(uuid,uuid,integer,integer,bigint,uuid[],jsonb)'),
 ('public.node_tick_commit_without_character_stances(uuid,uuid,integer,integer,bigint,uuid[],jsonb)'),
 ('public.node_tick_commit_without_authoritative_arrival(uuid,uuid,integer,integer,bigint,uuid[],jsonb)'),
 ('public.node_tick_commit_without_boss_timing(uuid,uuid,integer,integer,bigint,uuid[],jsonb)'))
SELECT t.identity, p.oid IS NOT NULL AS present,
 pg_get_userbyid(p.proowner) AS owner, p.prosecdef AS security_definer,
 p.proconfig, p.proacl,
 md5(regexp_replace(p.prosrc,'[[:space:]]+',' ','g')) AS normalized_body_md5,
 pg_get_functiondef(p.oid) AS definition,
 has_function_privilege('postgres',p.oid,'EXECUTE') AS postgres_execute,
 has_function_privilege('service_role',p.oid,'EXECUTE') AS service_execute,
 has_function_privilege('anon',p.oid,'EXECUTE') AS anon_execute,
 has_function_privilege('authenticated',p.oid,'EXECUTE') AS authenticated_execute
FROM targets t LEFT JOIN pg_proc p ON p.oid=to_regprocedure(t.identity)
ORDER BY t.identity;
```

**PASS:** four exact identities, postgres owner/SECURITY DEFINER, source-compatible settings and complete definitions matching the above direct call chain plus installed0017/0024 guards; outer service_role EXECUTE true, private wrappers service_role false, browser denied, explicit ACLs consistent with0002 (no PUBLIC or unexpected grantees). **FAIL/STOP:** divergent chain, owner/security/privilege expansion or missing wrapper; no repair/GRANT authorized. **REQUIRES EVIDENCE:** masked metadata/uncertain route. Metadata does not prove gameplay or hosted concurrency. Once this check passes and the new exact candidate hash is owner-approved, the existing standard Drizzle installation plan applies (0030 only if the current prefix is still0029). No permission change is needed to resolve the reported blocker.

## Minimal parity and exact installation sequence

1. Owner reviews the exact ACL-correction commit. Reuse the owner-supplied2026-10-23 core/schema/history preflight above; perform only the four-wrapper read-only metadata check described above if an equivalent visible result is not already supplied. Do not repeat a broad audit, access gameplay rows, execute gameplay calls or use sandbox_exec. Stop on required visibility gaps, wrapper/source/security drift, unexpected grants or an already-installed candidate. Existing SQL guards recheck the private core atomically during an authorized installation.
2. Separately authorize **one atomic standard custom-SQL Drizzle installation** of the exact SQL hash above. Lovable owns outer transaction/history/snapshot/derived types; no top-level BEGIN/COMMIT or historical replay. Verify revised core MD5, unchanged metadata, strict helper ACL, trigger/constraint, generated bytes and unchanged prior history. All candidate changes must roll back on failure.
3. After SQL verification, separately deploy the matching shared resolver/types with **`combat2-dispatch-once`** (production inline worker) and **`combat2-tick-once`** (supported single-node worker), preserving their existing handler/configuration and authorization. The earlier `combat2-tick` label was incorrect: no such Edge Function exists in the repository. This corrects the release target names only; no handler code, secrets, schedules or progression controls change. Record exact submitted commit/source hashes and distinguish deployment success from independently verified live bundle identity. Old worker omits the field and therefore does not provoke under revised SQL; database-first is compatible but the feature remains inactive until the matching worker is deployed. New worker against old database similarly cannot provide the rule. Coordinate the release; do not claim activation at the intermediate stage.
4. **No frontend source change/manual Publish is required for this rule.** Pushing does not install/deploy. Owner separately performs gameplay acceptance below. Recovery is separately reviewed forward SQL/worker correction preserving HP, generations and receipts; do not reset world state or revive competing healers.

All existing limitations remain: G4/E13 OPEN, G3 deferred/G3D BLOCKED, deferred F1 retry issue, progression limitations and administrative XP pause. No hosted operation, branch merge/delete, installation, deployment or publication was performed.

## Manual acceptance — unexecuted

- [ ] Untouched passive creatures remain passive on entry/selection/non-hostile ability use.
- [ ] Basic hit and Basic miss provoke after commit, with ordinary heartbeat retaliation timing.
- [ ] Valid hostile ability miss/zero-direct-damage application provokes; rejected/cancelled action does not.
- [ ] Leave and return after encounter quiescence; same living generation remains hostile. Another controlled player sees the same behavior.
- [ ] Eligible OOC regeneration heals HP without calming the creature.
- [ ] Death/ordinary respawn restores passive default; naturally aggressive defaults remain aggressive.
- [ ] Multiple passive creatures: only the valid target is provoked. Capture creature/node/time and existing Diagnostics if useful; logs alone do not prove accounting.

## Separate read-only remote-branch review

Compared against main `72547626950e61598e3d412adb784197a1443703`; no branch merged/deleted.

| Remote branch / tip | Recommendation | Commit evidence |
|---|---|---|
| `agent/separate-ability-templates` / `c1903bf9d070a7f1e356d92bf353e215d695b7dd` | **SAFE TO DELETE**, owner action only | Only unique-by-ancestry commit is patch-equivalent (`git cherry` minus) to main `0be8f3ddc5f4045c8f792a8e727075b5a1db8a2a` (PR2). Later main changes remain authoritative; no older types/migrations should be merged. |
| `codex/combat2-hostile-ability-readiness` / `d8b9ab8f9030f1a73e82ed4ebb02ce49263b2f89` | **SAFE TO DELETE**, owner action only | Patch-equivalent to main `d9b17399d1c7a307df538d7a092bb59caba73745` (PR3); readiness module and idle-hostile tests are byte-identical to main. No durable creature-life aggression implementation there to merge. |
| `agent/fix-ignite-configuration` / `fb99e54173b7def2d051ed83e659207a69b16930` | **REVIEW FIRST; KEEP meanwhile** | `git cherry` plus: unique patch is not on main. Its historical Ignite migration is absent from main; that does not establish hosted installation/need. Some intent is superseded: main checkpoint `8f072624` and current seed/mechanics use `stack_apply`/`orb_stance`, persistent stance plus separate burn configuration, unlike the older `ignite_buff`/duration rewrite and legacy worker edits. Complete intent equivalence is not proven. Do not merge this obsolete package or declare all changes unnecessary without a separate narrow review. |
