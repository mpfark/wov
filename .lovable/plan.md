

## Weapon Tags & Class Affinity System

### Overview
Add a `weapon_tag` field to items (e.g. "sword", "dagger", "axe", "staff", "bow", "mace", "wand") and a class-weapon affinity mapping. When a character equips a weapon matching their class affinity, they receive **+1 hit** and **+10% damage**.

Dual wielding works as a **passive stat stick** — off-hand weapons simply contribute their stats like shields do, no extra attack.

### Database Changes

**Migration: Add `weapon_tag` column to `items` table**
```sql
ALTER TABLE public.items ADD COLUMN weapon_tag text DEFAULT NULL;
```
No new enum needed — free-text allows easy expansion. Only relevant for `main_hand`/`off_hand` slot items.

### Weapon Tags
`sword`, `axe`, `mace`, `dagger`, `bow`, `staff`, `wand`, `shield`

### Class Affinity Mapping (code constant)
```text
Warrior  → sword, axe, mace
Ranger   → bow, dagger
Rogue    → dagger, sword
Wizard   → staff, wand
Healer   → mace, staff
Bard     → sword, wand
```

### Dual Wielding
- Off-hand slot already exists and accepts equipment items
- Currently only shields go there — we allow any 1H weapon in off_hand too
- Off-hand weapons provide their stats passively (identical to how shields work now)
- No code changes needed for equip/stat logic — it already sums all equipped item stats
- The `weapon_tag` on the off-hand weapon does NOT grant affinity bonus (only main hand counts)

### Code Changes

1. **`src/lib/combat-math.ts`** + **`supabase/functions/_shared/combat-math.ts`** (mirrored)
   - Add `CLASS_WEAPON_AFFINITY` constant mapping class → allowed weapon tags
   - Add `getWeaponAffinityBonus(classKey, weaponTag)` → `{ hitBonus: number, damageMult: number }`
   - Update `AttackContext` interface to include optional `weaponTag?: string`
   - In `resolveAttackRoll`: add affinity hit bonus to `totalAtk`, apply damage multiplier to `baseDamage`

2. **`src/lib/game-data.ts`**
   - Add `CLASS_WEAPON_AFFINITY` and `WEAPON_TAG_LABELS` constants for UI display

3. **`src/components/admin/ItemManager.tsx`**
   - Add `weapon_tag` dropdown (only visible when slot is `main_hand` or `off_hand`)
   - Include `weapon_tag` in save/load queries

4. **`supabase/functions/ai-item-forge/index.ts`**
   - Include `weapon_tag` in AI prompt for weapon generation
   - Auto-assign tag based on generated item name/description

5. **`src/hooks/useInventory.ts`** — no changes needed (off-hand equip already works)

6. **`src/components/game/CharacterPanel.tsx`**
   - Show weapon affinity indicator (small badge) when main-hand weapon matches class

7. **`supabase/functions/combat-tick/index.ts`**
   - Pass `weaponTag` from equipped main-hand item into attack context

8. **`src/hooks/useActions.ts`** / **`src/pages/GamePage.tsx`**
   - Pass main-hand `weapon_tag` into attack context for solo combat

### Affinity Bonus Values
- **+1 hit bonus** (flat, stacks with INT hit bonus)
- **×1.10 damage multiplier** (10% boost, applied after base damage, before other buffs)

### Display
- Character panel shows a small "Proficient" badge next to main-hand weapon when affinity matches
- Game Manual updated to document the system

