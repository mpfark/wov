## Goal

Replace the 711-row archetype catalog with a clean, tiered pool of **plain base items** that players socket gems into. Both common and uncommon are plain bases — the only difference is that uncommon gives a larger stat budget. Uncommons are drop-only. Existing characters' gear is wiped (already refunded).

## Tiers

| Tier | Unlock level | Prefix    | Weapon damage |
|------|--------------|-----------|---------------|
| 1    | L1           | Worn      | base die      |
| 2    | L10          | Sturdy    | +1 die step   |
| 3    | L20          | Engraved  | +2 die steps  |
| 4    | L30          | Runed     | +3 die steps  |
| 5    | L40          | Ancient   | +4 die steps  |

Stat budget = `getItemStatBudget(tier_unlock_level, rarity, hands)`. Uncommon naturally gets the existing 1.5× rarity multiplier (plus the +1 hybrid bonus at L30+), so a "Runed Fine Helm" (uncommon T4) has noticeably more sockets-worth of budget than "Runed Helm" (common T4). Per-attribute caps (`getItemStatCap`) are untouched.

Weapon damage tier step uses the existing damage-tier helper in `_shared/formulas/combat.ts`. Each crafted/dropped weapon snapshots its `weapon_die` at craft time.

## Naming grammar

`[Tier Prefix] [Fine?] [Slot Type Noun]` — no archetype words, no stat-type words.

- Common: `Worn Helm`, `Sturdy Circlet`, `Engraved Cap`, `Runed Iron Sword`, `Ancient Oak Staff`.
- Uncommon: inserts `Fine` — `Worn Fine Helm`, `Runed Fine Circlet`, `Ancient Fine Iron Sword`.

The 3 variants per non-weapon slot are **type flavors only** (mechanically identical at the same tier+rarity):
- head: Helm / Circlet / Cap
- chest: Plate / Vest / Robe
- pants: Greaves / Leggings / Trousers
- gloves: Gauntlets / Gloves / Wraps
- ring: Band / Ring / Loop
- trinket: Charm / Idol / Talisman
- off_hand: Shield / Tome / Buckler

Weapons keep their existing types (dagger / sword / axe / mace / bow / staff / wand) and don't take a slot-variant axis.

Total ≈ (7 non-weapon slots × 3 variants + 7 weapons) × 5 tiers × 2 rarities ≈ **280 plain bases**, replacing 711 statted archetype seeds.

## Drops

Both commons and uncommons drop from any creature flagged for the standard world loot pool. The drop pipeline picks a tier matching the creature's level band and rolls common vs uncommon by the existing rarity-roll weights. The dropped item is a plain base — the player sockets it themselves at the smith. No `stat_override` is generated on drop.

## Salvage gear → gems (partial refund)

New `forge-salvage` edge function, accessible from the Enhance tab next to Strip:

- Refund = **60 %** of applied gems (rounded down), returned as the matching primary gems.
- Also refunds ~25 % of original craft salvage and gold (level-scaled approximation).
- Item is destroyed. Soulbound / soulforged / unique / quest / consumables are not salvageable.
- Uncommon drops with no applied gems return only the salvage/gold component.

## Database changes

1. `DELETE FROM items WHERE origin_type = 'archetype_seed'` (711 rows).
2. `DROP TABLE public.forge_pool` (dead after rework).
3. Cancel + delete marketplace listings referencing deleted items.
4. `DELETE FROM character_inventory ci USING items i WHERE ci.item_id = i.id AND i.rarity IN ('common','uncommon') AND i.origin_type = 'archetype_seed'` — wipes legacy gear; keeps unique / soulforged / quest / consumables / already-crafted plain bases.
5. `ALTER TABLE items ADD COLUMN tier smallint, ADD COLUMN weapon_die text`.
6. Seed the ~280 new plain bases (`origin_type = 'plain_base'`). Uncommons reuse `origin_type = 'plain_base'` with `rarity = 'uncommon'` — they're still empty bases.
7. Re-point `loot_pool_config` / `loot_table_entries` rows at the new bases by (slot, tier, rarity); drop any orphan rows.
8. Run `sync_character_resources` for every affected character to recompute HP/CP/MP after gear wipe.

## Code changes

- **`forge-craft-base`**: only crafts `rarity='common'` plain bases. Filters by player tier (max tier where `unlock_level ≤ character.level`). Crafted instance carries `crafted_level = tier_unlock_level`.
- **Drop pipeline** (`combat-tick` + `kill-resolver`): pick `plain_base` of the creature's tier; roll common vs uncommon via existing rarity weights; drop with no `stat_override`.
- **New `forge-salvage`** edge function (above).
- **`useForgeUpgradeView.tsx`**: split into Forge helpers (slot → variant list at player's current tier) and Enhance helpers (gem pouch + apply/strip/salvage).
- **`BlacksmithPanel.tsx` / `JewelcrafterPanel.tsx`**:
  - **Forge tab** — left: slot picker. Right: explainer text **plus** click-to-craft variant cards for the player's tier. Gem pouch removed from this tab.
  - **Enhance tab** — gem pouch shown here. Item list left, socket UI right, Strip + new Salvage buttons.
- **`items.ts` formulas** (both mirrors): add `getTierForLevel(level)`, `getTierUnlockLevel(tier)`, `getTierPrefix(tier)`, `getWeaponDieForTier(tier, weaponType)`.
- **Delete legacy edge functions + admin UI buttons** that called them: `ai-item-forge`, `ai-item-rename`, `ai-item-rebalance`, `seed-archetype-items`, `rebuild-archetype-stats`. The item forge admin page itself is also removed — players craft their own gear now.

## Suggestions

1. **Tier preview in the Forge tab** — small line showing "Next tier unlocks at L10 / L20 / L30 / L40".
2. **`Fine` uncommon visual marker** — faint green frame on uncommon plain bases so players immediately recognize "this dropped, can't be crafted, more budget."
3. **Salvage-on-upgrade prompt** — when crafting a higher-tier base of the same slot, offer a one-click "salvage old, refund gems."
4. **`crafted_at` audit column** on `character_inventory` for future economy debugging.

## Out of scope

Unique, soulforged, quest, consumables, stonebinder, marketplace rules, combat math, gem catalog.

## Risks

- Marketplace listings of deleted items need the cancellation sweep before the delete.
- Any character with deleted equipped gear silently loses derived HP/CP/MP — mitigated by the post-wipe `sync_character_resources` loop.
- Loot config rows referencing deleted item IDs must be re-pointed or removed in the same migration to avoid broken drops.
