## Problem

When a player logs in (or refreshes their session) while combat is in progress, the HP/CP/MP bars visibly oscillate and the character "suddenly dies" with full-looking bars. The actual HP at the server has been zero for a while; the UI just kept painting an inflated value.

## Root cause (why it happens)

Two server-authoritative facts:

1. `combat-tick` returns `member_states[].hp/cp/mp` from the DB row and we apply them via `updateCharacterLocal` (no DB write — server already wrote). Those fields then get marked **pending** in `useCharacter.pendingWritesRef` for 3 s.
2. `useGameLoop`'s 4-second regen interval calls `updateCharacter({hp, cp, mp})`, which both writes to the DB **and** marks those fields pending for 3 s.

That sets up two interacting races, both of which get worse the moment a fresh login hydrates state alongside an already-running combat:

A. **Local stale ref → DB heal-back loop.** The regen interval reads `regenCharRef.current.hp` (synced via `useEffect` on `character.hp`). When `combat-tick` writes a low HP via `updateCharacterLocal`, the next regen tick can fire before the ref-syncing `useEffect` runs (or with a still-valid old value if multiple ticks queue during reconciliation). It then `UPDATE characters SET hp = oldHp + regen` to the DB. The next `combat-tick` reads that inflated row, deals damage off the inflated number, and bounces the bars.

B. **Pending-mask bug at login.** `pendingWritesRef` is keyed by `character.id` and lives across the entire session. When the user logs back in, `useCharacter` does a fresh `fetch` that overwrites local state — but it does **not clear** `pendingWritesRef`. Any in-flight regen write from before the relog (or any write that happens within the first 3 s after the realtime channel reconnects) keeps the new realtime echoes from being applied. The bar stays at the cached optimistic value while the server marches HP toward zero. The only way the UI catches up is when a `combat-tick` lands and `updateCharacterLocal` happens to overwrite — which is exactly what produces the "death from a full-looking bar" symptom.

A secondary contributor: `useGameLoop` starts its regen interval immediately on mount, even before `GameRoute`'s `sync_character_resources` RPC completes. During that window the row's `max_hp/max_cp/max_mp` may still be the pre-sync values, and any regen `UPDATE` is silently clamped by the `restrict_party_leader_updates` trigger (which uses the row's own `max_*`, not the gear-effective caps). That clamp can pull `hp` down across a write.

## Fix

Three changes, all small:

### 1. Don't run regen for resources the server owns during combat

In `useGameLoop`'s 4-second interval:
- While `inCombatRegenRef.current === true`, skip the `hp` write entirely (today it still writes `floor(...*0.1)` at minimum 1). The server's `combat-tick` is the sole writer for HP during combat.
- Keep CP regen-out-of-combat-only behavior (already the case).
- Continue MP regen but only when *not* in combat (it has no server-side counterpart, but it still races at login). Out-of-combat behavior is unchanged.

This eliminates race A entirely: there is no client write that can re-inflate `characters.hp` while a tick is in flight.

### 2. Clear pending-write masks on login / character (re)fetch

In `src/features/character/hooks/useCharacter.ts`:
- When `fetchCharactersRef.current()` runs (login, user change, manual refetch), clear `pendingWritesRef` for any character ids no longer in the result, and clear the entry for the freshly fetched selected character so the very next realtime echo is honored.
- When `user` changes (sign in/out), clear the whole `pendingWritesRef` map alongside the existing `setCharacters([])`/`setSelectedCharacterId(null)` reset.

This eliminates race B: a stale 3-second mask from before login can no longer hide the post-login realtime values.

### 3. Gate the regen interval on auth + character readiness

Still in `useGameLoop`:
- Add a guard at the top of the interval callback: if `regenCharRef.current.hp <= 0`, or the character has not yet completed its post-mount sync (track a `readyRef` flipped to `true` once we've seen at least one realtime/fetch update after mount, or simply once `GameRoute`'s `sync_character_resources` has resolved — easiest is to add an `enabled` boolean param threaded from `GameRoute`/`GamePage` that is `true` only after the sync RPC resolves), skip the tick.

This closes the "first 4 s after login" window where regen could write against pre-sync `max_*` and get clamped.

## Files to change

- `src/features/character/hooks/useCharacter.ts` — clear `pendingWritesRef` on user change and on every fetch; key the clearing per-character so other characters in the list aren't disturbed.
- `src/features/combat/hooks/useGameLoop.ts` — remove HP write while `inCombatRegenRef.current` is true; add `enabled`/ready gate for the interval.
- `src/pages/GameRoute.tsx` and `src/pages/GamePage.tsx` — thread a `resourcesSynced` boolean (true after `sync_character_resources` resolves) down to `useGameLoop` so its interval can stay quiet until the gear-effective caps are persisted.

No DB changes, no edge-function changes.

## What this does NOT change

- `combat-tick` remains the sole authority for combat HP/CP. We are only stopping the client from writing back values the server is actively managing.
- Out-of-combat HP/CP/MP regen behavior, caps, and tick rate are unchanged.
- The existing `clampResourceUpdates` safety net stays in place.

## How we'll verify

- Log in mid-combat (a node with an aggressive creature, or a lingering DoT from a stronger boss). Confirm the HP bar tracks server values smoothly without jumps and that death happens at the right HP, not after a delay.
- Check `[combat] tick #N` console logs — `member_states.hp` should match the bar at all times.
- Out-of-combat regen still ticks every 4 s as before.
