

## Milestone Rewards for Levels 28-40

### Overview
Add three mechanical rewards and six title milestones to keep players motivated through the endgame grind (levels 28-40). All rewards are computed from the character's level at runtime -- no database changes needed.

### Milestone Schedule

| Level | Reward |
|-------|--------|
| 28 | **Expanded Crit Range** -- permanent +1 to crit range (e.g. 20 becomes 19-20) |
| 30 | Title: **Veteran** |
| 32 | Title: **Vanguard** |
| 34 | Title: **Champion** |
| 35 | **Passive HP Regen Boost** -- base HP regen doubled |
| 36 | Title: **Warden** |
| 38 | Title: **Paragon** |
| 39 | **CP Discount** -- all ability CP costs reduced by 10% |
| 40 | Title: **Ascendant** |

### Technical Details

**1. Titles (`src/lib/game-data.ts` + `src/components/game/CharacterPanel.tsx` + `src/components/game/NodeView.tsx`)**
- Add a `getCharacterTitle(level: number)` helper in `game-data.ts` that returns the highest earned title or `null`.
- Display the title under the character name in `CharacterPanel` (e.g., "Veteran" in a subtle style).
- Display the title next to player names in `NodeView` when other players are shown, so the title is visible to others.

**2. Expanded Crit Range at Level 28 (`src/hooks/useCombat.ts`)**
- Where `effectiveCritRange` is calculated (line ~330), subtract 1 if `char.level >= 28`.
- This stacks with the existing Eagle Eye (crit_buff) ability.

**3. Doubled HP Regen at Level 35 (`src/pages/GamePage.tsx`)**
- In the HP regen interval (around line 278), apply a x2 multiplier when `character.level >= 35`.
- Stacks multiplicatively with inn bonus and potion/inspire buffs.

**4. CP Discount at Level 39 (`src/pages/GamePage.tsx`)**
- Where `ability.cpCost` is checked and deducted (lines ~1102 and ~1438), apply `Math.ceil(cost * 0.9)` when `character.level >= 39`.
- The discount applies to all abilities including Focus Strike and teleport costs.

**5. Game Manual Update (`src/components/admin/GameManual.tsx`)**
- Add a "Milestone Rewards" section documenting all milestone levels, titles, and mechanical bonuses.

### Files to Change
- `src/lib/game-data.ts` -- add `getCharacterTitle()` helper
- `src/hooks/useCombat.ts` -- crit range bonus at level 28
- `src/pages/GamePage.tsx` -- HP regen boost at 35, CP discount at 39
- `src/components/game/CharacterPanel.tsx` -- display title under name
- `src/components/game/NodeView.tsx` -- display title next to player names
- `src/components/admin/GameManual.tsx` -- document milestones

