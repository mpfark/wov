

## Searchable Node Picker Component

### Problem
Node dropdowns across the admin UI (RegionManager, CreatureManager, NPCManager, NodeEditorDialog) render all nodes in a flat `<Select>` list with no search/filter capability. With hundreds of nodes, finding a specific one is painful.

### Solution
Create a reusable `NodePicker` combobox component that provides:
- **Type-to-search** filtering by node name, area name, or region name
- **Grouped by region** for visual organization
- **Rich labels**: Node name, area name, region, and flag icons (inn, vendor, blacksmith, etc.)
- **Optional "Unassigned" option** for creature/NPC spawn location pickers

Built using the existing `cmdk` (Command) + Popover pattern already in the project.

### New Component

**`src/components/admin/NodePicker.tsx`**
- Props: `nodes`, `regions`, `areas`, `value`, `onChange`, `placeholder?`, `allowNone?`
- Uses `Popover` + `Command` (CommandInput, CommandList, CommandGroup, CommandItem)
- Groups items by region name
- Each item shows: `{nodeName || areaName || #shortId} — {areaName} [{flags}]`
- Filters on node name, area name, region name

### Files to Update

1. **`src/components/admin/RegionManager.tsx`** — Replace the `<Select>` for "Connect to existing node" with `<NodePicker>`
2. **`src/components/admin/CreatureManager.tsx`** — Replace spawn location `<Select>` with `<NodePicker allowNone>`
3. **`src/components/admin/NPCManager.tsx`** — Replace location `<Select>` with `<NodePicker allowNone>`
4. **`src/components/admin/NodeEditorDialog.tsx`** — Replace target node `<Select>` in ConnectionsManager with `<NodePicker>`
5. **`src/components/admin/NodeEditorPanel.tsx`** — Replace any node selectors in the connections section with `<NodePicker>`

Each replacement passes the same `nodes`, `regions`, `areas` data already available in those components (fetched from Supabase or passed as props).

