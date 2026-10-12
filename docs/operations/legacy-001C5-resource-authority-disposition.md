# ENG-LEGACY-001C5 — remaining resource-authority disposition

C5A follow-up: owner authorized [exact three-signature containment preparation](legacy-001C5A-hp-helper-containment.md). Source four-argument identity is resolved as `(uuid,uuid,integer,integer)`; hosted current ACL readback and installation remain pending. The recommendation below is historical decision preparation, not an installed privilege change or C closure.

Local decision preparation, 2026-10-12, source `08f815764df39f0718d24422e121012c98ae249b`. Reuses [C1](legacy-001C1-resource-equipment-writer-map.md), [C2](legacy-001C2-resource-sync-ac-ownership.md), [C3](legacy-001C3-resource-sync-preflight.md) and [installed C4 reconciliation](legacy-001C4-resource-sync-lock.md). No SQL/code/ACL change, hosted inspection or runtime probe. The dispositions below are recommendations; newly proposed limitations/deferrals require owner acceptance, not a claim that all C findings are already accepted.

## Three retained HP helpers

Latest exact bodies: `supabase/migrations/20260731184728_660b1bac-c685-45ae-8cf3-769f81061cbe.sql`.

| Signature / source | Server checks and writes | Authority assessment |
|---|---|---|
| public.heal_party_member(uuid,uuid,integer), lines8–49 | owns_character(healer); self allowed, otherwise accepted same-party relation; target FOR UPDATE; nonnegative caller amount; dead target no-op; clamps to stored max_hp; target HP UPDATE. | No server ability/cost/cast/cooldown/encounter/replay proof. Owning a healer does not establish earned healing. Source can accept arbitrarily repeated self heals within stored cap if execution remains available. |
| public.heal_party_member(uuid,uuid,integer,integer), lines51–96 | Same checks; caller-provided effective cap, at least1, replaces stored cap calculation; target FOR UPDATE and nonnegative delta. | Same unearned heal risk plus caller-authored cap. Actual persisted HP may still be constrained by installed triggers; no live over-cap success is demonstrated. |
| public.damage_party_member(uuid,integer), lines98–142 | Accepted same-party relation with a character owned by auth.uid; nonnegative caller damage; atomic HP decrement bounded at0; no further damage when dead. | Party membership is not authoritative attack/outcome proof. Caller can select amount against qualifying party target; this helper does not record canonical last_death_at. No hosted mutation demonstrated. |

Both heal overloads coexist and the fourth argument has a default; PostgREST three-argument dispatch ambiguity is not tested. Do not assume such ambiguity contains the authority: four-argument requests and the separate damage overload remain distinct possibilities. The actual damage/heal storage operations acquire row locks or perform atomic UPDATE; their issue is **permission to author the event/amount**, not the C4 unlocked-sync defect. Do not generalize “row lock present” into gameplay authorization.

### Permission history and evidence boundary

- Initial three-argument heal definition: `20260215002151_446b5eb0-10d4-4bcd-b534-06f72b4204bb.sql:2`; damage: `20260220001651_7e21fe51-5b97-4c01-8b80-41fb4a6fd80a.sql:2`; four-argument heal: `20260311104112_71a38a27-e356-4530-a255-67d971092f1e.sql:1`. These and July replacements contain no targeted client EXECUTE revocation. CREATE OR REPLACE bodies do not constitute a new ACL grant or prove current privileges.
- [L1 checkpoint](../design/legacy-cleanup-l1-checkpoint.md) explicitly left damage and both heal overloads untouched as then-live/noncombat/OOC authority. Its privilege migration `20260828103101_c356df6c-748b-494a-ae8a-5376a829ac5d.sql` revokes other mutators (including equipment degrade at74–77), **not these three**.
- [Installed SQL dependency audit](../design/combat2-legacy-sql-dependency-audit.md) records Lovable metadata at **2026-10-02 18:14:37 UTC**, with effective authenticated/service_role EXECUTE for the three helpers (matrix:32); no static SQL caller found then. This is historical hosted evidence, not a fresh C5 read or source-only grant declaration.
- Batch C `drizzle/migrations/0000_combat2_legacy_browser_privileges.sql` targets five other transport/clear functions. C4 migration0018 changes only sync's initial locking read. Neither contains these helpers or revokes their client execution. Exact-name source references in the migration chain do not establish a new fence for them.

**According to the retained source-controlled authority model, authenticated execution has not been contained:** a qualifying player can plausibly invoke the helpers directly regardless of UI fences. Historical effective grants support that model. Current hosted direct/default/inherited ACLs are **UNVERIFIED**; do not claim they have been freshly confirmed, nor assume PUBLIC remains granted from an initial default. No database-wide privilege scan or reverse-membership inference is performed.

### Actual source callers / dependency necessity

- Three-argument heal: `src/features/combat/hooks/useCombatActions.ts:354–361` performs a separate client healer HP debit then calls heal_party_member with the three named arguments. Entry handler uses an execution lease (`152,176`); `GamePage.tsx:139–140,969–970` disables legacy combat actions when Combat2 blocks them. `src/shared/config/feature-flags.ts` sets COMBAT2_CLIENT_ENABLED=true; `browser-presentation.ts:6–7` blocks legacy based on rollout OR reserved ownership. Thus current supported GamePage flow does not require this legacy heal callback. A direct RPC need not perform the client debit.
- Damage: `src/features/world/hooks/useMovementActions.ts:379` lies in legacy opportunity-attack fallback. GamePage:992–1012 supplies authorizeCombat2Depart; the movement hook returns through that authoritative callback (`256–260`) before reaching legacy damage. GamePage also passes movementBlocked=combat2BlocksLegacy. Ordinary Combat2 departure must remain unchanged; it is not this HP helper's caller.
- Four-argument heal: no runtime TS/Edge invocation or static SQL caller is established by the exact-name checks/reused inventory. Generated type declarations and legacy text/comments are references, not execution. Named/dynamic/external calls are not universally ruled out.
- Combat2 resolves healing/damage through its server proposal/commit chain, OOC through settlement and respawn through its own transition authority, as mapped in B/C1. They are not demonstrated dependencies on these three RPCs. Do not re-audit their mechanics.

**No supported normal-runtime dependency is demonstrated that requires authenticated execution of these helpers.** Old L1 intent, flag-off compatibility, generated typings, external clients and privileged delegates remain retention/dependency evidence; they are reasons to retain bodies and server capability, not automatic justification for unrestricted player-authored HP outcomes.

## Smallest containment recommendation

After explicit owner approval superseding the historical L1 client-retention decision and narrowly scoped current metadata readback, prepare an ACL-only change for the exact three signatures: revoke PUBLIC/anon/authenticated EXECUTE; preserve actual existing service_role/owner/internal rights, bodies and ordinary movement/Combat2/OOC/respawn. Assert effective client denial and unchanged server authority; stop on inherited residual access instead of revoking broad memberships or granting new rights. No SQL is authored in C5.

If current metadata already proves denial, record it and no migration is necessary. If access remains, the smallest next task is three-signature metadata + scoped containment preparation, not a new heal API, generic role framework or physical retirement. Service EXECUTE alone does not prove the body can pass its auth.uid/ownership predicates; preserve what exists without claiming unrestricted server usefulness.

## Disposition of every remaining C finding

| Finding | Recommended category / reason and acceptance gate |
|---|---|
| Legacy player-authored heal/damage | **Fix before closure.** Establish current exact ACL/body context and deny client execution if present, or record existing denial. Ownership checks and UI fences do not establish canonical HP-event authority. Owner may explicitly accept this risk instead, but C5 does not assume that acceptance. |
| C4 stale captured-resource read | Correction INSTALLED / METADATA VERIFIED per owner; not a remaining implementation blocker. **Accepted limitation** proposed for absent independent-session race/lock-wait proof; sequential fixture and metadata must not be relabeled runtime PASS. |
| Three C3 REQUIRES EVIDENCE / full RPC isolation and trigger topology | **Accepted limitation** proposed for closure at existing selected metadata level, unless exact helper containment prerequisites need a subset of that evidence. The summary lacks per-check breakdown; do not invent resolution or hidden corruption. |
| Stored AC freshness / naked-versus-equipped paths / display shield difference | **Accepted limitation** proposed, explicitly source inconsistency and runtime impact unestablished. No observed incorrect current-character result or approved AC redesign. Preserve a targeted follow-up; do not claim corrected. |
| SQL `{}` fallback versus TS nullish override / saturation differences | **Deferred to another ENG-LEGACY-001 domain**: inventory/items policy and effective-instance semantics. Static discrepancy retained; occurrence/intent not established, no automatic data normalization. Owner confirmation of deferral required. |
| Equip/repair sync callbacks, ignored RPC errors, wear/strip freshness, separate transactions | **Deferred to another ENG-LEGACY-001 domain**: inventory/items/economy writer ownership. C4 fixes only sync's read, not these transactions. Source UI restrictions and no demonstrated live corruption support bounded deferral, not a PASS claim. |
| Restricted equipment-degrade / privileged inventory writers | **Deferred to another ENG-LEGACY-001 domain**: inventory/equipment mutation containment/dependencies. Browser restriction already documented; service predicates and external callers unproven. No new grant or retirement decision. |
| Direct service OOC ward helper / Arena restore / wider scheduler and worker parity | **Accepted limitation** proposed, reusing accepted B gaps. No new unauthorized runtime path demonstrated; retain independent-helper versus canonical scheduling distinction. |
| Existing service raw resource/equipment rights | **Accepted limitation** proposed for trusted-server capability absent a newly demonstrated player entry; C1 records protected15/unprotected38 and inventory ownership boundaries. No database-wide privilege redesign or claim all service writers are fenced. |
| Privileged v3→v2 delegation and four F limitations | **Accepted limitation** already documented under prior owner closures; remains unresolved/open, no new resolution or broad security audit required by C5. |

## Closure recommendation / next decision

**NO-GO for C closure now:** plausible retained authenticated HP authority needs a disposition beyond “UI currently does not call it.” This is not proof of current exploitation or a mandate for exhaustive testing. After exact denial is established/installed, **CONDITIONAL GO** for bounded C closure with explicit owner acceptance of the proposed verification limits/deferrals above. Earlier Combat2/progression closures remain intact.

Smallest next task: authorize three-signature metadata/ACL containment preparation, specifically permitting supersession of L1's client-retention policy while retaining function bodies/server access. If owner instead accepts residual client-authorable HP risk, record that explicit decision; do not mark C complete on this report alone. Do not perform broader audit or start AC/equipment implementation.

Validation is local documentation/project-state/source checks only. No source SQL, privilege, gameplay or hosted change; no commit/push. Administrative XP grants remain paused; normal gameplay XP earning is not intentionally disabled and is not runtime-verified by this disposition. Recovery stash, all prior closures and four open F limitations preserved.

Results: 14 focused tests PASS (three project-state and eleven legacy ACL source checks); one existing test FAILS at legacy-browser-privileges-migration.test.ts:135 because it expects the old `eng-legacy-002-batch-c-history-reconciliation` blocked entry, absent from the unchanged HEAD known_blockers. This is a baseline stale status assertion, not a C5 ACL/body change; no test or historical status is modified to obtain green. The prior Windows bash ENOENT limitation is also still recorded, not resolved or re-tested here. State synchronization, links, closure-preservation and whitespace checks PASS. Neither baseline test issue establishes an authority exploit or independently demands a gameplay correction.
