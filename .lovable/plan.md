

# Add New Admin Actions: Teleport, Grant XP, Revive, Remove Item, Reset Stats

## Overview

Add five new admin actions to the Users panel so admins can better manage and assist players. All actions will be added to the existing Admin Actions column (Column 2) and backed by new endpoints in the `admin-users` edge function.

## New Actions

1. **Teleport Player** -- Move a character to any node via a searchable dropdown
2. **Grant XP** -- Award XP directly (with automatic level-up handling via existing DB logic)
3. **Revive Character** -- Instantly set HP to max_hp for dead/incapacitated characters
4. **Remove Item** -- Delete a specific item from a character's inventory
5. **Reset Stat Points** -- Refund all allocated stat points back to base (racial/class defaults) and grant them as unspent points

## Technical Details

### Edge Function Changes (`supabase/functions/admin-users/index.ts`)

Add five new action handlers:

- **`teleport`** -- Updates `characters.current_node_id` to the provided `node_id`. Validates the node exists.
- **`grant-xp`** -- Adds XP to a character. Reuses the same level-up logic as `award_party_member` DB function but via direct SQL update (XP add, check threshold, bump level/max_hp/stat points if needed).
- **`revive`** -- Sets `characters.hp = characters.max_hp` for the given character.
- **`remove-item`** -- Deletes a row from `character_inventory` by inventory entry ID.
- **`reset-stats`** -- Calculates the character's base stats (10 for all, plus racial/class bonuses from level-ups), sets those as current stats, and converts the difference into `unspent_stat_points`.

### Frontend Changes (`src/components/admin/UserManager.tsx`)

Add new UI sections in the Admin Actions column (Column 2), below the existing "Give Item" section:

- **Teleport**: A select dropdown listing all nodes (fetched on mount, grouped or flat). Button: "Teleport {charName}".
- **Grant XP**: A number input for XP amount. Button: "Grant XP to {charName}".
- **Revive**: A simple button per character, only enabled when HP < max_hp. Button: "Revive {charName}".
- **Remove Item**: A select dropdown showing the character's current inventory items. Button: "Remove".
- **Reset Stats**: A button per character. Button: "Reset Stats for {charName}".

New state variables: `teleportNodeId`, `grantXpAmount`, `removeItemId`, plus a nodes list fetched on mount.

New icons imported from lucide-react: `MapPin`, `Sparkles`, `Heart`, `Trash2`, `RotateCcw`.

Each action calls `callAdmin()` with the appropriate action name and payload, shows a toast on success, and reloads the user list.

### Data Loading

- Fetch all nodes on mount (similar to how `allItems` is loaded) for the teleport dropdown.
- The character's inventory is already available from the user list response for the remove-item dropdown.

### No Database Migrations Needed

All operations use existing tables and columns. The edge function uses the service role key to bypass RLS, so no policy changes are required.

