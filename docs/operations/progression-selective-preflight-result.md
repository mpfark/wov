# ENG-PROGRESSION-001E/F — read-only hosted preflight result

Observed 2026-10-22 ~16:00 UTC. Route: `supabase_read_only_user`, `transaction_read_only=on`, `read committed`. Reviewed commit `8fe138248c8e5cad95e4e99b9bb9c4ccb50f32ad` = HEAD = origin/main. Candidate `docs/operations/progression-selective-activation.sql` SHA-256 `cf75514d4f6d0345b7abcc6b38ca3aed4ef6a63e1d6a80b439c69658214139ff` matched. No SQL executed, no player rows read, no controls/permissions changed.

## Result: PASS for metadata preconditions; activation still gated

- Command `progression_command(8 args)` prosrc `0e165e22…3382`, projection `443cf2f2…5c3a`, validator `036cc182…9c5f`, apply-F `0026d856…4494`: all exact; postgres owner, SECURITY DEFINER, `search_path=pg_catalog, public`.
- ACLs: command `{postgres, service_role}`; projection `{postgres, authenticated}`; private helpers owner-only. Effective: anon none; authenticated projection only; service_role command only; both sandbox principals no EXECUTE on either and no control-table access.
- Control table: postgres-owned, RLS on, 0 policies, ACL owner-only; one row, singleton, master `enabled=false`; columns only `singleton, enabled` (three new columns absent).
- Drift: `character_sync_derived_internal` `08359aa2…056d` unchanged vs existing evidence; 14 character triggers, all enabled except `characters_wake_world` (D).
- Locking: `node_tick_commit` takes sorted `combat_enter_node:` advisory node locks then encounter FOR UPDATE; `combat2_arrive_after_relocation` takes node advisory then encounter FOR UPDATE (character read before is non-locking); `node_tick_claim_without_canary_gate` uses encounter SKIP LOCKED. Compatible with candidate node → encounter (by ID) → character; progression acquires only one node lock, so no node-lock cycle.
- History: 28 hosted entries; all hashes match local `drizzle/migrations` 0000–0027; latest `when` 1792622346172.

## Unresolved

- Progression RPC caller isolation (Edge → PostgREST as service_role) not established; only this metadata session's READ COMMITTED observed. G3D remains BLOCKED. Per handoff this needs evidence or owner disposition before production activation, not before installation.
- Live Edge `progression-command` bundle identity unverified (source calls the 8-arg RPC).
