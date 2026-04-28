## Tighten unique-item return threshold to 1.5 hours

Change the offline duration in `return_unique_items()` from 6 hours to 1.5 hours (90 minutes), so unequipped/equipped uniques held by inactive players return to the world drop pool sooner.

### Migration

Replace `public.return_unique_items()` so the offline clause reads:

```sql
WHERE i.rarity = 'unique'
  AND c.last_online < now() - interval '90 minutes'
```

Durability ≤ 0 reclamation logic is unchanged.

### Notes

- `last_online` is heartbeat-updated every 60s while a character's GamePage is mounted, so "1.5 hours offline" means the player has not had the game open for ~90 minutes.
- No client code changes needed.
- The schedule that calls `return_unique_items()` (pg_cron / external trigger) is unchanged; the threshold inside the function is the only thing tightened.

### Update memory

Update `mem://game/unique-item-exclusivity` to reflect the new 1.5-hour threshold (was 6h).
