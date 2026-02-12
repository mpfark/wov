

## Rearrange Stats Display in Character Panel

### Current State
Stats are shown as compact inline chips (e.g., `STR 14+2(+2)`). There's no breakdown of where stat values come from, no tooltip explaining what each stat does, and no visual indicator for unspent stat points.

### Planned Changes

#### 1. Replace inline stat chips with a vertical stat list

Each stat will be displayed as a row showing the breakdown:

```text
Strength    12 + 2         (+1)  [+]
            base  gear
```

- **Full stat name** (Strength, Dexterity, etc.) on the left
- **Base value** (the character's raw stat)
- **+ Gear bonus** in green (only if > 0)
- **Modifier** in parentheses on the right
- **[+] button** on the far right, only visible when `unspent_stat_points > 0`

#### 2. Tooltip on hover for each stat

Hovering a stat row shows what that stat affects:

| Stat | Tooltip |
|------|---------|
| STR | Melee attack and damage rolls |
| DEX | Ranged attack, AC bonus, initiative |
| CON | Hit points and physical resilience |
| INT | Arcane power and knowledge checks |
| WIS | Perception, healing power, willpower |
| CHA | Persuasion, bardic abilities, leadership |

#### 3. Unspent point indicator

When `unspent_stat_points > 0`, a small `[+]` button appears next to each stat (that isn't at max 30). Clicking it spends one point on that stat immediately. A header line shows remaining points (e.g., "2 points to spend").

AC and Gold remain as compact elements below the stat list.

### Technical Details

**File: `src/components/game/CharacterPanel.tsx`**
- Replace the `flex flex-wrap` stat chips section (lines 150-170) with a new vertical layout
- Add a `STAT_DESCRIPTIONS` map for tooltip content
- Add `STAT_FULL_NAMES` map (str -> "Strength", etc.)
- Use existing `Tooltip` components for hover info
- Wire `[+]` buttons to call a new `onSpendPoint` prop that updates a single stat and decrements `unspent_stat_points`

**File: `src/pages/GamePage.tsx`**
- Add a `handleSpendPoint` function that calls `updateCharacter` with the incremented stat and decremented points
- Pass it as `onSpendPoint` to `CharacterPanel`

**File: `src/components/game/StatAllocationDialog.tsx`**
- Kept as-is for the initial level-up bulk allocation; the inline `[+]` buttons provide an alternative way to spend leftover points
