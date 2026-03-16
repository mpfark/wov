

## World Map Rebuild — Towns, Roads & Scale

### Overview
Purge all existing nodes, areas, and regions (preserving The Soulwright NPC). Rebuild using only **towns/villages as named nodes** connected by **road nodes** (unnamed waypoints). Scale: Hearthvale → Havenport = ~20 nodes.

### Phase 1: Purge (same FK-safe order as before)
```sql
DELETE FROM node_ground_loot;
DELETE FROM character_inventory;
DELETE FROM vendor_inventory;
DELETE FROM loot_table_entries;
DELETE FROM universal_starting_gear;
DELETE FROM class_starting_gear;
DELETE FROM creatures;
UPDATE npcs SET node_id = NULL WHERE id = 'bcbb3e17-9696-4ebc-965d-a4c8e253c963';
DELETE FROM character_visited_nodes;
DELETE FROM party_combat_log;
DELETE FROM party_members;
DELETE FROM parties;
UPDATE characters SET current_node_id = NULL;
DELETE FROM nodes;
DELETE FROM areas;
DELETE FROM loot_tables;
DELETE FROM items;
DELETE FROM regions;
```

### Phase 2: Create Regions (same 11)

| Region | Lvl | Map Position |
|---|---|---|
| The Hearthlands | 1-5 | Center |
| The Glimmering Coast | 6-10 | West |
| The Weeping Fens | 11-15 | Southwest |
| The Sun-Scorched Wastes | 16-20 | South |
| Eldritch Rest | 16-20 | East |
| Kharak-Dum | 21-25 | North |
| The Great Steppe | 21-25 | Southeast |
| The Mourn-Woods | 26-30 | Far East |
| The Iron Crags | 31-35 | Northeast |
| The Frostpeaks | 36-40 | North |
| The Frozen Reach | 41-50 | Northwest |

### Phase 3: Create Town/Village Nodes + Road Nodes

Based on the map, named settlement nodes with road waypoints between them. Using Hearthvale→Havenport (~20 nodes) as the distance scale:

**Named Settlements (from map):**
1. **Hearthvale** (Hearthlands) — HUB, inn, vendor, blacksmith, teleport
2. **The Broken Wheel Inn** (Glimmering Coast) — Lvl 7 road stop, inn
3. **Oakhaven Village** (Glimmering Coast) — Lvl 6, vendor
4. **Havenport** (Glimmering Coast) — Lvl 6-10 city, inn, vendor, blacksmith, teleport
5. **Aethel-by-the-Sea** (Weeping Fens) — Lvl 8 fishing hamlet, inn, vendor
6. **Icewatch** (Kharak-Dum) — Lvl 23 fortified village, inn, vendor, blacksmith
7. **Kharak-Dum** (Kharak-Dum) — Lvl 21-25 city, inn, vendor, blacksmith, teleport
8. **Eldritch Rest** (Eldritch Rest) — Lvl 16-20 settlement, inn, vendor, blacksmith, teleport
9. **Dusthaven** (Sun-Scorched Wastes) — town, inn, vendor, blacksmith, teleport

**Named Landmarks (non-town, but named on map):**
- Miller's Crossing, The Cleft, The Shepherd's Gate, Caves, Silvershale River crossings, The King's Trace, Rubble Pass, Remnants of Osgil-Gard, Forest Trail, The West-Way waypoints

**Road segments (unnamed nodes between towns):**

```text
Hearthvale ──(~2 road nodes)── Miller's Crossing ──(~13 road nodes)── Eldritch Rest
     │                                    │
     │ (~5 road)                    (~8 road via Forest Trail)
     │                                    │
  The Cleft ──(~3)── Shepherd's Gate   Remnants of Osgil-Gard
     │                    │
  (~5 road)          (~5 road)
     │                    │
  Broken Wheel Inn    Icewatch ──(~5)── Kharak-Dum
     │                                      │
  (~4 road via Oakhaven)              (~8 road)── Frostpeaks/Iron Crags
     │
  Havenport ──(~8 road S)── Aethel-by-the-Sea

Hearthvale ──(~5 road S via Silvershale)── Weeping Fens ──(~8)── Sun-Scorched Wastes
                                                                      │
                                                               (~8)── Great Steppe

Eldritch Rest ──(~8 E)── Mourn-Woods ──(~8 N)── Iron Crags
Kharak-Dum ──(~8 NW)── Frostpeaks ──(~8 W)── Frozen Reach
Havenport ──(~10 NW)── Frozen Reach
```

**Estimated total: ~150-170 nodes** (15 named settlements/landmarks + ~140 road waypoints)

Road nodes will be unnamed (empty `name`), inheriting direction labels in-game. Each road node connects to exactly 2 neighbors (linear paths) unless at a fork.

### Phase 4: Post-setup
- Reassign Soulwright NPC to new Kharak-Dum node (e.g., "The Soulwright's Forge" sub-node)
- Teleport all characters to Hearthvale
- Update whisper text if node name changes

### Phase 5: No areas initially
Skip area creation entirely — just regions and nodes. Areas can be added later via admin tools to group nodes thematically.

### Files Changed
- Database operations only (purge + insert regions, nodes, update NPC, update characters)
- `src/hooks/useActions.ts` — update Soulwright whisper text only if location name changes
- Copy new map image to `public/images/Edhelard_WorldMap.png` (replacing old jpg)

