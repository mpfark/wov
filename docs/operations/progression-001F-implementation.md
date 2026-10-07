# ENG-PROGRESSION-001F — Canonical Renown and safe respec preparation

ENG-PROGRESSION-001F IMPLEMENTED LOCALLY / PREPARED
READY FOR SEPARATELY AUTHORIZED HOSTED INSTALLATION
NOT INSTALLED / NOT ACTIVE

## Scope and source checkpoint

The ENG-PROGRESSION-001F-IMPLEMENT request authorizes local implementation, disposable
local authority tests, reviewable release preparation and normal commit/push. It
explicitly prohibits hosted Supabase access, Lovable, installation, Edge deployment,
family activation, frontend publication and001G/H. Those boundaries were retained.

Task start and fetched origin/main both448883efbbb5887e0033e4c987d153dfb8bfb7b3.
Fetch did not advance the checkpoint. The worktree started clean. Recorded
49ffa969 is an ancestor. Recovery stash0a5529d5227675319b166881b10f1c91edd7486b
is preserved. Final source commit/origin identity is reported in the delivery message;
the report cannot embed its own future commit hash.

Affected rules: specification Progression and rewards / Resources, provenance and
trainer / Transactional authority and integration; roadmap ENG-PROGRESSION-001F,
with E closure wording reconciled to accepted operator evidence. The approved F
decisions implement proven-only refund and retained Renown economics. The formerly
open stance choice is explicitly refusal. Resource formulas, XP/class-growth rules,
Combat2 economics and the one authoritative world heartbeat are preserved.

001E remains CLOSED / INSTALLED / VERIFIED / EDGE DEPLOYED per accepted operator
evidence; trainer/Order commands paused and frontend not published. Retain:

- HOSTED MULTI-SESSION BEHAVIOR UNPROVEN.
- NATURAL RUNTIME PATH NOT YET OBSERVED.
- AUTHENTICATED COMMANDS-PAUSED RUNTIME PROBE NOT EXECUTED.

## Supplied preflight and accepted decisions

The request supplies pgcrypto1.3 in extensions, extensions.hmac(bytea,bytea,text)
and extensions.gen_random_bytes(integer), and no suitable existing private key
facility. It identifies direct service UPDATE on bhp/bhp_trained/rp_total_earned
outside the E fence. Canonical Combat2 earns XP/gold only; legacy RP writers are
owner-only and unreachable through ordinary/service function execution. The four
characters with historical trained ranks remain expected opaque cases.

Mik accepted: active/pending stance refusal; dead refusal; same nodes.is_trainer
boundary; pool200 overflow refusal without clipping; six independent Renown ranks;
level30 minimum; persistent private versioned HMAC; no gameplay rank cap or automatic
rotation; RP earning excluded. These supplied facts are not a fresh Codex Cloud
inspection or a current safe operating-window observation.

## Prepared authority and receipts

Changed source inventory:

- Release encoding: `.gitattributes` adds exact F file rules while preserving E/R2
  and historical migration rules.

- SQL preparation: `scripts/prepare-progression-001F.mjs`,
  `scripts/progression-001F-authority.sql`,
  `docs/operations/progression-001F-cutover.sql`, and
  `docs/operations/progression-001F-manifest.json`.
- Boundary: `supabase/functions/_shared/progression-command.ts` and
  `supabase/functions/progression-command/index.ts`.
- Browser/UI: `src/features/character/progression-command.ts`,
  `progression-messages.ts`, `hooks/useStatAllocation.ts`,
  `components/TrainerPanel.tsx`, `components/StatPlannerDialog.tsx`,
  `components/OrderRecruiterDialog.tsx`, and `src/pages/GamePage.tsx`.
- Tests: `scripts/progression-001F-sql.test.mjs`,
  `scripts/progression-001F-combat2.test.mjs`,
  `scripts/progression-history-test.mjs`, and
  `src/features/character/__tests__/progression-f.test.tsx`.
- Documents/state: this report, F audit and implementation plan, engine
  specification/roadmap, and project-state JSON/generated Markdown.

`scripts/prepare-progression-001F.mjs` deterministically assembles the unchanged E
command behavior with F dispatch, a shared owner-only fresh-state validator and F
private mutation/RNG functions from `scripts/progression-001F-authority.sql`.

Full respec subtracts each of the six invested counters from its corresponding
permanent stat, adds their exact sum to unspent points, zeros all six counters and
consumes one token. No baseline or class/race reconstruction is used. Empty refund
returns empty_refund without creating state, spending a token, incrementing version
or writing a receipt. Nonzero refund needs one token; U+refund>200 refuses. Gear,
opaque/base stats, both old/new class growth, permanent rewards and all Renown
gains/ranks/balances/lifetime values remain nonrefundable and preserved.

Renown uses the selected stat's current rank. Cost10(rank+1), chance=max(5,95−10rank),
roll0–99, success iff roll<chance. Both outcomes spend bhp. Success adds one selected
stat and rank; failure does not. Investment and rp_total_earned never change. There
is no additional permanent_reward receipt. Arithmetic/storage overflow refuses.

One F command increments version once and inserts one existing progression_receipt
row, operation respec/renown and source full_respec/renown_training. No additional
history relation is introduced. Receipts include normalized actor/request, prior
progression and investment proof references, version pair, six before/after stats,
investment/refund evidence, class/level/XP, pool/tokens, ranks/RP/lifetime, resources
and maxima, and authoritative projection. Renown adds selected rank pair, cost,
chance, roll, drawIndex, algorithm/key version, outcome and permanentDelta0/1.
No secret is projected or receipted.

The validator reuses E proof/lifecycle logic and additionally checks rank JSON,
RP/lifetime, latest rank/RP continuity, lifetime continuity since the first F receipt,
single latest version proof and its before/after version pair, and contradictory
v0 receipts. Six counters must satisfy S>=I>=0 and match the latest counter-bearing
proof. Missing sidecar means v0/I0 and unknown historical stats/ranks remain opaque.
First F mutation captures the future boundary lazily; contradictory proof refuses.

## Deterministic RNG and private key

The forward SQL creates only a tiny postgres-owned progression_renown_key relation,
RLS enabled, no policies, no nonowner table/column grants, positive explicit
key_version,32-byte material and at most one active row. Initial active v1 material
is generated server-side using extensions.gen_random_bytes(32), inside the later
runner transaction. No real hosted key was generated locally. Disposable fixture
keys are isolated in test code. Rotation is not implemented.

Exact input encoding: concatenate seven fields in this order: `wov.renown.v1`,
canonical lowercase character UUID, canonical lowercase request UUID, selected
three-letter stat, expected version, rankBefore, drawIndex. Each field is UTF-8
preceded by its four-byte big-endian byte length (`int4send` for these nonnegative
bounded lengths). Numeric fields are canonical unsigned decimal integers; no
JSON, delimiters, client seed or locale formatting is involved.

HMAC-SHA256 uses the active private key. Interpret digest bytes0–3 as unsigned
big-endian x. Accept x<4294967200 and roll=x mod100; otherwise advance drawIndex.
Indices0..127 are allowed; exhaustion raises and the transaction rolls back. No
random() fallback. Algorithm identity is
`wov.renown.v1/hmac-sha256-u32be-rejection128`; keyVersion and drawIndex are durable.
Same unresolved request/key/state after rollback yields the same draw. Replay
reads the receipt before RNG or fresh eligibility. Local literal roll vectors34,
89,22 and exact94/95/4/5 outcome vectors are covered independently.

## Boundary, containment and resources

The existing verified-JWT Edge obtains actor only from getClaims().sub. Respec
accepts operation/characterId/requestId/expectedVersion only; Renown adds one stat.
Unknown fields, actor, refund/delta, cost/chance/rank/RP, roll/key/seed/outcome and
resource inputs refuse. The service-only public progression_command replaces its
old seven-argument signature with one eight-argument signature and trailing stat
default. DROP RESTRICT fails on unexpected SQL dependencies; no overload is left.

Under character lock, UUID replay/conflict spans discretionary_allocation,
order_command,full_respec,renown_training. Conflicting operation/actor/stat/version/
normalized payload or multiple historical command rows refuses. XP server event
UUIDs are deliberately outside this guard. Ownership precedes receipt access.

The invoker raw-write trigger now fences bhp,bhp_trained,rp_total_earned as well as
all E progression fields. Service table UPDATE is replaced with column UPDATE on
unrelated fields when needed, then protected column UPDATE is revoked. Inherited
RP write authority causes fail-closed installation refusal. Known retained RP
writers are checked for effective owner-only execution. Legacy train_renown_stat
is retained owner-only, without a canonical caller; no unproven DROP is attempted.

Fresh public commands retain initial node advisory lock → character FOR UPDATE →
ownership → replay/conflict → node revalidation → pause/version/state/proof →
existing sidecar FOR UPDATE → combat/lifecycle/stance checks → class/config/key
read → private mutation → clamp-only sync → receipt/version. There is one initial
combat_enter_node advisory acquisition and no second node/encounter lock. Missing
or disabled command control fails closed. Control remains false throughout.

Canonical non-level sync never heals/refills or resurrects. Respec clamps downward;
Renown success can raise maxima without raising current values. Failure skips sync
and preserves valid resources exactly. Unrelated out-of-bounds resources refuse.

Browser requests persist in sessionStorage with original UUID, payload and version
through uncertain transport or transient rollback. Conflicting choices cannot
replace an unresolved request. Committed/replayed results refetch authoritatively;
no optimistic stat/RP/token update. Trainer submits canonical respec/Renown and
shows paused/refusal wording and success/failure with RP spent. Per-stat ranks are
displayed separately from the existing lifetime leaderboard. Order retry narrowing
is corrected for the expanded action union. Refund wording says recorded investment.

## Deferred gaps and release identity

RP EARNING AUTHORITY GAP is a separate future task. F neither restores earning nor
changes hunt/quest/boss/party splitting. Existing balances are preserved and can be
spent after later separately authorized family activation.

character_inventory_action locks character FOR UPDATE and is compatible with F.
degrade_party_member_equipment is service-callable, can unequip without that lock,
and has no installed SQL or application caller. F introduces no dependency on it,
no reverse lock and no equipment redesign. Its writer gap remains deferred. This
does not establish hosted contention proof or safety of unrelated future writers.

Prepared SQL is `docs/operations/progression-001F-cutover.sql`, outside Drizzle
discovery. Its exact UTF-8/LF SHA-256/bytes/lines and source/object fingerprints
are in `docs/operations/progression-001F-manifest.json` and the delivery message.
Reviewed SQL SHA-256 `c5c3c05341a7fc42678326d9572ed1442f04579e568d228b4d89f5eb811e18ff`,
57669 bytes,693 LF newline-terminated lines, no BOM.
No0001–0004, historical Supabase migration, executed journal, XP primitive or E
reviewed SQL/manifest is rewritten. E runtime source pins are historical at448883ef;
the F manifest supersedes them for the new Edge/browser candidate. Historical E
checks read frozen source rather than pretending F bytes are the old E release.
Reviewed file identity, eventual installed ledger bytes and resulting normalized
prosrc/metadata remain separate. Later tool output must reconcile all three.

Pre-guards pin exact canonical C/E/R2 function bodies/security/arguments/defaults,
owner-only/private and narrow command ACLs, sidecars, raw trigger, pool200 constraint,
old receipt constraint, overloads, disabled control and extensions.pgcrypto1.3.
Collisions/drift fail closed. Final assertions pin all resulting F function bodies,
security/arguments/defaults, key RLS/owner/grants, legacy/private effective EXECUTE,
service-only entry and disabled control. Installation changes no character row.

## Local validation and practical limits

|Acceptance|Result|
|---|---|
|F actual authority/containment/rollback/HMAC suite|39 passed|
|Actual five-layer Combat2 chain with F installed in fixture|12 passed|
|F Edge/browser/hook tests|21 passed|
|Focused progression/class/UI/Combat2/resource suite|273 passed;276 including the3 project-state tests|
|C SQL / D integration / D containment|16 /9 /6 passed|
|E SQL / actual Combat2 E chain|22 /11 passed|
|Historical R1 / R2 / audit characterization|11 /8 /5 passed|
|Project state|3 passed; JSON/Markdown synchronized|
|Root/app/node/strict Edge TypeScript; production build|Passed|
|Full suite, maxWorkers=2|2751 passed /18 failed; exact18 baseline identities, no new failures|
|Generator/manifest/whitespace/history|Passed; exact historical artifacts preserved|

Logs are outside the app repo under `../001C-local-db-tests/F-impl-*`.
Known generated ability snapshots and MCP bundle are restored before commit.

Two default-worker-pool runs, with and without competing build/typecheck jobs, hit
an additional timeout in the unchanged spendable-CP schema-contract test. That
file passed5/5 alone without source changes. Final full acceptance uses two workers,
without changing assertions or the30-second timeout, and restores the exact baseline.

PGlite0.3.14 does not bundle pgcrypto. Tests install a disposable SHA256-based
HMAC fixture verified against independent Node crypto and substitute only the
extension-availability pre-guard. Production F bodies and other guards are exact.
The unmodified production guard is separately proved to refuse missing pgcrypto;
drift/overload/ACL/trigger/constraint cases roll back. This proves local transactional
behavior and encoding, not execution of the hosted pgcrypto binary.

Public service commands remain paused in every test. Owner-only primitives and the
shared validator exercise F behavior without activating the command family. Only
the historical E Order behavior fixture omits the pause branch, stays owner-only
and retains all operation logic; it is used to establish actual mixed-class proof.
`scripts/progression-history-test.mjs` similarly runs old E behavior while public
control stays false, and freezes source assertions to the reviewed E checkpoint.
Local deterministic interleavings are not hosted multi-session proof.

Audit-vector coverage:1–5→03/37;6–8→16/31/38;9→15;10→21/22;11→32;
12–14→04/06/07/39;15–18→08/10/11/12;19–22→08/09/20/36;
23–25→33;26→05;27→18/19;28–29→20/34/35;30→25/30, including rollback-only
F changed-location fault injection. Historical E interleaving also passes. Key
secrecy/security and literal RNG vectors add26–29.

No unresolved local implementation blocker remains. Hosted installation, real
pgcrypto execution, authenticated paused probe, hosted contention, natural runtime,
Edge deployment, activation and Mik's frontend publication remain separate gates.
STOP at the prepared release; no001G/H has begun.
