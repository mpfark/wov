

## Scale Item Stat Caps with Level

### The Problem
The fixed per-stat cap of 5 forces high-level items to spread their budget across many attributes. A level 20 Rare two-handed sword has a budget of 18 points but can only put 5 into STR, making it impossible to create focused, thematic gear without padding unrelated stats.

### The Solution
Make stat caps scale with the item's level, so higher-level items can concentrate more points into their core stats.

### New Formula

**Primary stats (STR, DEX, CON, INT, WIS, CHA):**

```text
cap = 3 + floor(level / 5)
```

| Level | Cap |
|-------|-----|
| 1-4   | 3   |
| 5-9   | 4   |
| 10-14 | 5   |
| 15-19 | 6   |
| 20+   | 7   |

**Secondary stats (unchanged base, scaled similarly):**

```text
AC:       cap = 2 + floor(level / 10)    (2 at L1, 3 at L10, 4 at L20)
HP:       cap = 6 + floor(level / 5) * 2 (6 at L1, 10 at L10, 14 at L20)
HP Regen: cap = 2 + floor(level / 10)    (2 at L1, 3 at L10, 4 at L20)
```

This keeps low-level items modest while letting high-level gear feel powerful and specialized.

### Files to Change

**`src/lib/game-data.ts`**
- Update `getItemStatCap` to accept a `level` parameter
- Replace the flat lookup with the scaling formulas above
- Keep `ITEM_STAT_CAPS` as a reference or remove it (no longer the source of truth)

**`src/components/admin/ItemManager.tsx`**
- Pass `form.level` to all `getItemStatCap(key, level)` calls (in `setStat` and in the input `max` attribute)
- Caps will update live as the admin changes the item's level in the editor

