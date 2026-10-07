# ENG-PROGRESSION-001G-A — Admin, creation and reconciliation audit

**ENG-PROGRESSION-001G-A AUDIT COMPLETE. Documentation only. 001G is not implemented or closed.**

Audit date: 2026-10-08 (Europe/Copenhagen). Starting and inspected source checkpoint:
`b4d314e63ff5ebd904bf631f4afd586cb9035610`. Fetch succeeded; normal fast-forward
check reported already up to date. Recovery stash anchor:
`0a5529d5227675319b166881b10f1c91edd7486b`. The actual checkout is
`C:/Users/mik/Documents/WoVarneth/repo`, not its enclosing scratch directory.
No hosted access, secret inspection, gameplay writes, schema changes, migration
generation, deployment, activation or publication. Proposed policy below is not approval.

## 1. Executive findings and evidence boundary

1. Canonical progression is technically fenced against ordinary raw protected
   UPDATEs. The repaired service partition is **protected15 denied / unprotected38
   allowed**, without table UPDATE. This does not fence INSERT, owner-definer
   execution, deletion, equipment changes or resource-only edits.
   A specific retained alternative is the service-granted SECURITY DEFINER
   commit_encounter_tick_v3 → owner-only v2 chain: direct v2 revocation does not
   remove this source-level delegated capability. Installed status is UNKNOWN.
2. Four old admin operations still exist: reset-stats, set-level, protected
   update-character edits and grant-respec. Their protected writes are rejected
   by the reviewed ACL/fence. The UI still offers level/reset/grants. Grant XP
   explicitly returns 503. No broad grant should be restored to make these work.
3. Creation is not a canonical domain authority: the browser calculates race
   attributes, while character_create accepts supplied values and class/classless
   state. INSERT is outside the raw UPDATE fence. Its frozen source includes
   a cast to removed character_class; this is a source inconsistency and likely
   regression, **not proof the deployed RPC fails**. Earlier B/E inspection
   records an installed RPC identity, without supplying its full body. Exact
   installed creation body remains unverified here.
4. Creation sends CP in the page but the hook discards it. SQL omits CP/MP and
   canonical sidecars. Historical inspected defaults are CP100/100 and MP100/100,
   unlike derived level-1 CP (30 plus INT/WIS modifiers). No creation resource-sync
   trigger appears in the retained C installed inventory. This is a proven source
   omission and a likely runtime resource discrepancy, pending fresh metadata.
5. No safe reconstruction of historical growth or spent points follows from
   current class, race, level or Renown ranks. Future canonical receipts/counters
   and growth milestones establish bounded forward proof; opaque baseline remains
   opaque. No automatic rewrite or blanket respec is justified.
6. Service resource edits, admin inventory changes, owner-definer resource helpers
   and Test Arena resets remain separate authority surfaces. They can affect
   derived state or lifecycle without changing protected permanent columns.
   The previously deferred equipment serialization gap and RP earning gap remain.
7. Priority: approve narrow repair policy, secure creation, reconcile admin
   capabilities/UI, then detect and authorize only individually proven repairs.

Evidence notation: **S** local executable source; **M** immutable historical or
Drizzle migration text; **H** retained operator-supplied hosted observation; **T**
local tests. H is timestamped historical evidence, not current Codex inspection.
An enabled local control is source reachability, not deployment/publication proof.
All live admin endpoint revisions, installed overloads, role memberships and
external callers are UNKNOWN unless specifically supported by retained H.

Reviewed guidance/contracts: [project understanding](../design/project-understanding.md),
[AI operating guide](ai-operating-guide.md), [project state](project-state.md),
[operating contract](lovable-supabase-operating-contract.md),
[engine specification](../design/game-engine.md#progression-and-rewards),
[roadmap](../roadmap/game-engine-roadmap.md),
[C authority](progression-001C-authority.sql),
[C installed preflight](progression-001C-installed-preflight.md),
[D cutover](progression-001D-cutover.sql), [D closure](progression-001D-closure.md),
[E audit](progression-001E-audit.md), [E plan](progression-001E-plan.md),
[E implementation](progression-001E-implementation.md), [E closure](progression-001E-close.md),
[F audit](../design/progression-001F-renown-respec-audit.md),
[F implementation](progression-001F-implementation.md),
[F ACL repair](progression-001F-R1-service-update-repair.md),
[F closure](progression-001F-closure.md). Historical prospective statuses are
superseded by the respective closures; no reopening of F is implied.
Affected specification areas: Progression and rewards; Resources/provenance/trainer;
transactional authority; Failure/diagnostics/verification. Roadmap ENG-PROGRESSION-001G.
All approved engine rules and the single world heartbeat are preserved.

## 2. Admin operation inventory and complete request traces

Count convention: **12 character-affecting admin-users action branches**, listed
below, excluding account list/password/role/ban operations. Separately, Appendix A
contains **98 relevant named SQL writer/trigger/delegate candidates** (89 initial
hits minus two rejected prefix matches plus11 transitive delegates), deduplicated by name
for navigation, not by installed overload. These counts overlap and must not be
added to claim a unique live-writer count. Additional UI/config/Edge surfaces are
listed in section 3. Historical versions, dynamic patches and overloads remain
evidence rather than silently inferred installed definitions.

Common admin-users path **A**:
AdminRoute → AdminPage/users → UserManager.callAdmin → authenticated HTTP
`/functions/v1/admin-users?action=...` → verifyAdmin claims/sub → service client
reads user_roles → steward/overlord authorization → action decision → service DML
or RPC → characters/inventory/materials → JSON → checked HTTP response → toast
and loadUsers. Exact anchors: `src/pages/AdminRoute.tsx:8`,
`src/pages/AdminPage.tsx` imports/render switch, `UserManager.tsx:43`,
`supabase/functions/admin-users/index.ts:17,56`. Here and below paths abbreviated
to users mean `src/components/admin/users/`.

The caller can target another user's character by design; no per-target ownership
requirement is present for admin actions. isValar controls role/ban UI, but the
character mutations allow both steward and overlord in the backend. No durable
admin reason, actor record, before/after image, command UUID, expected version or
progression receipt is written by these branches. HTTP success is not proof of
one affected row: most UPDATEs use eq(id) without RETURNING/count checks. Errors
throw into a generic500 unless explicitly assigned another status.

| # / operation | UI/request → command/domain → writer/database → result/UI | Permission, validation, transaction/replay | Classification; compatibility; recommendation |
|---|---|---|---|
| A1 set-level | Sheet level input → UserManager:146 → A → endpoint:158–252 reconstructs base/race/current-class growth, pool/milestones, resets XP, refills resources → one characters UPDATE → success/old/new level → reload | A; number1..100, not integer check; separate read then one atomic UPDATE; no request identity | **FENCED** protected write under0006; SQL command not canonical. Same-level exits before UPDATE. UI still enabled. **REPLACE** with separate canonical upward grant and approved exceptional correction; never infer mixed growth |
| A2 update-character | Sheet name/gender/gold via UserManager:144–164 → A → endpoint:254–306 whitelist → characters UPDATE → success → reload | A; name1..50; integer ranges for some numeric fields; gender/respec lack equivalent range checks; UUID location shape; single UPDATE, no count/replay | **LEGACY ACTIVE** for permitted fields, **FENCED** if payload contains protected fields (even alongside name). UI currently edits only name/gender/gold/level, not all whitelist fields. **REPLACE** generic protected editing; **KEEP/REPAIR** narrowly validated identity fields |
| A3 give-item | Actions Give → UserManager:161 → A → endpoint:308 → character_inventory INSERT, durability100 → success/reload | A; only IDs present; FK/unique/trigger validation at DB; one INSERT; no request deduplication | **LEGACY ACTIVE** source; affects equipped/effective inputs indirectly, not permanent stats. **REPAIR** idempotency, actual item durability and canonical inventory/lifecycle serialization; duplicate retry may give twice |
| A4 teleport HTTP | Direct authenticated admin request → A → endpoint:319 → validates destination exists → characters.current_node_id UPDATE → success | A; node existence, separate read/update; no request identity | **DORMANT UI path**: current button uses RPC instead (section3). Direct endpoint still source reachable: **LEGACY ACTIVE request surface**; no proof dead. **RETIRE** duplicate after caller proof |
| A5 grant-xp | Actions Grant XP → UserManager:188 → A → endpoint:331 → immediate503 progression_awards_paused → toast.error | A authentication first; no amount/domain decision/write | **FENCED** explicitly paused in source and D historical deployment report. **REPLACE** approved canonical award entry; **REPAIR** UI unavailable wording now in later phase |
| A6 revive | Actions Revive → UserManager:197 → A → endpoint:336 → reads max_hp then sets hp=max_hp → success/reload | A; character required; no alive/death/claim/version checks, no request ID; read and UPDATE separate | **LEGACY ACTIVE** unprotected hp; UPDATE/lifecycle triggers still apply. Not full restoration/respawn; does not clear death state or synchronize caps. **REPLACE** explicit lifecycle-aware recovery policy; do not call runtime-proven safe |
| A7 remove-item | Actions Remove → UserManager:205 → A → endpoint:348 → character_inventory DELETE → success/reload | A; inventory ID present; one DELETE, no affected count; unique/stance triggers may refuse; repeat may silently succeed | **LEGACY ACTIVE**; deletion of equipped gear can change maxima/stance prerequisites. **REPAIR** through inventory authority/locks, compensation record; no resource synchronization here |
| A8 reset-stats | Actions confirmation → UserManager:215 → A → endpoint:357–418 → hard-coded race/current-class reconstruction/refund → stats,pool,CP UPDATE → refunded_points toast/reload | A; character lookup; guessed refund, no proven counters; separate read/update; no stable request/audit | **FENCED** by protected ACL. Different race constants from set-level; can refund Renown/opaque growth and leave provenance contradictory if reopened. **RETIRE** algorithm; replace only with canonical proven respec or approved narrow repair |
| A9 grant-salvage | Actions amount → UserManager:232 → A → endpoint:421 → add_material(character,salvage,delta) → materials/salvage → new_total toast/reload | A; amount>=1, no integer/max equivalent; RPC transaction, not whole HTTP transaction; no request identity | **LEGACY ACTIVE** support input/economy, not canonical progression; **REPAIR** validation/replay/audit as bounded support grant |
| A10 grant-gem | Actions gem/amount → UserManager:250 → A → endpoint:432 → add_material → character_materials → new_total/reload | A; six keys,1..1000 but no integer check; RPC atomic; no request dedup | **LEGACY ACTIVE** affects future/equipped gem-derived stats indirectly; **REPAIR** support-grant semantics |
| A11 grant-gold | Sheet/actions → UserManager:241 → A → endpoint:448 → read gold, absolute gold UPDATE → total/reload | A;1..1000000, not integer; two requests, lost-update race; no UUID/audit | **LEGACY ACTIVE** unprotected gold; **REPAIR** atomic delta/idempotency. Overlaps sheet gold edit; prevent competing convenience authorities |
| A12 grant-respec | Actions → UserManager:223 → A → endpoint:461–469 → read respec_points, absolute increment UPDATE → total/reload | A; amount>=1, no method restriction or integer/max; no request identity/transaction around read/update | **FENCED** protected column. **REPLACE** narrow token grant with separately approved purpose/cap/accounting; not a raw grant reopen |

Exact database boundary: Drizzle0003 `progression_refuse_raw_progression_write`
at150–160 (BEFORE UPDATE),0005 replacement423–431,0006 partition8–15 and166–179.
Fenced classifications are S/M plus retained H from F closure; a new hosted
call was not made. Local source UI controls being enabled is proven, but deployed
frontend presence and live error wording remain unverified.

## 3. Other reachable surfaces and supporting writers

| Surface / trace | Authority, database, validation/transaction/replay/audit | Classification / disposition / risk |
|---|---|---|
| UserManager:173 teleport button → authenticated admin_teleport RPC → role predicate/node check → current_node_id UPDATE → void → success/refetchCharacters/loadUsers | `20260311115903…sql:1`; browser EXECUTE explicitly retained at `20260908175256…sql:142–143`. One DB transaction with location/lifecycle triggers; no command ID, no affected count, no progression event | **LEGACY ACTIVE**, **REPAIR** lifecycle/request audit. Duplicate HTTP teleport exists; permission check rather than browser role alone. Protected15 fence does not cover location |
| CharacterSelect → Index:113 onDelete → useCharacter:340 → delete_character_cascade → owner OR steward/overlord → child DELETEs then characters DELETE → UUID → optimistic list removal/refetch on error | `20260623072204…sql:1–45`; authenticated grant in predecessor `20260622212522…sql:47`. Single transaction; no tombstone/restore/replay receipt. C state/receipts and E growth have cascading FKs | **LEGACY ACTIVE**, **REPAIR/DEFER** deletion/restoration policy. No admin restore endpoint found. Newer Combat2 FKs may refuse or cascade; hosted constraint graph unknown. Deleting can erase canonical proof; do not call this restoration-safe |
| Creation → character_create → INSERT → starting materials trigger → returned row → optional family RPC → selection | Detailed section4 | **LEGACY ACTIVE request surface**, **REPLACE** authority; runtime viability unknown |
| Admin classes → ClassConfigManager:129–150 classes UPDATE(base_hp/base_ac/level_bonuses/config) → toast/load; ClassAuthorDialog class INSERT | Overlord RLS in `20260731134850…sql:26–32`; UI validators are not DB security. One catalog DML; no per-character transaction/receipt. Canonical XP reads configured forward growth fingerprint | **LEGACY ACTIVE catalog authority**, **KEEP/REPAIR** bounded config version/audit. Changes future growth/effective caps, not historical milestones. No retroactive normalization |
| Admin races → RaceManager:95–120 races INSERT/UPDATE/DELETE → registry reload → creation calculateStats | Catalog privileges/RLS and FK validation; dynamic registry source `src/hooks/useRaceRegistry.ts`, `src/lib/game-data.ts` | **LEGACY ACTIVE catalog authority**, **KEEP/REPAIR** creation config boundary. RPC enum casting may reject custom races. Existing permanent race-derived stats are not retrospectively recalculated |
| Admin XP boost → XpBoostPanel:22,54,75 xp_boost SELECT/UPDATE → reward amount inputs → canonical XP consequences later | Browser catalog UPDATE/RLS, local submission/latest-request guards; no character write/receipt; updates all nonzero-ID rows, duration uses browser clock | **LEGACY ACTIVE config**, **KEEP/REPAIR** multiplicity/expiry validation; does not itself grant XP or prove earning eligibility |
| Item/ability/status/creature catalog managers → catalog DML/admin reward RPCs → resolver/resource inputs → future events | AdminPage render switch; ItemManager read of holder at187 is not character DML; ability/status tuning affects effective combat, not permanent stat allocation | **LEGACY ACTIVE config**; **KEEP**, separately bounded catalog audit. Changes to item.stats/gems/base_hp can change derived results without protected UPDATE |
| ToolsPanel:16–46 ClassBondsInspector/CombatAudit/UniqueReclaim → read-only projections | UniqueReclaimManager:108,120 reads inventory/characters; no mutation button; ClassBondsInspector is current-bond read, not historical-growth proof | **CANONICAL read-only diagnostic** with historical wording risks; **KEEP/REPAIR** labels. Do not count unique-reclaim UI as a reclaim writer |
| Scheduler/world cleanup → return_unique_items → inventory DELETE for offline/destroyed uniques → holder/unique triggers | `20260720070010…sql:1`; one DB transaction, no progression receipt; actual scheduler/ACL runtime unknown | **UNKNOWN current reachability**, **DEFER/REPAIR** equipment sync/serialization; UI only predicts eligibility |
| Admin marketplace cancel/expire/delete → MarketplaceManager:149–177 → RPC or listing DML → inventory escrow/holder side effects → reload | Listing/domain auth and unique holder triggers, not permanent character authority; cancellation RPC path differs from direct listing edits | **LEGACY ACTIVE source**, **DEFER** broader economy scope, retain equipment/derived consequence risk |
| Test Arena admin → admin-api.ts:126–152 → grant/revoke/relocate/stop/reset/start-close environment/run/emergency RPCs → arena locks/requests/access → resource/position restore → decoded ok/refusal → UI | reset latest wrapper `20261001213148…sql:567` delegates to renamed predecessor + combat2_restore_arena_stances at542. Predecessor reset `20260907110000…sql:182–212`: admin check, arena advisory lock, request replay/conflict, stopped/no claims/no recording checks; character current_node_id/hp/cp/mp restore at206. Request rows are audit/replay evidence, distinct from progression receipts | **CANONICAL arena domain**, **KEEP**, not canonical progression reset. Full resources from current caps are intentional arena semantics, not general character repair. Source tests pass; installed/live unknown here. No arena invocation authorized |
| Trainer allocation/Order/respec/Renown → progressionClient → progression-command Edge → verified actor → service-only progression_command → private C/E/F functions → character+sidecars → receipt/projection → refresh/log | `src/features/character/hooks/useStatAllocation.ts:14–52`; shared handler:13–56; SQL0005:218,302,446. Ownership, trainer/location/alive/combat/movement/stance, positive integer/cap/config/version validations; locks and transaction; stable UUID exact replay/conflict; no arbitrary actor/delta source from browser | **CANONICAL, COMMANDS PAUSED** per closure; **KEEP**. Public projection authenticated-own, mutations only narrow service entry. HTTP200 can be structured refusal; current client decodes it. No activation authorized |
| Combat2 accepted reward → node_tick_commit wrapper chain → newly accepted node_reward_claim → combat2_apply_claim_progression_internal → XP/growth/resources/state/receipt → delivery events/UI | SQL0002:71,89 and unchanged outer wrappers; tests actual chain12. Owner-only primitives/adapter; service only outer commit; claim identity, no duplicate/backfill; whole claim transaction rollback | **CANONICAL XP/gold**, **KEEP**. No RP earning in accepted branch; not an admin repair entry |
| Legacy crafting/party/encounter XP/Renown/bond/Order → retained SQL body |0002:38–65 fences apply_crafting_xp, stonebinder_commit_fuse, commit_encounter_tick_v2 and BOTH award_party_member overloads;0003 legacy Order/bond/Renown revocation;0005 guards retained writers. No ordinary/service EXECUTE intended | **FENCED**, **RETIRE later** after dependency proof. Owner execution is an admin capability, not a browser/service bypass permission. Historical source arithmetic is not authoritative today |
| Historical service RPC → commit_encounter_tick_v3 → postgres definer calls v2 → legacy proposed reward/permanent/resource writer → old batch/result; retained C3 orchestration:531 calls v3 | `20260818220917…sql:1–70`, service-only explicit grant repeated `20260818222752…sql:1–2`; advisory/row lock, boundary/claim/snapshot/old batch validation, then v2, one transaction. No canonical C receipt/claim adapter. 0002 revokes v2 directly but does not name v3 | **UNKNOWN hosted reachability; LEGACY ACTIVE source service capability**, old Edge consumers retired/dormant. **REPLACE/RETIRE capability** only after exact hosted metadata/dependency proof. Definer can invoke owner-only v2 and bypass the non-postgres raw fence; valid old claim prerequisites still apply |
| Legacy trainer direct UPDATE and generic useCharacter.updateCharacter → optimistic local state → characters UPDATE → pending flags cleared | useCharacter:395–439; browser six-preference ACL rejects protected/resource/location writes. Current useStatAllocation uses canonical client instead | **FENCED** as progression path, **LEGACY ACTIVE** preference writes; **REPAIR** callers/optimistic failure handling. No DB success inferred from React state |
| Retired combat-tick/combat-catchup and paused crafting Edge routes | D closure documents410 shells and crafting503s, no reachable runtime XP writer in shells | **DEAD / UNREACHABLE writer**, **KEEP fenced** until authorized removal; source existence alone is not active legacy gameplay |
| Other Edge direct DML: forge-strip, sell-material, ai-character-portrait; orchestration resource reads/calls | `forge-strip/index.ts:85–98` consumes material, separately edits gold/gems without inspecting both errors; R1 suite case09 inventories direct Edge character UPDATE columns; portraits are three granted preference columns | **LEGACY ACTIVE source**, **REPAIR/DEFER** derived/economy safety. Forge-strip can report success after failed update and lacks atomic whole operation/sync. No protected15 direct payload bypass identified |

[Appendix A](progression-001G-A-writer-inventory.md) extends this inventory to resource helpers, equipment writers, triggers,
historical harness INSERTs and delegates. UNKNOWN is deliberate where migration
text/callers do not establish effective installed ACL/lifecycle reachability.
It is not a recommendation to enable those functions.

## 4. Character creation and initialization trace

`Index.tsx:74–94` checks presentation startingNode then renders CharacterCreation;
page:22 STARTING_CLASS='classless', page:41 preview uses calculateStats; page:98–137
create handler → GameContext callback → useCharacter:356–387 → character_create
→ caller auth.uid / combat2_respawn_config.default_node_id → INSERT → AFTER INSERT
grant_starting_materials → returned row and React characters append → optional
apply_family_to_character (second RPC) → selectCharacterAfterCreate.

| Baseline dimension | Design/code/default evidence | Assessment |
|---|---|---|
| Wayfarer | UI forces classless,true; SQL accepts _class/_is_classless, default false | Intent shown by UI; DB does not require it. Malicious authenticated RPC can request other class/state |
| Race/attributes | calculateStats in `src/lib/game-data.ts` starts all6 at8 + race + class bonus; useRaceRegistry updates race definitions | SQL checks nonnegative minimum and hp=max_hp but not canonical race calculation, upper bound, class/race availability or classless consistency; NOT a trusted baseline |
| Level/XP | RPC omits both; C installed-preflight character defaults L1/XP0 | Default-led L1; no browser level field in RPC. This protects level only incidentally, not supplied stat authority |
| HP/AC | Page getMaxHp(classless,con,1)/calculateAC; SQL trusts supplied hp/max_hp/ac | UI computed, not DB derived. RPC allows0HP unless DB checks constrain it; SQL missing canonical upper/domain checks; max_hp constraint may refuse |
| CP | Page getMaxCp(1,INT,WIS) and sends cp/max_cp; hook signature/payload omits them; RPC INSERT omits them | Proven dropped inputs. Retained H defaults100/100 versus formula30+3*positive INT/WIS modifiers. No initial sync shown |
| MP | Page/hook/RPC omit mp/max_mp; defaults100/100 | Can differ from100+10*positive DEX modifier atL1. No fill rule approved beyond existing code/default evidence |
| Derived synchronization | No character_sync_derived_internal or sync_character_resources call in creation. Retained C triggers list no resource initializer | Creation resource safety NOT established. Sync later clamps, so cannot retroactively prove intended initial fills |
| Inventory/gear | No creation inventory INSERT/caller. grant_starting_gear and tables dropped by `20260730085821…sql:1–3` | No guaranteed starter equipment in current path. Historical gear function is DEAD, not an implicit grant |
| Materials/gold | grant_starting_materials AFTER INSERT `20260803232302…sql:1–25` gives salvage40 and six gems1; page summary says salvage42/gold100; migration `20260624095137…sql:1` gold default200 | Proven source presentation/default mismatch; fresh installed gold/material default/body required. Trigger material rows and character INSERT are one transaction |
| Provenance | C state/receipt/respec milestones and E growth rows initialize lazily on canonical accepted event; creation invokes none | No creation receipt/baseline/version. Missing sidecar alone is allowed for opaque pre-event state, not proof creation canonical |
| Growth milestones/points/tokens | Default pool0/token0; no level3+ growth rows atL1; canonical future XP records destinations3,6,...42 | Do not synthesize past milestones or initial discretionary points. NoL1 point in approved progression |
| Renown | Retained H defaults bhp0/ranks{}/rp_total_earned0 | No creation Renown command or proof; no RP grant warranted |
| Other sidecars | family applied separately; no class bond INSERT for classless creation; stance/resource settlement rows lazy | Missing optional family can coexist with created character. Family failure is toasted but success message still includes family; no whole-flow atomicity |

**Fence:** raw progression trigger is BEFORE UPDATE only; character_create is
SECURITY DEFINER and its INSERT is not rejected by that fence. Browser direct
INSERT is revoked at `20260908175256…sql:3`. Do not infer INSERT refusal from
protected UPDATE tests. RPC auth.uid requirement means a bare service request
without an actor is not equivalent to an authenticated creation request.

**Constraints/defaults:** C retained H lists level1..100, pool0..200, hp>=0,
max_hp>=1, ac0..50, gold>=0, unique name, class/race text FKs; no XP/stat/CP/MP/
respec/RP checks. Body source casts character_class, dropped by
`20260731134850…sql:58`; enum-versus-text and custom catalog support must be
resolved using exact installed definition, not by editing executed migration.
No claim is made that local historical replay recreates Cloud.

**Partial states:** failed INSERT/AFTER INSERT trigger rolls back both character
and materials. Successfully returned INSERT followed by family failure leaves
character/materials without family. Lost HTTP response then fresh retry has no
creation UUID; unique name may prevent duplicate name but is not idempotent replay.
Client unmount after Index setShowCreateNew(false) and family completion/selection
ordering is a UI risk. No persistent gameplay/test character was created; existing
test suites use disposable embedded fixture rows only. No production characters.

Creation assessment: **unsafe authority boundary for canonical provenance;
runtime acceptance and exact installed initialization remain unverified**.
Secure DB-derived immutable creation snapshot and atomic resources/materials are
recommended; exact starter economy/equipment/family policy needs approval.

## 5. Legacy reconciliation classification

These are evidence classes, not observed hosted character counts. This task read
no hosted character rows. F closure's21 characters and zero sidecars were an older
operator observation; do not represent them as today's data.

| Evidence/data | Class | Safe conclusion / prohibited inference |
|---|---|---|
| Valid forward receipt + unique before/after versions + current continuity + corresponding proven counters/growth/config/event | A PROVEN CANONICAL | Only its recorded deltas, investment and outcomes; not the opaque pre-cutover composition |
| Exact six invested counters, normalized rank values, sum of counters, deterministic configured caps from complete current gear/config | B DERIVABLE WITHOUT AMBIGUITY | Refund quantity/cap diagnostic/rank cost derivable if valid and consistent. Recomputable cap is not authorization to clamp/refill or prove historical inputs |
| Existing materialized stats/current class/bonds, pre-cutover XP/level/tokens/Renown, historical unlogged admin grants | C HISTORICAL / OPAQUE | Preserve exact baseline; current class cannot explain previous milestone class; ranks do not prove all stat increments nor refundable points |
| Negative/malformed balances/ranks, invested>stat, latest receipt mismatch, missing-linked/duplicate destination proof, classless inconsistency, version gaps/duplicates | D CONTRADICTORY | Flag and refuse fresh affected canonical commands; classify specific anomaly, not global repair. A valid historical L43–100 exception is outside ordinary rules, not automatically corruption |
| Missing sidecar before first canonical event; unavailable request/receipt/admin reason; lost installed body/config history | E MISSING EVIDENCE | Missing sidecar is expected lazy state when no forward event. Absence of proof never means zero historical spending or eligibility for guessed refund |

Proposed read-only detection (documentation only, not executed; later Lovable may
run scoped SELECTs with authorization). No fingerprints/hashes of player rows or
secret/key data are required:

```sql
-- Shape anomalies and ordinary-rule exceptions; results require interpretation.
SELECT id, level, xp, is_classless, class, unspent_stat_points, respec_points,
       bhp, rp_total_earned
FROM public.characters
WHERE level NOT BETWEEN 1 AND 42 OR xp < 0
   OR unspent_stat_points NOT BETWEEN 0 AND 200 OR respec_points < 0
   OR bhp < 0 OR rp_total_earned < 0
   OR is_classless IS DISTINCT FROM (class = 'classless');

-- Missing state is an evidence flag, not an automatic defect.
SELECT c.id, (s.character_id IS NULL) AS missing_state
FROM public.characters c LEFT JOIN public.progression_character_state s
  ON s.character_id = c.id;

-- Refund contradictions; no race/current-class reconstruction.
SELECT s.character_id
FROM public.progression_character_state s JOIN public.characters c
  ON c.id = s.character_id
WHERE s.str_invested > c.str OR s.dex_invested > c.dex
   OR s.con_invested > c.con OR s.int_invested > c.int
   OR s.wis_invested > c.wis OR s.cha_invested > c.cha;

-- Duplicate/gapped receipt versions: investigate, do not reanchor.
SELECT character_id, receipt->'versionAfter' AS version_after, count(*)
FROM public.progression_receipt
GROUP BY character_id, receipt->'versionAfter'
HAVING count(*) > 1;
```

The version is in receipt JSON, not a table column. The last query deliberately
does not cast malformed JSON into a number; missing/invalid versions need separate
shape flags. Installed catalogs must be verified before reuse.
Additional bounded diagnostics should compare the latest receipt
projection with current permanent fields, canonical version continuity and growth
receipt/config linkage using existing validators. Do not invoke volatile validators
on Cloud as a purported read-only probe. JSON type/value checks must precede casts
for ranks; malformed JSON must be reported, not cast into a batch failure or zero.
Resources require complete usable inventory including gems/stat_override and
stance ownership, not bare attributes. Existing F fixtures cover opaque switched
growth and contradictory states; no new fixture was authored.

## 6. Authority and security findings

Protected15: str,dex,con,int,wis,cha,level,xp,class,is_classless,
unspent_stat_points,respec_points,bhp,bhp_trained,rp_total_earned.
Unprotected38 are the exact reviewed0006 list, not a dynamic future-column grant:
ac,active_contract,combat_trace_enabled,contracts_completed,cp,created_at,
crown_item_created,current_node_id,family_changed_after_creation,family_id,
family_name,gender,gold,hp,id,king_slayer_at,last_death_at,last_death_log,last_online,
max_cp,max_hp,max_mp,movement_locked_until,mp,name,portrait_generated_at,
portrait_metadata,portrait_url,race,reserved_buffs,soulforged_item_created,
soulring_inventory_id,soulring_tier,stance_state,updated_at,user_id,wimp_direction,
wimp_hp_threshold. Six authenticated preferences: last_online,wimp_hp_threshold,
wimp_direction,portrait_url,portrait_metadata,portrait_generated_at.

The source repair revokes table UPDATE first, revokes protected column UPDATE,
then grants38; assertions test all53, browser partition, function/sidecar/key
containment and disabled commands. R1 actual local ACL/DML tests passed; its
archival check fails because it compares against a pre-install checkpoint, while
0006/generated types are legitimately installed later. R2 identity check passes.
Do not edit executed0005/0006 or broaden grants to quiet that archival check.

RLS is not a replacement for column privileges. Service BYPASSRLS does not grant
protected UPDATE; explicit service column privileges do not constrain postgres
SECURITY DEFINER bodies. Private C/E/F functions and sidecars are owner-only,
fixed-search-path, effective ordinary/service access denied; public command is
service-only, owner projection authenticated-only. E/F service boundary derives
actor from verified claims; it does not accept a user-selected actor. Trainer/node,
combat/departure/stance/version checks remain in authority, not solely UI.

Remaining paths/boundaries:

- **Creation INSERT trusts arbitrary baseline inputs** through public authenticated
  owner-definer RPC; protected UPDATE fence does not close it.
- **Definer bypass scope:** approved wrappers can write protected fields as
  postgres. Retained legacy protected writers must stay owner-only. A newly
  exposed wrapper delegating to them could bypass raw service ACL; actual hosted
  overloads/EXECUTE/default grants/transitive memberships need fresh metadata.
  **Concrete source risk:** commit_encounter_tick_v3 (postgres-owner assumption
  must be checked hosted) remains explicitly service-granted and delegates to v2.
  D's exact five legacy signature list and six new commit-chain ACL loop do not
  name it. Old C3 consumers are in retained shared modules; combat-tick/catchup
  entrypoints are retired. This establishes a source capability gap, not a
  demonstrated live exploit or an unauthenticated browser route. Inspect v3/v2,
  claim APIs and exact installed definitions before any containment change.
- **Service38** includes race,user_id,id,resource caps and location. No generic
  service executor is exposed by this endpoint for all38, but service credentials
  remain powerful. race can affect identity/effective interpretation without
  protected-stat change; ownership edits are not progression repair permission.
- **Resource/equipment lifecycle** is wider than protected15: revive/direct cap
  edit, give/remove gear, forge-strip, cleanup, catalog edits and Test Arena restore
  must serialize and synchronize within their own domains. The F-deferred
  degrade_party_member_equipment helper can unequip without character lock;
  `20260306183611…sql:15` and F preflight retain this gap. No claim of a new protected
  stat bypass follows from an equipment mutation alone.
- **Deletion** can cascade canonical evidence; raw UPDATE fence is irrelevant.
  A restored character must not be inserted with guessed provenance.
- **Raw browser optimistic state** may show failed edits locally. Authoritative
  refetch and structured outcome handling are necessary; local state is not DB evidence.
- **RP EARNING AUTHORITY GAP** remains: canonical accepted reward path earns XP/gold
  only. Restoring legacy RP endpoints to fill it is not authorized.

Platform administrative read/global/BYPASSRLS authority is assessed by actual
capabilities and transitive role edges under the operating contract; role names
alone confer no gameplay exemption. Direct nonowner/PUBLIC private-object grants
remain leaks even to an administrator. Gameplay principals/members never receive
the platform exception. No keys, secrets, tokens or credential values were read,
printed, hashed or prefixed. Source files naming environment variables are code,
not runtime secret inspection.

## 7. Defects, inconsistencies and unverified runtime risks

| Finding | Evidence class | Confidence / action |
|---|---|---|
| Grant XP control calls an explicit503 endpoint; raw level/reset/token controls conflict with protected ACL | PROVEN DEFECT in source UI/capability alignment | Repair unavailable wording/disable until replacements; source rejection proven, live UI unknown |
| Creation page CP payload discarded by hook/RPC; no canonical initial sync/provenance | PROVEN DEFECT in source initialization boundary | Replace DB-derived creation; no claim actual hosted CP is wrong without metadata |
| Creation summary salvage42 versus trigger40; gold100 versus historical default200 | PROVEN DEFECT in source presentation agreement | Decide baseline and make returned authoritative values drive summary |
| set-level and reset-stats use different race constants; reconstruct from current class; respec ignores proof | DESIGN INCONSISTENCY, currently fenced | Retire algorithms; dangerous to re-enable, not evidence successful corruption now |
| set-level:240 and reset-stats:410 call getMaxCp(level,WIS), omitting INT; helper expects level,INT,WIS at `_shared/formulas/resources.ts:23` | PROVEN DEFECT in fenced algorithms | WIS is passed as INT while real INT is omitted; cap undercounts characters with positive INT modifier. Retire algorithm rather than reopening it after a formula-only fix |
| RPC character_class cast versus removed type/text FK; configurable races versus enum cast | LIKELY REGRESSION | Require exact hosted body/type metadata; preserve historical files |
| v3 service definer still delegates to fenced legacy v2 and is outside D's exact revocation lists | PROVEN source containment omission; UNVERIFIED RUNTIME RISK | Direct v2 ACL denial is insufficient against its owner-definer caller. Verify installed v3/v2/old claim prerequisites; do not invoke a gameplay write as a probe |
| CP/MP defaults versus authoritative level-1 formulas | LIKELY REGRESSION | Fresh metadata and local full creation fixture before installation |
| UserManager save can issue level and identity edits in two requests | PROVEN non-atomic source flow; UNVERIFIED RUNTIME RISK | If first succeeds and second fails, partial edit survives; presently level change fenced; same-level no-op may proceed |
| Most successful zero-row UPDATE/DELETE indistinguishable from actual change | PROVEN outcome-validation omission; UNVERIFIED RUNTIME RISK | Require result/count and stable request; no manufactured live missing-ID call |
| Gold/token read-modify-write, no stable command/reason/audit; repeated grants | PROVEN source semantics; UNVERIFIED RUNTIME RISK | Atomic deltas/replay; token path stays fenced |
| Forge-strip ignores returned DML errors, multiple transactions, no resource sync | PROVEN DEFECT in source outcome handling | Separately bounded repair, especially equipped gem removal; no live probe |
| Family application fails but creation success includes family | PROVEN source feedback inconsistency | Return honest partial setup state or approve atomic family integration |
| loadUsers not awaited/version-fenced; repeated handlers lack submission fence | UNVERIFIED RUNTIME RISK | Older read can overwrite newer list; unlike guarded catalog panels; repair request ordering |
| Stale caps after equipment/catalog mutation; delete FK drift; revive death/encounter residue | UNVERIFIED RUNTIME RISK | Exact dependency graph and safe local failure fixtures; no general repair invocation |
| UserManager (~350 lines) mixes auth admin, character edits, grants and reload; admin-users (~485 lines) mixes account/economy/progression | DESIGN INCONSISTENCY | Split domain adapters while preserving permissions; size alone is not a functional defect |

## 8. Exceptional-policy proposal and owner decisions

All proposed operations derive admin identity server-side, require a reason and
evidence reference, keep protected fields unavailable to generic DML, serialize
against character/node/claim lifecycle in accepted lock order, and write one
durable admin receipt with actor, role, operation, normalized request, target,
before/after protected projection, evidence, version and compensation link.
Owner approval authorizes categories/limits, not arbitrary future raw UPDATE.
Same UUID+same actor/payload returns original outcome; conflicting reuse refuses.
Failed transaction writes nothing; committed repair is compensated by another
approved, linked command, never receipt deletion or unsafe inverse SQL.

| Category | Permitted purpose proposed / authority | Required evidence and protected boundary | Atomicity, compensation and player consequences | Exact owner question |
|---|---|---|---|---|
| Incorrect level/XP | Legitimate new upward award → narrow canonical XP; correction/lowering → exceptional command | Verified event/receipt or adjudicated amount, old/new target, milestone/counter effects; protect all15 and resources | Whole XP/growth/points/tokens/version/resource transaction; downward correction must define consumed points/growth/Renown; compensate with linked receipt, no guessed subtraction; explain level/resource changes | **O1:** May admins award XP, who/limits/reasons? **O2:** Are downward/exact set-level corrections permitted, and what happens to already consumed points/growth/tokens? |
| Attribute correction | Repair a proven erroneous delta, not respec/reconstruction; owner-approved exceptional authority | Source evidence per stat, opaque versus invested/growth/Renown attribution; counters/ranks preserved unless specifically proved wrong | Atomic stat/counter/version/cap clamp; no heal/refill/resurrection by default; counter compensation only with proof; player sees exact correction | **O3:** Which evidence suffices and may opaque values ever be adjudicated? Who signs off per character? |
| Class correction | Ordinary eligible join/switch canonical; historical wrong class exceptional | Incorrect selection/config/event; current class not past growth proof; protect growth history/bonds/stance/lifecycle | Atomic class/bond/version/caps; do not rewrite old milestones. Preserve or explicitly compensate leaving cost; no auto stance cleanup | **O4:** May admins bypass hall/lifecycle requirements or refund bond loss? Is past growth ever changed, with what independent proof? |
| Respec-token grant | Compensation/support grant through narrow canonical-accounting extension | Reason/source/amount/cap; preserve milestone uniqueness, investment, stats, RP; no disguised refund | Atomic additive token+version/admin receipt, exact replay; consumed token cannot simply be subtracted for rollback; player balance notification | **O5:** Which roles/purposes/limits may grant tokens, and does reversal refuse after consumption? |
| Renown correction | Proven missed/incorrect RP/rank/stat outcome exceptional; earning redesign separate | Receipt/evidence distinguishes balance, lifetime, selected ranks and permanent stats; no reroll/key exposure | Atomic coherent RP/lifetime/rank/stat/version update; clamp-only resources; never re-run HMAC to repair outcome; explicit compensation | **O6:** May admins correct RP balance, lifetime, ranks or trained stat, individually? What proof and bounds are required? |
| Creation recovery | Complete proved missing initialization, not duplicate hero or guessed baseline | Creation identity/config snapshot, defaults/transaction evidence, inventory/materials/family status, no subsequent gameplay conflict | One recovery receipt + missing sidecars/resources/materials under locks; idempotent creation request; existing partial state must refuse mismatched replay; honest setup message | **O7:** Approve exact L1 Wayfarer race/resources/gold/salvage/gems/gear policy and whether family is atomic or optional retry? |
| Damaged/deleted restoration | Approved restoration from trusted snapshot with provenance closure | Full snapshot and identity, all sidecars/receipts/milestones/inventory/unique ownership, damage cause; no invented history | Stage validation then one bounded transaction; collisions/marketplace/claims refuse; preserve historical receipts, linked restoration record; no general resurrect/refill | **O8:** Is deletion reversible/tombstoned, retention period, and which backup/evidence can authorize restoration? **O9:** Separate revive/respawn/resource repair permitted, by whom and under which lifecycle exclusions? |

Cross-cutting approvals:

- **O10:** Steward versus overlord versus explicit Mik authorization for each
  category; thresholds and whether two-person/per-character approval is required.
- **O11:** Audit retention/access and player notification/detail; must deletion
  preserve canonical/admin proof outside character cascade?
- **O12:** Default repair resource policy (recommend clamp-only/no heal; no implicit
  combat, movement or stance bypass) and compensation when state has advanced.
- **O13:** Confirm catalog changes affect future growth/derived inputs only; no
  retroactive recalculation or guessed historical refund. Define config version
  publication/validation authority separately from character override.
- **O14:** Approve local implementation phases only after these decisions; hosted
  migration/deployment/activation and Mik's manual frontend publication remain
  independently authorized. RP earning and deferred equipment repair are separate
  scoped work, not silently expanded001G.

No exceptional policy is decided by this audit. Keep four legacy progression
operations fenced while decisions are unresolved. Prefer dedicated commands over
generic admin UPDATE, and immutable proof over editable provenance.

## 9. Test coverage, fresh baseline and gaps

Fresh existing tests (no fixture/test edits):

| Command / suite | Result | What it proves |
|---|---|---|
| Node Vitest CLI: shared/progression, character __tests__, character-location migration, project-state |124 passed across6 files |65 pure rules,2 containment,27 command client,21F UI,6 location-source,3 state tests; source/reference, not deployed creation execution |
| Node Vitest CLI: admin-api, arena contract migration, admin-hardening-batch, admin-operation-guards |29 passed across4 files |Admin transport decode/request guards/source arena contract; not admin-users progression semantics |
| `node scripts/progression-001F-sql.test.mjs <local PGlite>` |39 passed |Canonical respec/Renown/refusal/rollback/replay/provenance/HMAC fixture semantics; fixture key only, no hosted key |
| `node scripts/progression-001F-combat2.test.mjs <local PGlite>` |12 passed |Actual retained five-layer XP/gold chain, atomic rollback/milestones/dead resources, no RP award |
| `node scripts/progression-001F-R1-sql.test.mjs <local PGlite>` |13 passed /1 failed |All effective partition/DML/inheritance behavior tests pass; case02 archival installation-history/type-preservation comparison fails against old generator baseline |
| `node scripts/progression-001F-R2-check.mjs --check` |Pass |Current closure source/config/0006/journal identity; does not install anything |
| `node scripts/project-state.mjs` |Pass before edits; regenerated/rechecked afterward |Documentation ledger consistency |

Distinct test cases: **217 passed,1 archival baseline failure** (153 Vitest
+39F+12chain+13R1). Initial invocation using `node --test` incorrectly withheld
script argument; corrected to direct Node execution. npx is absent from this
shell; direct local CLI used. Initial sandbox Vitest had6 EPERM realpath errors
before collection; normal local retry passed. Those are invocation/environment
failures, not product test failures. No full-suite claim; historical full-suite
failures are not rerun or silently promoted to current passes. No typecheck/build
needed for docs-only work after relevant baseline suites passed. The existing
three project-state tests passed again after the permitted ledger update.

The R1 failing check at `scripts/prepare-progression-001F-R1.mjs:141` intentionally
diffs drizzle/types against its preparation baseline. Later installed0006 and
derived types make that archival no-change condition false. This existed before
audit edits; do not alter test or historical manifest to claim a pass.

| Missing proof | Class / bounded verification |
|---|---|
| Every admin-users action authorized/unauthorized/wrong role, no-row, mixed protected payload, fraction/negative, stale read, duplicate/retry | LOCAL TESTABLE: isolated handler/client adapter and disposable SQL; currently no comprehensive progression-admin endpoint tests found |
| Actual creation INSERT canonical config/defaults/materials/provenance; dropped-enum/custom race; resource fill; null inputs; lost response | LOCAL TESTABLE using exact installed-body metadata later and disposable fixture. Current location test checks source strings, not complete creation transaction |
| INSERT not covered by raw fence, owner-definer delegation, service15/browser6/38 assertions | LOCAL TESTABLE ACL/fence fixture; current R1 UPDATE coverage does not prove INSERT authority |
| Creation family failure, client unmount, recovery, duplicate identity, transaction rollback of trigger | LOCAL TESTABLE UI+SQL fixture; no production characters |
| Exceptional receipts/version/evidence/compensation and deletion proof preservation | LOCAL TESTABLE after O1–O14 and separate implementation; presently absent authority, not a test-only gap |
| Gear/catalog/admin resources synchronization and concurrent lifecycle | LOCAL TESTABLE serial failure/lock choreography; hosted true concurrency CURRENTLY UNPROVABLE under platform limitations |
| Actual creation body/overloads/types/defaults/triggers/FKs, all grants/default privileges/RLS/role inheritance and private containment | HOSTED METADATA VERIFIABLE by later scoped Lovable read-only inspection, excluding secret values |
| Deployed admin-functions revision/behavior, frontend buttons, authenticated paused canonical request | HOSTED RUNTIME PROBE REQUIRED with safe identity and no unsafe gameplay write; not authorized here. Revision IDs/live bundles unavailable per contract |
| Historical class composition/unlogged admin edits/pre-cutover spent stats/unknown deleted state | CURRENTLY UNPROVABLE unless independent trustworthy evidence is supplied; no synthetic reconstruction |

## 10. Bounded implementation plan (not begun)

Dependency order: **B policy + creation baseline decisions → C creation safety →
D admin authority/UI → E detection and individually approved repair → F closure**.
Read-only metadata gathering may precede C/D, with separate Lovable authorization.
Prioritize the v3 delegated capability inspection/containment dependency before
restoring admin writes; do not assume the direct v2 fence closes it.
Detection can be built alongside D but must not repair before policy/evidence.

| Phase | Exact scope/ownership and migrations | Tests and hosted verification | Stop conditions / owner dependencies |
|---|---|---|---|
|001G-B |Approve O1–O14; record purposes/roles/limits/resource/deletion/creation semantics. Codex docs/spec/roadmap only. No migration |Policy decision review, source capability matrix; optional scoped Lovable metadata read |STOP unresolved baseline/downward/opaque repair decisions; approval is not install/deploy authorization |
|001G-C |Codex DB-derived classlessL1 creation command, canonical snapshot/provenance, atomic initial resources/materials; returned authoritative projection, stable creation identity, family handling perO7. Prepare forward Drizzle SQL only when separately authorized; Lovable install/types |Null/invalid/custom race/config/version/baseline cases, trigger/material rollback, duplicate/conflict/lost-response/recovery, no extra points/growth/RP, cap/resource parity. Hosted exact body/catalog/ACL/default/FK checks; bounded nonmutating refusal probes only until safe creation explicitly authorized |STOP installed body/default discrepancy, no approved economy/family/gear rules, unsafe live lifecycle, failed containment, migration identity mismatch. No backfill |
|001G-D |First close any confirmed v3/legacy delegated capability with a separately reviewed forward fence; preserve accepted canonical node_tick_commit chain. Replace four legacy progression conveniences with narrow approved entries; ordinary XP canonical; separate identity/support/resource/inventory capabilities; remove duplicate teleport path after caller proof; disabled honest UI; structured outcomes/refetch guards/admin receipt. Codex Edge/browser/SQL; Lovable only install/deploy |Every role/owner/target/field/no-row, pause, unsafe lifecycle, protected payload, UUID conflict/replay, atomic grants, failure after write, resource sync; legacy definer delegation must refuse. Hosted command/legacy ACL/body/role metadata and unauthenticated/refusal probes; no broad UPDATE grant |STOP unresolved O1–O6/O9–O12, reachable parallel protected writer, unsafe equipment lock assumption. No automatic activation/publication |
|001G-E |Read-only detector and per-character evidence classification first. Repair only selected proven cases under approved policy and individually reviewed evidence. Preserve opaque baseline/receipts/history; narrow compensating commands, no normalization job. Codex detector/docs/optional separately approved SQL; Lovable authorized data execution |Contradiction/absence/malformed/version/growth/config cases; dry proposal review without mutation; full rollback and compensation; no new refund from current class. Hosted scoped SELECTs then expressly authorized single bounded repair and preservation checks |STOP ambiguous proof, changed character/version, unique ownership conflict, active gameplay, unsupported restoration, owner approval missing; do not batch guess |
|001G-F |Reconcile source/installed/deployed/activated/published separately, inventory closed gaps and retained risks; documentation closure criteria. Codex source tests/report; Lovable exact installed metadata/deployment/refusal verification; Mik manual publication |Existing canonical + new creation/admin/repair tests, full relevant authority/ACL matrix, transaction/refusal/replay and derived-state checks; normal push/preservation. Natural observation only when authorized/available |STOP any unresolved corruption path, failed invariant or falsely claimed hosted proof. Keep multi-session/natural/authenticated limitations explicit; do not close implementation from local audit alone |

Prioritize creation and protected authority integrity; convenience grants/UI edits
can remain unavailable. No RP earning redesign, combat redesign, schema-history
normalization, recovery-stash restoration, automatic world wake or publication.

## 11. Retained limitations and delivery validation

Local SQL source scanning is not a full installed catalog. Dynamic ALTER/rename/
body-patch migrations, composed predecessors, overloads and external scripts can
change live identity/reachability. Appendix candidates are conservative and include
UNKNOWN; their count is not a security completeness claim for Cloud. Legacy
resource helpers are not newly approved authorities. UI inspection was source
inspection, not an authenticated browser session or live gameplay.

No hosted character evidence was collected; no history reconstructed. No source
implementation, migrations, fixtures, schemas or gameplay data were changed.
Only this audit/appendix and permitted project-state/roadmap documentation are
committed. Git delivery is a normal source push; it neither installs migrations
nor deploys Edge nor publishes frontend. Final commit, HEAD=origin/main, clean
worktree and unchanged recovery stash are verified after push in the task return.

## 12. Exact source index for abbreviated historical anchors

Prefixes in the narrative map to these immutable files; line numbers in the inventory are one-based at the inspected checkpoint. Source links do not prove installation.

- `20260306183611…sql`: [20260306183611_f46928aa-9718-4a27-ab2f-132be32b6837.sql](../../supabase/migrations/20260306183611_f46928aa-9718-4a27-ab2f-132be32b6837.sql)
- `20260311115903…sql`: [20260311115903_97fbb398-0421-4772-b723-bc8cd86859c6.sql](../../supabase/migrations/20260311115903_97fbb398-0421-4772-b723-bc8cd86859c6.sql)
- `20260622212522…sql`: [20260622212522_0bff8a9f-ce25-4a33-b6c7-35929be95daa.sql](../../supabase/migrations/20260622212522_0bff8a9f-ce25-4a33-b6c7-35929be95daa.sql)
- `20260623072204…sql`: [20260623072204_ba238bbb-a55c-4000-8b35-69eb36bb3cba.sql](../../supabase/migrations/20260623072204_ba238bbb-a55c-4000-8b35-69eb36bb3cba.sql)
- `20260624095137…sql`: [20260624095137_39c3be11-82fa-4bd0-8384-7004403b09e8.sql](../../supabase/migrations/20260624095137_39c3be11-82fa-4bd0-8384-7004403b09e8.sql)
- `20260720070010…sql`: [20260720070010_cb736a97-fb3e-44d6-ade1-dceb66f6e772.sql](../../supabase/migrations/20260720070010_cb736a97-fb3e-44d6-ade1-dceb66f6e772.sql)
- `20260730085821…sql`: [20260730085821_18900070-315c-4ac1-8fec-fe778a52ca2d.sql](../../supabase/migrations/20260730085821_18900070-315c-4ac1-8fec-fe778a52ca2d.sql)
- `20260731134850…sql`: [20260731134850_336008d6-3bf4-4dcc-8f5d-53498b5591bf.sql](../../supabase/migrations/20260731134850_336008d6-3bf4-4dcc-8f5d-53498b5591bf.sql)
- `20260803232302…sql`: [20260803232302_acc7c4e5-4148-48c0-8f35-8c2299e23944.sql](../../supabase/migrations/20260803232302_acc7c4e5-4148-48c0-8f35-8c2299e23944.sql)
- `20260818220917…sql`: [20260818220917_581a61b1-6af0-41bb-b0c0-f3048c1f6f3a.sql](../../supabase/migrations/20260818220917_581a61b1-6af0-41bb-b0c0-f3048c1f6f3a.sql)
- `20260818222752…sql`: [20260818222752_1cddc10b-11bf-4823-88b7-c627dc5aa6ca.sql](../../supabase/migrations/20260818222752_1cddc10b-11bf-4823-88b7-c627dc5aa6ca.sql)
- `20260907110000…sql`: [20260907110000_combat2_test_runs.sql](../../supabase/migrations/20260907110000_combat2_test_runs.sql)
- `20260908175256…sql`: [20260908175256_2e41c1c0-9b14-40a2-9627-68f6cf7dbc2b.sql](../../supabase/migrations/20260908175256_2e41c1c0-9b14-40a2-9627-68f6cf7dbc2b.sql)
- `20261001213148…sql`: [20261001213148_dec8975a-1fb3-43c9-b5a8-73620bd1e0e8.sql](../../supabase/migrations/20261001213148_dec8975a-1fb3-43c9-b5a8-73620bd1e0e8.sql)

Additional exact type/catalog anchors: [race text conversion](../../supabase/migrations/20260809195546_5964d9fa-3b48-4be2-bdcd-4668d0b5a18c.sql#L54), [legacy commit removal](../../supabase/migrations/20260813183411_bfff91e1-f325-40c7-b94e-b81b970720cf.sql#L490), [harness removal](../../supabase/migrations/20260813123836_c4974ea6-8fad-4ccd-b5e2-252f5e9cdb82.sql#L12), [current admin endpoint](../../supabase/functions/admin-users/index.ts), [admin handlers](../../src/components/admin/users/UserManager.tsx), [creation hook](../../src/features/character/hooks/useCharacter.ts#L356), [creation page](../../src/pages/CharacterCreation.tsx#L98), [canonical command handler](../../supabase/functions/_shared/progression-command.ts#L38).
