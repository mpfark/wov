# ENG-LEGACY-001G2C — Contract delegate evidence gate

2026-10-15; source0c567e13b5a4551c0ca1c6b024e9c6007b9b38e0. Local repository/evidence review only. No hosted connection, query, gameplay, SQL change or G3. Only this report is created; authoritative state/roadmap/idea register unchanged. Parent ENG-LEGACY-001 and E13 transfer remain OPEN.

## Decision

**Existing approved evidence is sufficient to identify the exact wrapper body and establish historical installed parity. A new metadata request is not needed merely to recover this definition.** G2B correctly says the body is absent from its October15 out1; that does not mean it is absent from the repository's earlier installed evidence. This report supplements, rather than rewrites, G2B.

The wrapper has no direct Assassin contract completion, contract-state update, completion event or contract-specific reward calculation. It acquires sorted node advisory locks and delegates the proposal unchanged. **This is not proof that its downstream chain cannot complete a contract**, nor fresh proof of current installed/deployed behavior. Historical parity and complete transitive behavior are different questions.

## Exact identity and reconstructed source

`public.node_tick_commit_without_character_stances(uuid,uuid,integer,integer,bigint,uuid[],jsonb) RETURNS jsonb`.

The complete [archived installed definition](progression-001D-evidence/node_tick_commit_without_character_stances.sql) includes PL/pgSQL SECURITY DEFINER and search_path public,pg_temp. Its body is exactly the [September28 arrival wrapper](../../supabase/migrations/20260928100000_combat2_authoritative_arrival_hostile_initiation.sql)361–384, renamed by [October stance source](../../supabase/migrations/20261001130000_combat2_character_persistent_stances.sql)415. The duplicate generated historical Supabase artifact preserves that rename as well. Readable body reproduction below is **evidence text, not correction or installation SQL**; the linked original, including surrounding body newlines, remains the byte/hash authority:

```text
DECLARE locked_node uuid;
BEGIN
  FOR locked_node IN
    SELECT node_id FROM (
      SELECT e.node_id FROM public.node_encounter e WHERE e.id=_encounter_id
      UNION
      SELECT (departure->>'destination_node_id')::uuid
      FROM jsonb_array_elements(COALESCE(_proposed->'departures','[]'::jsonb)) departure
      WHERE departure->>'outcome'='moved'
    ) nodes WHERE node_id IS NOT NULL ORDER BY node_id
  LOOP
    PERFORM pg_advisory_xact_lock(hashtextextended('combat_enter_node:'||locked_node::text,0));
  END LOOP;
  RETURN public.node_tick_commit_without_authoritative_arrival(
    _encounter_id,_claim_token,_candidate_tick,_expected_last_tick,
    _expected_state_version,_intent_ids,_proposed);
END;
```

No later CREATE/REPLACE of this exact delegate was found in source-controlled migration SQL. [0002](../../drizzle/migrations/0002_progression_001d_canonical_xp_cutover.sql) guards its definition and restricts predecessor authority; it replaces the deeper without_bounded_failure body, **not this wrapper**. [0017](../../drizzle/migrations/0017_legacy_001b3_stance_encounter_guard.sql) guards the delegate but patches only the outer node_tick_commit. Source searches cannot exclude out-of-band hosted changes; no such change is alleged.

### Exact local identities and hash domains

| Artifact / hash domain | Recomputed value |
|---|---|
| Canonical Git blob bytes for archived definition | 1068 |
| Exact archived pg_get_functiondef UTF8 bytes SHA-256 | ed8eea68390aa9f910fdbe6b4905d9c41c586c23e3035c3893b5a1afddacb6a6 |
| prosrc body CRLF→LF only, no trimming, SHA-256 | f85c74a47f56a2a3c84b40cc420e941c59de7096656a8d32dcfb1270e80d5bb0 |
| Full definition CRLF→LF then whitespace collapse, no trimming, SHA-256 | 04257a7eebcc79ad4782ab5ce9e016984ba9b24682f56fbe70f41a37b4250b75 |

All recomputed from canonical Git evidence; arrival-source extracted body also matches exactly after CRLF→LF. These hashes represent different serializations and must not be substituted for one another. The first two are directly linked by the archived definition/body; neither is the outer node_tick_commit fingerprint fb533882… from G2B/B5.

## Existing installed evidence and authority boundaries

| Evidence | What it establishes | Limits |
|---|---|---|
| [001D export README](progression-001D-evidence/README.md), [validation handoff](progression-001D-validation-handoff.md) | Operator-supplied full exports from2026-10-06 12:17:05–12:17:15UTC, source b3950cbb52f25c75242ec9f99a1ffc56b9adc722. Exact1068 bytes/ed8eea hash; supplied owner postgres, public,jsonb,DEFINER and public,pg_temp. The definition itself encodes signature/security/settings, not ownership. | README identifies historical sandbox_exec inspection. Reused as existing accepted Progression evidence, not proof it complied with later G2A safety policy or retrospective authorization of that role. No such role/connection used now. |
| Installed-source0002 guard and [001D closure](progression-001D-closure.md) | Before applying reviewed canonical XP change, checks full installed definition hash ed8eea plus postgres owner/DEFINER; recorded successful installation supports parity at that operation. Predecessor direct rights contained owner-only under that source's ACL loop. | Source guard alone is not execution proof; closure's supplied installation evidence is the execution claim. Historical ACL state, not fresh current permission readback. |
| [B4 criteria](legacy-001B4-stance-guard-preflight.md), [B6 installation reconciliation](legacy-001B6-combat2-closeout.md) and0017 | B4 expects PL/pgSQL and f85c74 LF-only body;0017 requires exactly that body, postgres, volatile/jsonb/DEFINER and public,pg_temp before outer patch. B4 PASS/B5 successful installation and unchanged direct-predecessor fingerprint are owner-supplied evidence accepted in B6. | B6 recording date2026-10-12 is not an invented precise hosted observation time; raw B4/B5 outputs not archived there. It does not claim runtime/concurrency proof. |
| [G2B October15 conditional outputs](legacy-001G2B-contract-hosted-parity.md) | Current outer node_tick_commit's supplied definition directly calls this exact delegate. Resolves the need to inspect its identity; combines coherently with earlier definition. | No body/ACL row for this delegate in out1. sandbox_exec/off deviation remains noncompliant and conditionally observational only; not fresh delegate parity. |

No general ACL audit was repeated. SECURITY DEFINER means the wrapper's delegated call is not assessed as ordinary browser direct EXECUTE. A historical owner-only direct grant does not prevent an authorized definer caller from delegating. October stance source initially grants service_role to the predecessor, but later0002 containment and B4/B5 evidence supersede that historical grant for their observed scope. No current effective grant is guessed.

## Dependency and completion findings

| Direct operation in recovered body | Source/archived-definition finding |
|---|---|
| SELECT node_encounter.node_id and moved departure destination IDs | Reads encounter/proposal data, not active_contract or contracts_completed. Does not identify an eligible Assassin or validate a contract kill. |
| pg_advisory_xact_lock(hashtextextended(...)) in sorted node order | Transaction-scoped locking side effect; no persisted contract/reward write or completion event. Does not itself implement claim/tick replay or reward eligibility. |
| public.node_tick_commit_without_authoritative_arrival(same seven arguments) | The **only named public function call in the body**. Entire _proposed is passed onward unchanged, so this wrapper neither produces a contract proposal nor proves downstream cannot consume one. |

There is no apply_contract_complete call, active_contract/contracts_completed reference, contract_complete event, contract UUID/mark comparison, direct character UPDATE or XP/RP/gold/item calculation. This negative statement is limited to the full recovered wrapper definition. PostgreSQL's advisory-lock built-ins are not reward delegates.

Local named continuation already identified by [G2/G2A](legacy-001G2-assassin-contract-authority.md) is without_authoritative_arrival → without_boss_timing → without_bounded_failure → ordinary reward claim/progression/gold. The [001D evidence index](progression-001D-evidence/README.md) also archives these exact downstream definitions;0002 subsequently replaces the terminal body. This makes **existing-evidence reconciliation** the next step before another hosted request, not a fresh broad Combat2/Progression investigation. This report does not certify the whole downstream chain or re-audit it. No transitive contract-specific payout or deployed worker producer is newly proved.

## Remaining evidence gate and minimal-request decision

For this **exact wrapper**, historical approved parity is established at the export/guarded-installation windows. Fresh October15/current parity is unobserved. No later named source replacement was located, but source continuity does not prove no unrecorded hosted change. Reusing existing parity is sufficient for a bounded source/evidence disposition with that explicit time limit; it is not silent owner acceptance of current-state certainty.

**No new metadata SQL is prepared in G2C:** requesting this same definition merely to recover already archived behavior would duplicate evidence. The prior G2B “first missing body” recommendation can now be narrowed by this discovery without changing its raw October15 observation. If the owner explicitly requires a fresh delegate identity/ACL observation rather than historical parity reuse, that is a separate freshness decision, not an automatic prerequisite or permission to run a query. A future request would cover only this exact signature with the G2A metadata fields, not a prefix scan. No query should be executed now.

Any future hosted verification must first have an explicitly permitted read-only role and transaction_read_only=on independently established. Do not use sandbox_exec, its aliases, another forbidden execution role, a role switch or an off connection, including for a “safety probe.” If the authorized read-only capability is unavailable, stop. Historical evidence reuse does not authorize repeat of the recorded procedure.

## G2 disposition and recommended next action

**Partial disposition supported:** this wrapper is a legitimate node-lock/delegation boundary, with no direct contract-completion implementation in its source/archived installed body. This resolves the narrow missing-definition question at the documented historical evidence level. No demonstrated new authority conflict or correction is established here.

**G2/E13 completion finding remains unresolved.** This wrapper alone cannot prove or disprove transitive completion, contract-specific rewards, deployed-worker behavior or external/dynamic callers. Non-atomic re-roll, unbound trusted completion helper and the missing located canonical producer remain G2 findings. G2 can be dispositioned with explicit limitations only if the owner separately accepts those precise remaining gaps; this report does not supply that acceptance, close E13 or alter project status.

Recommended smallest next task: bounded **G2D existing-evidence reconciliation of node_tick_commit_without_authoritative_arrival** and its named continuation, starting from the archived001D definitions and later targeted migration replacements. Stop at the first genuinely missing parity/provenance edge; only then propose one exact permitted metadata request if needed. No need to query this wrapper again merely because October15's initial list omitted it. Do not begin G2D, G3, contract redesign, reward tuning or a generalized audit automatically.

All previous closures, accepted privileged v3→v2/Combat1/visibility/concurrency limits and OPEN deferred ENG-LEGACY-001F-R3-RETRY persist. All four progression F limitations remain OPEN. Administrative XP grants remain paused; normal gameplay XP earning is not intentionally disabled or runtime-established by this report.

## Local validation and publication boundary

Only this report is authored. Preserve original SQL/evidence, project-state/generated Markdown, roadmap/idea register, migrations/history and recovery stash. Validate real references, exact archived hashes/body reconstruction, absence of direct contract logic at this boundary, project-state synchronization/tests and whitespace. No database parsing/execution, hosted request, gameplay probe, deployment or frontend publication. Documentation publication is not new audit/runtime authorization; await owner review.

Executed local validation:13 repository links valid;1068-byte canonical archive and all three hash domains verified; source arrival body exactly matches archived body; sole named public delegate and absence of direct contract logic statically checked;3 project-state tests PASS; JSON/Markdown synchronized unchanged. No SQL/hosted/runtime execution. Only this new report pending; recovery stash unchanged.
