## Goal

Move per-page header toolbars (filters, search, "New", AI utilities, counts, section nav) into a **left-side tool column** placed between the admin sidebar and the page content. Layout becomes:

```text
┌───────────┬──────────────┬────────────────────────────────────────┐
│ Admin     │ Tool column  │ Page content                           │
│ sidebar   │ (filters,    │ (list / grid / editor / details)       │
│ (nav)     │  actions,    │                                        │
│           │  sections)   │                                        │
└───────────┴──────────────┴────────────────────────────────────────┘
```

For pages like Items / Creatures the content area itself keeps its inner two-pane layout: **list on the left, editor/new on the right**. So the full picture is `Sidebar | Tool | List | Editor`.

## Scope

In scope (presentation-only — no logic changes):
- New shared layout primitive: `AdminPageShell` rendering a left tool column + main content.
- Migrate header toolbars into the tool column on:
  - `ItemManager`, `CreatureManager`, `NPCManager`, `LootTableManager`
  - `MarketplaceManager`, `IssueReportManager`, `RaceClassManager`, `RoadmapManager`, `UniqueReclaimManager`
  - `ItemForgePanel` — normalize its existing left-side controls into the shell
  - World tab in `AdminPage.tsx` — region/area/multi-select/populate buttons → tool column
- Game Manual rewrite from cascading `Accordion` to **list nav (tool column) + content (main pane)**.

Out of scope:
- `UserManager` — already multi-column, leave as is.
- `AdminDashboard` — overview only, no header.
- `WorldBuilderPanel`, `WorldBuilderRulebook`, node/region/area editor overlays.
- Any backend, data shape, or business logic changes.

## Design

### `AdminPageShell` primitive

- File: `src/components/admin/common/AdminPageShell.tsx`
- Props: `title`, `icon`, `count?`, `tools` (left column ReactNode), `children` (main pane).
- Layout: `flex h-full min-h-0`.
  - Tool column: `w-[260px] shrink-0 border-r border-border bg-card/30 overflow-y-auto flex flex-col`.
  - Main pane: `flex-1 min-w-0 flex flex-col overflow-hidden`.
- Tool column header: parchment-styled (icon + title + count), matching current `AdminEntityToolbar` look.
- Helper `AdminToolSection({ title, children })` for grouped sections inside the tool column (consistent `space-y-2`, `text-[10px] uppercase` labels, padded).
- Both exported via `src/components/admin/common/index.ts`.

### Per-page migration rule

What moves into the tool column:
- Search input
- Filter chips/toggles that mutate the dataset (rarity, type, slot, status filters, "Unassigned" toggle, etc.)
- Counts and badges
- Page-level actions: "New", "Refresh", AI utilities (Rebalance Stats, Rename Legacy)

What stays in the main pane:
- The list itself and the editor/new panel (existing inner two-pane layout).
- Sub-pane navigation strictly tied to a list row (e.g. tabs inside the editor).

Decision rule used: filters that change *what's in the list* → tool column; UI tied to a *single selected row* → stays in editor pane.

### Game Manual rewrite

- Define `MANUAL_SECTIONS` registry: `{ id, label, icon, render }`.
- Extract each existing `AccordionItem` body into its own component under `src/components/admin/manual/sections/*.tsx` to keep `GameManual.tsx` small.
- `GameManual` state: `activeSectionId` (default first).
- Layout via `AdminPageShell`:
  - Tool column = vertical section list, active row highlighted (`bg-primary/10 text-primary border-l-2 border-primary`).
  - Main pane = `ScrollArea` rendering only the active section.
- Nested sub-accordions inside a section (stat combos, kills-to-level, creature examples, budget examples) stay as `Accordion` — they are content-level, not page-level navigation.

### World tab

- Wrap the map area in `AdminPageShell`.
- Tool column groups: **Region**, **Area**, **Selection Mode** (Multi-Select / Populate toggles), and a small stats line (`X regions · Y nodes · Z areas`).
- Map overlay editor panels (`NodeEditorPanel`, `RegionEditorPanel`, `AreaEditorPanel`, `BatchNodeEditPanel`, `PopulatePanel`) remain as right-side overlays on the map — they are contextual, not page-level tools.

## Files to add

- `src/components/admin/common/AdminPageShell.tsx`
- `src/components/admin/common/AdminToolSection.tsx`
- `src/components/admin/manual/manualSections.ts`
- `src/components/admin/manual/sections/*.tsx` (one per existing accordion section, ~20 files)

## Files to edit

- `src/components/admin/common/index.ts` — re-export shell + section.
- `src/components/admin/GameManual.tsx`
- `src/components/admin/ItemManager.tsx`
- `src/components/admin/CreatureManager.tsx`
- `src/components/admin/NPCManager.tsx`
- `src/components/admin/LootTableManager.tsx`
- `src/components/admin/MarketplaceManager.tsx`
- `src/components/admin/IssueReportManager.tsx`
- `src/components/admin/RaceClassManager.tsx`
- `src/components/admin/RoadmapManager.tsx`
- `src/components/admin/UniqueReclaimManager.tsx`
- `src/components/admin/ItemForgePanel.tsx`
- `src/pages/AdminPage.tsx` — wrap World case with the shell.

## Validation

- Build clean (TypeScript happy).
- Visit each migrated tab in preview at 1165px wide, confirm: filters/search work, "New" creates, counts update, no layout overflow with `Sidebar | Tool (260) | List | Editor`.
- Manual: clicking each section in the tool column shows correct content; default selection renders.
- World: region/area/multi-select/populate all functional from tool column; map editor overlays still appear on click.

## Notes / open questions

- Tool column default width: **260px**. At 1165px viewport with admin sidebar collapsed to icons, this leaves ~850px for `List + Editor` — tight on Items/Creatures. Easy to drop to 220–240px or make the column collapsible if needed; happy to adjust during implementation.
- The existing `AdminEntityToolbar` becomes redundant once pages migrate; will leave it in place until all callers are converted, then remove.
