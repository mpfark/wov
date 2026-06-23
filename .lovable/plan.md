## Plan

1. **Make the backend return the authoritative character after crafting XP**
   - Update `apply_crafting_xp` so it returns the final level, XP, resources, stats, stat points, and whether a level-up occurred.
   - Keep the current server-side level-up math, but make the response complete enough for the UI to update immediately.

2. **Pass that level-up result through the forge functions**
   - Update `blacksmith-forge` and `jewelcrafter-forge` to include the RPC result in their JSON response.
   - Add a defensive error check so a failed XP RPC cannot silently leave the UI believing crafting succeeded normally.

3. **Refresh the selected character after successful crafting**
   - Add an `onCharacterRefresh` callback from `GamePage` into both crafting panels.
   - After a craft succeeds, call the refresh before/alongside inventory refresh so the level, XP bar, HP/CP/MP caps, and unspent stat point update without relog.
   - Show a level-up log line when the returned crafting XP result says a level was gained.

4. **Avoid stale optimistic gold masking the level-up update**
   - Replace the current `onGoldChange(data.gold_remaining)` path for crafting with an authoritative refresh, because `updateCharacter({ gold })` creates a temporary pending-write mask that can merge out nearby realtime updates.
   - Keep repair/sell behavior unchanged unless directly needed.

5. **Validate the flow**
   - Re-test crafting two 25 XP items on a level 1 character and confirm the UI moves from `50/50` to level 2 with rollover XP immediately, without switching/reloading the character.