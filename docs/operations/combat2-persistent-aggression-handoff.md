# Persistent creature-life aggression — revised attempt contract

2026-10-23. **Implemented locally / NOT INSTALLED / NOT DEPLOYED / NOT LIVE-VERIFIED.** Branch `codex/persistent-creature-aggression`; revision starts at `b43278fc90b3e8f2c34c088f977bd83f93c4b47a`, based on main `72547626950e61598e3d412adb784197a1443703`. The containing commit is the reviewed unit. ENG-COMBAT-001/002 and G4 remain the existing tracking. Owner's revised rule supersedes the earlier positive-direct-damage trigger; previous b43278f test evidence remains historical, not evidence for the new trigger.

## Changed files

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
`0054886416614623b3c5ff01ad0cc8603ea82d2242d7bd7d54671b1189743073`

Adds nullable `creatures.provoked_spawn_seq`, patches only the durable creature-mirror SET list and installs private row-local `creature_life_hostility()`. A surviving current-life creature is marked only when its accepted proposal carries `hostile_attempt=true`. No HP reduction or hit-quality inference is used. The existing encounter/projection/generation predicates and all earlier guards remain intact. Marker monotonicity, runtime `is_aggressive`, configured `base_aggressive`, death clearing and ordinary respawn reset are unchanged from the first candidate. No backfill, new RPC, scheduler or retained encounter ownership.

Guarded core: `public.node_tick_commit_without_bounded_failure(uuid,uuid,integer,integer,bigint,uuid[],jsonb)`. Original normalized prosrc MD5 `74d0800a416276d89e6495724c3c82d5` (canonical0002 plus0024 engagement); expected revised result `d17163615c8ce101742c6bb698363a7d`. [Guard test](../../src/server/combat2/__tests__/persistent-aggression-candidate.test.ts) reconstructs the source independently. Core owner/security/settings/ACL are preserved exactly. Trigger helper is postgres-owned/DEFINER, fixed search_path and owner-only EXECUTE, including explicit revocation from the two already identified platform principals. Browser column-write denial and unexpected-grant aborts remain required.

Existing [0024 coverage](legacy-001G4A21-public-hp-integration.md) node→encounter→dependent-row locking, claim invalidation and atomic rollback are reused. The trigger reads only OLD/NEW and adds no lock acquisition. Existing [arrival/entry](../../supabase/migrations/20260928100000_combat2_authoritative_arrival_hostile_initiation.sql) reads durable `is_aggressive`; [ordinary respawn](../../supabase/migrations/20260629060824_a75ddfbf-a2d4-4e53-b368-b3f47ef8ebbe.sql) restores configured defaults with generation fencing. No changes to HP, regeneration, rewards, tanks, quiescence or Combat1. Bounded tests are not global deadlock proof.

## Local evidence and limitations

- **17 native cases PASS**, PostgreSQL18.6 (18 including runner container): actual resolver damaging Basic Attack, Basic Attack miss, hostile `power_strike` miss and zero-direct-damage `rend`; refusal/no action; standalone DoT exclusion; leave/quiescence/regenerate/re-enter; another character; neighbor/default independence; death/respawn; stale generation; replay/rollback; late installation ACL rollback. Two independent-session cases observe advisory blocking: exact commit replay and following claim versus preceding commit.
- [Proof harness](../../scripts/proofs/creature-aggression.test.mjs) reuses complete selected G4A21/G4A15 source composition, actual decoder/catalogue/Edge resolver. Current runtime graph is explicitly repinned in [source adapters](../../scripts/proofs/g4a12/source-adapters.mjs); historical proof results are not relabeled. Reduced schema/namespace/clock/Auth/INVOKER substitutions remain. Existing intent helper is a double, with its omitted autoattack state explicitly seeded. Test AC/class/CP/intent fixtures exercise real missed rolls and real published ability handlers; they do not hand-edit miss events. `rend` is an accepted non-damaging application, not a fabricated landed zero-damage strike (current direct-damage mechanics enforce minimum1). Stale-generation proposals and rollback setup are synthetic adversarial fixtures. Return relocation/death setup is fixture-only, followed by actual entry/respawn bodies. Full hosted scheduler/RLS/worker parity is not proven.
- **89 focused Vitest checks PASS**:83 resolver,1 source guard,2 Edge packaging/mirror and3 project-state. Typecheck and production build PASS (existing large-chunk advisory only); state synchronization, documentation references, source/history and whitespace checks PASS. No gameplay acceptance has been executed. Initial import-extension, graph-pin and fixture-AC errors were corrected locally before final validation.

Run native proof with local PostgreSQL bin in `WOV_LOCAL_PG_BIN`, then `node --test scripts/proofs/creature-aggression.test.mjs`. No hosted URL fallback is accepted.

Reviewed Edge dependency file SHA-256 (exact repository artifact bytes):

- Resolver: `3099daeba7cf83122988391648ecbba02a1b5a3fcffc2e5e82ce8f10d35d6adf`
- Types: `4f9e87bee841d6d9e5ca910282670d36261076564efabb94fe6cd4a1a8319835`
- Normalized complete transitive worker/catalogue source graph: `539fc530fa9ebace9f36b4723ddb699a0f39058d83eb1118df9030074c949263` (proof pin; not a deployed bundle fingerprint).

## Minimal parity and exact installation sequence

1. Owner reviews the exact final commit; no merge is performed here. Separately authorize permitted transactionally read-only Lovable catalog inspection: original core definition/MD5, owner/security/search_path/config/ACL and effective service-only authority; creature/generation fields and trigger order; relevant0024 coverage, arrival and respawn definitions only where fresh evidence is absent. Verify marker/helper absent and effective browser column writes denied. Compare current Drizzle prefix/dependencies. No player rows, gameplay calls, sandbox_exec or broad audit. Stop on drift, masked required visibility, unexpected grants or an already-installed earlier candidate; that requires a separate forward delta, not replay.
2. Separately authorize **one atomic standard custom-SQL Drizzle installation** of the exact SQL hash above. Lovable owns outer transaction/history/snapshot/derived types; no top-level BEGIN/COMMIT or historical replay. Verify revised core MD5, unchanged metadata, strict helper ACL, trigger/constraint, generated bytes and unchanged prior history. All candidate changes must roll back on failure.
3. After SQL verification, separately deploy **only `combat2-tick`** with its reviewed shared resolver/types dependencies. No dispatcher, secrets, schedules or progression changes. Record exact submitted commit/source hashes and distinguish deployment success from independently verified live bundle identity. Old worker omits the field and therefore does not provoke under revised SQL; database-first is compatible but the feature remains inactive until the matching worker is deployed. New worker against old database similarly cannot provide the rule. Coordinate the release; do not claim activation at the intermediate stage.
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
