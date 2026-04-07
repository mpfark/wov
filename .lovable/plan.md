

# Update Admin Items Page

## Summary

Add soulforged color styling to item lists, add weapon tag filtering, remove "material" from item types, and delete the duplicate "Warg Pelt Shoulders" item (reassigning inventory references first).

## Changes

### 1. Soulforged Color & Weapon Tag Filter — `src/components/admin/ItemManager.tsx`

**Soulforged color**: Add `is_soulbound` to the `Item` interface and query. In the item list (line ~427), if `item.is_soulbound` is true, use `text-soulforged text-glow-soulforged` class instead of the rarity color.

**Weapon tag filter**: Add a `weaponTagTab` state (default `'all'`). Show a new filter row when `typeTab === 'equipment'` with buttons for `all` plus each value from `WEAPON_TAGS`. Filter the list by `weapon_tag` when not `'all'`.

**Remove material**: Change `ITEM_TYPES` from `['equipment', 'consumable', 'material', 'quest']` to `['equipment', 'consumable', 'quest']`.

### 2. Soulforged Color — `src/components/admin/loot/ItemPoolTab.tsx`

Add `is_soulbound` to the `PoolItem` interface and query. Use soulforged color class when `is_soulbound` is true, overriding rarity color.

### 3. Delete Duplicate "Warg Pelt Shoulders" — Database Data Operation

One duplicate pair:
- Keep: `98bc579b-3e56-47fe-a998-092e9b1d4153`
- Delete: `94380c92-c46e-43b5-ac0a-df6a938b4cba`

The duplicate has one inventory reference (character `4bd2d63f...`). Steps:
1. `UPDATE character_inventory SET item_id = '98bc579b-3e56-47fe-a998-092e9b1d4153' WHERE item_id = '94380c92-c46e-43b5-ac0a-df6a938b4cba'`
2. `DELETE FROM items WHERE id = '94380c92-c46e-43b5-ac0a-df6a938b4cba'`

## Files Modified

| File | Change |
|------|--------|
| `src/components/admin/ItemManager.tsx` | Soulforged color, weapon tag filter, remove "material" |
| `src/components/admin/loot/ItemPoolTab.tsx` | Soulforged color for soulbound items |
| Database (data operation) | Reassign inventory + delete 1 duplicate item |

