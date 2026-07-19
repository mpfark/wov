# Divine Challenge: Flat Damage Reduction

Templar's Divine Challenge currently multiplies incoming damage by `(1 - reduction%)`, which scales with the size of the hit and becomes very strong against big attacks. Change it to a **flat** reduction that subtracts a fixed number from each incoming hit, still scaled off WIS (magnitude) and CON (duration).

## Formula

New WIS-scaled flat mitigation (replaces `getDivineChallengeReduction`):

```
flat = round( 3 + diminishing(wisMod, step=0.9, cap=9) )
     → floor 3, soft cap ~12 at very high WIS
```

- CON continues to drive duration (unchanged path).
- Bond multiplier (`bondM`) still applies, multiplying the flat value.
- Floor: incoming damage still can't be reduced below 1 (existing rule).

We can tune the floor/cap numbers if you want a different feel — happy to adjust before/after implementing.

## Changes

1. **Formulas** (`src/shared/formulas/abilities.ts` + mirror in `supabase/functions/_shared/formulas/abilities.ts`)
   - Rename `getDivineChallengeReduction` → `getDivineChallengeFlat`, returning an integer.

2. **Buff payload** — repurpose the field as `flat` (integer) instead of `reduction` (fraction):
   - `useGameLoop.ts` — `DivineChallengeBuff { flat: number; expiresAt: number }`.
   - `useCombatDriver.ts` — `divine_challenge?: { flat: number; expires_at: number }`.
   - `useBuffState.ts` — write `{ flat, expires_at }` into the outgoing buff bag.
   - `useCombatActions.ts` — call new formula and set `flat` on the buff.

3. **Damage pipeline** (`supabase/functions/combat-tick/index.ts`, step 7b)
   - Replace the multiplicative branch with:
     ```
     const flat = Math.max(0, Math.floor((mb.divine_challenge.flat || 0) * bondM));
     if (flat > 0) { dmg = Math.max(dmg - flat, 1); }
     ```
   - Keep the existing `divine_challenge_dr` log line (still shows amount absorbed).

4. **Tooltip / description** in `src/features/combat/utils/class-abilities.ts`
   - Update Divine Challenge text: "Reduces each incoming hit by a flat amount. Reduction scales with WIS (min 3, up to ~12), duration scales with CON."

5. **Manual** (`src/components/admin/GameManual.tsx`) — update the Divine Challenge entry to describe flat mitigation.

## Notes

- No DB migration needed; the buff payload is only carried in in-memory/edge-function state.
- Existing in-flight buffs from before the change will read `flat = 0` and simply do nothing until they expire (a few minutes at most).
