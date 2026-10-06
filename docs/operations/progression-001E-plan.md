# ENG-PROGRESSION-001E — Proposed allocation and forward class-history authority

**PREPARED DESIGN ONLY.** Read the [audit](progression-001E-audit.md) first.
No schema/function/API below exists merely because it is proposed here.
No migration SQL authored; no runtime cutover. Accepted engine rules unchanged.

## Smallest recommended model and decision discipline

| Priority | Decision |
|---|---|
| MUST | Reuse the six existing invested counters in progression_character_state; do not create duplicate allocation counters/table |
| MUST | Preserve existing opaque_baseline, counters and receipts exactly; lazily initialize missing state with exact pre-mutation snapshot and zero historical investment |
| MUST | Add one compact character/destination-level class-growth milestone relation, including classless zero-growth decisions; do not overload respec-token milestones |
| MUST | Keep XP→growth application inside 001C XP authority; add milestone recording/uniqueness in that transaction, not a second browser/server award operation |
| MUST | Add narrow allocation and Order-change commands with stable request, ownership, lifecycle/location/combat validation, version and atomic resource/provenance mutation |
| MUST | Keep generic permanent-delta/snapshot/config/sync internals owner-only, including no service_role direct EXECUTE; do not clear a browser JWT to make a wrapper work |
| MUST | Replace/fence old join/switch capability and retire direct trainer allocation writer; keep unsafe respec unavailable; no dual writer or compatibility fallback |
| MUST | Fail/refuse on mismatched state/counters/history, invalid resource/config and conflicting request reuse; rollback all writes on failure |
| SHOULD | Use one authenticated Edge command boundary with server-derived actor, service-role narrow SQL command and an ownership-filtered read of version/current projection |
| SHOULD | Store Order command receipts in existing progression_receipt using a new narrow operation='order'; allocation continues existing operation='permanent' |
| SHOULD | Refuse class-changing commands while canonical stances exist; require user to drop them through existing canonical stance lifecycle |
| OPTIONAL | created_at on new growth rows for diagnostics; timestamps are never identity/config revision or proof of an old milestone |
| DEFERRED | Renown roll/spend/provenance and safe full respec (001F); reconciliation/admin/creation (001G); physical legacy deletion/final acceptance (001H) |

These are engineering recommendations within accepted semantics. No new balance
rule, catch-up, retroactive race subtraction, respec implementation or event-sourcing
architecture is needed. The no-automatic-stance-cleanup recommendation preserves
the installed class-change refusal; changing it needs Mik's explicit decision.

## Existing characters and discretionary proof

The existing six nonnegative counters represent **currently invested proven
discretionary points**, not lifetime grants and not guessed investment. A separate
table would duplicate the primitive's already atomic accounting. New allocations
use progression_apply_permanent_delta_internal with source='discretionary_allocation'
inside an eligible narrow command; wrapper must not expose source choice, generic
metadata, permanent rewards, negative deltas or resource-policy flags.

Let U be current unspent, I_s the six counters, and A_s the six positive allocation
deltas (absent keys normalized0). Within allocation, N=sum(A_s)>0:

- U'=U−N, I_s'=I_s+A_s, S_s'=S_s+A_s.
- U'+sum(I')=U+sum(I); XP adds only crossed-level discretionary grants to this sum.
- Permanent rewards/class growth/Renown never increment I. Future proven refund
  transfers sum(I) back to U and removes exactly I from S; this is 001F.
- Do not assert U+sum(I)=level−1: historical pools, already spent opaque points,
  tokens/admin overrides and other accepted exceptions make that false.
- Refuse negative/fractional/nonfinite/unknown/null deltas, empty sum, overflow,
  U outside supported0..200, unsafe level/XP/resources, negative counters or any
  I_s>S_s. Do not repair historical values as part of allocation.

The pre-mutation snapshot in the first committed 001E command receipt anchors
its exact current state. For a character with existing state, keep the original
001C baseline/counters; never recapture it or reset counters. For missing state,
the private primitive captures before-values lazily, with counters0. Joining an
Order also lazily captures before-state. No eager backfill, stat rewrite or inferred
refundable old investment. The first receipt's source identifies the 001E boundary;
no extra anchor table/event is required. Existing pool can fund a new provable
allocation without claiming historical provenance for the pool itself.

Retain 001C receipts as immutable facts. A receipt showing class config, crossed
levels and concrete aggregate growth proves deterministic per-level deltas in
that event only; current class/level do not prove events before that boundary.
Old direct/admin/Renown writers may have created unexplained differences; preserve
them outside I. No blanket equation decomposing current S into guessed components.
Known contradictory proof (e.g. downward override makes S<I, receipt chain/version
inconsistent or already-crossed destination) refuses and goes to 001G.

## Class-growth milestones

Proposed `progression_class_growth_milestone`:

| Field/invariant | Purpose |
|---|---|
| character_id; PK(character_id,destination_level) | One decision per character/destination, independent of XP request identity |
| destination_level in3,6,9,…,42 | Exact crossed level, not current level or event count |
| captured class_key text, is_classless boolean | Order identity at transition, immutable captured value; no class_id/order_id invented |
| six normalized applied_deltas (JSONB six-stat object) | Concrete deltas; all0 if classless; nonnegative integer validation |
| config_fingerprint (001C canonical SHA256) | Captured semantic config revision, never updated_at |
| source, event_id; deferred FK to progression_receipt(character,source,event) | Stable legitimate XP receipt whose captured config supplies the full bonuses; same atomic transaction |
| optional created_at | Diagnostic insertion time, not reconstructed historical level time |

postgres-owned, RLS enabled, no policies or table access for PUBLIC/anon/authenticated/
service_role/custom roles. Writes only through owner-internal XP authority. Captured
class key must survive later config retirement; do not cascade delete history via
classes. Full normalized config already lives in the referenced XP receipt: the
new row need not duplicate the whole event/before/after. Foreign keys/cross-checks
must require matching character and receipt source and exact destination/delta/config.
All rows and receipt committed together; deferred FK supports current receipt order.

Insert only **new forward transitions after 001E cutover**. For each crossed3-multiple,
record current captured class/config and deltas, including classless zero grants.
Missing old rows mean unknown/pre-001E, not eligible catch-up. XP same-event replay
returns original without inserting again. A new XP event attempting a previously
recorded destination must refuse/rollback, not ON CONFLICT silently continue.
Compare to already proven 001C crossedLevels as well when detecting privileged
level rollback; never infer old rows from current class. An index/read-only receipt
projection for that bounded check is preferable to fabricating old milestone rows.
Prior baseline level is a known preservation boundary, not class attribution.

Normal XP advancement is monotonic; all affordable destinations in one event use
one captured config because the character/class is locked for the transaction.
Config edit locks serialize with capture; future events use new fingerprint, earlier
rows and receipts stay unchanged. Same semantic config (missing zeros, numeric
formatting/key order) has same fingerprint. Invalid config refuses before writes.
Zero-config playable classes still record their zero applied decision. Old mixed
class growth survives every switch and any later safe respec.

`progression_respec_milestone` is incompatible: constrained10/20/30/40 and means a
token grant, not growth. Changing its meaning would obscure proof and existing FK
semantics. A full class-event stream is unnecessary; Order receipts + growth rows
answer future questions without reconstructing old class history.

## Canonical command/API boundary

Recommended browser → authenticated Edge `progression-command` → service-role
narrow SQL command → owner-internal primitives → one transaction → result.
The ordinary request carries only characterId, requestId, expectedProgressionVersion
and allocations OR operation(join/switch)+targetClass. Edge validates JWT via existing
Auth verification, derives actorId from verified subject, never trusts body actorId;
SQL checks characters.user_id=actorId. Service client does not forward owner JWT.
Actor argument is accepted only by the service-role narrow command, never by a
browser SQL entry. Both gates are necessary; no all-powerful delta RPC granted.

Why this recommendation: current primitives explicitly refuse auth.uid, and the
owner-JWT trigger silently blocks several authoritative writes. An authenticated
SECURITY DEFINER wrapper retains JWT context; app.trusted_rpc is insufficient.
An alternative fully narrow browser RPC would require scoped, verified trigger/
primitive redesign, which is larger. Do not silently introduce JWT clearing or
broaden trigger bypass. Edge is authentication/transport only; DB owns decisions.

| Operation | Validation / mutations / receipt / result |
|---|---|
| allocate | Auth owner, exact expected version, current node is_trainer, alive/safe lifecycle/no combat, positive six-stat batch and available pool; internal discretionary delta applies stats/U/I/version + clamp-only sync + existing permanent receipt with verified actor metadata; return committed projection or original replay |
| join | Classless identity consistent; target active/selectable/non-pre-class, authoritative current node.class_hall=target; same lifecycle/version checks, no active stances; change class/is_classless, initialize target bond0, preserve stats/U/I/token pools; clamp-only internal sync; increment version and order receipt containing before/after class/bonds/config/actor |
| switch | Non-classless identity consistent, distinct eligible target/hall, lifecycle/version/no stances; delete prior/dormant other-class bonds as existing intentional cost, target insert0; same atomic writes/receipt; no growth subtraction/catch-up/loadout wipe/equipment removal |
| record class growth | No independent ordinary API. Extend private XP transaction as above; accepted new Combat2 claim remains sole connected XP source; no service generic delta call |
| read command projection | Auth owner read, no lazy writes; return current character resources/permanent stats + progressionVersion (0 for no state), and optionally proven refundable total; never expose other players' baseline/receipts |

Same-class request with fresh identity should return explicit already_in_order
without bond reset/stat/resource mutation; new join on non-classless or switch on
classless returns wrong_operation/state_changed. UI uses is_classless plus class
consistency, never truthiness. These transport/refusal choices do not grant gameplay
points. Caller must refetch current projection for a replay: original historical
receipt is not necessarily today's state. Planner awaits result, preserves request
and payload for uncertain transport retry, and logs success only after committed/
replayed response. No optimistic permanent mutation before acknowledgment.

ACL: Edge public request requires Auth; narrow SQL commands service_role + postgres
only, postgres-owned SECURITY DEFINER with fixed pg_catalog,public search_path.
Explicit revoke every default/inherited/custom grant before intentional service
grant. Private helpers/tables remain owner-only. Read RPC authenticated owner-only,
not anon; do not give authenticated table access for counters or receipts.

## Locks, replay and transactional refusals

MUST use stable UUID once per user action, retained for retry. Canonical normalized
payload includes operation, target/deltas, expected version, verified actor, contract
version/rules version. No retry with a new UUID; changing payload under same identity
refuses request_conflict. Namespace per command/character follows existing receipt
PK; conflicting operation under same Order request uses one order source and conflicts.
Allocation uses discretionary_allocation source. request UUID reuse across character
is scoped by character, as existing contract, not a new global uniqueness promise.

Proposed lock order: node `combat_enter_node:<node UUID>` transaction advisory gate
(read initial location), character FOR UPDATE, then locked re-read/revalidate location;
if moved, refuse/retry without acquiring a second node in reverse order. Do not hold
character then acquire encounter/node lock. Commands do not acquire encounter rows
after character; lock proof must compare entry, commit, stance and departure paths
before coding. Then check receipt for replay/conflict (ownership still checked first),
version/lifecycle/location, lock required config SHARE, take consistent equipment
inputs under existing character serialization, apply mutation and provenance.
Progression state access is serialized by character row; lock state explicitly if
other sanctioned paths might write it independently. There must be no such writer.

Do not copy naive `e.status='active'` as the entire active-combat predicate: inert
shells exist in accepted evidence. Match accepted ownership/lifecycle: a present
fighter with live claim OR an active encounter with living engaged creature;
queued/finalizing departure/movement, pending lifecycle and legacy combat_sessions
remain unsafe. Presence/engagement and node entry must be checked under compatible
locks. Historical absent fighters alone cannot indefinitely block a trainer.
Exact predicate/lock integration is a **required implementation review**, not a
proven result here. Locally test entry vs command ordering as well as overspend.

Replay of an already committed request must not mutate again even if now away/in
combat/config changed/version advanced. Authenticate owner before revealing receipt,
then replay before current eligibility/version checks. Insufficient/invalid/unsafe
fresh requests leave no character/provenance/resource changes; no receipt that
pretends success. Stable committed receipts are required; durable refused attempts
are OPTIONAL and must not turn transient refusal into permanent request success.
If DB catches failures for structured return, wrap all mutations in a rollback
subtransaction; never return refused after partial updates. Counter/version/stat
overflow, malformed equipment/config/resources or receipt/milestone collision
abort the entire caller transaction, including bonds and Combat2 accepted rewards.

## Resources and stances

Reuse private character_sync_derived_internal with fixed non-level policy
(false, was_alive). Formulas and equipment fallback from 001C unchanged:
MaxHP=clamp(classes.base_hp+2 floor((effectiveCON−10)/2)+5(L−1)+gearHP,1,10000);
MaxCP=clamp(30+3(L−1)+3(max(INTmod,0)+max(WISmod,0)),0,5000);
MaxMP=clamp(100+10 max(DEXmod,0)+2(L−1),0,5000).
Never refill HP/CP/MP for allocation/join/switch; dead mutation refused; no caller
refill flag. Pool reductions clamp once. STR/CHA may change derived combat/economy
without maxima. No persisted AC rewrite; class/DEX effective AC stays domain-derived.
Invalid resources refuse; no opportunistic repair. Capture resource config/base_hp
separately from class-growth fingerprint. Do not reuse public owner sync under the
service context (owns_character would fail).

MUST preserve canonical stance rows/effects/reservations. Class changes with stance
rows refuse; clearing legacy reserved_buffs does not satisfy that requirement.
Allocation increases capacities without refunding/reapplying stance costs; verify
acknowledged resource/cap delivery and existing reservation calculations against the
new maxima. Automatic stance cleanup or downward respec remains 001F's open decision.

## Legacy containment and phase limits

| Path | 001E action proposed | Later boundary |
|---|---|---|
| Direct trainer hook writer | Replace batch/single flow with narrow command; remove useCharacter UPDATE path and post-write public sync; deny direct columns remains | Physical unused helper deletion only with caller proof |
| Old browser full-respec | Explicit unavailable/refused UI; keep persistent writer fenced, no guessed refund fallback | 001F implements proven nonzero refund/token rules and stance decision |
| join_order/switch_order | Fence all ordinary/service/custom EXECUTE at same cutover that enables reviewed new commands; replace browser callers; retain bodies until dependencies prove removal safe | 001H physical deletion, no compatibility wrapper to old mutation |
| train_renown_stat | Keep classified separately; does not increment I, so respec never refunds it. Do not pretend canonical receipt/version | 001F consolidation; retain accepted temporary unchanged path only if narrow preflight confirms no counter/history corruption; otherwise STOP for scoped containment authorization |
| set-level/update-character/reset-stats/grant-respec | Privileged noncanonical 001G scope; document operator prohibition for audited cutover/acceptance and preserve detection/refusal | 001G bounded authenticated audited commands, destructive/downward policy. They must not invalidate live proven counters silently; engineering fence may need a separately approved prerequisite |
| Crafting/grant-xp/legacy commit/party award | Keep accepted 001D pauses/revokes unchanged; no activation to make intermediate trainer work | Deferred domain integration/001H retirement |
| Generic character UPDATE | Keep browser preference-only grants; no progression expansion | 001G/admin/creation and 001H cleanup |
| Harness/old helpers | No invocation; verify only scoped suspicious harness ACL if installation/caller proof leaves it relevant | 001H full dependency-led retirement |

001E MUST solve allocation, Order commands/receipts, future growth uniqueness,
resource/combat/location boundary and unsafe trainer containment. It MUST NOT
implement full respec, Renown redesign, race backfill, generalized admin repair,
new creation authority or final retirement. Existing exceptional writers constrain
proof: operator prohibition is not a technical fence. Activation acceptance must
explicitly enumerate surviving capabilities and test inconsistent-state refusal;
if a privileged override can silently erase invested proof, escalate that specific
containment prerequisite rather than implementing 001G wholesale.

## Minimum hosted evidence before implementation

A — Locally/accepted evidence answerable: rules; caller wiring; six existing counters;
receipt/config behavior; no catch-up; source join/bond semantics; exact 001C resource
formulas; 001D fences/adapter and reported installation. Reuse 001B H1/H2 ACL and
001C trigger/config inspections. No broad re-audit or replay of 001D required.

B — A separately authorized **read-only** preflight must return only:

1. For `join_order(uuid,text)`, `switch_order(uuid,text)`, `train_renown_stat(uuid,text)`,
   `character_create` exact installed signature: pg_get_functiondef UTF8 SHA256,
   owner/security/search_path and effective EXECUTE PUBLIC/anon/authenticated/
   service_role + nonowner custom/inherited grantees. Full definitions only if hash
   differs from inspected source/accepted H1. This resolves frozen-source versus
   installed body, not gameplay via RPC invocation.
2. Effective characters table/column UPDATE for six stats, class/is_classless,
   U/respec and six preference fields; RLS/affected enabled trigger names plus
   hashes of restrict_party_leader_updates and stance-class guard. Only inspect
   changed trigger bodies if preflight hashes differ from accepted 001C.
   For bond-reset dependencies only, return character_class_bonds write ACL/RLS
   policy names and effective EXECUTE/definition hash of award_class_bond and
   award_class_bond_for_kill; no gameplay invocation. The source direct-admin
   upsert and no-owner-check helpers are not proof of installed ordinary access.
3. Progression sidecar schema/ACL unchanged and aggregate counts of state/receipts;
   counts by source/operation, any counters<0 or counters>current materialized stat,
   receipt version discontinuity and class/flag mismatch. No named player dump.
   If post-001C XP receipts exist, return at most one anonymized structural sample
   of crossedLevels/config/deltas/version to validate representation, not old history.
4. Exact installed node-entry/stance/departure ownership function hashes and only
   affected lock/predicate snippets needed to confirm the proposed node→character
   ordering against accepted source. Scope excludes schedules, unrelated world data,
   logs, Vault and credentials. Current command-safety facts are inspected again
   under locks at runtime, not assumed from the preflight snapshot.
5. Only if retained harness capability remains uncertain after dependency review:
   existence/effective EXECUTE for c2_harness_run/c2_harness_run_c; no invocation.

No 001E name-collision sweep beyond proposed commands/table and operation CHECK;
read class status/selectability/baseHP/bonuses only if needed to assess changed
config. Aggregate anomalous data does not authorize repair. Return differences
for local reconciliation and final command design. No request for Lovable design.

C — Later separate authorization: reviewed migration via standard Drizzle lane,
exact prefix/hash checks, narrow Edge deployment/generated types, atomic old-writer
fence/new-command installation, post-install effective ACL/unchanged-data proof,
bounded legitimate trainer/join/switch runtime observations and Mik's manual frontend
publication. Preserve NATURAL RUNTIME PATH NOT YET OBSERVED until actual observation.
**HOSTED MULTI-SESSION BEHAVIOR UNPROVEN** until supported safe mechanism exists;
serial embedded PostgreSQL tests do not remove that limitation.

## Local acceptance matrix before activation

| Test | Required evidence |
|---|---|
| One stat +1, positive six-stat batch, repeated distinct requests | Exact S/U/I/version/receipt changes; no unsolicited token/class/XP change |
| Insufficient U, invalid key/null/negative/fraction/zero/overflow, invalid resulting state | Refusal and identical character/state/receipt/bond/resource fingerprint |
| Wrong/no Auth/other owner/service actor forgery at public boundary | No write, no other-character receipt disclosure |
| Away from trainer/wrong hall/dead/movement/departure pending/active combat/live claim | Structured refusal under locks; inert/absent historical encounter does not falsely block |
| Same UUID/payload retry after new version/config/location/class | Original receipt, no second spend/growth/bond reset; fresh projection separate |
| Conflicting reuse / stale expected version | Conflict/stale refusal with no state change |
| Two allocations with one point; serialized competing requests; transaction rollback after mutation | At most one spend; deterministic queue/serial results; resources/provenance roll back together |
| Node entry vs allocation/switch; equipment/cap sync vs allocation; class edit vs XP | Lock-order review plus local interleaving tests to supported engine limits; no TOCTOU or deadlock order reversal; hosted concurrency not claimed |
| CON/INT/WIS/DEX modifier thresholds; gear override{} fallback, gems, broken gear, caps | 001C parity; clamp-only no HP/CP/MP refill; no persisted AC rewrite |
| Classless crosses3/6; late join; next9 growth | Zero skipped rows; no join stat grant; future correct class/config row+XP receipt |
| Warrior3 → Wizard switch →6; repeated switches/return | Old STR/DEX permanent retained; future INT/WIS; bond intentional erase; no equipment/loadout/history wipe |
| Active canonical stance / legacy reservation context | Refused class change, no partial bond reset; no synthetic stance or CP cleanup |
| Config semantic equivalence/change/invalid values | Stable equivalent fingerprint; changed future fingerprint; original replay unchanged; invalid all rollback |
| Same/different XP identity for already recorded destination; multi-level reward + later commit failure | No duplicate milestone; contradictory new event refuses whole transaction; growth/token/claim/equipment writes atomic |
| Bond helper/direct upsert negative containment | Untrusted caller cannot recreate/reset someone else's bonds or bypass intentional leaving cost; preserve accepted server reward callers if proven |
| Existing opaque character, preexisting 001C state/receipts/counters | No initialization rewrite; I0 for missing state, retain existing I; cannot reconstruct old allocation/class history |
| Ordinary browser generic delta/internal snapshot/config/sync; direct stat/U/class UPDATE; old trainer/join/switch | Effective ACL denial including custom/inherited roles; runtime callers use narrow boundary only |
| Old unsafe full-respec / privileged override exception | Explicit unavailable trainer; no guessed refund; negative detection for inconsistent proven state; exceptions accurately recorded |
| UI pending/refused/replayed success/resource delivery | Await result, keep uncertain UUID/payload, no false success/log/local permanent mutation; correct classless join selection |

Run existing progression reference/SQL and 001D actual-chain/containment suites;
class registry/validation/loadout/UI and Combat2 ownership/entry/stance/resource
tests, project-state check/whitespace. Runtime implementation later requires
typecheck/build and appropriately broader boundary tests. Do not fix unrelated
baseline failures. PGlite proves deterministic transactions, not true two-session
contention; retain that limit without weakening rollback/serialized tests.

## Handoff / exact next task

Starting/synchronized SHA `5437da1a8a1f6b424c0eeafcf204ae8ae986e1c8`; final local/remote
commit returned after normal push (cannot self-embed its own SHA). Worktree docs/state
only, stash unchanged. No migrations authored/installed, generated types edited,
Edge deployed, frontend published, Cloud/gameplay operations or source/test changes.

No product decision blocks this audit. Before implementation, Mik must authorize
the scoped B preflight; reconcile installed differences/lock integration and the
temporary privileged-override containment boundary. No automatic stance cleanup
decision is necessary if refusal is retained. Respec's stance decision stays 001F.

Recommended exact next task: **ENG-PROGRESSION-001E-PREFLIGHT — narrow hosted read-only
verification of trainer/Order command dependencies and provenance**, limited to
B1–B4 (B5 only if needed), no RPC calls/mutations/migration/deployment/publication;
return hashes/ACLs/aggregate facts/differences for local design reconciliation.
After that, separately authorize local implementation/SQL preparation and testing;
installation and activation remain later separate gates. **STOP here.**
