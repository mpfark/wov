# ENG-PROGRESSION-001G-D — Simplified owner-approved admin policy

Owner decision recorded2026-10-11. This prospective policy supersedes conflicting D requirements in the earlier B policy, command contracts and execution plan. It authorizes documentation/planning only. Historical contracts remain evidence; no existing protection is removed.

## Explicit changes to earlier requirements

| Earlier requirement | Current binding decision |
|---|---|
| O10 second-person approval for repeated awards; proposed approval queues/budgets/UI | No mandatory second-person approval, approver, queue or approval UI. Intentional subsequent awards are not forbidden merely because an earlier award exists. Accidental replay must still not duplicate an award. Repeat-window/aggregation/expiry decisions are no longer prerequisites. |
| General shared audit/replay/notification/outbox machinery for every command | No generalized framework without a concrete need. Consequential mutations need useful operation-specific logging and duplicate prevention where necessary. Do not require a new outbox, notification service or generalized command infrastructure to ship a token grant. |
| Broad D replacement plan for every convenience operation | Inventory/economy/teleport and other disabled convenience replacements may remain deferred. Containment can be retained at closure; do not recreate tools merely to check a roadmap box. |
| Sensitive operations available to Steward through approval machinery | Use server-enforced Overlord-only access when too sensitive for Steward. Specific previously approved role restrictions/caps remain unless explicitly changed. |

Preserved: O2 direct level ban; canonical protected writes; C2 authority/lifecycle/quota/provenance; current database ACLs; XP pause; class/growth/Renown invariants; case-specific repair evidence; existing functioning replay/audit protections. O10 Steward self-reward prohibition remains (owner did not revoke it); Overlord own rewards remain permitted and flagged. O11 detailed history12-month retention and private/redacted access remain; simplification removes generalized infrastructure, not permission to expose logs or retain detailed personal data forever. Approval-only technical repair means an authorized Overlord may execute a specifically justified permitted case; it does not authorize arbitrary repairs or demand a second person.

## Mandatory remaining D slice

1. One narrow respec-token grant, using canonical private progression authority. Server derives role/actor and target ownership, validates integer amount (Steward1, Overlord1..5), refuses Steward self-reward, records Overlord self flag and nonempty reason. Validate existing active target and relevant existing progression/lifecycle invariants; preserve earned milestone uniqueness and checked balances/version semantics.
2. Atomic token increment and a small operation-specific immutable receipt/log containing actor, target, request UUID, bound amount/reason, result and time. Exact retry returns original result; changed request payload conflicts. This concrete award justifies bounded idempotency, not a general replay platform. A new UUID represents a new intentional grant; no unapproved rate/window policy. Keep existing resource rules and unrelated progression paths unchanged.
3. Small UI control with accurate outcome, stable UUID across retry and authoritative refetch. Failure creates no award/log; local role/cap/self/replay/conflict/rollback tests, then separately authorized installation/deployment and bounded acceptance. No raw grant-respec revival or broad table grants.
4. Bounded final D review of the already identified reachable legacy/delegated authority gaps and evidence/retained limits. Known protected bypasses must be contained or explicitly accepted; no fresh full-system audit or universal test campaign is required. Existing D1–D3 remain delivered at recorded evidence levels.

Storage details will be reviewed in the local implementation task. Prefer reuse of appropriate private progression receipts only if their semantics fit; do not repurpose C2 creation/lifecycle receipts.12-month detailed log retention is retained. If replay after expiry genuinely needs additional long-lived identifiers, propose only the minimum justified store and report a concrete conflict; no infinite detailed history inferred. Privacy implementation remains narrowly scoped, not an approval queue blocker.

## Explicitly deferred, not implemented or passed

- XP awards remain paused. No Overlord XP cap needed while paused; decide it before enabling XP awards.
- RP awards/earning and coherent Renown corrections remain deferred; lifetime reward semantics needed only before enabling that operation. RP EARNING AUTHORITY GAP remains OPEN.
- Inventory/economy/teleport/full-HP heal and other disabled convenience replacements remain deferred, including normal-semantic admin revive until its bounded contract is actually needed. Existing ordinary respawn/movement stays unchanged.
- Owner explicitly defers class-access, attribute and resource correction tools (2026-10-11). They are not mandatory D delivery, not cancelled. Prior role/evidence/growth/clamp invariants remain for future separately authorized work; ordinary gameplay remains unchanged. Other per-case technical repairs remain E-scoped, with no generic repair authorization.
- General audit/replay/notification framework, approval UI and exhaustive branch testing are not D closure requirements. Existing logging/replay protections continue.

E legacy read-only detection/bounded case repair and F overall001G closure remain separate existing roadmap work, not erased by simplified D. C2 accepted follow-ups stay nonblocking. D is OPEN until narrow token implementation, proportionate review/acceptance; owner may accept untested branches explicitly without claiming PASS.

## Decisions and next task

No second-person/repeat approval decision blocks a local narrow token implementation proposal. Owner explicitly resolved the class/attribute/resource delivery deferral; it no longer blocks D closure. Existing role caps, self rules, reason,12-month detailed retention and visibility restrictions suffice as policy inputs. Owner still separately authorizes implementation and later rollout. Concrete retention/storage or authority conflicts discovered during implementation must be reported, not silently resolved. Unresolved XP/RP/respawn/technical case decisions do not block the token slice while those features remain disabled/deferred.

Recommended smallest next task: local implementation of award-respec-token only, with minimal private receipt/idempotency, focused tests and installation handoff. No implementation starts from this document.

Preserve OPEN: HOSTED MULTI-SESSION BEHAVIOR UNPROVEN; NATURAL RUNTIME PATH NOT YET OBSERVED; AUTHENTICATED COMMANDS-PAUSED RUNTIME PROBE NOT EXECUTED; RP EARNING AUTHORITY GAP.

## Next implementation locations (proposal, not implementation)

Existing contract: B command contracts operation award-respec-token, interpreted under this policy (no O10 second-person approval/outbox requirement). Existing private progression_character_state, progression_receipt and progression_respec_milestone are defined in installed-source0001_progression_001c_dormant_authority.sql;0005_progression_001f_canonical_renown_respec_authority.sql owns fresh validation/respec consumption and receipt operation checks. No existing canonical admin token-award command was found. Do not mislabel gameplay respec consumption or XP milestone earning as that command.

Smallest future slice: a new narrow service-only database entry with a private atomic token increment, role/ownership recheck, version/fresh/lifecycle validation, distinct grant source and bound UUID/result logging; adapt admin-users with an explicit new action and restore only the token UI. Keep retired raw grant-respec410 and existing progression-command gameplay pause untouched. Edge locations: supabase/functions/admin-users/index.ts and existing auth/response conventions; UI: src/components/admin/users/UserManager.tsx and CharacterActionsColumn.tsx. Use installed receipt/version conventions only if compatible; operation constraint and retention implications need implementation review, not blind reuse. Prepare SQL outside migrations under B2 when separately authorized; no historical edits or broad grants. Focus tests on caps, self-role rules, active targets, reason, exact retry/conflict, rollback and unchanged milestone rows.
