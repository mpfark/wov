

## Vitruvian Man Silhouette + Rearranged Slots + Boots

### 1. Database: Add "boots" to the item_slot enum

A migration is needed to add `'boots'` as a new value to the `item_slot` enum type so items can use the boots slot.

```sql
ALTER TYPE item_slot ADD VALUE 'boots';
```

### 2. SVG: Replace current silhouette with Vitruvian Man

Replace the current simple stick-figure SVG with a Vitruvian Man-inspired silhouette -- a figure with outstretched arms and legs inscribed in a circle, drawn with thin glowing primary-colored lines. This keeps the magical glow filter but gives a much more iconic, recognizable look.

### 3. Rearrange Equipment Slots

New layout (read top to bottom, left to right):

```text
Row 1: [Trinket]    [Head]     [Amulet]
Row 2: [Shoulders]  [Chest]    [Gloves]  
Row 3: [Main Hand]  [Belt]     [Off Hand]
Row 4: [Ring]        [Pants]    (empty)
Row 5:              [Boots]
```

- Head centered with Trinket on the left, Amulet on the right
- Chest centered with Shoulders left, Gloves right
- Belt centered with Main Hand left, Off Hand right
- Ring on the left, Pants centered
- Boots centered at the bottom (new slot)

### 4. Update SLOT_LABELS and EquipSlot references

Add `boots: 'Boots'` to the `SLOT_LABELS` map and add the new `EquipSlot` for boots in the layout.

### Technical Details

**Migration**: Add `'boots'` to `item_slot` enum.

**File: `src/components/game/CharacterPanel.tsx`**:
- Replace the SVG body (lines 175-211) with a Vitruvian Man figure: a circle, a human outline with outstretched arms and spread legs, all with the same glow filter and primary color styling
- Rearrange the slot rows (lines 213-228) into a 3-column grid layout with the arrangement described above
- Add `boots: 'Boots'` to `SLOT_LABELS`
- Add a new `EquipSlot` for boots at the bottom

No changes to hooks, inventory logic, or party panel.

