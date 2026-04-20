

The user clarified two important things:
1. The "Crown" duplicates aren't accidental — every L40 player forges one, and they intentionally share the name
2. The L42 player-named soulforge item is also player-named, so duplicate names are expected there too

These items don't fit cleanly in `common`/`uncommon`/`unique` because:
- They're soulbound and one-per-character (like uniques)
- But they can have name collisions across players (unlike uniques)
- They're player-created, not loot-table-rolled

A new `soulforged` rarity tier solves this cleanly: distinct visual treatment, exempt from naming-convention rules, exempt from unique-item exclusivity locks, and matches the existing memory note about a magenta color for soulforged items.

Let me check what exists today.

## Plan

### 1. Add `soulforged` to the `item_rarity` enum
Migration: `ALTER TYPE item_rarity ADD VALUE 'soulforged';`

### 2. Backfill existing soulforged/crown items
`UPDATE items SET rarity = 'soulforged' WHERE id IN (… all items created by `soulforge-item` edge function …)` — identifiable via `is_soulbound = true AND description LIKE 'Soulforged by %' OR description LIKE 'Royal Crown forged by %'`.

### 3. Update the soulforge edge function
`supabase/functions/soulforge-item/index.ts` line 156: change `rarity: "uncommon"` → `rarity: "soulforged"`. The stat-budget multiplier (currently 1.5, the uncommon value) stays as-is so balance is unchanged — the rarity label is the only change.

### 4. Frontend visual treatment
- `RARITY_COLORS` maps in `CharacterPanel.tsx`, `InspectPlayerDialog.tsx`, `AdminEquipSlot.tsx`, `constants.ts`, `ItemManager.tsx`, `BlacksmithPanel.tsx`, `ItemPicker.tsx`: add `soulforged: 'text-soulforged text-glow'` (magenta, per the existing visual-theme memory)
- `tailwind.config.ts` + `index.css`: add a `soulforged` color token (magenta, e.g. `hsl(300 80% 65%)`) if not already present
- Rarity dropdowns in admin (`ItemManager.tsx`, `ItemForgePanel.tsx`): include `soulforged` so admins can see/filter but **not** set it manually (or allow it — your call; default plan: read-only filter, not assignable)

### 5. Exempt soulforged items from the rename pass
The rename plan from the previous turn updates only `rarity IN ('common', 'uncommon')`. After the backfill in step 2, the Crowns + future player-soulforged items move to `rarity = 'soulforged'` and are automatically excluded — no extra logic needed. The duplicate-Crown deletion from the earlier plan is dropped.

### 6. Unique-item exclusivity check
`try_acquire_unique_item` and `return_unique_items` only act on `rarity = 'unique'` — soulforged items are unaffected, duplicates allowed by design. No change needed.

### 7. Loot rolls
`item_pool` loot mode rolls only common/uncommon. Soulforged tier is excluded automatically because it's not in the percentage config (`common_pct`, `uncommon_pct`). No change needed.

### Files touched
- New migration: enum value + backfill UPDATE
- Edit: `supabase/functions/soulforge-item/index.ts`
- Edit: `tailwind.config.ts`, `src/index.css` (soulforged color token if missing)
- Edit: `CharacterPanel.tsx`, `InspectPlayerDialog.tsx`, `AdminEquipSlot.tsx`, `users/constants.ts`, `ItemManager.tsx`, `BlacksmithPanel.tsx`, `ItemPicker.tsx` (RARITY_COLORS + dropdown options)

### Then re-run the rename
With Crowns + soulforged items safely on their own tier, the previous common/uncommon rename pass runs cleanly with no special cases.

### Out of scope
- Changing soulforge stat budget or balance
- Letting admins manually set `rarity = 'soulforged'` on regular items (keep it strictly server-issued via the soulforge function)

