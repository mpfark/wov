## Diagnosis

You're right — this is fallout from the gear rework.

**What's happening on Calikon (max_cp 255 / max_mp 228 on server, ~315 / ~278 on client):**

- After the gem-socket rework, almost every equipped item has `items.stats = {}` (a plain base). All real stats live in `character_inventory.applied_gems` (and sometimes `stat_override`).
- **Client** computes `equipmentBonuses` via `effectiveItemStats(...)`, which correctly merges `stat_override ?? base + applied_gems → attrs`. So the UI shows the gem-boosted max.
- **Server** RPC `public.sync_character_resources()` aggregates only `i.stats` from the `items` table. It reads `0` for every gemmed piece, so the persisted `max_cp` / `max_mp` are too low.
- Net effect: client optimistic regen ticks fill toward the higher client-computed cap (315 CP, 278 MP), then the next realtime echo from the server snaps the bar back down to the real persisted cap (255 / 228, ~60 CP and ~30 MP gap).

The same bug under-counts `max_hp` for anyone whose CON comes from gems.

## Fix

Rewrite `public.sync_character_resources(p_character_id uuid)` so its equipment aggregation mirrors `effectiveItemStats`:

For each equipped row with `current_durability > 0`:

1. **Base stats** = `COALESCE(NULLIF(ci.stat_override, '{}'::jsonb), i.stats, '{}'::jsonb)` — use `stat_override` only when it has keys, otherwise fall back to `items.stats`.
2. **Add applied_gems → attribute totals** using the canonical map:
   - `garnet→str, topaz→dex, emerald→con, sapphire→int, pearl→wis, amethyst→cha`
3. Sum across all equipped rows into `_bonus_hp, _bonus_con, _bonus_wis, _bonus_dex` (HP comes from base stats only; gems never grant flat HP).

Rest of the function (HP/CP/MP cap formulas, clamps, trusted-rpc UPDATE) stays identical — only the aggregation block changes.

After deploy, run `sync_character_resources` once per character so persisted `max_hp/max_cp/max_mp` are corrected immediately (otherwise it self-heals on the next gear change).

## Why this is the right scope

- Pure server-side correction; no client logic changes needed because the client was already correct.
- Removes the jumpy bar without disabling realtime echoes or weakening the server-as-authority rule.
- Mirrors the existing TS canonical helper, so future gem/override paths stay consistent.

## Out of scope

- No change to `effectiveItemStats`, `equipmentBonuses`, or any client hook.
- No change to `combat-tick` (it already reads `applied_gems` via `effectiveItemStats` in shared formulas).
- No schema changes.

## Files touched

- New migration: redefine `public.sync_character_resources` with the gem/override-aware aggregation.
- One-shot SQL after deploy: `SELECT public.sync_character_resources(id) FROM public.characters;` to backfill persisted maxima.
