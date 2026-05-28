# Clear stance buttons on death

## Problem

When a character dies, the server (`combat-tick`) wipes `characters.reserved_buffs` to `{}` — but stance buttons in the UI still appear active after revive. Two gaps:

1. **Client race / pending-write mask.** `useCombatActions` calls `updateCharacter({ reserved_buffs })` when activating/dropping a stance, which marks `reserved_buffs` as a pending field in `useCharacter`'s `pendingWritesRef` for 3 s. If the death + server clear arrives inside that window, the realtime echo of the empty map is merged out and the old stance map is preserved in local state.
2. **Offscreen deaths in `combat-catchup`.** The wake-up resolver does not clear `reserved_buffs` when a character died while offline, so on next login the stale stances are still on the row.

The death `useEffect` in `useCombatLifecycle` only clears the timed `poisonBuff` / `igniteBuff` state — it never touches `reserved_buffs`.

## Fix

### 1. `src/features/character/hooks/useCharacter.ts`
Expose a small helper (or extend `updateCharacterLocal`) that lets callers force-clear a field without setting a pending mask, e.g. `clearCharacterField('reserved_buffs')`:
- Sets the field locally to `{}` on the selected character row.
- Removes `reserved_buffs` from `pendingWritesRef` for that character so the next realtime echo (server's authoritative `{}`) is accepted instead of merged out.

### 2. `src/features/combat/hooks/useCombatLifecycle.ts`
- Add an optional `clearReservedBuffsLocal?: () => void` prop alongside the existing `setPoisonBuff` / `setIgniteBuff` setters.
- In the existing `isDead` effect, call `clearReservedBuffsLocal?.()` next to the poison / ignite resets. This gives immediate visual feedback (buttons un-press the moment HP hits 0) and removes the pending mask so the server's empty map can land.

### 3. `src/features/combat/hooks/usePartyCombat.ts`
- Thread the new helper from `useCharacter` through into `useCombatLifecycle` (same wiring pattern as `setPoisonBuff` / `setIgniteBuff`).
- Pass it down from `GamePage` where `usePartyCombat` is composed.

### 4. `supabase/functions/combat-catchup/index.ts`
Mirror the on-death wipe that already lives in `combat-tick` (lines 1457-1460): when the wake-up resolution determines the character's HP reached 0, include `reserved_buffs: {}` in the character update payload. This handles the "died while offline" path so the next login starts with no stale stances.

## Out of scope
- No changes to `activate_stance` / `drop_stance` RPCs, CP reservation math, or stance flavor text.
- No change to the 3 s pending-mask behavior for non-stance fields (HP/CP/MP regen still need it).
- No UI redesign of the stance buttons themselves.
