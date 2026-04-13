
<final-text>
I found the real issue: the first combat tick you showed had the creature miss, yet the response still came back with `hp/max_hp = 233`, `cp/max_cp = 174`, and `max_mp = 312`. So the drop was not combat damage or a hidden CP cost. The UI was showing client-only “effective” HP/CP/MP values, and the first combat tick corrected them back to the server-authoritative values. Separately, the creature HP moving early is coming from the local prediction system.
</final-text>

## Plan

1. Remove creature HP prediction entirely
- Delete the prediction-on-combat-start and prediction-before-tick logic in `src/features/combat/hooks/usePartyCombat.ts`.
- Remove the related prediction state plumbing so creature HP only changes when the server responds.
- Simplify the merge path in `GamePage` / `useMergedCreatureState` so it only uses authoritative combat data plus broadcast overrides.

2. Stop client-only overfill of HP / CP / MP
- Remove the login “top-up to effective caps” effect in `src/pages/GamePage.tsx`.
- In `src/features/combat/hooks/useGameLoop.ts`, cap regen to authoritative `character.max_hp`, `character.max_cp`, and `character.max_mp`, not gear-derived caps.
- In `src/features/combat/hooks/useCombatActions.ts`, `src/features/inventory/hooks/useConsumableActions.ts`, and the party-regen path, stop healing above authoritative max HP.

3. Show authoritative resource bars
- In `src/features/character/components/StatusBarsStrip.tsx`, show HP/CP/MP against the same authoritative maxima the backend uses.
- This removes the “looks full, then suddenly drops” behavior.

4. Harden CP sync against true stale reads
- Update `src/features/combat/hooks/usePartyCombat.ts` to send current `client_cp` with the combat tick request.
- Update `supabase/functions/combat-tick/index.ts` to start from the freshest safe CP baseline instead of blindly using an older DB value.
- This covers smaller race-condition cases even after the main overfill bug is removed.

## Technical details
- The code already says gear-extended HP/CP/MP are “display-only on the client” in `useCharacter.ts`, but several systems still treat those inflated values as real current resources. That mismatch is the root cause.
- No database schema change is needed.
- Combat formulas, real costs, and tick timing stay unchanged.

## Files likely touched
- `src/features/combat/hooks/usePartyCombat.ts`
- `src/features/combat/hooks/useMergedCreatureState.ts`
- `src/pages/GamePage.tsx`
- `src/features/combat/hooks/useGameLoop.ts`
- `src/features/character/components/StatusBarsStrip.tsx`
- `src/features/combat/hooks/useCombatActions.ts`
- `src/features/inventory/hooks/useConsumableActions.ts`
- `supabase/functions/combat-tick/index.ts`

## Expected result
- Creature HP no longer moves before combat actually resolves.
- HP/CP/MP no longer snap down at combat start “for no reason”.
- CP stays stable even if combat starts right after regen/update.
- The bars match the values the backend actually uses.
