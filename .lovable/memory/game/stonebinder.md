---
name: stonebinder
description: Stonebinder service fuses two different primary Turning Stones into the matching Ascended Turning Stone via a stat-identity recipe map.
type: feature
---
World service at any node where `nodes.is_stonebinder = true` (seeded on Hearthvale Square only).

## Items
21 pre-seeded items in `items` (no procedural generation):
- 6 primaries (L42, unique trinket): `Turning Stone of Iron|Shadows|Roots|Stars|Tides|Echoes` → STR/DEX/CON/INT/WIS/CHA + filler hp/hp_regen.
- 15 ascendeds (L47, unique trinket): every unordered pair of two different primaries.

All are unique, NOT soulbound, world-tradeable.

## Recipe identity (server + client agree)
A primary Turning Stone is detected by SHAPE, not name alone:
- `rarity=unique`, `slot=trinket`, `item_type=equipment`
- name matches `^Turning Stone of ` and NOT `^Ascended` (secondary check)
- after dropping `hp` and `hp_regen` from `stats`, exactly ONE key remains and it's one of `str|dex|con|int|wis|cha`

Recipe map built once per call: `pairKey(sorted [statA, statB]) → ascendedItemId`, by inspecting all `Ascended Turning Stone of %` items for the two primary stat keys in their stats.

## Edge function `stonebinder-fuse`
Modes `preview` and `fuse`. Body: `{ character_id, stone_a_inv_id, stone_b_inv_id }`.

Validation:
- Caller owns character; both inventory rows belong to character.
- Both rows pass primary-stone identity check.
- Both unequipped (`equipped_slot IS NULL`).
- Different identity stats (no Iron+Iron).
- Target ascended exists nowhere else: `character_inventory.item_id`, `marketplace_listings` (status='active'), `node_ground_loot` — else `"That ascended stone already exists in the world."`

Fusion:
1. Resolve ascended via stat-pair recipe map.
2. Delete both `character_inventory` rows (guarded by `equipped_slot IS NULL`).
3. Insert one new row: `current_durability = ascended.max_durability ?? 100`, unequipped.
4. `log_activity` with deterministic ritual line: `⚜ The Stonebinder binds {A} and {B} into {Ascended}.`

## UI
`StonebinderPanel` on `ServicePanelShell`. Two-column. Left lists unequipped primary Turning Stones (filtered by the same identity rule). Click cycles A → B → replace B. Right shows server preview via `ItemTooltipCard` plus destructive "originals consumed" line. Footer button `Bind Stones`.

No gold/salvage/gem cost. Sacrifice IS the cost.

## Out of scope (v1)
No recursive ascension, no same-stat fusion, no soulbinding, no extra costs, no random rolls, no new item generation, no multiple seeded Stonebinder nodes (admin can flip more later).
