# ENG-PROGRESSION-001G-C1 — Versioned creation manifest proposal

**UNAPPROVED ENGINEERING STRUCTURE / NO ACCEPTED NUMERIC MANIFEST.**

This is a schema proposal, not SQL, a migration, executable configuration or
permission to implement. [O7](progression-001G-B-admin-policy.md) approves one
server-authoritative atomic baseline including starter gear; [O13](progression-001G-B-admin-policy.md)
requires applied catalog version/provenance and prospective changes. Exact values
remain subject to [C1 evidence and owner checklist](../operations/progression-001G-C1-creation-baseline-audit.md).
The [metadata request](../operations/progression-001G-C1-hosted-metadata-request.md)
is prepared only; no installed definition inspected here.

Classification keys (multiple may apply to a field):

- **S — verified source value:** exact inspected code value/behavior, not hosted proof.
- **H — historical-only value:** frozen SQL or retained older supplied metadata.
- **D — derived by canonical formula:** computed after approved catalog/gear inputs.
- **I — installed-state unknown:** current object/catalog/ACL needs authorized metadata.
- **O — owner decision required:** policy or accepted initial value not selected.

Every row below is classified. O/I unset fields make the manifest **not executable**.
An empty list/null must not silently supply a missing starting kit or currency.
No numerical example is needed beyond the explicitly conditional audit table.

## Server-owned manifest fields

| Proposed field / shape | Class | Evidence or acceptance rule |
|---|---|---|
| schema_version, manifest_id, immutable revision, approval_reference, publication state | O/I | New design structure. Owner-approved publication role and semantic validation required; drafts unavailable to commands. |
| formula_revision / provenance references | S/I/O | Pin reviewed resource/AC and material/equipment semantics; record applied identity, not a secret hash or dynamic timestamp as proof. |
| races.allowed_keys, selectable/status predicates | S/H/I/O | S getSelectableRaceKeys active+selectable; H six seeds; actual rows/allowed revision I, approved selection O. No fallback on missing/invalid row. |
| race_revision, concrete six modifiers | S/H/I/O | S/H static values listed in audit; persist selected approved revision and concrete deltas for this character. Future catalog edits do not rewrite them. |
| permanent_base six integer attributes | S/H/O | S calculateStats8 each; H column defaults10; exact accepted server baseline O. Unknown keys/fractions/unsafe arithmetic refuse. |
| class_key, is_classless | S/H/I | S page classless/true; H classless Wayfarer seed; O7 already requires classless start. Verify installed text FK/catalog; not a player choice. |
| class_catalog_revision, base_hp, base_ac, growth inputs | S/H/I/O | Fallback18/10 and no classless growth; current catalog identity I; applied snapshot/publication scheme O. Missing pre-class row refuses. |
| level, xp | S/H | Approved ordinary L1/XP0; H defaults agree. Explicit server values; no schema100 exception or client override. |
| unspent_stat_points, invested six counters | S/H/I | Canonical no L1 point; H pool0/counter default0; explicitly initialize0 with current sidecar constraints verified. |
| growth_milestone_rows, respec_milestone_rows | S/I | Empty earned sets atL1; current constraints I. No fake destination or earned token receipt. |
| respec_points | H/I/O | H default0 and no current creation grant; accept reviewed0 or separately approved starting grant only. Grant is distinct from earned milestones. |
| bhp balance, bhp_trained six rank representation, rp_total_earned | H/I/O | H 0/{} /0; absence of initial training/earning writer; exact rank normalization and accepted initial values recorded. No HMAC call or RP-earning implementation. |
| starting_node policy + captured node/config revision | S/H/I/O | M RPC uses singleton respawn-config defaultnode, not browser. Verify FK/nonarena/current suitability; explicit creation start policy O if diverging. Never alter runtime eligibility flags. |
| maximum HP/CP/MP | D/S/I | Canonical formulas and caps; calculate after approved equipped gear, stat overrides/gems and class inputs. Do not copy H CP100/MP100 defaults. |
| current HP/CP/MP initialization | O/D | Initial fill policy O; then derive actual amounts bounded by calculated maxima. Later O12 correction clamp/noheal is not an initial-fill decision. |
| persisted AC representation and effective AC projection | D/S/I/O | S base classAC+DEXmod; gear/shield effective formula; existing private sync does not persistAC. Owner/design review prevents double counting. |
| regen dependency/cursor handling | S/H/I | Existing world four-second settlement/singleton cursor. No creation settlement/wake/catch-up grant; identify any mandatory dependency by installed metadata without inventing a per-character cursor. |
| starting gold | S/H/I/O | UI100 vs historical default200; current default I; exact amount O. Exactly one grant owner. |
| material grants[{key,quantity,catalog_revision}] | S/H/I/O | UI salvage42/6gems vs historical trigger40/six named gems1each. Current material catalog/mechanism I; quantities and other material absence O. |
| trigger_effects contract / grant owner | H/I/O | Inventory all installed INSERT/deferred triggers. Explicit grant or trigger may own each effect; never both. Validate final amounts instead of ONCONFLICT silently skipping mismatches. |
| starter_items[] | H/I/O | Removed catalogs do not select current items. **Blocked until exact validated catalog/kit approved.** Required structure below. |
| initial inventory/equipment effective snapshot | D/I | Derive from committed approved items/equipstate; include per-instance/gem/override provenance. No fake equipped slot for inventory-only items. |
| family_mode and optional setup policy | S/H/I/O | Current optional post-create apply RPC; owner chooses optional idempotent (recommended) or selected-family atomic. Record distinct setup status/identity if optional. |
| admin_delegation_policy | I/O | No current delegated creation route established; role/target/evidence approvals O. Same manifest builder as player; no extra admin kit. |
| creation_receipt policy/version/origin link | S/I/O | Existing receipt operations exclude creation; version0 continuity must stay valid. Separate private ledger proposed; exact linkage/retention/ACL design reviewed before C2. |
| replay/privacy/deletion retention | O/I | Align30-day restoration and12-month detailed audit with lawful minimal proof; deleted result replay must not create again. No infinite identifying retention inferred. |

## Starter item entry structure

| Field | Class | Proposed validation |
|---|---|---|
| entry_id within immutable manifest | O/I | Stable identity for one entry's grant proof; multiple copies use explicit ordinals, not mutable loop position. |
| item_id | I/O | Existing template identifier supplied/approved, not an invented item or restored historical table. |
| item_catalog_revision + captured relevant template fields | I/O | Immutable reviewed revision; snapshot slot/type/hands/eligibility/stats/maxdurability needed for reproducible initialization. |
| quantity | O/I | Positive integer; define one inventory instance per equipment copy unless installed domain has another validated model. No silent stack assumptions. |
| equipped boolean / equipped_slot nullable | S/H/I/O | Slot must exist and match item; inventory-only means null. Exclusive slots/ring2/twohand-offhand conflicts refuse. Do not auto-unequip a conflicting approved kit to hide invalid manifest. |
| initial_durability and durability policy | S/H/I/O | Historical/default100; item.max_durability must be verified. Owner approves full-template durability or explicit bounded value; no unconditional100. |
| class/race eligibility | S/I/O | Validate approved classless/race against template/domain restrictions; kit selection rules explicit. No current-class historical reconstruction. |
| applied_gems, stat_override, crafted_level, soul/unique flags | H/I/O | Specify approved absence/values and template compatibility; do not default unsupported private item state. Prefer ordinary/nonunique starter selection as a proposal only; owner chooses kit. |
| owner binding and inventory character_id | S/I | Derive verified targetowner and newly created character; never accept arbitrary inventory-owner IDs from client. |
| grant identity and transaction linkage | O/I | Proposed creation receipt+entry ordinal proves exactly one grant; inventory/unique holder/deferred constraints in same transaction. Failure rolls back complete character. |

## Request choices and result proof (separate from manifest)

Browser choices: stable requestUUID, name, gender, race, optional family and optional
expected manifest revision for stale-preview detection. Their field classification
is **S/O/I**: existing S choices, O normalization/limits/family policy, I catalog
compatibility. RequestUUID/revision are proposed **O/I** fields, not current inputs.
Explicitly reject authoritative stats/class/resources/currency/items/role/user_id.
Any separately approved admin target-user input is a requested delegation, never
trusted ownership; server derives authenticated actor and authorized target.

Receipt proposal (**O/I**): actor, targetowner/mode/delegation, requestUUID, normalized
choices, immutable manifest/race/class/item/formula revisions, concrete initial
attributes/currency/materials/gear/pools/caps/AC, character ID, version0 origin,
sidecar linkage, mandatory-family outcome or optional pending status, timestamp
and authorization/publication reference. Store privately with explicit read
projection; do not expose other users, membership requests or internal evidence.
An optional family receipt is separate, rather than mutating the creation receipt.

## Completeness and sequencing gates

Manifest validation must establish every required field's approved value,
source/revision, arithmetic/domain constraint and grant owner. Each field retains
its evidence class until fresh installed evidence or owner approval settles it.
One pinned manifest is consumed in one creation transaction. Equipment insertion
and validated equipped state precede final maxima/approved initial pool calculation.
Create compatible C state atversion0/counters0, empty earned milestones, and
separate origin receipt; do not write creation into F's existing receipt operation
CHECK or fabricate XP events. Mandatory family, if approved, is inside the same
boundary; optional setup is retriable and honestly outside it.

Same intent replays its captured manifest/result after catalog updates, without
another grant. Conflicting reuse refuses. Distinct intent name/quota races use
database constraints and target-owner serialization under approved policy. No
per-character slot limit, currency amount, item identity or initial-fill default
is supplied by this proposal. A partial draft cannot become active by accepting
an empty kit or falling back to UI amounts.

C1 only records this proposal; C2 implementation, hosted inspection and all
installation/deployment/activation/publication remain separately authorized.
