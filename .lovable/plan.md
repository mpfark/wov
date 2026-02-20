

# Concentration Points (CP) System

## Overview

Replace time-based cooldowns with a resource system called **Concentration Points (CP)**. Each ability costs CP to use. CP regenerates over time and is persisted in the database, so refreshing the page won't reset your resource pool.

## How It Works

- Every character has a **CP** and **max_cp** value stored in the database.
- Using an ability deducts its CP cost. If you don't have enough CP, the ability is greyed out.
- CP regenerates passively at **1 CP every 6 seconds** (10/minute), scaling slightly with the class's primary stat modifier.
- Resting at an Inn fully restores CP (like it restores HP).
- No more cooldown timers on abilities -- resource management replaces them.

## CP Costs by Tier

| Tier | Level | CP Cost | Design Intent |
|------|-------|---------|---------------|
| T1 | 5 | 15 | Bread-and-butter, usable frequently |
| T2 | 10 | 25 | Moderate cost, tactical choice |
| T3 | 15 | 40 | Expensive, meaningful commitment |
| T4 | 20 | 60 | Very expensive, fight-defining |

## Max CP Scaling

- **Base max CP**: 100
- **Per level**: +3 CP (so level 20 = 100 + 57 = 157 max CP)
- This means at level 20, you can use one T4 ability (60) and one T2 (25) before needing to regenerate, which creates real tactical decisions.

## CP Regen Rate

- **Base**: 1 CP per 6 seconds
- **Bonus**: +0.5 CP per 6s for every 2 points of primary stat modifier (WIS for healer, INT for wizard, CHA for bard, CON for warrior, DEX for ranger/rogue)
- **Inn rest**: Restores CP to max (alongside HP)
- Bard's "Inspire" could also grant a temporary CP regen buff

## What Changes for Abilities

- The `cooldownMs` field in `ClassAbility` is replaced with `cpCost`.
- Ability buttons show their CP cost instead of a countdown timer.
- Buttons are disabled when the character doesn't have enough CP.
- The Bard's "Encore" (cooldown reset) changes to "Encore: refund the CP cost of your last used ability".

---

## Technical Details

### Database Migration

Add two columns to the `characters` table:

```text
cp      integer NOT NULL DEFAULT 100
max_cp  integer NOT NULL DEFAULT 100
```

Update the `restrict_party_leader_updates` trigger to also protect `cp` and `max_cp` from non-owner updates.

Update the `award_party_member` function to increase `max_cp` by 3 on level-up.

### File: `src/lib/class-abilities.ts`

- Replace `cooldownMs: number` with `cpCost: number` in the `ClassAbility` interface.
- Update all ability definitions with their CP costs (T1: 15, T2: 25, T3: 40, T4: 60).

### File: `src/hooks/useCharacter.ts`

- Add `cp` and `max_cp` to the `Character` interface.

### File: `src/pages/GamePage.tsx`

- Remove all `abilityCooldownEnds` state and related `setCooldown` logic.
- Remove `lastUsedAbilityIndex` (Encore changes to CP refund of last ability's cost).
- Track `lastUsedAbilityCost` instead (a number, for Encore refund).
- In `handleUseAbility`: check `character.cp >= ability.cpCost`, then deduct CP via `updateCharacter({ cp: character.cp - ability.cpCost })`.
- Add a CP regen effect (useEffect with setInterval) that ticks every 6 seconds, adding CP up to max_cp.
- For Encore: refund `lastUsedAbilityCost` CP instead of resetting a timer.
- Remove cooldown-related props passed to NodeView.

### File: `src/components/game/NodeView.tsx`

- Remove cooldown countdown display logic (`cooldownLefts` state, the interval effect).
- Show CP cost on each ability button instead of a countdown.
- Disable buttons when `character.cp < ability.cpCost` instead of when on cooldown.

### File: `src/components/game/CharacterPanel.tsx`

- Add a **CP bar** below the HP bar (similar styling, perhaps blue/purple).
- Show current CP / max CP with regen rate in tooltip.

### File: `src/lib/game-data.ts`

- Add `getMaxCp(level: number): number` -- returns `100 + (level - 1) * 3`.
- Add `getCpRegenRate(classPrimaryStat: number): number` -- returns base + bonus from stat modifier.

### File: `src/components/admin/GameManual.tsx`

- Replace the cooldown column in the abilities table with a CP cost column.
- Add a new section explaining the CP system, regen rates, and max CP scaling.

### File: `supabase/functions/admin-users/index.ts`

- Update "set-level" and "reset-stats" actions to recalculate `max_cp` and set `cp` to `max_cp`.
- Update "grant-xp" level-up logic to increase `max_cp` by 3.

### Inn Rest Logic (in GamePage)

- When resting at an inn (already restores HP), also set `cp` to `max_cp`.

### Character Creation

- New characters start with `cp = 100, max_cp = 100` (the database defaults handle this).
