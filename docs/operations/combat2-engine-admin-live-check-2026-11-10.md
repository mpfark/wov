# WoV delivery handoff — Mik admin and live arena check

## Reviewed source and scope

- ENG-MODERNIZE-003; Engine principles and authority, Character ownership and lifecycle, Failure/diagnostics. All gameplay rules and one heartbeat preserved.
- Starting HEAD and cached origin/main `5d0c314b8fa52487b4f5c00d164601aa08ddd690`; source baseline ancestry passes. Fresh fetch not performed under stateful-Git prohibition; no push or publication claimed.
- Screen hashes and 211 checks reused from [engine-screen handoff](combat2-engine-screens-2026-11-10.md); no screen/engine code changed here.
- Changed repository artifacts: project-state JSON/generated Markdown, roadmap, this report. No migration/history/types/Edge changes.

## Artifacts and checks

- User-authorized data operation only: `user_roles` for exact requester account `be789426-4437-4958-901b-1a8e43fbb155`, verified against Auth account before writing. Existing `player` changed to `steward`, the least admin tier sufficient for screens/arena; backend priority derivation and policies unchanged. Readback confirmed.
- Authenticated browser `/admin`: successful; Game Engine opened existing Test Arena with real status/report data; Abilities opened configured35 base entries. Desktop screenshots inspected. Mobile engine header/tabs fit; pre-existing three-column library remains horizontally clipped, not silently claimed responsive or fixed in this task.
- Separate disposable tester account u1 authorized session minted through supported command; session secrets were not printed or committed.
- Installed public arena reset chain and location guards inspected read-only. Mik's admin reset returned `reset_failed`, stage `tester_restore`, SQLSTATE `P0001` for stable request `838652e1-59a6-4cd1-8ec5-917afc1d2784`.
- Source-backed diagnosis: reset moves registered tester to staging; `combat2_guard_test_arena_location` rejects `NEW.user_id <> auth.uid()` for authenticated callers, even when outer reset already validated admin and set relocation authorization. Exact exception text is swallowed by reset; no claim of directly captured inner error. Same mismatch affects admin relocation of other-account testers.
- No new tests are appropriate for unchanged runtime code; prior211 tests reused. Project-state documentation check run. Schema privileges/security/publication: unchanged.

## Minimal hosted verification and delivery

Observed at 2026-11-10T22:58:13Z: Mik role Steward; tester F10-Leader remains0/16HP at low arena; world asleep; combat maintenance; scheduler jobs0; active encounters0; recording runs0. Reset rollback retained existing encounter/report state. No environment start, fight, new recording or close operation executed after refusal.

Full fight is **not verified**. Correct the narrow admin-reset/location authorization composition through reviewed forward SQL and explicit scoped installation authorization, then rerun reset and full fight using original tester account. Do not add an unconditional admin bypass or grant raw character/resource writes; outer validated binding and registered arena destination must remain required. No ready-to-install SQL is supplied by this report.

## Authorization, STOP and recovery

- Authorized now: Mik account admin data grant and bounded live arena fight. Completed grant and screen verification; stopped at reset refusal before world activation.
- No unsupported service-role mint/impersonation, ownership bypass, raw revive, trigger disable or historical migration rewrite. No persistent-data rewind or competing writer restoration.
- Next decision: authorize the narrow arena admin reset/location integration repair, then bounded live fight. Frontend publication stays Mik's manual action.
