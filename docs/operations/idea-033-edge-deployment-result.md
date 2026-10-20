# WOV-IDEA-033 — canonical gem application Edge deployment

## Reviewed source and scope

**PASS: scoped deployment and non-mutating endpoint checks. Ready for Mik's manual frontend publication; runtime acceptance remains separately authorized and unverified.**

- Owner authorization: 2026-10-20 23:52 UTC, only `forge-apply-gem` and its required `_shared/gem-application.ts` handler.
- Reviewed implementation: `a57df3a54c80c79fdfedcd307b9f0cc391bc226f`. Starting HEAD and freshly observed remote `origin/main` tip: `2d6fd9ca7fe947e7a171766daaa6682429ad1f46`; reviewed commit and project-state baseline are verified ancestors. Used read-only remote-tip observation rather than a Git fetch/history mutation.
- Reused [reviewed handoff](idea-033-gem-application-handoff.md), [SQL installation evidence](idea-033-sql-installation-result.md), [operating contract](lovable-supabase-operating-contract.md) and existing focused local tests; no broad audit or repeated gameplay tests.
- Preserves engine rules: Character ownership and lifecycle; Resources and attributes; Progression and rewards / Transactional authority and integration; Combat resolution; Effects and stances; Failure, diagnostics and verification. Relevant IDs: WOV-IDEA-033, ENG-PROGRESSION-001 and ENG-LEGACY-001. No rule, heartbeat or scheduler change.

## Artifacts and configuration

| Artifact | SHA-256 |
|---|---|
| `supabase/functions/forge-apply-gem/index.ts` | `94c124b3b0109a3141f5570b932b44bbc868e7f32025aa29827c510f2fe294e8` |
| `supabase/functions/_shared/gem-application.ts` | `74c700be3fabacb9423d9f786d40a66cca23a91a9064c9a87245e2e4cadc6d02` |
| Preserved `supabase/config.toml` | `e4572cad21bc4698c9e42581499b671ef57063e2ebdf0f35ad3180627ab2123f` |
| Tool-reported submitted files/settings identity | `fd39e73a1b4f02718452a9cbbd8fc1227b7b9adbc3d1ff86c0fd6424a1d99b48` |

Both Edge files and configuration are byte-identical to the reviewed commit, checked before deployment and again afterward. The only local shared import is the reviewed handler; the external SDK import remains pinned to `https://esm.sh/@supabase/supabase-js@2.45.0`.

No function-specific JWT block exists for forge-apply-gem; the existing managed deployment default is retained without adding an override. The reviewed entrypoint authenticates through `auth.getUser()` and derives the actor, then uses a separate trusted client without forwarding the player's JWT. No auth modernization or source rewrite was authorized or performed.

Required runtime variable names remain `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`. Secret listing was names-only; it exposes custom secrets, not independent existence evidence for these managed runtime variables. No secret values were requested, inspected or changed. The safe refusal checks do not exercise client creation or independently prove runtime credential availability; that boundary remains for separately authorized runtime verification.

## Minimal hosted prerequisites

Read-only route observed at 23:52:46–23:53:27 UTC on 2026-10-20: database `postgres`, principal `supabase_read_only_user`, `transaction_read_only=on`. This is session-observed, not platform-attested.

- Exact `gem_application_internal(uuid,uuid,uuid,text,uuid)` identity and arguments `_actor,_character_id,_inventory_id,_gem_key,_completion_id`; scalar JSONB, volatile PL/pgSQL, postgres-owned SECURITY DEFINER; `search_path=pg_catalog, public, pg_temp`.
- Gem LF-normalized body `15e7099bd20ec76bd64bfcc90c8fb6939a1b8e7790ade8874182a77f95b75384` matches review. PUBLIC has no direct EXECUTE; anon/authenticated effective EXECUTE false, service_role true. Direct ACL contains only postgres, service_role and the exact previously owner-accepted platform principal, all non-grantable EXECUTE from postgres. No new exception or permission change.
- Private XP body `9260bbbe8149a8d6f1cd8af1634fbe0d2bf01ce5cad1dc34183ee5bf7edafdde` and derived-resource body `08359aa2db74bcb546c488cf89f28ca0910270f3d72f6820e180c58a4ffb056d` unchanged; postgres-owned SECURITY DEFINER, scalar JSONB, volatile PL/pgSQL, `pg_catalog, public`, owner-only ACL; anon/authenticated/service_role denied.
- Drizzle still 27 entries; latest id27, hash `93a9136796b798f0e4e76ac9d3acab5c79b934a0620a1ccaa4de2f113423001f`, created_at `1792538540124`. Prior-prefix preservation evidence reused from installation; no migration operation performed.

## Deployment and endpoint evidence

Supported deployment tool reported success for **only `forge-apply-gem`**, packaging the required handler. Evidence recorded 2026-10-20 23:53 UTC; no exact platform revision ID or live-bundle export returned.

| Probe | Observed result |
|---|---|
| OPTIONS | 200, body `{}`, Content-Type application/json, Allow-Origin `*`, all eight reviewed Allow-Headers present |
| GET | 405, `{"error":"POST required"}` |
| POST with empty Authorization and `{}` | 401, `{"error":"Sign in to apply gems."}` |

GET and POST explicitly supplied empty Authorization to prevent preview-user token injection. OPTIONS tool rejected the method locally (`invalid_http_method`); a direct HTTP OPTIONS request with no credentials verified the expected response at `2026-10-20T23:53:52.155411Z`. No authenticated call or RPC execution occurred.

Handler-specific method/auth responses show the old unconditional 503 `crafting_paused` endpoint is replaced. They corroborate the submitted reviewed handler but do not independently establish every byte of the live bundle. Submitted-source hash and unavailable revision identity remain separate evidence.

## Frontend, authorization and STOP

The immutable-request hook and shared Enhance controls match the reviewed implementation. Since review, the only `src/` delta is managed types adding the gem RPC signature. Existing 11 focused Edge/hook/rendered-Enhance tests and source build evidence are reused; no app source changed or build manually run here.

**Next safe action: Mik manually publishes the matching frontend.** Older callers without completion_id fail closed. Publication is not performed or inferred from Git/preview/deployment. Separately authorized disposable runtime acceptance follows publication; no automatic feature closure or hosted concurrency claim.

No SQL, grants, migration/history, unrelated Edge function, frontend source, JWT setting, secret, scheduler or world-control change. No authenticated application, player-row read, gameplay write or legacy XP writer reactivation. Existing progression limitations, administrative XP pause, recovery stash and parent closures remain unchanged.