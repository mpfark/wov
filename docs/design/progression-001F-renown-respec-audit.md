# ENG-PROGRESSION-001F — Renown and safe respec authority audit/design

**AUDIT/DESIGN COMPLETE / NOT IMPLEMENTED / NOT INSTALLED / NOT ACTIVE.**
2026-10-07; task_start_sha=fetched origin/main=`49ffa969180c542a770b41c20b79350e58341aa9`.
Clean main; recorded639bb7cc ancestor verified; recovery stash0a5529d5 unchanged.
No hosted access,Lovable,installable migration,deployment,activation,publication
or001G/H work. E remains CLOSED,installed/verified/Edge-deployed per accepted
operator evidence,trainer/Order commands paused and frontend not published.

Affected specification: **Progression and rewards; Resources, provenance and
trainer; transactional authority; Failure, diagnostics and verification**.
Roadmap ENG-PROGRESSION-001F. Accepted economics,tokens,hybrid provenance,resource
formulas and world heartbeat are preserved. Recommendations are proposals,not
approved new rules. See [implementation plan](progression-001F-implementation-plan.md).

## 1. Evidence layers and local sources

S=repository executable source; M=frozen migration/source artifact; T=generated
type declarations(shape only); H=accepted operator-reported hosted evidence.
S/M/T do not prove current installed behavior,ACLs or live reachability.

| Evidence | Local anchor |
|---|---|
|H accepted current state|[E closure](../operations/progression-001E-close.md),hosted window2026-10-07 09:41:54–09:45:14UTC|
|M canonical schema|Drizzle0001/0002/0003/0004; C/E/R2 operations artifacts unchanged|
|S provenance|`docs/operations/progression-001C-authority.sql`; `scripts/progression-001E-commands.sql`; `src/shared/progression/contract.ts`,reference/resource-reference/golden tests|
|M legacy Renown|`supabase/migrations/20260731072756_3e051877-cae6-4323-9e35-a5b19fb63857.sql`,selected by E dependency generator|
|S historical respec|`fc370869:src/features/character/hooks/useStatAllocation.ts`,before E explicit refusal|
|S current callers|TrainerPanel,StatPlannerDialog,CharacterPanel,useStatAllocation,useCharacter,GamePage|
|S privileged overrides|`supabase/functions/admin-users/index.ts`; `src/components/admin/users/UserManager.tsx`|
|T declaration|`src/integrations/supabase/types.ts`,characters/progression_* and train_renown_stat|
|H older installed inventory|[B evidence](../operations/progression-001B-evidence-report.md),timestamped ACL/body/trigger evidence|

Searches covered Renown/bhp/trained/lifetime,respec/stat-reset/attribute-reset,
pool/tokens/trainer/admin/service writers,SQL/Edge/RPC/types,reward/quest/hunt/
crafting,UI/tests/docs. Frozen migrations are evidence,never replay candidates.

## 2. Renown storage and rank model

- characters.bhp integer NOT NULL DEFAULT0 is spendable RP,legacy name.
- rp_total_earned integer NOT NULL DEFAULT0 is lifetime RP; spending leaves it alone.
- bhp_trained jsonb NOT NULL DEFAULT'{}' holds independent selected-stat successful
  training ranks. Missing stat key means0 in old SQL.
- Six permanent stats already include gains; CharacterPanel subtracts selected
  bhp_trained rank for its displayed base/Renown split. Gear remains separate.
- respec_points integer NOT NULL DEFAULT0 is token balance,not RP.
- No separate Renown table or stored global training rank in generated schema.
  get_renown_rank is **lifetime-RP leaderboard position**,not training rank.
  Sum of six ranks is derivable but not used for cost/chance.
- MCP get-character/list-characters read characters.renown and label bhp “Boss
  Hunter Points”; current generated character shape does not declare renown.
  This is stale read/UI nomenclature,not another proven RP store.

Schema anchors:20260310192634(bhp/ranks),20260427203754(lifetime),20260306005656(tokens).
Historical1..30 stat CHECK was dropped by20260218080636; B inventory has no stat
or rank cap. No intentional Renown rank cap found. int4 is a technical bound:
10*(r+1) representable only for r<=214748363; stat/rank additions can overflow too.
Refuse arithmetic overflow,never silently invent a gameplay cap. Actual constraints
require narrow preflight. Rank9 and above uses minimum5% chance.

**CURRENT:** six per-stat curves. **RECOMMEND:** keep them. **DESIGN CHANGE REQUIRED:**
no for this model. A global curve would make specializing raise all later stat
costs/chances and requires Mik approval,as would an explicit rank cap.

## 3. Renown call/writer map and exact algorithm

|UI/request → caller → authority → storage → result|Classification/reachability|
|---|---|
|Historical trainer → train_renown_stat → owns_character,character FOR UPDATE,dynamic stat UPDATE → bhp/bhp_trained/stat → sync_character_resources → JSON/refetch|LEGACY,now FENCED owner-only per E H/cutover; no ordinary/service direct execution intended|
|GamePage trainer NPC/service at nodes.is_trainer → current TrainerPanel Renown|Explicit unavailable panel; no current browser training RPC|
|Trainer leaderboard → get_renown_leaderboard/get_renown_rank → lifetime reads|Read-only KEEP CANONICAL; rank naming not training curve|
|Rare/boss pure resolver → reward.renown → legacy commit_encounter_tick_v2 → RP/lifetime update → events/resync|LEGACY earning source; current accepted node-path reachability unproved|
|Accepted node_tick_commit wrappers → new node_reward_claim → D XP adapter+gold UPDATE|CANONICAL XP/gold; pinned branch has **no RP/lifetime write**|
|Legacy award_party_member3/5args → trusted definer UPDATE XP/gold/RP/lifetime/materials|Service-only in B H; legacy XP route fenced by D; zero-XP/RP-only possibilities require body/ACL/caller preflight|
|Hunt/quest presentation → contract helper/events|apply_contract_complete changes contract/count only; manual claims RP payouts but pinned node has none; no authoritative earning assumed|
|Craft completion → apply_crafting_xp|FENCED XP; no RP award in body; materials unrelated to RP spending|
|Admin users → service DML|Whitelist excludes bhp/ranks; service database authority remains distinct|

Exact old selected rank=COALESCE((bhp_trained->>stat)::int,0);cost10*(rank+1);
chanceGREATEST(5,95−rank*10);rollfloor(random()*100),0..99;success iff roll<chance.
Requires ownership/L30+,but no SQL trainer,node,alive,combat,stance,request-ID or
version guard. Character lock serializes simultaneous calls. **One call is atomic**;
retry is not idempotent: lost-response retry can spend again and reroll. Success
adds1 to stat and selected rank; failure spends RP with no rank gain. Both call
legacy resource sync and return JSON,not durable canonical receipt/version.

Legacy sync currently clamps rather than refills(20260922100000 and matching
generated copy). Training never writes invested counters,so cannot itself increment
or zero them. Out-of-band gains can still contradict latest permanent-stat receipt;
legacy reset can leave rank/stat mismatch. Preserve/refuse,do not reconstruct gains.

Postgres-owned definer training bypasses the raw service UPDATE fence because
current_user=postgres. E EXECUTE fencing prevents ordinary callers. No alternate
training helper found locally; not a fresh exhaustive hosted-catalog guarantee.
Raw E fence excludes bhp,bhp_trained,lifetime,so service raw RP/rank capability is
outside it. Ordinary authenticated column ACL denies those writes. RP rewards are
not automatically training bypasses. No other recurring RP spender found; historical
one-off backfills/corrections are not runtime spending paths.

Legacy resolver RP: boss floor(level*.5),rare max(1,floor(level*.1)),otherwise0,
**per recipient without dividing RP by party size**,contradicting manual split prose.
Legacy v2 patch20260819230435 makes bhp additive renown,with lifetime increment.
Neither source nor manual proves D/E node earning today. Unknown installed reward/
quest callers remain UNKNOWN; no earning/party-economy redesign silently added to F.

## 4. Respec/reset map and proven hazards

|Path|Behavior/classification|
|---|---|
|Pre-E trainer → handleFullRespec → useCharacter.updateCharacter → direct UPDATE → separate sync → log|LEGACY; callback absent now; ordinary stat UPDATE denied per H; UNREACHABLE as canonical respec|
|Current handleFullRespec|Explicit error log only,no write/RPC; KEEP FENCED until F|
|Trainer respecAvailable=false/unavailable dialog|Disabled; optional StatPlanner refund prose is not executable authority|
|Allocation → progression-command → narrow SQL → private positive delta|CANONICAL,paused; records investment,not refund|
|UserManager resetStats → admin-users reset-stats|PRIVILEGED OVERRIDE source; changed protected stats blocked by E service fence; KEEP FENCED FOR001G|
|Admin set-level/update-character/grant-respec|Raw reconstruction/override/token grants; protected changes blocked; no-op need not fail; KEEP FENCED FOR001G|
|Creation INSERT|Outside raw UPDATE fence;001G-owned,not respec|
|Legacy resource sync|Resource-only,not stat-reset; UNRELATED to refund provenance|
|Dedicated full_respec/reset_stats RPC|No current/generated RPC found; historical algorithm was browser callback|

Exact pre-E algorithm: calculateStats(race,'classless'); each stat baseline adds
floor((level−1)/3)*currentClassLevelBonus. If stored stat exceeds that reconstructed
baseline,set it to baseline and refund positive excess; otherwise leave it untouched.
Add total refund to pool,decrement1 token even when refund0,then direct UPDATE,
separate sync RPC,local progression log. Sync catches exceptions/doesn't verify
returned RPC error; no cross-request transaction,stable ID/version/provenance receipt.

AtL3/L6/etc growth count is one behind canonical destination floor(L/3). Current
class reconstructs all prior-class growth incorrectly. Current race/config guesses
unknown history; opaque and Renown gains become “manual excess”; bhp_trained is
omitted and survives stat reset. Class gains may be wrongly removed/refunded;
lower-than-reconstruction stats stay untouched; empty consumes token; pool>200 can
fail; double submit lacks replay/version fencing. Gear is separate from stored stats,
so not directly refunded; separate cap sync can change resources. No milestone
reconstruction in that callback. Five characterization tests below prove key hazards.

Admin reset differs:8+race+**current class starting bonus**+current-class growth
counted3,6,…<=level(no same off-by-one). Sums signed stat-minus-base then refunds
max(total,0),writes every stat,refills CP,does not consume token or preserve rank
provenance/sync HP/MP coherently. Negative differences cancel positive ones.
Set-level similarly reconstructs,mislabelling excess as manual,adjusts milestone
tokens by level difference and refills all resources. These remain001G overrides.

## 5. Executable provenance and missing guarantees

C state initializes lazily on first committed XP/permanent mutation; E Order also
captures before. Opaque baseline contains character/level/XP/class,six stats,
RP/ranks,pool/tokens/resources. It is a snapshot,not attribution. No eager backfill.
Six nonnegative int4 counters default0; only discretionary_allocation increments
them by validated positive deltas and reduces pool. Permanent_reward and XP/growth
do not increment. No installed decrement/refund operation. Positive-only private
delta accepts only permanent_reward/discretionary_allocation; negative respec or
failed Renown cannot be squeezed through it as a false positive reward.

Receipt PK=(character,source,eventUUID); C operation xp/permanent,E adds order.
Each mutation increments version once,bounded2^53−1. Durable normalized request,
before/after,versions,config; permanent/order carry counters. XP records concrete
growth/levels/milestones; E unique destination3..42 every third level references
exact receipt/config/delta. Token milestone PK(character,level10/20/30/40),receipt
FK grants each new crossed destination once,noL1/no historical catch-up. Both
milestone relations survive ordinary respec/token spending.

E validatesS>=I>=0;expected version;latest receipt versionAfter/permanentStats/
class/level/XP/pool/tokens equal current;latest counter-bearing receipt equals allI.
No counter receipt requiresI0;statev0 requiresI0;missing row meansv0/I0. It does
**not** compare latest trainedRanks,RP or resources,or prove contiguous full history
merely by taking max versionAfter. Primitives alone lack all E freshness guards.
F rank continuity/refund validator must be explicit. Resource settlement/RP earning
can change state without progression version; comparing latest RP/HP naively is wrong.

Refund proof proposal: validate durable allocation/counter evolution and current E
state checks. Immutable opaque stats are a positively supported non-refundable
floor,not race/class reconstruction. Trusted E/F boundary protects vectorP=S−I,
whereI is proved investment,not guessed. First F receipt records boundary/proof
references; subsequent chain preservesP on allocation/respec and increases it only
by proven growth/permanent/Renown deltas. RequireS−I not below proved floor.
If legacy discontinuity prevents proof of oldI/baseline consistency,REFUSE→001G,
never re-anchor to bless contradictory counters. Pre-boundary unexplained excess
stays opaque/non-refundable. No row/v0=>empty_refund,no guessed spending. Every
new F receipt includes countersAfter,including unsuccessful Renown.

## 6. Proposed canonical full respec

Strict input:characterId,UUID requestId,safe-integer expectedVersion,operation=respec;
no client actor,refund/delta,tokens or roll. Verified JWT→existing authenticated Edge→
extended service-only command→new private owner-only refund authority; same paused
singleton. No generic trusted-delta RPC or direct browser UPDATE.

Fresh eligibility:owner,non-null current nodes.is_trainer,HP>0,valid1..42/XP,
class/is_classless consistency,six stats/counters,0..200 pool,tokens>=1,version/proof.
Classless allowed if valid configured state. Refuse E active combat/live claims,
movement lock,pending intent,solo queued/finalizing,party waiting/queued or pending
request,legacy sessions,active stance and uncommitted stance request. Dead refusal
is explicit proposed domain policy matching E; primitive dead clamp isn't authority.

In bigintR=sumI;R0=>empty_refund,no token,row/version/receipt mutation. No token=>
insufficient_respec_tokens. Requireintegral nonnegativeI,storage/proof-floor-safe
subtraction,U+R<=200,version+1<=2^53−1. No clipping/raising pool cap. Commit exactly
S'=S−I,I'=0,U'=U+R,tokens'=tokens−1. Preserve class/race/level/XP/RP/ranks/gear/bonds
and both milestone relations. Canonical sync(character,false,true) recalculates caps
and clamps current HP/CP/MP down only,no heal/refill/resurrection. One receipt/version;
failure rolls all mutations back.

Add receipt operation=respec,source=full_respec. Receipt actor/request/config/proof
refs,before stats,counterBefore/refunded six,total,tokens/pool before/after,counterAfter0,
protectedPermanent before/after,resources/current maxima before/after,class/rank
preservation,versions/projection. Existing receipts suffice; no respec history table
or nested permanent-delta receipt/double version. Token relation remains earning proof.

## 7. Stance policy

|Policy|Ownership/lock tradeoff|
|---|---|
|A refuse active/pending|Reuses E ownership; no reservation/effect mutation; player explicitly ends stance|
|B clear/release|Must own stance/request/reserved CP/effects/encounter; risks character→second node/encounter; broader transition semantics|
|C preserve/recompute|Lower caps can fall below reservations; effect strength/pending application/combat snapshots require wider lock ownership|

Recommend **A** for fresh respec and Renown. B/C require separately approved stance
contract. Never auto-clear. Mik acceptance before implementation; local tests do not
prove hosted multi-session behavior.

## 8. Proposed canonical Renown and provenance

Input characterId,requestId,expectedVersion,operation=renown,selected stat enum;
no actor/cost/chance/rank/RP/delta/seed/roll. Same ownership/alive/combat/lifecycle/
stance/class/proof/version and pause guards;L>=30;RP>=0,valid integral nonnegative
selected rank,valid rank JSON keys/types,arithmetic headroom,sufficient RP.
Contradictory historical rank/stat/proof refuses; no reconstruction.

Old SQL has no location guard,but current UI opens Renown Trainer atnodes.is_trainer
via trainer NPC/service. Recommend same trainer flag server-side for both commands,
no distinct location or NPC-presence rule. Explicit Mik eligibility decision.
Retain per-stat cost10(r+1),chance max(5,95−10r),roll0..99/success<chance. Both outcomes
spend RP;success adds only selected rank/stat1. Lifetime/counters unchanged. Both
outcomes one receipt/version. Validate existing resource/progression anomalies and
refuse rather than opportunistically repair. Canonical non-level clamp sync,no
refill;valid failure resources remain identical;success raises caps without pools.

Future Renown is **not opaque history**: current bhp_trained plus immutable receipt
permanentDelta0/1,countersAfter unchanged gives non-refundable proof. Addoperation
renown/source renown_training. No extra rank counters or training-history relation.
Extend snapshot/projection for RP/ranks and client version; validate rank continuity
from anchor/receipts while allowing legitimate RP earnings outside version stream.
Do not compare latestRP blindly or emit two receipts/versions through positive primitive.
Receipt actor/request/stat,rankBefore,RPBefore,cost/chance,roll/algorithm/key version,
outcome/delta,rank/RPAfter,lifetime/counters,stats/resources/config,versions/projection.
No key/seed in receipt/browser.

## 9. Deterministic RNG and replay

Combat2 tick-rng keys public encounter/tick/named streams with FNV1a/xorshift for
retry stability,not anti-grinding. Client-chosen UUID hashing alone lets clients
search wins. No browser roll,no fresh random() retry.

Recommend HMAC-SHA256 using a persistent private server Renown domain key,keyVersion1,
generated once **before attempts are enabled**. Canonical length-prefixed message:
domain=wov.renown.v1,characterUUID,requestUUID,stat,expectedVersion,rankBefore,drawIndex.
Key owner-only,no plaintext release/log secret. [Postgres pgcrypto HMAC](https://www.postgresql.org/docs/17/pgcrypto.html#PGCRYPTO-HMAC)
provides keyed hashing; installed extension/schema requires preflight.
First4 digest bytes unsigned big-endianx;acceptx<4294967200,roll=x mod100;
otherwise increment deterministicdrawIndex/re-hash. Bounded draw limit→fail closed,
never random fallback. Persist algorithm/key version,drawIndex,roll/chance/outcome.
Same preexisting key/input after rollback gives same roll. Replay committed receipt
without hashing/spending. No rotation during unresolved retries; rotation needs a
separate key-version/replay contract.

Small justified relation: private one-row domain key(keyVersion,key bytes),no player
backfill. Unlike a seed lazily minted in an aborted attempt,it survives rollback.
Clear invariant benefit is unpredictable rollback-stable RNG; no duplicate training
history/state. Review key generation,RLS/no policies/ACL/platform authority handling
and no-secret export. Reuse existing approved key facility only if actually evidenced;
none found locally. Key choice/rotation is explicit engineering decision before code.

Authenticate/normalize,lock node/character,then replay existing request **before**
new pause/location/version/lifecycle checks. Same payload returns original with
separate current projection;changed actor/stat/op/version refuses. Existing receipt
PK/lookup is source-scoped; F must add cross-command request guard under character
lock across discretionary_allocation(with command metadata),order_command,
full_respec,renown_training;don't indiscriminately collide server XP event UUIDs.
Refused preconditions have no receipt/RP/token/version changes. Client retains UUID
on uncertain transport and reconciles before new attempt.

## 10. Lock/transaction order

Read initial acting node;exactly its combat_enter_node advisory lock;character FOR
UPDATE;recheck owner;replay/conflict;revalidate same location (changed=>refuse,never
lock second node);pause/version/state/proof;sidecar FOR UPDATE if present;rank JSON
already on locked character;receipt reads serialized by character;E lifecycle/stance
predicates;class config FOR SHARE;immutable key read,no key-update lock;atomic private
mutation;canonical sync re-lock same character;one version/receipt;commit.
Lazy sidecar INSERT only for actual successful mutation,not empty/invalid refund.
No separate Renown state lock. Receipt uniqueness+character/cross-source guard handles
duplicates. Never character→second node/encounter;helpers cannot reverse order.
Character-only rewards serialize without an F node lock. Known arrival character→
destination exception is not license to repeat it. Relevant installed lifecycle
writer lock clauses must be pinned below. Equipment writers must serialize with
character authority for the shared inventory-based resource calculation; E source
alone does not prove all concurrent equipment callers do so. Check only the relevant
equipment resource-writing lock dependency if not already pinned; never add a
reverse lock order opportunistically. Hosted contention remains unproven.

## 11. Containment and activation

|Candidate|Disposition|
|---|---|
|Legacy train_renown_stat|RETIRE IN001F ordinary route;keep owner-only until dependencies prove removal safe;no fallback/grant|
|Old browser reconstruction|Already absent;RETIRE stale controls/prose/refusal stub when canonical UI lands|
|Allocation/Order/projection/XP/growth|KEEP CANONICAL;narrow dispatch/receipt/projection extension,not XP rewrite|
|Admin reset/set-level/update/grant-respec|KEEP FENCED FOR001G;no deletion/reopening|
|Generic useCharacter.updateCharacter|Keep preference/nonprogression paths;no F stat UPDATE;DB ACL/fence authoritative|
|RP earning/party split/hunt payouts|NEEDS DECISION if contradiction confirmed;no silent F redesign|
|Leaderboards/display|KEEP CANONICAL reads;clarify F nomenclature|
|MCP stale field/label|NEEDS DECISION on bounded presentation repair,no currency merge|
|Creation/crafting/legacy sync/Arena|KEEP FENCED FOR001G or UNRELATED;preserve domain ownership|

Recommend activation **A**: all E/F commands paused through source,install,Edge and
verification;one later separately authorized activation,then Mik-controlled frontend
publication. No early E activation. UI currently refuses Renown/respec and allocation
returns commands_paused;balances don't imply availability. No compatibility fallback.

## 12. Existing-character test vectors (proposed,not F implementation)

All fresh commits require approved eligibility and enabled control;otherwise
commands_paused. Refusal=zero durable mutation. ReferenceS each10,I0,U0,tokens1.

|#|Scenario|Expected mutation/refusal|
|---|---|---|
|1|New/no investment|empty_refund;no token,row/version consumption|
|2|I_str5,S_str15|S_str10,U+5,I0,token−1,one receipt/version;clamp|
|3|I each1,S each11|S each10,U+6,I0,one token/version|
|4|Historical no sidecar|unknown old spending remains opaque;empty_refund,no row for refusal|
|5|High opaque44/I0|44 preserved;empty_refund,no guesses|
|6|Growth+2,I5,S17 from10|refund5 leaves12;growth/config rows unchanged|
|7|Class switched|refundI only;old/new growth and current class preserved|
|8|Future Renown+1 plusI5|refund5 preserves rank/+1;RP receipt unaffected|
|9|Failed Renown|cost spent;rank/stat/I unchanged;one receipt/version|
|10|Gear|inventory unchanged;durability/gem caps recalculated;pools clamp only|
|11|L42,XP0|F no XP/level/milestone earning;respec/Renown eligible otherwise|
|12|Tokens0,Ipositive|insufficient_respec_tokens;no mutation|
|13|Token1,I0|empty_refund;token1|
|14|Bad counters/receipt/version|inconsistent_provenance;no repair|
|15|Dead|fresh dead refusal;replay original still returns,no resurrection|
|16|Combat/live claim|active_combat;no mutation|
|17|Active stance|unsafe_lifecycle;no release/recompute|
|18|Pending stance|unsafe_lifecycle;old committed requests alone need not block|
|19|Duplicate respec|replay;no second refund/token/version|
|20|Duplicate Renown/lost response|same outcome;no roll/spend|
|21|UUID conflicting stat/op/version/payload|request_conflict across command sources|
|22|Concurrent expectedv|first v+1;second stale_state;first retry replays|
|23|rank0,RP50,roll94|cost10/chance95 success;RP40,rank/stat+1,Iunchanged|
|24|rank0,RP50,roll95|failure;RP40,rank/stat/I unchanged;receipt/version|
|25|rank9,RP200,roll4/5|cost100/chance5;4 success/5 failure;both spend100|
|26|U198,refund5|cap refusal;no lost points/token|
|27|Bad rank JSON/overflow|invalid_state/arithmetic_overflow,no spend|
|28|Sync/receipt failure|all mutations rollback|
|29|Precommit rollback/retry|same persistent-key roll|
|30|Wrong owner/changed node|unauthorized/location_changed;no second node lock|

## 13. Minimum preflight and Mik decisions

**LOCAL SUFFICIENT:** reviewed XP/R1/R2 artifacts,E boundary/paused control accepted
H,source algorithms/UI,C/E schema and receipts,positive-only primitives,E lock
design,unknown historical provenance. No broad repeated E inspection,data dump,
natural-runtime/concurrency/authenticated-paused probe requested in this task.

**ONE BUNDLED READ-ONLY PREFLIGHT after decisions/before implementation guards:**

1. Exact installed Renown body/security/ACL/effective callers/overloads and dependency
   search: E H proves fence,not fresh exhaustive alternate training graph.
2. Relevant six stats/RP/ranks/lifetime/pool/tokens/class/trainer defaults/constraints
   and triggers touching them: M/T cannot prove installed bounds/trigger restoration.
3. Targeted award_party_member/legacy v2/hunt/quest RP writers mentioning RP/ranks,
   effective ACL/callers;compare pinned node XP/gold branch: local earning/manual
   contradictions and raw service coverage matter;unknown/fenced stays explicit.
4. Relevant stance/entry/departure and equipment resource-writer lock clauses vs
   accepted E identities only where needed for new guards: source cannot exclude
   installed reverse-order drift or an inventory writer bypassing character serialization.
5. pgcrypto hmac/gen_random_bytes schema/signatures and approved existing key facility,
   **no key values**: core SHA/UUID availability does not prove HMAC/key storage.
6. Aggregated malformed/negative ranks/RP/counters,I>S,v0 nonzeroI,receipt-proof
   mismatch counts only: local source cannot prove data quality;no attribution/backfill.

Do not redo unmodified full0003/0004/Edge inventories or solve retained runtime
limitations. Only later explicit hosted authorization;no tool probes/install/key
creation. Unexpected drift stops design/code,not another migration runner.

**MIK DECISIONS BEFORE IMPLEMENTATION:** stanceA and dead refusal;same is_trainer
eligibility for both;pool>200 refund refusal versus explicit capacity change;secret
HMAC/key/rotation design;scope treatment of RP earning/party discrepancy. No hidden
global rank/cap or historical attribution choice. Current per-stat economy stays.

## 14. Characterization and stop

`scripts/progression-001F-audit.test.mjs` executes exact pre-E callback with unchanged
real stat formulas and exact frozen Renown SQL in disposable PGlite. Five tests
prove destination off-by-one,opaque/Renown refund hazard,empty-token/separate-write
hazard,per-stat economics/failure spending/unchanged counters,and current refusal
plus E rank/currency freshness omission. Ownership/resource helpers are stubs;
tests do not certify hosted triggers/resources or F runtime. No F implementation.
Acceptance: characterization5,focused252,E SQL22/actual Combat2 chain11 and
D containment6 passed;four typechecks/production build passed;full2730passed/18failed,
identical closure baseline failure identities. Manifest/state/whitespace checks and
state regression tests passed3/3;manifest/state/whitespace checks passed. Concrete stages begin with decisions/preflight,separate approval.

**ENG-PROGRESSION-001F AUDIT/DESIGN COMPLETE**
**READY FOR DESIGN DECISIONS / MINIMUM HOSTED PREFLIGHT**
**NOT IMPLEMENTED / NOT INSTALLED / NOT ACTIVE**

STOP. Retain HOSTED MULTI-SESSION BEHAVIOR UNPROVEN;NATURAL RUNTIME PATH NOT YET
OBSERVED;AUTHENTICATED COMMANDS-PAUSED RUNTIME PROBE NOT EXECUTED.
