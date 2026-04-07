

# Update AI Rulebook & Populate Panel

## Problem

The AI Rulebook displays **outdated creature stat formulas** that don't match the actual `generateCreatureStats()` in `game-data.ts`. The Populate Panel's apply logic is correct (it calls `generateCreatureStats` directly), but the preview cards show the AI's raw values instead of the recalculated ones. The rulebook also lacks Item Forge documentation reflecting the recent batch/single mode changes.

## Specific Rulebook Formula Errors

| Field | Rulebook (wrong) | Actual (`game-data.ts`) |
|-------|-------------------|------------------------|
| Base stat | `round(10 + level × 0.7)` | `8 + floor(level × 0.7)` |
| Stats | "each" (all same) | str=base, dex=base-1, con=base+1, int=base-2, wis=base-1, cha=base-3 |
| Stat mult boss | ×2.0 | ×2.5 |
| HP mult boss | ×4.0 | ×6.0 |
| AC formula | `10 + level × 0.6 + bonus` | `10 + level × 0.575 + bonus` |
| Examples | Lv10 boss: stats=34, HP=380 | Lv10 boss: stats=38, HP=570, AC=22 |

The edge function prompt (lines 238-244) already has the **correct** formulas — only the Rulebook UI component is wrong.

## Changes

### 1. Fix Creature Stats section in `WorldBuilderRulebook.tsx`

- Update base stat formula to `8 + floor(level × 0.7)`
- Add per-attribute offsets: STR=base, DEX=base-1, CON=base+1, INT=base-2, WIS=base-1, CHA=base-3
- Fix rarity multipliers: stat mult regular=1.0, rare=1.3, boss=2.5
- Fix HP multipliers: regular=1.0, rare=1.5, boss=6.0
- Fix AC formula: `round(10 + level × 0.575 + bonus)`, bonuses: regular=+2, rare=+2, boss=+6
- Fix examples to match actual formulas:
  - Lv5 regular: base=11, str=11, HP=55, AC=15
  - Lv10 boss: base=15, str=38, HP=570, AC=22
- Add creature damage die info: `base + floor(level × 0.7)`, bases: regular=4, rare=6, boss=10

### 2. Add Item Forge section to `WorldBuilderRulebook.tsx`

- Document the two modes: **Batch** (multiple items saved as world drops) and **Single** (one item)
- Note weapon tag support and stat budget formula
- Note duplicate name filtering on save
- Note that items are created separately from creature/loot generation

### 3. Update Loot Table Assignment section

- Update to reflect current loot system: dual-mode (`legacy_table` for bosses, `item_pool` for humanoids)
- Note that humanoid creatures default to `item_pool` loot mode, non-humanoids to `salvage_only`

### 4. Fix Populate Panel preview to show recalculated stats — `PopulatePanel.tsx`

- In the creature preview cards (line ~246), show the `generateCreatureStats()` HP instead of the AI's raw `cr.hp`, so the admin sees the actual values that will be applied

## Files Modified

| File | Change |
|------|--------|
| `src/components/admin/WorldBuilderRulebook.tsx` | Fix creature formulas, add Item Forge section, update loot section |
| `src/components/admin/PopulatePanel.tsx` | Show recalculated HP in preview cards |

