## Goals

1. **Trim the Game Manual** to mechanics-only prose. Keep one heavy table: the Level Progression grid (XP per level + live player count per level). Drop simulated cross-product tables (every race×class HP/AC/CP combo, full creature stat samples per level, item budget grids, etc.).
2. **Surface existing tunable dials inside the Manual**, gated to Overlord. Each formula section gets an inline "🛠️ Tune" panel that edits the underlying config row.
3. **Move Weapon Dice tuning out of Loot Tables** and into the Manual's Combat / Weapons section.

## Manual content trim — section-by-section

Keep:
- **Level Progression** — full per-level XP grid + player counts (unchanged).
- **Character Stats** — attribute effects prose, race modifier table, class modifier table. Drop the giant race×class synergy combo table.
- **HP, AC & Regen** — formulas and class base table. Drop per-level simulated HP curves.
- **CP / Stamina / Combat / XP & Rewards / Creature Scaling / Items & Economy / Weapon Tags / Milestones / Chat / Renown / Economy / Death** — keep prose + formulas + small reference tables (rarities, weapon tag list, class affinities). Drop:
  - Per-level creature HP/damage simulation tables
  - Per-rarity item stat budget grids
  - Per-level XP reward simulations
  - Any "sample output for L1/L5/L10…" preview tables

Rule of thumb: if a table is computed by looping a formula across levels/rarities just to show what it produces, cut it. Keep it if it shows authored data (race table, class table, weapon tags, milestones).

## Overlord-only tuning panels (inline in Manual)

Use the existing `useRole().isValar` flag. Each panel only renders for Overlords; Stewards see read-only formula text.

Surfaces these existing DB-backed dials:

| Manual section | Tuning panel | Backing table |
|---|---|---|
| Combat → Weapons | Weapon Die Progression (t1/t2/t3 thresholds + preview) | `weapon_progression_config` |
| Items & Economy | Loot Pool Rules (equip/consumable level offsets, common/uncommon split, consumable drop chance) | `loot_pool_config` |
| XP & Rewards | XP Boost (multiplier + expiry) | `xp_boost` |

Each panel is a small inline card with: short formula recap → editable inputs → Save / Reset. No new tables, no formula refactor — just expose what the DB already drives.

## Move Weapon Dice tuning

- Delete the **⚔️ Weapon Dice** tab from `LootTableManager` (`src/components/admin/LootTableManager.tsx`).
- Reuse the `WeaponProgressionTab` body as the tuning panel inside the Manual's Combat → Weapons subsection (Overlord-only).
- File can stay where it is, or move to `src/components/admin/manual/tuning/WeaponProgressionPanel.tsx`. Keeping the file path simple: leave under `loot/` and import from the manual to minimize churn. (Open to moving it if you prefer.)

## Files touched

- `src/components/admin/GameManual.tsx` — strip simulated tables; add Overlord-only tuning cards under Combat / Items / XP sections.
- `src/components/admin/LootTableManager.tsx` — remove Weapon Dice tab + trigger.
- `src/components/admin/loot/WeaponProgressionTab.tsx` — keep as-is, imported by GameManual instead of LootTableManager.
- New small panels for `loot_pool_config` and `xp_boost` inline in GameManual (or extracted as tiny components if they grow).
- `src/hooks/useRole.ts` already exposes `isValar` — used to gate panels.

## Out of scope

- No changes to formula TS constants or edge functions.
- No new generic "formula override" system — only the three configs that already live in the DB.
- No content changes to the actual mechanics; only what's *displayed* and where it's *edited*.
