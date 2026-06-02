## Goal

Eliminate horizontal tab bars in the admin shell (only the Manual's accordion remains). Reorganize so each tool has a clear home, and admin pages use **left column → main pane** layouts (the `AdminPageShell` pattern), not top tabs.

## Sidebar changes

`src/components/admin/AdminSidebar.tsx`

- **Content** group: `Creatures, NPCs, Items, Item Forge (restored), Loot Tables`
- **Operations** group: `Tools, Issues, Marketplace, Roadmap`
- Tools stays a single sidebar entry.

## Item Forge

- Restore `item-forge` as its own sidebar route → renders `ItemForgePanel` directly (as it did before).
- **Remove** the "Rewrite Stats (Squish v2)" and "Purge & Seed Catalog" action cards from `ItemForgePanel`. Extract them into a new component `src/components/admin/tools/ArchetypeMaintenancePanel.tsx` (two simple cards calling the same `rebuild-archetype-stats` / `seed-archetype-items` edge functions, identical confirm dialogs and toasts).
- Item Forge then only contains the AI generation / preview / save flow.

## Tools page — flatten to columns

Rewrite `src/components/admin/ToolsPanel.tsx` using `AdminPageShell`:

- **Left column (tool list):** Item Coverage Analyzer, Archetype Maintenance (Squish v2 + Purge & Seed), Unique Reclaim, Credit Drain. Selecting one renders it in the main pane.
- **No top tab bar.** State held locally (`useState`) for the active tool.
- Preserve `defaultTab` prop semantics via a `defaultTool` so deep links still work.

Tool list (final):
- Item Coverage Analyzer (`ItemCoverageAnalyzer`)
- Archetype Maintenance (`ArchetypeMaintenancePanel` — new, extracted)
- Unique Reclaim (`UniqueReclaimManager`)
- Credit Drain (`CreditDrainHistory`)

## Loot Tables — flatten to columns

Rewrite `src/components/admin/LootTableManager.tsx` using `AdminPageShell`:

- **Left column:** Pool Rules, Item Pool, Legacy Tables, Creature Modes.
- **Main pane:** the selected tab's existing component, unchanged.
- Remove the `Tabs`/`TabsList` chrome.

## Manual

No change — the three inline Overlord Tuning widgets (`WeaponProgressionTab`, `XpBoostPanel`, `PoolRulesTab`) stay embedded next to their explanatory text in `GameManual.tsx`. The Manual becomes the single home for tuning; Tools is purely operational.

## AdminPage route map

`src/pages/AdminPage.tsx`

- Add `item-forge` case → `<ItemForgePanel onDataChanged={…} />` (separate route again).
- `tools` case → `<ToolsPanel defaultTool={…} />` with the new tool keys (`item-coverage`, `archetype-maintenance`, `unique-reclaim`, `credit-drain`).
- Global search / deep-link entries that previously targeted `tools?tab=item-forge` should now route to the `item-forge` sidebar entry.

## Files touched

- `src/components/admin/AdminSidebar.tsx` — move Item Forge to Content.
- `src/components/admin/ItemForgePanel.tsx` — remove the two maintenance cards.
- `src/components/admin/tools/ArchetypeMaintenancePanel.tsx` — **new**, holds the extracted cards.
- `src/components/admin/ToolsPanel.tsx` — replace tabs with `AdminPageShell` + left list.
- `src/components/admin/LootTableManager.tsx` — replace tabs with `AdminPageShell` + left list.
- `src/pages/AdminPage.tsx` — route map updates.
- `src/components/admin/AdminGlobalSearch.tsx` — update any search entries pointing at the old tool keys (verify on implementation).

## Out of scope

- No backend / edge function changes.
- No changes to other admin pages that already use `AdminPageShell` (Users, Items, Creatures, etc.).
- No changes to the Manual's content or accordions.
