

# Restructure Map: Region → Area → Node

## Concept

Introduce an **Area** layer between Region and Node. An Area defines a place type (forest, town, cave, etc.) and provides a shared name and description for all its nodes. Nodes no longer require unique names — unnamed nodes display their Area name. Existing data continues working without an area assigned; you can reorganize manually later.

## What Changes for Players

- The location header shows the **Area name** (e.g. "Darkwood Forest") instead of individual node names
- If a node has its own name set, that name takes priority (e.g. "Thornwatch Tower" within Darkwood Forest)
- The description comes from the Area unless the node overrides it
- Region and level range display stays the same

## What Changes for Admins

- New **Area Manager** section in the admin panel for creating/editing areas (name, description, type tag)
- Node editor gets an **Area** dropdown to assign nodes to areas
- World Builder AI generates Areas as part of its output
- World map shows area groupings visually

## Database Changes

### 1. New `area_type` enum
Values: `forest`, `town`, `cave`, `ruins`, `plains`, `mountain`, `swamp`, `desert`, `coast`, `dungeon`, `other`

### 2. New `areas` table
| Column | Type | Notes |
|--------|------|-------|
| id | uuid | Primary key |
| region_id | uuid | FK to regions |
| name | text | e.g. "Darkwood Forest" |
| description | text | Shared by all nodes in area |
| area_type | area_type enum | For filtering/theming |
| created_at | timestamptz | Default now() |

RLS: Public read, admin-only write (same pattern as nodes/regions).

### 3. Alter `nodes` table
- Add `area_id uuid` (nullable, no FK constraint to keep it flexible)
- Change `name` default to empty string (keep NOT NULL but allow empty)
- Keep `description` as-is (acts as override when set)

## File Changes

### Data Layer
- **`src/hooks/useNodes.ts`** — Add `Area` interface and fetch areas alongside regions/nodes. Add `getArea()`, `getAreaNodes()` helpers. Update `GameNode` to include optional `area_id`.

### Player-Facing
- **`src/components/game/NodeView.tsx`** — Display area name as primary heading when node has no name. Show area description as fallback. Show area type tag.
- **`src/components/game/PlayerGraphView.tsx`** — Use area name for node labels when node name is empty.
- **`src/components/game/MapPanel.tsx`** — Pass area data through to child components.
- **`src/components/game/TeleportDialog.tsx`** — Show area name in teleport destination list for unnamed nodes.
- **`src/pages/GamePage.tsx`** — Pass areas from useNodes to relevant components. Use area name in event log messages when node name is empty.

### Admin-Facing
- **`src/components/admin/AreaManager.tsx`** (new) — CRUD for areas: name, description, type, region assignment.
- **`src/components/admin/NodeEditorPanel.tsx`** — Add area selector dropdown. Show inherited description from area.
- **`src/components/admin/AdminWorldMapView.tsx`** — Update GraphNode interface to include area_id. Optionally color/group nodes by area.
- **`src/components/admin/WorldBuilderPanel.tsx`** — Update generated output to include areas. Update apply logic to create areas before nodes.
- **`src/components/admin/RegionGraphView.tsx`** — Show area groupings in the region graph view.
- **`src/pages/AdminPage.tsx`** — Add Areas tab/section to admin panel.

### AI World Builder
- **`supabase/functions/ai-world-builder/index.ts`** — Update system prompt to generate areas. Update tool schema to include areas array. Update world summary to show area structure.

### Documentation
- **`src/components/admin/GameManual.tsx`** — Update world structure section to explain Region → Area → Node hierarchy.
- **`src/components/admin/WorldBuilderRulebook.tsx`** — Update rules to reference areas.

## Migration Strategy

- Existing nodes get `area_id = NULL` by default
- All existing functionality keeps working — when `area_id` is null, the node's own name/description is used as before
- Admins can create areas and reassign existing nodes at their convenience
- New AI-generated content will use the area system automatically

