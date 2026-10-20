# WoV Idea & Feature Register

Foundation: ENG-ROADMAP-IDEAS-001B,2026-10-14; based on [001A inventory](../operations/eng-roadmap-ideas-001a-inventory.md) at b043b510ff2808f89fabac3c48f27e57526d2801. Owner approves this register foundation, **not every listed idea or implementation**. Order is grouping, not priority. World / Creatures / Quests audit is not started.

## Ownership and ID rules

- This is the central discovery/cross-reference register of open intentions and questions, not an alternate implementation backlog or operational ledger. [Engine roadmap](game-engine-roadmap.md) owns engine work/status; [admin backlog](../admin-maintenance-backlog.md) owns ADM queue; [project-state JSON](../operations/project-state.json) and its [generated view](../operations/project-state.md) own dated installation/deployment/runtime evidence; [engine specification](../design/game-engine.md) owns rules. Conflicts remain explicit until their owner resolves them.
- Existing ENG/ADM IDs are unchanged. New WOV-IDEA-NNN IDs identify previously unkeyed independent intentions, not approval. Never recycle/renumber an issued ID; aliases preserve provenance. Gaps do not indicate priority. INV-Axx remain immutable report-local aliases from 001A. INV-A04 is an alias to existing ENG-ABILITY-001 rather than a duplicate feature.
- ADM-015 is a historical umbrella, not a new generic admin writer project. Its remaining correction/convenience scope maps to WOV-IDEA-024/025; class/access/resource and individual disabled operations stay deferred. Specify separately decidable child intents only when their scope is reviewed, retaining parent links; do not count a parent and a child as two copies of one deliverable.
- One record per independently decidable intent; shared dependencies are links, not aliases unless the intent is actually the same. Split/merge with an explicit alias/supersedes note; never silently discard accepted limitations. The authoritative document/record above owns status; this register does not invent individual assignees.
- Status vocabulary: IDEA (proposal/planned, no approval implied), DESIGN AGREED (explicit direction only), NEEDS AUDIT (evidence needed, no audit authorization), DEFERRED (intentionally retained/outside current scope), IN PROGRESS (documented ongoing work), UNKNOWN (unclear/conflicting scope/status). IMPLEMENTED items belong in references unless an independently open release/evidence gate is recorded under the same existing ID. Source-only implementation never proves installation, Edge deployment, manual frontend publication or runtime behavior.
- Approval and deferral evidence is separate from status. A closure accepting a risk does not fix it or approve its correction. All rows link source and001A provenance; follow evidence dates in source rather than treating this register as a live hosted read.

## Open records

67 records:65 foundation records plus two owner-reviewed G2D ideas added after001A, including 6 existing-ID release/evidence records. Each includes explicit approval and evidence boundaries. The completed portions of those existing IDs are reference context, not new implementation work.

### Combat, abilities and creature runtime

#### ENG-ABILITY-001 — Ability publication and semantic parity (remaining gates only)

- **Status / kind:** UNKNOWN — source-complete, remaining gate disposition requires dated evidence; Feature / technical change. Authoritative source disposition: ability authority; `implemented_source`.
- **Intent:** Do not reimplement delivered source. Reconcile only remaining prerequisites/verification: Installed SQL/bundle parity; configured-authoring synchronization and separate release review
- **Approval evidence:** Existing roadmap scope/status only; not fresh implementation or release authorization. Source: [game-engine-roadmap.md:7](game-engine-roadmap.md) line7.
- **Implementation/runtime boundary:** Source implementation only in 001A; remaining gates below unresolved at that source snapshot. Check authoritative dated state before release; no hosted proof added.
- **Dependencies / overlaps:** Installed SQL/bundle parity; configured-authoring synchronization and separate release review. Alias INV-A04 is historical evidence context, not a claim every old checkpoint is delivered; Rend formula is WOV-IDEA-030.
- **001A mapping / current tracking:** ENG-ABILITY-001 → ENG-ABILITY-001; Roadmap; state evidence varies.

#### ENG-COMBAT-003 — Present-fighter equipment fencing (remaining gates only)

- **Status / kind:** UNKNOWN — source-complete, remaining gate disposition requires dated evidence; Feature / technical change. Authoritative source disposition: combat snapshot/commit; `implemented_source`.
- **Intent:** Do not reimplement delivered source. Reconcile only remaining prerequisites/verification: install `20261001100000_combat2_present_equipment_fencing.sql`, regenerate official types only if the installed tool reports a type-surface change, deploy every proven Edge consumer of the regenerated resolver mirror, then perform bounded live recovery checks.
- **Approval evidence:** Existing roadmap scope/status only; not fresh implementation or release authorization. Source: [game-engine-roadmap.md:15](game-engine-roadmap.md) line15.
- **Implementation/runtime boundary:** Source implementation only in 001A; remaining gates below unresolved at that source snapshot. Check authoritative dated state before release; no hosted proof added.
- **Dependencies / overlaps:** install `20261001100000_combat2_present_equipment_fencing.sql`, regenerate official types only if the installed tool reports a type-surface change, deploy every proven Edge consumer of the regenerated resolver mirror, then perform bounded live recovery checks.
- **001A mapping / current tracking:** ENG-COMBAT-003 → ENG-COMBAT-003; Roadmap; state evidence varies.

#### ENG-COMBAT-001 — Targeting and combat-initiation audit (remaining gates only)

- **Status / kind:** UNKNOWN — source-complete, remaining gate disposition requires dated evidence; Technical correction / evidence work. Authoritative source disposition: targeting; `implemented_source`.
- **Intent:** Do not reimplement delivered source. Reconcile only remaining prerequisites/verification: bounded diagnostics and preserved live evidence.
- **Approval evidence:** Existing roadmap scope/status only; not fresh implementation or release authorization. Source: [game-engine-roadmap.md:35](game-engine-roadmap.md) line35.
- **Implementation/runtime boundary:** Source implementation only in 001A; remaining gates below unresolved at that source snapshot. Check authoritative dated state before release; no hosted proof added.
- **Dependencies / overlaps:** bounded diagnostics and preserved live evidence.
- **001A mapping / current tracking:** ENG-COMBAT-001 → ENG-COMBAT-001; Roadmap; state evidence varies.

#### ENG-COMBAT-002 — Authoritative arrival and generic hostile first action

- **Status / kind:** IN PROGRESS; Feature / technical change. Authoritative source disposition: entry/targeting/concurrency; `live_verification_pending`.
- **Intent:** solo and coordinated movement invoke one idempotent authoritative entry check in follower-first/leader-last order; reconnect attaches without duplication; one generic server-authored hostile-action boundary atomically enters and queues a validated hostile ability or Basic Attack; tank fallback becomes newest valid entry globally.
- **Approval evidence:** Existing roadmap scope/status only; not fresh implementation or release authorization. Source: [game-engine-roadmap.md:45](game-engine-roadmap.md) line45.
- **Implementation/runtime boundary:** Source/dated rollout evidence exists; live_verification_pending is not comprehensive runtime PASS.
- **Dependencies / overlaps:** bounded live arrival, hostile-initiation and multiplayer tank-order verification; preserve `ENG-MOVE-001` serialization.
- **001A mapping / current tracking:** ENG-COMBAT-002 → ENG-COMBAT-002; Roadmap; state evidence varies.

#### ENG-STANCE-001 — Character-scoped stance authority (remaining gates only)

- **Status / kind:** UNKNOWN — source-complete, remaining gate disposition requires dated evidence; Feature / technical change. Authoritative source disposition: effects; `implemented_source`.
- **Intent:** Do not reimplement delivered source. Reconcile only remaining prerequisites/verification: migration installation, official type regeneration, affected Edge deployment, Mik's manual publication and bounded live verification.
- **Approval evidence:** Existing roadmap scope/status only; not fresh implementation or release authorization. Source: [game-engine-roadmap.md:123](game-engine-roadmap.md) line123.
- **Implementation/runtime boundary:** Source implementation only in 001A; remaining gates below unresolved at that source snapshot. Check authoritative dated state before release; no hosted proof added.
- **Dependencies / overlaps:** migration installation, official type regeneration, affected Edge deployment, Mik's manual publication and bounded live verification.
- **001A mapping / current tracking:** ENG-STANCE-001 → ENG-STANCE-001; Roadmap; state evidence varies.

#### ENG-STANCE-002 — Appropriate stance activation outside combat (remaining gates only)

- **Status / kind:** UNKNOWN — source-complete, remaining gate disposition requires dated evidence; Feature / technical change. Authoritative source disposition: effects/UI; `implemented_source`.
- **Intent:** Do not reimplement delivered source. Reconcile only remaining prerequisites/verification: ENG-STANCE-001 and its approved lifecycle decisions; ability matrix in [combat2-ability-availability-and-persistent-stances.md](../design/combat2-ability-availability-and-persistent-stances.md).
- **Approval evidence:** Existing roadmap scope/status only; not fresh implementation or release authorization. Source: [game-engine-roadmap.md:134](game-engine-roadmap.md) line134.
- **Implementation/runtime boundary:** Source implementation only in 001A; remaining gates below unresolved at that source snapshot. Check authoritative dated state before release; no hosted proof added.
- **Dependencies / overlaps:** ENG-STANCE-001 and its approved lifecycle decisions; ability matrix in [combat2-ability-availability-and-persistent-stances.md](../design/combat2-ability-availability-and-persistent-stances.md).
- **001A mapping / current tracking:** ENG-STANCE-002 → ENG-STANCE-002; Roadmap; state evidence varies.

#### ENG-BALANCE-001 — Broader ability and balance audit

- **Status / kind:** DEFERRED; Technical correction / evidence work. Authoritative source disposition: combat/content; `deferred`.
- **Intent:** evidence-based review without mixing engine repairs and tuning.
- **Approval evidence:** Existing roadmap scope/status only; not fresh implementation or release authorization. Source: [game-engine-roadmap.md:261](game-engine-roadmap.md) line261.
- **Implementation/runtime boundary:** No implementation, hosted or runtime evidence established by this register; retain dated evidence and limitations in source.
- **Dependencies / overlaps:** stabilized heartbeat/targeting/rewards.
- **001A mapping / current tracking:** ENG-BALANCE-001 → ENG-BALANCE-001; Roadmap; state evidence varies.

#### WOV-IDEA-003 — Telegraphed shared boss abilities

- **Status / kind:** DEFERRED; Feature. Authoritative source disposition: 001A classification DEFERRED; see linked original report for exact decision.
- **Intent:** Shared visible casts and leave-node avoidance; older approved-in-principle v3 proposal paused.
- **Approval evidence:** Older approved-in-principle proposal, paused; current contract needs reconciliation. Source: [phase-1-telegraphed-boss-abilities.md:3](../design/phase-1-telegraphed-boss-abilities.md) line3.
- **Implementation/runtime boundary:** No implementation, hosted or runtime evidence established by this register; retain dated evidence and limitations in source.
- **Dependencies / overlaps:** Architecture reconciliation; summon/interrupt/hazard contracts.
- **001A mapping / current tracking:** INV-A03 → WOV-IDEA-003; Design; overlaps Combat2/ADM-024, current completion unclear.

#### WOV-IDEA-005 — Non-stance ability decisions

- **Status / kind:** UNKNOWN; Design decision. Authoritative source disposition: 001A classification UNKNOWN; see linked original report for exact decision.
- **Intent:** Resolve ability availability outside the delivered stance slice.
- **Approval evidence:** Documented proposal/finding or accepted limit; no new implementation approval established here. Source: [combat2-ability-availability-and-persistent-stances.md:98](../design/combat2-ability-availability-and-persistent-stances.md) line98.
- **Implementation/runtime boundary:** No implementation, hosted or runtime evidence established by this register; retain dated evidence and limitations in source.
- **Dependencies / overlaps:** Ability matrix and per-ability decisions.
- **001A mapping / current tracking:** INV-A05 → WOV-IDEA-005; Design sub-batch; overlaps ability/balance roadmap.

#### WOV-IDEA-006 — Awake empty-encounter lifecycle

- **Status / kind:** NEEDS AUDIT; Unresolved question. Authoritative source disposition: 001A classification NEEDS AUDIT; see linked original report for exact decision.
- **Intent:** Determine completion after participants leave; sleep shutdown success does not establish awake completion.
- **Approval evidence:** Documented proposal/finding or accepted limit; no new implementation approval established here. Source: [legacy-001F11-evidence-and-closure-assessment.md:41](../operations/legacy-001F11-evidence-and-closure-assessment.md) line41.
- **Implementation/runtime boundary:** No implementation, hosted or runtime evidence established by this register; retain dated evidence and limitations in source.
- **Dependencies / overlaps:** Existing active-effect/pending-action evidence; separate authorization.
- **001A mapping / current tracking:** INV-A06 → WOV-IDEA-006; F11/state and roadmap narrative, no dedicated stable ID.

#### WOV-IDEA-007 — Shared-world persistent creature HP

- **Status / kind:** DESIGN AGREED; Design decision. Authoritative source disposition: 001A classification DESIGN AGREED; see linked original report for exact decision.
- **Intent:** Agreed future direction; not implemented by Party closeout.
- **Approval evidence:** Direction agreed: F11 owner-supplied direction, retained by F12; no implementation approval. Source: [legacy-001F11-evidence-and-closure-assessment.md:41](../operations/legacy-001F11-evidence-and-closure-assessment.md) line41.
- **Implementation/runtime boundary:** NOT IMPLEMENTED by F11/F12; no runtime result or balance algorithm asserted.
- **Dependencies / overlaps:** Creature lifecycle and encounter boundaries.
- **001A mapping / current tracking:** INV-A07 → WOV-IDEA-007; F11/state/roadmap narrative; no dedicated ID.

- **G4A3 owner direction / remaining design:** [Approved HP contract and configuration readiness](../operations/legacy-001G4A3-creature-hp-contract-readiness.md): durable creatures.hp and synchronized projections; relevant effects/actions block regeneration; 60 seconds continuous OOC delay; eligible sleep credit; no pre-initialization credit; dead ordinary respawn; active attachment prevents reassignment. Per-creature configuration required. 5% maxHP/minute provisional only; rate bounds/defaults, exact blockers, fractions and edit policies still need decisions. DESIGN AGREED, not IMPLEMENTED or runtime-verified; no implementation authorization.

- **G4A4 current approval / proof:** [Owner contract and isolated proof](../operations/legacy-001G4A4-creature-regen-accounting-proof.md) supersede G4A3 provisional rate/range/init questions: 5% default for new/existing creatures, configurable decimal 0–100%, zero disables ordinary regeneration only, no historical initialization healing, persistent fractional HP between settlements, active-attachment rate-edit refusal. Pure model only; exact production transition coverage, interruption/edit policy and persistence remain unimplemented/unverified. DESIGN AGREED remains unchanged.

- **G4A6 current decision / local evidence:** [Owner decisions and isolated SQL candidate](../operations/legacy-001G4A6-local-creature-hp-candidate.md): up to two decimal percentage places; retain whole HP/discard fraction on renewed combat; wounded maxHP edits preserve missing HP with floor boundary pending; quiescent ended reassignment permitted. Native local26-test fixture passes, including4 independent-session cases; production integration remains unimplemented and hosted behavior unverified. Floor1 and rate-edit fractional policy not approved. DESIGN AGREED status retained.

- **G4A7 current policy / boundary:** [Approved floor/rate-reset and local source adapters](../operations/legacy-001G4A7-source-adapter-integration.md): living floor1 on missingHP-preserving max reduction; rate edit settles old eligible time/wholeHP, discards fraction, applies new rate and starts fresh accounting.24 native source-adapter tests, including6 session cases, do not establish full production/hosted parity. DESIGN AGREED remains; no runtime implementation/deployment claim.

- **G4A19 current approved amendment / local candidate:** [Implementation and limits](../operations/legacy-001G4A19-simplified-admin-implementation.md) supersedes historical60s/5%-per-minute timing with default2% maxHP per4eligible seconds, per-creature0–100%/two decimals; no blocked/retroactive credit, exact fractional intervals and ordinary dead respawn preserved. Simplified Admin clients/SQL are locally implemented and gated, not installed; full HP transition composition remains incomplete. DESIGN AGREED is not promoted to implemented/hosted verified.

#### WOV-IDEA-008 — DoT suppression of ordinary creature regeneration

- **Status / kind:** DESIGN AGREED; Design decision. Authoritative source disposition: 001A classification DESIGN AGREED; see linked original report for exact decision.
- **Intent:** Combat-related DoTs suppress ordinary HP regeneration; balance damage and regen together.
- **Approval evidence:** Direction agreed: F11 owner-supplied direction, retained by F12; no implementation approval. Source: [legacy-001F11-evidence-and-closure-assessment.md:41](../operations/legacy-001F11-evidence-and-closure-assessment.md) line41.
- **Implementation/runtime boundary:** NOT IMPLEMENTED by F11/F12; no runtime result or balance algorithm asserted.
- **Dependencies / overlaps:** WOV-IDEA-007; explicit future design/implementation scope.
- **001A mapping / current tracking:** INV-A08 → WOV-IDEA-008; F11/state/roadmap narrative; not implemented.

- **G4A3 owner direction / remaining design:** [Approved HP contract and configuration readiness](../operations/legacy-001G4A3-creature-hp-contract-readiness.md): durable creatures.hp and synchronized projections; relevant effects/actions block regeneration; 60 seconds continuous OOC delay; eligible sleep credit; no pre-initialization credit; dead ordinary respawn; active attachment prevents reassignment. Per-creature configuration required. 5% maxHP/minute provisional only; rate bounds/defaults, exact blockers, fractions and edit policies still need decisions. DESIGN AGREED, not IMPLEMENTED or runtime-verified; no implementation authorization.

- **G4A4 current approval / proof:** [Owner contract and isolated proof](../operations/legacy-001G4A4-creature-regen-accounting-proof.md) supersede G4A3 provisional rate/range/init questions: 5% default for new/existing creatures, configurable decimal 0–100%, zero disables ordinary regeneration only, no historical initialization healing, persistent fractional HP between settlements, active-attachment rate-edit refusal. Pure model only; exact production transition coverage, interruption/edit policy and persistence remain unimplemented/unverified. DESIGN AGREED remains unchanged.

- **G4A6 current decision / local evidence:** [Owner decisions and isolated SQL candidate](../operations/legacy-001G4A6-local-creature-hp-candidate.md): up to two decimal percentage places; retain whole HP/discard fraction on renewed combat; wounded maxHP edits preserve missing HP with floor boundary pending; quiescent ended reassignment permitted. Native local26-test fixture passes, including4 independent-session cases; production integration remains unimplemented and hosted behavior unverified. Floor1 and rate-edit fractional policy not approved. DESIGN AGREED status retained.

- **G4A7 current policy / boundary:** [Approved floor/rate-reset and local source adapters](../operations/legacy-001G4A7-source-adapter-integration.md): living floor1 on missingHP-preserving max reduction; rate edit settles old eligible time/wholeHP, discards fraction, applies new rate and starts fresh accounting.24 native source-adapter tests, including6 session cases, do not establish full production/hosted parity. DESIGN AGREED remains; no runtime implementation/deployment claim.

- **G4A19 current approved amendment / local candidate:** [Implementation and limits](../operations/legacy-001G4A19-simplified-admin-implementation.md) supersedes historical60s/5%-per-minute timing with default2% maxHP per4eligible seconds, per-creature0–100%/two decimals; no blocked/retroactive credit, exact fractional intervals and ordinary dead respawn preserved. Simplified Admin clients/SQL are locally implemented and gated, not installed; full HP transition composition remains incomplete. DESIGN AGREED is not promoted to implemented/hosted verified.

#### WOV-IDEA-009 — Finish encounters after effects and actions resolve

- **Status / kind:** DESIGN AGREED; Design decision. Authoritative source disposition: 001A classification DESIGN AGREED; see linked original report for exact decision.
- **Intent:** Future completion boundary waits for active combat effects and pending actions.
- **Approval evidence:** Direction agreed: F11 owner-supplied direction, retained by F12; no implementation approval. Source: [legacy-001F11-evidence-and-closure-assessment.md:41](../operations/legacy-001F11-evidence-and-closure-assessment.md) line41.
- **Implementation/runtime boundary:** NOT IMPLEMENTED by F11/F12; no runtime result or balance algorithm asserted.
- **Dependencies / overlaps:** WOV-IDEA-006; active-effect/action authority.
- **001A mapping / current tracking:** INV-A09 → WOV-IDEA-009; F11/state/roadmap narrative; not implemented.

#### WOV-IDEA-016 — Level1 creature-kill difficulty/failure

- **Status / kind:** NEEDS AUDIT; Unresolved question. Authoritative source disposition: 001A classification NEEDS AUDIT; see linked original report for exact decision.
- **Intent:** Owner cannot successfully kill creatures; no evidence selects balance versus functional cause.
- **Approval evidence:** Documented proposal/finding or accepted limit; no new implementation approval established here. Source: [legacy-001D10-closeout.md:23](../operations/legacy-001D10-closeout.md) line23.
- **Implementation/runtime boundary:** Owner-reported functional problem; cause unestablished, no repair or reproduction performed.
- **Dependencies / overlaps:** Minimal separately authorized reproduction.
- **001A mapping / current tracking:** INV-A16 → WOV-IDEA-016; State product_backlog; not proven by later party refusal smoke.

#### WOV-IDEA-030 — Rend initial weapon-hit balance formula

- **Status / kind:** DEFERRED; Design decision. Authoritative source disposition: 001A classification DEFERRED; see linked original report for exact decision.
- **Intent:** Deferred weapon-hit balance formula; keep separate from delivered semantic/publication changes.
- **Approval evidence:** Documented proposal/finding or accepted limit; no new implementation approval established here. Source: [game-engine-roadmap.md:12](game-engine-roadmap.md) line12.
- **Implementation/runtime boundary:** No implementation, hosted or runtime evidence established by this register; retain dated evidence and limitations in source.
- **Dependencies / overlaps:** ENG-ABILITY-001 and separate balance decision.
- **001A mapping / current tracking:** INV-A30 → WOV-IDEA-030; Roadmap remaining gates; overlaps ENG-BALANCE-001, no distinct ID.

### Parties and movement

#### ENG-MOVE-001 — Immediate serialized Combat2 departure

- **Status / kind:** IN PROGRESS; Feature / technical change. Authoritative source disposition: movement/concurrency; `live_verification_pending`.
- **Intent:** one synchronous authoritative transition serialized with encounter processing: departure-first excludes the fighter from the next tick; tick-first commits then a surviving fighter departs; MP, relocation and non-damage cleanup occur exactly once.
- **Approval evidence:** Existing roadmap scope/status only; not fresh implementation or release authorization. Source: [game-engine-roadmap.md:25](game-engine-roadmap.md) line25.
- **Implementation/runtime boundary:** Source/dated rollout evidence exists; live_verification_pending is not comprehensive runtime PASS.
- **Dependencies / overlaps:** bounded solo/party race and live verification.
- **001A mapping / current tracking:** ENG-MOVE-001 → ENG-MOVE-001; Roadmap; state evidence varies.

#### ENG-PARTY-001 — Coordinated party movement release verification

- **Status / kind:** IN PROGRESS; Technical correction / evidence work. Authoritative source disposition: movement/party; `live_verification_pending`.
- **Intent:** prove per-member outcomes, lifecycle release and reconnect without changing semantics.
- **Approval evidence:** Existing roadmap scope/status only; not fresh implementation or release authorization. Source: [game-engine-roadmap.md:196](game-engine-roadmap.md) line196.
- **Implementation/runtime boundary:** Source/dated rollout evidence exists; live_verification_pending is not comprehensive runtime PASS.
- **Dependencies / overlaps:** safe bounded party scenario.
- **001A mapping / current tracking:** ENG-PARTY-001 → ENG-PARTY-001; Roadmap; state evidence varies.

#### ENG-LIFECYCLE-001 — Inactive-character return-home

- **Status / kind:** UNKNOWN; Feature / technical change. Authoritative source disposition: lifecycle/movement; `decision_needed`.
- **Intent:** idempotent authoritative transition after the same configured inactivity duration used by unique-item policy, with future bind-point extension.
- **Approval evidence:** Existing roadmap scope/status only; not fresh implementation or release authorization. Source: [game-engine-roadmap.md:223](game-engine-roadmap.md) line223.
- **Implementation/runtime boundary:** No implementation, hosted or runtime evidence established by this register; retain dated evidence and limitations in source.
- **Dependencies / overlaps:** authoritative activity evidence; verified destination; party/transaction rules.
- **001A mapping / current tracking:** ENG-LIFECYCLE-001 → ENG-LIFECYCLE-001; Roadmap; state evidence varies.

#### WOV-IDEA-001 — Single active gameplay character

- **Status / kind:** IDEA; Feature. Authoritative source disposition: 001A classification IDEA; see linked original report for exact decision.
- **Intent:** Server-enforced single ordinary active character; other tabs may be read-only.
- **Approval evidence:** Documented proposal/finding or accepted limit; no new implementation approval established here. Source: [single-active-gameplay-character.md:1](../design/single-active-gameplay-character.md) line1.
- **Implementation/runtime boundary:** No implementation, hosted or runtime evidence established by this register; retain dated evidence and limitations in source.
- **Dependencies / overlaps:** Authoritative activity/lease boundary; privileged exceptions.
- **001A mapping / current tracking:** INV-A01 → WOV-IDEA-001; Design only; state/roadmap dedicated ID absent.

#### ENG-LEGACY-001F-R3-RETRY — Party malformed-response UUID retention

- **Status / kind:** DEFERRED; Technical correction. Authoritative source disposition: Source disposition described; INV IDs proposed discovery identifiers only.
- **Intent:** Keep original request identity on uncertain malformed response; owner accepts OPEN deferred correction, not fixed.
- **Approval evidence:** F12 explicitly accepts deferral; OPEN, NOT FIXED; no implementation authorization. Source: [legacy-001F11-evidence-and-closure-assessment.md:69](../operations/legacy-001F11-evidence-and-closure-assessment.md) line69.
- **Implementation/runtime boundary:** NOT FIXED. F10 exact replay/refusal PASS is sequential hosted evidence, not malformed-response recovery or hosted concurrency proof.
- **Dependencies / overlaps:** Narrow caller-state regression/correction authorization.
- **001A mapping / current tracking:** ENG-LEGACY-001F-R3-RETRY → ENG-LEGACY-001F-R3-RETRY; State product_backlog; roadmap F12 reference.

### World timing, delivery and verification

#### ENG-HB-001 — Explicit global heartbeat identity

- **Status / kind:** IN PROGRESS; Feature / technical change. Authoritative source disposition: scheduling; `live_verification_pending`.
- **Intent:** a durable monotonic scheduler-invocation identity carried as correlation metadata to settlement, selected nodes, claims, commits and bounded diagnostics without changing local encounter tick semantics or delaying immediate transactions.
- **Approval evidence:** Existing roadmap scope/status only; not fresh implementation or release authorization. Source: [game-engine-roadmap.md:55](game-engine-roadmap.md) line55.
- **Implementation/runtime boundary:** Source/dated rollout evidence exists; live_verification_pending is not comprehensive runtime PASS.
- **Dependencies / overlaps:** bounded observation of the remaining ineligible, retry, failure and catch-up branches; no further source implementation dependency.
- **001A mapping / current tracking:** ENG-HB-001 → ENG-HB-001; Roadmap; state evidence varies.

#### ENG-HB-003 — Two-second encounter schedule phase correction

- **Status / kind:** IN PROGRESS; Feature / technical change. Authoritative source disposition: combat timing; `live_verification_pending`.
- **Intent:** preserve one encounter tick per eligible two-second heartbeat by advancing from the previous authoritative server deadline, while skipping obsolete opportunities after delays and never replaying combat debt.
- **Approval evidence:** Existing roadmap scope/status only; not fresh implementation or release authorization. Source: [game-engine-roadmap.md:65](game-engine-roadmap.md) line65.
- **Implementation/runtime boundary:** Source/dated rollout evidence exists; live_verification_pending is not comprehensive runtime PASS.
- **Dependencies / overlaps:** bounded live verification; no gameplay decision or further source dependency remains.
- **001A mapping / current tracking:** ENG-HB-003 → ENG-HB-003; Roadmap; state evidence varies.

#### ENG-DIAG-001 — Limited latency and jitter measurement

- **Status / kind:** IDEA; Technical correction / evidence work. Authoritative source disposition: diagnostics; `ready`.
- **Intent:** bounded, sanitized measurements with no gameplay mutation beyond a controlled run.
- **Approval evidence:** Existing roadmap scope/status only; not fresh implementation or release authorization. Source: [game-engine-roadmap.md:75](game-engine-roadmap.md) line75.
- **Implementation/runtime boundary:** No implementation, hosted or runtime evidence established by this register; retain dated evidence and limitations in source.
- **Dependencies / overlaps:** existing bounded diagnostics.
- **001A mapping / current tracking:** ENG-DIAG-001 → ENG-DIAG-001; Roadmap; state evidence varies.

#### ENG-DIAG-002 — Distinguish world heartbeat and encounter tick

- **Status / kind:** IDEA; Feature / technical change. Authoritative source disposition: diagnostics/presentation; `planned`.
- **Intent:** diagnostics and admin presentation label both concepts unambiguously.
- **Approval evidence:** Existing roadmap scope/status only; not fresh implementation or release authorization. Source: [game-engine-roadmap.md:85](game-engine-roadmap.md) line85.
- **Implementation/runtime boundary:** No implementation, hosted or runtime evidence established by this register; retain dated evidence and limitations in source.
- **Dependencies / overlaps:** ENG-HB-001.
- **001A mapping / current tracking:** ENG-DIAG-002 → ENG-DIAG-002; Roadmap; state evidence varies.

#### ENG-VERIFY-001 — Complete installed-schema execution coverage

- **Status / kind:** IDEA; Technical correction / evidence work. Authoritative source disposition: verification; `planned`.
- **Intent:** reproducible executable-schema and bounded installed verification for critical chains.
- **Approval evidence:** Existing roadmap scope/status only; not fresh implementation or release authorization. Source: [game-engine-roadmap.md:111](game-engine-roadmap.md) line111.
- **Implementation/runtime boundary:** No implementation, hosted or runtime evidence established by this register; retain dated evidence and limitations in source.
- **Dependencies / overlaps:** safe non-production fixture policy.
- **001A mapping / current tracking:** ENG-VERIFY-001 → ENG-VERIFY-001; Roadmap; state evidence varies.

#### ENG-HB-002 — Heartbeat performance and scaling

- **Status / kind:** DEFERRED; Feature / technical change. Authoritative source disposition: scheduling; `deferred`.
- **Intent:** measured bounded due-work scaling while retaining one authority.
- **Approval evidence:** Existing roadmap scope/status only; not fresh implementation or release authorization. Source: [game-engine-roadmap.md:234](game-engine-roadmap.md) line234.
- **Implementation/runtime boundary:** No implementation, hosted or runtime evidence established by this register; retain dated evidence and limitations in source.
- **Dependencies / overlaps:** ENG-HB-001 and production metrics.
- **001A mapping / current tracking:** ENG-HB-002 → ENG-HB-002; Roadmap; state evidence varies.

#### ENG-DELIVERY-001 — Reduce fallback polling

- **Status / kind:** DEFERRED; Feature / technical change. Authoritative source disposition: delivery; `deferred`.
- **Intent:** reduce it only after reliability evidence.
- **Approval evidence:** Existing roadmap scope/status only; not fresh implementation or release authorization. Source: [game-engine-roadmap.md:243](game-engine-roadmap.md) line243.
- **Implementation/runtime boundary:** No implementation, hosted or runtime evidence established by this register; retain dated evidence and limitations in source.
- **Dependencies / overlaps:** measured Realtime recovery and gap visibility.
- **001A mapping / current tracking:** ENG-DELIVERY-001 → ENG-DELIVERY-001; Roadmap; state evidence varies.

#### WOV-IDEA-010 — Sleep-consistent creature OOC regeneration

- **Status / kind:** DESIGN AGREED; Design decision. Authoritative source disposition: 001A classification DESIGN AGREED; see linked original report for exact decision.
- **Intent:** Keep ordinary regeneration logically consistent across world sleep; eligible elapsed sleep accounting approved in G4A3; exact accounting implementation remains proposed.
- **Approval evidence:** Direction agreed: F11 owner-supplied direction, retained by F12; no implementation approval. Source: [legacy-001F11-evidence-and-closure-assessment.md:41](../operations/legacy-001F11-evidence-and-closure-assessment.md) line41.
- **Implementation/runtime boundary:** NOT IMPLEMENTED by F11/F12; no runtime result or balance algorithm asserted.
- **Dependencies / overlaps:** Single heartbeat; WOV-IDEA-007/08; joint DoT/regen balance review.
- **001A mapping / current tracking:** INV-A10 → WOV-IDEA-010; F11/state/roadmap narrative; no dedicated ID.

- **G4A3 owner direction / remaining design:** [Approved HP contract and configuration readiness](../operations/legacy-001G4A3-creature-hp-contract-readiness.md): durable creatures.hp and synchronized projections; relevant effects/actions block regeneration; 60 seconds continuous OOC delay; eligible sleep credit; no pre-initialization credit; dead ordinary respawn; active attachment prevents reassignment. Per-creature configuration required. 5% maxHP/minute provisional only; rate bounds/defaults, exact blockers, fractions and edit policies still need decisions. DESIGN AGREED, not IMPLEMENTED or runtime-verified; no implementation authorization.

- **G4A4 current approval / proof:** [Owner contract and isolated proof](../operations/legacy-001G4A4-creature-regen-accounting-proof.md) supersede G4A3 provisional rate/range/init questions: 5% default for new/existing creatures, configurable decimal 0–100%, zero disables ordinary regeneration only, no historical initialization healing, persistent fractional HP between settlements, active-attachment rate-edit refusal. Pure model only; exact production transition coverage, interruption/edit policy and persistence remain unimplemented/unverified. DESIGN AGREED remains unchanged.

- **G4A6 current decision / local evidence:** [Owner decisions and isolated SQL candidate](../operations/legacy-001G4A6-local-creature-hp-candidate.md): up to two decimal percentage places; retain whole HP/discard fraction on renewed combat; wounded maxHP edits preserve missing HP with floor boundary pending; quiescent ended reassignment permitted. Native local26-test fixture passes, including4 independent-session cases; production integration remains unimplemented and hosted behavior unverified. Floor1 and rate-edit fractional policy not approved. DESIGN AGREED status retained.

- **G4A7 current policy / boundary:** [Approved floor/rate-reset and local source adapters](../operations/legacy-001G4A7-source-adapter-integration.md): living floor1 on missingHP-preserving max reduction; rate edit settles old eligible time/wholeHP, discards fraction, applies new rate and starts fresh accounting.24 native source-adapter tests, including6 session cases, do not establish full production/hosted parity. DESIGN AGREED remains; no runtime implementation/deployment claim.

### Authority and legacy governance

- **G4A19 current approved amendment / local candidate:** [Implementation and limits](../operations/legacy-001G4A19-simplified-admin-implementation.md) supersedes historical60s/5%-per-minute timing with default2% maxHP per4eligible seconds, per-creature0–100%/two decimals; no blocked/retroactive credit, exact fractional intervals and ordinary dead respawn preserved. Simplified Admin clients/SQL are locally implemented and gated, not installed; full HP transition composition remains incomplete. DESIGN AGREED is not promoted to implemented/hosted verified.

#### ENG-LEGACY-001 — Remaining gameplay-writer audit

- **Status / kind:** IN PROGRESS; Technical correction / evidence work. Authoritative source disposition: authority boundaries; `implemented_source`.
- **Intent:** inventory of every HP/CP/MP/position/effect/reward writer, with active paths fenced to authoritative contracts.
- **Approval evidence:** Existing roadmap scope/status only; not fresh implementation or release authorization. Source: [game-engine-roadmap.md:95](game-engine-roadmap.md) line95.
- **Implementation/runtime boundary:** Parent OPEN; B–F accepted closed. Those audit closures do not certify all gameplay or authorize World audit.
- **Dependencies / overlaps:** none.
- **001A mapping / current tracking:** ENG-LEGACY-001 → ENG-LEGACY-001; Parent OPEN in current state; B–F closed with accepted limitations; World domain not started.

#### ENG-UX-001 — Combat feedback refinement

- **Status / kind:** DEFERRED; Feature / technical change. Authoritative source disposition: presentation; `deferred`.
- **Intent:** concise state and timing feedback grounded in projections.
- **Approval evidence:** Existing roadmap scope/status only; not fresh implementation or release authorization. Source: [game-engine-roadmap.md:252](game-engine-roadmap.md) line252.
- **Implementation/runtime boundary:** No implementation, hosted or runtime evidence established by this register; retain dated evidence and limitations in source.
- **Dependencies / overlaps:** ENG-COMBAT-001, ENG-DIAG-002.
- **001A mapping / current tracking:** ENG-UX-001 → ENG-UX-001; Roadmap; state evidence varies.

#### ENG-LEGACY-002 — Remove obsolete legacy runtime surfaces (remaining gates only)

- **Status / kind:** UNKNOWN — source-complete, remaining gate disposition requires dated evidence; Feature / technical change. Authoritative source disposition: authority cleanup; `implemented_source`.
- **Intent:** Do not reimplement delivered source. Reconcile only remaining prerequisites/verification: ENG-LEGACY-001, separate implementation authorization, and installed/live dependency proof for SQL or endpoint retirement.
- **Approval evidence:** Existing roadmap scope/status only; not fresh implementation or release authorization. Source: [game-engine-roadmap.md:288](game-engine-roadmap.md) line288.
- **Implementation/runtime boundary:** Source implementation only in 001A; remaining gates below unresolved at that source snapshot. Check authoritative dated state before release; no hosted proof added.
- **Dependencies / overlaps:** ENG-LEGACY-001, separate implementation authorization, and installed/live dependency proof for SQL or endpoint retirement.
- **001A mapping / current tracking:** ENG-LEGACY-002 → ENG-LEGACY-002; Roadmap; state evidence varies.

#### WOV-IDEA-026 — Privileged v3 to v2 delegation/external helper authority

- **Status / kind:** DEFERRED; Unresolved question. Authoritative source disposition: 001A classification DEFERRED; see linked original report for exact decision.
- **Intent:** Accepted uncertainty neither proven contained nor exploitable; retained restricted legacy paths.
- **Approval evidence:** Documented proposal/finding or accepted limit; no new implementation approval established here. Source: [progression-001G-F-closure-checklist.md:56](../operations/progression-001G-F-closure-checklist.md) line56.
- **Implementation/runtime boundary:** No implementation, hosted or runtime evidence established by this register; retain dated evidence and limitations in source.
- **Dependencies / overlaps:** Scoped dependency/installed authority evidence; ENG-LEGACY-001.
- **001A mapping / current tracking:** INV-A26 → WOV-IDEA-026; Closure/state/legacy inventories; not a new full audit approval.

#### WOV-IDEA-027 — Legacy Combat1 lock-order hazard

- **Status / kind:** DEFERRED; Technical correction. Authoritative source disposition: 001A classification DEFERRED; see linked original report for exact decision.
- **Intent:** Owner accepts unresolved lock-order risk; not repaired by Party serialization correction.
- **Approval evidence:** Documented proposal/finding or accepted limit; no new implementation approval established here. Source: [legacy-001F11-evidence-and-closure-assessment.md:25](../operations/legacy-001F11-evidence-and-closure-assessment.md) line25.
- **Implementation/runtime boundary:** No implementation, hosted or runtime evidence established by this register; retain dated evidence and limitations in source.
- **Dependencies / overlaps:** Separate narrowly authorized legacy correction.
- **001A mapping / current tracking:** INV-A27 → WOV-IDEA-027; Party state/roadmap narrative.

### Progression and character lifecycle

#### ENG-XP-001 — Max-level XP award verification and correction

- **Status / kind:** IDEA; Technical correction / evidence work. Authoritative source disposition: progression/rewards; `planned`.
- **Intent:** characters at the configured maximum level receive no additional persisted XP, and presentation accurately reflects the authoritative result.
- **Approval evidence:** Existing roadmap scope/status only; not fresh implementation or release authorization. Source: [game-engine-roadmap.md:178](game-engine-roadmap.md) line178.
- **Implementation/runtime boundary:** No implementation, hosted or runtime evidence established by this register; retain dated evidence and limitations in source.
- **Dependencies / overlaps:** separately authorized read-only evidence distinguishing emitted log data from the persisted character row; no reward change is part of the stance design.
- **001A mapping / current tracking:** ENG-XP-001 → ENG-XP-001; Roadmap; state evidence varies.

#### WOV-IDEA-002 — Personal home / bind destination

- **Status / kind:** IDEA; Feature. Authoritative source disposition: 001A classification IDEA; see linked original report for exact decision.
- **Intent:** Future personal destination extends default inactive return-home.
- **Approval evidence:** Documented proposal/finding or accepted limit; no new implementation approval established here. Source: [project-state.json:2735](../operations/project-state.json) line2735.
- **Implementation/runtime boundary:** No implementation, hosted or runtime evidence established by this register; retain dated evidence and limitations in source.
- **Dependencies / overlaps:** ENG-LIFECYCLE-001; destination/activity decisions.
- **001A mapping / current tracking:** INV-A02 → WOV-IDEA-002; State product_backlog; part of ENG-LIFECYCLE-001, no separate ID.

#### WOV-IDEA-022 — Administrative XP grants

- **Status / kind:** DEFERRED; Feature / design decision. Authoritative source disposition: 001A classification DEFERRED; see linked original report for exact decision.
- **Intent:** Remain paused; decide authority/caps before any reactivation; normal gameplay XP not intentionally paused.
- **Approval evidence:** Documented proposal/finding or accepted limit; no new implementation approval established here. Source: [progression-001G-D-simplified-admin-policy.md:25](../design/progression-001G-D-simplified-admin-policy.md) line25.
- **Implementation/runtime boundary:** No implementation, hosted or runtime evidence established by this register; retain dated evidence and limitations in source.
- **Dependencies / overlaps:** Future policy and canonical authority.
- **001A mapping / current tracking:** INV-A22 → WOV-IDEA-022; Progression closure/state/roadmap; no activation authorization.

#### WOV-IDEA-023 — Administrative RP awards/Renown corrections

- **Status / kind:** DEFERRED; Design decision. Authoritative source disposition: 001A classification DEFERRED; see linked original report for exact decision.
- **Intent:** Deferred lifetime-reward semantics and coherent corrections; RP earning authority gap remains OPEN.
- **Approval evidence:** Documented proposal/finding or accepted limit; no new implementation approval established here. Source: [progression-001G-D-simplified-admin-policy.md:25](../design/progression-001G-D-simplified-admin-policy.md) line25.
- **Implementation/runtime boundary:** No implementation, hosted or runtime evidence established by this register; retain dated evidence and limitations in source.
- **Dependencies / overlaps:** Separate reward/earning policy.
- **001A mapping / current tracking:** INV-A23 → WOV-IDEA-023; Progression closure/state; overlaps open F limitation.

### Inventory, economy and rewards

#### ENG-FOOD-001 — Authoritative food effects

- **Status / kind:** IDEA; Feature / technical change. Authoritative source disposition: resources/effects; `planned`.
- **Intent:** durable server-owned food effect consumed consistently by both owners.
- **Approval evidence:** Existing roadmap scope/status only; not fresh implementation or release authorization. Source: [game-engine-roadmap.md:187](game-engine-roadmap.md) line187.
- **Implementation/runtime boundary:** No implementation, hosted or runtime evidence established by this register; retain dated evidence and limitations in source.
- **Dependencies / overlaps:** effect ownership schema.
- **001A mapping / current tracking:** ENG-FOOD-001 → ENG-FOOD-001; Roadmap; state evidence varies.

#### ENG-REWARD-001 — Complete ADM-025B reward channels

- **Status / kind:** UNKNOWN — authoritative source blocked; 001A IDEA label is not approval; Feature / technical change. Authoritative source disposition: rewards; `blocked`.
- **Intent:** exclusive item source, independent gold/salvage and exactly-once materialization without data loss.
- **Approval evidence:** Existing roadmap scope/status only; not fresh implementation or release authorization. Source: [game-engine-roadmap.md:205](game-engine-roadmap.md) line205.
- **Implementation/runtime boundary:** No implementation, hosted or runtime evidence established by this register; retain dated evidence and limitations in source.
- **Dependencies / overlaps:** ENG-REWARD-002 decisions and explicit installation preflight. Source-only implementation reference ADM-025B; authoring decision remains ENG-REWARD-002.
- **001A mapping / current tracking:** ENG-REWARD-001 → ENG-REWARD-001; Roadmap; state evidence varies.

#### ENG-REWARD-002 — Unique-item authoring decisions

- **Status / kind:** UNKNOWN; Feature / technical change. Authoritative source disposition: rewards/content contract; `decision_needed`.
- **Intent:** explicit ordered multi-unique schema and authoring validation with no source fallback.
- **Approval evidence:** Existing roadmap scope/status only; not fresh implementation or release authorization. Source: [game-engine-roadmap.md:214](game-engine-roadmap.md) line214.
- **Implementation/runtime boundary:** No implementation, hosted or runtime evidence established by this register; retain dated evidence and limitations in source.
- **Dependencies / overlaps:** product decision by Mik. ADM-025B and WOV-IDEA-028/029 are linked extensions, not automatic fallback approval.
- **001A mapping / current tracking:** ENG-REWARD-002 → ENG-REWARD-002; Roadmap; state evidence varies.

#### WOV-IDEA-015 — Crafting functional failure

- **Status / kind:** IN PROGRESS; Technical correction. Owner authorized canonical base-item restoration locally and Git publication on 2026-10-20.
- **Intent / confirmed cause:** forge-craft-base intentionally returns HTTP503 crafting_paused after the progression cutover; restore supported base crafting atomically, not deprecated XP writers. Level1 tier1 remains 7 salvage + 5gold / 25 canonical XP.
- **Approval evidence:** Owner implementation request; original [D10 functional report](../operations/legacy-001D10-closeout.md), [implementation and delivery handoff](../operations/idea-015-base-crafting-handoff.md).
- **Implementation/runtime boundary:** 0025 installed and forge-craft-base deployed per recorded Lovable evidence; Mik reports manual frontend publication and successful production crafting with Calikon (item creation and XP award). Exact deltas, UUID replay/conflict and refusals remain unverified. Functional restoration observed; bounded accounting/replay/refusal acceptance remains IN PROGRESS. See [runtime evidence](../operations/idea-015-runtime-equipment-regression.md). Gem application/fusion stay paused.
- **Dependencies / overlaps:** Canonical private craft_completion XP, existing private inventory-action ledger, Database, Edge, manual publication and basic authenticated craft observed at their recorded evidence levels; only original bounded accounting/replay/refusal acceptance remains. Equipment regression is separate (WOV-IDEA-013), not a new crafting gate. Costs/rules preserved; unrelated crafting and WOV-IDEA-016 excluded.
- **001A mapping / current tracking:** INV-A15 → WOV-IDEA-015; project-state operational evidence and product backlog; no new engine ID.

#### WOV-IDEA-033 — Canonical gem application restoration

- **Status / kind:** IN PROGRESS; Technical correction. Owner approved local implementation and Git publication on2026-10-21, not hosted activation.
- **Intent:** Restore intentionally paused forge-apply-gem using one atomic service-authorized completion: +1 attribute, one gem, (2+item level) salvage, 2×level gold and25 XP offered through private craft_completion.
- **Approval evidence / source:** Owner restoration instruction; historical [D6 pause inventory](../operations/legacy-001D1-inventory-items-crafting-writer-map.md) and [001D fence](../operations/progression-001D-cutover-plan.md); [local candidate and delivery handoff](../operations/idea-033-gem-application-handoff.md).
- **Implementation/runtime boundary:** SQL/Edge/frontend prepared and tested locally, NOT installed/deployed/manually published/runtime-verified. Server validates owner/lifecycle/station/item/caps/budget/costs, serializes combat/equipment, binds completion UUID, synchronizes equipped resources and rolls all effects back on failure. No deprecated XP writer reactivated.
- **Dependencies / overlaps:** Canonical XP/derived-resource private primitives, existing inventory-action ledger and Combat2/lifecycle/stance fences. Separate from015 base crafting,020 strip/trade and fusion;014 empty-override semantics and broader012/013 resource issues remain unchanged.
- **Tracking / gates:** New stable ID033 (next after032); project-state operational evidence. Database parity/installation → matching forge-apply-gem deployment → Mik manual Publish → separately authorized runtime acceptance. No implementation priority or wider audit implied.

#### WOV-IDEA-017 — Vendor transaction atomicity

- **Status / kind:** DEFERRED; Technical correction. Authoritative source disposition: 001A classification DEFERRED; see linked original report for exact decision.
- **Intent:** Accepted potential double credit, stale gold overwrite and partial failure; not proven exploited.
- **Approval evidence:** E13 accepts retained risk/deferral, not correction approval. Source: [legacy-001E13-economy-rewards-closeout.md:15](../operations/legacy-001E13-economy-rewards-closeout.md) line15.
- **Implementation/runtime boundary:** No implementation, hosted or runtime evidence established by this register; retain dated evidence and limitations in source.
- **Dependencies / overlaps:** Existing writer map; targeted transaction contract.
- **001A mapping / current tracking:** INV-A17 → WOV-IDEA-017; State product_backlog; E closure accepted risk.

#### WOV-IDEA-018 — Combat2 salvage-channel composition

- **Status / kind:** DEFERRED; Unresolved question. Authoritative source disposition: 001A classification DEFERRED; see linked original report for exact decision.
- **Intent:** Source implementations differ; installed runtime behavior inconclusive.
- **Approval evidence:** E13 accepts retained risk/deferral, not correction approval. Source: [legacy-001E13-economy-rewards-closeout.md:16](../operations/legacy-001E13-economy-rewards-closeout.md) line16.
- **Implementation/runtime boundary:** Installed salvage behavior inconclusive; source is not runtime proof.
- **Dependencies / overlaps:** Specific installed/reward evidence.
- **001A mapping / current tracking:** INV-A18 → WOV-IDEA-018; State product_backlog; overlaps ENG-REWARD-001.

#### WOV-IDEA-020 — Forge-strip and gem-trade partial mutation

- **Status / kind:** DEFERRED; Technical correction. Authoritative source disposition: 001A classification DEFERRED; see linked original report for exact decision.
- **Intent:** Unchecked multi-request strip/gem trading and partial failures remain unresolved writer-map findings.
- **Approval evidence:** Documented proposal/finding or accepted limit; no new implementation approval established here. Source: [legacy-001D10-closeout.md:13](../operations/legacy-001D10-closeout.md) line13.
- **Implementation/runtime boundary:** No implementation, hosted or runtime evidence established by this register; retain dated evidence and limitations in source.
- **Dependencies / overlaps:** D1 writer map and exact transaction evidence.
- **001A mapping / current tracking:** INV-A20 → WOV-IDEA-020; D closeout/state evidence, no standalone roadmap ID.

#### WOV-IDEA-021 — Unique transfer/market dependencies and soulring authority

- **Status / kind:** DEFERRED; Unresolved question. Authoritative source disposition: 001A classification DEFERRED; see linked original report for exact decision.
- **Intent:** Retained lock/identity and catalog/privileged helper uncertainties; not universally fenced.
- **Approval evidence:** Documented proposal/finding or accepted limit; no new implementation approval established here. Source: [legacy-001D10-closeout.md:13](../operations/legacy-001D10-closeout.md) line13.
- **Implementation/runtime boundary:** No implementation, hosted or runtime evidence established by this register; retain dated evidence and limitations in source.
- **Dependencies / overlaps:** ADM-025A and D1 dependencies.
- **001A mapping / current tracking:** INV-A21 → WOV-IDEA-021; D accepted findings; overlaps rewards/admin work.

#### WOV-IDEA-028 — Lesser-unique reward fallback

- **Status / kind:** DEFERRED; Feature. Authoritative source disposition: 001A classification DEFERRED; see linked original report for exact decision.
- **Intent:** Deferred optional product extension; not part of delivered exclusive-item contract.
- **Approval evidence:** Documented proposal/finding or accepted limit; no new implementation approval established here. Source: [admin-maintenance-backlog.md:28](../admin-maintenance-backlog.md) line28.
- **Implementation/runtime boundary:** No implementation, hosted or runtime evidence established by this register; retain dated evidence and limitations in source.
- **Dependencies / overlaps:** ENG-REWARD-002 authoring decision.
- **001A mapping / current tracking:** INV-A28 → WOV-IDEA-028; Admin backlog only at this granularity.

#### WOV-IDEA-029 — Marketplace expiry return-to-seller

- **Status / kind:** IDEA; Feature. Authoritative source disposition: 001A classification IDEA; see linked original report for exact decision.
- **Intent:** Possible deferred product extension, not approved implementation.
- **Approval evidence:** Documented proposal/finding or accepted limit; no new implementation approval established here. Source: [admin-maintenance-backlog.md:28](../admin-maintenance-backlog.md) line28.
- **Implementation/runtime boundary:** No implementation, hosted or runtime evidence established by this register; retain dated evidence and limitations in source.
- **Dependencies / overlaps:** Marketplace identity/escrow and explicit product decision.
- **001A mapping / current tracking:** INV-A29 → WOV-IDEA-029; Admin backlog mention; no dedicated state/roadmap item.

### Admin and documentation

#### ENG-ADMIN-001 — Admin Roadmap presentation integration

- **Status / kind:** IDEA; Feature / technical change. Authoritative source disposition: admin governance; `planned`.
- **Intent:** read-only build/import presentation keyed by stable ENG IDs while preserving product/content items.
- **Approval evidence:** Existing roadmap scope/status only; not fresh implementation or release authorization. Source: [game-engine-roadmap.md:270](game-engine-roadmap.md) line270.
- **Implementation/runtime boundary:** No implementation, hosted or runtime evidence established by this register; retain dated evidence and limitations in source.
- **Dependencies / overlaps:** source/Cloud schema and publication design.
- **001A mapping / current tracking:** ENG-ADMIN-001 → ENG-ADMIN-001; Roadmap; state evidence varies.

#### ENG-MANUAL-001 — Admin Game Manual integration

- **Status / kind:** IDEA; Feature / technical change. Authoritative source disposition: admin documentation; `planned`.
- **Intent:** present selected repository-backed specification sections with revision/date; keep authoring guidance distinct.
- **Approval evidence:** Existing roadmap scope/status only; not fresh implementation or release authorization. Source: [game-engine-roadmap.md:279](game-engine-roadmap.md) line279.
- **Implementation/runtime boundary:** No implementation, hosted or runtime evidence established by this register; retain dated evidence and limitations in source.
- **Dependencies / overlaps:** safe build-time content pipeline and admin access review.
- **001A mapping / current tracking:** ENG-MANUAL-001 → ENG-MANUAL-001; Roadmap; state evidence varies.

#### ENG-ADMIN-002 — Single-creature reset and despawn controls

- **Status / kind:** IDEA; Feature / technical change. Authoritative source disposition: admin/lifecycle; `planned`.
- **Intent:** separately named reset and despawn operations with server-derived admin authorization, transactional claim/state-version fencing, explicit creature effect/target/engagement handling, and durable audit evidence. Reset restores an approved lifecycle state; despawn removes the active instance under a separately specified contract. Neither grants kill credit, XP, loot or death effects.
- **Approval evidence:** Existing roadmap scope/status only; not fresh implementation or release authorization. Source: [game-engine-roadmap.md:297](game-engine-roadmap.md) line297.
- **Implementation/runtime boundary:** No implementation, hosted or runtime evidence established by this register; retain dated evidence and limitations in source.
- **Dependencies / overlaps:** read-only investigation of supported source/installed states; product decision defining reset versus despawn and allowed encounter conditions; concurrency design preserving unrelated creatures, characters, participation and reward history.
- **001A mapping / current tracking:** ENG-ADMIN-002 → ENG-ADMIN-002; Roadmap; state evidence varies.

### Admin and authoring

#### ADM-016 — Guide

- **Status / kind:** NEEDS AUDIT; Technical correction. Authoritative source disposition: open.
- **Intent:** Ordering and category/entry deletion consistency need focused review.
- **Approval evidence:** Existing admin queue entry; blocked/open is not approval to implement. Source: [admin-maintenance-backlog.md:21](../admin-maintenance-backlog.md) line21.
- **Implementation/runtime boundary:** No implementation, hosted or runtime evidence established by this register; retain dated evidence and limitations in source.
- **Dependencies / overlaps:** Define deletion/reorder semantics.
- **001A mapping / current tracking:** ADM-016 → ADM-016; Admin backlog authoritative; not individually keyed in engine roadmap; ADM-025 overlaps ENG-REWARD.

#### ADM-020 — Node Editor

- **Status / kind:** NEEDS AUDIT; Technical correction. Authoritative source disposition: open.
- **Intent:** Loads complete item, creature and NPC catalogues for local pickers and repeatedly reloads them.
- **Approval evidence:** Existing admin queue entry; blocked/open is not approval to implement. Source: [admin-maintenance-backlog.md:23](../admin-maintenance-backlog.md) line23.
- **Implementation/runtime boundary:** No implementation, hosted or runtime evidence established by this register; retain dated evidence and limitations in source.
- **Dependencies / overlaps:** Add scoped/paginated search without weakening selection.
- **001A mapping / current tracking:** ADM-020 → ADM-020; Admin backlog authoritative; not individually keyed in engine roadmap; ADM-025 overlaps ENG-REWARD.

#### ADM-021 — Items

- **Status / kind:** UNKNOWN; Design decision. Authoritative source disposition: blocked.
- **Intent:** Ownership of `tier`, `weapon_die`, `world_drop` and `drop_weight` is unclear between authoring and generated runtime records.
- **Approval evidence:** Existing admin queue entry; blocked/open is not approval to implement. Source: [admin-maintenance-backlog.md:24](../admin-maintenance-backlog.md) line24.
- **Implementation/runtime boundary:** No implementation, hosted or runtime evidence established by this register; retain dated evidence and limitations in source.
- **Dependencies / overlaps:** Product/data-owner decision required.
- **001A mapping / current tracking:** ADM-021 → ADM-021; Admin backlog authoritative; not individually keyed in engine roadmap; ADM-025 overlaps ENG-REWARD.

#### ADM-022 — Statuses

- **Status / kind:** UNKNOWN; Design decision. Authoritative source disposition: blocked.
- **Intent:** Buff/debuff terminology does not map cleanly to every active reusable status classification.
- **Approval evidence:** Existing admin queue entry; blocked/open is not approval to implement. Source: [admin-maintenance-backlog.md:25](../admin-maintenance-backlog.md) line25.
- **Implementation/runtime boundary:** No implementation, hosted or runtime evidence established by this register; retain dated evidence and limitations in source.
- **Dependencies / overlaps:** Agree player/admin taxonomy first.
- **001A mapping / current tracking:** ADM-022 → ADM-022; Admin backlog authoritative; not individually keyed in engine roadmap; ADM-025 overlaps ENG-REWARD.

#### ADM-023 — Abilities

- **Status / kind:** UNKNOWN; Design decision. Authoritative source disposition: blocked.
- **Intent:** Legacy ability aliases remain active compatibility inputs and cannot safely be removed from editors/runtime independently.
- **Approval evidence:** Existing admin queue entry; blocked/open is not approval to implement. Source: [admin-maintenance-backlog.md:26](../admin-maintenance-backlog.md) line26.
- **Implementation/runtime boundary:** No implementation, hosted or runtime evidence established by this register; retain dated evidence and limitations in source.
- **Dependencies / overlaps:** Retirement plan and data inventory required.
- **001A mapping / current tracking:** ADM-023 → ADM-023; Admin backlog authoritative; not individually keyed in engine roadmap; ADM-025 overlaps ENG-REWARD.

#### ADM-024 — Combat2 summons

- **Status / kind:** UNKNOWN; Design decision. Authoritative source disposition: blocked.
- **Intent:** Authoritative summon editing semantics and ownership are not yet defined.
- **Approval evidence:** Existing admin queue entry; blocked/open is not approval to implement. Source: [admin-maintenance-backlog.md:27](../admin-maintenance-backlog.md) line27.
- **Implementation/runtime boundary:** No implementation, hosted or runtime evidence established by this register; retain dated evidence and limitations in source.
- **Dependencies / overlaps:** Combat2 contract decision required.
- **001A mapping / current tracking:** ADM-024 → ADM-024; Admin backlog authoritative; not individually keyed in engine roadmap; ADM-025 overlaps ENG-REWARD.

#### ADM-030 — All admin pages

- **Status / kind:** NEEDS AUDIT; Technical correction. Authoritative source disposition: open.
- **Intent:** Full responsive layout, action hierarchy, density and accessibility review remains outstanding.
- **Approval evidence:** Existing admin queue entry; blocked/open is not approval to implement. Source: [admin-maintenance-backlog.md:30](../admin-maintenance-backlog.md) line30.
- **Implementation/runtime boundary:** No implementation, hosted or runtime evidence established by this register; retain dated evidence and limitations in source.
- **Dependencies / overlaps:** Complete technical correctness batches first.
- **001A mapping / current tracking:** ADM-030 → ADM-030; Admin backlog authoritative; not individually keyed in engine roadmap; ADM-025 overlaps ENG-REWARD.

#### WOV-IDEA-024 — Admin class-access/attribute/resource corrections

- **Status / kind:** DEFERRED; Feature. Authoritative source disposition: 001A classification DEFERRED; see linked original report for exact decision.
- **Intent:** Owner explicitly defers these correction tools, not cancelled.
- **Approval evidence:** Explicit owner deferral in simplified D policy; not cancelled or approved for activation. Source: [progression-001G-D-simplified-admin-policy.md:25](../design/progression-001G-D-simplified-admin-policy.md) line25.
- **Implementation/runtime boundary:** No implementation, hosted or runtime evidence established by this register; retain dated evidence and limitations in source.
- **Dependencies / overlaps:** Canonical growth/resource invariants and future per-tool authority. Historical umbrella ADM-015; explicit owner deferrals supersede older generic-update wording.
- **001A mapping / current tracking:** INV-A24 → WOV-IDEA-024; Progression D policy/state/roadmap; overlaps ADM-015.

#### WOV-IDEA-025 — Disabled admin convenience replacements

- **Status / kind:** DEFERRED; Feature. Authoritative source disposition: 001A classification DEFERRED; see linked original report for exact decision.
- **Intent:** Inventory/economy/teleport/full-heal/normal-semantic revive replacements deferred; containment remains delivered.
- **Approval evidence:** Explicit owner deferral in simplified D policy; not cancelled or approved for activation. Source: [progression-001G-D-simplified-admin-policy.md:25](../design/progression-001G-D-simplified-admin-policy.md) line25.
- **Implementation/runtime boundary:** No implementation, hosted or runtime evidence established by this register; retain dated evidence and limitations in source.
- **Dependencies / overlaps:** Narrow future contracts; C2/role invariants. Historical umbrella ADM-015; explicit owner deferrals supersede older generic-update wording.
- **001A mapping / current tracking:** INV-A25 → WOV-IDEA-025; Progression D state/roadmap; overlaps ADM-015.

### Resources and equipment

#### WOV-IDEA-011 — AC freshness and calculation differences

- **Status / kind:** DEFERRED; Technical correction. Authoritative source disposition: 001A classification DEFERRED; see linked original report for exact decision.
- **Intent:** Accepted unresolved persisted/dynamic AC freshness and calculation inconsistencies.
- **Approval evidence:** Documented proposal/finding or accepted limit; no new implementation approval established here. Source: [legacy-001C6-resource-domain-acceptance-proposal.md:3](../operations/legacy-001C6-resource-domain-acceptance-proposal.md) line3.
- **Implementation/runtime boundary:** No implementation, hosted or runtime evidence established by this register; retain dated evidence and limitations in source.
- **Dependencies / overlaps:** Consumer/formula authority evidence before correction.
- **001A mapping / current tracking:** INV-A11 → WOV-IDEA-011; C closure/state; no dedicated correction roadmap ID.

#### WOV-IDEA-012 — Missing equipment resource synchronization

- **Status / kind:** DEFERRED; Technical correction. Authoritative source disposition: 001A classification DEFERRED; see linked original report for exact decision.
- **Intent:** Equip/wear/repair/strip paths may not refresh resource maxima consistently.
- **Approval evidence:** Documented proposal/finding or accepted limit; no new implementation approval established here. Source: [legacy-001D10-closeout.md:13](../operations/legacy-001D10-closeout.md) line13.
- **Implementation/runtime boundary:** No implementation, hosted or runtime evidence established by this register; retain dated evidence and limitations in source.
- **Dependencies / overlaps:** C/D writer maps; resource authority.
- **001A mapping / current tracking:** INV-A12 → WOV-IDEA-012; C/D/state closure; not fixed by material sale.

#### WOV-IDEA-013 — Equipment callback transactionality

- **Status / kind:** IN PROGRESS for the bounded Equip/Unequip no-op and feedback correction; broader callback transactionality remains DEFERRED. Technical correction.
- **Intent:** Restore supported equipment RPC dispatch and visible refusal/refresh feedback; retain separate-transaction synchronization as unresolved rather than redesigning it.
- **Approval evidence:** Owner's 2026-10-20 equipment regression request authorizes a small evidence-backed fix. Original [D10/C-domain deferral](../operations/legacy-001D10-closeout.md); [confirmed cause and local patch](../operations/idea-015-runtime-equipment-regression.md).
- **Implementation/runtime boundary:** Confirmed pre-existing frontend legacy fence blocked both actions before RPC dispatch. Local frontend correction/tests only; not manually published or runtime-verified. Installed RPC/ACL and any further server refusal remain uninspected. Does not claim all sync/transactionality paths fixed.
- **Dependencies / overlaps:** WOV-IDEA-012; inventory action/stance/Combat2 fences retained. No SQL or Edge change; Mik's new manual frontend publication and equipment smoke remain.
- **001A mapping / current tracking:** INV-A13 → WOV-IDEA-013; C to D transfer retained; reuse existing callback-boundary tracking, no duplicate feature record.

#### WOV-IDEA-014 — Empty-object item override semantics

- **Status / kind:** DEFERRED; Design decision. Authoritative source disposition: 001A classification DEFERRED; see linked original report for exact decision.
- **Intent:** SQL/TS {} fallback discrepancy retained; intended policy not silently selected.
- **Approval evidence:** Documented proposal/finding or accepted limit; no new implementation approval established here. Source: [legacy-001D10-closeout.md:13](../operations/legacy-001D10-closeout.md) line13.
- **Implementation/runtime boundary:** No implementation, hosted or runtime evidence established by this register; retain dated evidence and limitations in source.
- **Dependencies / overlaps:** Item contract/consumer evidence.
- **001A mapping / current tracking:** INV-A14 → WOV-IDEA-014; C/D reports/state narrative; no dedicated ID.

### World, creatures and quests

#### WOV-IDEA-031 — Regional Bounty Boards & Shared Contract Framework

- **Status / kind:** IDEA; future gameplay feature and unresolved design questions. No implementation priority assigned.
- **Intent:** Town bounty boards offer contracts to any class, supporting meaningful local adventures rather than repetitive kill counts. Design preference: avoid “Kill5 Wolves.” Examples: a particular dangerous creature near a settlement, investigating traveler attacks, tracking a rare/named target, or a bounty tied to an NPC/location/local event. Examples are not approved mechanics or content.
- **Approval evidence:** Owner G2D request supplied2026-10-15 approves recording this IDEA only; [request summary/provenance](../operations/legacy-001G2D-contract-completion-delegate-trace.md#b--owner-provided-future-idea-separately-recorded). Do not promote to DESIGN AGREED.
- **Implementation/runtime boundary:** Not implemented or runtime-verified. Existing Assassin contracts remain unchanged; possible class-specific specialization is not an approved redesign/removal.
- **Open decisions:** Individual/archetype/event targets; continuity across respawn/replacement; qualified multiplayer participation; possible gold/XP/Renown/other rewards; regional availability/expiration; Assassin specialization versus public bounties. No reward channel/amount or data model selected.
- **Dependencies / overlaps:** [WOV-IDEA-032](#wov-idea-032--creature-display-name-and-technical-identity-generalization), [WOV-IDEA-019](#wov-idea-019--contractquest-authority-and-reward-coverage), [G2 findings](../operations/legacy-001G2-assassin-contract-authority.md) and [G2D trace](../operations/legacy-001G2D-contract-completion-delegate-trace.md). Future quest targeting must not treat display names as unique identifiers. No creature_type_id or any other schema field is approved.
- **001A mapping / review:** New after001A; not a replacement or closure of existing quest findings. Registration owner-reviewed as IDEA; design/implementation approval pending.

#### WOV-IDEA-032 — Creature display-name and technical-identity generalization

- **Status / kind:** IDEA; future creature identity design question, not a selected schema.
- **Intent:** Common creatures may share display names while retaining unique technical IDs. Names must not become quest/contract identity keys. Archetype, region/area, specific instance, unique rare/boss or event are potential target concepts; representation and respawn/replacement semantics remain undecided.
- **Approval evidence:** Already mentioned among [G1 future exclusions](../operations/legacy-001G1-world-creatures-quests-preparation.md#ownership-boundaries-and-exclusions); owner G2D authorizes recording its relationship to the bounty idea. No standalone register ID existed before G2D; this keys the proposal without inventing historical implementation or DESIGN AGREED status.
- **Implementation/runtime boundary:** No schema field, name change, template/instance redesign, migration or quest conversion implemented/approved. Existing Assassin creature UUID matching does not establish the future generalization.
- **Dependencies / overlaps:** [WOV-IDEA-031](#wov-idea-031--regional-bounty-boards--shared-contract-framework), existing creature authoring/encounter identity evidence and later owner design review. WOV-IDEA-007 persistent creature HP is distinct, not an alias. No NodeView miniature feature or content added.
- **001A mapping / review:** New keyed record after001A for an unkeyed existing proposal; [G2D provenance](../operations/legacy-001G2D-contract-completion-delegate-trace.md#b--owner-provided-future-idea-separately-recorded). Registration authorized; design/implementation approval pending.

#### WOV-IDEA-019 — Contract/quest authority and reward coverage

- **Status / kind:** NEEDS AUDIT; Technical correction / evidence work. Authoritative source disposition: 001A classification NEEDS AUDIT; see linked original report for exact decision.
- **Intent:** Unresolved completion/event/replay and privileged reward-helper coverage transferred from E.
- **Approval evidence:** E13 transfers unresolved coverage; not resolved or repair-approved. Source: [legacy-001E13-economy-rewards-closeout.md:17](../operations/legacy-001E13-economy-rewards-closeout.md) line17.
- **Implementation/runtime boundary:** No implementation, hosted or runtime evidence established by this register; retain dated evidence and limitations in source.
- **Dependencies / overlaps:** Planned World domain; no repairs authorized.
- **001A mapping / current tracking:** INV-A19 → WOV-IDEA-019; State product_backlog and roadmap receiving domain.

#### ENG-LEGACY-001G1 — World domain scope/evidence preparation

- **Status / kind:** IDEA; Technical correction / evidence work. Authoritative source disposition: Source disposition described; INV IDs proposed discovery identifiers only.
- **Intent:** Next proposed bounded preparation; reuse inventories and transferred quest findings, not started.
- **Approval evidence:** Proposed next preparation only; F12 does not start audit. Source: [legacy-001F11-evidence-and-closure-assessment.md:75](../operations/legacy-001F11-evidence-and-closure-assessment.md) line75.
- **Implementation/runtime boundary:** No implementation, hosted or runtime evidence established by this register; retain dated evidence and limitations in source.
- **Dependencies / overlaps:** F12 closure and explicit next-task authorization.
- **001A mapping / current tracking:** ENG-LEGACY-001G1 → ENG-LEGACY-001G1; State next_approved_task and engine roadmap.

## Completed references and retained limitations

These 17 source-complete/reference rows are **not new work**. Source implementation/completed status is copied from 001A only, not a claim of hosted deployment or comprehensive runtime verification. ADM-025A/B retain compatibility/release questions at their original sources and overlapping ENG-REWARD records; do not automatically reinstall anything.

| Existing ID /001A mapping | Reference status and source | Remaining context |
|---|---|---|
| ENG-PROGRESSION-001 — Canonical character progression authority | progression; `implemented_source` for 001A contract/reference only; runtime authority remains planned; 10.; [game-engine-roadmap.md:143](game-engine-roadmap.md) line143 | Final A–H accepted closure supersedes historical body; all open limits below persist. |
| ADM-001 — Item Manager | completed; [admin-maintenance-backlog.md:7](../admin-maintenance-backlog.md) line7 | Repository safeguards only; exact deployment/runtime scope remains in dated source/state. |
| ADM-002 — NPC Manager | completed; [admin-maintenance-backlog.md:8](../admin-maintenance-backlog.md) line8 | Repository safeguards only; exact deployment/runtime scope remains in dated source/state. |
| ADM-003 — Race Manager | completed; [admin-maintenance-backlog.md:9](../admin-maintenance-backlog.md) line9 | Repository safeguards only; exact deployment/runtime scope remains in dated source/state. |
| ADM-004 — Status Manager | completed; [admin-maintenance-backlog.md:10](../admin-maintenance-backlog.md) line10 | Repository safeguards only; exact deployment/runtime scope remains in dated source/state. |
| ADM-005 — Area Manager | completed; [admin-maintenance-backlog.md:11](../admin-maintenance-backlog.md) line11 | Repository safeguards only; exact deployment/runtime scope remains in dated source/state. |
| ADM-006 — XP Boost | completed; [admin-maintenance-backlog.md:12](../admin-maintenance-backlog.md) line12 | Repository safeguards only; exact deployment/runtime scope remains in dated source/state. |
| ADM-007 — Issues | completed; [admin-maintenance-backlog.md:13](../admin-maintenance-backlog.md) line13 | Repository safeguards only; exact deployment/runtime scope remains in dated source/state. |
| ADM-008 — Roadmap | completed; [admin-maintenance-backlog.md:14](../admin-maintenance-backlog.md) line14 | Repository safeguards only; exact deployment/runtime scope remains in dated source/state. |
| ADM-010 — World Map / Node Editor | completed; [admin-maintenance-backlog.md:15](../admin-maintenance-backlog.md) line15 | Repository safeguards only; exact deployment/runtime scope remains in dated source/state. |
| ADM-011 — Area Types | completed; [admin-maintenance-backlog.md:16](../admin-maintenance-backlog.md) line16 | Repository safeguards only; exact deployment/runtime scope remains in dated source/state. |
| ADM-012 — Regions | completed; [admin-maintenance-backlog.md:17](../admin-maintenance-backlog.md) line17 | Repository safeguards only; exact deployment/runtime scope remains in dated source/state. |
| ADM-013 — Batch Node Editor | completed; [admin-maintenance-backlog.md:18](../admin-maintenance-backlog.md) line18 | Repository safeguards only; exact deployment/runtime scope remains in dated source/state. |
| ADM-014 — Loot Tables | completed; [admin-maintenance-backlog.md:19](../admin-maintenance-backlog.md) line19 | Repository safeguards only; exact deployment/runtime scope remains in dated source/state. |
| ADM-017 — Node Editor | completed; [admin-maintenance-backlog.md:22](../admin-maintenance-backlog.md) line22 | Repository safeguards only; exact deployment/runtime scope remains in dated source/state. |
| ADM-025A — Global unique-item identity | implementation complete; [admin-maintenance-backlog.md:28](../admin-maintenance-backlog.md) line28 | Implementation complete does not establish current installed/runtime state; preserve original release prerequisites; Unique identity reference; reward-model overlap is ADM-025B / ENG-REWARD-001. |
| ADM-025B — Authoritative creature reward model | implementation complete; [admin-maintenance-backlog.md:29](../admin-maintenance-backlog.md) line29 | Implementation complete does not establish current installed/runtime state; preserve original release prerequisites; ADM-025B aliases ENG-REWARD-001 model, not a second feature. |

### Four OPEN progression limitations — not feature delivery records

All four remain OPEN under [progression final closure](../operations/progression-001G-F-closure-checklist.md); they map to 001A limitation rows1–4 without allocating duplicate feature IDs:

- **HOSTED MULTI-SESSION BEHAVIOR UNPROVEN** — ENG-PROGRESSION-001F / limitation 1; accepted unresolved, not fixed or required to reopen accepted closure.
- **NATURAL RUNTIME PATH NOT YET OBSERVED** — ENG-PROGRESSION-001F / limitation 2; accepted unresolved, not fixed or required to reopen accepted closure.
- **AUTHENTICATED COMMANDS-PAUSED RUNTIME PROBE NOT EXECUTED** — ENG-PROGRESSION-001F / limitation 3; accepted unresolved, not fixed or required to reopen accepted closure.
- **RP EARNING AUTHORITY GAP** — ENG-PROGRESSION-001F / limitation 4; accepted unresolved, not fixed or required to reopen accepted closure.

Retain accepted source/installed metadata visibility/isolation, independent-session/runtime coverage, AC freshness/calculation and privileged/external caller uncertainties in [C closeout](../operations/legacy-001C6-resource-domain-acceptance-proposal.md), [D closeout](../operations/legacy-001D10-closeout.md), [E closeout](../operations/legacy-001E13-economy-rewards-closeout.md) and [Party F12 acceptance](../operations/legacy-001F11-evidence-and-closure-assessment.md). NPC gifts unknown callers/concurrency/uninspected configurations, material-sale runtime/session-storage/trigger/helper/count-CHECK limits, retained legacy paths and privileged v3→v2 uncertainty remain at those sources. Accepted risks are not new approved projects; named correction intents above do not expand their acceptance.

**ENG-LEGACY-001F-R3-RETRY remains OPEN / DEFERRED, NOT FIXED**, with explicit F12 acceptance of deferral and original [F1/F-R3 evidence](../operations/legacy-001F1-parties-writer-map.md). Successful exact replay and six combat refusals establish only their reported sequential scope. Empty-encounter awake lifecycle, accepted Combat1 risk, privileged callers, masked ACLs and incomplete multiplayer/concurrency coverage remain. Parent ENG-LEGACY-001 OPEN; Party/progression closures unchanged.

Administrative XP grants remain paused. Normal gameplay XP earning, including creature kill rewards, is not intentionally disabled by this policy. Its runtime behavior is not established by this register.

## Alias and overlap reconciliation / complete001A mapping

Every one of 001A's88 rows is accounted for: 65 open records + 17 references +4 limitation rows +2 aliases/umbrella rows =88. Every active record carries its original ID alias; every completed ID is listed above. The two non-record mappings are:

That mapping describes the001B foundation only. WOV-IDEA-031/032 were added from later owner-reviewed G2D input and are not retroactively inserted into001A's88-row inventory.

- INV-A04 → ENG-ABILITY-001: older calculation-rework checkpoints are source/evidence context, not a second feature; remaining non-stance decisions stay WOV-IDEA-005.
- ADM-015 → historical admin umbrella; remaining owner-deferred scope WOV-IDEA-024 and WOV-IDEA-025. Admin queue still owns ADM-015; its status is not edited.

Other overlaps: project-state max-level XP/backlog aliases ENG-XP-001; return-home aliases ENG-LIFECYCLE-001; single-creature controls alias ENG-ADMIN-002. ADM-025B reward-model implementation aliases ENG-REWARD-001 while ENG-REWARD-002 is an independent authoring decision. WOV-IDEA-028 lesser-unique fallback and029 marketplace expiry are optional extensions, not the base model. ENG-MOVE-001 and ENG-PARTY-001 share movement evidence but require different coverage. WOV-IDEA-006/007/008/009/010 share encounter/creature HP dependencies; keep the awake-lifecycle question distinct from future agreed direction. WOV-IDEA-012/013 share equipment sync work;014 override semantics is a separate policy question.

## Owner-review ambiguities — no priority assigned

1. Reconcile source-complete release gates for ENG-ABILITY-001, ENG-COMBAT-003/001, ENG-STANCE-001/002 and ENG-LEGACY-002 against existing dated state before scheduling work; UNKNOWN here is gate disposition, not rejection of implemented source or accepted closure.
2. ADM-015 old generic edit body versus newer D1–D4 containment/deferrals: retain narrowed remaining intents, not obsolete protected writers. WOV-IDEA-024/025 are scope decisions; per-tool implementation records can be split only after owner review, not silently enabled.
3. ADM-025A/B implementation-complete language versus reward-model blocked/decision-needed rollout; decide using original authorities, not inventory status normalization. ENG-REWARD-001 remains blocked in its source even if001A called it IDEA.
4. WOV-IDEA-003 older boss v3 approved-in-principle proposal is paused; current surviving mechanism/scope unclear. WOV-IDEA-005 non-stance batch status and WOV-IDEA-001 single-active-character policy details need review, not assumed approval.
5. WOV-IDEA-016 level1 combat remains separate from WOV-IDEA-015: crafting has a confirmed cutover cause and owner-observed production item/XP success after restoration, with bounded accounting/replay/refusal checks outstanding; do not merge these into a balance fix. WOV-IDEA-021 bundles related unique-transfer/catalog authority questions in existing evidence; refine only with bounded scope/owner review, not new audit.
6. WOV-IDEA-029 return-to-seller is only a possible extension; WOV-IDEA-002 personal bind is an extension of return-home. Registration does not approve either.
7. Creature HP/DoT/regen direction is agreed but no concrete sleep settlement, balance values or implementation contract chosen. WOV-IDEA-019 transferred contract/quest findings stay unresolved; ENG-LEGACY-001G1 preparation and World audit have not begun.

## Adding conversation-derived ideas

Owner review, not inferred recollection, is the admission boundary. Use only conversation text actually provided to Codex or an accessible approved transcript; never invent unavailable ChatGPT history. Before adding, search titles/aliases/dependencies; link an existing intent when equivalent. Quote or faithfully summarize the supplied decision with date and provenance; mark undocumented approval UNKNOWN. Recording an idea is not implementation authorization.

```markdown
#### <existing ID or next unused WOV-IDEA-NNN> — <short title>

- **Status / kind:** IDEA / UNKNOWN / DESIGN AGREED / DEFERRED / NEEDS AUDIT / IN PROGRESS; feature / decision / correction / question.
- **Intent:** <one independently decidable outcome; exclusions if essential>
- **Approval evidence:** <owner/date/exact supplied decision or NOT APPROVED; accessible transcript/document link>
- **Implementation/runtime boundary:** <source / installed / deployed / manually published / runtime evidence separately; UNKNOWN where absent>
- **Dependencies / overlaps:** <IDs; aliases or superseded intent; no priority inferred>
- **Provenance / authoritative owner:** <source and section/date; roadmap/admin queue/state if applicable; who must review ambiguity>
- **001A mapping / review:** <existing alias, or new after001A; owner review pending/recorded>
```

Review operation: owner confirms merge/new intent and approval scope; maintainer assigns stable ID, preserves aliases and adds evidence. Update an authoritative source only under that source's workflow and separate applicable authorization. Do not automatically synchronize approval/status changes from this register into project-state or roadmap. On later delivery, link evidence and move completed intent to reference history without dropping unresolved child questions or accepted limits.

## Foundation validation and publication boundary

Only this register file is authored by001B. Existing001A inventory, project-state/generated view, engine roadmap, admin backlog and design contracts remain unchanged. No priority, gameplay design change, code/SQL/migration/hosted operation, deployment or frontend publication. Recovery stash and all prior closures retained. Validate unique IDs, complete88-row mapping, real source links, no unresolved inventory-local dependency IDs, JSON/Markdown synchronization and whitespace before documentation-only publication.

Foundation checks passed:65 unique open/evidence-gate records,29 new stable IDs, complete mapping of all88 inventory rows,96 valid repository links and no dangling issued WOV-IDEA IDs. Three project-state tests pass; existing JSON/Markdown synchronization passes unchanged. Only this new Markdown file differs from the starting source; no changes to existing authoritative documents or generated files.
