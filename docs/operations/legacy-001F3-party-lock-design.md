# ENG-LEGACY-001F3 — Installed parity and party lock design

Preparation only, baseline 24df5db3688cf429e8eb7033e8d74104bb80d9c8. Parties IN PROGRESS; ENG-LEGACY-001 OPEN. Reuses [F1](legacy-001F1-parties-writer-map.md), [F2](legacy-001F2-party-combat-serialization.md), [Combat2 B](legacy-001B-combat2-writer-chain.md) and [movement evidence](../design/combat2-movement-departure-audit.md). No correction or hosted verification performed. Engine party-following, node-presence participation, atomic movement and last-man-in tank rules are preserved.

## Effective source composition

Names below are exact source signatures; hosted parity is a prerequisite, not inferred from files.

| Public boundary | Effective chain / construction |
|---|---|
| party_mutate(uuid,text,uuid,uuid,uuid,uuid) | September8 lifecycle body + same-day follow/stop_following dynamic insertion; September browser-table ACL contract. Calls party_combat_mutation_blocked(uuid,uuid), party_operation_finish(uuid,jsonb). Global lifecycle → request → actor → party/member; accept bypasses party row lock. |
| party_combat_mutation_blocked(uuid,uuid) | SQL STABLE predicate: accepted members plus extra recipient; present active fighter OR pending departure OR active encounter/live claim for an affected fighter, even absent. No locking. |
| combat_enter(uuid,uuid) | Engagement gate → combat_enter_without_engagement_gate(uuid,uuid) (canary wrapper) → combat_enter_without_canary_gate(uuid,uuid) (September2 persistent entry). Node advisory → encounter → group/fighter/child trigger. Public gate does not change locking. |
| combat2_hostile_action(uuid,text,text,uuid,uuid) | Node advisory → same preserved entry chain → combat_intent; no party lifecycle acquisition. Failure subtransaction undoes entry/intent work. |
| node_tick_claim(uuid,integer) | October stance wrapper → node_tick_claim_without_character_stances(uuid,integer) (boss timing wrapper) → node_tick_claim_without_boss_timing(uuid,integer) (canary wrapper) → node_tick_claim_without_canary_gate(uuid,integer) (snapshot/lease body). Encounter FOR UPDATE SKIP LOCKED, no node lock established in these wrappers. |
| combat2_party_depart(uuid,uuid,uuid) | Immediate wrapper → combat2_party_depart_without_immediate_transition(uuid,uuid,uuid) (sorted-node public wrapper) → combat2_party_depart_without_canary_gate(uuid,uuid,uuid) (patched party implementation). Queued/already_queued success → combat2_finish_immediate_party_departure(uuid) → child combat2_finish_immediate_departure(uuid). Same transaction throughout. |
| combat2_depart(uuid,uuid,uuid) | Immediate wrapper → combat2_depart_without_immediate_transition(uuid,uuid,uuid) (sorted-node wrapper) → combat2_depart_without_canary_gate(uuid,uuid,uuid); queued result → solo immediate finalizer. No global party lock. |
| Arrival / lifecycle | characters AFTER UPDATE OF current_node_id → combat2_authoritative_arrival_trigger() → marker-gated combat2_arrive_after_relocation(uuid,uuid). Child fences on party_members and node_fighter etc → character_lifecycle_child_fence(): character KEY SHARE and deleted_at checks. Departure status trigger → combat2_party_departure_finalize(). |

Source reconstruction references: [party body](../../supabase/migrations/20260908101012_50a06710-aefe-4487-a7ed-f0c2e5858ab2.sql):19–163; [follow and original departure](../../supabase/migrations/20260908122530_e728cbda-72d0-415c-96bf-a8758fe327ac.sql):18–27,90–169; [persistent entry/group/party triggers](../../supabase/migrations/20260902093129_6e2ff6de-db65-4d4d-83e1-dadcfebaa70c.sql):4–15,87–118,156–235; [canary renames](../../supabase/migrations/20260909210000_combat2_node_canary_control.sql):63–140; [engagement gate](../../supabase/migrations/20260922140000_combat2_engagement_release_lifecycle.sql):13–56; [arrival/movement](../../supabase/migrations/20260928100000_combat2_authoritative_arrival_hostile_initiation.sql):147–304,310–387,423–505; [immediate patch/finalizers](../../supabase/migrations/20260929100000_combat2_immediate_authoritative_departure.sql):53–205,210–359; [stance claim wrapper](../../supabase/migrations/20261001130000_combat2_character_persistent_stances.sql):391–412; [installed C2 lifecycle](../../drizzle/migrations/0013_progression_001g_c2_reset_and_cutover.sql):725–768.

Claim snapshot composition also includes guarded September2/3 arrival-group/tank projection, September5 Arena projection and September7 ability closure, then boss/stance wrappers. These alter snapshot content, not a new party lock. See [September3 projection](../../supabase/migrations/20260903061136_4c6938e6-7905-44c5-8a1c-ab1a56a823e4.sql), [Arena projection](../../supabase/migrations/20260905223641_ab9fdebc-0a3a-4b6a-a0a3-b99b944953a8.sql):133–148, [ability projection](../../supabase/migrations/20260907200000_combat2_final_ability_closure.sql):30–49 and [boss wrapper](../../supabase/migrations/20260914110000_combat2_boss_tick_timing.sql):29–52. September28 guards existing tank projection rather than supplying a party synchronization lock. Full installed definitions must be compared to this rename/patch chain; hashing an uncomposed historical body is not a parity test.

## Recommended minimal correction boundary

Change only party_mutate's preparation/locking before its existing protected operations: accept, leave, kick, follow, stop_following, disband (and existing combat-guarded set_tank so it cannot acquire encounters late through tank triggers). Preserve tank metadata behavior; never substitute party tank for Combat2 last-man-in selection. No new tables or Combat2 writer changes proposed.

1. Preserve auth/shape and existing UUID payload binding/replay. A visible completed prior request may return its original bound result without current-state discovery; never apply current combat eligibility to an already committed replay. Recheck the ledger under lifecycle before any new mutation. No new UUID/retry API design in this task.
2. Perform **unlocked discovery only**, with no ledger INSERT, actor lock or lifecycle lock yet. For accept resolve the exact pending membership's party from its ID and actor; for other operations use supplied party plus authenticated actor. Capture all accepted member identities and current nodes, actor/recipient, relevant pending departure references, all encounters referenced by affected fighter rows, and active arrival groups of the party (tank-trigger dependencies). Include off-node members; never only the actor/leader node. Do not disclose discovered state to unauthorized callers.
3. Take deduplicated node advisory locks sorted by UUID using the existing combat_enter_node:<uuid> namespace: all captured character nodes plus nodes of referenced encounters/groups. Then global party-lifecycle. Re-discover; if required nodes/party/member identities changed, refuse before new mutation. **No late node acquisition**. A retry starts a new transaction; do not spin while retaining old locks. Existing failure JSON envelope remains; precise retryable kind must be checked against client decoder during implementation without repairing F1's independent malformed-response issue.
4. Lock the captured relevant encounter rows by encounter UUID, **including non-present fighter references and active group dependencies**, not just current node's active encounter. Lock existing rows even if presently ended where the selected node may reactivate. Node locks protect the absent-encounter case against supported entry creating one. Re-discover/revalidate coverage after waits; abort on a new required encounter rather than lock it out of order. Claim obtains encounter rows without node advisories, so node locks alone are insufficient.
5. With node/lifecycle/encounter boundary held, proceed to existing request ledger and actor/party/member locks. Hold affected character rows required by child/party FKs in deterministic UUID order before member DML; preserve original actor ownership/liveness check and result contract. The exact row mode should retain original FOR UPDATE semantics for this slice. Revalidate nodes/lifecycle/member set after waits; check the existing combat predicate immediately before mutation. No extra participant or reward eligibility rules.
6. Run original mutation and result write; transaction commit/rollback releases all locks. Refusal must not leave partial membership, following, tank or receipt writes. Preserve existing replay outcomes for wrong UUID payload and historical success.

This is an optimistic discovery + locked revalidation design. Global lifecycle freezes supported membership after discovery is confirmed; node locks prevent new entry or relocation; encounter locks prevent a claim from appearing between guard and write. No phantom protection is claimed for arbitrary raw service DML bypassing these boundaries.

## Lock order and compatibility

| Path | Required order / conclusion |
|---|---|
| Proposed protected party mutation | unlocked discovery → sorted nodes → lifecycle → sorted encounters → request / UUID-ordered required characters → party/member rows → existing trigger effects; all retained to transaction end |
| Coordinated departure | sorted nodes → lifecycle/request → sorted encounter pair → UUID mover characters → child state. Common hierarchy; no lifecycle→new-node path. Membership changes first or mover set freezes first. |
| Solo movement / arrival | sorted node pair → encounter/character → destination trigger with already-held node locks. Proposed mutation waits on nodes before holding lifecycle/characters; movement need not acquire lifecycle to serialize entry. No change to arrival trigger proposed. |
| Claim | encounter only → lease/snapshot; mutation waits for claim before character locks and then sees live lease, or claim skips locked encounter. No node-after-encounter acquisition in inspected claim chain. |
| Commit / OOC | Reuse B/movement UUID character order and node/encounter before character when applicable. OOC takes characters in UUID order without subsequently acquiring encounters. Do not add an encounter lock inside a character child fence. |
| Party tank / FK effects | September2 tank_changed traverses active groups, writes encounter version/claim state and refreshes tanks; must already cover these encounters before character/party locks. Metadata must confirm current body/binding (tank-selection source has since changed). Arrival-group FK can take party KEY SHARE; existing party FOR UPDATE delays it but is not a substitute for the guard. |

Hazards to resolve from parity: extra trigger writes/encounter acquisition beyond the captured set; entry/claim taking a new lifecycle/node lock after a character/encounter lock; configuration of isolation stronger than READ COMMITTED; unrecognized predecessor composition. These are **stop conditions**, not assumed safe. Relevant body/trigger visibility is required. Ordinary request isolation is not proven by observing only a read-only metadata session; test READ COMMITTED fixture and record API isolation uncertainty separately.

The narrow design can proceed after parity passes and local two-session tests establish this graph. If an extra dependency is found, stop for bounded adjustment; do not silently change Combat2, triggers, tank rules or privilege scope. Retained raw service mutation capability/external callers remain outside the supported-RPC guarantee and require explicit later disposition, not an exploit claim.

## Focused regression plan (future implementation, not executed)

Use an isolated PostgreSQL fixture with actual entry/claim/movement and lifecycle/FK triggers, two independent connections and barrier hooks in test copies only. Assert blocking/skip and final database state, not elapsed time alone. No production characters.

- Reproduce F2: pause old accept after false predicate; B enters/commits; resume accepts. Fixture verifies the source violation.
- Corrected mutation-first: pause after locked false predicate; B entry cannot commit until mutation completes. Then entry sees the accepted membership; no mid-write entry.
- Entry-first: B enters before acquisition; acceptance returns combat_active, pending membership/result semantics preserved; no partial acceptance.
- Claim-first: lease established on affected present or historical absent fighter; mutation refuses. Mutation-first: claim skips locked encounter, or runs afterward against committed membership; no guard/lease window.
- Different nodes: A recipient and multiple accepted members at separate nodes; entry at every covered node blocked. Reversed routes and overlapping party requests obey sorted order. New/moved member or changed node between discovery and lifecycle causes bounded refusal, no late lock, no write.
- Leave/kick/disband/follow/stop_following and guarded tank metadata: existing successful/refusal behavior; departure-first/mutation-first mover sets; solo relocation/arrival and death/departure clears preserve identity/follow semantics.
- Active arrival group at a former node; child lifecycle fence and party/tank triggers active: no late encounter lock, no tank algorithm change.
- Exact completed UUID replay during combat remains original success; conflicting UUID denied; injected failure rolls back all request/member/tank effects. Malformed-response caller UUID weakness remains a separate test/correction candidate.

These are planned concurrency tests, not runtime or installed behavior evidence. Existing focused party/state tests only validate the current client contract and documentation baseline.

## Evidence request and status

[SELECT-only parity SQL](legacy-001F3-party-parity.sql) and [Lovable handoff](legacy-001F3-party-parity-handoff.md) provide one statement snapshot, exact definitions, fingerprints, direct/effective ACLs, bound trigger bodies and relevant constraints/indexes/RLS. No gameplay data or function invocation. No fresh migration history request: installed B/C2 evidence is reused and correction would follow the existing reviewed-SQL-outside-migrations Lovable workflow after separate authorization. Never replay historical Supabase files or register an alternate runner.

Ready for **hosted metadata parity**, not correction implementation or installation yet. No new owner gameplay policy needed; authority/trigger drift could require a bounded decision. F1 retry issue independent. All prior closures and four OPEN progression limitations retained. Administrative XP grants remain paused; normal gameplay XP earning is not intentionally disabled by this policy and is not established here. Recovery stash preserved.

## Local validation result

13 existing tests passed (party API7, party UI contract3, project-state3). Project-state JSON/Markdown synchronized;21 F3 documentation links valid; static checks confirm one metadata SELECT, no mutation statements or public gameplay-row reads; whitespace checks passed. SQL was not executed. No implementation/concurrency test result inferred from these checks.
