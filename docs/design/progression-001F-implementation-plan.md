# ENG-PROGRESSION-001F — Implementation and release plan

Current stage4 status: F/R1 installed and R1 verified; ACL regression repaired. [R2 final Edge handoff](../operations/progression-001F-R2-edge-handoff.md) prepares the remaining separately authorized deployment and paused verification. Authenticated testing is optional when unsupported; activation remains stage5. Earlier stage/blocked statuses below are historical.

Current status: **001F INSTALLED / VERIFICATION BLOCKED BY SERVICE_ROLE CHARACTERS UPDATE REGRESSION**. [R1 corrective preparation](../operations/progression-001F-R1-service-update-repair.md) preserves the installed authority and prepares a separately authorized forward ACL repair. F Edge not deployed, commands paused, frontend not published. This plan's stages below retain historical local-preparation evidence; no rollback/rewrite or001G/H is planned or authorized.

**IMPLEMENTED LOCALLY / PREPARED / NOT INSTALLED / NOT ACTIVE.**
2026-10-07, task start448883ef. The ENG-PROGRESSION-001F-IMPLEMENT request
authorizes local preparation and normal commit/push, and supplies accepted decisions
and hosted preflight facts. [Implementation/evidence](../operations/progression-001F-implementation.md)
supersedes the prospective stages below. No hosted work, activation, publication or001G/H is authorized.

## Stage0 — Decisions and supplied preflight (complete)

Mik approved stance refusal, dead refusal, the same nodes.is_trainer boundary,
pool200 overflow refusal without clipping, six independent ranks, level30 eligibility,
private persistent HMAC with explicit version and no rotation or gameplay rank cap.
RP earning is excluded. Supplied preflight confirms pgcrypto1.3 in extensions,
no existing suitable key facility, the raw service RP/rank/lifetime write gap,
canonical Combat2 XP/gold only, and an uncalled equipment degradation writer gap.
The four historical trained characters remain opaque; no backfill is authorized.
All E/F commands stay paused. The following inventory records the completed preflight scope.

One separately authorized read-only bundled preflight,only scoped to:

- pg_proc/pg_language/pg_get_functiondef and aclexplode/effective function inquiries
  for train_renown_stat,its overloads and dependencies; compare E-pinned source.
- pg_attribute/pg_attrdef/pg_constraint for characters six stats,bhp,bhp_trained,
  lifetime,pool,tokens,class and nodes.is_trainer; pg_trigger and called definitions
  only for writers of these fields. No whole schema dump.
- Installed defs/effective ACLs of RP-related award_party_member overloads,legacy
  commit and discovered hunt/quest callers; preserve accepted current node XP/gold
  evidence. Do not assume legacy proposal Renown reaches live storage.
- Relevant stance/entry/departure and equipment resource-writer lock clauses/identity against accepted E evidence,
  only where required to pin new lifecycle exclusions.
- pg_extension/pg_proc for HMAC/random-byte support and schema; metadata only for
  approved existing key facility. Never retrieve secrets.
- Count-only invalid RP/rank/counter/version/receipt consistency cases,no character
  history reconstruction. Scope unexpected contradictions for001G.

Each category fills a locally unprovable installed fact; accepted full E/release
verification,Edge/runtime limitations and history are not re-audited broadly.
Deliver read-only evidence with timestamp,source identity,known/unknowns. STOP on
material drift; no automatic mutation. No F code before these dependencies clear.

## Stage1 — Local authority implementation (complete)

Implemented surfaces are recorded in the release manifest and implementation report:

|Surface|Required narrow change|
|---|---|
|Private SQL source/generator|Two F domain operations,common proof validator,one-version receipt logic; owner-only privileges explicit|
|progression_receipt|Add respec/renown operation values,retain all historical receipts and source-scoped PK; cross-command UUID guard under character lock|
|Private domain key|Approved existing secret facility or tiny immutable owner-only key relation; no player backfill; generated key not committed in SQL/logs|
|progression_command|Strict respec/renown dispatch and selected stat field; same service-only actor validation/pause/node→character order|
|Snapshot/projection|RP/ranks/counter/proof fields and receipt/current-projection distinction; no generic browser sidecar access|
|Shared contracts|Extend request/result/receipt union and refusal reasons without masquerading failure as positive permanent reward|
|Tests|Actual atomic SQL and command/Edge/browser integration,not implementation-mirroring formulas|

Do not modify installed XP body/class-growth logic or historical0001–0004/journal.
Do not open primitive/browser table privileges; no negative delta through existing
positive-only API. Single F mutation transaction owns resources,receipt and version.
No duplicate nested primitive receipts. Common proof validation checks all sixI,
durable allocation history,current protected state/ranks and refusal on contradiction.
Empty refund remains mutation-free; unknown history remains opaque.

Forward artifact preparation is a later authorized implementation deliverable,
outside discovery until standard Drizzle installation is separately approved.
Its guards must pin actual preflight dependencies and canonical result identity;
text-tool ledger identity remains distinct from resulting object identity.

## Stage2 — Boundary/UI and containment implementation (complete)

Extend existing progression-command Edge strict parser: verified JWT actor only;
operation=respec with no extra payload or operation=renown with one stat; stable
UUID/expectedVersion; reject client actor/delta/refund/roll/cost/rank/key. Keep same
narrow SQL entry; no new generic service endpoint. Extend trailing argument only
with reviewed signature/ACL/dependency strategy; never leave ambiguous overloads.

Browser uses retained per-character command request on transport uncertainty,
receipt replay and authoritative refetch,current projection/version. No optimistic
stat/RP/token mutation or silent new UUID while prior outcome unknown. UI displays
pause/refusal/trainer/dead/combat/stance readiness and proof-only refund preview;
server decides amount. Renown failures are committed spent-RP outcomes,not transport
failures; clearly show selected rank,cost,chance,outcome and no reroll on retry.
Preserve leaderboard reads; fix F-related misleading wording without rewriting
manuals globally. MCP presentation fix needs bounded separate scope decision.

Old train_renown_stat stays owner-only; remove/drop only after dependency evidence.
Delete browser reconstruction/stale callable UI rather than compatibility fallback.
Admin resets,set-level,grant-respec/raw overrides remain fenced for001G. Creation,
crafting,Combat2 earning/party mechanics and Arena reset are not silently redesigned.

## Stage3 — Local acceptance and reviewable release (complete)

Execute all30 audit vectors plus wrong JWT/actor/schema/service/browser ACL cases,
exact old-function denial,no inherited grants,controlfalse,receipt conflicts across
sources,empty/no-token/no-history,sync/constraint rollback,version overflow,private
key nonexposure,and deterministic precommit retry/HMAC rejection sampling.
Test actual F authority and a real old mixed-class/opaque character without backfill.
Prove permanent/class-growth/Renown/gear preservation,expected failure spending,
pool cap behavior and clamp-only resources. Freeze independent literal vectors.
Single-session deterministic interleavings are labelled local,not hosted contention.

Run relevant progression/Combat2,C/E SQL and D integration/containment,root/app/node/
Edge typechecks,production build,manifest/state checks and full baseline comparison.
Restore known build/test generated snapshots/MCP bundle. Normal commit/push and
clean-worktree/stash evidence. STOP at prepared/not-installed/not-active.

## Stage4 — Separately authorized hosted install/verification

Fresh exact artifact/dependency checks;one standard Drizzle forward transaction;
post-apply resulting body/security/ACL/receipt schema and unaffected-data/old-object
proof; then explicitly scoped progression-command Edge deployment and authenticated
paused refusal check only if a safe identity is available. If unavailable,disclose;
never manufacture proof or touch player data as a convenience.
Keep controlfalse throughout; no frontend publication. Record actual migration
ledger versus reviewed file/object hashes and Edge revision availability separately.
No legacy runner,full E replay or fabricated historical migration identity.

## Stage5 — Later family activation and publication decision

Only after E/F authority acceptance,explicit authorization for family control=true
and bounded safe verification. Hosted multi-session/natural-runtime proof remain
separate scoped tasks,not inferred from local tests. Mik alone publishes frontend.
No activation in audit,implementation preparation or deployment by implication.
001G/H remain separately scoped future work.

**STOP: ENG-PROGRESSION-001F IMPLEMENTED LOCALLY / PREPARED.**
**READY FOR SEPARATELY AUTHORIZED HOSTED INSTALLATION / NOT INSTALLED / NOT ACTIVE.**
