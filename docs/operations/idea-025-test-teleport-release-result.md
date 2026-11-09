# WOV-IDEA-025 test teleport — release result (2026-11-09)

Authorized by Mik in chat ("All three steps").

1. Read-only checks (transaction_read_only=on): SQL SHA `0dd86ba6…f9ba7`, Edge source SHAs match handoff; history 31; new objects absent; all seven dependency bodies/owner/settings matched.
2. Installed `0031_idea_025_test_teleport` via Drizzle (history 31→32). Generated file SHA `a24a40a9…1412d` differs from reviewed only by one indentation space on line 160 inside the `$acl$` DO block (no semantic effect). Both functions postgres-owned SECURITY DEFINER; EXECUTE postgres + service_role only. Registry empty.
3. Deployed only `admin-users` (submitted source SHA `6f44f8c7…5ee0`). OPTIONS 200; unauthenticated `test-teleport-access` now 401 "Authentication required" (previously deployed build returned 400 "Unknown action"). Live bundle revision not independently verifiable.

Not done: no destination approvals enrolled (control stays hidden until exact triples are approved), no authenticated test travel, no Publish.
