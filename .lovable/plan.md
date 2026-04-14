

# Admin UI Consistency Pass (Revised)

## Shared Components (`src/components/admin/common/`)

| Component | Lines | Purpose |
|-----------|-------|---------|
| `AdminEntityToolbar` | ~20 | Slot-based header: icon, title, count badge, then `children` for whatever filters/search/buttons the page needs |
| `AdminEditorHeader` | ~15 | Editor panel header with title + close button |
| `AdminFormSection` | ~12 | Section title + optional description + children — used selectively |
| `AdminStickyActions` | ~15 | Save/Cancel row with optional extra actions slot |
| `AdminEmptyState` | ~10 | Consistent empty/no-selection placeholder |
| `index.ts` | — | Barrel export |

## Refinements Applied

**1. AdminFormSection — selective use only.** Applied where grouping genuinely helps readability:
- CreatureManager: "Stats", "Loot", "Gold Drop", "Spawn & Behavior" — yes. Single-field rows or already-compact areas — no.
- ItemManager: "Stats" grid, "Origin" section — yes. Top-level name/type/rarity fields — no (already compact).
- NPCManager: Only "Location" section benefits. The rest is 3 fields — leave as-is.
- UserManager: Action groups in column 3 ("Give Item", "Teleport", "Grant XP") — yes.

**2. AdminEntityToolbar — fully slot-based.** The component renders: icon + title + count badge + `{children}`. That's it. Each page passes its own filters, dropdowns, search inputs, and buttons as children. No fixed internal layout beyond the left-aligned title area. Pages like Items (with type/slot filter tabs) and Users (with role filters) keep their unique toolbar content.

**3. LootTableManager — minimal wrapper.** Only add `AdminEntityToolbar` as a thin header above the existing `TabsList`. No extra framing around the sub-tabs. The component's own `<Tabs>` structure stays visually dominant.

## Page Changes

### CreatureManager
- Toolbar div → `AdminEntityToolbar` (filters/search/New as children)
- Editor header → `AdminEditorHeader`
- Save/Cancel → `AdminStickyActions`
- Empty states → `AdminEmptyState`
- `AdminFormSection` on: Stats grid, Loot section, Gold Drop, Spawn & Behavior
- Leave compact top fields (name, description, rarity, level) unwrapped

### ItemManager
- Toolbar div → `AdminEntityToolbar` (search/unassigned toggle/New as children)
- Editor header → `AdminEditorHeader`
- Save/Cancel → `AdminStickyActions`
- Empty states → `AdminEmptyState`
- `AdminFormSection` on: Stats grid, Origin section
- Leave type/slot/rarity filter tabs and top form fields as-is

### NPCManager
- Toolbar div → `AdminEntityToolbar` (region filter/search/New as children)
- Editor header → `AdminEditorHeader`
- Save/Cancel → `AdminStickyActions`
- Empty states → `AdminEmptyState`
- `AdminFormSection` on: Location picker only
- Leave name/description/dialogue fields unwrapped (already compact)

### LootTableManager
- Add `AdminEntityToolbar` as a light header above the TabsList (title + icon only, no extra chrome)
- All four sub-tabs stay completely untouched internally

### UserManager
- User list search header → `AdminEntityToolbar` (search/role filter as children)
- Empty states → `AdminEmptyState`
- Column 3 action groups → `AdminFormSection` for section labels
- 4-column layout stays as-is

## Not Changed
- All business logic, save handlers, data fetching, tab structures
- World map tools
- Database schemas, routes, auth
- Internal sub-tab content in LootTableManager

## Files

| File | Action |
|------|--------|
| `src/components/admin/common/AdminEntityToolbar.tsx` | Create |
| `src/components/admin/common/AdminEditorHeader.tsx` | Create |
| `src/components/admin/common/AdminFormSection.tsx` | Create |
| `src/components/admin/common/AdminStickyActions.tsx` | Create |
| `src/components/admin/common/AdminEmptyState.tsx` | Create |
| `src/components/admin/common/index.ts` | Create |
| `src/components/admin/CreatureManager.tsx` | Refactor |
| `src/components/admin/ItemManager.tsx` | Refactor |
| `src/components/admin/NPCManager.tsx` | Refactor |
| `src/components/admin/LootTableManager.tsx` | Light wrapper |
| `src/components/admin/UserManager.tsx` | Refactor |

