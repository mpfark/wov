# ENG-LEGACY-001G4A24 — Local installation artifact preparation

Starting SHA59f25d4797e00b6aa121ba95ea553b6937dacc29; fetched/fast-forwarded to0e37519a (including the existing Lovable plan and unrelated application commits, preserved). **Preparation only; no installation, hosted access, Edge deployment or frontend change.** Engine rules and one-heartbeat contract preserved.

## Separate review inputs

| Artifact | SHA-256 | Exact change |
|---|---|---|
| [Party qualification](legacy-001G4A24-party-cost-qualification.sql) | af206f9fdf0d12de1f3d2b4a0b2acf71a0c45e71449a498f74c8fe010b0525e9 | One atomic guarded DO; exact G4A10 terminal member-result alias/column qualification only. |
| [Consolidated G4A21 candidate](legacy-001G4A21-shared-hp-candidate.sql) | a126ae28bc4767bd02b065af1d475a6804fedb9c9c599b3b3e82285830b96523 | Only comment plus REVOKE EXECUTE ON FUNCTION public.heal_creatures_on_wake() FROM anon, authenticated, PUBLIC before existing COMMIT. |

Party original public prosrc SHA-2564b7f16cfd9da168704831ebf641740e9ce69cd206272a39244b076855adb1ea5; corrected e01ed3c1d24627771f40a95960eecd1b39eed7d089c371b2eb5abdf0884de7b1. Pin uses the [F5 archived complete function](legacy-001F5-party-parity-envelope.json), matches [G4A10 qualification](../../scripts/proofs/g4a10/candidate.sql) exactly after public namespace substitution. It qualifies all member-result columns and ORDER BY/request filter, not scalar cost calculations, member MP deductions or other function references. No function SET/owner/security/grant change; complete pg_proc metadata except prosrc must compare equal. Drift, missing identity or already-corrected source fails atomically. No variable_conflict workaround.

HP predecessor SHA-25691092a0013fb325f2100797fa1d07d655b8d0a793400b959be382aa882857e3f remains historical identity only. [Deterministic assembly](../../scripts/proofs/g4a15/prepare-public-hp.mjs) now includes exactly the approved tail. Existing function bodies/owner/settings/server grants and all other candidate bytes remain unchanged. No new trusted-server grant: preflight must distinguish retained direct grants from effective privilege inherited solely through PUBLIC. The revoked wake healer remains callable by its legitimate definer-owned wake chain; actual installed composition/rights require Lovable verification.

## Relevant existing tests only

Run [G4A10 native harness](../../scripts/proofs/g4a10/postgres.test.mjs) with local PostgreSQL bin and --g4a24. It uses the actual public artifact with declared fixture namespace and exact fixture body-hash substitutions (plus matching diagnostic wording), preserving original tests. No assertions removed. Covers original42702, deterministic cost under compiler settings, rollback/refusal/replay, ACL/catalog preservation and three independent-session lock cases; F6 body stays unchanged.

Run [public HP harness](../../scripts/proofs/g4a15/public-hp.test.mjs) with local PostgreSQL bin. It executes the complete regenerated transaction in the existing reduced fixture with declared Auth/clock/namespace/security substitutions, including the actual appended revocation; browser execute denial and postgres execution are asserted. Existing transition/concurrency suites are reused, not a new test framework. These tests do not prove hosted installation/ACL parity or global concurrency safety.

Initial sandboxed attempts stopped in initdb before any SQL: Windows denied renaming pg_wal/xlogtemp to the WAL segment. Identical disposable-local suites were rerun outside that filesystem sandbox; no hosted URL or fallback route. Both reruns passed:23 party cases (3 independent-session observed-blocking cases) and51 public HP cases (14 observed-blocking cases, including reused composition), zero skipped/failed, PostgreSQL18.6. Both disposable clusters shut down through harness cleanup. Three project-state tests passed. JSON/Markdown synchronization,23-entry journal/snapshot chain,191 local references, exact SQL hashes/approved-only HP byte diff/deterministic assembly, historical state/source preservation and whitespace checks passed. The first sandbox initialization failures are environment failures, not SQL failures; no test was bypassed. No typecheck/build rerun: application/runtime sources did not change.

## Installation boundary and limitations

Follow the updated [installation plan](legacy-001G4A24-installation-plan.md), [readiness gates](legacy-001G4A22-creature-hp-release-readiness.md) and [Lovable handoff](legacy-001G4A23-lovable-installation-handoff.md). Two separately reviewed forward events, party first; standard Lovable custom-SQL Drizzle lane only after separate approval, fresh installed/source/ACL/history reconciliation and quiet-window controls. No precreated automatic migrations, ledger repair or blind uncertain retry. Stop before Edge/frontend. Existing plan claims are supplied operator evidence, not new direct hosted verification.

G4A9-R1 remains OPEN until installed disposition; G4-R1/G4-R2/E13/G/parent remain OPEN, G3 deferred/G3D BLOCKED. Preserve prior closures, privileged/C1/external-caller uncertainties, four OPEN progression limitations and deferred F1 retry issue. Administrative XP grants remain paused; normal gameplay XP is not intentionally paused or runtime-verified. Recovery stash unchanged. No gameplay balance, production function source, historical migrations, generated types or runtime imports changed.
