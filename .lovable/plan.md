
## Boss Rarity Multiplier Buff

### What's Changing

One file, three constants updated in `src/lib/game-data.ts`.

**`RARITY_MULTIPLIER` (lines 209-213)**
| Stat | Before | After |
|------|--------|-------|
| HP multiplier | 2.5x | 4.0x |
| Stat multiplier | 1.6x | 2.0x |
| AC bonus | +4 | +6 |

**`CREATURE_DAMAGE_BASE` (line 217)**
| Rarity | Before | After |
|--------|--------|-------|
| boss base die | d8 | d10 |

### What a Level 40 Boss Looks Like (before vs after)

Using `generateCreatureStats(40, 'boss')`:

- **HP**: `(15 + 40*8) * mult` → 335 × 2.5 = **838 HP** → 335 × 4.0 = **1,340 HP**
- **Primary stat (STR)**: `(8 + 28) * mult` → 36 × 1.6 = **~58** → 36 × 2.0 = **~72**
- **AC**: `8 + floor(40*0.6) + ac_bonus` → 8 + 24 + 4 = **36** → 8 + 24 + 6 = **38**
- **Base damage die**: d8 + floor(40/2) = **d28** → d10 + 20 = **d30** (slightly higher ceiling + floor)

### Rare stays untouched

`rare: { stat: 1.3, hp: 1.5, ac: 2 }` and `rare: 6` damage base are unchanged. Only `boss` entries are modified.

### Files to Edit

- `src/lib/game-data.ts` — 2 constants modified (3 values total):
  - `RARITY_MULTIPLIER.boss`: `{ stat: 2.0, hp: 4.0, ac: 6 }`
  - `CREATURE_DAMAGE_BASE.boss`: `10`

No database changes, no migrations, no UI changes required. The functions `generateCreatureStats` and `getCreatureDamageDie` already consume these constants correctly, so the runtime behaviour updates immediately for any creature with `rarity = 'boss'`.
