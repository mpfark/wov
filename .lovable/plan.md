## Goal
Let admins mark teleport nodes as "always available" so players can teleport to them without first discovering them (useful for class order halls and major hubs).

## Approach

Add a new boolean column `is_public_teleport` on `nodes` (defaults to false). The admin Node Editor gets a toggle next to "Teleport". The teleport dialog treats any node with this flag as visited.

## Changes

**Database (migration)**
- `ALTER TABLE public.nodes ADD COLUMN is_public_teleport boolean NOT NULL DEFAULT false;`

**Admin UI — `src/components/admin/NodeEditorPanel.tsx`**
- Add `is_public_teleport` to form state, load/save paths, and flags badge ("Public Teleport").
- Render a checkbox under the Teleport toggle, disabled unless `is_teleport` is true.

**Player teleport — `src/features/world/components/TeleportDialog.tsx`**
- Change destination filter from `visitedIds.has(n.id)` to `visitedIds.has(n.id) || n.is_public_teleport`.

**Types — `src/features/world/hooks/useNodes.ts`**
- Add `is_public_teleport: boolean` to `GameNode`, include in select if it whitelists columns.

No changes to discovery logic (`character_visited_nodes`) — public-teleport simply bypasses the visited gate for the teleport list. Walking discovery still works normally.

## Out of scope
- Bulk-toggle in batch edit panel (can be added later if needed).
- No changes to map fog-of-war; public-teleport only affects the teleport menu.