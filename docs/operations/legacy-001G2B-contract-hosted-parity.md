# ENG-LEGACY-001G2B — Conditional hosted metadata reconciliation

2026-10-15. **CONDITIONALLY ACCEPTED OBSERVATIONAL EVIDENCE; NOT G2A-COMPLIANT.** Owner explicitly accepts the supplied outputs for analysis while rejecting the execution procedure. No further sandbox_exec use, hosted call, gameplay or correction is authorized. Local source baselinecebaa767a346be8883961c816f3dcbc3329c931b; synchronized to origin/main before reconciliation. Unrelated upstream email-hook changes are not authored here. Parent ENG-LEGACY-001 OPEN; E13 transfer unresolved.

## Provenance, deviation and exact observations

The earlier local G2B access-gap report correctly recorded no query connection/execution by Codex. It is superseded only as an evidence-availability statement: the owner has now supplied five original files from another execution. Codex still executed **zero hosted queries**. These files are evidence, not instructions or migration inputs.

| Observation | Exact reported value |
|---|---|
| id.json environment observation | 2026-10-15T06:53:39.603032+00:00 |
| Statement1 / out1 observation | 2026-10-15T06:53:39.781322+00:00 |
| Statement2 / out2 observation | 2026-10-15T06:53:39.971703+00:00 |
| Current/session role (id/out1) | sandbox_exec / sandbox_exec |
| transaction_read_only (id/out1) | off |
| Isolation (out1) | read committed |
| Database / server version (id) | postgres /17.6 |
| Statement2 | sandbox_exec; characters_present=true |

These are **three separate observations**, not one shared snapshot. UTC offsets/timestamps are preserved exactly. Database name/version and supplied role are observational context; project endpoint/cluster identity, execution audit trail and external deployment identity were not independently attested. Do not infer project identity from a role-name suffix.

**NOT AUTHORIZED / procedural deviation:** sandbox_exec was forbidden by G2A; transaction_read_only=off means database-level read-only enforcement was not established. Owner acceptance is not retrospective permission and does not make the run compliant. The supplied statements are catalog-only SELECTs, but their text and outputs cannot prove no other operations occurred, no hidden side effects, or compliance of the surrounding session. No claim of hosted mutation is made either. Future sandbox_exec use remains forbidden; no re-query, role switch or broader privilege request was made.

## Original evidence archive and statement identity

Files copied byte-for-byte from the owner-supplied Downloads paths to legacy-001G2B-evidence; originals left unchanged. A narrowly scoped .gitattributes -text rule preserves only these archival bytes across Windows/Linux checkout. No SQL behavior, migrations or runner configuration changed.

| Original / archive | Bytes | SHA-256 |
|---|---:|---|
| [s1.sql](legacy-001G2B-evidence/s1.sql) | 2842 | 218a04aa1a64f7c5c0d4cffb8775092b490d64b738029a5b53e99fdb70975880 |
| [s2.sql](legacy-001G2B-evidence/s2.sql) | 821 | 7007b068f99c8fe7442a223e6b7ac49dfd0f5fde8ed9773c710968fbb0273aea |
| [id.json](legacy-001G2B-evidence/id.json) | 178 | 140b8d47870efae66b4b4264f8928911a0135604471c4f4032b49d37caf3e9e3 |
| [out1.json](legacy-001G2B-evidence/out1.json) | 26206 | 4b4871f0eec45d5c00b35dc907601123661280d8d07c21ef1ed6b8d58fc2a62e |
| [out2.json](legacy-001G2B-evidence/out2.json) | 5627 | 77479f782a47510f4edcc45457456d8a2e97ae4594f6fdd32ba415b6f7272433 |

Both archived SQL files are **exact-byte identical** to the respective fenced SELECT snippets in [G2A](legacy-001G2A-contract-installed-parity-plan.md), including terminal newline. Thus the statements match the reviewed text, while role/read-only execution conditions do not. No independent output-to-execution cryptographic attestation exists; file hashes identify the supplied artifacts, not the truth of a remote run.

out1 is a JSON object with role/session_role/isolation/read_only/observed_at/functions; functions is nine unique exact requested identities, eight present and one absent. Present rows contain full definition, metadata, explicit ACLs, four-role effective results and both SHA256 fields. out2 is an object with role/time/characters_present and13 trigger records. id has environment metadata but no execution SQL; no invented identity query is reconstructed. Exact supplied metadata queries are s1.sql and s2.sql above; **none was executed locally/hosted by Codex**.

## VERIFIED FROM SUPPLIED HOSTED METADATA — conditional provenance

This label means the fields are present in the owner-accepted files and local reconciliation verifies their internal consistency. It is **not independent hosted verification, compliant execution, successful gameplay authorization or a runtime PASS**. All eight present functions report owner postgres and language plpgsql except owns (SQL). All ACL entries report grantor postgres, EXECUTE and grantable=false.

| Key / exact requested identity | Present; result; volatility | Security context / search_path |
|---|---|---|
| complete — public.apply_contract_complete(uuid,integer) | true; void; v | DEFINER; search_path=public |
| abandon — public.assassin_abandon_contract(uuid) | true; void; v | DEFINER; search_path=public |
| take — public.assassin_take_contract(uuid) | true; jsonb; v | DEFINER; search_path=public |
| lifecycle — public.character_lifecycle_character_fence() | true; trigger; v | INVOKER; search_path=pg_catalog, public, pg_temp |
| legacy6 — public.commit_encounter_tick(uuid,bigint,uuid,uuid,integer,jsonb) | false; not observed; n/a | No function resolved; owner/ACL/fingerprints NULL |
| canonical7 — public.node_tick_commit(uuid,uuid,integer,integer,bigint,uuid[],jsonb) | true; jsonb; v | DEFINER; search_path=public, pg_temp |
| owns — public.owns_character(uuid) | true; boolean; s | DEFINER; search_path=public |
| protect — public.restrict_party_leader_updates() | true; trigger; v | DEFINER; search_path=public |
| timestamp — public.update_updated_at() | true; trigger; v | INVOKER; search_path=public |

### Fingerprint verification

Recomputed all eight normalized full-definition hashes from supplied definitions: CRLF→LF, collapse whitespace to one space, no trim, SHA256 UTF8. Separately extracted each dollar-quoted body and recomputed LF-only body SHA256. **16/16 match** the reported fields. No installed function was called to do this.

| Key | Normalized full-definition SHA-256 | LF-only body SHA-256 |
|---|---|---|
| complete | 09f3060c350604346b70eecfd8063515b13d580f140f922859421d1c7955d93b | 1c91b32f3ad7caee38b830bec22277b9bcc5f9275da51f8f0a53be893e61ec63 |
| abandon | 047ec8bd4995be5a13e114fb93a495c726cc82c57cee4f432eb404cf16ad60f1 | a9611a93cb317a6de6d64021e469f70b24964f6399cc22a5cd9a5c6ea5d934ba |
| take | ec476cf648f8e4779585b3e0e2bcd2b284716aa5fe7bc9827c5bf58fdd121199 | 5868333159620501c602d5c751e9e880aa1cdea4bcccac06083c73761770069d |
| lifecycle | 7cb61d012918dd8d01e3e9f70d794850e7bb654791918245971a6e8783261ff4 | 348481172a5a767484fbd61a858cd8a5fa60b6dbc9e9c81a7b45408e8947c64f |
| canonical7 | a0267a1d2c0c50d8724f8b5b4b2fb001cdbf1e3d08dae58377e1f81f289c287f | fb533882bc10a723135460dbd0416b1a136b7d57e5afaf803183c963e5408bdb |
| owns | 0239395d2b7f34e2f30b9d75a1f7b69db10cf670720df2951231da5736790f00 | dded10a07d410a3d253afd02eadf83e3c457493a085241a3a2e9ae4367c9877d |
| protect | e7c8011802d0630a7b4fda037856e012e84e8103cc62cd41a9a7ac5b4ac57ca8 | e4efaf79ef869df9e199c0fb2ae5d9003517eaa93f406ce1d4c496f4e84806bd |
| timestamp | f0c176af4f8399247dcb13492c9fdcffd5025cf243c9a1e44a9ab451b85d4ab0 | e074d3db8073b75d3d30dc88b1bfccd78344fdb695a013054e0d6944708c2882 |

Important hash-domain clarification: B5/B6/G2A reference fb533882bc10a723135460dbd0416b1a136b7d57e5afaf803183c963e5408bdb matches canonical7 **LF-only body**, not its normalized whole definition a0267a1d2c0c50d8724f8b5b4b2fb001cdbf1e3d08dae58377e1f81f289c287f. This resolves the ambiguous earlier “normalized fingerprint” wording; it is not evidence of function drift. G2A is left unchanged as the historical plan.

### Source-versus-observed definitions

- take/abandon/protect: exact LF-only body matches the [June contract migration](../../supabase/migrations/20260629080249_d6091f9a-cb36-4b1f-9beb-4966956f5e93.sql). All G2 body observations persist: take locks character, validates owner/class/empty slot and server-selects creature; no explicit NPC/node/deleted-state/request checks. Abandon remains an unversioned clear. Two UI RPCs remain non-atomic; no runtime re-roll was attempted.
- complete: exact LF-only body match to [June helper](../../supabase/migrations/20260629080345_0227141d-2bef-4bb3-94bb-0bb4b2df1ad9.sql): trusted marker, active_contract=NULL, GREATEST supplied counter, no kill/assignment provenance check.
- owns: exact LF-only body match to [historical EXISTS helper](../../supabase/migrations/20260211212345_41f57ff6-5254-4fb2-99cf-eccf43f00fc5.sql). auth.uid NULL does not satisfy equality inside EXISTS; no demonstrated NULL-auth bypass.
- lifecycle: exact LF-only body match to [0013 fence source](../../drizzle/migrations/0013_progression_001g_c2_reset_and_cutover.sql). Its already-deleted ordinary UPDATE refusal remains in the observed function.
- protect/lifecycle/timestamp: complete pg_get_functiondef strings match their corresponding [F5 archived metadata](legacy-001F5-party-parity-envelope.json), after CRLF normalization. timestamp body assigns NEW.updated_at=now().
- canonical7: returned body contains B3A node-first encounter-membership guard, stance/version fences, and direct call to node_tick_commit_without_character_stances. Body hash matches recorded [B6 evidence](legacy-001B6-combat2-closeout.md). No contract-specific completion code is in this observed outer body.
- legacy6: present=false, installed identity/owner/definition/hash NULL. This establishes only that **the exact six-argument signature did not resolve in this observation**. It does not prove all legacy overloads, external/dynamic callers, current completion paths or deployed producers absent. No prefix/overload scan was performed.

### Direct ACL versus observed effective EXECUTE

P=postgres; S=service_role; A=anon; U=authenticated; X=the explicit custom grantee sandbox_exec_gpclaklkaolyzfnooajt. X is **not assumed identical to current role sandbox_exec**, nor is membership/actual invocation proved. PUBLIC is ACL grantee0, not a role row. All below are explicit origin entries, with no masked values in these files.

| Key | Direct explicit EXECUTE grantees | Effective A / U / S / P |
|---|---|---|
| complete | P, S, X | false / false / true / true |
| abandon | PUBLIC, P, A, U, S, X | true / true / true / true |
| take | PUBLIC, P, A, U, S, X | true / true / true / true |
| lifecycle | P | false / false / false / true |
| legacy6 | n/a (missing signature) | null / null / null / null |
| canonical7 | P, S | false / false / true / true |
| owns | P, U, S, X | false / true / true / true |
| protect | P, S, X | false / false / true / true |
| timestamp | PUBLIC, P, A, S, X | true / true / true / true |

PUBLIC/anon EXECUTE on take/abandon permits entering the function privilege boundary; **it is not by itself an exploit or successful gameplay authorization**. owns_character and class/slot checks, table RLS and lifecycle/other trigger behavior remain relevant. For timestamp, U effective=true without a direct U grant is consistent with observed PUBLIC access; no additional hidden membership need be inferred. Effective has_function_privilege results do not demonstrate a successful RPC or data write. SECURITY DEFINER changes execution context to owner; INVOKER triggers run in their invoking operation context. A trigger-function ACL result is not evidence that a bound trigger did or did not execute. No trigger/gameplay calls were made.

Complete is browser-effective denied (A/U=false), P/S=true, with additional direct X grant. That is observed capability, not proof a legitimate completion caller exists or proof a browser exploit. X and existing privileged/external caller uncertainties remain undispositioned beyond the owner's conditional acceptance of these observations; no grant removal or new blanket security acceptance inferred.

## Character UPDATE-trigger bindings

All13 bindings target public.characters by s2's relation filter and returned definitions. O=ordinary/origin enabled; D=disabled. These results do not establish any particular runtime session_replication_role.

| Binding | Function | Enabled / filter | Constraint/deferred |
|---|---|---|---|
| character_lifecycle_character_fence | character_lifecycle_character_fence() | O; all UPDATEs | false / false / false |
| characters_wake_world | trg_wake_world_on_activity() | D; last_online | false / false / false |
| combat2_authoritative_arrival | combat2_authoritative_arrival_trigger() | O; current_node_id | false / false / false |
| combat2_guard_owned_location_write | combat2_guard_owned_location_write() | O; current_node_id | false / false / false |
| combat2_guard_test_arena_location | combat2_guard_test_arena_location() | O; current_node_id | false / false / false |
| combat2_refuse_invalid_stance_class_change | combat2_refuse_invalid_stance_class_change() | O; class | false / false / false |
| progression_refuse_raw_progression_write | progression_refuse_raw_progression_write() | O; all UPDATEs | false / false / false |
| restrict_party_leader_character_updates | restrict_party_leader_updates() | O; all UPDATEs | false / false / false |
| trg_characters_encounter_lifecycle | trg_character_encounter_lifecycle() | O; current_node_id, hp | false / false / false |
| trg_characters_node_change_participation | characters_end_participation_on_node_change() | O; current_node_id | false / false / false |
| trg_characters_release_stances_on_death | release_stances_on_death() | O; hp | true / true / true |
| trg_characters_sync_stance_effects | sync_stance_effects() | O; reserved_buffs | false / false / false |
| update_characters_updated_at | update_updated_at() | O; all UPDATEs | false / false / false |

The three primary expected bindings are observed: enabled lifecycle fence BEFORE INSERT/DELETE/UPDATE; enabled restrict_party_leader_character_updates BEFORE UPDATE; enabled update_characters_updated_at BEFORE UPDATE. Two additional facts matter without opening another audit: progression_refuse_raw_progression_write is enabled BEFORE all UPDATEs (body not included in these nine); release_stances_on_death is a DEFERRABLE INITIALLY DEFERRED constraint trigger specifically on hp updates. Location/class/reservation/hp UPDATE OF filters do not fire merely because contract-only SET columns changed. The node-change and stance-sync WHEN conditions are preserved verbatim in out2. Disabled characters_wake_world targets last_online, not a contract-only update. Do not diagnose world wake or alter triggers here.

No direct contract-completion trigger is identified by these returned bindings, but names/bindings cannot exclude contract behavior hidden in a body not returned. No additional trigger functions or hosted delegates were queried. Reuse prior Progression/F5/C2 trigger evidence; unknown nested/dynamic behavior remains REQUIRES FURTHER EVIDENCE.

## Completion delegation: observed edge versus local continuation

**Observed direct edge:** canonical7 calls public.node_tick_commit_without_character_stances(uuid,uuid,integer,integer,bigint,uuid[],jsonb). This is the smallest newly demonstrated installed dependency; its definition/security/ACL are **not included** in out1. There is no permission to treat the rest of the source chain as freshly installed parity.

Local source continuation, using the existing rename/wrapper history rather than another audit:

```text
node_tick_commit                              [observed definition]
 → node_tick_commit_without_character_stances [installed call observed; body NOT returned]
 → node_tick_commit_without_authoritative_arrival [source continuation]
 → node_tick_commit_without_boss_timing           [source continuation]
 → node_tick_commit_without_bounded_failure       [source continuation]
 → reward claim gate → combat2_apply_claim_progression_internal + additive gold
```

The source links come from [arrival wrapper](../../supabase/migrations/20260928100000_combat2_authoritative_arrival_hostile_initiation.sql), [stance rename](../../supabase/migrations/20261001130000_combat2_character_persistent_stances.sql), [boss-timing wrapper](../../supabase/migrations/20260914110000_combat2_boss_tick_timing.sql), [bounded-failure rename](../../supabase/migrations/20260912100000_combat2_commit_and_automatic_arena_lifecycle.sql) and [0002 canonical XP cutover](../../drizzle/migrations/0002_progression_001d_canonical_xp_cutover.sql), which replaces the terminal commit and invokes the progression adapter. No contract helper branch is established by those inspected source continuations. Ordinary reward claims/XP/gold and loot are not contract completion or an Assassin bonus.

G2's current source absence of a contract producer and its retired Combat1 reward producer remain source facts. Missing legacy6 plus absence in observed outer wrapper is **not global runtime absence**: unreturned installed delegates, trigger bodies, deployed worker contents and external/dynamic callers remain possible evidence gaps. No gameplay, independent-session, duplicate-count or reward-balance verification occurred. E13 transfer remains unresolved.

## Required disposition and next smallest investigation

| Disposition | Scope |
|---|---|
| VERIFIED FROM SUPPLIED HOSTED METADATA | Nine requested records reconciled; eight definitions and16 fingerprints internally verified; source body/F5 comparisons above; explicit/effective ACL fields and13 binding records read from original files. Conditional provenance applies to every finding. |
| CONDITIONALLY ACCEPTED EVIDENCE | Owner accepts October15 observational outputs despite forbidden sandbox_exec/off procedure; not compliant execution, independent Cloud verification or retrospective authorization. |
| REQUIRES FURTHER EVIDENCE | First canonical predecessor installed body/ACL/security, then only demonstrated direct delegates; deployed producer and external caller behavior if still decisive; exact project/environment attestation and bodies of any relevant unreturned trigger dependencies. |
| NOT AUTHORIZED / NOT EXECUTED | No further sandbox_exec use, re-query, privileges, gameplay mutations, correction, deployment or G3; Codex executed no hosted calls. No G2B compliance PASS or E13 closure. |

**Precise remaining question:** does the installed node_tick_commit_without_character_stances chain perform a contract-target/event-bound completion/count transition or contract-specific bonus, or does it only reach ordinary kill reward/progression writers? The current outputs prove only the outer direct edge, not its implementation.

Recommended next bounded task: prepare a continuation metadata request for **that one exact seven-argument predecessor** under an explicitly permitted read-only inspection role with transaction_read_only=on. Record why this edge is required before any request; expand one proven direct dependency at a time, reusing existing evidence rather than scanning function prefixes or using legacy v3 as a speculative substitute. If the complete observed chain still has no contract producer, separately reconcile deployed worker identity and known external completion callers before proposing a gameplay correction. Current task does not execute or authorize that continuation. No need for player/contract/reward rows or gameplay calls.

## Preservation, validation and publication

Project-state/roadmap/idea register and prior closures unchanged. Four OPEN progression F limitations, restricted legacy/v3→v2 uncertainty, accepted Combat1 and metadata/concurrency gaps, and OPEN deferred ENG-LEGACY-001F-R3-RETRY preserved. Administrative XP grants remain paused; normal gameplay XP earning is not intentionally disabled or runtime-established here.

Publication includes this reconciled report, five original archives and the minimal archival-byte .gitattributes rule only. No source, SQL implementation, migration/history, privileges, scheduler, gameplay or deployment changes. Validate original/archive/staged-byte identity, JSON structure, statement-plan byte matches, fingerprints, references, state synchronization/tests and whitespace. Supplied SQL files stay under docs/operations as inert evidence; never run or install them. Recovery stash unchanged; stop for owner review.

Executed local validation: five archives byte-identical to owner originals; both statement files byte-identical to G2A snippets; nine unique target records/eight present definitions/13 trigger records validated;16 definition/body fingerprints recomputed and matched;17 repository links valid;3 project-state tests PASS; JSON/Markdown synchronized unchanged; whitespace passed. Source snapshot synchronized to befe7b64801c76d8cd7c1808d9be0c2ca39133db. No hosted query or database execution occurred during reconciliation.
