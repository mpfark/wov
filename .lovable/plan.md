

## Simplify Durability System

### New Rules
- **Every combat round**, 2 random equipped items (any rarity — common, uncommon, rare, unique) each lose 1 durability
- All items have a fixed max durability of **100**
- Durability displayed as a percentage (e.g. `87%`)
- When an item hits 0 durability:
  - Common/Uncommon: unequipped, repairable at the Blacksmith
  - Rare/Unique: destroyed permanently

### Files to Change (13 files)

**1. `src/pages/GamePage.tsx`** — Rewrite `degradeEquipment`
- Remove the 25% chance gate
- Pick 2 random equipped items from ALL equipped items (any rarity)
- Each loses 1 durability
- Keep existing 0-durability behavior (destroy or unequip)

**2. `src/lib/game-data.ts`** — Hardcode max to 100 in `calculateRepairCost`

**3. `src/components/game/CharacterPanel.tsx`** — Show `{durability}%` instead of `current/max`

**4. `src/components/game/BlacksmithPanel.tsx`** — Use 100 as max for display and cost calc

**5. `src/components/admin/GameManual.tsx`** — Update rules text to reflect new system

**6. `src/components/admin/ItemForgePanel.tsx`** — Hardcode max_durability to 100

**7. `supabase/functions/ai-item-forge/index.ts`** — Remove variable durability from AI prompt, hardcode 100

**8. `supabase/functions/ai-world-builder/index.ts`** — Hardcode max_durability to 100

**9. `src/components/admin/ItemManager.tsx`** — Remove/disable max_durability field

**10. `src/pages/CharacterCreation.tsx`** — Set current_durability to 100 directly

**11. `src/hooks/useGroundLoot.ts`** — Set current_durability to 100 on pickup

**12. `supabase/functions/admin-users/index.ts`** — Hardcode durability to 100 on admin item grants

**13. `src/components/admin/UserManager.tsx`** — Show durability as percentage

### No database migration needed
The `items.max_durability` column stays but is ignored in code — always treated as 100.

