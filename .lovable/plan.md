## Goal

Move from 12 equipment slots to 9: **head, trinket, chest, gloves, main_hand, off_hand, ring, ring_2, pants**. Remove amulet, shoulders, belt, boots. Remove the belt-potion feature entirely. Defer items-catalog cleanup to Phase 2.

## Phase 1 — Slot logic, UI, and minimum data scrub

### 1. Database migration

- Add `'ring_2'` value to the `equipped_slot` enum (or text constraint — whichever the column uses).
- **Delete from `character_inventory`** every row whose `equipped_slot IN ('amulet','shoulders','belt','boots')` (~27 rows total) — per user choice.
- Drop the `belt_slot` column from `character_inventory` (after the deletes, no rows reference it).
- No changes to the `items`, `forge_pool`, `vendor_inventory`, `marketplace_listings`, or loot tables yet — those items just become unequippable but still exist. Phase 2 will handle them.

### 2. Frontend — equipment grid (`CharacterPanel.tsx`)

- New 9-slot layout. Proposed grid (3 columns):

```text
[ trinket ][ head     ][          ]
[ ring    ][ chest    ][ ring_2   ]
[ mainhand][ pants    ][ offhand  ]
[         ][ gloves   ][          ]
```

(Exact arrangement open to tweaks — confirm during build.)

- Remove `EquipSlot` calls for amulet, shoulders, belt, boots.
- Add second `EquipSlot` for `ring_2`. Both ring slots accept items with `slot === 'ring'`.
- Remove the entire **Belt Potions** block (the `{beltCapacity > 0 && …}` section, lines ~436–490).
- Remove `beltedPotions` / `beltCapacity` / `onBeltPotion` / `onUnbeltPotion` props.
- Update `SLOT_LABELS` map: drop the four removed entries, add `ring_2: 'Ring'`.

### 3. Inventory hook (`useInventory.ts`)

- `equipItem(invId, 'ring' | 'ring_2')`: when equipping a ring, allow either slot; "unequip whatever is in that slot first" stays the same per-slot.
- Remove belt-specific branch in `unequipItem` (the block that clears `belt_slot` when a belt is removed).
- Remove `beltCapacity`, `beltedPotions`, `beltPotion`, `unbeltPotion`, all `belt_slot` references.
- Drop `belt_slot` from the `InventoryItem` interface.
- Filtering of bag items no longer needs `belt_slot === null` — just `unequipped`.

### 4. Other UI / hooks

- `GamePage.tsx`: remove `beltedPotions/beltCapacity/beltPotion/unbeltPotion` from destructuring + props + the `1`–`4` hotkey block (lines ~770–780, 967–989). Drop bag-weight `belt_slot` filters.
- `useMovementActions.ts`: drop `belt_slot` filter (line ~246).
- `useCombatActions.ts`: remove `belt_slot: null` from the durability-break update (line ~156).
- `AdminCharacterSheet.tsx`: drop the `belt_slot` filter.
- `InspectPlayerDialog.tsx`: rebuild the 6-row grid to match the new 9-slot layout, add second ring.
- `admin/users/constants.ts` `SLOT_LABELS`: same edits as the player panel.

### 5. Service panels / vendor / blacksmith

- `BlacksmithPanel.tsx` filter dropdown: remove the four slot options, add a "Ring 2" entry (or keep a single "Ring" filter that matches `slot='ring'`).
- Vendor/marketplace need no change — they just stop being filterable by removed slot labels.

### 6. Stat budget / forge

- `shared/formulas/items.ts` + `supabase/functions/_shared/formulas/items.ts`: drop the `potion_slots` stat from the budget table and the cap in `getStatCap`. Mirror in the admin `ItemManager.tsx` form (remove the potion_slots input).
- `seed-archetype-items`, `ai-item-forge`, `ai-item-rename`, `jewelcrafter-forge`, `blacksmith-forge`: remove the four slot strings from their slot-list constants so newly-forged/AI-generated items only target the surviving slots. (Existing items with those slots remain in DB until Phase 2.)

### 7. Memory updates

- Delete `mem://game/belt-potion-system` and its index entry.
- Update `mem://game/item-stat-budget` to drop `potion_slots`.
- Update `mem://features/character-panel/layout` with the new 9-slot grid.

### 8. Verification

- Build passes, no remaining references to `belt_slot`, `potion_slots`, `'amulet'|'shoulders'|'belt'|'boots'` in `src/`.
- Manually confirm: equipping/unequipping rings in both ring slots, character panel renders 9 slots, hotkeys 1–4 no longer trigger potions, admin sheet shows new layout, inspect dialog renders.

## Phase 2 (deferred — separate task)

After Phase 1 is live we'll discuss the scope of cleaning up:
- ~217 items in `items` with the dead slot values
- 22 `forge_pool` entries on dead slots
- Any `vendor_inventory` / `marketplace_listings` referencing those items
- Loot table entries gating on the dead slots
- AI prompts / archetype config that still mention those slots in prose

## Risks

- Players lose any equipped amulet/shoulders/belt/boots (per chosen "delete from inventory"). Inventory copies of those items in the bag remain and are simply unequippable until Phase 2.
- `equipped_slot` enum changes require a migration — keep the old values in the enum during Phase 1 (only adding `ring_2`) so historical references in code don't crash; the cleanup of enum values can come in Phase 2 with the items cleanup.
