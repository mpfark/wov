# ENG-PROGRESSION-001E/F — Controlled activation result (2026-10-22 ~16:35 UTC)

Owner (Mik) accepted residual PostgREST caller-isolation uncertainty for this controlled test only.

Preflight (supabase_read_only_user, transaction_read_only=on): 29 Drizzle entries, latest hash cf75514d…139ff; command body b7d72fc3…2560, projection e521d5b2…11b5e2, validator 036cc182…, apply-F 0026d856…; ACLs unchanged; controls all false. PASS.

Writes (managed data tool, executed as postgres; guarded single-row updates, no gameplay data):
1. join/allocation/respec -> true, enabled stayed false.
2. enabled -> true (guarded on all three flags true).

Final: enabled=true, join_enabled=true, allocation_enabled=true, respec_enabled=true. Switch and renown hard-refused in command (`operation_disabled`) and projection (`false`). History 29, command hash unchanged.

Rollback: set enabled=false on the singleton row.
Limitations: caller isolation accepted not proven; live progression-command bundle identity unverified; no player command executed.
