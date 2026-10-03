# Combat2 legacy SQL dependency audit (installed, read-only)

Companion to the [legacy runtime retirement audit](combat2-legacy-runtime-retirement-audit.md); roadmap item `ENG-LEGACY-002` in the [engine roadmap](../roadmap/game-engine-roadmap.md). Source checkpoint `724cde8dff94ea0ab57cf5df4d3837526dd54362`. This document records evidence and a recommendation only. It does not authorize any revoke, removal, migration or deployment.

## Evidence boundary

- **Fresh installed evidence:** catalogue reads by Lovable on 2026-10-02 at 18:14:37 UTC in one `REPEATABLE READ READ ONLY` transaction (`pg_proc`, `pg_get_functiondef`, `has_function_privilege`, `aclexplode`, `pg_trigger`, `pg_policies`, `pg_views`, `pg_depend`), plus separate read-only counts and a `cron.job` read. No candidate function was invoked.
- **Processing state at inspection:** world `asleep` (changed 2026-10-02 12:30 UTC), `combat_mode = maintenance`, `combat_soak = off`. Observed only; nothing changed.
- **Unavailable:** `vault` schema (permission denied) so the presence of `effects_catchup_service_role_key` is unknown; `pg_net` request history; deployed Edge source and logs; old-client or external callers. Function-body text search finds static PL/pgSQL calls only; dynamic SQL built from fragments, and HTTP/RPC callers outside the database, cannot be ruled out.
- **Fingerprint** below is `md5(pg_get_functiondef(oid))`, a drift marker, not a security hash.
- **Access** is effective `EXECUTE` checked with `has_function_privilege` per role; `PUBLIC` means the ACL (or default ACL) grants `EXECUTE` to grantee 0. postgres (owner) always retains execution.

## Candidate matrix

| Installed signature | Owner / definer / volatility / search_path | Fingerprint | Effective access | Installed callers / triggers | Repository callers | Disposition; confidence |
|---|---|---|---|---|---|---|
| `activate_stance(uuid,text,integer)` | postgres / yes / volatile / public | f653940a | service_role | none | fenced `useCombatActions` (flag-off only) | candidate for guarded retirement (function retirement after source removal); high |
| `drop_stance(uuid,text)` | postgres / yes / volatile / public | e97f6238 | service_role | none | fenced `useCombatActions` (flag-off only) | candidate for guarded retirement; high |
| `apply_force_shield_regen(uuid)` | postgres / yes / volatile / public | 31709f23 | service_role | none | none (comment only) | candidate for guarded retirement; high |
| `clear_stances(uuid)` | postgres / yes / volatile / public | b45bbfa4 | PUBLIC, anon, authenticated, service_role | none | `GameRoute` (flag-off only) | **isolate first**: obsolete, browser- and anon-reachable; high |
| `sync_stance_effects()` (trigger) | postgres / no / volatile / public | c49ece47 | PUBLIC, anon, authenticated, service_role (trigger function; direct call refused outside a trigger) | `trg_characters_sync_stance_effects` AFTER UPDATE OF `reserved_buffs` | none | retain for now; trigger retirement later; medium |
| `enforce_stance_effect_lifetime()` (trigger) | postgres / no / volatile | — | anon, authenticated, service_role (trigger-only) | `trg_active_effects_stance_lifetime` BEFORE INSERT/UPDATE on `active_effects` | none | retain for now; trigger retirement later; medium |
| `release_stances_on_death()` (trigger) | postgres / yes / volatile | — | service_role | deferred constraint trigger AFTER UPDATE OF `hp` on `characters` | none | **unresolved**: may still be part of death cleanup; needs body review against Combat2 death path |
| `effects_catchup_send(uuid,uuid,bigint,uuid,integer)` | postgres / yes / volatile / public | ecea10b2 | anon, authenticated, service_role | `effects_catchup_dispatch_one`, `effects_due_dispatch` | type/comments only | **isolate first**: reads Vault key and posts to retired `combat-catchup`; anon-reachable; high |
| `effects_catchup_dispatch_one(uuid)` | postgres / yes / volatile / public | 6aabce3e | anon, authenticated, service_role | none | none | **isolate first**; high |
| `effects_catchup_reconcile(integer)` | postgres / yes / volatile / public | 867305d4 | anon, authenticated, service_role | `effects_due_dispatch` | comments only | **isolate first**; high |
| `effects_catchup_credential_health()` | postgres / yes / volatile / public | b9fc05d8 | anon, authenticated, service_role | none | none | **isolate first**; high |
| `effects_due_dispatch(integer)` | postgres / yes / volatile / public, cron | 412f017d | service_role | scheduled by `schedule_effects_catchup` as cron `effects-catchup` every 2 s | none | isolate first (scheduler path); high |
| `schedule_effects_catchup()` | postgres / yes / volatile / public, cron | 9a58fab5 | service_role | `wake_world`, `world_watchdog`, `arm_effects_catchup_for_node` | none | **isolate first**: a second 2-second clock reachable from wake; high |
| `unschedule_effects_catchup()` | postgres / yes / volatile / public, cron | 67a5e5a5 | service_role | `effects_due_dispatch`, `harness_fail_closed`, `world_watchdog` | none | retain until callers are rewired (it is the safe-off path); high |
| `combat2_dispatch_scheduler_fire_without_heartbeat_identity()` | postgres / yes / volatile / public, pg_temp | 46f48faa | service_role | not called by any installed function body | none | unresolved rollback predecessor; retain; medium |
| `damage_party_member(uuid,integer)`, `heal_party_member(uuid,uuid,integer)`, `heal_party_member(uuid,uuid,integer,integer)` | postgres / yes / volatile / public | 95e37262, e634fd19, ea142140 | authenticated, service_role | none | movement/rest (L1 deliberately live) | retain (L1 rule); high |
| `sync_character_resources(uuid)` | postgres / yes / volatile / public | 32778de5 | authenticated, service_role | `join_order`, `train_renown_stat` | `GameRoute` entry | retain: active; high |

Other observations: no RLS policy and no view references these candidates or `reserved_buffs` / `stance_state`. `pg_depend` reports no non-internal dependency on any candidate. `cron.job` returned **zero rows** at inspection, so `effects-catchup` is not currently scheduled. `wake_world` and `world_watchdog` are executable by anon and authenticated; `wake_world` calls `schedule_effects_catchup` only when `effects_due_scopes(1, NULL)` returns a row; `arm_effects_catchup_for_node` is reached from `encounter_disengage`, `leave_encounter_engagements` and `encounter_end_participation`.

## Aggregate legacy state (counts only)

| Item | Count |
|---|---|
| characters | 21 |
| characters with non-empty `reserved_buffs` | 0 |
| characters with non-empty `stance_state` | 0 |
| `active_effects` rows (any / stance-typed) | 0 / 0 |
| `character_stance` / `character_stance_request` (current authority) | 5 / 19 |
| `effects_catchup_dispatch` rows | 0 |
| `effects_catchup_log` rows (last entry 2026-08-27 18:31 UTC) | 179 |

No legacy stance state coexists with current authority; no record currently blocks retirement. The 179 log rows are historical evidence, not cleanup targets.

## Retained active predecessors

Unchanged from the canonical audit and not re-audited here: `combat_intent`, `node_tick_claim`, `node_tick_commit`, departure, arrival, settlement and Arena `*_without_*` chains; `combat2_dispatch_scheduler_fire` and its resource-settlement predecessor; stance class/equipment refusal triggers. They are composed by current wrappers.

## Batch C — execution reported installed; history unreconciled

**ENG-LEGACY-002 batch C — privilege isolation of the old catch-up transport and entry clear.** Privilege revocation only; no function, trigger, column or data change.

1. Revoke `EXECUTE` from PUBLIC, anon and authenticated on, by exact signature: `effects_catchup_send(uuid,uuid,bigint,uuid,integer)`, `effects_catchup_dispatch_one(uuid)`, `effects_catchup_reconcile(integer)`, `effects_catchup_credential_health()`, `clear_stances(uuid)`. Keep service_role and postgres.
2. Guards: preflight asserts the exact signatures and the fingerprints above, and that `cron.job` has no `effects-catchup` row; abort on drift. In-transaction assertions use `has_function_privilege` for each role, including inherited PUBLIC.
3. Compatibility decision now approved by Mik: Combat1 is retired as a supported execution path; the remaining flag-off `GameRoute.clear_stances` caller is not a reason to preserve browser execution. Revocation includes that exact overload. Source callers are not removed/restored in this privilege-only batch.
4. Verification: rollback-only full-file run with a final sentinel, then one install; repeat effective access checks; bodies/owners/definer/search paths unchanged; protected gameplay fingerprint unchanged; focused privilege test in `src/server/combat2/__tests__`.

### Corrected schedule gate and Lovable practice-run evidence

Lovable reports the rejected, uninstalled hash `1fc1314088a3b48184c354f568046abadfc795c50f15c5a753f01088affb762f` failed SQLSTATE `42501` at `LOCK TABLE cron.job IN SHARE MODE NOWAIT`, before any REVOKE. postgres can read cron.job, but its owner is supabase_admin. All five predecessors/metadata matched, schedules were absent, ACLs remained unchanged and ledger count remained 510. This is supplied Lovable evidence, not local PostgreSQL verification.

Removed only the unsupported lock, with no replacement. Repository `wake_world` (20260824010343) and `world_watchdog` / `schedule_effects_catchup` (20260817152132) use absence checks plus cron.schedule without a shared exclusion-lock protocol. A private advisory lock or weaker table lock here does not establish mutual exclusion with those callers. Observed absence is sufficient for this privilege-only installation precondition; it is not a permanent schedule guarantee. Batch C does not disable owner-rights internal calls or prevent scheduler rearming. RLS visibility and named/command schedule checks remain intact; modifying the rearming paths remains separate work.

### Preserved source contract and completed practice gate

Installed source (Lovable-reported): `20261002190000_combat2_legacy_browser_privileges.sql`, SHA-256 `73df81b17ee54a0294e231d2f91a70ecc3a9da37508c027f00674d8181b92b65`. Source authoring and contract tests are not installed PostgreSQL proof. The eight-character MD5 values supplied above are abbreviated drift markers; no full installed hash is fabricated. Guards use those exact prefixes plus signature, result type, owner postgres, PL/pgSQL, SECURITY DEFINER, volatility and exact search-path metadata, not formatting-sensitive function-body substitutions.

All five preflights complete before any REVOKE. Missing functions/roles, additional overloads, metadata/definition drift, cron-table absence or incomplete RLS visibility, schedule presence and inherited browser access fail closed. Schedule absence is a read-only installation precondition: this gate does not prevent concurrent schedule creation. No table/advisory fence is claimed and no jobs are changed. Effective inheritance and conservative membership/SET ROLE paths to owner, superuser or retained grantees refuse and require a separate decision; no memberships or unrelated ACLs are altered. Inline postconditions deny PUBLIC/anon/authenticated and retain postgres/service_role plus every non-browser explicit ACL grant, grantor and grant option. Full catalogue metadata (excluding the intended ACL change) and complete definitions compare exactly before/after. Any error rolls back all five revocations. No gameplay/legacy-state cleanup or encounter-absence requirement is added.

Expected privilege matrix: send/dispatch_one/reconcile/credential_health had effective anon/authenticated access at the reported snapshot (PUBLIC ACL status is not asserted for these four); clear_stances had PUBLIC/anon/authenticated. After installation all five deny PUBLIC/anon/authenticated, retaining postgres/service_role and existing trusted grants, including credential-health read-only access where present. Service-role/body-guarded internal calls remain possible; this is not function retirement.

### Installation outcome and repository tooling

Lovable reports corrected batch C executed once, full rollback-only practice passed and restored original ACLs, and post-install browser execution denied on all five targets. postgres/service_role and existing non-browser grants retained; bodies and security metadata unchanged; no schedules or gameplay data changed. This is supplied evidence, not Codex Cloud verification. The ordinary Supabase ledger remained at 510 entries, newest version `20261001230000`; no batch-C Supabase ledger entry exists per handoff. Execution success is not history reconciliation.

Git at `707804addda01af21b28179e9c01d2f7a4d5b945` contains `drizzle/migrations/0000_combat2_legacy_browser_privileges.sql`, byte-identical to the Supabase source; both Git-blob SHA-256 values are `73df81b17ee54a0294e231d2f91a70ecc3a9da37508c027f00674d8181b92b65`. Retain both unchanged. Commit `beff5bde` newly introduced drizzle-kit 0.31.11, drizzle-orm 0.45.3, postgres 3.4.9, bun.lock updates, drizzle.config.ts, blank drizzle/schema.ts, an empty schema snapshot and local _journal.json entry (idx 0, tag 0000_combat2_legacy_browser_privileges, breakpoints true). Configuration selects PostgreSQL, schema ./drizzle/schema.ts and output ./drizzle/migrations; connection comes from an environment variable, not inspected here. Package scripts contain no migration invocation; scripts/source contain no Drizzle migrator wiring and no repository CI migration workflow was found. Supabase config and supabase/migrations remain present. Neither runner was invoked.

Local file journal is not database journal proof. The empty snapshot is not the installed WoV schema. Repository configuration does not prove the actual Cloud tool, command, connection or database journal. Lovable reports use of a Drizzle tool, but the incoming claim that the ledger identity is the Drizzle journal lacks database-row evidence and is not adopted. Drizzle defaults to a separate database migration log; actual location/configuration and matching row must be discovered ([official configuration](https://orm.drizzle.team/docs/drizzle-config-file)). Supabase tracks remote versions separately ([official migration workflow](https://supabase.com/docs/guides/deployment/database-migrations)). Both directories expose the same SQL to their respective runners: if either history lacks its entry, execution/reconciliation may be attempted again. The unrecorded source version can be treated as pending or produce a local/remote history mismatch; existing higher versions do not prove it applied. No automatic dual-runner pipeline is established by repository evidence.

### Read-only discovery and conditional history reconciliation

Resolve this operational blocker **before the next migration**: pending duplicate discovery can replay the privilege SQL or prevent a later push; intentional REVOKEs do not justify blind reapplication.

1. With separate read-only Cloud authorization, identify the exact tool/command/version/configuration and database used; inspect its database journal (if any), the standard Supabase ledger, all five effective ACLs/full definitions/security metadata and both source/artifact identities. Record actual row version/hash/timestamp, or explicit absence/inaccessibility, without exposing credentials. Confirm current schedules read-only; absence remains observation, not exclusion.
2. If a matching Drizzle database journal row exists, record proof while separately addressing missing Supabase history. If only SQL execution occurred and no journal exists, record installed effects but untracked history; determine the intended single release runner before proposing metadata repair. If Supabase history has since appeared, verify exact identity/content and reconcile records without writing. Any hash/target/ACL mismatch, unknown database or inaccessible journal is a stop requiring evidence, not reexecution.
3. Only after exact applied effects/source are proven, duplicate/conflicting versions ruled out, desired runner established and Mik separately authorizes metadata-only repair, evaluate the supported tool's history-repair facility. For Supabase, its official `migration repair --status applied` mechanism changes migration history, not SQL effects ([CLI reference](https://supabase.com/docs/reference/cli/supabase-migration-repair)). First validate installed CLI/version support and the intended version `20261002190000`; do not blindly run it, invent ledger rows, mutate a Drizzle journal manually, or use migration/push/reset to repeat SQL. If no supported repair is available through Lovable, report the access/tool gap for an operator decision.
4. After an authorized repair, compare before/after journals and migration list: exactly the intended metadata change, no duplicated SQL execution, privileges/bodies/metadata/schedules/gameplay fingerprints unchanged, and both runners' pending discovery understood. Record real journal/ledger proof and runner choice; preserve both repository SQL files. No schema/tooling change, new migration, deployment or publication is required by this repository reconciliation.

**Separate later decisions, in order:**

- Rewire `wake_world` / `world_watchdog` / `arm_effects_catchup_for_node` away from `schedule_effects_catchup` (function replacement), which removes the second 2-second clock entirely. Needs Mik's decision because it touches wake and disengage paths.
- Source removal of the flag-off `activate_stance` / `drop_stance` / `clear_stances` callers, then exact-signature function retirement of those three plus `apply_force_shield_regen`.
- Trigger retirement of `trg_characters_sync_stance_effects` and `trg_active_effects_stance_lifetime` after confirming nothing writes `reserved_buffs` or stance-lifetime `active_effects`; `release_stances_on_death` needs its own review.
- Column/data retirement of `reserved_buffs` / `stance_state` only under an approved compatibility policy.

No `DROP CASCADE` and no edits to historical migrations are recommended.

### Journal discovery (read-only Cloud inspection, 2026-10-03T10:24:58Z)

Fresh installed evidence, not handoff memory:

- Execution route: Lovable's `lov_database--migration` tool. Its contract creates a Drizzle Kit custom migration, writes the SQL verbatim and applies it with Drizzle's migrator; journal recording is automatic and goes only to the Drizzle database journal. The exact internal command line is not recoverable beyond that contract.
- Journal tables found: `drizzle.__drizzle_migrations`, `supabase_migrations.schema_migrations` (plus unrelated `auth`, `realtime`, `storage` journals).
- `drizzle.__drizzle_migrations`: exactly one row, id 1, hash `73df81b17ee54a0294e231d2f91a70ecc3a9da37508c027f00674d8181b92b65`, created_at 1791021613818 (2026-10-03T10:00:13.818Z), equal to the local `_journal.json` `when`. Batch C **is** represented here.
- `supabase_migrations.schema_migrations`: 510 rows, newest `20261001230000`; no `20261002*` version. Batch C is **not** represented. The only rows containing REVOKE and `effects_catchup_credential_health` are the August predecessors.
- Applied effects: all five targets keep owner postgres, SECURITY DEFINER, volatile, `search_path=public` and fingerprints ecea10b2 / 6aabce3e / 867305d4 / b9fc05d8 / b45bbfa4. No PUBLIC ACL entry; anon and authenticated cannot execute; postgres and service_role can; sandbox_exec and supabase_read_only_user (credential_health) grants retained. This proves current state, not the precise execution moment.

Reconciliation route: earlier migrations in this project reached the Supabase ledger, batch C reached only the Drizzle journal, so two journals now diverge. The Lovable migration tool is the only runner available to agents and treats batch C as applied (matching hash), so it will not replay it. A Supabase CLI push would see `20261002190000` as pending. The supported Supabase metadata-only repair is `supabase migration repair --status applied 20261002190000` (journal-only effect: one ledger row; verify by recount to 511 and unchanged ACL/fingerprints). Lovable has no CLI or credential for it and no tool that writes that ledger without executing SQL, so this is a missing capability, not a step to improvise. Hand-inserting ledger rows is not supported. Further migrations should stay paused until Mik decides which runner is canonical. Repository tooling cleanup (Drizzle config vs `supabase/migrations/`) is a separate decision; nothing was removed.
