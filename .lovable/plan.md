

## Audit: Bundle Inline Calculations Into Shared Helpers

### Findings

Five categories of inline calculations that should use centralized helpers to prevent drift:

#### 1. AC Calculation (3 inconsistent versions)
- **GamePage** (line 473): `calculateAC(class, effectiveDex) + equipmentBonuses.ac` — no shield bonus
- **CharacterPanel** (line 941): `calculateAC(class, eDex) + equipmentBonuses.ac + SHIELD_AC_BONUS` — includes shield
- **StatPlannerDialog** (line 81): `calculateAC(class, eDex) + equipmentBonuses.ac` — no shield bonus
- **AdminCharacterSheet** (line 41): `c.ac + equipmentBonuses.ac` — uses DB field, different formula entirely

**Fix**: Create `getEffectiveAC(charClass, baseDex, equipmentBonuses, hasShield)` in `game-data.ts`.

#### 2. Opportunity Attack AC Ignores Gear (Bug)
- **useMovementActions.ts** (line 103): Party members' AC during opportunity attacks uses `calculateAC(class, dex)` with **raw database dex**, ignoring all gear bonuses. A party member with +5 DEX from gear gets hit more often than they should during fleeing.

**Fix**: The `resolveOpportunityAttacks` function already receives `effectiveAC` for the fleeing player but party member AC is computed inline without gear. This needs the new `getEffectiveAC` helper or at minimum should factor in gear.

#### 3. CP/MP Max Inline Instead of Using Helpers
- **CharacterPanel** (line 916-917): Uses `getMaxCp(level, eInt, eWis, eCha)` and `getMaxMp(level, eDex)` with manually gear-adjusted stats instead of `getEffectiveMaxCp` / `getEffectiveMaxMp`.
- **StatPlannerDialog** (line 82-83): Same pattern.

**Fix**: Replace with `getEffectiveMaxCp(level, int, wis, cha, equipmentBonuses)` and `getEffectiveMaxMp(level, dex, equipmentBonuses)`.

#### 4. Regen Computation in useGameLoop Duplicates Gear Addition
- **useGameLoop** (lines 130-131, 149-150, 164): Manually computes `con + equipped.reduce(...)` instead of using `equipmentBonusesRef.current` which is already available. This is fragile — if the bonus aggregation logic changes, these spots would drift.

**Fix**: Use `equipmentBonusesRef.current.con`, `.int`, `.dex` consistently (some lines already do, others use manual reduce).

#### 5. HP Regen Formula (potential drift)
- HP regen in `useGameLoop` adds `itemHpRegen` computed at line 109, but the regen tick at line 132 recomputes it from `equippedRef` again. Two separate computations of the same value.

**Fix**: Use the already-computed `itemHpRegenRef` inside the tick callback.

### Changes

| File | Action |
|------|--------|
| `src/lib/game-data.ts` | Add `getEffectiveAC(charClass, baseDex, equipmentBonuses, hasShield)` helper |
| `src/pages/GamePage.tsx` | Replace inline AC calculation with `getEffectiveAC` |
| `src/features/character/components/CharacterPanel.tsx` | Replace inline AC, CP max, MP max with shared helpers |
| `src/features/character/components/StatPlannerDialog.tsx` | Replace inline AC, CP max, MP max with shared helpers |
| `src/features/combat/hooks/useGameLoop.ts` | Use `equipmentBonusesRef` consistently instead of manual `reduce`; use pre-computed `itemHpRegen` |
| `src/features/world/hooks/useMovementActions.ts` | **Bug fix**: Use gear-aware AC for party member opportunity attacks |

