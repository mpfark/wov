---
name: stonebinder
description: Stonebinder service fuses two different primary Ioun Stones into the matching Vibrating Ioun Stone via a stat-identity recipe map.
type: feature
---
World service at any node where `nodes.is_stonebinder = true` (seeded on Hearthvale Square only).

## Items
21 pre-seeded items in `items` (no procedural generation):
- 6 primaries (L42, unique trinket): `Ioun Stone of Iron|Shadows|Roots|Stars|Tides|Echoes` → STR/DEX/CON/INT/WIS/CHA + filler hp/hp_regen.
- 15 vibrating (L47, unique trinket): every unordered pair of two different primaries, named `Vibrating Ioun Stone of X and Y`.

All are unique, NOT soulbound, world-tradeable.

## Recipe identity (server + client agree)
A primary Ioun Stone is detected by SHAPE, not name alone:
- `rarity=unique`, `slot=trinket`, `item_type=equipment`
- name matches `^Ioun Stone of ` and NOT `^Vibrating ` (secondary check)
- after dropping `hp` and `hp_regen` from `stats`, exactly ONE key remains and it's one of `str|dex|con|int|wis|cha`

Recipe map built once per call: `pairKey(sorted [statA, statB]) → vibratingItemId`, by inspecting all `Vibrating Ioun Stone of %` items for the two primary stat keys in their stats.

## Edge function `stonebinder-fuse`
(Name retained for back-compat.) Modes `preview` and `fuse`. Body: `{ character_id, stone_a_inv_id, stone_b_inv_id }`.

Validation:
- Caller owns character; both inventory rows belong to character.
- Both rows pass primary-stone identity check.
- Both unequipped (`equipped_slot IS NULL`).
- Different identity stats (no Iron+Iron).
- Target vibrating stone exists nowhere else: `character_inventory.item_id`, `marketplace_listings` (status='active'), `node_ground_loot` — else `"That vibrating stone already exists in the world."`

Fusion:
1. Resolve vibrating item via stat-pair recipe map.
2. Delete both `character_inventory` rows (guarded by `equipped_slot IS NULL`).
3. Insert one new row: `current_durability = vibrating.max_durability ?? 100`, unequipped.
4. `log_activity` with deterministic ritual line: `⚜ The Stonebinder binds {A} and {B} into {Vibrating}.`

## UI
`StonebinderPanel` on `ServicePanelShell`. Two-column. Left lists unequipped primary Ioun Stones (filtered by the same identity rule). Click cycles A → B → replace B. Right shows server preview via `ItemTooltipCard` plus destructive "originals consumed" line. Footer button `Bind Stones`.

No gold/salvage/gem cost. Sacrifice IS the cost.

## Out of scope (v1)
No recursive vibration, no same-stat fusion, no soulbinding, no extra costs, no random rolls, no new item generation, no multiple seeded Stonebinder nodes (admin can flip more later).
