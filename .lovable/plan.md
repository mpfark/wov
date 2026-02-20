
# Admin Game Manual

## Overview
Add a new "Manual" tab to the Admin page with a comprehensive, expandable game mechanics reference. It pulls constants directly from game-data.ts and class-abilities.ts so it stays in sync with balance changes. A live player distribution is fetched from the database.

## Sections

### 1. Level Progression Table (Levels 1--40)
- Columns: Level | XP Required | Total XP | Stat Gains | Class Bonus | Players at Level
- XP per level = level * 100
- All stats +1 per level up to level 29; levels 30+ get class bonuses only (every 3 levels)
- Player count column fetched live from the database

### 2. Character Stats and Creation
- Base stats (8 across the board)
- Race modifier table (all 6 races)
- Class modifier table (all 6 classes)
- Expandable: example starting stats for each race/class combination

### 3. HP, AC, and Regeneration
- Max HP = Base Class HP + floor((CON-10)/2) + (level-1) * 5
- AC = Base Class AC + floor((DEX-10)/2)
- Passive HP Regen (every 15s) = 1 + floor((CON-10)/4) + gear bonuses
- Base HP/AC tables per class

### 4. Combat
- Attack roll: d20 + stat modifier vs target AC
- Damage: class dice + stat modifier
- Creature counterattack: d20 + STR mod vs player AC
- Creature damage: 1d(base_die + level/2) + STR mod
- Party combat: tank absorbs all hits, single counterattack per round
- Opportunity attacks on flee (all party members)
- 25% durability degradation chance per hit taken
- XP penalty: 20% reduction per level above the creature (minimum 10% reward)

### 5. Class Abilities
- Full table per class: ability name, tier, level requirement, cooldown, description
- Expandable per class

### 6. Creature Scaling
- Base stat: 8 + floor(level * 0.7), multiplied by rarity
- HP: (15 + level * 8) * rarity HP multiplier
- AC: 8 + floor(level * 0.6) + rarity AC bonus
- Damage die: rarity_base + floor(level/2)
- Rarity multiplier reference table (Regular / Rare / Boss)
- Humanoid gold drops: min = level * mult, max = level * 3 * mult

### 7. Items and Economy
- Stat budget: floor(1 + (level-1) * 0.3 * rarity_mult * hands_mult)
- Stat costs and caps tables
- Repair costs: ceil((max_dur - cur_dur) * value * rarity_mult / 100)
- Rare/unique unrepairable; unique destroyed at 0 durability
- Gold value suggestion: round(level * 2.5 * rarity^2)

### 8. Death and Respawn
- 3s incapacitation, respawn at starting node with 1 HP
- 10% gold penalty on death

---

## Technical Details

### New file: src/components/admin/GameManual.tsx
- Single component using Accordion (from radix) for expandable sections
- Imports constants from game-data.ts and class-abilities.ts directly (no hardcoding)
- On mount, queries: `SELECT level, count(*) FROM characters GROUP BY level ORDER BY level`
- Generates the level 1--40 progression table programmatically
- Styled with existing parchment/fantasy theme (font-display, muted-foreground, card backgrounds)
- Tables use the existing Table/TableHeader/TableRow/TableCell components

### Modified file: src/pages/AdminPage.tsx
- Add a "Manual" tab (with a book icon) to the TabsList
- Add corresponding TabsContent rendering the GameManual component
