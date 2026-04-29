# T0 ability: tab-target opener with reserved CP preview

## Goal

Allow T0 abilities (Smite, Fireball, Power Strike, Aimed Shot, Backstab, Cutting Words) to be used as a combat opener against a Tab-targeted creature.

- Casting **reserves** CP in the UI (instant feedback) but does not write to the DB.
- Server is the sole authority for CP deduction — happens at tick resolution as it does today.
- The ability resolves on the next combat tick (~2s) and starts combat at that moment if it lands.
- Moving before the ability resolves fizzles the cast and restores the reserved CP — no CP is actually spent.

## Current state

- `useCombatActions.handleUseAbility`: T0 abilities currently fall into the legacy local `onAbilityExecute` path and silently no-op (they're not in `SERVER_ABILITY_TYPES`, so `combat-tick` never sees them).
- `usePartyCombat.queueAbility(index, targetId)` already queues with a 2s `readyAt` and starts a tick heartbeat — works out-of-combat too because the dispatch condition includes `pendingAbilitiesForServer.length > 0`.
- `Tab` cycles `selectedTargetId` via `GamePage.handleCycleTarget`; non-aggressive targets are highlighted but combat doesn't start.
- `useMovementActions.handleMove` already calls `fleeStopCombat()` on every move, which calls `usePartyCombat.stopCombat`, which clears `pendingAbilityRef`. Perfect cancel hook.
- Server `combat-tick` already deducts CP at resolution (`mCp[member.id] -= cpCost`) and the T0 handler exists (~lines 552–588). Tick response includes the authoritative CP, applied via `interpretCombatTickResult` → `updateCharacterLocal`.

## Changes

### 1. Wire T0s to the server — `src/features/combat/hooks/usePartyCombat.ts`
- Add to `SERVER_ABILITY_TYPES`: `'fireball', 'power_strike', 'aimed_shot', 'backstab', 'smite', 'cutting_words'`.
- Confirm `queueAbility` already passes the chosen `targetId` through to the tick payload (it does; just verify `target_creature_id` is populated even when `engagedCreatureIds` is empty).

### 2. Allow T0 as opener — `src/features/combat/hooks/useCombatActions.ts`
- Keep these six T0 types **out** of `COMBAT_REQUIRED_TYPES`.
- For T0 types, replace the in-combat guard with a target-resolution check:
  1. explicit `targetId` arg →
  2. `selectedTargetId` (Tab target) →
  3. `activeCombatCreatureId` →
  4. first alive creature on node.
- If no alive creature on the node → log `"⭐ No target for <Ability>!"` and return (no reservation, no queue).
- If a target resolves but `cp < cpCost` → existing CP-fail log fires; nothing reserved.
- Pass the resolved `targetId` into `queueAbility` so the cast locks the original Tab target even if the player tabs away before the tick.

### 3. CP reservation (display-only) — `src/features/combat/hooks/usePartyCombat.ts`
- Add a `pendingCpCost: number | null` piece of local state (and a ref for sync access). Set when `queueAbility` is called, cleared whenever `pendingAbilityRef` is cleared (tick resolved, fizzled, stopCombat, fleeStopCombat).
- Expose `pendingCpCost` from the hook alongside `pendingAbility`.
- **No DB write, no `updateCharacter` call.** CP in the database stays untouched until the server tick deducts it.

### 4. Display the reservation — `src/features/character/components/StatusBarsStrip.tsx` (and any CP readout in `CharacterPanel`)
- Accept an optional `reservedCp` prop (passed from `GamePage` from the combat hook).
- Render the CP bar with `displayedCp = max(0, character.cp - reservedCp)` for the fill, and show the numeric as `current / max` using `displayedCp`.
- Optional subtle visual cue: a faint outlined segment for the reserved chunk (kept minimal — display only).
- Ability buttons (`CharacterPanel`) compute affordability against `displayedCp` so a player can't queue two T0s on the same heartbeat.

### 5. Sync after the tick
- No new code needed: `interpretCombatTickResult` → `updateCharacterLocal({ cp: serverCp })` already writes the server's authoritative CP back.
- When the tick resolves the pending ability, `pendingAbilityRef` is cleared (existing path at ~line 414); also clear `pendingCpCost` in that same block.

### 6. Cancel-by-move feedback — `usePartyCombat.stopCombat` / `fleeStopCombat`
- When clearing a non-null `pendingAbilityRef`, push a log line: `⚠️ Your <ability> fizzles as you move away.` then clear `pendingCpCost` so the CP bar refills instantly. No CP loss occurs (server never charged).

### 7. Server — no changes
- `combat-tick` continues to deduct the real `cp_cost` server-side and validate CP availability.
- We do **not** send `cp_cost: 0`. The existing payload is unchanged.

## Behavior matrix

| Scenario | UI CP | DB CP | Outcome |
|---|---|---|---|
| Out of combat, Tab → Smite | drops by cost (reserved) | unchanged | ~2s later: tick deducts CP server-side, Smite hits, combat starts; client CP synced to server value |
| Smite with no creature on node | unchanged | unchanged | "No target" log |
| Smite then move before tick | reservation cleared, refills | unchanged | "Smite fizzles" log; no CP spent |
| Already in combat, cast Smite | drops by cost (reserved) | unchanged until tick | Now actually deals damage (was a silent no-op before) |
| Tab to a different creature mid-cast | n/a | n/a | Cast still hits originally locked target |
| Target dies before tick | reservation cleared on tick response | unchanged (server `ability_fail`) | "target no longer valid" log; CP refunded by sync |
| Two rapid T0 casts | second blocked (reservation makes affordability check fail) | unchanged | "Not enough CP" log on second |

## Verification

- Solo, out of combat: Tab to a non-aggressive creature, press Smite → CP bar drops immediately, ~2s later log shows the smite, combat starts, CP bar matches server value.
- Solo: queue Smite, immediately walk to next node → CP bar refills, "fizzles" log, no combat on new node, DB CP unchanged.
- Solo: queue Smite, ally/DoT kills the target before tick → "target no longer valid", CP refunded.
- Verify all six T0 types behave identically (one per class).
- Confirm DB `characters.cp` value never changes from the client during the reservation window (only changes via the tick response path).
