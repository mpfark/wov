# ENG-PROGRESSION-001E/F — SQL installation result

2026-10-22 ~16:08 UTC. Authorized by Mik (installation only). Reviewed source `8fe138248c8e5cad95e4e99b9bb9c4ccb50f32ad`; artifact unchanged at HEAD `b05f0f54`.

## Result: PASS

- Installed once via the standard Drizzle custom-SQL tool as `drizzle/migrations/0028_progression_selective_activation.sql` (journal idx 28, when 1792685307647). Generated file byte-identical to `docs/operations/progression-selective-activation.sql`; SHA-256 `cf75514d4f6d0345b7abcc6b38ca3aed4ef6a63e1d6a80b439c69658214139ff`. No outer BEGIN/COMMIT; all candidate guards passed.
- History 28 → 29; row 29 hash `cf75514d…`; rows 1–28 unchanged (latest prior `7a068b08…`, created_at 1792622346172).
- Bodies: command `b7d72fc3a5b210cad6bd8d1dcd0da01cc900627a1c349d488e19c60de5042560`, projection `e521d5b2f89b71a1760878848099ffccabee9a94c61e3b3aca4395e69911b5e2` (match handoff expectations). Both postgres-owned, SECURITY DEFINER, `search_path=pg_catalog, public`; volatility v/s unchanged; candidate metadata-equality guard passed.
- ACLs unchanged: command `{postgres, service_role}`, projection `{postgres, authenticated}`. Effective: anon none; authenticated projection only; service_role command only; `sandbox_exec` and `sandbox_exec_gpclaklkaolyzfnooajt` none.
- Private deps unchanged: validator `036cc182…`, apply-F `0026d856…`, `character_sync_derived_internal` `08359aa2…`.
- Control table: postgres-owned, RLS on, 0 policies, owner-only ACL, no role access. New columns `join_enabled`, `allocation_enabled`, `respec_enabled` boolean NOT NULL DEFAULT false. Single row: `enabled=false`, all three flags false.
- Generated types: regeneration produced no diff.
- Verification route: `supabase_read_only_user`, `transaction_read_only=on`.

## Not done / remaining activation blockers

- No controls enabled, no permissions changed, no Edge deploy, no publish, no gameplay commands.
- Progression RPC caller isolation unestablished (G3D BLOCKED) — needs evidence or owner disposition before activation.
- Live `progression-command` Edge bundle identity unverified (compatibility check only, no deploy).
- Mik manual frontend publication, then separately authorized owner-only control activation and bounded acceptance.
