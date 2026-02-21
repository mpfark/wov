

# Teleport From Anywhere (Level 25+ Perk)

## Overview
Players who reach level 25 unlock the ability to teleport from **any node** to any teleport point, not just from teleport nodes. When they do, a hidden "waymark" is saved at their departure location that they can return to. Party members at the same node also teleport along, regardless of their level.

## How It Works

1. **Level 25+ unlock**: A "Teleport" button appears in the NodeView action bar for any node (not just teleport nodes) if the character is level 25+.

2. **Waymark system**: When a level 25+ player teleports from a non-teleport node, their departure node ID is saved as a "waymark" (stored in component state -- no DB needed since it's session-scoped). The TeleportDialog then shows a special "Return to Waymark" option at the top.

3. **Returning to waymark**: Clicking "Return to Waymark" teleports the player back to their saved departure location (same CP cost formula applies). The waymark is cleared after use.

4. **Party teleportation**: When a level 25+ player teleports (from anywhere), all party members at the same node are moved along -- regardless of their level. This extends the existing follower logic to also include non-following accepted party members who are co-located.

## Technical Details

### TeleportDialog.tsx changes
- Add new props: `characterLevel`, `waymark` (node object or null), `onReturnToWaymark` callback
- If `waymark` is set, render a highlighted "Return to Waymark" row at the top of the destination list showing the waymark node name and CP cost
- The dialog remains unchanged for players below level 25 (they only see it at teleport nodes)

### NodeView.tsx changes
- Show the Teleport button if `node.is_teleport` OR `character.level >= 25`
- Pass an `onOpenTeleport` callback in both cases

### GamePage.tsx changes
- Add `waymark` state: `useState<string | null>(null)` storing the departure node ID
- When `onOpenTeleport` is triggered from a non-teleport node (level 25+ feature), allow opening the dialog
- Modify `handleTeleport`: if the current node is NOT a teleport point, save `character.current_node_id` as the waymark before moving
- Add `handleReturnToWaymark`: teleports back to the waymark node, clears the waymark, costs CP
- Extend party teleport logic: when teleporting from anywhere, move all accepted party members at the same node (not just followers)
- Pass `characterLevel`, `waymark` data, and return callback to TeleportDialog
- Update the `onOpenTeleport` prop passed to NodeView: provide it whenever `currentNode.is_teleport` OR `character.level >= 25`
- Keep the existing combat check

### TeleportDialog rendering for waymark
- A "Return to Waymark" entry appears only when `waymark` is set
- It shows the waymark node name, region info, and CP cost
- Styled distinctly (e.g., a golden/highlighted border) so it stands out

### No database changes needed
- The waymark is session-scoped state (resets on page reload) which keeps it simple and avoids schema changes
- This is intentional: waymarks are temporary tactical tools, not persistent save points

