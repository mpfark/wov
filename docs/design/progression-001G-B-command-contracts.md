# ENG-PROGRESSION-001G-B — Narrow command and authorization contracts

**Design contract only; no routes, functions, tables or migrations created.**
Binding product policy is [O1–O14](progression-001G-B-admin-policy.md). Names below
are proposed domain commands, not existing APIs. Shared safety requirements
follow the approved request; approval storage, notification delivery and locking
details are **engineering proposals for phase review**, not silent owner decisions.
The [phase plan](../operations/progression-001G-B-execution-plan.md) supplies evidence gates.

## Trust and shared command envelope

UI/request → authenticated adapter → narrow server command → role/evidence and
domain validation → private authority → atomic character/sidecar/receipt writes
→ committed result and notification intent → authorized projection → refreshed UI.

Proposed input: `request_id` UUID, command kind/version, `character_id` (or
creation choices), `expected_progression_version` where a character exists,
reason code and nonempty reason, evidence references, case/approval reference
when required, extra sensitive confirmation tied to the normalized payload,
and the operation's bounded choices/amount. No client actor, role, owner,
trusted-delta flag, resource refill flag or computed baseline is authoritative.
Reject unknown fields, invalid UUIDs, empty evidence for repairs, fractions,
negative/zero awards, overflow, stale versions, unsupported catalog revisions
and inconsistent provenance. UI validation only assists the user.

Server authenticates claims and derives actor ID; rechecks authoritative role
and target owner inside the mutation boundary. The service adapter's access is
restricted to narrow domain entries; owner primitives have fixed search_path,
explicit ownership/ACLs and private sidecars with RLS/no public policies.
Installation must assert direct and inherited effective rights, including PUBLIC
grantee zero and actual application-role membership. Platform global/BYPASSRLS
read capabilities do not authorize gameplay calls. No secret values inspected.

## Transaction, replay and result

One accepted request atomically commits domain changes, progression version,
source-specific provenance, canonical/admin receipt, approval consumption and
durable notification intent. A failure rolls back all of them. External delivery
occurs after commit from that intent; retry cannot repeat gameplay. No sequence
of independent HTTP writes is an atomic repair.

Proposed lock integration preserves established encounter-before-character
ordering: serialize request/approval identities, take the established initial
node advisory lock, encounter locks where required, then character lock and
sidecars; revalidate location/lifecycle. Multi-character restoration requires
a separately reviewed deterministic order, never speculative locks. Do not
create a second tick/settlement authority or call lifecycle helpers opportunistically.

Use a stable UUID per confirmed intent, retained across timeout/retry. Normalize
operation/version, target, amount/choices, expected version, reason/evidence and
approval identity into immutable replay data. Same UUID and same normalized
request returns the original receipt without recalculation, another reward,
reroll or notification intent. Different actor/command/target/payload conflicts.
Receipt retrieval still checks current authorized audience; role revocation must
not leak a former admin's privileged payload. It never re-executes a committed
mutation. Refused uncommitted requests do not consume approval or earn a reward;
changing a refused payload needs a new intent identity. Proposed durable refusal
logging is separate from accepted progression proof and subject to O11 retention.

Results distinguish `committed`, `replayed` and `refused`; transport success is
not domain success. Structured refusal categories: unauthorized/role forbidden,
self-reward forbidden, approval required/expired/exhausted, request conflict,
version or state changed, invalid amount/evidence/catalog, commands paused,
unsafe lifecycle, deleted target/window expired, inconsistent provenance,
restore conflict and unsupported repair. Redact private details from refusals.
UI disables unavailable controls, preserves retry UUID, displays actual offered/
applied/discarded amounts, and refreshes only the current target/session/version.
No success toast before a committed/replayed decoded result or affected-row proof.

Durable receipt: request and receipt IDs, command/policy version, authenticated
actor and role snapshot, target and target-owner reference, self-reward flag,
reason/evidence/case/approval IDs, timestamp, captured catalog versions/concrete
deltas, relevant before/after state and progression versions, resource clamping,
offered/applied/discarded amount, source/milestone identity, and any compensation
link. Sensitive before/after fields belong to protected storage, not a general
browser JSON response. Minimum replay/provenance evidence must survive lawful
audit pruning without retaining unjustified identifying detail.

## Repeated awards and anti-splitting — proposal requiring approval

Per-action caps are approved; the following mechanism is a reviewable proposal.
Store an immutable reward case and separate approval bound to target character,
purpose/evidence, award category, aggregate approved budget and applicable policy
version. Store approval actor, eligible executors, validity/expiry and self-award
conditions only after the owner defines those rules. A pending proposal is not
an executable approval. Approval parameters must be populated; missing policy
fails closed for the affected award route.

Under target/case/approval locks, check persisted award history using the approved
repeat predicate, apply per-action cap, check remaining aggregate budget and
consume it in the same transaction as award/receipt. Two distinct UUIDs cannot
both spend the same remaining budget; replay consumes nothing. Actor changes,
separate browser sessions or new UUIDs do not reset target history or case budget.
Creating another case cannot waive repeated-award approval. Scope across award
categories, time windows, approvals for subsequent unrelated rewards and who
can create/approve a case remain owner decisions; no threshold/window/approver
is invented here. Local sequential lock/rollback fixtures prove logic, not hosted
multi-session scheduling. Steward self-reward is refused even with an approval;
Overlord own rewards remain flagged and subject to repeated-award rules.

## Operation-specific contracts

All operations inherit the envelope, current role checks, lifecycle exclusions,
atomic receipt/version and replay contract above. Existing E/F gameplay commands
remain paused. New admin entries require their own reviewed control boundary.

| Proposed command | Inputs and authority | Atomic domain effect and protected boundary | Compensation / player result |
|---|---|---|---|
| award-admin-xp | Positive integer XP; reward/compensation reason; Steward<=5,000, Overlord cap must be decided; O10 approval/self rules | Invoke canonical advancement once; receipt captures levels, mixed-class growth, point grants, milestone tokens and offered/applied/discarded XP. Preserve cap42; do not normalize invalid legacy XP/level. Existing fixed living-HP level refill/dead HP0 and CP/MP clamp apply. | No negative XP reversal. Wrong grant requires separately authorized technical case after later state is inspected. Player sees actual advancement and reason, not internal evidence. |
| repair-level-xp | **Not an enabled general admin operation.** Separately authorized technical plan, precise before/after, independent proof and expected version | Dedicated case contract must reconcile XP, level, growth/points/milestones/provenance without fabricating history. O2 bans convenience set-level, including Overlord. | If prior state advanced, refuse snapshot rewind; approve exact compensation or retain opaque state. |
| correct-attribute / record-historical-adjustment | Overlord-approved case, selected stat and proved correction, or explicitly labeled manual historical adjustment | Narrow provenance source; preserve discretionary counters, race/class growth and Renown evidence. Checked arithmetic and domain limits; clamp resources; no guessed decomposition. Historical annotation must not masquerade as proof. | Linked correction/compensation command, never editing old receipt. Player sees relevant permanent adjustment. |
| override-class-access | Overlord only; selected validated class; evidence/reason/confirmation | Bypass access eligibility only; preserve historical growth; normal bond reset; no retrospective installments or point refund. Current class and future-growth catalog capture remain coherent. Refuse unsafe lifecycle. | Bond error is a different approved repair; no generic “undo class” restoring an old snapshot after growth. |
| award-respec-token | Positive integer; Steward1, Overlord<=5, reason/evidence/O10 approval | Atomically add respec balance in private authority; distinct grant source, version/receipt; do not create/reuse earned milestone rows. | Consumed tokens prevent naive subtraction; refuse insufficient available balance and review bounded compensation. Player notified of granted token count. |
| award-rp | Positive integer RP; Steward<=25, Overlord<=100; O10 approval | Coherent balance/lifetime model **must be approved**; awards never train ranks or alter stats. Version/receipt, integer envelope, no gameplay earning extension. | Do not blindly subtract spent RP or undo later training. Player sees balance and any explicitly approved lifetime effect. |
| correct-renown | Overlord-approved exact case; separate balance/lifetime/rank/stat evidence | Repair only approved fields together; preserve discretionary and growth sources; never rerun HMAC or expose key. A rank/stat correction must document their coherent relationship. Clamp resources. | No historical reroll; immutable linked correction, later-dependent state refuses blind rewind. |
| create-character | Authenticated owner choices name/race/gender and optional approved family choice; admin owner delegation remains undecided | Server selects L1 XP0 classless Wayfarer, validated versioned race baseline, no L1 growth/discretionary grant, zero earned milestones/tokens/Renown absent approved starting grant. Atomically character+initial resource calculation+approved gear/materials+explicit creation provenance/state/receipt. No authority from submitted stats/class/HP/CP/MP/AC. | Lost-response replay returns same character. Name collision/config failure/gear or trigger failure rolls back all. Creation recovery is separate; UI must describe optional family failure honestly. |
| recover-creation | Independently proved partial state, expected version, case evidence; executor approval unresolved | Dedicated missing-initialization repair; no second creation, no arbitrary defaults or grants. Refuse subsequent incompatible gameplay, ambiguous gear/material provenance and mismatched creation replay. | Owner-approved completion or containment; never automatic top-up of opaque characters. |
| soft-delete-character | Target, version/reason; exact player/admin deletion permission must be reconciled | Tombstone transaction after lifecycle validation, exclude deleted character from all gameplay/reward/settlement/movement/inventory authorities; retain justified restoration/progression evidence. Never cascade-delete proof as convenience. | Notify owner; deletion is not permanent purge. Restore within approved window only. |
| restore-character | Overlord, tombstone/version/evidence; within30days; confirmation | Verified snapshot/provenance and dependencies; identity/name/unique gear/marketplace conflicts refuse. Reattach safe sidecars/history under locks, preserve resources perO12; no resurrection by restoration. | Linked restore receipt, explicit player effects. Missing/corrupt evidence needs a separate damaged-character case. |
| purge-expired-character | Controlled procedure; permissions/retention/clock unresolved | Only after window and lawful retention checks; preserve justified minimum proof independently of character FK cascade, remove/anonymize approved personal detail. | Irreversible; exact reviewed evidence/authorization and recoverability gate required. Never normal UI delete fallback. |
| revive-character | Steward/Overlord; death/lifecycle evidence; stableUUID | Narrow admin adapter to verified normal respawn authority; server actor permission distinct from existing owner-only respawn. No active claim/combat/pending transition bypass; capture config/destination/delay/loss and resource effects. | HP is configured restored amount limited by maxHP; CP/MP source behavior preserves them. A requested deviation needs owner approval. Player notified of actual outcome. |
| compensate-resources | Overlord-approved distinct case, explicit resource/amount and expected state | Separate from corrections and revive; no generic resource UPDATE. Clamp to valid current maxima, refuse dead/unsafe lifecycle and incompatible stance/settlement ownership. Amount and purpose require approval. | Linked compensation, never implicit healing from an attribute/class correction. |
| publish-progression-catalog | Role/publication authority unresolved; validated new revision | Immutable applied race/class snapshots and concrete growth remain; new revision prospective. Derived current formulas may change caps; use reviewed synchronization boundary, not retroactive permanent reconstruction. | Bad catalog rollback uses a new version/review, never edits applied receipts. |

General damaged-character restoration is a separately approved technical case,
not permission to import arbitrary JSON through restore-character. Equipment,
gold/material convenience rewards and teleport require their existing domain
authority review; O1/O5/O6 caps cannot be copied to them. Test Arena reset is an
isolated domain and cannot supply general respawn or repair semantics.

## Privacy, notification and retention contracts

Detailed admin audit retention is12months under O11. Proposed notification outbox
uses receipt identity and recipient to deduplicate delivery; it contains only
player-relevant changes, public reason wording and actual result. Store internal
evidence/security context separately. Player reads require current own-target
authorization; Steward scope is relevant support cases, not unrestricted user
history; Overlord full authorized audit still excludes unauthorized secret data.
Server filters queries and DTOs, not just hidden UI controls. Realtime wakes a
refetch; it is not a reward or delivery receipt.

The minimum progression/replay evidence store and detailed identifying audit have
separate retention purposes. O11 does not authorize retaining personal data
forever, nor deleting receipts in a way that permits reward replay or destroys
known provenance. Purge/anonymization must reconcile request tombstones, actor
references, evidence links, notification data and restore snapshots under the
owner-approved lawful scheme. No legal basis or jurisdiction is assumed here.
