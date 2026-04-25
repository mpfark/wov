Yes — making the gear-adjusted resource caps the persisted baseline is the right direction here. The current issue is that the client calculates effective gear caps, but the database trigger still clamps `hp/cp/mp` to the persisted `max_hp/max_cp/max_mp`. So even if the regen loop sends `effectiveCaps`, the database can still silently reduce the saved values back to the pre-gear caps.

## Plan

1. Add a backend recalculation function for character resources
   - Create a dedicated migration with a trusted backend function like `sync_character_resources(character_id)`.
   - It will:
     - Verify the caller owns the character.
     - Read the character’s current base stats and equipped, non-broken gear.
     - Recalculate effective `max_hp`, `max_cp`, and `max_mp` using the same formulas as the app.
     - Persist those effective maxima into the character row.
     - Clamp current `hp/cp/mp` down only if they are above the new effective maxima.
   - This makes the database row itself match the gear state, so normal updates and realtime echoes no longer fight the UI.

2. Trigger this sync when entering the world
   - Add a small “preparing your character” step in `GameRoute` before rendering `GamePage`.
   - On world entry, call the backend sync function for the selected character, then refetch character data.
   - This ensures login/reload starts from the correct gear-adjusted baseline.

3. Trigger this sync after gear changes
   - Update inventory actions that can change effective caps:
     - Equip item
     - Unequip item
     - Broken equipment being unequipped/deleted
     - Dropped/destroyed equipped gear, if applicable
   - After the inventory mutation, run the resource sync and refetch both inventory/character data.
   - This keeps relog behavior correct after gear changes, not just initial login.

4. Stop using temporary effective caps as the long-term persistence fix
   - Keep UI calculations where needed, but rely on persisted `max_hp/max_cp/max_mp` as the stable baseline after sync.
   - Update regen/heal/consumable/party-regen calls so any `hp/cp/mp` writes use the synced caps and do not get clamped differently by the database.
   - Fix currently missed paths, especially party regen/self heal and consumable healing, which compute gear maxes but call `updateCharacter` without effective caps.

5. Add regression tests
   - Add tests for the resource-cap calculation helper so gear bonuses produce the expected persisted max HP/CP/MP.
   - Add/update tests for `clampResourceUpdates` to confirm it uses persisted synced caps correctly.
   - Add a route/hook-level test for “enter world” flow: sync runs before `GamePage` renders with the selected character.

6. Verify
   - Run the relevant Vitest tests.
   - Run TypeScript/build checks if available.
   - Confirm no direct edits are made to generated backend client/type files.

## Technical notes

The important change is not simply “top up on login.” It is to make the persisted character row reflect the equipped gear state:

```text
Character enters world
  -> backend reads equipped gear
  -> calculates effective max_hp/max_cp/max_mp
  -> writes those maxes to characters row
  -> hp/cp/mp are clamped against those maxes
  -> GamePage renders and regen uses the same baseline
```

This avoids the current mismatch:

```text
UI/regen sees gear max: 250
Database row max_hp: 233
Database trigger clamps hp back to 233
Realtime/refetch returns 233
UI appears to snap back
```