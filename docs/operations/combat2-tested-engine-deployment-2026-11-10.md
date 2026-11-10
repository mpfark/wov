# Combat2 tested-engine synchronization — deployment result

## Reviewed source and scope

- Mik explicitly authorized deploying newer combat changes on 2026-11-10.
- Starting source and freshly observed GitHub main: `1fb163583cdec9875ccacae9057d4cd7aacab119`; project-state baseline `e1faa06b4fbf59d723636bde74af6abd503609a2` is an ancestor. Read-only Git remote observation used; no fetch/push or other stateful Git operations. Managed source checkpoint after synchronization: `665360fb6d5cba91ce96452b1e54629b94a53696`; independently observed remote still at starting source during verification.
- Affected sections: Combat resolution; Effects and stances; Failure, diagnostics and verification. IDs: ENG-ABILITY-WIZARD-001D/E/F/G3A, ENG-STANCE-001/002; modernization Phase 1c mirror follow-up.
- Preserve current gameplay rules and one authoritative heartbeat. Deploy prepared opt-in mechanics without changing production ability catalogue, SQL, fixed-reservation storage or gates. This does not activate the Wizard redesign.

## Artifacts and local checks

Eight generated modules under `supabase/functions/_shared/combat2`: resolver, mechanics, catalog, decode, types, cp, stack-identity, effect-source; required `supabase/functions/_shared/formulas/ability-calc.ts` synchronized for `extra_cp`. Canonical source is unchanged; transformation adds Deno import extensions only. Formula allowlist dependency resolved the initial TS2367 packaging error; latest automatic build is OK.

| Artifact | SHA-256 |
|---|---|
| resolver.ts | `6150d754cf565278a4a8a01eeaacc9d8aba366e4deb21ef0c4eaf156c97a4f24` |
| mechanics.ts | `31bedabb9f05e084ebc5cc895680bcdd45d2729578adcb383bb0f7511b279f0b` |
| catalog.ts | `9a9f7baf3d3b8cf645ebdefaaa82f7a181c1a6d6106a94c0568f3662ea67b169` |
| decode.ts | `71b592c742ce73c9794a155a0dca8cde4d3fc1b2cafd18bc537ec4189e58d958` |
| types.ts | `ad7de5be849bae2e51f05f0f3b82dcf3f6d71c832c526c5c29f7526dfee1e33e` |
| cp.ts | `927227317a260c301c8c7f93d8f7e2226033ceac54c723c0c7895a8ac7a9729d` |
| stack-identity.ts | `5e2be4c123316607fa3330a798fbd96563c14cb905416c06fd397319472a709f` |
| effect-source.ts | `e504b733860616fc6c0f1f3d5770e923f984bb0c2cab8ad5b7e9389275b0516e` |
| ability-calc.ts | `0b1efc5eef3c10a334742071cdd7fdb0a3894d82224fd95c75b18e81188cc651` |

- 28 files / 613 tests PASS: full Combat2 suite, both golden masters (46 each), new exact engine mirror parity (14 modules), process/dispatcher and both handler suites. Existing fixtures cover opt-in fixed reservations, shared statuses and boss casts; no golden snapshots rewritten.
- Worker/dispatcher orchestration and their claim/commit argument contracts unchanged. Existing installed SQL evidence reused; no schema/ACL preflight needed for this engine-only release under approved modernization policy.
- Production ability inventory unchanged, byte-identical to tested inventory, with none of the new Wizard opt-in policy fields enabled.
- Existing configuration and secret names unchanged: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, COMBAT2_WORKER_SECRET. No values inspected. Unauthenticated POST401 demonstrates environment checks passed without revealing material.

## Minimal hosted verification

Supported deploy tool confirmed only `combat2-dispatch-once` and `combat2-tick-once` deployed. Submitted bundle identities:

- Dispatcher: `ef52d96db30d229fe0d7e7175d3dcf67e3eda20d9dd9e77b918f9e903189e1c3`.
- Tick: `f37b0b05b93d00b637ce2947adb5c98b83b05b38673dc415ffa135b552250617`.

Observed by Lovable at 2026-11-10T21:36:46Z:

| Worker | GET | POST, explicit empty Authorization |
|---|---|---|
| combat2-dispatch-once | 405 method_not_allowed | 401 unauthorized |
| combat2-tick-once | 405 method_not_allowed | 401 unauthorized |

Handlers refuse before privileged client/RPC creation; no gameplay tick or scheduler was invoked for verification. Live bundle identity remains independently unverified because no revision ID/bundle export was returned. Local tests and successful deployment do not establish signed-in gameplay acceptance.

## Authorization and next action

Deployment PASS. No SQL, migrations/history, permissions, secrets/configuration, world-control changes, gameplay mutations, frontend edits or publication. Other Edge Functions left unchanged. No frontend Publish needed for this worker-only release; Mik retains sole publication authority. Ordinary gameplay acceptance remains unperformed, not a deployment blocker or automatic modernization closure.