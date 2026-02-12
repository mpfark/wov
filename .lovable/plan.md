

## Rearrange Users Tab into 3-Column Layout

### Overview

Restructure the Users tab from its current single-column expandable list into a 3-panel layout:

- **Left column**: Compact user list with search and pagination
- **Center column**: Full character sheet for the selected user (account info, admin actions, character details with edit capability)
- **Right column**: Player activity logs

### Layout

```text
+------------------+------------------------+------------------+
|   USER LIST      |   CHARACTER SHEET       |   PLAYER LOGS    |
|                  |                         |                  |
| [Search...]      |  Name / Role / Status   |  Activity feed   |
|                  |  Admin actions (ban,    |  (login, move,   |
| > User A         |   role, reset pwd)      |   combat, etc.)  |
| > User B (sel)   |  Account info grid      |                  |
| > User C         |  Character cards with   |  Placeholder     |
|                  |  paper-doll stats and   |  until logs       |
|                  |  inline edit            |  table exists     |
|                  |                         |                  |
| [Prev] [Next]    |                         |                  |
+------------------+------------------------+------------------+
```

### What Changes

**1. `src/components/admin/UserManager.tsx`** -- Major restructure

- Change the outer container from a single scrollable column to a `flex h-full` row with 3 columns:
  - Left (w-64, border-right): Search input, scrollable user list (compact rows showing name, role badge, char count), pagination at bottom. Clicking a user sets `selectedUserId` state (replaces the expand/collapse pattern).
  - Center (flex-1): Shows the selected user's full details -- account info, admin action buttons (role selector, ban/unban, reset password), and all their characters with inline editing (HP, gold, level). Only renders when a user is selected; otherwise shows an empty state message.
  - Right (w-72, border-left): Player logs panel. Since there is no `player_logs` table in the database yet, this will show a placeholder ("No logs available") for now. The column structure will be ready for when a logging system is added.

- Replace `expandedUser` state with `selectedUserId` -- clicking a user in the left list highlights it and populates the center column instead of expanding inline.

**2. No database changes needed** -- The player logs column will be a placeholder panel ready for future integration. No new tables or edge function changes required for this layout rearrangement.

### Technical Details

- Left column: `w-64 shrink-0 border-r border-border flex flex-col` with ScrollArea for the user list
- Center column: `flex-1 overflow-y-auto p-4` containing the selected user's details (moved from the inline expanded section)
- Right column: `w-72 shrink-0 border-l border-border p-3` with a "Player Logs" header and placeholder content
- The selected user row in the left list gets a highlight class (`bg-accent/20`)
- All existing functionality (search, role change, ban, character editing) stays the same, just reorganized into the center panel

