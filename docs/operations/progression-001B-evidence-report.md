# ENG-PROGRESSION-001B — Evidence report (read-only)

- Inspection window: 2026-10-04 10:45:59–10:51 UTC. Reporting actor: Lovable.
- Source: HEAD = origin/main = `c6c63fc20fc5b6c6ebdaa73e5dd9bbae7e3a4f1c` (approved checkpoint), clean worktree at start; `8f072624…` treated as historical preparation context.
- Project identity: Lovable Cloud ref `gpclaklkaolyzfnooajt` (nonsecret tool metadata). PostgreSQL 17.6.
- Read principals: `sandbox_exec` (catalog/body reads, `transaction_read_only=off` but role cannot write) and the Cloud read tool as `supabase_read_only_user` (member of `pg_read_all_data`, `pg_monitor`) for `supabase_migrations`, `drizzle`, `cron` and config reads. No other credential path was tried.
- World state at inspection: `asleep`, `combat_mode=maintenance`, `combat_soak=off`; `cron.job` = 0 rows.
- Rules affected: [game-engine.md, Progression and rewards](../design/game-engine.md#progression-and-rewards); roadmap ENG-PROGRESSION-001B. Rules preserved; nothing changed.

## H0 — Migration runner/history gate

| Item | Fresh evidence |
|---|---|
| Supabase history columns | version, statements, name, created_by, idempotency_key, rollback |
| Supabase history | 510 rows; newest `20261001230000`; batch C (`20261002190000` / `legacy_browser`) absent |
| Drizzle history columns | id integer, hash text, created_at bigint |
| Drizzle history | 1 row: id 1, hash `73df81b17ee54a0294e231d2f91a70ecc3a9da37508c027f00674d8181b92b65`, created_at 1791021613818 (= local journal `when`) |
| Drizzle journal | 1 entry, tag `0000_combat2_legacy_browser_privileges`, version 7 |
| Supabase source file | working SHA-256 `73df…2b65`, Git blob `8387794e0fea37b4baec858d7f509a089e30fc9e`, blob SHA-256 `73df…2b65` |
| Drizzle copy | working SHA-256 now `73df…2b65` (the earlier CRLF `85f3c271…` working bytes are no longer present), same Git blob `8387794e…` |
| Rejected artifact `1fc13140…` | not present in either history (consistent with SQLSTATE 42501, no effect) |

Version reconciliation (repository 545 files vs Supabase 510 rows):

- 279 exact version matches.
- 230 repository files whose version differs from a ledger version by at most 60 s (generator timestamp drift; most early files are +1 s). Version equality is not proven; content equivalence was not re-hashed per statement because the ledger stores split statements.
- 40 repository versions with no ledger version within 60 s: `20260831133000, 20260905090000, 20260906160000, 20260907110000, 20260908210000, 20260909090000, 20260909120000, 20260909150000, 20260909210000, 20260910090000, 20260911100000, 20260912100000, 20260912140000, 20260913100000, 20260914100000, 20260914110000, 20260915100000–20260915200000 (10 files), 20260921100000, 20260921110000, 20260922100000, 20260922140000, 20260923100000, 20260928100000, 20260929100000, 20260929130000, 20261001130000, 20261002190000`. Several are hand-authored sources whose installation was recorded under a tool-generated version (for example `20261001130000` → ledger `20261001213148`, `20260929100000` → `20260929093442`, `20260929130000` → `20260929211804`); the rest need per-file content attribution.
- 6 ledger versions without a distinct repository counterpart under the 60 s rule: `20260219140203, 20260329075051, 20260430152859, 20260511100550, 20260629080343, 20260728070225` (the first five are adjacent-pair artefacts of the matching rule; `20260728070225` has no repository file).

Runner routing: the Lovable migration tool contract states it creates a Drizzle Kit custom migration and applies it with Drizzle's migrator (Drizzle history). `drizzle.config.ts` targets `./drizzle/migrations` with URL from an environment variable (value not read). Exact executed command is not recoverable. Discovery risk: a Supabase-CLI style runner discovers `supabase/migrations/*` by version and would treat batch C (`20261002190000`) and the 40 unmatched versions as pending; Drizzle discovers only its journal and treats batch C as applied by hash.

Batch C current effect (all owner postgres, SECURITY DEFINER, volatile, `search_path=public`):

| Signature | md5(def) | anon | authenticated | service_role | Other direct EXECUTE |
|---|---|---|---|---|---|
| effects_catchup_send(uuid,uuid,bigint,uuid,integer) | ecea10b2619d45373bfcfc418b3eb2e8 | no | no | yes | postgres, sandbox_exec_* |
| effects_catchup_dispatch_one(uuid) | 6aabce3e46a3ccfbbf59752975420941 | no | no | yes | postgres, sandbox_exec_* |
| effects_catchup_reconcile(integer) | 867305d405699d8778373ae3aebef145 | no | no | yes | postgres, sandbox_exec_* |
| effects_catchup_credential_health() | b9fc05d8880731295045a40a1ff7f713 | no | no | yes | postgres, sandbox_exec_*, supabase_read_only_user |
| clear_stances(uuid) | b45bbfa41ab2e90d3ff4741bea0eefeb | no | no | yes | postgres, sandbox_exec_* |

PUBLIC holds none of the five. Retained nonbrowser paths: `authenticator` is a member of anon/authenticated/service_role (normal API path); `supabase_read_only_user` keeps EXECUTE on credential_health (not called). Default ACL: `postgres` in `public` grants EXECUTE on new functions to anon and authenticated, so any future function not explicitly revoked becomes browser-callable.

**Proposed repair (not performed):** metadata-only alignment of Supabase history for batch C (record `20261002190000` as applied without executing statements), using a separately authorized capability whose semantics are verified first; plus a decision for the 40 unmatched and ~230 drifted versions (attribute each source to its ledger version, or explicitly declare Supabase history non-replayable before any CLI-style runner is used). Preservation assertions: only the intended ledger row changes; Drizzle row, both SQL copies, journals, all function bodies/ACLs unchanged; no replay. No hand INSERT, no replacement migration.

`pause_resolution: remains_blocked` — Supabase history lacks batch C, 40 repository versions are not version-attributable, and the active tool still routes to Drizzle; no second-runner exclusion is proven.

## H1 — Installed progression inventory

All entries below: owner postgres, plpgsql (owns_character: sql), SECURITY DEFINER, volatile (owns_character: stable). md5 is of `pg_get_functiondef`.

| Signature | search_path | md5 | anon | authn | service | PUBLIC |
|---|---|---|---|---|---|---|
| character_create(text,text,text,text,integer×9,boolean) → characters | public, auth, pg_temp | f0eedb2eb01c777674c583c38fd752fa | no | yes | yes | no |
| join_order(uuid,text) | public | 797af2040a26d530407312512329c5af | yes | yes | yes | **yes** |
| switch_order(uuid,text) | public | 2f34b968b47189e05274cbedae5df143 | yes | yes | yes | **yes** |
| train_renown_stat(uuid,text) | public | fea13630dab98ed395d77d0f274dbe8e | **yes** | yes | yes | no |
| apply_crafting_xp(uuid,integer) | public | 7a859050787e77a60e5432ff01e5c869 | **yes** | yes | yes | **yes** |
| sync_character_resources(uuid) | public | 32778de54fe327dbe3bae024c5996548 | no | yes | yes | no |
| owns_character(uuid) | public | 87dbb4e1ee9b1506db68b832079c22c6 | no | yes | yes | no |
| award_party_member(uuid,integer,integer) | public | 7ac9b39dd33f4604a2b1ab543c6abab6 | no | no | yes | no |
| award_party_member(uuid,integer,integer,integer,integer) | public | 185ad916d13ce17008bed88b7750a7e4 | no | no | yes | no |
| restrict_party_leader_updates() trigger | public | fbea407cb0a41788b67552a85ba948e3 | no | no | yes | no |
| combat2_refuse_invalid_stance_class_change() trigger | public, pg_temp | a44f7cfa2d5f8c9ef223033e973de46e | yes | yes | yes | yes (trigger fn; not RPC-meaningful) |
| settle_out_of_combat_resources(timestamptz) | public, cron, pg_temp | f3cc54430d4b2db84144b95664cd9679 | no | no | yes | no |
| settle_out_of_combat_resources_without_character_stances(timestamptz) | public, cron, pg_temp | ea78472cc43a27da2d1252cb8ee8d08b | no | no | yes | no |
| node_tick_commit(uuid,uuid,integer,integer,bigint,uuid[],jsonb) | public, pg_temp | 7f7b93834678bcb186995b9b4bb041d4 | no | no | yes | no |
| node_tick_commit_without_character_stances(same) | public, pg_temp | c1fc7b45674a5186bf5e7cee0cfc582f | no | no | yes | no |
| node_tick_commit_without_authoritative_arrival(same) | public, pg_temp | 63dd5542276feddfb623620bd7b07e21 | no | no | yes | no |
| node_tick_commit_without_boss_timing(same) | public, pg_temp | 7505652f48fc052097c7632d62ce01e5 | no | no | yes | no |
| node_tick_commit_without_bounded_failure(same) | public | 8c029b931fa2f55eee791a9f320a7e74 | no | no | yes | no |
| node_tick_claim(uuid,integer) | public, pg_temp | 079dd03d3838ef70acc43a26d56311c2 | no | no | yes | no |
| node_tick_claim_without_character_stances / _without_boss_timing / _without_canary_gate (uuid,integer) | public[, pg_temp] | c9b69655… / 961ca790… / e15d6896… | no | no | yes | no |
| commit_encounter_tick_v2(uuid,bigint,uuid,uuid,integer,integer,jsonb,jsonb,jsonb) | public | 05f989f9b7a2f0668eaa69646a6f54e4 | no | no | yes | no |
| add_material(uuid,text,integer) | public | bc870fef4f56c9dc18bdfadaccfa37bc | no | no | yes | no |

No overloads beyond those listed. `combat_tick_commit` is not installed. `sandbox_exec_*` has EXECUTE on all (sandbox default ACL).

Recursive chains (static call-name resolution of installed bodies):

- node_tick_commit → _without_character_stances → _without_authoritative_arrival → _without_boss_timing → _without_bounded_failure (single linear chain).
- node_tick_claim → _without_character_stances → _without_boss_timing → _without_canary_gate; plus combat2_node_runtime_eligible.
- settle_out_of_combat_resources → _without_character_stances, combat2_regenerate_force_shields, combat2_dispatch_scheduler_fire/_fire_without_resource_settlement/_eligible/_disable, world_state_is_awake, combat_mode_is_open.
- join_order/switch_order/train_renown_stat → owns_character, sync_character_resources (switch_order also → join_order). apply_crafting_xp and award_party_member → add_material.

Progression writers found by installed body search:

- **Combat2 XP**: node_tick_commit_without_bounded_failure inserts `node_reward_claim` (unique creature_id, spawn_seq, character_id) and, with `app.trusted_rpc=true`, does `xp = xp + xp_awarded, gold = gold + …`. **It never advances level, points, respec, class growth or maxima.** No other installed function advances level for Combat2 XP.
- **Level-up**: only apply_crafting_xp (formula `floor(level²·50)`, class bonuses via CASE on class text, unspent/respec, hard-coded base HP CASE, max HP/CP/MP) and legacy commit_encounter_tick_v2.
- **award_party_member** (both overloads): xp += without level-up; service_role only.
- **train_renown_stat**: bhp/attribute path; anon-executable (owner check inside, via owns_character).
- **join_order**: class/is_classless.
- **sync_character_resources**: max_hp/max_cp/max_mp.
- **admin-users Edge source** `set-level` (and other actions) computes stats/points/maxima in TypeScript with a code-local `CLASS_LEVEL_BONUSES` and writes via service client; deployed revision not inspectable.
- Crafting callers: forge-craft-base, forge-apply-gem, stonebinder-fuse call `apply_crafting_xp` (stonebinder via service-role client). Deployed revisions not inspectable.

`characters` table:

- RLS on, FORCE off, replica identity default, in no publication.
- Table ACL: postgres, service_role full; authenticated SELECT; anon none. Column UPDATE for authenticated only on last_online, portrait_url, portrait_metadata, portrait_generated_at, wimp_hp_threshold, wimp_direction.
- Policies: UPDATE "Users can update safe own character fields" (authenticated, `auth.uid()=user_id`); SELECT "own or party" (public role).
- Constraints: level 1–100 (spec cap 42 not enforced), unspent 0–200, ac 0–50, hp ≥0, max_hp ≥1, gold ≥0; FK class→classes.class_key, race→races.race_key (ON UPDATE CASCADE). class/race are text; gender enum `character_gender`.
- Non-internal triggers (alphabetical firing within timing):
  - BEFORE UPDATE OF class: combat2_refuse_invalid_stance_class_change
  - BEFORE UPDATE OF current_node_id: combat2_guard_owned_location_write, combat2_guard_test_arena_location
  - BEFORE UPDATE: restrict_party_leader_character_updates, update_characters_updated_at
  - AFTER UPDATE OF current_node_id: combat2_authoritative_arrival, trg_characters_node_change_participation (WHEN node changed and old not null)
  - AFTER UPDATE OF current_node_id, hp: trg_characters_encounter_lifecycle
  - AFTER UPDATE OF hp, DEFERRABLE INITIALLY DEFERRED: trg_characters_release_stances_on_death
  - AFTER UPDATE OF reserved_buffs WHEN changed: trg_characters_sync_stance_effects
  - AFTER UPDATE OF last_online: characters_wake_world (**disabled**)
  - AFTER INSERT: trg_grant_starting_materials
- restrict_party_leader_updates: when `app.trusted_rpc` is not true and `auth.uid() = NEW.user_id`, reverts level/xp/class/is_classless/maxima and limits point/respec changes; trusted service calls set `app.trusted_rpc` rather than relying on SECURITY DEFINER.

Config snapshot (10:50:46 UTC): classes `level_bonuses`/base_hp/base_ac — assassin {cha,dex} 16/10; bard {cha,int} 16/9; classless {} 18/10; healer {con,wis} 18/9; ranger {dex,wis} 20/10; templar {con,wis} 22/12; warrior {dex,str} 24/12; wizard {int,wis} 16/9; all active. No config-revision column exists (only updated_at). Races dwarf, edain, elf, half_elf, halfling, human (str,dex,con,int,wis,cha modifiers recorded in the read). apply_crafting_xp hard-codes class bonuses/base HP instead of reading `classes`.

## Aggregate anomalies (counts only, no repair)

Query: the 001B handoff aggregate, plus bhp_trained shape and pool bounds.

| Check | Count |
|---|---|
| characters | 21 |
| invalid_levels / invalid_xp | 0 / 0 |
| cap_nonzero_xp (L42 with xp≠0) | 1 |
| xp_backlog | 0 |
| invalid_unspent / invalid_respec / invalid_renown_balance | 0 / 0 / 0 |
| class_flag_mismatch / obsolete_rogue_key | 0 / 0 |
| unspent_exceeds_level_earned_budget | 0 |
| bhp_trained non-object / bad keys / non-numeric / negative or fractional | 0 / 0 / 0 / 0 (20 entries) |
| hp > max_hp / cp out of range / mp out of range | 1 / 0 / 0 |
| level 42 | 2 |

Resource worksheet (equipment/gem recomputation), milestone receipt coverage and spent+unspent budgets: `not_provable_from_available_history` in this pass — no provenance/receipt tables exist and the equipment recomputation was not run; current maxima were not recomputed. AC persisted-vs-effective semantics remain uncontracted.

## Visibility limitations

Deployed Edge source/revisions (admin-users, forge-*, stonebinder-fuse, combat2-*) not inspectable; Vault, `net` and secret contents not read; dynamic SQL and external callers cannot be excluded by static body search; trigger-function bodies were hashed but not individually reviewed beyond restrict_party_leader_updates; repository/ledger content equivalence for drifted versions not re-hashed.

## Preservation statement

Reads only. Zero migrations, ledger changes, DDL, grants, gameplay/service RPC calls, deployments or publications. Failed reads: `supabase_migrations`, `drizzle`, `cron` via sandbox psql (permission denied; re-read via the authorized Cloud read tool). Migration pause not lifted.

## Recommendation for 001C

Blocked on H0 (`remains_blocked`). When unblocked, 001C should target: (1) Combat2 XP awards never advancing level — a single authoritative XP-transition writer matching the 001A reference, keyed by `node_reward_claim` identity; (2) revoke anon/PUBLIC EXECUTE on apply_crafting_xp, join_order, switch_order and anon on train_renown_stat, with explicit REVOKE in every new function given the postgres default ACL; (3) remove hard-coded class tables from apply_crafting_xp and admin-users in favour of `classes`; (4) decide whether to add a level ≤42 constraint and the cap_nonzero_xp/hp>max_hp review (counts only, no automatic normalization). No implementation SQL is prepared here.
