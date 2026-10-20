# WOV-IDEA-015 — SQL installation result

## Reviewed source and scope

- Owner approved step2 only at2026-10-20 06:15UTC; reviewed commit8441598f1773402e1a560a13dd3cf52dd8195b54.
- Starting HEAD and locally recorded origin/main:908201c4be9ff1375f345a8f0302920d43ef410f; reviewed commit and project-state baseline dd85650094509c6d46eddb846b36f4ffe0593653 are ancestors. No Git fetch/push performed; remote freshness not independently refreshed.
- Reused handoff step1 inspection from05:53UTC; refreshed only artifact, canonical XP and migration-prefix prerequisites. No gameplay or rule changes; existing crafting/progression rules preserved.

## Artifacts and checks

- Reviewed SQL:docs/operations/idea-015-base-crafting.sql; byte-identical to reviewed commit.
- Installed SQL:drizzle/migrations/0025_idea_015_base_crafting.sql; byte-identical to reviewed artifact.
- Both SHA-256:2c9488ccb2797114d8c31982aeece6f6910fce76d7d3a68bc39f062b36a5c407.
- Supported custom-SQL tool reported successful installation in its single managed transaction; payload contained no outer BEGIN/COMMIT, guards unchanged. No replay/retry/history repair.
- Generated journal entry idx25, when1792476972530; hosted ledger id26, same timestamp and exact hash. Prior25 hosted rows retain all identities, hashes and timestamps; local journal prefix and historical SQL/snapshots unchanged.
- Tool reported generated types refreshed; no net tracked types change observed. Current types SHA-256:e288cef7103d6a33895612ec66a8cdc25f13637f05b9c6ad9f202738e83d4aaf.

## Essential hosted verification

Read-only observation2026-10-20T06:16:27.577339Z, principal supabase_read_only_user, transaction_read_only=on (observed session, not platform attestation).

- base_craft_internal(uuid,uuid,uuid,uuid), named actor/character/item/completion arguments, jsonb result, plpgsql; body SHA-256:b9d1e4408ab1c291453138c29117c6f35fd38aaaf7723376727d1742154a045f matches exact reviewed prosrc.
- Owner postgres, SECURITY DEFINER, search_path=pg_catalog, public, pg_temp.
- PUBLIC/anon/authenticated EXECUTE denied; service_role EXECUTE allowed.
- **Permission discrepancy:** ACL additionally grants EXECUTE directly to the project-specific sandbox execution principal. Reviewed SQL did not grant this role. Origin/classification of that additional grant not established; no broader role audit or permission correction performed.
- Canonical progression_apply_xp_internal dependency unchanged:body SHA-2569260bbbe8149a8d6f1cd8af1634fbe0d2bf01ce5cad1dc34183ee5bf7edafdde, postgres owner, SECURITY DEFINER, search_path=pg_catalog, public, owner-only ACL; anon/authenticated/service_role denied.
- All migration guards passed. Installation did not invoke the new function or write gameplay rows; no player/reward inspection or runtime test.

## STOP and next action

**SQL installed; activation BLOCKED pending owner disposition of the additional EXECUTE grant.** Do not automatically remove it, retry the installation, deploy Edge or publish. Smallest next action is separately authorized review of this one principal/grant under the existing operating contract, then disposition or a reviewed forward correction if needed. Matching forge-craft-base deployment remains a later separate approval.

No Edge deployment, frontend edits/publication, gameplay tests, settings changes or world wake. Original reviewed handoff retained as historical local preparation evidence; project state records the installation and blocker separately. Extensive Codex tests not repeated.