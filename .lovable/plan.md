

## Fix: Salvage Awards in Client-Side Ability Kills

### Problem
The server-side `combat-tick` already correctly awards salvage (lines 328-338). The client picks it up via `member_states.salvage` in `usePartyCombat.ts` — this path works fine.

However, **instant ability kills** (Barrage, Eviscerate, Conflagrate, Grand Finale, Focus Strike) bypass the combat tick and call `awardKillRewards` in `useActions.ts` directly. That function uses `updateCharacter({ salvage: newSalvage })`, which the `restrict_party_leader_updates` trigger blocks (salvage can only decrease client-side).

### Solution
In `awardKillRewards`, route the salvage award through the `award_party_member` RPC (which is `SECURITY DEFINER` and bypasses the trigger), then update the local state with `updateCharacterLocal`.

### Changes

**`src/hooks/useActions.ts`** — In `awardKillRewards` (around lines 323-349):
- Replace `await p.updateCharacter({ salvage: newSalvage })` with:
  1. `await supabase.rpc('award_party_member', { _character_id: p.character.id, _xp: 0, _gold: 0, _salvage: salvageShare })`
  2. `p.updateCharacterLocal({ salvage: newSalvage })` for instant UI update
- The party member award loop already uses the RPC correctly — no change needed there.

This is a single-line fix in one file. The server-side combat-tick path is already correct.

