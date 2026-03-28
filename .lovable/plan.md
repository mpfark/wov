

## Shield Defensive Bonus: +1 AC and +5% Awareness

### Problem
Shields and off-hand weapons have the same stat budget, but weapons now grant a 30% bonus attack. Shields offer zero unique benefit, making them strictly inferior.

### Solution
When a shield (`weapon_tag = 'shield'`) is equipped in the off-hand, grant two passive defensive bonuses:
- **+1 flat AC** (stacks with DEX-based AC and equipment AC)
- **+5% Awareness** (stacks with WIS-based awareness, additive)

### Code Changes

1. **`src/lib/combat-math.ts`** + **`supabase/functions/_shared/combat-math.ts`** (mirrored)
   - Add constants: `SHIELD_AC_BONUS = 1`, `SHIELD_AWARENESS_BONUS = 0.05`
   - Add helper: `isShield(tag?: string | null): boolean` — returns true if tag is `'shield'`

2. **`supabase/functions/combat-tick/index.ts`**
   - In the equipment-fetching section, already tracks `offHandTag` per member
   - In `applyCreatureHit`: when building `tAC`, add `SHIELD_AC_BONUS` if `offHandTag` is `'shield'`
   - When calculating WIS awareness chance, add `SHIELD_AWARENESS_BONUS` if shield equipped

3. **`src/components/game/CharacterPanel.tsx`**
   - Show a "🛡️ Shield" badge (similar to "Proficient") when off-hand has `weapon_tag = 'shield'`
   - Tooltip: "+1 AC, +5% Awareness"

4. **`src/components/admin/GameManual.tsx`**
   - Update the Dual Wielding section to note shield defensive bonuses
   - Add trade-off explanation: shields sacrifice the 30% bonus attack for +1 AC and +5% awareness

5. **`.lovable/plan.md`** — update plan to document shield bonuses

### Balance Rationale
The 30% off-hand attack adds roughly 2-4 DPS depending on level. A +1 AC raises the miss threshold, and +5% awareness provides consistent damage reduction — together these represent a meaningful defensive trade-off without being overpowered.

