## Goal
Stop creature HP snap-back by auditing the full combat HP lifecycle and then making one clear owner for each kind of HP change.

## Current diagnosis
- The earlier `23505` encounter creation race appears clean now: recent `combat-tick` logs show no matching duplicate-key errors.
- There is still an active global creature regeneration path: `tick_creatures()` runs every 2 minutes and calls `regen_creature_hp()`.
- `regen_creature_hp()` currently heals every alive damaged creature, with no check for active combat sessions, encounter participants, active effects, or recent damage.
- This matches the symptom: HP looks correct after damage, then jumps back a few seconds/minutes later when the background creature tick heals it.
- There are also multiple client/server state paths that can repaint HP: direct fetch, catchup response, realtime creature update, combat tick response, and broadcast override. Those need an ownership audit so we do not patch only one symptom.

## Implementation plan

### 1. Add short-term HP ownership instrumentation
- Add structured logs around creature HP writes in:
  - `encounter_apply_damage`
  - `regen_creature_hp`
  - `respawn_creatures`
  - `combat-catchup` DoT writes
- Include creature id, node id, old HP, new HP, reason/source, active combat/session presence, and timestamp.
- Keep logs concise and temporary enough to remove or reduce after validation.

### 2. Fix background regeneration ownership
- Change `regen_creature_hp()` so it does not heal creatures that are actively engaged or recently damaged.
- Minimum safe rule:
  - Do not regenerate creatures that are in an active encounter/participant row.
  - Do not regenerate creatures with active effects targeting them.
  - Do not regenerate creatures in active `combat_sessions.engaged_creature_ids`.
- If the schema has no reliable `last_damaged_at`, avoid adding it unless needed; use current combat/encounter state first.

### 3. Audit and close stale HP writers
- Search and verify every remaining direct writer to `creatures.hp`.
- Decide ownership per path:
  - Player/live damage: `encounter_apply_damage` only.
  - DoT/offscreen damage: encounter delta path or a clearly named equivalent RPC.
  - Background regen: only when creature is truly out of combat.
  - Respawn: only when dead and respawn timer elapsed.
  - Admin/manual reset: explicit admin path only.
- Remove or gate any direct `damage_creature` usage that can still affect live combat.

### 4. Align client HP repaint priority
- Make sure the client never replaces fresher combat HP with stale direct-fetch/prefetch/catchup data.
- Keep combat tick response limited to changed creatures.
- Add a timestamp/sequence guard if needed so older fetch/catchup results cannot repaint a higher HP over a newer realtime/tick result.
- Review interaction between:
  - `useCreatures`
  - `useCreatureBroadcast`
  - `useMergedCreatureHpOverrides`
  - `useCombatDriver`

### 5. Implement M4 participant lifecycle foundation after HP is stable
- Add explicit engage/disengage RPCs from the saved M4 plan.
- Backfill/purge orphan participant/session state.
- Wire disengage on movement, teleport, summon accept, wimp flee, death, and logout.
- Use participant rows as the future source of truth for “in combat”.

## Validation plan
- Play one solo fight against a non-aggressive creature and wait past the creature tick interval; HP must not jump upward while engaged or DoT-afflicted.
- Leave the node mid-fight and re-enter; HP should remain at the persisted damaged value unless intentional out-of-combat regen rules apply.
- Test DoT damage/kill path; no double reward line and no creature reappearing alive from stale UI state.
- Check edge/function/database logs for:
  - no duplicate encounter errors
  - no regen applied to engaged creatures
  - no direct legacy HP writes during live combat

## Expected result
Creature HP will have clear ownership: combat damage persists through encounter RPCs, background regen cannot overwrite live fights, and client displays will stop repainting stale higher HP values.