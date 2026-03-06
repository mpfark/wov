

## Cross-Stat & Combat System ✅ IMPLEMENTED

### Cross-Stat Bonuses (Diminishing Returns via sqrt curves)

1. **INT → Hit Bonus**: `+floor(sqrt(INT_mod))`, capped at +3. Improves attack rolls.
2. **DEX → Critical Hit Chance**: `+floor(sqrt(DEX_mod))`, capped at +4. Crit on 16-20 max.
3. **WIS → Awareness (Damage Reduction Chance)**: `sqrt(WIS_mod) × 3%`, capped at 15%. Chance to reduce incoming damage by 25%.
4. **CHA → Better Vendor Prices & Humanoid Gold**: Sell multiplier = `0.5 + sqrt(CHA_mod) × 0.03` (cap 0.8). Buy discount = `sqrt(CHA_mod) × 2%` (cap 10%). Humanoid gold = `+sqrt(CHA_mod) × 5%` (cap 25%).
5. **STR → Minimum Damage Floor**: `+floor(sqrt(STR_mod))`, capped at +3. All attacks deal at least this much.

### Attack Speed

- Formula: `max(3.0 − DEX_mod × 0.25, 1.0)` seconds per attack
- Base interval: 3.0s, minimum: 1.0s
- Displayed in Character Panel → Attributes → Offense section

### Character Panel Display

- All cross-stat bonus rows always visible; shows "–" when modifier too low
- Tooltips explain unlock thresholds (e.g. "STR 14+", "WIS 12+", "CHA 12+")

### Files Changed

- `src/lib/game-data.ts` — Helper functions: `getIntHitBonus`, `getDexCritBonus`, `getWisDodgeChance`, `getChaSellMultiplier`, `getChaBuyDiscount`, `getChaGoldMultiplier`, `getStrDamageFloor`
- `src/hooks/useCombat.ts` — Applied INT hit bonus, DEX crit range, STR damage floor, WIS awareness, CHA humanoid gold bonus, DEX attack speed
- `src/hooks/useActions.ts` — CHA humanoid gold bonus in `awardKillRewards`
- `src/components/game/VendorPanel.tsx` — CHA-based buy/sell price modifiers with UI indicators
- `src/components/game/CharacterPanel.tsx` — Shows all cross-stat bonuses in Attributes tab (always visible, "–" when inactive), attack speed display
- `src/components/admin/GameManual.tsx` — Documented all cross-stat bonuses and attack speed formula
