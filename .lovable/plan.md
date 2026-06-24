## Why your warrior died at 42 dmg with wimp set to 61

The prediction system is NOT the cause — per project memory, client-side HP prediction is disabled and `useWimp` reads only server-written HP. The two real causes are:

1. **Single-tick burst past threshold.** `combat-tick` batches every event in a tick (autoattacks from multiple creatures, ability hits, DoT ticks, off-hand swing) into ONE HP write. If your HP went from e.g. 80 → 0 in one tick, `useWimp` never observed a state where HP was both `> 0` and `≤ 61`, so it never fired. The "42" shown is the last individual hit message, not the only damage that landed.
2. **Opportunity attack on wimp-flee.** If wimp DID fire on a prior tick, `handleMove` takes the in-combat flee path, which rolls an AoO from each engaged creature. A 42-dmg AoO from a creature that was already attacking you fits the symptom exactly.

Without a persisted solo combat log we can't tell which one killed you this time, so the plan fixes both and adds logging.

## Changes

### 1. Predictive wimp trigger (cause #1)
In the combat-tick result handler (`interpretCombatTickResult` / wherever HP from the tick is applied), compute `postTickHp = max(0, currentHp - totalDamageInTick)`. If `postTickHp ≤ threshold` AND `currentHp > threshold` AND a wimp direction is set AND the path is valid, trigger flee BEFORE writing the HP update to local state. This lets wimp catch one-shot bursts that skip past the threshold.

Implementation: pass a `wimpCheck` callback into the tick interpreter; `useWimp` exposes a `tryFleeForIncoming(damage)` function that returns `true` if it initiated a flee (so the caller can short-circuit further death handling for that tick if desired — TBD per below).

### 2. Wimp-flee bypasses opportunity attack (cause #2)
Add an optional `skipOpportunityAttack` flag on the in-combat flee path in `useMovementActions.ts`. Wimp-initiated `onMove` passes `{ wimpFlee: true }`; the flee path then skips the AoO rolls. Rationale: wimp is an explicit panic-escape — the whole point is to not die. Manual flee via keyboard still takes the AoO.

### 3. Persist a minimal solo death record (diagnosis)
Add lightweight death logging so we never have to guess again:
- Add `last_death_at timestamptz` and `last_death_log jsonb` columns to `characters` (jsonb holds the last ~20 combat events leading to death: attacker name, damage, post-hp).
- `combat-tick` writes these on the tick that drops HP to 0 for solo combat (party combat already logs to `party_combat_log`).

### 4. Tooltip clarification
Update the wimp tooltip to say "auto-flees when HP would drop to threshold (panic escape — no opportunity attack)".

## Files

- `src/features/combat/hooks/useWimp.ts` — expose `tryFleeForIncoming(damage)`.
- `src/features/combat/utils/interpretCombatTickResult.ts` (or equivalent) — call `tryFleeForIncoming` with the tick's total damage before applying HP.
- `src/features/world/hooks/useMovementActions.ts` — accept `wimpFlee` flag, skip AoO when true.
- `src/pages/GamePage.tsx` — wire `wimpFlee` through to `handleMove` when wimp triggers.
- `src/features/world/components/WimpControl.tsx` — tooltip wording.
- `supabase/functions/combat-tick/index.ts` — write `last_death_at` / `last_death_log` on solo death.
- New migration: add two columns to `characters`.

## Out of scope

- Changing tick batching itself (that's a much bigger architectural change and breaks the "combat-tick is sole HP writer" invariant).
- Party wimp behavior (party flee already has its own AoO handling; not touching it here).
