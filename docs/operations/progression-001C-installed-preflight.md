# ENG-PROGRESSION-001C — Narrow installed dependency preflight (evidence)

Read-only hosted catalog inspection. No function/RPC invoked, no DDL/DML, no
grants, no role or flag changes, no migration tooling, no deployment or
publication. H0 remains closed. 001C implementation and 001D not started.

- Source SHA inspected: `4f766ccbc61c494ccc6b65370d25e621452bb0e2` (HEAD = origin/main, clean worktree).
- Observation window: 2026-10-04 22:54:17 – 22:55:06 UTC.
- Principal: `supabase_read_only_user` via the Cloud read-only query tool (PostgreSQL 17.6).
- Hash algorithm: SHA-256 of `pg_get_functiondef(oid)` as UTF-8.
- No player rows were read. Class configuration rows are non-personal.

## A — Character schema

All listed `characters` columns are NOT NULL; none generated or identity.

| column | type | default |
|---|---|---|
| id | uuid | gen_random_uuid() (PK) |
| user_id | uuid | – (FK auth.users ON DELETE CASCADE) |
| str, dex, con, int, wis, cha | integer | 10 |
| level | integer | 1 |
| xp | integer | 0 |
| class | text | – (FK classes.class_key, no cascade) |
| is_classless | boolean | false |
| race | text | – (FK races.race_key ON UPDATE CASCADE) |
| unspent_stat_points | integer | 0 |
| respec_points | integer | 0 |
| bhp | integer | 0 |
| bhp_trained | jsonb | '{}' |
| rp_total_earned | integer | 0 |
| hp / max_hp | integer | 20 / 20 |
| cp / max_cp | integer | 100 / 100 |
| mp / max_mp | integer | 100 / 100 |
| ac | integer | 10 |
| reserved_buffs | jsonb | '{}' |
| stance_state | jsonb | '{}' |
| updated_at | timestamptz | now() |

Checks: `level 1..100`, `unspent_stat_points 0..200`, `hp >= 0`, `max_hp >= 1`,
`ac 0..50`, `gold >= 0`. No check on xp, stats, cp/mp, max_cp/max_mp,
respec_points, bhp, rp_total_earned. Unique: `name`. Deferred constraint
trigger `trg_characters_release_stances_on_death`.

Representability: int4 covers all canonical 001A transitions; the L42 cap is
not enforced by the schema (allows to 100) and must be enforced by the
authority. `unspent_stat_points <= 200` bounds pool size (L42 grants at most
41 discretionary points, so not binding for 001A).

Resource inputs: `character_inventory` (character_id uuid NN FK CASCADE,
item_id uuid NN FK CASCADE, equipped_slot item_slot NULL, current_durability
int NN default 100, applied_gems jsonb NN default '{}', stat_override jsonb
NULL). `items.stats` jsonb NN default '{}'. No other columns are read.

## B — Resource dependency

### owns_character(uuid) — sha fd28f97cb22bb6bd6f2fafd26175c82fce075c7e58db7e6db6cf9575f97742a7
boolean, owner postgres, STABLE, SECURITY DEFINER, search_path=public, single overload.
```sql
SELECT EXISTS (SELECT 1 FROM public.characters WHERE id = _character_id AND user_id = auth.uid())
```
### sync_character_resources(uuid) — sha d6a9e46898577ac32b593b2fc5b8f7b097224a55b7b936225e3433dedb9ef45a
jsonb, owner postgres, VOLATILE, SECURITY DEFINER, search_path=public, single overload.

EXECUTE (both functions): ACL `postgres, authenticated, service_role, sandbox_exec_<ref>`;
effective PUBLIC no, anon no, authenticated yes, service_role yes.

Installed body is textually identical to the function in
`supabase/migrations/20260922100000_int_wis_max_cp_and_combat2_regen.sql`
(no semantic differences). Body summary:

- Authorization: `owns_character` → requires `auth.uid()` = owner. Service role,
  postgres or any non-browser caller gets `Not authorized`. Not reusable by a
  private authority.
- Base HP: hard-coded CASE (warrior 24, wizard 16, ranger 20, rogue 16,
  assassin 16, healer 18, bard 16, templar 22, else 18); `classes.base_hp` not read.
  Installed `classes.base_hp` values match the CASE for every active class
  (classless 18 = ELSE).
- Equipment: equipped (slot not null) and durability > 0 rows; base =
  `COALESCE(NULLIF(stat_override,'{}'), items.stats, '{}')` — empty-object
  override falls back to item stats; NULL also falls back.
- Gems: emerald→con, sapphire→int, pearl→wis, topaz→dex; no str/cha gem read.
- Stats read: hp, con, int, wis, dex only (str/cha unused).
- Formulas: con_mod = floor((con+b-10)/2) (may be negative); int/wis/dex mods
  floored at 0. max_hp = clamp(base_hp + 2·con_mod + 5(level-1) + bonus_hp, 1, 10000);
  max_cp = clamp(30 + 3(level-1) + 3(int_mod+wis_mod), 0, 5000);
  max_mp = clamp(100 + 10·dex_mod + 2(level-1), 0, 5000).
- Current pools: clamped into [0, new max]; never refilled.
- Sets `app.trusted_rpc='true'` (transaction-local) then UPDATEs only
  max_hp/max_cp/max_mp/hp/cp/mp. Flag persists for the rest of the transaction.
- AC: neither read nor written.

## C — Character UPDATE triggers

| trigger | timing/events | WHEN | enabled | function |
|---|---|---|---|---|
| restrict_party_leader_character_updates | BEFORE UPDATE (all) | – | O | restrict_party_leader_updates() |
| update_characters_updated_at | BEFORE UPDATE | – | O | update_updated_at() |
| combat2_refuse_invalid_stance_class_change | BEFORE UPDATE OF class | – | O | combat2_refuse_invalid_stance_class_change() |
| combat2_guard_owned_location_write / combat2_guard_test_arena_location | BEFORE UPDATE OF current_node_id | – | O | (location only) |
| trg_characters_encounter_lifecycle | AFTER UPDATE OF current_node_id, hp | – | O | trg_character_encounter_lifecycle() |
| trg_characters_release_stances_on_death | AFTER UPDATE OF hp, constraint, DEFERRABLE INITIALLY DEFERRED | – | O | release_stances_on_death() |
| trg_characters_sync_stance_effects | AFTER UPDATE OF reserved_buffs | new≠old | O | sync_stance_effects() |
| combat2_authoritative_arrival, trg_characters_node_change_participation | AFTER UPDATE OF current_node_id | – | O | (location only) |
| characters_wake_world | AFTER UPDATE OF last_online | – | D (disabled) | trg_wake_world_on_activity() |
| trg_grant_starting_materials | AFTER INSERT | – | O | (insert only) |

BEFORE triggers fire alphabetically: combat2_* → restrict_party_leader_character_updates → update_characters_updated_at.

Function hashes: restrict_party_leader_updates 02c3aaa505f08fb4f9e92ffcf16ba41cb9e3ae79e51aaabdf4fde4f0876f465d;
update_updated_at 1931a612ca99ce9a94524256eec333d53356eb92dfa66dbb6bfa568e28aa2c53 (INVOKER, sets updated_at=now());
trg_character_encounter_lifecycle b865b8742afae4fc8ebaafafe7a749bdc6e011c5f9352a4e9bb4221b426527db (DEFINER; deletes encounter_participants on node change or alive→dead);
release_stances_on_death 7d37bf67bac4b2650d134dfc8fe9753b4fbbf8760706f75f31e91bdef5e4ad8d (DEFINER; if hp<=0 and reserved_buffs non-empty, clears reserved_buffs and force_shield keys in stance_state);
sync_stance_effects acaca80b166face5517a0cb603cc5151d5f626751d9e3337f84c04f19332b1c3 (INVOKER; deletes stance-lifetime active_effects not in reserved_buffs);
combat2_refuse_invalid_stance_class_change 98745bca6cbb73743ef7c22dc7c8484024b904d9357e7d97a7b1af86275f76c1 (DEFINER; refuses class change while character_stance rows exist).

`restrict_party_leader_updates` (DEFINER, search_path=public) — entire body is
inside `IF auth.uid() = NEW.user_id`. Outside a matching browser JWT
(service_role, postgres, scheduler, any DEFINER chain without the owner's
`request.jwt.claims`) it is a no-op. Within an owner context:
- always reverts level, xp, user_id; latches soulforged_item_created; caps bhp,
  rp_total_earned, respec_points to non-increase;
- six-stat increase must equal unspent_stat_points decrease unless respec_points
  decreases; unspent_stat_points may not increase (both ignore `app.trusted_rpc`);
- without `app.trusted_rpc='true'`: reverts race/class/is_classless,
  soulring fields, king_slayer_at, gold increase, max_hp/max_cp/max_mp/ac,
  reserved_buffs/stance_state, bhp_trained, family fields, contracts; clamps
  hp/cp/mp to OLD maxima;
- unconditionally clamps ac 1..100, max_hp 1..10000, max_cp 0..5000 (max_mp not clamped).

`app.trusted_rpc` therefore bypasses only the non-trusted block above; it never
permits level/xp change or point minting under an owner JWT. No trigger writes
level, xp, stats or progression pools, and none calls apply_crafting_xp or
commit_encounter_tick_v2.

## D — Class configuration

`classes`: class_key text NN PK (check `^[a-z][a-z0-9_]{1,31}$`); level_bonuses
jsonb NN default '{}'; base_hp int NN default 18; base_ac int NN default 10;
status text NN default 'draft' (check draft/active/retired); updated_at
timestamptz NN default now(). No revision/version column. No check on
level_bonuses shape.

| class_key | status | base_hp | base_ac | level_bonuses | updated_at |
|---|---|---|---|---|---|
| assassin | active | 16 | 10 | {cha:1, dex:1} | 2026-08-03 22:40:08.775147+00 |
| bard | active | 16 | 9 | {cha:1, int:1} | 2026-08-03 22:40:08.775147+00 |
| classless | active | 18 | 10 | {} | 2026-07-31 13:48:50.272589+00 |
| healer | active | 18 | 9 | {con:1, wis:1} | 2026-08-03 22:40:08.775147+00 |
| ranger | active | 20 | 10 | {dex:1, wis:1} | 2026-08-03 22:40:08.775147+00 |
| templar | active | 22 | 12 | {con:1, wis:1} | 2026-08-03 22:40:08.775147+00 |
| warrior | active | 24 | 12 | {dex:1, str:1} | 2026-08-03 22:40:08.775147+00 |
| wizard | active | 16 | 9 | {int:1, wis:1} | 2026-08-03 22:40:08.775147+00 |

Shape: flat object of stat-key → integer. All present keys are among the six
canonical stats; no nulls; unknown keys and null values are not prevented by
the schema, so the authority must refuse them (`invalid_class_config`). Seven
classes share one `updated_at`, so it cannot serve as a unique revision. No
`rogue` row exists although the resource CASE names it.

## E — Private-authority feasibility

- No `private` schema exists. `public`: USAGE for PUBLIC, anon, authenticated,
  service_role; CREATE only for pg_database_owner.
- Default privileges `postgres/public/f`: EXECUTE to postgres, anon,
  authenticated, service_role, sandbox_exec_<ref>; `supabase_admin/public/f` also
  grants anon/authenticated. Tables `postgres/public/r`: full privileges to anon
  and authenticated. Any future function or table migration must explicitly
  `REVOKE ALL ... FROM PUBLIC, anon, authenticated` (and enable RLS for tables).
- postgres is a member of anon, authenticated, service_role, authenticator,
  pg_read_all_data, supabase_privileged_role; authenticator is a member of
  anon/authenticated/service_role.
- Name collisions: none for `progression_*`, `progression_apply_xp_internal`,
  `progression_apply_permanent_delta_internal`, `character_sync_derived_internal`,
  or any relation matching `*receipt*`.
- A dormant owner-only authority (postgres-owned SECURITY DEFINER, explicit
  revokes, service_role-only or no grants) is installable without browser
  access, provided every object revokes the default grants. Creating a new
  `private` schema would itself be DDL requiring authorization.

### Receipt identity
`node_reward_claim`: id uuid PK default gen_random_uuid(); unique
`(creature_id uuid, spawn_seq integer, character_id uuid)`; encounter_id and
node_creature_id nullable uuid; character_id FK CASCADE. `id` is a stable uuid
suitable as `rewardClaimId`.

## Answers to the design questions

1. Yes, if the authority runs without a matching owner JWT (service_role or
   postgres/DEFINER chain invoked server-side): `restrict_party_leader_updates`
   is then a no-op. If ever called under the owner's JWT it would silently revert
   level/xp — the authority must refuse or not be browser-reachable. Side
   effects on hp UPDATE: encounter-participant deletion on alive→dead and
   deferred stance release when hp<=0; neither triggers on level/xp/stat writes,
   and none reproduces old progression authority. Class changes are refused
   while stances exist. updated_at changes on every UPDATE.
2. No. `sync_character_resources` requires `auth.uid()` ownership, sets
   transaction-wide `app.trusted_rpc`, and clamps (never refills) pools.
3. Mirror exactly: equipped & durability>0 rows; `COALESCE(NULLIF(stat_override,'{}'),items.stats,'{}')`;
   gem map emerald/sapphire/pearl/topaz → con/int/wis/dex; the max_hp/max_cp/max_mp
   formulas and caps above; base HP from the hard-coded CASE (or from
   `classes.base_hp`, currently identical for all rows).
4. Yes, decisions needed: (a) level-up HP/CP/MP refill vs clamp-only (installed
   behavior is clamp-only); (b) base HP source — hard-coded CASE vs
   `classes.base_hp` (values agree today; `rogue` has no class row); (c) AC is
   persisted but not derived by the resource function and not part of 001A —
   whether the authority touches it; (d) class config revision mechanism (none
   exists). Empty `stat_override` behavior is unambiguous (falls back to item stats).
5. Yes: sidecar tables avoid any characters column change; no existing column
   would need rewriting; lazy initialization from current values is
   representable. Requires new DDL with explicit revokes.
6. Yes: uuid identifiers plus a UNIQUE constraint on (source, identity) in a
   receipt table, inserted under `SELECT ... FOR UPDATE` on the character row,
   supports transactional replay/conflict. `node_reward_claim.id` is uuid.

## Remaining blockers / decisions
Gameplay decisions 4(a)–(d) for Mik. Authorization of new DDL (sidecar tables,
functions, any new schema) with explicit default-privilege revokes.

## Limitations
Function bodies are as returned by `pg_get_functiondef`; no secrets present.
Edge function callers and dynamic SQL were not re-inspected.
