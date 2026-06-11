# Equipment List View

Replace the 3-column paper-doll grid with a single-column vertical list in all three equipment views. Each slot becomes a full-width row showing the same info and tooltip as today.

## Slot order (top → bottom)
1. Main Hand
2. Off Hand
3. Head
4. Chest
5. Gloves
6. Pants
7. Trinket
8. Ring
9. Ring (ring_2, also labeled "Ring")

## Row layout
Each row is one horizontal strip:

```text
[Slot label]  [Item name (rarity color, truncate)]  [Badges: 2H / 🛡 / Proficient]  [Durability%]
```

- Empty slot: shows "Empty" in muted text on the right.
- Blocked off_hand (when main_hand is 2H): shows "2H — blocked" muted, no click.
- Click row to unequip (same as current tile click), same in-combat lock behavior.
- Tooltip on hover = current `ItemTooltipCard` unchanged.
- Rarity colors, durability %, broken indicator unchanged.

## Files to change
- `src/features/character/components/CharacterPanel.tsx`
  - Rewrite `EquipSlot` to render a full-width row.
  - Replace the `grid grid-cols-3` block (lines ~382–424) with a `flex flex-col gap-1` list in the new order.
  - Keep "Proficient" badge inline on the Main Hand row and "🛡 Shield" badge inline on the Off Hand row (move from absolute-positioned overlays to inline pills inside the row).
- `src/components/game/InspectPlayerDialog.tsx`
  - Rewrite `InspectSlot` to row layout; replace the grid with the same vertical list, same order. No unequip action (read-only), no badges beyond 2H.
- `src/components/admin/users/AdminCharacterSheet.tsx`
  - Replace the grid block (lines ~258–276) with the same vertical list using `AdminEquipSlot` rewritten as a row, same order. Keep blocked off_hand behavior.
- `src/components/admin/users/AdminEquipSlot.tsx` — convert to row rendering (kept API the same).

## Out of scope
- Inventory bag list, materials, gem pouch, consumables — untouched.
- Tooltip contents and equip/unequip logic — untouched.
- Stats, attributes, portrait tabs — untouched.
