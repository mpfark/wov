# ENG-LEGACY-001C3 — resource sync/AC metadata preflight

Prepared locally 2026-10-12 against source `2ba016cc9a05df8d9b2980d106150789c6ee357d`; [C1](legacy-001C1-resource-equipment-writer-map.md) / [C2](legacy-001C2-resource-sync-ac-ownership.md) are the baseline. [SELECT-only SQL](legacy-001C3-resource-sync-preflight.sql) is not a migration or correction and has not been executed. Combat2/progression closure, four open F limitations, delegated-authority uncertainty and recovery stash remain unchanged.

Reviewed SQL SHA-256: `fe12720fc51caeea8f7a24cc2302ef7adbaa2ca430f5a35658bc1108788713f4`.

## Expected source fingerprints

Normalize **prosrc only**, CRLF → LF; UTF-8 SHA-256, no trim/whitespace collapse. Not pg_get_functiondef hashes or whole-file hashes. These are source expectations, not installed facts.

| Exact public identity | Expected normalized prosrc SHA-256 / source |
|---|---|
| sync_character_resources(uuid) | `f5fb2896e66dec364d86403494c485b0e9ef967e7fe1bb99a1fae7bf8a30e096` — `supabase/migrations/20260922112544_a2d63b3d-4f07-4641-a911-f6cf25ee1b45.sql:4–54` |
| character_sync_derived_internal(uuid,boolean,boolean) | `08359aa2db74bcb546c488cf89f28ca0910270f3d72f6820e180c58a4ffb056d` — `drizzle/migrations/0001_progression_001c_dormant_authority.sql:81–117`; corroborated by 0003 dependency guard:30–35 |
| character_inventory_action(uuid,text,uuid,text,uuid) | `ecbe6935be410dd36199fdf4986292c6396b6020b3afd03d8aa77cd21d916ffb` — September inventory authority:26–145 |
| character_repair(uuid,text,uuid,uuid) | `932e535e1ee9a92ced7a4cf88e0bed42f79f1dcd9d537f17f85d7ec2c796d46b` — same inventory authority:147–220 |
| restrict_party_leader_updates() | `e4efaf79ef869df9e199c0fb2ae5d9003517eaa93f406ce1d4c496f4e84806bd` — `supabase/migrations/20260629080249_d6091f9a-cb36-4b1f-9beb-4966956f5e93.sql:7–108` |

Inventory authority file: `supabase/migrations/20260908213420_bbfa1b05-0000-4dbf-b662-1ab7e37699c9.sql`. The restrict trigger expectation is historical source: a mismatch requires reconciliation, not automatic reinstatement or history repair.

## PASS / FAIL / REQUIRES EVIDENCE

- **PASS = evidence establishes the specified check**, not that sync is correct or safe. A matching unlocked sync body confirms the C1/C2 concern; it does not turn that risk into a passing concurrency result.
- **FAIL = concrete mismatch or demonstrated contract breach:** fingerprint/security/authority differs from expected source, function missing with adequate visibility, disabled required guard, or materially different delegation. Return the full evidence for focused reconciliation; no automatic repair or expected-hash substitution. An intentional forward change may supersede the source expectation after review.
- **REQUIRES EVIDENCE = visibility/output/context insufficient:** permission error, missing roles, truncated definition, unknown default/grant inheritance, missing table/trigger visibility or unestablished actual RPC isolation. Empty output alone is not evidence of absence. Do not grant permissions to complete the preflight.

| Check | Expected source / interpretation |
|---|---|
| Four RPC signatures | Exact identities above, scalar jsonb, plpgsql, volatile, SECURITY DEFINER, source owner postgres; full arguments/defaults returned for comparison. Unexpected overload/default/security requires review. |
| Search paths | sync: `public`; derived helper: `pg_catalog, public`; inventory action/repair: `public, auth, pg_temp`. Compare actual proconfig, not caller session search_path. Unexpected extra execution settings require review. |
| Direct/effective EXECUTE | sync/action/repair: anon denied, authenticated/service_role allowed in source; PUBLIC denied. Internal derived helper owner-only: anon/authenticated/service_role denied. Record direct ACL entries including PUBLIC and effective role checks separately; inherited access must not be inferred by reversing memberships. Restrict trigger ACL is informational—trigger invocation is not an ordinary gameplay RPC. |
| Actual trigger bindings | Return every noninternal trigger on exactly characters/inventory, including constraint trigger metadata and enabled state, plus full bound function definitions/fingerprints. Locate restrict_party_leader_updates by bound identity, not assumed trigger name. `D` disabled / `R` replica-only is not an ordinary active guard. Missing binding with full visibility is a source-boundary difference for review. Do not assume a familiar trigger list is complete. |
| Resource/AC/equipment delegation | Determine from bodies whether any installed function/trigger recomputes maxima/AC, clamps/restores old fields, locks character/inventory or delegates synchronization. Source sync/derived do not write AC; inventory action/repair do not call sync. Restrict restores/clamps AC rather than deriving it. A new sync delegate is evidence to reconcile; no delegate with complete visible bodies establishes the inspected boundary only, not every external writer. |
| Columns/defaults/constraints | Character identity/base stats/level/class/current/max resources/AC/lifecycle types/defaults and inventory identity/slot/durability/override/gem fields; constraints include FKs/checks/uniqueness/validation/deferrability. Expected resource/AC integer and override/gem jsonb semantics must be compared with definitions, not assumed from generated types. Empty-override default/check evidence does not by itself settle intended item policy or occurrence in player rows. |
| Isolation | Return server/session and filtered database/role isolation settings for named gameplay roles/authenticator and inspection principals only. Session READ ONLY/isolation belongs to the metadata request. Matching READ COMMITTED defaults is compatible with C2's example; actual PostgREST per-request overrides may remain REQUIRES EVIDENCE. Do not conflate the read-only inspection role with the gameplay RPC role or installer. |

No player/item-instance rows, key material, arbitrary configuration settings, environment values or database-wide privilege scan. Bound trigger bodies are returned for only these two dependency tables so unknown resource/AC delegates are not excluded by a guessed allowlist. Other writer domains remain outside scope. Runtime correctness/concurrency are not tested.

## Observation/snapshot rule

The file is **one SELECT statement** returning a JSON envelope with observation metadata and all catalog result groups. Run it intact: those groups are a single observation snapshot, with snapshot identifier and statement/transaction time attached. No BEGIN/SET/DO or gameplay function call is required; use Lovable's existing read-only connection.

If the interface cannot return it intact, stop and report first; if it only supports separately observed result groups, label each observation with its own role/time/isolation/snapshot and mark cross-result coherence REQUIRES EVIDENCE. Do not claim matching transaction timestamps alone prove one statement snapshot. Helper definitions and effective privileges remain metadata, not runtime probes. A single coherent metadata observation is not multi-session gameplay proof.

## Exact Lovable-ready prompt

> ENG-LEGACY-001C3 read-only metadata preflight only. First confirm the published source checkpoint contains the C1/C2 reports, `docs/operations/legacy-001C3-resource-sync-preflight.sql` and this criteria document. If these files are unavailable in the published checkpoint, STOP without reconstructing them.
>
> Use the existing read-only database connection to execute the SQL file as one intact SELECT. Return the complete JSON envelope, observation role/times/snapshot/isolation, all requested function definitions/fingerprints/ACLs, all noninternal characters/inventory trigger bindings (including constraint triggers), full bound definitions, relevant columns/defaults/constraints and filtered isolation settings. Do not truncate or replace raw definitions with a summary. If the tool cannot return a complete envelope, report the limitation before splitting; separately returned groups must carry independent observation metadata and cannot be described as same-snapshot evidence.
>
> Compare with this document's source fingerprints and PASS/FAIL/REQUIRES EVIDENCE rules. Explicitly identify restrict_party_leader_updates() and its real binding/enabled state; determine whether installed inventory/repair/trigger delegation performs resource or AC synchronization. Missing visibility is REQUIRES EVIDENCE, not proof of absence. Do not modify privileges to gain visibility. A matching unlocked sync body confirms the source concern, not successful runtime serialization.
>
> Do not select player/inventory rows or secrets, invoke sync/claim/commit/gameplay functions, perform concurrency probes, install SQL, invoke a migration runner, repair history, grant/revoke, deploy or publish frontend changes. Return only metadata results, per-check classifications and exact mismatches/remaining gaps. No correction is authorized; actual gameplay RPC isolation may remain unestablished from a read-only session.

## Local validation and next gate

Source-body fingerprint extraction, SELECT-only/static privacy/scope checks, documentation links and project-state synchronization/tests are local validation; SQL is not executed locally. Existing Windows bash ENOENT check is separately retained. No tests are changed or bypassed. C3A authorizes source publication only; preserve the C1/C2 evidence and all hosted-operation boundaries.

Results: 18 applicable tests PASS (project-state, inventory authority source checks, mirror equality); one existing import-specifier check FAILS with `spawnSync bash ENOENT` at shared-mirror-identity.test.ts:45. This is an environment invocation failure, not a demonstrated source mismatch. Single-statement/catalog-only/privacy checks, all five source fingerprints, three report links and whitespace PASS. No hosted query or local SQL compilation is claimed.

Source publication is authorized by C3A; hosted read-only execution still requires separate authorization. No approved correction or migration identity exists in this task. Administrative XP grants remain paused; normal gameplay XP policy remains unchanged and runtime not established by this preflight.
