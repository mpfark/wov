# ENG-PROGRESSION-001E — Trainer and class-growth history audit

Prepared 2026-10-06. **AUDIT/DESIGN ONLY; NOT IMPLEMENTED, INSTALLED OR ACTIVE.**
Rules preserved: engine specification, “Progression and rewards” (class growth,
resources/provenance/trainer, transactional authority); roadmap ENG-PROGRESSION-001E.
One authoritative world heartbeat unchanged. No Cloud access, Lovable contact,
credential search, migration, deployment, gameplay mutation or later-phase work.

## Baseline and evidence discipline

- task_start_sha = HEAD = fetched origin/main = `5437da1a8a1f6b424c0eeafcf204ae8ae986e1c8`.
- Actual repository: `C:/Users/mik/Documents/WoVarneth/repo`; its parent is a separate
  unborn Git repository containing recovery/evidence files, not the application checkout.
- Application main clean at start; ancestor check succeeds; ahead/behind 0/0;
  fetch completed after sandbox network restriction required an escalation. No fast-forward needed.
- `stash@{0}: On main: 001C dependency STOP docs before hosted preflight sync`
  retained untouched. Parent evidence/untracked files retained; not staged.
- Read AGENTS, project understanding, project-state JSON/generated view, operating
  guide, engine specification/roadmap, 001A contract/reference, 001B H1 evidence,
  001C installed preflight/authority and 001D closure/cutover/containment.
- 001D CLOSED. Installed/verified/activated is accepted **supplied operator evidence**.
  **NATURAL RUNTIME PATH NOT YET OBSERVED. HOSTED MULTI-SESSION BEHAVIOR UNPROVEN.**

Labels below: INTENDED = accepted contract; SOURCE IMPLEMENTED = repository code;
LOCALLY INFERRED = conclusion from source/caller graph; HOSTED-PROVEN = a cited,
timestamped accepted inspection, not fresh live observation; STALE/UNREACHABLE =
retained source whose ordinary writer is fenced. Historical migrations are evidence,
not proof of current installation. Local SQL uses a minimal disposable PGlite
fixture, not the production schema/triggers or parallel hosted sessions.

## Relevant writer and caller inventory

Paths are repository-relative. In this table “six stats” means STR/DEX/CON/INT/WIS/CHA;
“pools” means unspent_stat_points/respec_points. Configuration and effective stats
are separated from permanent materialized `characters` attributes.

| Path/caller | Authorization and decision owner | Writer / transaction / mutations | Reachability, classification and competition |
|---|---|---|---|
| `src/pages/GamePage.tsx:1152,1972` → `TrainerPanel` → `StatPlannerBody` → `useStatAllocation.handleBatchAllocateStats` | UI trainer-node mount; Combat2 execution fence; browser decides deltas and balance | `useCharacter.updateCharacter`, one direct UPDATE six stats + unspent; subsequent separate resource RPC | UI wired/reachable; persistent writer denied by accepted preference-only ACL; legacy allocation competes conceptually with private counters, has no provenance |
| `useStatAllocation.handleAllocateStat` | Only browser positive-pool test; arbitrary stat string | +1 stat / -1 unspent; separate sync | Exported but no current caller found; dormant helper, same fenced writer |
| `useStatAllocation.handleFullRespec` → trainer confirmation | Browser token test; guessed current-class/race baseline | Direct UPDATE six stats/unspent/respec; separate sync | Wired UI, fenced persistence; unsafe legacy subtraction would erase permanent non-discretionary growth; must remain unavailable until 001F |
| `useCharacter.ts:393`; `GameContext`; GamePage wrapper | Owner RLS plus effective column privileges; wrapper fences listed combat fields | Optimistic React state then `.from('characters').update`; any supplied partial Character | Generic persistence remains for allowed preferences; progression denied. React local-only `updateCharacterLocal` is not a DB writer. Combat field set omits six stats/class, so it is not a universal progression authorization mechanism |
| `OrderRecruiterDialog.tsx:80` mounted GamePage:2050 | Browser sends character/class; DB `owns_character` | `switch_order(uuid,text)` → `join_order(uuid,text)`; one SQL transaction; class/is_classless/reserved_buffs; bond delete/insert; resource sync | Ordinary owner RPC source wired; 001B H1 observed auth/PUBLIC/anon/service EXECUTE (ownership still required); 001D left unchanged. Legacy class authority, not canonical receipts/version |
| Latest join/switch source: `20260731134850_336008d6-3bf4-4dcc-8f5d-53498b5591bf.sql:102,144` | Owner JWT; active/selectable/non-pre-class config | Locks character; trusted flag; mutations above; no six-stat or pool change | No combat/hall/level/request check. New class does not catch up; active stance trigger can refuse entire transaction |
| `award_class_bond(uuid,text,integer)`, `award_class_bond_for_kill`; old commit callers | Latest July functions have no owner check; amount bounds / kill-derived amount; effective installed ACL not established here | Upsert character_class_bonds only, one caller transaction; no characters.class or six-stat mutation | Bond-award dependency, not growth authority; retained legacy caller commits fenced by 001D. Untrusted external capability must be checked if still granted, since it can recreate other-class bonds |
| `ClassBondsInspector.tsx:50` admin direct upsert; `ClassBondRow`, recruiter/get_order_roster reads | UI admin gate is not write authorization; source June10 dropped owner write policy, read policies remain | Browser upsert bond only; no class/stat change; reads/subscription | Admin attempted writer can be RLS-fenced despite retained table grants. Current installed bond policy/ACL not proven; 001E must preserve intentional bond-reset cost without treating bonds as growth history |
| `TrainerPanel.tsx:88` → `train_renown_stat`; latest body `20260731072756_3e051877-cae6-4323-9e35-a5b19fb63857.sql` | owns_character; six-stat allowlist, L30, balance; DB roll | Character FOR UPDATE; RP spend, rank + stat on success; sync resources; one transaction | Existing ordinary RPC, 001B observed anon/auth/service access; noncanonical for 001F. No request receipt/combat/location fence; does not increment discretionary counters |
| `admin-users/index.ts`: set-level / update-character / reset-stats / grant-respec; admin users UI (`UserManager`, users components) | Validated JWT claims, steward/overlord role read by service client | Separate service fetch/update requests; stats/level/xp/pools/resources; grant-respec pool increment | Privileged noncanonical overrides; no atomic provenance/version update. 001D set-level/update-character accepted deferred exceptions. reset-stats also guesses history/refills CP. 001G must reconcile; no ordinary authorization from admin UI |
| `admin-users` grant-xp | Same role gate | Immediate 503, no progression write | Source paused and supplied 001D deployment evidence; retain pause |
| `CharacterCreation.tsx` → Index/GameContext → `useCharacter.createCharacter` → `character_create` | UI sends classless/race-calculated stats; SQL derives auth owner/start location but accepts supplied stats | One INSERT character; insert triggers/materials; level/pool defaults; no progression sidecar initialization | Source reachable; 001B H1 confirms installed RPC. Historical source casts removed enums; installed exact body cannot be inferred from this migration. Creation authority deferred 001G |
| `grant_starting_gear`, `class_starting_gear`, starting-material insert trigger | Owner SQL helper/creation integration | Inventory/gold/materials, not permanent six stats/pools; effective equipment inputs | Creation dependency, not trainer/growth authority. Repeated-call safety is outside 001E; do not call during audit |
| `ClassConfigManager` / `ClassAuthorDialog` → classes table | Overlord RLS (source); browser content-authoring writes | classes.level_bonuses/base_hp/status/selectability etc, one row request; updated_at trigger | Active config authoring; no direct character growth mutation. Future events see edited config; old receipts stay captured |
| `useAbilityLoadout` → `set_ability_loadout`, class_ability_roles/assignments and AbilityLoadoutTab | Owner domain RPC validates class assignment/unlock/alive/combat/stance; direct writes fenced by source | Role selection records; class registry/bar reload on class change | Active derived ability selection; no permanent stats/class/pools written. Order switch retains old role rows; new current-class roles control eligibility |
| `progression_apply_xp_internal` (001C) | Owner-only/no browser JWT; supported source/event validation | Character lock; character level/xp/stats/pools/maxima/current resources + state version/baseline + XP receipt + token milestones in caller transaction | Canonical; 001D connects only accepted new Combat2 claim; not exposed trainer/class API |
| `progression_apply_permanent_delta_internal` (001C) | Owner-only/no browser JWT; source allowlist + expected version | Character lock; positive six-stat deltas; allocation deducts unspent and increments six counters; state/receipt/resource sync atomic | Canonical private capability, ordinary invocation fenced. No trainer/location/combat/actor authorization; no current trainer importer/caller |
| `progression_snapshot_internal`, `progression_class_config_internal`, `character_sync_derived_internal` | Owner-only/no browser JWT | Snapshot/config read; internal sync writes max_hp/max_cp/max_mp/hp/cp/mp | Private canonical dependencies; no AC write, no broad API |
| Combat2 worker/dispatcher → five-layer `node_tick_commit` → `combat2_apply_claim_progression_internal` | Service outer commit, claim/token/tick/version/reward validation; predecessors and adapter owner-only | Accepted new `node_reward_claim.id` → XP authority within commit; all reward/provenance/resource/claim writes rollback together | Canonical 001D; captured XP/config/growth. Resolver proposal is not progression ownership. Historical duplicate claim does not backfill |
| `apply_crafting_xp`; forge-craft-base / forge-apply-gem / stonebinder-fuse; `stonebinder_commit_fuse` | Legacy crafting/gameplay sources | Old XP→level/stats/pools/resources/material logic | 001D old RPC owner-only and three Edge entries paused; legacy retained bodies are not ordinary live writers |
| `commit_encounter_tick_v2`, `award_party_member` (3/5 args), four node_tick_commit predecessors | Old proposed progression or raw XP; formerly service paths | Legacy SQL update stats/level/pools/rewards in old transaction | 001D effectively owner-only; internal composed predecessors remain essential, external entry fenced. Physical retirement 001H |
| `combat-tick`, `combat-catchup`, legacy B/C source; GamePage party reward handling/useCombatDriver | Retired shells 410; ordinary Combat2 execution fence | Retained calculations/projections and historically direct update calls | Legacy ordinary gameplay unavailable; some React projection paths remain. Names/types alone do not prove reachability. Supplied deployment differs from source-only shell type fix |
| `c2_harness_run`, `c2_harness_run_c` historical SQL | No in-body ordinary owner gate; no current application caller found; effective installed ACL unknown | Create isolated characters/class/stats/defaults, old commit tests, delete fixtures in SQL invocation | Dormant legacy test harness, not trainer authority; do not invoke. Later negative containment must check only these two targets if their installed existence/access matters |
| `sync_character_resources` ordinary owner RPC | owns_character, auth/service EXECUTE per 001C preflight | Separate transaction when browser calls; max/current HP/CP/MP clamp, hardcoded class HP CASE | Active shared resource dependency; no stat/pool/class write and no AC. Can compete on resources if called during combat; not appropriate private trainer sync |
| Inventory/equip/repair/craft/gems; settlement; respawn; stance commands; old activate_stance/apply_force_shield_regen/move_follower/boss cast | Domain owner/server authority, varied legacy ACLs | Equipment/effects/current resources/maxima/location; no durable discretionary investment or class-growth award | Effective-stat/resource dependencies, not permanent six-stat writers. Old stance helpers fenced by accepted stance ACL work; preserve domain authority |
| Trigger `restrict_party_leader_updates` | BEFORE UPDATE, owner JWT conditional; app.trusted_rpc only partially bypasses | Reverts/clamps supplied fields; allocation aggregate conservation; does not create XP/growth | Installed exact semantics in 001C preflight; cannot make generic owner-JWT wrapper around private primitive safe |
| Trigger `combat2_refuse_invalid_stance_class_change` | BEFORE class UPDATE, independent of caller | Raises while character_stance exists; transaction rollback | Active safety constraint, no cleanup. Preserve explicit refusal in 001E |
| updated_at / encounter lifecycle / death stance release / reserved_buffs sync / location participation/arrival triggers | SQL trigger chain | Timestamp/effects/participation, not growth; hp/class/resource changes can activate them | 001C preflight exact affected trigger inventory; HP stays alive/dead for non-level operations; no speculative trigger removal |
| `src/integrations/supabase/types.ts`; `useCharacter.Character`; shared class registries | Compile-time/read registries | No persistence | Includes generic Update fields, join/switch/Renown/private signatures: declarations grant no access. No generated 001E types |
| `src/shared/progression/{contract,reference,resource-reference,golden-vectors}`; Vitest class/Combat2 tests; scripts 001C SQL, 001D integration/containment | Disposable fixture/reference/source assertions | Local in-memory SQL or pure calculation only | Not runtime owners. Tests prove narrow source behavior; old dormant containment assertion is stale after generated private signatures appeared |
| `supabase/migrations` historical DDL/data updates; `drizzle/migrations/0001,0002`; ops SQL | Frozen historical migrations; approved forward lane | Earlier stat/pool/class/schema/config repairs plus authority definitions | Never replay. Latest lexical source is not installed-body proof; 0001/0002 accepted installation evidence reused |

Search coverage: six attribute names, pools, class/is_classless, level_bonuses,
join/switch/trainer/respec, all character UPDATE/INSERT/function definitions,
source RPC/direct UPDATE callers, triggers, historical migrations, generated types,
tests and 001C/001D prepared SQL. `ai-world-builder` and stat-heavy formula/catalog
modules describe creatures/content or effective values, not permanent character
writes. Historical resource/helper false positives were inspected rather than
classified as allocation on stat-name matches. See plan for narrowly scoped
installed differences still requiring inspection.

## Trainer: intended versus actual

INTENDED: one discretionary point per crossed destination level, no L1 point,
41 at L42; narrow authenticated command at trainer, safe lifecycle/no active combat,
positive integer six-stat allocations, atomically proven investment; safe respec
later refunds only counters.

SOURCE IMPLEMENTED: pool creation now comes from accepted Combat2 claim → 001C XP
(+1 each crossed level); 10/20/30/40 grant respec tokens. Privileged admin
set-level/grant-respec/update/reset also affect pools; old crafting/legacy reward
paths are fenced/paused. No backfill for existing state.

The hook supports single +1 and arbitrary batch totals. Planner UI offers the six
keys and adds/removes one planned point at a time. The batch hook merely checks
total >0 and <= cached pool; it does not validate keys, integer/nonnegative
components or resulting stats. Single helper accepts any stat string. No request
UUID, expected version, refundable counters or receipt. Old trigger compares
aggregate stat increase to point decrease, permits a respec-token decrease to
bypass it, and is not sufficient proof of per-stat ownership. No source-backed
999 cap should be invented: accepted 001C hosted preflight found **no six-stat
CHECK**, despite historical range/clamp migrations.

LOCALLY INFERRED / HOSTED-PROVEN ACL: accepted 001B H1 character table inspection
found authenticated SELECT and UPDATE only for last_online, portraits and wimp
preferences, with no table UPDATE; anon none, service/postgres full. This fences
the direct trainer/respec UPDATE before row-trigger conservation. 001D added no
column access. Consequently visible trainer controls are stale backend assumptions,
not an installed allocation authority. No live trainer call was performed.

GamePage wraps batch/respec in the Combat2 legacy execution fence; this is UI
containment, not a reliable DB combat check for every lifecycle. The hook itself
has no combat/ownership/location check. Generic update optimistically edits React
state before DB failure, clears pending flags later, and does not revert on failure.
Planner resets planned points immediately because onCommit is void, not awaited;
errors can leave misleading UI. When the legacy fence returns undefined it need
not produce a normal trainer refusal. Successful sync/log are after UPDATE;
Supabase returned sync.error is not inspected in syncResources. No atomicity.

If unfenced, stale absolute stat/pool updates can lose allocations or overwrite
new XP/state; retries can repeat or overwrite without identity. Row UPDATE
serialization alone does not make browser read-modify-write correct. Current
fenced writer cannot validly overspend because it cannot persist at all.

Resource sync uses CON for MaxHP, INT+WIS for MaxCP, DEX for MaxMP, usable equipment
and gem inputs. Ordinary sync clamps current pools to [0,max], never refills;
allocation itself writes no pools. Two-request design can leave stale maxima after
a successful stat write if sync fails. No persisted AC update; DEX/class can change
derived effective AC shown by planner/combat. Canonical non-level sync must clamp
without healing/refilling, retain dead HP0 and refuse invalid negative resources.

No dedicated current trainer allocation/respec or Order command test was found;
existing pure/reference and SQL tests establish primitive behavior, not an
authenticated trainer endpoint. Future command tests are explicitly required.

Old full-respec guesses creation race/classless base and current class ×
floor((level−1)/3), even missing L3/L6 destination increments. It cannot account
for late joining, mixed classes, Renown or permanent rewards. Admin reset-stats
instead assumes creation current-class bonus and floor(level/3), refunds guessed
excess, and refills CP. Both violate accepted preservation; neither is proof.

## Orders/classes and growth

Storage is `characters.class` text FK classes.class_key plus `is_classless`;
there is no separate order_id/class_id history. `character_class_bonds` keys
character+class, stores current bond, and is not a growth ledger.

Creation UI explicitly sends class='classless', is_classless=true, race-calculated
attributes. Backend validates owner/name/start and supplied nonnegative shape,
not canonical race attribution. Defaults give L1/pools0; no 001E baseline.
Do not fix creation or removed-enum migration discrepancies in this task.

join_order: owns_character first; target must exist, active, selectable and not
pre-class; then character FOR UPDATE. Deletes every other class bond (intentional
cost); sets class, is_classless=false and clears legacy reserved_buffs; target bond
insert 0 ON CONFLICT DO NOTHING; sync resources; returns class/bond. switch_order
simply delegates. No catch-up, stat redistribution, token charge, level prerequisite,
actual hall/NPC validation, combat refusal, stable request or progression version.
Same-class repeated invocation preserves target bond but repeats sync/update;
retry of an older switch after another switch can switch back and erase bond.

Recruiter sends switch whenever currentClass is truthy, so 'classless' uses switch
and displays leaving-classless warning. Backend permits either command; this
accident does not establish accepted join semantics. Hall is sourced from node
for presentation only. DB ownership blocks anon despite broad EXECUTE, but broad
grants/default roles remain capabilities to contain. Installed 001B H1 hashes/ACL
and 001D unchanged statement support historical reachability, not fresh runtime proof.

Class switch changes ability registry/bar selection and level-unlocked roles
(class_ability_roles/assignments, loadout.ts); join does not insert/delete abilities
or loadout rows. Old role selections remain stored. Equipment is not removed or
revalidated by join; weapon proficiency/effective AC are derived class consumers,
not stat grants. No class-change HP refill: sync clamps with old hardcoded baseHP.
Changing class while any canonical character_stance row exists raises and rolls
back bonds/class/legacy reset; clearing reserved_buffs is not canonical stance cleanup.
No broad effect cleanup occurs. Keep explicit drop-stance refusal; automatic
cleanup/refund remains a separate decision, especially 001F respec.

For A–F: classless L3/L6 grants levels/points but zero growth; joining at L7 leaves
missed installments missed; L9 uses joined class config; switching at L10 changes
only future class identity/bond/resources; L12 uses new config; all prior six-stat
growth persists through repeated switches. 001C already calculates this correctly:
captures class/config under SHARE lock, traverses destination levels divisible by3,
adds aggregate permanent growth only when not classless, and never subtracts it.
Atomic character locking serializes XP with class changes, though old join has no
version receipt. Local existing SQL test explicitly covers late join/switch/no catch-up.

## What provenance actually exists

| Component | 001C/001D durable proof | Missing / limits |
|---|---|---|
| Opaque existing baseline | Lazy progression_character_state.opaque_baseline captures exact snapshot before first accepted event | Not per-stat racial/manual/class attribution; snapshot excludes gear/race/AC, which remain in their own current storage; no rewrite |
| Discretionary investment | Six integer >=0 invested counters already in state; permanent source discretionary_allocation atomically deducts pool and increments counters; receipts store deltas/before/after/version | No trainer eligibility/authenticated entry; counters initially0 do not prove old spending |
| Future class growth | XP receipt source/event, crossedLevels, before class/classless, normalized classConfig+fingerprint, aggregate permanentDeltas, before/after/version | Can deterministically derive each crossed milestone delta within a receipt; no independent character/destination-level uniqueness for growth or skipped milestones |
| Respec tokens | progression_respec_milestone unique character+level10/20/30/40 and deferred receipt FK | Token grant deduplication only; cannot reuse for growth levels3/6/…/42 |
| Permanent rewards | Private permanent_reward receipts preserve explicit deltas without incrementing investment | Primitive has no connected reward-domain authorization here; not all historic rewards prove attribution |
| Renown | Existing materialized bhp/ranks; opaque snapshot captures values | Current Renown RPC changes stats/ranks outside progression receipt/version; no stable roll/spend receipt; 001F |
| Race | Existing race FK and UI/config baseline formulas | No canonical proven creation component for old characters; 001G; preserve race inside opaque permanent floor |
| Gear/effects | Separate inventory/templates/gems/effects; effective calculations | Not materialized permanent attributes; must never be refunded as discretionary |

XP/permanent receipts keyed `(character_id,source,event_id)` replay original before
current state/version/config validation, conflict on changed request. Character lock
and one caller transaction protect writes. XP baseline initializes without backfill;
private primitives forbid non-null auth.uid and all ordinary EXECUTE, including
service_role. 001D exposes only outer accepted Combat2 commit, not generic deltas.

Growth replay same event already safe. Distinct XP events normally cannot revisit
a passed destination because level increases; privileged set-level can lower it,
so event uniqueness alone cannot enforce per-level growth once. New independent
growth uniqueness must fail closed on contradictory advancement, not silently skip
growth while granting the rest. Config edits never rewrite old receipts/deltas.

Existing characters: current level/class/stats/pool do not reveal old allocation
or classes. Existing 001C baseline/counters/receipts are retained intact. Validated
post-001C XP receipts prove only their recorded transitions/config/deltas; no
assumption current Warrior was always Warrior. On first 001E allocation, use existing
state if present, otherwise capture exact pre-mutation snapshot with counters0;
the pending pool may be spent prospectively even if its historical source is opaque.
Use the first 001E command receipt's pre-mutation snapshot as an anchor (exact six
stats, pool, existing counters, progression version and current class/level), without
resetting baseline or counters or adding a separate anchor event. This states the future boundary;
it never blesses inferred historical investment. No subtracting guessed race/class.

## Validation and handoff

Existing focused progression/class/loadout/class UI/Combat2 arrival tests: **118 pass,
0 fail**. Additional Combat2 controlled ownership/legacy execution tests: **24 pass,
0 fail** (two existing files matched; no spendable-CP test file matched the supplied
additional filter, so no claim that it ran). Existing actual-chain 001D SQL: **9 pass,0 fail**;
containment: **6 pass,0 fail**.
001C SQL unfiltered: **15 pass,1 fail**: obsolete dormant assertion rejects generated
private function declarations in types.ts (line177). All executable SQL cases pass,
including investment/replay/rollback/ACL/late class join. No source test edited to
hide failure. Initial esbuild runs failed on sandbox parent-directory access;
escalated reruns completed. No unrelated baseline repair.

Project-state generator/check and existing project-state tests (**3 pass,0 fail**),
001D prepared-generator check and whitespace validation pass. Docs/state-only change;
no typecheck/build required by this task.
Existing test outputs retained outside Git under `../001C-local-db-tests/E-*`.

- Files: this audit, [001E plan](progression-001E-plan.md), engine roadmap,
  project-state JSON/generated Markdown. No spec-rule change, runtime/test/type/migration change.
- Cloud/gameplay operations: none. Installation/deployment/frontend publication unchanged.
- Open implementation decisions and minimum hosted facts: plan sections below.
- Next safe action: separately authorize the plan's narrow read-only preflight;
  no broad database audit or request for Lovable to design 001E. Then STOP.
