

## Plan: Hurt Creatures Become Aggressive

**Problem**: When a player attacks a passive creature, leaves the node, and returns, combat doesn't re-engage because the creature's `is_aggressive` flag is `false`. All the aggro-on-enter logic checks `is_aggressive`.

**Solution**: Make damaged creatures temporarily aggressive by setting `is_aggressive = true` in the database when they take damage. The `respawn_creatures()` function already resets HP and `is_alive` on respawn — we extend it to also reset `is_aggressive` to the creature's original state.

### Changes Required

**1. Database: Add `base_aggressive` column to creatures table**
- New boolean column `base_aggressive` (default `false`) stores the creature's designed aggression state
- Migration: `ALTER TABLE creatures ADD COLUMN base_aggressive boolean NOT NULL DEFAULT false;`
- Backfill: `UPDATE creatures SET base_aggressive = is_aggressive;`
- This preserves the original design intent so respawn can restore it

**2. Database: Update `respawn_creatures()` function**
- On respawn, reset `is_aggressive` back to `base_aggressive`:
```sql
UPDATE creatures
SET is_alive = true, hp = max_hp, died_at = NULL, is_aggressive = base_aggressive
WHERE is_alive = false AND died_at IS NOT NULL
AND died_at + (respawn_seconds || ' seconds')::interval <= now();
```

**3. Database: Update `damage_creature()` function**
- When a creature takes damage, set `is_aggressive = true`:
```sql
IF _killed THEN
  UPDATE creatures SET hp = 0, is_alive = false, died_at = now() WHERE id = _creature_id;
ELSE
  UPDATE creatures SET hp = _new_hp, is_aggressive = true WHERE id = _creature_id;
END IF;
```

**4. Admin CreatureManager** (`src/components/admin/CreatureManager.tsx`)
- Update save logic to also set `base_aggressive` alongside `is_aggressive`

**5. No combat hook changes needed**
- The existing aggro logic in `usePartyCombat` already checks `is_aggressive` on node entry — once the DB flag is `true` for a hurt creature, re-entering the node will auto-engage it naturally
- The realtime subscription in `useCreatures` will pick up the `is_aggressive` change via UPDATE events

### Why This Works
- Player hits passive creature → `damage_creature` sets `is_aggressive = true` in DB
- Player leaves and returns → `useCreatures` fetches creature with `is_aggressive = true` → existing aggro logic kicks in
- Creature dies and respawns → `respawn_creatures` resets `is_aggressive` back to `base_aggressive`
- No complex client-side drain/re-engagement tracking needed

