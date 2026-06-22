# Reduce Database Activity & Cost

## What the audit found

I queried `cron.job`, `pg_stat_statements`, and the realtime publication. The hot paths are:

### 1. Realtime WAL reader is the #1 CPU consumer
A single internal query (the Supabase Realtime WAL decoder) has run **9.9 million times for ~58,000 seconds total** — more than every other query on the server combined. It fires on every row change in any table in the `supabase_realtime` publication. Current published tables:

```
activity_log, areas, character_materials, characters, creatures,
loot_table_entries, loot_tables, marketplace_listings, node_ground_loot,
npcs, parties, party_combat_log, party_members, summon_requests,
weapon_progression_config, xp_boost
```

Several of these are very high-churn (`activity_log`, `characters`, `creatures`) and several are low-churn/admin-only (`areas`, `loot_tables`, `loot_table_entries`, `weapon_progression_config`, `npcs`). Every UPDATE/INSERT on any of them is decoded and broadcast.

### 2. Cron jobs currently active

| Job | Schedule | Calls | Total time |
|---|---|---|---|
| regen_creature_hp | every 1 min | 187,972 | 1,548 s |
| respawn_creatures | every 1 min | 187,972 | 1,459 s |
| return_unique_items | every 10 min | 18,797 | 1,278 s |
| process-email-queue | every 30 s | (recently lowered) | — |
| expire-marketplace-listings | every 5 min | 15,143 | 219 s |
| expire-king-slayer | every 5 min | — | — |

Each `regen_creature_hp` run does an UPDATE across all alive-damaged creatures → fans out through the realtime publication (since `creatures` is published), multiplying realtime WAL work too.

### 3. cron.job_run_details bloat
1.88M rows of cron run history are sitting in the metadata DB; Postgres updates each row 3× per run. Not huge per call but constant background writes.

### 4. character_visited_nodes
42,235 INSERTs since boot — the client re-inserts on every node arrival even when already visited.

---

## Proposed changes

### A. Trim the realtime publication (biggest win)
Remove low-churn / admin-only tables from `supabase_realtime`. The UI reads them on mount and they change rarely (admin edits) — a manual refetch is fine.

Drop from publication:
- `areas`, `loot_tables`, `loot_table_entries`, `weapon_progression_config`, `npcs`

Keep: `activity_log`, `characters`, `creatures`, `character_materials`, `marketplace_listings`, `node_ground_loot`, `parties`, `party_combat_log`, `party_members`, `summon_requests`, `xp_boost`.

Expected impact: noticeable drop in WAL decoder calls (the dominant cost line) with zero gameplay change.

### B. Slow down non-critical cron jobs
- `regen_creature_hp`: every 1 min → **every 2 min** (regen rate doubled to 10% so behavior is unchanged for players). Halves both the cron call count and the resulting WAL fan-out on `creatures`.
- `respawn_creatures`: every 1 min → **every 2 min**. Respawn timers are already in seconds and the function only flips creatures whose `died_at + respawn_seconds <= now()`, so worst-case respawn delay grows by ≤60s — imperceptible.
- `expire-marketplace-listings`: every 5 min → **every 15 min**. Listings expire on `expires_at`; the cron just flips status. Players don't notice a 10-min slip.
- `expire-king-slayer`: every 5 min → **every 15 min**. Same logic.
- `return_unique_items`: every 10 min → **every 30 min**. Window is already 90 min offline; 20-min slip is fine.
- `process-email-queue`: leave at the recently-lowered 30s.

### C. Prune cron run history
Add a daily cron job that deletes `cron.job_run_details` rows older than 3 days. Keeps recent debugging info, drops the long tail.

### D. Throttle `character_visited_nodes` writes
Use the existing client-side `visitedNodesCache` set: only POST the INSERT when the node id is *not* already in the cached set for the session. (The DB already has `ON CONFLICT DO NOTHING`; this just avoids the wasted round-trip / WAL row.)

### E. Optional follow-up (not in this pass)
- `activity_log` is the single biggest realtime broadcaster. Worth a future review of whether players need realtime for it (vs. polling on log-panel open). Skipping for now to keep this change small and reversible.

---

## Technical change list

1. **Migration**: `ALTER PUBLICATION supabase_realtime DROP TABLE public.areas, public.loot_tables, public.loot_table_entries, public.weapon_progression_config, public.npcs;`
2. **Migration**: `SELECT cron.alter_job(...)` for jobids 1, 2, 3, 5, 8 with new schedules; bump regen percentage in `regen_creature_hp` from 5% to 10%.
3. **Migration**: new cron job `prune-cron-history` daily at 03:00 UTC running `DELETE FROM cron.job_run_details WHERE end_time < now() - interval '3 days';`
4. **Code edit** `src/features/world/hooks/useMovementActions.ts` (or wherever the visited-node INSERT fires): consult `visitedNodesCache` before calling `supabase.from('character_visited_nodes').insert(...)`; add to cache on success.

## Expected outcome
- Realtime WAL processing should drop substantially (fewer published tables + half the creature update churn).
- Cron-driven DB time on creatures/marketplace/unique-items cut by ~50–66%.
- `cron.job_run_details` row growth bounded.
- No gameplay change visible to players.

Combined with the throttles already shipped (regen debounce + 30s email cron), this should let you stay on the current instance size longer or scale down sooner.
