

# Milestone Reward Refactor: Sustain + Utility

## Summary

Remove the crit milestone (level 28) and CP discount milestone (level 39). Replace with a graduated HP/CP regen milestone track starting at level 20. Move teleport unlock from 25 to 22. Add a Summon Player ability at level 26 using distance-based CP cost. Update the Game Manual.

## Current Milestone Bonuses to Remove

| Bonus | Location | Code |
|-------|----------|------|
| +1 crit range at level 28 | `combat-tick/index.ts` (lines 602, 748), `combat-math.ts` (line 275), `CharacterPanel.tsx` (line 870), `StatPlannerDialog.tsx` (line 93) | `level >= 28 ? 1 : 0` |
| 10% CP discount at level 39 | `useCombatActions.ts` (lines 523, 722), `usePartyCombat.ts` (line 399), `useMovementActions.ts` (lines 327, 360) | `level >= 39 ? Math.ceil(x * 0.9) : x` |
| 50% HP regen boost at level 35 | `useGameLoop.ts` (line 139), `CharacterPanel.tsx` (line 861) | `level >= 35 ? 0.5 : 0` |

## New Milestone Regen Track

Flat bonus HP/CP regen added to the existing tick system (no multiplier — additive flat values):

| Level | HP Regen Bonus | CP Regen Bonus |
|-------|---------------|---------------|
| 20 | +2 | +1 |
| 25 | +4 | +2 |
| 30 | +6 | +3 |
| 35 | +8 | +4 |
| 40 | +10 | +5 |

### Implementation

Add two pure functions to `game-data.ts`:

```typescript
export function getMilestoneHpRegen(level: number): number {
  if (level >= 40) return 10;
  if (level >= 35) return 8;
  if (level >= 30) return 6;
  if (level >= 25) return 4;
  if (level >= 20) return 2;
  return 0;
}

export function getMilestoneCpRegen(level: number): number {
  if (level >= 40) return 5;
  if (level >= 35) return 4;
  if (level >= 30) return 3;
  if (level >= 25) return 2;
  if (level >= 20) return 1;
  return 0;
}
```

Integrate into `useGameLoop.ts`:
- HP regen: replace the `milestoneBonus` multiplier with `getMilestoneHpRegen(level)` added as flat regen alongside `conRegen + eqItemRegen + foodRegen`
- CP regen: add `getMilestoneCpRegen(level)` as flat bonus alongside `bRegen`

Update `CharacterPanel.tsx` display to show milestone regen in the tooltip instead of the old multiplier.

## Teleport Unlock: Level 25 → 22

Change all `level >= 25` checks to `level >= 22`:
- `GamePage.tsx` (lines 790, 1056)
- `TeleportDialog.tsx` (line 90)
- `useMovementActions.ts` (line 332, 348)
- `MapPanel.tsx` (line 340)

## Summon Player Ability (Level 26)

### How it works
1. Player types a character name in a text input
2. Look up the target character's `current_node_id` via database
3. Calculate CP cost using the same `calculateTeleportCpCost` logic (region distance)
4. Deduct CP from summoner
5. Move the target character to the summoner's node

### Validation
- Target must exist and be online (check global presence)
- Target must not be in combat (check for active combat session)
- Summoner must not be in combat or dead
- Summoner must have enough CP

### UI — SummonPlayerPanel component

New component placed in `MapPanel.tsx` between the map and the party section (at line ~441). Only rendered when `characterLevel >= 26`.

Contains:
- Text input for player name
- "Summon" button
- CP cost preview (shown after name lookup)
- Feedback messages (success/error)

### Cost Calculation

Reuse `calculateTeleportCpCost` from `TeleportDialog.tsx` — extract it to a shared utility in `useMovementActions.ts` or a new file, so both teleport and summon use the same formula.

### Summon Handler

Add `handleSummonPlayer` to `useMovementActions.ts`:
1. Query `characters` table by name (case-insensitive) to get their `current_node_id`
2. Check online status via the `onlinePlayers` list passed as a param
3. Calculate CP cost from region distance
4. Check summoner has enough CP
5. Deduct CP from summoner
6. Update target's `current_node_id` to summoner's node (needs an RPC since we can't update other users' characters directly)

### Database: `summon_player` RPC

New security-definer function:

```sql
CREATE OR REPLACE FUNCTION public.summon_player(
  _summoner_id uuid,
  _target_name text,
  _summoner_node_id uuid
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  _target RECORD;
BEGIN
  IF NOT owns_character(_summoner_id) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;
  
  SELECT id, current_node_id INTO _target
  FROM characters
  WHERE lower(name) = lower(_target_name);
  
  IF _target IS NULL THEN
    RAISE EXCEPTION 'Player not found';
  END IF;
  
  IF _target.id = _summoner_id THEN
    RAISE EXCEPTION 'Cannot summon yourself';
  END IF;
  
  UPDATE characters
  SET current_node_id = _summoner_node_id
  WHERE id = _target.id;
  
  RETURN _target.current_node_id; -- return old node for cost calculation
END;
$$;
```

The client calculates cost before calling the RPC and deducts CP locally.

## Files Modified

| File | Change |
|------|--------|
| `src/lib/game-data.ts` | Add `getMilestoneHpRegen`, `getMilestoneCpRegen` |
| `src/features/combat/hooks/useGameLoop.ts` | Replace milestoneBonus with flat regen functions, add CP milestone regen |
| `src/features/character/components/CharacterPanel.tsx` | Remove crit milestone, remove old HP regen milestone display, update tooltips |
| `src/features/character/components/StatPlannerDialog.tsx` | Remove milestoneCrit |
| `src/features/combat/hooks/useCombatActions.ts` | Remove CP discount (use raw cpCost) |
| `src/features/combat/hooks/usePartyCombat.ts` | Remove CP discount |
| `src/features/world/hooks/useMovementActions.ts` | Remove CP discount from teleport, change level 25→22, add summon handler, export `calculateTeleportCpCost` |
| `src/features/world/components/TeleportDialog.tsx` | Change level 25→22, import shared cost function |
| `src/features/world/components/MapPanel.tsx` | Change level 25→22, add SummonPlayerPanel between map and party |
| `src/pages/GamePage.tsx` | Change level 25→22, pass summon props to MapPanel |
| `supabase/functions/_shared/combat-math.ts` | Remove mileCrit |
| `supabase/functions/combat-tick/index.ts` | Remove mileCrit (2 locations) |
| `src/components/admin/GameManual.tsx` | Rewrite milestone section, add summon docs |
| Migration SQL | Create `summon_player` RPC |

## What Does NOT Change

- Combat formulas, crit system (DEX crit, Eagle Eye all stay)
- CP system (max CP, base regen unchanged)
- Combat tick timing, server authority
- Party system logic
- Gold, salvage, XP systems

