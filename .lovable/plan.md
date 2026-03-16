

## Updated World Rebuild: Preserve The Soulwright NPC

### Change from Previous Plan

The Soulwright NPC (id: `bcbb3e17-...`) must survive the purge. It's the level-42 milestone NPC tied to the Soulforge system. Currently at node "The Hearth-Throne of Khazad-Mor" which will be deleted.

### Approach

1. **During purge**: Delete all NPCs **except** The Soulwright. Set its `node_id` to `NULL` temporarily so the FK doesn't block node deletion.

2. **During world creation**: Create a thematic node in Kharak-Dum (the dwarven region) called something like "The Soulwright's Forge" or place it in a deep dwarven hall. Reassign the NPC's `node_id` to this new node.

3. **Update location reference in code**: The whisper message in `src/hooks/useActions.ts` (line 275) currently says *"Come find me at The Echoing Vein in the Ash-Veil Perimeter"*. This needs to be updated to reference the new node/region name in Kharak-Dum.

### Purge Order (revised from previous plan)

Same FK-respecting deletion order, but the NPCs step becomes:
```sql
DELETE FROM npcs WHERE id != 'bcbb3e17-9696-4ebc-965d-a4c8e253c963';
UPDATE npcs SET node_id = NULL WHERE id = 'bcbb3e17-9696-4ebc-965d-a4c8e253c963';
```

### Files Changed
- `src/hooks/useActions.ts` — Update Soulwright whisper location text to match new node/region name
- Database operations only (no schema changes) for purge + world creation + NPC reassignment

Everything else from the previous plan remains the same: 11 regions, full node mesh, all characters teleported to Hearthvale Square.

