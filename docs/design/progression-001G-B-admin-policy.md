# ENG-PROGRESSION-001G-B — Owner-approved admin policy

**POLICY AND CONTRACTS DOCUMENTED / DOCS ONLY. No 001G implementation or closure.**

Owner authority: Mik's supplied 001G-B request approves O1–O14 below. This document
supersedes the *unresolved policy questions* in the historical [001G-A audit](../operations/progression-001G-A-admin-creation-audit.md#8-exceptional-policy-proposal-and-owner-decisions),
without changing its findings or authorizing its proposed repairs. Source checkpoint:
`e69047e47f9d4ec9c2d60bf4fc3cb56927d68bc1`, clean main matching fetched origin/main.
The [command contracts](progression-001G-B-command-contracts.md) translate approved
rules into proposed engineering requirements. The [execution plan and traceability](../operations/progression-001G-B-execution-plan.md)
define separate phase gates. Engineering proposals and remaining owner decisions
are explicitly identified; neither is an implemented permission.

F remains **CLOSED / INSTALLED / VERIFIED / EDGE DEPLOYED / COMMANDS PAUSED /
FRONTEND NOT PUBLISHED**, under the [accepted staged closure](../operations/progression-001F-closure.md).
Retain:

```text
HOSTED MULTI-SESSION BEHAVIOR UNPROVEN
NATURAL RUNTIME PATH NOT YET OBSERVED
AUTHENTICATED COMMANDS-PAUSED RUNTIME PROBE NOT EXECUTED
RP EARNING AUTHORITY GAP
```

## Approved decisions O1–O14

| Decision | Binding owner policy | Unresolved parameter or boundary |
|---|---|---|
| O1 XP | Steward/Overlord compensation or special reward; Steward at most **5,000 XP per action**. Canonical transactional XP advancement, reason, actor, audit receipt, stable UUID and all correct level consequences. | Overlord numeric upper bound is **undecided**, not unlimited. Repeated awards O10. |
| O2 level | **No direct admin level setting, upward or downward.** Normal level changes occur through canonical XP. | Incorrect level/XP requires a separately authorized technical repair with its own exact contract; no generic correction permission. |
| O3 attributes | Documented corrections and separately recorded manual historical adjustments require **Overlord approval only**. Preserve provenance; no guessed historical reconstruction or silent conversion into discretionary, race, class growth or Renown. | Per-case evidence, magnitude, irreversible/opaque repair and compensation must be approved before execution. |
| O4 class | **Only Overlord** may deliberately bypass normal class-access requirements. Unsafe runtime/lifecycle gates still apply. Preserve earned historical growth; no automatic refund. Normal class bond reset applies. | Documented bond errors need separate repair. Exact existing reset semantics and catalog admissibility must be verified before implementing the bypass. |
| O5 tokens | Compensation/reward grants: Steward **1 token/action**, Overlord **5 tokens/action**. Durable reason, audit, UUID; preserve earned milestone uniqueness. | Consumed grants cannot be naively reversed. Repeated awards O10 and case-specific compensation. |
| O6 Renown | RP rewards/compensation: Steward **25 RP/action**, Overlord **100 RP/action**. Only Overlord approves documented rank, lifetime or Renown-related attribute corrections. Distinguish balance, lifetime, ranks and stat provenance. Never reroll historical HMAC outcomes. | Whether each reward/compensation increases lifetime RP needs an explicit model. Gameplay earning remains deferred. |
| O7 creation | One **server-authoritative atomic** creation covers character, initial resources and starting materials. **Revised C2 owner decision supersedes starter gear: no equipment or inventory items.** Admin creation uses the same baseline. Browser submits choices, never authoritative computed values. | Current revised [C2 blueprint](progression-001G-C2-creation-blueprint.md) fixes gold200/salvage40/six gems, full resources and no family at creation; staff/socket work deferred. Remaining dependency evidence and manifest versions require review. |
| O8 deletion/restoration | **Soft delete; 30-day restoration window; only Overlord restores.** Controlled permanent deletion after the window is subject to privacy/retention. Deleted characters are excluded from gameplay; unsafe lifecycle refuses. | Evidence retained only where justified; purge authorization/process, lawful retention and restore conflicts need scoped decisions. |
| O9 revive | Steward/Overlord controlled revive with **normal respawn semantics** for HP/CP/MP; verify source amounts. No inconsistent bare HP set; no active combat/pending-state bypass. | Source preserves CP/MP, rather than filling them. Confirm complete respawn consequences, including delay, gold loss, destination and cleanup, for the admin adapter before implementation. |
| O10 permissions | Fixed roles/permissions, audit and extra sensitive confirmation. **Only Overlord may reward own characters**, with audit flag. Steward cannot self-reward. **Repeated awards to the same character require separate approval.** | Approval authority, expiry, repeat scope, thresholds/windows and anti-splitting policy remain undecided. Proposed race-safe machinery is not owner-approved policy. |
| O11 audit/privacy | Detailed history **12 months**, then controlled deletion/anonymization. Minimum progression proof has separately justified lawful retention. Player sees own relevant adjustments; Steward relevant support records; Overlord full authorized history. Notify affected player; hide security/internal and other-user data. | Legal basis, jurisdiction, minimal evidence fields, retention clocks, anonymization/linkage and deletion procedure require decisions. Twelve months is not indefinite retention. |
| O12 resources | Corrections are **clamp-only**: preserve current HP/CP/MP up to new maxima, no healing or revival. Only Overlord approves separate documented resource compensation. No combat/movement/stance bypass. | A compensation amount/scope needs case approval; revive is O9. Canonical XP level-up resource behavior remains the existing fixed rule. |
| O13 catalogs | Historic applied race bonuses/growth remain. Catalog edits are prospective; derived state uses current formulas. Record/version applied race/class catalogs. No guessed refunds or retroactive growth. Validated catalog publication authority. | Who may validate/publish catalogs and exact version/publication mechanics need approval; ordinary historical catalog RLS is not this new permission. |
| O14 phases | Owner review and separate authorization: B policy, C creation, D admin authority/UI containment, E detection/bounded repair, F verification. RP earning and equipment repair stay separate. | No install, deployment, activation, frontend publication or gameplay writes authorized by B or a phase plan. |

## Exact role matrix

This is the approved future policy, not a description of current endpoint grants.
“Approval only” requires an approved case and separately authorized implementation/
execution. A service client or database owner is a technical principal, not a
product role. Roles and target ownership are always derived on the server.

| Operation | Player | Steward | Overlord |
|---|---|---|---|
| Ordinary own gameplay progression | Existing canonical ownership rules, commands paused | Same when acting as player | Same when acting as player |
| Admin XP award | No | 1..5,000/action; no self-reward; repeated approval | Positive integer; **cap unresolved**; self flag; repeated approval |
| Direct level set/reset | No | No | No; technical repair requires separate authorization |
| Attribute/historical adjustment | No | No | Approval only, documented distinct provenance |
| Controlled class-access bypass | No | No | Yes under O4 and lifecycle gates |
| Respec-token award | No | 1/action, no self-reward | 1..5/action; own target flagged |
| RP award | No | 1..25/action, no self-reward | 1..100/action; own target flagged |
| Rank/lifetime/Renown-attribute correction | No | No | Approval only, documented coherent case |
| Creation | Own normal baseline | No creation for another account | Create for another account with reason/audit, same baseline/quota, under revised C2 |
| Soft deletion | Current own-delete permission requires reconciliation | No new admin-delete permission decided | No new admin-delete permission decided |
| Restore within 30 days | No | No | Yes, safe verified restore only |
| Permanent purge | No new permission | No new permission | Controlled procedure/authorization still undecided |
| Controlled revive | Normal own respawn remains its existing contract | Yes under O9 | Yes under O9 |
| Resource compensation | No | No | Separate documented approval only |
| Catalog validation/publication | No new permission | Undecided | Undecided; no inferred blanket grant |
| Relevant audit read | Own redacted adjustments | Relevant support scope | Full authorized history; security/privacy restrictions still apply |

Caps are per action, never permission to split one reward across fresh UUIDs.
Self-reward is determined using the persisted target owner, not the selected
browser character. Switching acting character or targeting another character
owned by the same actor does not remove that flag.

## Remaining owner decisions

1. Set the Overlord XP cap and any approval exception; no unlimited default.
2. Identify repeated-award approvers, self-approval restrictions, expiry, repeat
   definition/window, aggregation categories and cross-actor anti-splitting scope.
   Review the concrete approval-budget proposal in the command contracts.
3. Review the current [revised C2 manifest/blueprint](progression-001G-C2-creation-blueprint.md). C2 now approves gold200/salvage40/six gems, full calculated resources, no items/family, five retained characters and Overlord-only delegated creation. These choices supersede this earlier open question; remaining exact schema/security/catalog-version evidence is not gameplay approval.
4. Decide whether compensation versus reward RP changes lifetime, and define
   coherent corrections across RP/ranks/stats without replaying old rolls.
5. Approve each opaque/irreversible technical repair's evidence, exact scope,
   safe compensation, and who executes after Overlord approval. There is no
   general permission to repair arbitrary level/XP or damaged snapshots.
6. Define lawful minimum progression evidence retention separately from the
   12-month detailed audit; define purge permissions, privacy erasure conflicts,
   restore evidence/collisions and deletion-window clock/boundary semantics.
7. Confirm O9's complete normal respawn behavior for admin revive, and approve
   any deviation as a separate policy change. CP/MP fill is not approved.
8. Define validated catalog publication role, immutable version semantics and
   treatment of unsafe/current derived inputs without retroactive permanent edits.
9. Separately authorize each local phase and any subsequent Lovable inspection,
   installation/deployment or gameplay execution. Installed SECURITY DEFINER
   ownership/ACL/dependency evidence is an **evidence gap**, not a policy vote.

## Preservation boundary

Keep service **protected15 denied / unprotected38 allowed / no table UPDATE**;
authenticated six preference columns only. Never use broad UPDATE grants to
restore convenience tools. No generic privileged character UPDATE endpoint.
Protected15 are `str`, `dex`, `con`, `int`, `wis`, `cha`, `level`, `xp`,
`class`, `is_classless`, `unspent_stat_points`, `respec_points`, `bhp`,
`bhp_trained`, `rp_total_earned`. Authenticated preference writes remain only
`last_online`, `wimp_hp_threshold`, `wimp_direction`, `portrait_url`,
`portrait_metadata`, `portrait_generated_at`. The38 allowed service columns are
the explicit installed0006 partition, not a grant template for new columns.
New narrow commands must own validated domain decisions, atomic writes and
durable receipts. Private owner-only primitives and platform administrative read
authority remain distinct from gameplay access. All installed migration files,
journal/snapshots, platform commits and recovery stash remain unchanged.

This package intentionally approves prospective administrative rules in the
engine specification's progression/provenance/authority boundaries, while
preserving normal progression economics, historical opaque state, accepted F
closure and the one authoritative world heartbeat. No hosted observation is new.
