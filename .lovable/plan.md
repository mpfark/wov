## Goal

Produce a read-only Markdown reference pack describing the current world of Wayfarers of Varneth, so another AI can design new bosses, areas, nodes, creatures, and unique rewards that fit the existing systems — and return implementation-ready markup.

No game, database, migration, or code changes. Output goes to `/mnt/documents/world-export/` and is delivered as downloadable files.

## What the data currently looks like (verified by query)

- 9 regions, 58 areas, 762 nodes
- 376 creatures: 16 bosses, 53 rares, 307 regular
- 42 unique/soulforged items
- 37 NPCs
- 4 nodes with hidden connections, 3 nodes with locked (item-gated) connections, 2 nodes with searchable items
- 2 creatures with no node (orphaned), 1 map item pointing at a target node

## Files to generate

**1. `00-README-and-conventions.md`**
How to read the pack, the confirmed / inferred / inactive / conflicting labelling convention, the hard world rules (stationary creatures, one boss per dedicated node, hidden paths via search, item-locked paths, no roaming), and the handoff contract for the proposed-content file the other AI will write back.

**2. `01-world-structure.md`**
Region → area → node hierarchy with real UUIDs and short IDs. Per region: level band, direction, sort order, area list with `area_type`, level range, creature types. Node index in compact tables (id, name, area, x/y, service flags). Connection graph: direction-labelled edges, plus dedicated sections for hidden connections, locked connections with the exact required `lock_key` item, and dead-end / single-path nodes (prime boss-node candidates).

**3. `02-creatures-and-bosses.md`**
- Full boss dossier for all 16: node + area placement, level, HP/AC/stats, aggression, `boss_cast` config (cast key, ability name, cast ticks, `base_amount`, `primary_share`, `aoe_share`, stored-power cap), crit flavors, death cry, loot mode and loot table, respawn.
- Rare/elite roster grouped by area with level and drop config.
- Regular creature roster summarised per area (level band, counts, humanoid vs not) rather than 307 individual dumps, with a full appendix table of id/name/level/node for reference.
- Coverage matrix: creature and boss density per level band and region — the gap-finding tool.

**4. `03-items-and-rewards.md`**
All 42 unique/soulforged items: name, level, slot, hands, rarity, stats, procs, weapon tag/die, soulbound flag, world-drop flag, and where they drop (loot table → creature → node) or that they are unobtainable. Slot × level-band coverage matrix. Key/quest items and which connection they unlock. Map items and their target nodes. Notes on the gem/soulforge/tier crafting economy so proposals don't collide with crafted gear.

**5. `04-progression-quests-and-services.md`**
NPC roster with node, service role and dialogue topics; class halls; teleport nodes (public vs private); service nodes (vendor/inn/blacksmith/jewelcrafter/stonebinder/soulforge/marketplace/heraldry/trainer). Level-gated progression milestones, the Assassin contract system, class bond, and the level 40/42 milestone items — the constraints new content must slot between.

**6. `05-implementation-reference.md`**
Field-by-field schema notes for `regions`, `areas`, `nodes` (including the `connections` and `searchable_items` JSON shapes), `creatures` (including the exact `boss_cast` JSON shape and stored-power semantics), `items`, `loot_tables`/`loot_table_entries`, `npcs`. Formula owners (`src/shared/formulas/*` and the Deno mirror), the 2000ms tick rate and tick-based cast durations, creature stat/AC generation formulas, item stat budget and caps, crit multipliers. Admin-tool references (CreatureManager, node editor, NPCManager) and the exact template the proposed-content file should follow so Lovable can implement it mechanically.

**7. `06-gaps-and-inactive-content.md`**
Confirmed gaps and loose ends only, no speculation: the 2 orphaned creatures, areas with no nodes, nodes with no creatures/services, unique items with no drop source, level bands with no boss, regions with thin content, disconnected or one-way connections, and any bosses missing cast configuration. Each entry tagged as inactive / incomplete / conflicting / missing-data.

## Method

Read-only SQL against the live database for all content facts; source-file reads for formulas, JSON shapes and admin-tool field names. Anything not directly readable is either omitted or explicitly marked as inferred. UUIDs are preserved verbatim everywhere so the return file can reference existing rows reliably.
