# ENG-LEGACY-001F5B — Party correction readiness

Baseline e29785bd84930b4658bddcd388eb8bee5e95315d. **GO for separately authorized, bounded local implementation of the F3 lock correction.** No installation/runtime sign-off. Parties IN PROGRESS; parent OPEN.

## Archived evidence and verification limits

- [F5 raw JSON](legacy-001F5-party-parity-envelope.json): copied byte-identically from owner's Downloads file. Reported observation2026-10-13T20:43:06.818651+00:00; sandbox_exec; PostgreSQL17.6; read committed/default read committed; transaction_read_only off.48 function records,25 trigger records,10 tables. No narrative PASS/FAIL list is embedded.
- [F5A original text](legacy-001F5A-hosted-report.txt): copied byte-identically from supplied attachment. Reports catalog SELECTs2026-10-13 21:01:46.85–21:02:32.75 UTC as sandbox_exec in **separate statements**, not a shared snapshot; read_only off, only reads reported; no metadata truncation/inaccessibility.

These are owner-supplied hosted observations, not independently queried by Codex. Locally verified facts are archive byte identity/JSON structure, reported definitions and source compatibility analysis. read_only off neither proves writes occurred nor an enforced read-only session. F5 and F5A must not be merged as one observation. F5A includes abbreviated fingerprints and prose rather than complete function bodies; preserve its original text, do not invent missing full hashes or claim byte-level nested-body parity. No additional hosted check required for this bounded local preparation decision.

## Movement dependency disposition

F5A reports one encounter_end_participation(uuid,uuid), postgres SECURITY DEFINER/search_path public, normalized fingerprint **e1c855de…2533** (abbreviated as supplied). It selects the newest legacy **public.encounters**, not Combat2 node_encounter; takes advisory encounter_lock_key(encounter UUID); deletes encounter_engagements/encounter_participants and cancels pending combat_actions. arm_effects_catchup_for_node may schedule missing cron catch-up; its errors are swallowed. Nested legacy child fences take character KEY SHARE, reentrant within movement's own character lock. No Combat2 node/encounter/fighter or party lifecycle lock is reported.

F5 JSON separately reports enabled trg_characters_node_change_participation AFTER UPDATE OF current_node_id with changed/nonnull old-node WHEN, bound to characters_end_participation_on_node_change(). Its body calls cleanup with OLD.id/OLD.current_node_id and swallows errors; full reported normalized fingerprint cbc04da670898dc87b7478df33c4b6725c881746f0e8dd79ccf9d7c2ad9723de. F5A corroborates this binding and reports:

- trg_characters_encounter_lifecycle AFTER UPDATE OF current_node_id or hp: on node change deletes all character encounter_participants without advisory; name order places it before node-change cleanup. Fingerprint5a1ae8ae…5e03, postgres DEFINER/public.
- sync_stance_effects runs for changed reserved_buffs, deletes stance effects, adds no new locking dependency here; postgres INVOKER/public,9e230c7b…88e2.
- encounter_lock_key immutable,20e7669f…b75a; arm_effects_catchup_for_node DEFINER/public,cron,099c96e1…173af. Abbreviations retained, not completed from guesses.

The proposed party_mutate correction updates party/member/request metadata, **not current_node_id, hp or reserved_buffs**. Character locks are not UPDATEs. It does not directly invoke these character UPDATE triggers; party/FK/lifecycle child triggers still matter and remain in the F3 tests. Coordinated and solo movement still invoke legacy cleanup, but their ordinary Combat2 node locks are already held. F5A reclassifies Movement PASS and the trigger dependency as fully accounted for, with a separate legacy hazard requiring acceptance. No movement or helper modification proposed.

## Combat1 hazard — temporarily owner-accepted, unresolved

F5A identifies legacy advisory→participant/character versus movement character/participant→legacy advisory ordering. Legacy encounter_intake, claim_encounter_tick and encounter_reconcile are reported browser-executable; encounter_apply_character_damage/heal/resource and encounter_boss_resolve_cast service-only; commit_encounter_tick_v2 also touches characters but service EXECUTE denied. A legacy intake/claim holds advisory and waits on a participant row deleted by movement, while movement waits on that advisory. Deadlock victim choice can fail a legacy call or lose cleanup when the movement trigger swallows the cancellation.

Owner's subsequent instruction explicitly approves using the **previously approved temporary acceptance of this legacy Combat1 deadlock risk**. Record as accepted-for-now for this correction's readiness, not resolved, contained, runtime-reproduced, or safe for unrestricted legacy use. Unknown live callers/legacy rows and special travel/summon/teleport/respawn/lifecycle routes remain uninspected. Future targeted containment/disposition is separate; no new audit or permission change here. No ownership inference or gameplay-row inspection.

## Remaining F5 criteria / actual blockers

| Finding | Disposition | Effect on local implementation |
|---|---|---|
| Membership guard/entry gap | F5 reported party_mutate/global actor lock, nonlocking guard and entry chain support F2 source concern. Normalized party_mutate f00dc054af96c05d74b66be30db9909c6b6baafdf33e57b98a04a967aae0745f, postgres DEFINER/public,auth,pg_temp. | Correction target, not a demand for a new broad audit. Preserve original replay/shape checks. |
| RPC execution authority | F5 public party/entry/movement auth/service rights and private predecessor/claim browser denials retained. Browser EXECUTE on fighter presence trigger helper is reported; trigger-returning function is not a normal directly callable gameplay RPC. | Do not change ACLs. Do not infer a trigger-function grant alone allows arbitrary mutation. |
| Effective table DML / RLS | node_encounter/node_fighter browser DML grants are broad: retain **FAIL against a blanket no-browser-grants assumption**. Both RLS enabled with only SELECT policies in F5. Absent mutation policies ordinarily default-deny ordinary role writes; grant existence is not effective gameplay write proof. Party/member/request browser DML denied. | Nonblocking to narrow postgres-owned correction. RLS-role/JWT/BYPASSRLS contexts, column permissions and privileged/dynamic writers remain unverified. No claim broad ACL concern resolved or generally accepted; no grants proposed. |
| Trigger/delegated lock dependencies | F5A closes missing movement-helper body dependency through supplied textual observations; exact full nested fingerprints are absent. Legacy Combat1 risk accepted temporarily above. | No identified new Combat2 lock inversion from this dependency. Preserve byte guards only where full evidence exists; never construct abbreviated hashes. |
| Isolation | F5 metadata session reports read committed; F5A separately observed session only. | Real API/service isolation unverified. Not blocker to local READ COMMITTED implementation/tests; serialization/deadlock errors must leave transaction rolled back and preserve bounded retry behavior. No claim caller isolation proved. |
| Independent-session/runtime concurrency | No hosted gameplay/concurrency probe occurred. | Planned isolated two-session regression tests are required locally; lack of hosted runtime evidence is not a source design defect. Installation/runtime remain separate gates. |
| Raw service/external dependencies | Table grants/predecessors retain privileged capabilities outside supported RPC locking. | Restrict correction guarantee to supported paths, preserve uncertainty. No arbitrary raw-write safety claim. |
| Last-man-in / tank metadata | F5 refresh helper contains historical party tank/leader priority text. This task does not establish current selection behavior across consumers. | Keep helper and party metadata semantics unchanged; do not use readiness GO as tank runtime verification or authorize correction of this difference. |

F5A expressly leaves other F5 FAIL/REQUIRES EVIDENCE items open. The raw F5 envelope supports the criteria disposition above but has no original evaluator checklist; no undocumented FAIL is silently relabeled PASS. This GO concerns the narrow membership serialization design only.

## Next bounded task and acceptance tests

Separately authorize local implementation of [F3](legacy-001F3-party-lock-design.md) in the existing party_mutate authority, reviewed SQL outside automatic migrations. No new table, API retry redesign, tank selection or movement/Combat1 correction.

Required invariant: unlocked discovery of all affected accepted members/recipient, current nodes and relevant fighter/group encounters → sorted node advisories → global party lifecycle → sorted encounter row locks → deterministic required character/member locks → locked coverage/lifecycle/ownership revalidation → existing combat predicate and atomic mutation. Abort/retry on changed coverage; never acquire new nodes late. Encounter locks are necessary because claim has no node advisory. No current_node_id UPDATE. Completed UUID replay must remain original bound result despite later combat; conflicting reuse denied.

Required tests: old accept/entry two-session reproduction; corrected mutation-first blocks entry and entry-first refuses mutation; claim-first/live lease and mutation-first SKIP LOCKED; off-node members/recipient coverage; changed node/member discovery refusal; leave/kick/disband/follow/stop_following and existing tank metadata behavior; coordinated/solo departure and arrival; actual lifecycle/FK triggers and unchanged legacy movement trigger not fired by membership; exact replay/conflicting UUID; injected rollback with no partial member/request/tank writes. Preserve F1 malformed-response/retry-UUID weakness as independent candidate. Two-session tests must use isolated actual SQL/trigger fixtures, not source text alone; hosted concurrency is not established by them.

No remaining demonstrated blocker to **local** implementation from supplied F5/F5A evidence and the owner's temporary risk acceptance. Stop if implementation exposes a new lock cycle, missing coverage or incompatible installed dependency. SQL installation/deployment still require separate authorization and validations.

All previous closures, four OPEN progression F limitations and existing accepted uncertainties retained. Administrative XP grants remain paused; normal gameplay XP earning is not intentionally disabled by this policy and is not verified here. Parties IN PROGRESS; parent OPEN. No hosted operation, correction, commit or push.
