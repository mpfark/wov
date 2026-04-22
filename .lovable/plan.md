

## Fix: HP/CP/MP Regen and Healing Capped at Base Max (Ignoring Gear Bonuses)

### Problem

The status bars now correctly display effective maximums (base + gear bonuses), but all regen and healing logic still caps at `character.max_hp` / base CP / base MP from the database. This means:

- HP regeneration stops at 233 (base) even though the bar shows 254 (with gear)
- Healing abilities (Heal, Second Wind) cap at `character.max_hp`, so the game says "already at full health" at 233/254
- CP and MP regen have similar issues with gear-adjusted stats

### Root Cause

Equipment bonuses to CON add effective HP (via `floor(con_bonus / 2)`) and flat `hp` bonuses increase the effective max, but the regen interval and ability handlers use `character.max_hp` as the ceiling. The `equipmentBonuses` object is already available in both `useGameLoop` and `useCombatActions` but is not used for the caps.

### Fix

Compute an `effectiveMaxHp` in every location that caps HP, using the same formula the status bars use:

```
effectiveMaxHp = max_hp + (equipmentBonuses.hp || 0) + floor((equipmentBonuses.con || 0) / 2)
```

Similarly for CP and MP, use gear-adjusted stats when computing the cap.

### Changes

**`src/features/combat/hooks/useGameLoop.ts`**

1. **HP regen cap** (line 126, 134): Replace `max_hp` with `effectiveMaxHp` computed from `equipmentBonusesRef.current`
2. **CP regen cap** (line 146, 153): Use `getMaxCp` with gear-adjusted INT/WIS/CHA instead of base stats
3. **MP regen cap** (line 160-161, 165): Use `getMaxMp` with gear-adjusted DEX
4. **Party heal cap** (line 223): Replace `charState.max_hp` with effective max HP
5. **Update regenCharRef** to not need `max_hp` since effective max is computed dynamically

**`src/features/combat/hooks/useCombatActions.ts`**

1. **Heal ability** (line 571): Replace `p.character.max_hp` with effective max HP using `p.equipmentBonuses`
2. **Second Wind ability** (line 578): Same replacement

### Files

| File | Action |
|------|--------|
| `src/features/combat/hooks/useGameLoop.ts` | Use effective max HP/CP/MP (with gear bonuses) for all regen caps |
| `src/features/combat/hooks/useCombatActions.ts` | Use effective max HP for heal and self-heal ability caps |

