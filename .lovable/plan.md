

The user picked Option A (drop the layered paper doll) and wants to extend it: each item gets its own optional illustration that shows in tooltips. This is a clean, achievable scope.

Let me check what tooltips currently exist for items so the plan covers all the surfaces.

The item tooltip surfaces I know about from the codebase:
- `CharacterPanel.tsx` — equipped slots + inventory list (main tooltip surface)
- `InspectPlayerDialog.tsx` — inspecting other players
- `AdminEquipSlot.tsx` — admin character sheet
- `ItemPicker.tsx`, `ItemPickerList.tsx` — admin pickers
- Vendor/Blacksmith/Soulforge/Scroll panels — service dialogs

Items already have an `appearance_key` column (UUID → appearance_entries). Two options for the illustration:
1. Reuse `appearance_key` + appearance_entries (already wired)
2. Add a new `illustration_url` column directly on `items`

Option 2 is simpler and more honest about intent: the appearance library was for layered doll assets; an item illustration is a single image. Cleaner to keep them separate.

## Plan

### Step 1 — Remove the paper doll
- Delete `PaperDoll.tsx`, `doll-contract.ts`, `appearance-resolver.ts`, `useAppearanceEntries.ts`
- Remove `<PaperDoll>` usage in `CharacterPanel.tsx` and `AdminCharacterSheet.tsx`
- Keep the existing equipment slot grid (already there and works fine)
- Leave `appearance_entries` table and admin `AppearanceLibrary` in place for now (unused but harmless; can prune later if you want)

### Step 2 — Add `illustration_url` to items
- Migration: `ALTER TABLE items ADD COLUMN illustration_url text DEFAULT '' NOT NULL`
- No RLS changes needed (existing item policies cover it)

### Step 3 — Item Manager: illustration field + AI generation
- In `ItemManager.tsx` add an Illustration section to the editor form:
  - Text input for `illustration_url`
  - Small preview thumbnail
  - "Generate with AI" button → reuses the existing `ai-item-forge` pattern, generates a square portrait of the item based on its name/description/rarity, uploads to a new `item-illustrations` storage bucket, returns the URL
- New edge function `ai-item-illustration` (or extend existing one) using Lovable AI image generation (`google/gemini-3.1-flash-image-preview`)
- New public storage bucket `item-illustrations`

### Step 4 — Show illustration in tooltips
Update item tooltips to render the illustration above the name when present:
- `CharacterPanel.tsx` (EquipSlot tooltip + inventory item tooltip)
- `InspectPlayerDialog.tsx` (InspectSlot tooltip)
- `AdminEquipSlot.tsx`
- `ItemPicker.tsx` / `ItemPickerList.tsx` (optional, can defer)

Tooltip layout: 96×96px illustration on top, then existing name/stats/description below. Falls back to text-only when `illustration_url` is empty.

### Step 5 — Backfill helper (optional)
Add a "Generate illustrations for all items missing one" admin button on the Item Manager toolbar that batch-generates for any item with `illustration_url = ''`. Run it once at your leisure.

### Files touched
- Delete: `src/features/character/components/PaperDoll.tsx`, `src/features/character/utils/doll-contract.ts`, `src/features/character/utils/appearance-resolver.ts`, `src/features/character/hooks/useAppearanceEntries.ts`
- Edit: `CharacterPanel.tsx`, `AdminCharacterSheet.tsx`, `InspectPlayerDialog.tsx`, `AdminEquipSlot.tsx`, `ItemManager.tsx`
- New: `supabase/functions/ai-item-illustration/index.ts`
- Migration: `items.illustration_url` column + `item-illustrations` storage bucket

### What stays unchanged
- All gameplay, stats, equipment logic
- The equipment slot grid in CharacterPanel
- The appearance_entries table (left in place, unused for now)

