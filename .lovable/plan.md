

# Generate Weapon Items for Blacksmith Forge

## Summary

Create a batch of ~80-100 weapon items across all weapon tags and level ranges (1-42) to populate the blacksmith forge with meaningful choices for players.

## Current Coverage Gaps

Existing weapons are sparse — many level ranges and weapon tags have zero options:
- **axe**: only at levels 5 and 42
- **mace**: only at levels 28, 39, 41
- **dagger**: only at levels 1, 6, 19
- **bow**: only at levels 1, 3, 5, 8
- **staff**: only at levels 1, 20, 34
- **wand**: only at levels 2, 4, 6, 7
- **sword**: reasonable spread but gaps in mid-levels
- **shield**: decent but gaps above level 31

The blacksmith forge searches level ±2 (±5 fallback), so items need to be distributed roughly every 3-5 levels per tag.

## Approach

Write a Python script that generates INSERT SQL for weapons following the game's stat budget formula:

```
budget = floor(1 + (level - 1) * 0.3 * rarity_mult * hands_mult)
value  = floor(level * 2.5 * rarity_mult^2)
```

### Weapon Distribution

For each weapon tag, generate items at approximately these level tiers: **1, 5, 10, 15, 20, 25, 30, 35, 40**. Mix of common and uncommon rarity.

| Tag | Slot | Hands | Class Affinity |
|-----|------|-------|----------------|
| sword | main_hand | 1H + 2H variants | warrior, rogue, bard |
| axe | main_hand | 1H + 2H variants | warrior |
| mace | main_hand | 1H + 2H variants | warrior, healer |
| dagger | main_hand | 1H only | ranger, rogue |
| bow | main_hand | 2H only | ranger |
| staff | main_hand | 2H only | wizard, healer |
| wand | main_hand | 1H only | wizard, bard |
| shield | off_hand | 1H only | any |

### Stat allocation

- Stats will favor the primary stats of affinity classes (e.g., swords lean STR/DEX, staves lean INT/WIS)
- Stats will stay within budget and respect per-stat caps: `4 + floor(level/4)` for primary stats
- Each item gets 2-4 stats to feel varied
- Names will be thematic fantasy weapon names (no Unicode)

## Implementation

1. Write a Python script to generate all items with proper budget-compliant stats
2. Output as SQL INSERT statements
3. Execute via the database insert tool
4. No code changes needed — items go straight into the `items` table

## What Does NOT Change

- No schema changes
- No code changes
- No edge function changes
- Existing items remain untouched

