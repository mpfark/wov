
# Common & Uncommon Gear Rebuild — Archetype System

A foundational reset of the procedural item ecosystem. Common and uncommon items get hard-deleted and replaced by a deterministically generated catalog that uses a stable `[Tier Prefix] [Archetype] [Slot]` grammar. Uniques, boss items, soulforged, and admin items are untouched.

---

## 1. Shared archetype tables (single source of truth)

New module `src/shared/itemgen/archetypes.ts` (mirrored to `supabase/functions/_shared/itemgen/archetypes.ts` for Edge use). Contains:

- **TIER_PREFIXES** — band → prefix (capped at L42):
  - 1–5 Worn · 6–10 Sturdy · 11–15 Fine · 16–20 Engraved · 21–25 Runed · 26–30 High · 31–35 Mythic · 36–40 Ancient · 41–42 Astral
- **PRIMARY_ARCHETYPES** — STR Vanguard/Iron/Brutal/Warborn/Tyrant; DEX Shadow/Swift/Hunter/Ashen/Nightstalker; CON Warden/Stoneguard/Bulwark/Bastion/Stalwart/Earthshaper/Ironroot; INT Sage/Arcane/Runed/Astral/Spellwoven; WIS Devout/Sanctified/Templar/Enlightened/Dawnbringer; CHA Regal/Noble/Bardic/Silvertongue/Crowned/Majestic/Virtuoso.
- **HYBRID_ARCHETYPES** — STR+CON Warlord/Juggernaut/Fortress; STR+DEX Raider/Blademaster/Skirmisher; DEX+INT Spellblade/Hexrunner/Arcstrider; WIS+CON Guardian/Justicar/Oathbound; INT+WIS Mystic/Oracle/Seer; CHA+WIS Prophet/Hierophant/Luminary; CHA+DEX Troubadour/Duelist/Shadowcourt; CHA+STR Champion/Sovereign/Lionguard.
- **SLOT_NOUNS** — head Hood/Helm/Circlet · chest Robe/Vest/Armor/Plate · pants Leggings/Greaves · gloves Gloves/Gauntlets · boots Boots/Sabatons · off_hand Shield/Tome/Idol · weapons Sword/Axe/Mace/Dagger/Bow/Staff/Wand. Slot noun choice biased by stat (e.g. Hood for INT, Plate for STR/CON, Circlet for CHA).
- **WEAPON_TAG_BY_ARCHETYPE** — STR sword/axe/mace; DEX dagger/bow/sword; INT staff/wand; WIS mace/staff; CHA wand/sword; CON mace/shield. Hybrids merge.
- Helpers: `bandPrefix(level)`, `pickArchetype(primary, secondary?)`, `pickSlotNoun(slot, primary)`, `composeName(level, primary, secondary, slot, weaponTag)`.

## 2. Stat distribution rules (common vs uncommon)

Reuse `getItemStatBudget` (existing). Add `src/shared/itemgen/distribution.ts`:

- **Common**: 1 dominant stat ≈ 70% of budget, 1 minor stat for the remainder. Single archetype (no hybrid).
- **Uncommon**: dominant ≈ 55%, secondary ≈ 35%, optional tertiary (often `hp` or `ac`) for spillover. Hybrid archetype if secondary share ≥ 30%.
- Always respects `getItemStatCap`. Drops `cha`/`int` from melee/CON gear etc. via per-archetype allowed-stat lists.

## 3. Deterministic catalog generator

New Edge Function `seed-archetype-items` (admin-only, overlord-gated):

For each band 1–42 × each primary archetype × each major slot (head/chest/gloves/boots/pants/main_hand/off_hand) × {common, uncommon} → produce one item. For each band × each hybrid archetype × {weapon, chest, head} → produce one uncommon item. Estimated ~2,500 items total at full density (9 bands × 6 primaries × 7 slots × 2 rarities ≈ 756, plus hybrids ≈ 216, plus weapon variants per archetype).

Each item insert sets:
- `name` via `composeName`, level = mid of band, slot, weapon_tag, hands (2 for staff/bow/greatsword variant), `world_drop=true`, `drop_weight=10`, `is_soulbound=false`, `origin_type='archetype_seed'`, `origin_id=null`, generated description from a small template (`"A {prefix-lower} {archetype-lower} {slot-noun-lower} suited for the {stat} path."`), `value` via `suggestItemGoldValue`.
- Idempotent by `(name)` — safe to re-run.

Function returns counts; admin UI button surfaces it.

## 4. Hard purge of existing common/uncommon

Migration `purge_common_uncommon_items.sql`:

```sql
-- Identify target item ids
WITH targets AS (
  SELECT id FROM items
  WHERE rarity IN ('common','uncommon')
    AND (origin_type IS NULL OR origin_type IN ('archetype_seed','blacksmith_forge'))
)
-- Cascade clean references
DELETE FROM character_inventory WHERE item_id IN (SELECT id FROM targets);
DELETE FROM vendor_inventory    WHERE item_id IN (SELECT id FROM targets);
DELETE FROM marketplace_listings WHERE item_id IN (SELECT id FROM targets);
DELETE FROM node_ground_loot    WHERE item_id IN (SELECT id FROM targets);
DELETE FROM loot_table_entries  WHERE item_id IN (SELECT id FROM targets);
DELETE FROM class_starting_gear WHERE item_id IN (SELECT id FROM targets);
DELETE FROM universal_starting_gear WHERE item_id IN (SELECT id FROM targets);
DELETE FROM items               WHERE id IN (SELECT id FROM targets);
```

Not touched: any item with `rarity` in `unique`/`soulforged`, or `origin_type` `creature`/`node`. Player-owned uniques/soulforged are completely safe.

After purge, run `seed-archetype-items` to repopulate.

## 5. Starting gear backfill

Because `class_starting_gear` and `universal_starting_gear` will be wiped, the seed function ends with a small step that re-attaches:
- One band-1 common weapon per class (Vanguard Sword for warrior, Shadow Dagger for rogue, Sage Staff for wizard, Hunter Bow for ranger, Devout Mace for healer, Bardic Wand for bard, Templar Mace for templar).
- Universal: Worn Leather Vest (chest), Worn Boots, Worn Gloves.

## 6. Rewrite `ai-item-forge` for top-up

Replace its system prompt and post-processing to enforce the new grammar:
- Inject the archetype tables as context.
- Reject names that don't match `^(Worn|Sturdy|Fine|Engraved|Runed|High|Mythic|Ancient|Astral) [A-Z][a-z]+ [A-Z][a-z]+$` (case-insensitive on the inner words but Title-cased).
- Force stat distribution to match common/uncommon rules above (post-processing rebalances if AI drifts).
- Forge then becomes purely "supplement coverage" — admin picks band + archetype + slot + rarity and gets 1–10 items.

## 7. Admin UI changes

`src/components/admin/ItemForgePanel.tsx`:
- Add an **Archetype** select (primary stat) + optional secondary stat.
- Add a **Seed Catalog** button (overlord only) that calls `seed-archetype-items` with confirmation dialog ("This will delete all existing common/uncommon items and rebuild the catalog. Continue?"). After confirm: invoke purge migration … wait, migrations aren't run from the UI — instead, the seed function itself does the cascading delete via service role and then inserts. So one button = one call.
- Plain Forge mode keeps working but now produces archetype-named items.

## 8. Memory updates

Replace `mem://admin/ai-item-forge.md` and add `mem://game/item-archetypes.md` describing the grammar, archetype tables, and stat distribution rules so future generations stay aligned.

---

## Validation checklist after run

- `SELECT COUNT(*) FROM items WHERE rarity IN ('common','uncommon')` returns ~2.5k.
- For every band 1–42 (in 5-level steps) and every primary stat, at least one weapon and one armor item exists.
- Random sample of 20 names all match the grammar regex.
- A new character can be created (starting gear inserts succeed).
- Marketplace + vendor pages render (no broken item refs since cascade ran).

## Out of scope

Uniques, soulforged, boss/quest items, balance overhaul, AI-driven naming beyond the deterministic grammar.

## Files touched

- New: `src/shared/itemgen/archetypes.ts`, `src/shared/itemgen/distribution.ts`, mirror under `supabase/functions/_shared/itemgen/`.
- New: `supabase/functions/seed-archetype-items/index.ts`.
- Edited: `supabase/functions/ai-item-forge/index.ts` (prompt + post-processing).
- Edited: `src/components/admin/ItemForgePanel.tsx` (Seed button + archetype selectors).
- Memory: `mem://admin/ai-item-forge.md`, new `mem://game/item-archetypes.md`, index update.
