## Goal

Strip retired systems out of the admin surface, the backend, and the docs.

## 1. Item Forge (removed entirely)

- `AdminSidebar.tsx`: drop the `item-forge` nav entry (and the now-unused `Hammer` import).
- `AdminPage.tsx`: drop the `item-forge` case and the `ItemForgePanel` import.
- Delete `src/components/admin/ItemForgePanel.tsx`.
- Delete edge function `supabase/functions/ai-item-forge/` + its `config.toml` entry, and un-deploy it.

## 2. Catalog Tools in Items

- `ItemManager.tsx`: remove the "Catalog Tools" `AdminToolSection` (Rename Legacy + Rebalance Stats), the `handleRenameLegacy` / `handleRebalanceStats` handlers, their state, and now-unused imports.
- Delete edge functions `ai-item-rename` and `ai-item-rebalance` (files, config entries, un-deploy).

## 3. Archetype Maintenance

- `ToolsPanel.tsx`: remove the `archetype-maintenance` tool entry, its case, and the import.
- Delete `src/components/admin/tools/ArchetypeMaintenancePanel.tsx`.
- Delete edge functions `seed-archetype-items` and `rebuild-archetype-stats` (files, config entries, un-deploy).

## 4. Starting gear (full purge)

- `RaceClassManager.tsx`: remove the "Starter Gear" tab entirely, and the "Starting Weapon" block from each class card, plus all related state/handlers (`startingGear`, `universalGear`, `weapons`, set/clear handlers) and their queries.
- `ItemManager.tsx`: remove `class_starting_gear` from the "item in use" reference check.
- `CharacterCreation.tsx`: remove the `grant_starting_gear` RPC call — new characters spawn with nothing and craft their first gear.
- Migration: `DROP FUNCTION public.grant_starting_gear`, `DROP TABLE public.class_starting_gear`, `DROP TABLE public.universal_starting_gear` (cascade on policies). Existing characters keep whatever they already own.

## 5. Docs audit

- `WorldBuilderRulebook.tsx`: delete the "Item Forge" section; change the checklist line to "Items — created via the Item Manager, or crafted in-game by players."
- `GameManual.tsx`: verify and correct anything that assumes forged/seeded archetype catalogs or starting gear. Specifically re-check the item-naming / archetype grammar block (still valid for existing catalog names, but it must no longer point at removed admin tools), and confirm the "plain bases + gems" gear section is the single source of truth for how players get gear. Add a short "new characters start with no equipment" note to the progression section.
- Update the project memory files that describe removed systems: `mem://admin/ai-item-forge` (delete) and the item-archetype/equipment memories (drop references to the forge and starter gear).

## 6. Verification

- `bun run test` and `bun run build` must pass.
- Grep for any remaining `item-forge`, `starting_gear`, `archetype-maintenance`, `ai-item-rename`, `ai-item-rebalance` references.
- Load the admin page in the preview and confirm Items, Tools, and Races & Classes render without the removed sections.

## Note

Existing common/uncommon items in the database are untouched — only the tooling that regenerated them is removed. If you later want a fresh catalog rebuild you'd need a new tool.
