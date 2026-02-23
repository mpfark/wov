

## Redesign Focus Strike Scaling

### The Problem
Focus Strike currently scales off STR, which feels thematically wrong for spell-casters and charisma-based classes. A Wizard or Bard "channeling strength" breaks immersion.

### The Solution
Change Focus Strike to scale off the **average of all six stats** (STR, DEX, CON, INT, WIS, CHA), representing a moment of total concentration where the character channels everything they have into one strike. This rewards balanced builds and feels natural for every class fantasy.

### Changes

**1. Update ability description** (`src/lib/class-abilities.ts`)
- Rename/re-describe Focus Strike from "scaling with STR" to something like:
  - Label: **"Focus Strike"**
  - Emoji: **"🎯"**
  - Description: **"Channel every ounce of your being -- your next attack deals bonus damage scaling with your overall prowess"**

**2. Update the damage formula** (`src/pages/GamePage.tsx`, around line 1423-1427)
- Replace the STR-only modifier with an average-of-all-stats modifier:
  - Current: `getStatMod2(character.str + equipmentBonuses.str)`
  - New: calculate the average of all six stats (including equipment bonuses), then apply `getStatMod2` to that average
  - The rest of the formula stays the same: `max(3, floor(avgMod * 2) + floor(level / 2))`

**3. Update the Game Manual** (`src/components/admin/GameManual.tsx`)
- Update any reference to Focus Strike scaling with STR to reflect the new "average of all stats" scaling.

### Technical Detail

```
// New formula (GamePage.tsx)
const totalStats = (character.str + (equipmentBonuses.str || 0))
                 + (character.dex + (equipmentBonuses.dex || 0))
                 + (character.con + (equipmentBonuses.con || 0))
                 + (character.int + (equipmentBonuses.int || 0))
                 + (character.wis + (equipmentBonuses.wis || 0))
                 + (character.cha + (equipmentBonuses.cha || 0));
const avgStat = Math.floor(totalStats / 6);
const avgMod = getStatMod2(avgStat);
const bonusDmg = Math.max(3, Math.floor(avgMod * 2) + Math.floor(character.level / 2));
```

### Files to Change
- `src/lib/class-abilities.ts` -- update description text
- `src/pages/GamePage.tsx` -- update damage calculation (~line 1423-1427)
- `src/components/admin/GameManual.tsx` -- update manual text referencing Focus Strike

