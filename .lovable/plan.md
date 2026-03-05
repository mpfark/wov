

## Cross-Stat Incentive System ✅ IMPLEMENTED

All four cross-stat bonuses are now live:

### Implemented Bonuses

1. **INT → Critical Hit Chance** ✅: Every 2 points of INT modifier improves crit range by 1. Formula: `+floor(INT_mod / 2)`. INT 14 = crit 19-20.

2. **WIS → Damage Reduction** ✅: WIS modifier reduces incoming creature damage by a flat amount (min 1 damage). Formula: `-WIS_mod damage taken`.

3. **CHA → Better Vendor Prices & Humanoid Gold** ✅: Sell multiplier = `0.5 + CHA_mod × 0.03` (capped at 0.8). Buy discount = `CHA_mod × 2%`. Humanoid gold bonus = `+5% per CHA modifier`.

4. **STR → Minimum Damage Floor** ✅: All attacks (including spells) deal at least `1 + floor(STR_mod / 2)` damage. Small but consistent bonus.

### Files Changed

- `src/lib/game-data.ts` — Added helper functions: `getIntCritBonus`, `getWisDamageReduction`, `getChaSellMultiplier`, `getChaBuyDiscount`, `getChaGoldMultiplier`, `getStrDamageFloor`
- `src/hooks/useCombat.ts` — Applied INT crit range, STR damage floor, WIS damage reduction, CHA humanoid gold bonus
- `src/hooks/useActions.ts` — Applied CHA humanoid gold bonus in `awardKillRewards`
- `src/components/game/VendorPanel.tsx` — CHA-based buy/sell price modifiers with UI indicators
- `src/components/game/CharacterPanel.tsx` — Shows cross-stat bonuses in Attributes tab (Crit Range, Min Damage, Dmg Reduction, Vendor Bonus)
- `src/components/admin/GameManual.tsx` — Documented all new cross-stat bonuses in Attribute Effects and Combat sections
- `src/pages/GamePage.tsx` — Passes `cha` and `equipmentBonuses` to VendorPanel
