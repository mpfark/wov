# Remove activity_log feature + combine creature crons

## Frontend (all activity_log call sites)
- **Delete** `src/hooks/useActivityLog.ts`, `src/hooks/activityLogBatcher.ts`, `src/components/admin/users/ActivityLogColumn.tsx` *(already deleted)*
- `src/components/admin/users/UserManager.tsx` — remove import + `<ActivityLogColumn />` mount
- `src/components/ErrorBoundary.tsx` — drop the `activity_log` insert in `componentDidCatch` (keeps `console.error`)
- `src/contexts/GameContext.tsx` — drop `logActivity` import + login-logging effect
- `src/features/world/hooks/useMovementActions.ts` — drop import + 4 call sites (move / teleport / waymark / search)
- `src/features/inventory/hooks/useConsumableActions.ts` — drop import + 2 call sites
- `src/features/combat/hooks/useGameLoop.ts` — drop import + death-log call

## Database (one migration)
- `DROP TABLE public.activity_log CASCADE;`
- `DROP FUNCTION IF EXISTS public.log_activity_batch(jsonb);`
- `DROP FUNCTION IF EXISTS public.log_activity(uuid, uuid, text, text, jsonb);` (if present)
- Consolidate creature crons: replace `respawn_creatures` + `regen_creature_hp` (both 2 min) with a single `tick_creatures` cron that runs both inside one transaction. Cuts cron metadata overhead by half.

## Gameplay impact
None. No player-visible feature uses activity_log.

## Cost impact
- Removes ~41k inserts/day on `activity_log`
- Removes that table from realtime WAL decoding
- Removes the `log_activity_batch` RPC (#11 by total time)
- Halves the creature cron metadata overhead

Approve to switch to build mode and I'll finish the edits + run the migration.
