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

## Batch C — authored privilege isolation, not installed

**ENG-LEGACY-002 batch C — privilege isolation of the old catch-up transport and entry clear.** Privilege revocation only; no function, trigger, column or data change.

1. Revoke `EXECUTE` from PUBLIC, anon and authenticated on, by exact signature: `effects_catchup_send(uuid,uuid,bigint,uuid,integer)`, `effects_catchup_dispatch_one(uuid)`, `effects_catchup_reconcile(integer)`, `effects_catchup_credential_health()`, `clear_stances(uuid)`. Keep service_role and postgres.
2. Guards: preflight asserts the exact signatures and the fingerprints above, and that `cron.job` has no `effects-catchup` row; abort on drift. In-transaction assertions use `has_function_privilege` for each role, including inherited PUBLIC.
3. Compatibility decision now approved by Mik: Combat1 is retired as a supported execution path; the remaining flag-off `GameRoute.clear_stances` caller is not a reason to preserve browser execution. Revocation includes that exact overload. Source callers are not removed/restored in this privilege-only batch.
4. Verification: rollback-only full-file run with a final sentinel, then one install; repeat effective access checks; bodies/owners/definer/search paths unchanged; protected gameplay fingerprint unchanged; focused privilege test in `src/server/combat2/__tests__`.

### Authored migration and installation gate

Candidate: `20261002190000_combat2_legacy_browser_privileges.sql`, SHA-256 `1fc1314088a3b48184c354f568046abadfc795c50f15c5a753f01088affb762f`. Source authoring and contract tests are not installed PostgreSQL proof. The eight-character MD5 values supplied above are abbreviated drift markers; no full installed hash is fabricated. Guards use those exact prefixes plus signature, result type, owner postgres, PL/pgSQL, SECURITY DEFINER, volatility and exact search-path metadata, not formatting-sensitive function-body substitutions.

All five preflights complete before any REVOKE. Missing functions/roles, additional overloads, metadata/definition drift, cron-table absence or incomplete RLS visibility, schedule presence and inherited browser access fail closed. A NOWAIT SHARE lock fences concurrent cron-job creation only during this transaction; no jobs are changed. Effective inheritance and conservative membership/SET ROLE paths to owner, superuser or retained grantees refuse and require a separate decision; no memberships or unrelated ACLs are altered. Inline postconditions deny PUBLIC/anon/authenticated and retain postgres/service_role plus every non-browser explicit ACL grant, grantor and grant option. Full catalogue metadata (excluding the intended ACL change) and complete definitions compare exactly before/after. Any error rolls back all five revocations. No gameplay/legacy-state cleanup or encounter-absence requirement is added.

Expected privilege matrix: send/dispatch_one/reconcile/credential_health had effective anon/authenticated access at the reported snapshot (PUBLIC ACL status is not asserted for these four); clear_stances had PUBLIC/anon/authenticated. After installation all five deny PUBLIC/anon/authenticated, retaining postgres/service_role and existing trusted grants, including credential-health read-only access where present. Service-role/body-guarded internal calls remain possible; this is not function retirement.

**Lovable checklist — requires separate installation authorization:**

1. Verify the full candidate hash and absent ledger version; fresh read-only catalogue/schedule checks with complete cron RLS visibility. Keep processing disabled through compilation/installation; do not change mode/schedules or invoke functions to prepare this task. Do not delete active encounter/gameplay rows.
2. Inspect all five exact signatures, full definitions/MD5s, return types, owner, language, security, volatility, search paths, ACLs and role memberships. Compare full bodies with the actual repository predecessors linked by the focused test; resolve any difference, rather than accepting abbreviated MD5 agreement alone. Confirm no named or aliased-command effects-catchup job exists. Capture trusted role access, including any read-only/internal grant. Inherited browser access is a stop condition, not authority to change roles.
3. Compile the **entire file** in one rollback-only transaction, reach an external final sentinel after its single complete DO statement, and inspect effective PUBLIC/anon/authenticated denial, postgres/service_role access, unchanged other grants and exact full definitions/metadata. Do not call the five functions, create fixtures, or invoke wake/scheduler/gameplay. These local lexer/static tests are not compilation.
4. Roll back and prove original ACLs and protected data/metadata restored. Only after that passes and installation is separately authorized, install once atomically; repeat exact signature/role/body/metadata checks, unchanged protected resource/location/effect/encounter/stance/log/history fingerprints and no effects-catchup schedule. Record actual ledger/source identities and limitations; do not fabricate a ledger artifact.
5. No Edge deployment, type regeneration or frontend publication is required for this ACL-only diff. Earlier browser isolation publication/live checks remain pending. `wake_world`, `world_watchdog` and `arm_effects_catchup_for_node` can still recreate the obsolete schedule: this remains a separately approved task, not solved by batch C.

**Separate later decisions, in order:**

- Rewire `wake_world` / `world_watchdog` / `arm_effects_catchup_for_node` away from `schedule_effects_catchup` (function replacement), which removes the second 2-second clock entirely. Needs Mik's decision because it touches wake and disengage paths.
- Source removal of the flag-off `activate_stance` / `drop_stance` / `clear_stances` callers, then exact-signature function retirement of those three plus `apply_force_shield_regen`.
- Trigger retirement of `trg_characters_sync_stance_effects` and `trg_active_effects_stance_lifetime` after confirming nothing writes `reserved_buffs` or stance-lifetime `active_effects`; `release_stances_on_death` needs its own review.
- Column/data retirement of `reserved_buffs` / `stance_state` only under an approved compatibility policy.

No `DROP CASCADE` and no edits to historical migrations are recommended.
