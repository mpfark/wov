

# Item Database Audit & Gap-Fill Plan

## Audit Findings

### 1. Duplicate Names (6 items)
| Name | Issue |
|------|-------|
| `Iron Longsword` (lvl 3) | Missing `weapon_tag` (null), should be `sword` |
| `Iron Longsword` x3 | Three items with same name at lvl 3/5/8 — rename two |
| `Studded Leather Vest` x2 | Same name at lvl 10 and 30 — rename one |
| `Worn Leather Boots` x2 | Same name at lvl 1 and 3 — rename one |
| `Crown` x2 | Two soulforged crowns, likely player-created — leave as-is |
| `Iron Kite Shield` x2 | Same name at lvl 14 and 31 — rename one |
| `Starlight Greatsword` x2 | Same name at lvl 14 and 20 — rename one |

### 2. Thematic Name/Stat Mismatches
| Item | Issue |
|------|-------|
| `Shoulderplates of the Ironclad` (lvl 17) | Name implies STR/CON tank, stats are CHA/INT/WIS |
| `Silver Ring of the Swift` (lvl 11) | "Swift" implies DEX, has no DEX |
| `Iron Kite Shield` (lvl 14) | "Iron" shield has DEX/INT/WIS, no STR/CON/AC |
| `Simple Iron Ring` (lvl 1) | "Iron" implies physical, only has INT |
| `Spiked Armbands` (lvl 30) | Name sounds like gloves/bracers, slotted as shoulders |

### 3. Missing `weapon_tag`
- `Iron Longsword` (id: `f8fdb81b`) at lvl 3 has `weapon_tag: null` — should be `sword`

### 4. Coverage Gaps (Slot × Rarity × Level Tier)

**Severely underserved slots** (fewer than 2 items per rarity per tier):

| Slot | Rarity | Missing Tiers |
|------|--------|---------------|
| **shoulders** | uncommon | 1-10, 21-30, 31-42 (only 1 uncommon total!) |
| **belt** | common | 11-20, 31-42 |
| **belt** | uncommon | 1-10, 11-20, 21-30 (only 1 uncommon at lvl 42!) |
| **chest** | uncommon | 1-10 |
| **gloves** | common | 11-20, 31-42 |
| **gloves** | uncommon | 1-10, 21-30 |
| **pants** | uncommon | 1-10 (only 1 at lvl 7) |
| **trinket** | common | 21-30, 31-42 (max common is lvl 24) |
| **off_hand** | uncommon | sparse across all tiers |

**Weapon tags with thin coverage** (1 item per rarity per tier):
- bow, dagger, staff, wand — all have only 1 item per tier in mid/high levels

### 5. Items with Questionable Gold Values
Not audited in detail, but the AI forge auto-calculates values so these should be consistent.

---

## Plan: Fix Issues & Fill Gaps

### Phase 1: Fix Data Issues (DB updates only, no code changes)

1. **Fix null weapon_tag**: Update the lvl-3 Iron Longsword to `weapon_tag: 'sword'`
2. **Rename duplicates** to unique names:
   - Iron Longsword (lvl 3) → "Rusty Iron Blade"
   - Iron Longsword (lvl 8) → "Heavy Iron Longsword"
   - Studded Leather Vest (lvl 30) → "Reinforced Leather Vest"
   - Worn Leather Boots (lvl 3) → "Scuffed Leather Boots"
   - Iron Kite Shield (lvl 31) → "Battered Kite Shield"
   - Starlight Greatsword (lvl 20) → "Starlight Claymore"
3. **Fix thematic mismatches** — adjust stats to match names (keeping same budget):
   - "Shoulderplates of the Ironclad": swap to CON/STR focus
   - "Silver Ring of the Swift": add DEX, reduce WIS
   - Iron Kite Shield (lvl 14): add CON or AC, reduce INT

### Phase 2: Fill Coverage Gaps (~25-30 new items)

Use the AI Item Forge or direct inserts to create items for the biggest gaps:

**Shoulders uncommon** (3 items needed): levels ~8, ~25, ~35
**Belt common** (2 items): levels ~15, ~35
**Belt uncommon** (3 items): levels ~8, ~18, ~28
**Chest uncommon** (1 item): level ~8
**Gloves common** (2 items): levels ~15, ~35
**Gloves uncommon** (1 item): level ~25
**Pants uncommon** (1 item): level ~5
**Trinket common** (2 items): levels ~28, ~35
**Off_hand uncommon** (2 items): levels ~20, ~30
**Bow/dagger/staff/wand uncommon** (4 items): mid-high tier fill

All new items will follow the stat budget formula: `floor(1 + (level-1) * 0.3 * rarity_mult * hands_mult)`, use thematically appropriate names, and have `world_drop: true`.

### Phase 3: Summary

Total changes:
- ~6 name renames (DB updates)
- 1 weapon_tag fix
- ~3 stat adjustments for name/stat mismatches
- ~25 new items inserted to fill coverage gaps

No code changes. No schema changes. All done via DB operations.

