## Plan to fix the CP flicker properly

The current fix still allows the CP bar to see two different truths briefly: display-only reserved CP and then server-returned CP. I’ll change this to a transaction model so the visual bar never has to “give CP back” while waiting for the server.

## What will change

1. Centralize CP math
   - Add a small shared frontend utility for CP calculations:
     - available CP = raw CP minus reserved CP
     - displayed CP while reserved
     - reserved segment width/text
     - safe clamping to 0/max CP
   - Use it from both:
     - the ability affordability check
     - `StatusBarsStrip`
   - Remove the ad-hoc `useRef` “debit landed” guard from the CP bar, since the bar should not need to infer server timing.

2. Convert reservation into a local committed debit at dispatch time
   - When the player queues an ability, the reserved part of the bar remains as-is.
   - When the ability is actually sent to `combat-tick`, the client immediately converts:

```text
Before dispatch: raw CP 100, reserved 10, displayed 90
After dispatch:  raw CP 90,  reserved 0,  displayed 90
```

   - This keeps the bar visually stable: the reserved shaded area disappears, but the filled CP amount does not jump up.

3. Add explicit server CP acknowledgement/reconciliation
   - Extend the combat ability payload with CP transaction details such as:

```text
cp_cost
client_cp_before
client_expected_cp_after
```

   - The server still remains authoritative and still writes the real CP value to the database.
   - The server response will include whether the client’s expected CP after the ability matches the authoritative result.
   - If the server agrees, the client will not re-apply/overwrite CP with the same value.
   - If the server disagrees, failed to apply the ability, or detects stale CP, the client will apply the authoritative CP correction.

4. Stop routine tick responses from unnecessarily repainting CP
   - `interpretCombatTickResult` currently applies `member_states.cp` whenever it is present.
   - I’ll adjust this so CP only updates the local character when the server says a correction is needed, or when CP genuinely changed for reasons outside the optimistic transaction.
   - This follows your suggestion: the server can agree with the client’s current CP without overriding it.

5. Make party combat follow the same path
   - Non-leader party members currently send pending abilities to the leader and clear the reservation immediately.
   - I’ll make them also convert the reserved CP to a local committed debit before broadcasting the pending ability.
   - The leader/server response will reconcile the member’s CP only if needed.

6. Add focused tests where practical
   - Test the CP display helper so reserved CP math lives in one place and stays stable.
   - Test the combat response interpreter behavior so matching server CP acknowledgements do not cause redundant client CP updates, while mismatches do.

## Files likely affected

- `src/features/combat/hooks/usePartyCombat.ts`
- `src/features/combat/utils/interpretCombatTickResult.ts`
- New utility, likely under `src/features/combat/utils/` or `src/features/character/utils/`
- `src/features/combat/hooks/useCombatActions.ts`
- `src/features/character/components/StatusBarsStrip.tsx`
- `supabase/functions/combat-tick/index.ts`
- Focused test files for the new helper/interpreter behavior

## Expected result

The CP bar should behave like this:

```text
Ability queued:      CP visually reserved/shaded
Ability dispatched:  reservation becomes real local CP spend, no visual jump
Server agrees:       no CP repaint/override
Server disagrees:    CP corrects once to server truth
```

This keeps the reserved part you like, removes the “CP returned then deducted” animation, and prevents CP calculations from being duplicated across the UI and combat logic.