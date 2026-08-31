# Combat2 Worker Secret Provisioning (Vault, one-shot, server-side)

Scope of this plan: only the provisioning step. Vault-based scheduler design is kept exactly as installed. Nothing is enabled, invoked, opened, or woken. Combat2 behaviour is unchanged.

## 1. Fixed-purpose provisioning RPC

New `public.combat2_provision_worker_secret(_secret text) returns jsonb`.

- `SECURITY DEFINER` with the narrowest trusted search path: `SET search_path = pg_catalog, vault`. `public` is excluded unless implementation proves it is required, and every Vault object and function is schema-qualified (`vault.secrets`, `vault.create_secret`, `vault.update_secret`), as are built-ins used inside the body.
- Vault entry name is hardcoded as `COMBAT2_WORKER_SECRET`; no caller can choose a name or target another entry.
- Rejects a null/blank/short value with `{"ok":false,"classification":"invalid_secret"}`.
- Advisory-locked, idempotent: creates the vault entry when absent (`created`), updates it in place when exactly one entry with that name exists (`updated`).
- If more than one Vault entry already carries that name, it fails closed with a generic `ambiguous_secret_state` and touches nothing — no arbitrary choice, no update, no delete.
- Any failure returns a generic `vault_write_failed` — never `SQLERRM`, never the value.
- `REVOKE ALL` from `PUBLIC`, `anon`, `authenticated`; `GRANT EXECUTE` to `service_role` only.


This is exactly what the already-installed `combat2_dispatch_scheduler_fire()` reads from (`vault.decrypted_secrets` by that name), so no scheduler change is needed.

## 2. One-shot provisioning Edge Function

New `supabase/functions/combat2-provision-worker-secret/` (handler + thin index, matching the existing Combat2 worker layout).

- `POST` only; body must be empty or exactly `{}`.
- Same authorization pattern as the dispatcher: bearer token compared in constant time against `COMBAT2_WORKER_SECRET` via the existing `_shared/combat2-internal-edge-auth.ts`; 401 otherwise.
- Refuses to run if `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, or `COMBAT2_WORKER_SECRET` is missing, or if the worker secret equals the service-role key.
- Reads the value only from `Deno.env.get('COMBAT2_WORKER_SECRET')` and passes it straight to the RPC over the service-role client. It never accepts a secret or a vault name from the request.
- Returns only `{ ok, classification }`; responses are passed through the existing `redact` helper, and logs carry classification only. The value never appears in chat, source, SQL text I author, logs, or the response.

## 3. Migration and deployment

- Apply only the one migration above.
- Deploy only `combat2-provision-worker-secret`. The dispatcher and tick worker are untouched.
- Do not invoke the function.

## 4. Verification (focused only)

Read-only SQL checks: one overload exists, `prosecdef` true, `proconfig` shows `search_path=pg_catalog, vault`, zero execute for `PUBLIC`/`anon`/`authenticated`, execute present for `service_role`. Confirm the function source contains no secret literal and no logging of the value.

Focused handler tests (new test file alongside the existing Combat2 handler tests, dependency-injected, no network):

- missing bearer, malformed scheme, and incorrect bearer are all 401;
- an ordinary player JWT bearer and the service-role key as bearer are both refused;
- empty body and exact `{}` accepted; any other body (non-object, array, or any key present) rejected 400;
- a caller-supplied secret or vault name in the body is rejected and never forwarded — the RPC receives only the env-sourced value and the fixed name lives in the RPC;
- missing `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, or `COMBAT2_WORKER_SECRET`, and worker-secret equals service-role key, all fail closed with `environment_failure`;
- exactly one RPC call is made, to `combat2_provision_worker_secret` and no other RPC;
- the three RPC outcomes map correctly: `created`, `updated`, and duplicate-name `ambiguous_secret_state` refusal;
- no secret value appears in any response, thrown-error path, or log line (assert against both the worker secret and the service-role key);
- the handler performs no scheduling, combat, or world-state call — the asserted RPC name list is exactly one entry.

No full test suite, no production build.


## 5. State after this step

Scheduling stays disabled (zero cron jobs), `combat_mode = maintenance`, world asleep, soak off, `node_*` empty. Vault entry remains absent until you choose to invoke the provisioning function.

## 6. What comes after (not in this plan)

One authorized invocation writes the Edge Secret's value into Vault. Only then does enabling scheduling become possible, and that stays a separate, explicitly approved step.
