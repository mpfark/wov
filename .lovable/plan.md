# Treasure Map Quest Items

Quest items that show an auto-rendered mini-map of a region with an X on a target node. NPCs hand them out via dialogue, and the map removes itself once the player discovers the target node.

## Data model

**New item type: `map`**
- Reuses `items` table. `item_type = 'map'`, `rarity = 'quest'` (soulbound, not sellable, not equippable).
- New columns on `items`:
  - `map_target_node_id uuid` — the X location.
  - `map_region_id uuid` — region shown in the rendered map (defaults to the target node's region).
  - `map_flavor text` — short in-world description shown above the map ("Silra's directions to the Hall of Shadows").

**Inventory carries it like any other item** — no schema change to `character_inventory`.

## NPC hand-off

Extend `dialogue_topics` with a new action type `give_item`:

```text
{ type: 'give_item', item_id: '<map item uuid>', once_per_character: true }
```

- Admin authors a topic on any NPC, e.g. Silra Vane → "I need directions to the Hall of Shadows" → action gives the map item.
- `once_per_character: true` prevents stacking duplicates; checked against current inventory + a lightweight `character_npc_gifts(character_id, npc_id, item_id)` ledger so deleting the map doesn't let the player re-farm it.
- NPC dialog UI (`NPCDialogPanel.tsx`) renders a confirmation line in the existing immersive style: *"Silra presses a folded parchment into your hand."*

## Auto-render mini-map

New component `RegionMiniMap.tsx` (read-only, no interaction):
- Input: `regionId`, `highlightNodeId`.
- Reuses existing nodes/areas data from `useNodes` and the same SVG layout math as the world map.
- Strips player/creature/party overlays. Renders area outlines (via existing `area-colors` + `outline-geometry` utils), node dots, connection lines, and a glowing red **X** marker on the target node.
- Shows only **discovered** nodes plus the target X — undiscovered nodes appear as faint dots so the map feels like a hand-drawn guide, not a satellite view.

## Map viewer

New dialog `MapItemDialog.tsx`:
- Opens when the player clicks a map item in inventory (same click path as a consumable).
- Parchment-styled dialog: flavor text on top, `RegionMiniMap` filling the body, "Close" footer.
- No XP, no charges — purely informational.

## Auto-remove on discovery

- Hook into the existing "node discovered" path (`character_visited_nodes` insert) inside the visit RPC / handler.
- New RPC `consume_maps_for_node(_character_id, _node_id)`:
  - Deletes any inventory rows whose item is `item_type = 'map'` and `map_target_node_id = _node_id`.
  - Emits a short event log line: *"Your map crumbles — the path is known."*
- Called server-side right after a successful node visit, so it works whether the player walks, teleports, or summons there.

## Admin UI

- **Item editor** (`AdminPage` items section): when `item_type = 'map'` is selected, show node picker (region → node) for `map_target_node_id` and a flavor text field. Map items skip the stat editor.
- **NPC dialogue editor**: new action option `give_item` with item dropdown filtered to `item_type = 'map'` first, then all items; checkbox for `once_per_character`.

## Files touched

- DB migration: add `map_target_node_id`, `map_region_id`, `map_flavor` to `items`; create `character_npc_gifts` ledger + RPC `consume_maps_for_node`; extend dialogue topic types.
- New: `src/features/world/components/RegionMiniMap.tsx`, `src/features/inventory/components/MapItemDialog.tsx`.
- Edit: `src/features/inventory/hooks/useConsumableActions.ts` (route map clicks to the dialog), `useInventory.ts` (carry new fields), `NPCDialogPanel.tsx` (handle `give_item` action), node-visit handler (call `consume_maps_for_node`), admin item + NPC dialogue editors.

## Out of scope

- No multi-X maps, no map trading, no expiration timers, no fog-of-war beyond the existing discovery system.
