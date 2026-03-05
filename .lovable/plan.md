

## Cross-Stat Incentive System

The current system has a clear problem: mental classes (Wizard, Healer, Bard) have almost no reason to invest in STR or DEX beyond baseline, and physical classes (Warrior, Ranger, Rogue) have little reason to invest in INT/WIS/CHA beyond CP pool.

### Current Cross-Stat Value

| Stat | Currently Useful For |
|------|---------------------|
| STR | Attack (Warrior only), carry capacity |
| DEX | AC (all), MP (all), attack (Ranger/Rogue) |
| CON | HP, HP regen (all) |
| INT | CP pool (highest mental), search (Wizard only) |
| WIS | CP pool (highest mental), search (non-Wizard) |
| CHA | CP pool (highest mental) |

DEX and CON are already universally attractive. The real gaps are: **STR for casters** and **INT/WIS/CHA for physical classes**.

### Proposed Additions

These are small, meaningful bonuses that create interesting choices without being mandatory:

#### For Physical Classes to Want Mental Stats

1. **INT → Critical Hit Chance**: Every 2 points of INT modifier adds +1 to crit range (e.g., INT 14 = modifier +2, crit range improved by 1). Flavor: *"A keen mind spots weaknesses."* This is distinct from DEX-based abilities and gives Warriors/Rangers/Rogues a reason to invest in INT.

2. **WIS → Search Bonus**: WIS modifier already applies to search for non-Wizards, but we could also add a **dodge/damage reduction from creature attacks**: WIS modifier reduces incoming damage by a flat amount (min 0). Flavor: *"Awareness helps you read enemy attacks."* This makes WIS attractive for survivability beyond just CP.

3. **CHA → Better Vendor Prices**: CHA modifier improves sell prices and reduces buy prices. Sell multiplier becomes `0.5 + CHA_mod * 0.03` (capped at 0.8). Buy discount = `CHA_mod * 2%` off. Flavor: *"A silver tongue fetches better deals."* Also add **CHA → bonus gold from humanoid kills**: existing `calculateHumanoidGold` gets a CHA multiplier.

#### For Casters to Want STR

4. **STR → Focus Strike Damage**: Focus Strike already uses average of all stats, but we can add a **STR-specific melee damage floor**: all classes get `+floor(STR_mod / 2)` minimum damage on attacks (even spell attacks). Flavor: *"Raw physical power adds force to any strike."* This is small but consistent.

Alternatively, a simpler approach: **STR → bonus HP** (a flat +1 HP per STR modifier point, stacking with CON). This makes STR a secondary survivability stat.

### Recommended Approach

I'd suggest presenting options to you since this is a significant game balance decision.

### Files to Change

- `src/lib/game-data.ts` — Add helper functions for CHA vendor bonus, INT crit bonus
- `src/hooks/useCombat.ts` — Apply INT crit range bonus and WIS damage reduction
- `src/components/game/VendorPanel.tsx` — Apply CHA price modifiers
- `src/hooks/useActions.ts` — Apply CHA gold bonus to humanoid kills, STR damage floor
- `src/components/game/CharacterPanel.tsx` — Display new derived bonuses in attributes
- `src/components/admin/GameManual.tsx` — Document the new cross-stat bonuses

