# ENG-PROGRESSION-001D — Read-only activation-gate feasibility evidence

Scope: Mik's directly supplied task prompt, points 1–9 (option 2). The local
Codex handoff `progression-001D-validation-handoff.md` is intentionally absent.
Nothing was mutated, invoked, created, deployed or published.

## 1. Identity

- Source inspected: `97c004152f175ae48486a85c0891cccb8f7426c0` (HEAD = origin/main, clean worktree; no 001D prep files present, as expected).
- UTC window: 2026-10-05 14:17:26 – ~14:30.
- Principal: `sandbox_exec` (managed restricted read role), PostgreSQL 17.6. Cannot read `auth`, `cron`, or the 001C sidecar tables.
- Hash algorithm: SHA-256 of `pg_get_functiondef(oid)` (UTF-8); MD5 also captured.

## 2–3. Combat2 reward chain (installed)

Call chain, outermost first (all postgres-owned, SECURITY DEFINER, EXECUTE only postgres, service_role, sandbox_exec):

1. `node_tick_commit` — locks `character_stance` rows from `stance_fence` FOR UPDATE (returns `stale_stance` envelope), calls 2; on `committed` applies stance updates (RAISE `stale stance update` with **no** handler → whole transaction aborts), deletes cleared stances, marks stance requests committed.
2. `node_tick_commit_without_character_stances` — `pg_advisory_xact_lock` per node (encounter node + move destinations, sorted). No handler.
3. `node_tick_commit_without_authoritative_arrival` — boss cooldown fence (envelope), calls 4, inserts cooldowns on success. **EXCEPTION WHEN OTHERS → `internal_failure`/P0001.**
4. `node_tick_commit_without_boss_timing` — calls 5, shape guard. **EXCEPTION WHEN OTHERS → `internal_failure` with SQLSTATE.**
5. `node_tick_commit_without_bounded_failure` — the writer.

Order inside 5:
1. `node_encounter` FOR UPDATE; envelopes: `stale_claim`, `already_committed`, `stale_snapshot`, Test Arena `test_rewards_forbidden`.
2. Validation-only envelopes (foreign_reference incl. `rewards` creature/spawn identity and `reward_death` for dead-creature/negative amounts; loot fence; stale_equipment; departure fences with FOR UPDATE on departure requests).
3. Characters FOR UPDATE `ORDER BY ch.id` (reward + equipment_fence characters), then inventory FOR UPDATE by id.
4. Mutations: character hp/cp/mp (clamped to current maxima) → creatures → effects → participation upsert → **rewards loop**: `INSERT node_reward_claim … ON CONFLICT (creature_id,spawn_seq,character_id) DO NOTHING`; `IF FOUND` → set `app.trusted_rpc` and `xp = xp + xp_awarded, gold = gold + gold_awarded` → loot (`node_death_loot` ON CONFLICT DO NOTHING, ground loot when dropped) → durability (RAISE on fence miss) → tick batch → pending events consumed → intents consumed → departures (RAISE 40001 on fence miss) → encounter tick/version advance, claim cleared.

Facts:
- Qualification and amounts are worker-proposed (`_proposed.rewards`), resolved from claim-frozen inputs (`reward_config`, `participation`/`qualification`, `xp_boost`, `loot_items`, `loot_table_entries`, `loot_mode`, `drop_chance`); the commit validates identity and non-negativity only.
- `node_reward_claim.id` defaults to `gen_random_uuid()` but is **not captured** (no `RETURNING`); a receipt key requires changing that insert.
- No level/max/point write exists anywhere in the chain; XP is a bare integer add.
- Lock order is **stance rows → node advisory locks → encounter → departure requests → characters → inventory**. The stance-row lock precedes the encounter lock (differs from the documented encounter→character rule).

Atomicity of a progression call inserted right after the `IF FOUND` XP/gold update: a RAISE there unwinds to layer 4's handler (subtransaction), rolling back the reward claim, XP/gold, loot, durability, batch, intents, departures and encounter advance; layers 3 and 1 then skip their success steps. **Atomic: yes.** Consequences: the caller sees `internal_failure` (not an exception), the outer transaction commits only lock acquisition, and the claim is not released — the encounter retries after lease expiry and would fail repeatedly if the failure is deterministic (liveness risk, not integrity).

`commit_encounter_tick_v2` and both `award_party_member` overloads: service_role/postgres/sandbox_exec only; legacy level writers, not composed by the Combat2 chain.

## 4. Crafting

- `apply_crafting_xp(uuid,integer)`: EXECUTE for **PUBLIC, anon, authenticated**, service_role. No `auth.uid()`/ownership check, no upper bound on `p_xp`. Locks the character, adds XP, levels up to 42, awards points, recomputes max HP/CP/MP with hard-coded formulas, refills HP on level-up. **A live, browser-reachable independent XP→level writer for any character.**
- Callers: Edge `forge-craft-base`, `forge-apply-gem`, `stonebinder-fuse`. In all three, gold/material/item mutations are separate requests that complete first; XP is a later best-effort RPC whose error is only logged. No atomicity with crafting.
- `stonebinder_commit_fuse`: anon+authenticated EXECUTE, no XP. `forge_soulring`: PUBLIC/anon/authenticated, no XP.
- Deployed Edge revision identifiers: not visible to this principal (unknown).

## 5. Other competitors

| Path | State |
|---|---|
| admin-users `grant-xp`, `set-level`, `update-character`, `grant-respec` (+ respec) | Callable by steward/overlord via Edge (service client) |
| `character_create` | authenticated + service_role; owner-scoped insert |
| `join_order` / `switch_order` | PUBLIC/anon/authenticated; auth check inside; writes class + class bond, not level/XP |
| `train_renown_stat` | anon/authenticated; auth check; spends BHP, +1 stat (permanent stat delta outside 001C) |
| `commit_encounter_tick_v2`, `award_party_member` ×2 | service-only, uncomposed |
| Owner character UPDATE | RLS "safe own fields"; trigger reverts level/xp |

## 6. Installed 001C integrity

All five functions: postgres owner, SECURITY DEFINER, `search_path=pg_catalog, public`, ACL `{postgres=X}` only; each body is verbatim in `docs/operations/progression-001C-authority.sql`. SHA-256: snapshot `0e69185a…3ad7`, class_config `9e42fe97…cc89`, sync_derived `92b66301…a4f6`, apply_xp `206ba01f…c3a`, permanent_delta `c05faa81…284d`. The three sidecar tables: RLS on, 0 policies, ACL postgres only. No other public function references them, no trigger uses them, no source caller outside tests. Row counts: **not readable** (permission denied) — emptiness unestablished.

## 7. Synthetic fixture — UNSAFE / UNKNOWN

- `characters.user_id` NOT NULL → `auth.users` (ON DELETE CASCADE); the fixture needs an auth identity. The `auth` schema is unreadable; `handle_new_user` (inserts profile + `player` role) exists but its trigger attachment cannot be verified.
- Required with no default: user_id, name (globally UNIQUE), race (FK), class (FK to classes; no rogue row).
- INSERT trigger `grant_starting_materials` adds 7 material rows. UPDATE triggers: arrival, location guards, stance class guard, party-leader restrict, encounter lifecycle, node-change participation, stance release on death, stance effect sync, updated_at; wake-world disabled. No DELETE triggers.
- Visibility: stewards/overlords can read all characters (admin listings would show it); `characters` is not in the realtime publication. NULL `current_node_id` keeps it out of node-scoped Combat2 scans; global scans by admin/MCP tools are not excluded.
- No supported tool can create an auth user + character as a committed fixture within the allowed boundary.

## 8. Two retained sessions — NOT SUPPORTED

The sandbox can start several `psql` processes, but as `sandbox_exec`: no write/row-lock privilege, no EXECUTE on the postgres-only authority. The migration tool runs one transaction; run_sql and read_query are single stateless requests. No supported operator mechanism gives two retained **owner-level** sessions with BEGIN/locks/timeouts/barriers. No session was opened to test this.

## 9. Cleanup — NOT FEASIBLE with current tooling

Deleting a character cascades to 38 tables and sets NULL in 9 (incl. `node_ground_loot.dropped_by`, `parties`, `node_pending_event`, `issue_reports`); auth-user deletion cascades to characters. Order-safe deletion of allowlisted IDs is possible in principle, but needs owner write and auth access, and zero-residue verification of the sidecar tables isn't readable by any available principal.

## 10. Verdicts

- Blockers: (a) no owner-level two-session mechanism; (b) no safe fixture/auth path; (c) sidecar residue unverifiable; (d) `apply_crafting_xp` is a public, unbounded, ownerless XP→level writer that competes with 001C.
- Atomic Combat2 integration: **feasible**, with the insert changed to `RETURNING id` and progression run only when `FOUND`. Accepted risks: retry loop on deterministic failure; stance-before-encounter lock order.
- 001D readiness for an executable hosted concurrency harness: **NOT READY** — needs a platform-supported owner-level dual-session mechanism (or a Mik-approved alternative gate) first.
