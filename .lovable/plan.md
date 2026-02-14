

## Clean Up Admin User Actions for Multi-Character Support

### Problem
The Admin Actions column (COL 2) currently duplicates every action section (Give Item, Teleport, Grant XP, Revive, Remove Item, Reset Stats) for **each character** inline. With multiple characters per user, this creates a very long, repetitive scrolling list that's hard to use.

### Solution
Add a **character selector** at the top of the actions panel. All character-specific actions then apply to the single selected character, eliminating duplication.

### Changes

#### `src/components/admin/UserManager.tsx`

1. **Add `selectedCharId` state** — tracks which character is selected for actions. Auto-selects the first character when a user is picked.

2. **Character Selector** — a dropdown at the top of the actions panel showing character name, class, and level. Appears when the selected user has 1+ characters.

3. **Flatten action sections** — instead of mapping over `selectedUser.characters` for each action group, all actions reference the single `selectedChar` derived from `selectedCharId`. This removes the repeated character name labels and per-character loops.

4. **Character Sheet column (COL 3)** — also highlight/scroll to the selected character, or optionally only show the selected character's sheet instead of all sheets stacked.

5. **Auto-select logic** — when `selectedUserId` changes, auto-pick the first character. When `selectedCharId` changes, reset action-specific state (giveItemId selection, removeItemId, etc.).

### Layout After Changes

```text
+------------+------------------+------------------+----------+
| User List  | Admin Actions    | Character Sheet  | Logs     |
|            |                  |                  |          |
|            | [Character ▼]    | (selected char)  |          |
|            | -- Account --    |                  |          |
|            | Reset Password   |                  |          |
|            | Role / Ban       |                  |          |
|            | -- Character --  |                  |          |
|            | Give Item        |                  |          |
|            | Teleport         |                  |          |
|            | Grant XP         |                  |          |
|            | Revive           |                  |          |
|            | Remove Item      |                  |          |
|            | Reset Stats      |                  |          |
+------------+------------------+------------------+----------+
```

### Technical Details

- New state: `selectedCharId: string | null`
- Derived: `const selectedChar = selectedUser?.characters.find(c => c.id === selectedCharId)`
- Effect: when `selectedUserId` changes, set `selectedCharId` to first character's id (or null)
- All action handlers already accept `characterId` as a parameter, so no handler changes needed
- Character Sheet column will show only the selected character instead of all characters stacked

