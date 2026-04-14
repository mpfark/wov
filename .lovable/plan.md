

# Admin UI Refinement — Sidebar Navigation

## Current State

The admin interface is a single `AdminPage.tsx` (476 lines) with a horizontal tab bar containing 13 tabs: World, Creatures, NPCs, Items, Loot Tables, Item Forge, Races & Classes, Users, Issues, Roadmap, Rulebook, Manual. The XP Boost panel sits above all tabs. All editor components are already self-contained.

## Approach

Replace the horizontal tab bar with a collapsible sidebar using the existing shadcn Sidebar component. The `AdminPage` stays as the main orchestrator — its state management, data loading, and editor overlay logic remain untouched. We simply swap the navigation mechanism from `<Tabs>` to sidebar + content area.

## Navigation Hierarchy

```text
SIDEBAR
─────────────────────
🏠 Dashboard (new)
─────────────────────
WORLD
  🗺️ World Map
─────────────────────
CONTENT
  🐾 Creatures
  👤 NPCs
  ⚔️ Items
  🎲 Loot Tables
  🔨 Item Forge
─────────────────────
PLAYERS
  👥 Users
─────────────────────
SYSTEMS
  🧬 Races & Classes
  ⚡ XP Boost
─────────────────────
OPERATIONS
  🐛 Issues
  🗺️ Roadmap
─────────────────────
REFERENCE
  📖 Rulebook
  📘 Manual
```

## New Files

| File | Purpose |
|------|---------|
| `src/components/admin/AdminSidebar.tsx` | Sidebar component with grouped navigation items |
| `src/components/admin/AdminLayout.tsx` | Layout wrapper: SidebarProvider + Sidebar + content area |
| `src/components/admin/AdminDashboard.tsx` | Simple landing page with quick-links and summary counts |
| `src/components/admin/AdminGlobalSearch.tsx` | Command palette (Cmd+K) for searching creatures, items, nodes, users |

## Changes to Existing Files

### `src/pages/AdminPage.tsx`
- Remove the `<Tabs>` / `<TabsList>` / `<TabsTrigger>` horizontal bar
- Wrap content in `<AdminLayout>` which provides the sidebar
- Keep `activeTab` state — the sidebar sets it via callback, content area renders the matching component (same conditional rendering as today)
- Move `XpBoostPanel` from above tabs into the "Systems > XP Boost" section as its own view
- All overlay panels (NodeEditorPanel, RegionEditorPanel, AreaEditorPanel, PopulatePanel, BatchNodeEditPanel) stay exactly as they are — they render inside the World content area

### `src/pages/AdminRoute.tsx`
- No changes — auth/role gating stays identical

## Component Details

### AdminSidebar
- Uses `Sidebar` with `collapsible="icon"` so it shrinks to icons on collapse
- Groups: World, Content, Players, Systems, Operations, Reference
- Each item calls `onNavigate(tabKey)` — maps to existing tab keys
- Highlights active item based on current `activeTab`
- Header shows role badge (Overlord/Steward) and Back button

### AdminLayout
- `SidebarProvider` wrapping `AdminSidebar` + main content div
- Header bar with `SidebarTrigger`, page title, and global search trigger
- Content area renders `children`

### AdminDashboard
- Fetches summary counts (regions, nodes, creatures, items, users) from existing data
- Quick-link cards that navigate to each section
- No new data fetching — reuses counts passed as props

### AdminGlobalSearch
- Uses existing `CommandDialog` component from `src/components/ui/command.tsx`
- Searches creatures, items, nodes, users via Supabase `.ilike()` queries
- On select, sets the active tab and opens the relevant editor
- Triggered by Cmd+K or a search icon in the header

## Tab-to-Navigation Mapping

| Current Tab | New Location | Component Reused |
|-------------|-------------|-----------------|
| world | World > World Map | AdminWorldMapView + overlays |
| creatures | Content > Creatures | CreatureManager |
| npcs | Content > NPCs | NPCManager |
| items | Content > Items | ItemManager |
| loot-tables | Content > Loot Tables | LootTableManager |
| item-forge | Content > Item Forge | ItemForgePanel |
| races-classes | Systems > Races & Classes | RaceClassManager |
| users | Players > Users | UserManager |
| issues | Operations > Issues | IssueReportManager |
| roadmap | Operations > Roadmap | RoadmapManager |
| rulebook | Reference > Rulebook | WorldBuilderRulebook |
| manual | Reference > Manual | GameManual |
| *(XpBoostPanel)* | Systems > XP Boost | XpBoostPanel |
| *(new)* | Dashboard | AdminDashboard |

## What Is NOT Changed
- All editor components, their internal tabs, forms, and logic
- Database schemas, RLS policies, edge functions
- AdminRoute auth/role checks
- AdminChatWidget (stays floating)
- World map overlay panel system
- Any business logic or combat/game mechanics

## Implementation Order
1. Create `AdminSidebar.tsx` and `AdminLayout.tsx`
2. Refactor `AdminPage.tsx` to use the new layout (swap tabs → sidebar)
3. Create `AdminDashboard.tsx` as the default landing view
4. Create `AdminGlobalSearch.tsx` with CommandDialog

