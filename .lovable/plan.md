

# ✅ Completed: Independent `active_effects` Table (LP-Style DoTs)

Replaced the JSONB `dots` column in `combat_sessions` with a dedicated `active_effects` table.
Each DoT is an independent row with its own lifecycle, decoupled from the session.

## Changes Made

| File | Change |
|------|--------|
| Migration | Created `active_effects` table, unique constraint `(source_id, target_id, effect_type)`, RLS (service_role only), index on `node_id`. Dropped `dots` column from `combat_sessions`. |
| `supabase/functions/combat-tick/index.ts` | Replaced all `sessionDots` JSONB operations with `active_effects` table queries/upserts. |
| `supabase/functions/combat-catchup/index.ts` | Rewrote to query `active_effects` by `node_id` directly — no more session JSONB parsing. |
| `src/hooks/usePartyCombat.ts` | Maps new `active_effects` flat array response to legacy nested format for UI compatibility. |
