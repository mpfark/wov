## Findings

The specific kill was `Master of the Silent Forge`:

- Level 42
- Rarity: rare
- Non-humanoid
- Loot mode: salvage_only
- Killed at 22:15 UTC

Expected rare Renown is `max(1, floor(level * 0.10))`, so this kill should award 4 Renown.

The codebase already contains rare-Renown logic in the shared reward calculator, but the event log proves the deployed/live reward path did not emit or apply the Renown line for this kill. The safest fix is to make the Renown reward path explicit and harder to miss.

## Plan

1. Update the kill reward formatter so Renown is included directly in the kill reward summary, not only as a separate event line.
   - Example for capped characters:
     `Master of the Silent Forge has been slain by you! +4 Renown. Your power transcends experience.`
   - Keep the separate Renown event only if it remains useful, but avoid silent/hidden rewards.

2. Verify the server-side reward calculator and both kill paths use the same rare/boss Renown formula.
   - Live combat: `combat-tick`
   - Offscreen DoT catch-up: `combat-catchup`
   - Rare: `max(1, floor(level * 0.10))`
   - Boss: `floor(level * 0.50)`

3. Add diagnostic logging to kill resolution for Renown-bearing kills.
   - Include creature id/name/level/rarity and computed Renown.
   - This will make future reports easy to verify from function logs.

4. Backfill the missed Renown for the confirmed kill.
   - Character: `Cithrawiel`
   - Creature: `Master of the Silent Forge`
   - Amount: 4 Renown
   - Update both current Renown balance and lifetime Renown.

5. Run a targeted verification after migration/deploy.
   - Confirm Cithrawiel’s Renown increased by 4.
   - Confirm the deployed functions contain the rare-Renown logic.
   - Confirm future rare kills will return a visible Renown message in the event log.

## Technical notes

- Current Renown is stored in the legacy `bhp` column.
- Lifetime Renown is stored in `rp_total_earned`.
- The fix will not add any client-side authority over rewards; reward calculation remains server-owned.
- Database writes will be done through a migration/RPC-safe path rather than direct client logic.