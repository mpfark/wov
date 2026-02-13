

# NPC System

Build an NPC system that allows admins to place non-hostile, non-combat characters at nodes. NPCs can display dialogue when interacted with, and are designed to later support quest-giving.

---

## What Players Will See

- NPCs listed in the "In the Area" section of each node, visually distinct from creatures (no HP bar, no attack button)
- A "Talk" button next to each NPC
- A dialog popup showing the NPC's name and their dialogue text
- NPCs marked with a speech bubble icon

## What Admins Will See

- A new "NPCs" tab in the admin panel (alongside Creatures, Items, etc.)
- A split-view CRUD manager (same pattern as Creatures) to create/edit/delete NPCs
- Fields: name, description, dialogue text, node assignment
- NPC markers on the admin world map (distinct icon/color from creatures)

---

## Implementation Steps

### 1. Database: Create `npcs` table

A new migration to create the table with the following columns:

- `id` (uuid, primary key)
- `name` (text, required)
- `description` (text, default empty)
- `dialogue` (text, default empty) -- what the NPC says when talked to
- `node_id` (uuid, nullable, foreign key to nodes)
- `created_at` (timestamptz, default now())

RLS policies:
- SELECT: anyone (authenticated) can view
- INSERT/UPDATE/DELETE: admins only (is_maiar_or_valar())

### 2. Hook: `useNPCs`

A new hook (`src/hooks/useNPCs.ts`) similar to `useCreatures`:
- Fetches NPCs at the current node
- Subscribes to realtime changes on NPCs for that node
- Returns an array of NPC objects

### 3. Player UI: Show NPCs in NodeView

Update `NodeView` to:
- Accept an `npcs` prop
- Render each NPC in the "In the Area" section with a distinct style (no HP bar, no attack button)
- Show a "Talk" button that opens a dialog with the NPC's name and dialogue text

### 4. Player UI: NPC Dialog Component

Create `src/components/game/NPCDialogPanel.tsx`:
- A simple dialog/sheet showing the NPC name and their dialogue text
- Styled consistently with the game's fantasy theme

### 5. Wire NPCs into GamePage

Update `GamePage` to:
- Call `useNPCs(character.current_node_id)`
- Pass NPCs to `NodeView`
- Manage the NPC dialog open/close state

### 6. Admin: NPC Manager

Create `src/components/admin/NPCManager.tsx`:
- Split-view layout matching `CreatureManager` pattern
- Left panel: searchable/filterable list of all NPCs
- Right panel: form with name, description, dialogue, and node assignment
- CRUD operations against the `npcs` table

### 7. Admin: Add NPCs Tab

Update `AdminPage.tsx` to add an "NPCs" tab in the TabsList, rendering `NPCManager`.

### 8. Admin World Map: NPC Markers

Update `AdminWorldMapView` to show NPC presence on nodes (e.g., a small speech-bubble icon or a count indicator), similar to how creature counts are shown.

---

## Technical Details

- The `npcs` table is intentionally simple now. When quests are added later, a `quest_id` or `quest_giver` flag can be added without disrupting existing NPCs.
- Realtime subscriptions follow the same pattern as creatures (channel per node_id).
- No new dependencies are needed.

