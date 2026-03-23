

## Inspect Other Players' Equipped Gear

### Problem
Players can see other characters at the same node but cannot view their equipment. This is a common social feature in MUD-style games — inspecting another player's gear.

### Approach
Add a click-to-inspect interaction on player names in NodeView (and optionally the Online Players dialog). Clicking opens a dialog showing the target's equipped items, fetched on-demand via a server-side RPC.

### Why an RPC?
The `character_inventory` table's RLS only allows owners (and admins) to SELECT. We need a `SECURITY DEFINER` function that returns only equipped items for a given character — no inventory snooping, just what's visibly worn.

### Database Changes

**New RPC: `inspect_character_equipment`**
- Input: `_character_id uuid`
- Returns: table of equipped item details (slot, item name, rarity, stats, item_type, hands, durability percentage)
- Only returns rows where `equipped_slot IS NOT NULL`
- No authorization restriction — anyone can see equipped gear (it's public in a MUD)

### Frontend Changes

**1. New component: `src/components/game/InspectPlayerDialog.tsx`**
- Dialog triggered by clicking a player name
- Calls `supabase.rpc('inspect_character_equipment', { _character_id })` on open
- Displays a paper-doll-style or list view of equipped items with rarity colors, stats, and slot labels
- Shows player name, race, class, level in the header

**2. `src/components/game/NodeView.tsx`**
- Wrap each player name in the "Others Here" section with a clickable element that opens `InspectPlayerDialog`
- Pass the player's presence data (id, name, race, class, level, gender)

**3. `src/components/game/OnlinePlayersDialog.tsx`** (optional enhancement)
- Make player names clickable to inspect, but only if they're at the same node (or always allow it for online players)

### Security
- The RPC only exposes equipped items — unequipped inventory stays private
- No sensitive data exposed (no HP, gold, stats of the character — just their gear)
- Item stats are already publicly viewable via the `items` table

### Summary
- 1 new database function
- 1 new component (`InspectPlayerDialog`)
- 1 file updated (`NodeView.tsx` — make player names clickable)
- Optional: `OnlinePlayersDialog.tsx` update

