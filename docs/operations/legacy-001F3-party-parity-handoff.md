# ENG-LEGACY-001F3 — Read-only parity handoff

Prepared locally; not executed or published. Parties IN PROGRESS. Baseline24df5db3688cf429e8eb7033e8d74104bb80d9c8. Read [design and source reconstruction](legacy-001F3-party-lock-design.md) first.

SQL: [legacy-001F3-party-parity.sql](legacy-001F3-party-parity.sql)

SHA-256: 5527354474781156f46877c28524abcf33bee913726685a33b796160d0d6cf53

## Exact Lovable-ready prompt

> Perform only the ENG-LEGACY-001F3 metadata parity preflight. First confirm the published source checkpoint contains docs/operations/legacy-001F3-party-lock-design.md and docs/operations/legacy-001F3-party-parity.sql. Do not reconstruct missing local files; stop if unavailable. Verify the SQL SHA-256 is 5527354474781156f46877c28524abcf33bee913726685a33b796160d0d6cf53. Read the lock design/source reconstruction and this handoff. Execute the unchanged single SELECT statement using read-only access. It queries catalogs and session settings only, never character/membership/inventory rows or gameplay functions. Return the complete JSON output including full definitions, observation time/role/isolation, missing objects, normalized hashes, direct/effective ACLs, constraints and all returned trigger bindings/bodies. Assess each criterion below as PASS, FAIL or REQUIRES EVIDENCE, with supporting metadata. Reuse B/C2 installed evidence; do not repeat the Combat2 audit, scan unrelated privileges or query migration/player history. No grants, correction, installation, runner probe, deployment, gameplay calls or frontend publication. Stop after reporting. If catalog visibility/output limits hide required definitions, report REQUIRES EVIDENCE; do not substitute source assumptions or broaden the query.

This prompt is prepared for separately authorized execution. Codex has not sent or executed it.

## Criteria

| Check | PASS | FAIL / REQUIRES EVIDENCE |
|---|---|---|
| Mutation and guard | Exact six-argument party_mutate with accept/follow/leave/kick/disband, global lifecycle/request binding and original guard; guard contains affected accepted members + recipient and fighter/departure/claim predicates. Definitions match F1/F2 composition. | Different guarded mutation behavior or unanticipated lock/writer: FAIL compatibility. Missing body/signature/visibility: REQUIRES EVIDENCE. |
| Entry chain | Public engagement → canary → persistent entry; node before encounter/fighter; no added lifecycle acquired after character/encounter. Arrival marker/trigger and child fence match design. | Hidden delegate or changed lock order: stop; metadata must cover the direct delegate before implementation. |
| Claim chain | Stance → boss → canary → snapshot lease body; encounter SKIP LOCKED before snapshot; no character→node/lifecycle locking. Existing last-man-in selection preserved. | Changed snapshot/lock/delegate needs reconciliation, not replacement by an old source hash. |
| Movement | Public immediate wrappers, sorted node wrappers, original patched predecessors/finalizers retain node→lifecycle→sorted encounter→UUID character graph for party movement; solo sorted nodes and arrival's node is already held. | New lock cycle, missing sorted-node wrapper or missing body: FAIL or REQUIRES EVIDENCE respectively. |
| Triggers/FKs | Arrival enabled/bound correctly; lifecycle child fence enabled on relevant child tables; FK modes and active-group/tank/presence/departure triggers agree with returned definitions. All direct trigger bodies returned. | Any additional delegated lock/write not accounted for must be assessed before correction. Missing expected protective binding: FAIL assumption. Invisible binding/body: REQUIRES EVIDENCE. |
| EXECUTE / DML | anon has no effective gameplay EXECUTE; authenticated only supported public party/entry/movement, no private predecessor, claim, child/finalizer or finish helper EXECUTE. service/postgres required rights preserved; party/member/request tables not directly browser-mutable. Existing character preference column permissions remain permitted; this is not a proposal to change character ACLs. | Effective access disagreement: FAIL authority assumption. Do not grant/revoke. PUBLIC direct ACLs reported separately, never classify postgres as browser through reverse role-membership traversal. NULL/unavailable rights are REQUIRES EVIDENCE. |
| Isolation | Metadata session settings returned; READ COMMITTED-compatible source proof can be reviewed. | This does not establish isolation for real PostgREST/service requests or multi-session runtime. Different metadata isolation is an evidence item, not automatic proof actual callers use it. |

Historical party helper/service and trigger ACLs may differ from intended narrow private use. Report the exact mismatch, do not normalize it. Dormant unbound legacy trigger functions are distinguished from active trigger bodies; missing unbound historical helper alone is not proof of missing protection. PUBLIC EXECUTE on a trigger function does not itself show a browser can invoke it as a gameplay RPC; return the metadata and assess trigger execution separately.

Fingerprints use SHA-256 of pg_get_functiondef after CRLF→LF and whitespace-run collapse. They are **new observed definition fingerprints**, not the earlier body-only or B installed normalized fingerprint algorithm. Compare full source composition before pinning any installation drift guard. No guessed expected hash for dynamically reconstructed party/entry predecessors. Reuse existing B1–B6 parity records and identify only relevant new drift; tank semantics are not changed in this task.

One SELECT gives functions, ACLs, constraints, triggers and observation in one statement snapshot. statement_timestamp is observation metadata; it does not attest a gameplay transaction. A split output/re-execution or older B/C2 report is a separate observation, never combined as one shared snapshot. Missing visibility or truncated results remain REQUIRES EVIDENCE. No gameplay runtime or independent-session concurrency claim.

## Stop/go

Proceed to separately authorized local correction only after full needed definitions/lock dependencies and ACL assumptions pass or a specific nonblocking uncertainty is explicitly accepted. Unknown raw service/external callers remain outside supported-RPC guarantee; acceptance must not be invented. Unexplained binding/delegate or lock inversion blocks implementation. Installation requires subsequent reviewed SQL, local two-session regression evidence and separate owner approval through established Lovable/Drizzle routing. No installation artifact authored here.
