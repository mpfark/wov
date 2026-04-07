

# Refactor Battle Cry: AC Bonus → Damage Reduction

## Summary

Replace Battle Cry's AC bonus with a damage reduction (DR) buff. Add shield synergy (+5% DR with shield equipped) and crit damage reduction (+15% extra reduction on crits). This fixes the "crit-only" hit pattern against warriors with high AC.

## Changes

### 1. New Buff Type — Replace `AcBuff` with `BattleCryBuff`

**`src/features/combat/hooks/useGameLoop.ts`**
- Replace `AcBuff` interface with: `BattleCryBuff { damageReduction: number; critReduction: number; expiresAt: number }`
- `damageReduction` = 0.15 base (or 0.20 with shield)
- `critReduction` = 0.15 extra on crits

**`src/features/combat/hooks/useBuffState.ts`**
- Rename `acBuff`/`setAcBuff` → `battleCryBuff`/`setBattleCryBuff` with the new type
- Update `gatherBuffs()`: send `battle_cry_dr: { reduction, crit_reduction }` instead of `ac_buff`
- Remove `ac_buff` from gathered buffs

### 2. Client Ability Activation

**`src/features/combat/hooks/useCombatActions.ts`** (lines 618-623)
- Detect shield: `const hasShield = p.equipped.some(e => e.item?.weapon_tag === 'shield')`
- Base DR = 0.15, shield bonus = 0.05, total = hasShield ? 0.20 : 0.15
- Crit reduction = 0.15
- Set `battleCryBuff` with `{ damageReduction, critReduction, expiresAt }`
- Update log: `"📯 Battle Cry! 15% damage reduction (20% with shield) for Xs."`
- Duration formula stays the same (DEX-based)

### 3. Server-Side Damage Pipeline

**`supabase/functions/combat-tick/index.ts`** (applyCreatureHit, ~line 501-566)
- Remove `acBuffBonus` from AC calculation (line 503, 506)
- After AC overflow / awareness / absorb steps, before final clamp, insert:
```
if (mb.battle_cry_dr) {
  let dr = mb.battle_cry_dr.reduction || 0;
  if (isCrit) dr += mb.battle_cry_dr.crit_reduction || 0;
  const preDmg = dmg;
  dmg = Math.max(Math.floor(dmg * (1 - dr)), 1);
  events.push({ type: 'battle_cry_dr', message: `📯 ${targetName}'s war cry reduces damage! (${preDmg} → ${dmg})` });
}
```
- Pipeline becomes: base → quality → crit → level-gap → AC overflow → awareness → absorb → **Battle Cry DR** → clamp → caps

### 4. UI Updates

**`src/features/character/components/CharacterPanel.tsx`**
- Rename `acBuff` prop → `battleCryBuff`
- ActiveBuffs display: change from "AC +X" to "DR 15%" (or "DR 20% 🛡️")
- Defense stats section: remove AC buff line from totalAC calculation; add "Dmg Reduction" row showing active DR %

**`src/features/world/components/MapPanel.tsx`**
- Rename `acBuff`/`acBuffBonus` → `battleCry`/`battleCryDr` in ActiveBuffs interface

**`src/pages/GamePage.tsx`**
- Replace all `acBuff` references with `battleCryBuff`
- Remove `acBuffBonus` from effectiveAC calculation (line 467)

### 5. Party Combat

**`src/features/combat/hooks/usePartyCombat.ts`**
- Replace `ac_buff` in buff broadcast type with `battle_cry_dr`

### 6. Ability Description + Manual

**`src/features/combat/utils/class-abilities.ts`**
- Update Battle Cry description: `"Let out a war cry that reduces incoming damage by 15% (20% with shield). Crits reduced further."`

**`src/components/admin/GameManual.tsx`**
- Update Battle Cry entry to document DR mechanics, shield synergy, and crit reduction

### 7. Export Updates

**`src/features/combat/index.ts`**
- Export `BattleCryBuff` instead of `AcBuff`

## Damage Pipeline (Updated)

```text
base damage
→ hit quality multiplier
→ crit multiplier (1.5x)
→ level-gap multiplier
→ AC overflow (crit-only, when roll < AC)
→ WIS awareness (25% reduction chance)
→ absorb shield (flat HP soak)
→ Battle Cry DR (15% / 20% with shield, +15% on crits)
→ clamp (min 1)
→ glancing/weak caps
→ final HP subtraction
```

## Files Modified

| File | Change |
|------|--------|
| `src/features/combat/hooks/useGameLoop.ts` | Replace `AcBuff` with `BattleCryBuff` |
| `src/features/combat/hooks/useBuffState.ts` | Rename state + update gatherBuffs |
| `src/features/combat/hooks/useCombatActions.ts` | Shield detection, DR activation logic |
| `src/features/combat/hooks/usePartyCombat.ts` | Replace `ac_buff` in type |
| `src/features/combat/index.ts` | Export rename |
| `src/features/combat/utils/class-abilities.ts` | Update description |
| `supabase/functions/combat-tick/index.ts` | Remove AC buff, add DR step in pipeline |
| `src/pages/GamePage.tsx` | Replace acBuff with battleCryBuff |
| `src/features/character/components/CharacterPanel.tsx` | Update props, display, defense stats |
| `src/features/world/components/MapPanel.tsx` | Update ActiveBuffs interface |
| `src/components/admin/GameManual.tsx` | Document new mechanics |

## What Does NOT Change

- Hit resolution, AC calculation (base AC unaffected)
- Crit system, DEX crit bonuses
- Other abilities
- CP costs, duration formula
- Tick rate, server authority
- Party system

