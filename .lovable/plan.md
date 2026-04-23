

## Repo Cleanup and Stabilization Pass

### Priority 1 — Admin Page Consistency

**Findings**: The five targeted admin editors have three distinct UI patterns. `CreatureManager`, `ItemManager`, and `NPCManager` already use the shared admin components (`AdminEditorHeader`, `AdminFormSection`, `AdminStickyActions`, `AdminEmptyState`). `RegionEditorPanel` and `AreaEditorPanel` do not — they use hand-rolled headers, inline save buttons, and inconsistent label sizing.

`NodeEditorPanel` uses a hand-rolled header but is otherwise well-structured with tabs.

#### Changes

**RegionEditorPanel.tsx** (130 lines)
- Replace inline header with `AdminEditorHeader`
- Wrap form groups in `AdminFormSection` (Identity, Level Range, Illustration)
- Replace inline Save button with `AdminStickyActions`
- Standardize labels from `text-xs text-muted-foreground font-display` to `text-[10px] text-muted-foreground` (matches Item/Creature/NPC editors)
- Move IllustrationEditor before the save action (consistent ordering)

**AreaEditorPanel.tsx** (215 lines)
- Replace inline header (with delete button) with `AdminEditorHeader` plus a delete button in `AdminStickyActions.extraActions`
- Wrap form groups in `AdminFormSection` (Identity, Region & Type, Level Range, Content Hints, Illustration)
- Replace inline Save button with `AdminStickyActions`
- Standardize labels to `text-[10px] text-muted-foreground`

**NodeEditorPanel.tsx** (1325 lines)
- Replace hand-rolled header (lines 872-879) with `AdminEditorHeader`
- Replace inline Save/Delete buttons (lines 1008-1017) with `AdminStickyActions` using `extraActions` for the delete button
- Wrap "Node Services" checkboxes in `AdminFormSection`
- No other structural changes — tabs and internal logic remain as-is

**No changes to**: save logic, data flow, database behavior, gameplay admin logic, or internal form state management in any editor.

### Priority 2 — Repo / Project Polish

**README.md** — Full rewrite:
- Project name: Wayfarers of Varneth
- Description: Browser-based MUD-style RPG
- Tech stack: React 18, Vite, TypeScript, Tailwind, Supabase (auth, DB, edge functions, realtime)
- How to run locally (npm install, npm run dev)
- High-level architecture: features directory structure, edge functions for combat/AI, admin tools
- Brief note on admin access (role-based, Steward/Overlord hierarchy)

**package.json** — Change `"name"` from `"vite_react_shadcn_ts"` to `"wayfarers-of-varneth"`

**index.html** — Remove the `<!-- TODO: Set the document title -->` comment. Update `meta author` from "Lovable" to "Wayfarers of Varneth".

### Priority 3 — Safe Maintainability Improvements

- **NodeEditorPanel line 779**: Remove duplicate `if (!selectedRegionId) return toast.error('Select a region');` (exact same check on line 778)
- **RegionEditorPanel**: Remove unnecessary `as any` casts on the Supabase update call if types allow (will verify during implementation)
- **AreaEditorPanel**: Same `as any` cleanup opportunity

### Files Changed

| File | Type of change |
|------|---------------|
| `src/components/admin/RegionEditorPanel.tsx` | Shared component adoption, label/layout consistency |
| `src/components/admin/AreaEditorPanel.tsx` | Shared component adoption, label/layout consistency |
| `src/components/admin/NodeEditorPanel.tsx` | Header and save bar consistency, duplicate line removal |
| `README.md` | Full rewrite |
| `package.json` | Project name |
| `index.html` | Remove TODO comment, update author |

### Deferred

- `AdminStickyActions` could accept a `loading` state for visual feedback — not adding in this pass
- `WorldBuilderPanel.tsx` (800 lines) uses its own patterns but is a specialized tool — not standardizing now
- `LootTableManager.tsx` — not audited, defer to next pass
- Global TypeScript strict mode — explicitly out of scope per instructions

