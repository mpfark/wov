# P2-B local integration and containment

## Checkpoint and proof boundary

Started at `5a5e060219fed0dc930722bdf3ff3630d78241ea`; fetched and fast-forwarded to `f3c357a24de85e254e41893242a90996bcf43987` = `origin/main`. Recorded baseline ancestry passes. Final HEAD unchanged; local work uncommitted/unpushed. Recovery stash remains `0a5529d5227675319b166881b10f1c91edd7486b`.

Mik reports installed `0009`, postgres ownership, fixed search path and owner-only EXECUTE. Local Git blobs of generated `0009` and reviewed P2-A SQL both match `785ef260b90e5255ed37055aea29414a7b352c6bbced52f52cb53a12be071174` (15344 UTF-8/LF bytes). Windows checkout CRLF bytes differ; no SQL change. This verifies source equivalence, not fresh hosted metadata or runtime. No Cloud/gameplay operations, installation, deployment, frontend change/publication, commit or push in P2-B. Generated types/journal/snapshots came from the fetched platform commit and are not edited locally.

Affected scope: ENG-PROGRESSION-001G-C2 creation in engine § progression and roadmap ENG-PROGRESSION-001G. Approved rules preserved; no new deletion/restore policy. F remains closed with all four limitations below.

### Inactive installation attempt 1 and local correction

P2-B source was subsequently pushed at `95d8b23517e84226f607b8587bdded7a3107dfa0`. Mik reports that installation of the original inactive SQL (`900cb8dba532a6d779073425dd0abd0f0b9f008e1abf0cde0c3dbb3d0fe9ce11`) failed with `materials inherited browser write privilege: postgres` and rolled back cleanly. **No P2-B migration installed.** Execution timestamp was not supplied; this is operator evidence, not a Codex hosted inspection. A new fetch shows HEAD=origin/main at that source checkpoint; no failed-operation source commit appeared.

PostgreSQL stores the granted role in `pg_auth_members.roleid` and the recipient in `member`. `GRANT authenticated,anon TO postgres` therefore legitimately puts postgres in the descendant set. The recursive direction was correct, but classifying the database owner as a browser principal was incorrect. The correction excludes only `character_materials.relowner` from the effective browser-write assertion; the existing dependency assertion still requires that owner to be postgres. It does not exempt arbitrary superusers, BYPASSRLS roles or named platform roles. Browser roots and other descendants remain checked using unchanged effective table/column privilege predicates, including inherited and PUBLIC rights. Browser inheritance of postgres is still refused on the browser's own privileges.

No grants, RLS, FK, bridge, formulas or other SQL behavior changed. Cutover SQL and preflight hashes remain unchanged. Cutover's analogous owner/member assertions are a separate activation-only readiness concern; this fix does not certify B for installation under the hosted owner-membership topology. There is no direct inactive-installation dependency requiring a cutover edit.

Local correction is uncommitted/unpushed. **GO for preparation of a second inactive-only attempt** from a separately authorized corrected source checkpoint, with the new hash below and unchanged narrow pre/post-install requirements. Not authorization to execute or activate. Recovery stash and the four F limitations remain unchanged.

## A — installable while new creation stays inactive

`progression-001G-C2-P2-B-inactive-integration.sql` introduces:

- One postgres-owned SECURITY DEFINER bridge, `character_create_c2(uuid,text,text,text,uuid,text,text)`, fixed `pg_catalog,public,pg_temp` path. **Owner-only EXECUTE** on installation, including removal of default grants. The bridge invokes the private authority as postgres without granting service_role EXECUTE. JWT `auth.uid()` remains the actual actor. No Edge Function or additional creation system.
- Choice/request inputs only, with all ownership, Overlord reason/audit, payload binding, request/account locks, quota and formulas delegated unchanged to installed `0009`. Returns only `{kind,characterId}`; private receipt/snapshot/starting values are not projected. Normal actor cannot select another account; Overlord delegation remains checked by `0009`.
- `character_materials_character_id_c2_fkey`, `ON DELETE CASCADE ON UPDATE RESTRICT NOT VALID`. New writes gain parent integrity immediately; existing orphan rows are preserved. No automatic repair or deletion. Cascade applies only on permanent parent removal, never soft deletion; new characters' immutable origin RESTRICT still prevents bare parent deletion.
- Browser direct material writes removed at table and column level; authenticated SELECT retained, existing RLS unchanged. Service-role and postgres-definer material writers retained. No characters UPDATE grants changed.

Inactive installation does **not** retire currently active legacy creation/deletion. New C2 creation remains unavailable to application roles until the separately gated cutover. Existing SQL/migration history/material trigger unchanged.

## B — prepared shutdown, activation blocked

`progression-001G-C2-P2-B-cutover-containment.sql` is a separate, transactionally installed **maintenance/cutover-only** package, not part of A:

1. Validate the materials FK; an orphan causes full rollback before writer shutdown.
2. Remove nonowner EXECUTE on installed overloads of `character_create`, `c2_harness_run`, `c2_harness_run_c` and `delete_character_cascade`. Owner-only historical harness use remains possible. Unexpected owners or inherited application access abort.
3. Remove application direct characters INSERT (table and columns) and DELETE; fail closed on inherited grants. Keep existing SELECT and all existing column/table UPDATE rights unchanged; no broad UPDATE grant introduced.
4. Require the bridge still paused. **There is no application EXECUTE grant in either SQL file.**

This disables existing create/delete UI actions and cannot be installed as an ordinary inactive additive change. It intentionally prepares fail-closed shutdown, not soft deletion or restoration. A later activation grant is withheld because the approved lifecycle is not implemented. No claim that all unrelated SECURITY DEFINER deletion paths or platform account administration have been audited/contained.

### Exact dependencies and consumers

| Path | Source evidence | Treatment |
|---|---|---|
| Browser creation | `src/features/character/hooks/useCharacter.ts:356` calls legacy RPC with client stats; `src/pages/CharacterCreation.tsx:105` calculates stats and then `:115` applies family | Leave untouched now; switch separately after gates. Remove client authority and post-create family mutation |
| Creation selection | `src/pages/Index.tsx:85`, hook appends full character | Bridge returns ID/kind only. Future hook must fetch authoritative owner character, update list and select; delegated creation must not expose another account's full row |
| Browser deletion | `src/features/character/hooks/useCharacter.ts:339` optimistic removal + hard-delete RPC, refetch on failure | Cutover shutdown breaks this intentionally; replacement soft-delete UI/authority is prerequisite or separately owner-approved deletion freeze |
| Hard-delete definer | `supabase/migrations/20260623072204_ba238bbb-a55c-4000-8b35-69eb36bb3cba.sql`, `delete_character_cascade`: owner/steward/Overlord, explicit material cleanup then parent | Prepared owner-only containment; not a 30-day restore/purge implementation |
| Other source creation writers | `supabase/migrations/20260813111901_0280af33-fbbd-496a-8686-e18f39c5626c.sql:1` / `:800`; `20260813123556_def190db-e5b8-4122-ae7d-1e2737cee161.sql:24` / `:150` | Historical creation harnesses; service grant/defaults historically present. No current browser caller found in inspected path. Conditional installed-object shutdown; installed existence/effective ACL is not inferred |
| Material browser reader | `src/features/inventory/hooks/useMaterials.ts:35` | Keep authenticated SELECT + existing ownership/steward RLS |
| Service material reader/writers | `supabase/functions/jewelcrafter-gemcutter/index.ts:18`; existing `add_material`/`consume_material` and admin material grants | Preserve service and owner-definer rights. No change to crafting or reward functions |
| Sole initial material grant | `supabase/migrations/20260803232302_acc7c4e5-4148-48c0-8f35-8c2299e23944.sql` | Exact existing trigger unchanged; no duplicated grants |
| Current admin character handlers | `supabase/functions/admin-users/index.ts:158,255,357` | Updates, not creation; preserve existing unprotected service UPDATE capability |

## Blockers and separate activation steps

**No further creation policy decision is needed for A.** Hosted dependency/current prefix/namespace/ACL verification is a narrow installation check, not a repeated architecture audit. If prechecks contradict supplied facts, stop; do not broaden grants or repair history.

Activation is blocked by:

1. **Deletion lifecycle absent.** Current source has hard deletion, no installed soft-delete/30-day restore authority. The existing owner/steward deletion permission conflicts with Overlord-only restoration policy; revoking it provides a pause, not lifecycle completion. Need a separately scoped implementation of tombstone, account-lock coordination, 30-day window, Overlord restore, permanent purge, origin removal, replay `purged` transition, and 12-month detailed receipt retention. Count every retained row as `0009` already does. Account deletion must retire only the deleted actor's replay binding, retain unexpired detail, and never delete another recipient's immutable origin just because the creator account is removed. No second deletion mechanism introduced here.
2. **Existing materials orphans unknown.** Prepared aggregate count only. If any exist, owner must approve a bounded disposition based on evidence (legitimate parent restoration or separately approved data cleanup). No automatic purge/quarantine/renaming; cutover validation refuses them. Zero orphans needs no new owner decision.
3. **Frontend cutover incomplete.** Current UI supplies client stats, requires/applies family during creation and has no stable C2 request UUID. Separate change must submit choices + pinned revision, retain UUID/payload across lost-response retries, treat `purged` as terminal, avoid family assignment and fetch the authoritative result before selection. No frontend change made here.
4. **Current execution evidence.** Scoped post-install ACL/constraint verification and eventual real independent-session/runtime integration remain unproven. Historical supplied facts are not today's preflight.

Future cutover order: approved creation/deletion maintenance window → complete deletion containment/lifecycle and orphan resolution → install B shutdown atomically while bridge owner-only → prepare/test frontend for C2 → separately authorized authenticated-only bridge grant (anon/service/internal remain denied) → Mik's separate manual frontend publication. Keep creation unavailable between shutdown and complete cutover; no public partially migrated C2 path. Existing legacy flow during A is explicitly historical, not C2 activation.

## Minimal Lovable handoff — A only, after separate authorization

Required source: a future separately authorized published checkpoint containing this package, descended from `f3c357a2`; **current files are not pushed**. Expected standard installed Drizzle prefix through `0009`, ten entries including `0000`; verify actual identity/hash/journal/snapshot, never repair Supabase history.

Read-only prechecks: expected prefix/0009 hash, private authority owner/path/ACL, postgres dependency table ownership, no conflicting bridge or materials FK, RLS and current browser/service material grants. `progression-001G-C2-P2-B-preflight.sql` supplies scoped counts and metadata only. No secret/environment reads or gameplay calls. Stop on changed dependencies, inherited rights the proposed transaction cannot remove, unexpected namespace/FK or prefix mismatch.

Use the standard tool to create its own next SQL/journal/snapshot from **only inactive-integration.sql**, outside-directory reviewed artifact. One atomic transaction; no filename precreation or alternate runner. Failed DDL/ACL assertion must roll back the entire operation. Inspect automatic source commits on success/failure; verify generated SQL bytes (normalize checkout line endings only for source comparison), actual Drizzle history, generated snapshot/types and no unexpected source diff.

Post-install metadata only: bridge/internal owner, SECURITY DEFINER/path, all application EXECUTE denied, materials FK present/unvalidated with exact actions, authenticated SELECT/browser direct writes denied, preserved service material permissions/RLS and character UPDATE privilege fingerprints (protected15 denied/unprotected38 allowed/authenticated six preferences). Legacy creation/deletion remain unchanged in A. Do not invoke either creation function, validate old orphan rows, install B, deploy, activate or publish frontend. Report installed/generated hashes and checkpoint.

## Validation and retained limitations

- Corrected P2-B exact SQL disposable PGlite tests: **16/16**. Actual installed `0009` plus exact A/B SQL; only a rolled-back fixture grants authenticated bridge EXECUTE. Original ten tests retained. Six added regression cases cover full inactive installation with postgres membership in both browser roles, removal of prior PUBLIC/browser grants, inherited parent table/column writes, ordinary browser-member direct writes, browser inheritance of postgres, and PUBLIC leaks. Original tests cover JWT identity/Overlord reason, baseline, replay/conflicts/quota/name cases, grants once, late rollback, legacy/harness/direct INSERT and delete rejection, inherited grant abort, future FK/orphan refusal, origin RESTRICT and simulated shutdown→bridge grant ordering. No restoration behavior claimed; B is not tested with the hosted owner topology.
- Existing P2-A exact SQL tests: **21/21**, six race/resource vectors, all late failure points, no gear, version0 progression continuity, retention/replay, pinned manifest. C test fixture has older broad UPDATE rights; new tests assert preservation, not that it represents installed F-R1 ACLs.
- Project-state validator passes; focused project-state Vitest **3/3** passes. Initial sandbox run could not resolve Vitest dependencies (EPERM); authorized local rerun passed. Existing Vitest configuration deprecation warning only. `git diff --check` passes; no full build necessary for SQL/docs-only scope. One local backend; queued calls/lock inspection are not hosted multi-session contention proof.
- Four F limitations preserved verbatim: **HOSTED MULTI-SESSION BEHAVIOR UNPROVEN; NATURAL RUNTIME PATH NOT YET OBSERVED; AUTHENTICATED COMMANDS-PAUSED RUNTIME PROBE NOT EXECUTED; RP EARNING AUTHORITY GAP.**

## Reviewed artifacts (UTF-8/LF SHA-256)

| File under `docs/operations/` | SHA-256 |
|---|---|
| `progression-001G-C2-P2-B-inactive-integration.sql` | `b5de77f39106308c47509d77d20e29fd2bde9924ef5d269a0dae45ab722cec54` |
| `progression-001G-C2-P2-B-cutover-containment.sql` | `7a8568526bcc97cc7e29a769226e0a78936e5718221e1a3e5f90602cf3eaee9f` |
| `progression-001G-C2-P2-B-preflight.sql` | `98d92b7980adb57dba0cfd11ad8504165229298092be06af9a1a563709cfada1` |

Next safe action: review/publish A checkpoint only with separate authorization, then minimum inactive standard-tool installation. B/full activation remain blocked; stop after local preparation.

Files authored: the three SQL artifacts above, this handoff, and `scripts/progression-001G-C2-P2-B-sql.test.mjs`. Tracking updated: `docs/operations/project-state.json` and generated `.md`, `docs/design/game-engine.md`, `docs/roadmap/game-engine-roadmap.md`. Nine local files total; existing P0/P1-A/P2-A documents and all numbered migrations/journal/snapshots unchanged.
