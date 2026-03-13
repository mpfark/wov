

## Level 42 Reward: Soulforged Item Crafting via NPC

### Overview
When a character reaches level 42, they can visit a special NPC ("The Soulwright") in the Ash-Veil Perimeter to craft one custom uncommon equipment item. The item is soulbound (cannot be dropped or sold) and follows the same stat budget rules as admin-created items.

### Database Changes

1. **Add `is_soulbound` column to `items` table** — boolean, default false. Soulbound items cannot be dropped or sold.

2. **Add `soulforged_item_created` column to `characters` table** — boolean, default false. Tracks whether the character has already used their one-time crafting reward.

3. **Create the NPC record** via data insert — "The Soulwright" placed on a node in the Ash-Veil Perimeter region (will need to look up the node ID at insert time, or create via the NPC manager).

### Frontend Changes

1. **New component: `SoulforgeDialog.tsx`**
   - Opens when talking to "The Soulwright" NPC (detected by a special NPC flag or name)
   - If character level < 42: shows a lore message ("You are not yet worthy...")
   - If `soulforged_item_created` is true: shows "You have already forged your legacy."
   - Otherwise: shows the item crafting UI:
     - Item name input (text, max 30 chars, ASCII-only)
     - Slot selector (all equipment slots)
     - 1H/2H toggle for main_hand
     - Stat allocator with budget = `getItemStatBudget(42, 'uncommon', hands)` showing remaining points
     - Stat caps enforced per `getItemStatCap(key, 42)`
     - Live preview of the item
     - "Forge" button to confirm

2. **Forge action flow:**
   - Insert a new row into `items` with `rarity: uncommon`, `level: 42`, `is_soulbound: true`, auto-calculated gold value
   - Insert into `character_inventory` for the character
   - Update `characters.soulforged_item_created = true`
   - All done client-side with RLS (character owns their own data, items insert needs a workaround)

3. **Item insert authorization:** Since only admins can insert items, we need an **edge function** `soulforge-item` that:
   - Validates the caller is authenticated and owns the character
   - Validates character is level 42 and `soulforged_item_created` is false
   - Validates item name (ASCII, length), slot, stats (budget + caps)
   - Inserts the item with `is_soulbound: true` using service role
   - Inserts into `character_inventory`
   - Sets `soulforged_item_created = true`
   - Returns the created item

4. **Soulbound enforcement in existing UI:**
   - `CharacterPanel.tsx`: Hide "Drop" and "Destroy" buttons for soulbound items
   - `VendorPanel.tsx`: Hide "Sell" option for soulbound items
   - `useInventory.ts`: Add soulbound check in `dropItem`

5. **NPC dialog routing in `GamePage.tsx`:**
   - When `talkingToNPC` is set and the NPC name matches "The Soulwright", open `SoulforgeDialog` instead of `NPCDialogPanel`

### NPC Creation
The NPC "The Soulwright" will be inserted into the `npcs` table via the admin tool or a data migration, placed on a node in the Ash-Veil Perimeter. Since "Ash-Veil Perimeter" doesn't appear in the codebase, it's likely an area/region name in the database. We'll need to query for it and assign the NPC to an appropriate node.

### Technical Details

**Edge function `soulforge-item`:**
- Auth: verify JWT, extract user ID
- Validate: character ownership, level 42, not already forged
- Validate item: name (1-30 ASCII chars), valid slot, stats within budget and caps, equipment type only
- Insert item with service role key, `is_soulbound: true`, `rarity: uncommon`, `level: 42`
- Insert inventory entry, update character flag
- Return created item data

**Stat budget for level 42 uncommon 1H:** `floor(1 + 41 * 0.3 * 1.5) = floor(19.45) = 19`
**Stat budget for level 42 uncommon 2H:** `floor(1 + 41 * 0.3 * 1.5 * 1.5) = floor(28.675) = 28`

**Files to create/modify:**
- `supabase/functions/soulforge-item/index.ts` (new edge function)
- `src/components/game/SoulforgeDialog.tsx` (new crafting UI)
- `src/pages/GamePage.tsx` (route NPC dialog to SoulforgeDialog)
- `src/components/game/CharacterPanel.tsx` (hide drop/destroy for soulbound)
- `src/components/game/VendorPanel.tsx` (hide sell for soulbound)
- `src/hooks/useInventory.ts` (add soulbound to item interface)
- DB migration: add `is_soulbound` to items, `soulforged_item_created` to characters

