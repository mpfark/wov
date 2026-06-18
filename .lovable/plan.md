# Rename Turning Stones → Ioun Stones

User-facing item rename only. The Stonebinder service (node flag, edge function, RPC, panel filename, prop names) stays as-is per your choice.

## Name mapping

- `Turning Stone of <X>` → `Ioun Stone of <X>` (6 primary stones)
- `Ascended Turning Stone of <X> and <Y>` → `Vibrating Ioun Stone of <X> and <Y>` (15 ascended stones)

## Database (one migration)

Update `items.name` for all 21 rows:

```sql
UPDATE items SET name = replace(name, 'Ascended Turning Stone of ', 'Vibrating Ioun Stone of ')
  WHERE name LIKE 'Ascended Turning Stone of %';
UPDATE items SET name = replace(name, 'Turning Stone of ', 'Ioun Stone of ')
  WHERE name LIKE 'Turning Stone of %';
```

Also update any `items.description` / lore text that says "Turning Stone" or "Ascended Turning Stone" with the same replacements (verified during execution).

## Code — update name-matching predicates and copy

These places hardcode the strings "Turning Stone" / "Ascended" and must be updated to the new names:

1. **`supabase/functions/stonebinder-fuse/index.ts`**
   - `isPrimaryTurningStone`: change regex `/^Turning Stone of /i` → `/^Ioun Stone of /i`, exclusion `/^Ascended/i` → `/^Vibrating /i`. Rename the helper to `isPrimaryIounStone` (internal only).
   - `.ilike('name', 'Ascended Turning Stone of %')` → `.ilike('name', 'Vibrating Ioun Stone of %')`.
   - Update comments and error strings ("primary Ioun Stones", "vibrating ioun stone", "No vibrating stone matches that essence pair.", "already exists in the world").
   - Activity-log message still uses dynamic item names (no change needed beyond comment polish).

2. **`src/features/inventory/components/StonebinderPanel.tsx`**
   - `isPrimaryTurningStone` regexes → match `/^Ioun Stone of /i` and exclude `/^Vibrating /i`. Rename helper to `isPrimaryIounStone`.
   - Update visible copy: `leftTitle="Primary Ioun Stones"`, empty-state `"You carry no primary Ioun Stones."`, the "The Stonebinder studies the essences..." line stays (Stonebinder service name unchanged).

3. **`src/features/world/components/NodeView.tsx`** (line ~202)
   - Tooltip `"Stonebinder — bind Turning Stones"` → `"Stonebinder — bind Ioun Stones"`.

4. **`supabase/functions/combat-tick/index.ts`** — verified the only `turning` match is an unrelated comment ("immediately processes"); no change.

5. **Memory file `.lovable/memory/game/stonebinder.md`** — update content references to Ioun Stone / Vibrating Ioun Stone so future sessions use the new terminology. Index entry summary updated to match.

## Unchanged (intentionally)

- `is_stonebinder` column, `stonebinder-fuse` edge function name, `stonebinder_commit_fuse` RPC, `StonebinderPanel` component name, `onOpenStonebinder` prop, the ⚜ Stonebinder service label and tooltip.
- AI Item Forge, gem system, item rarity/slot logic — none of these reference the stone names.

## Verification

- Confirm 21 items renamed via a follow-up `SELECT name FROM items WHERE name ILIKE '%ioun%' ORDER BY name`.
- Open Stonebinder panel in preview: existing stones (now Ioun) should still be detected; preview/fuse should still find the matching Vibrating Ioun Stone recipe.
