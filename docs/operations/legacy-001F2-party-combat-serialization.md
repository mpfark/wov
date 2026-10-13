# ENG-LEGACY-001F2 — Party / Combat2 serialization

Classification: **CONCRETE SOURCE GAP**. Local source only, baseline 24df5db3688cf429e8eb7033e8d74104bb80d9c8. Parties IN PROGRESS; parent OPEN. No correction, hosted execution or publication. F1 remains locally prepared.

## Evidence and scope

Reuses [F1](legacy-001F1-parties-writer-map.md), [B writer chain](legacy-001B-combat2-writer-chain.md) and [movement/departure audit](../design/combat2-movement-departure-audit.md). Relevant engine rules are party following, node-presence participation and atomic authoritative movement; this report changes none of them. Historical migration files below establish source composition, not a new runner route or permission to replay migrations. Existing installed movement/B evidence is reused; current party/entry composed definitions and effective hosted authority have not been freshly verified.

## Lock and transaction map

| Boundary | Source order and scope | Guarantee / limit |
|---|---|---|
| party_mutate | Transaction advisory party-lifecycle → UUID request lookup/insert → owned actor FOR UPDATE → party FOR UPDATE for non-accept branches → membership rows. All writes/result in one RPC transaction; exception block rolls back its work. | Serializes supported party mutations against each other and coordinated departure. No node/encounter lock; no lock in combat predicate. Accept locks its pending membership but does not lock the party row. Request replay binds payload; no separate request advisory lock here. |
| accept | Actor → pending membership FOR UPDATE → combat predicate over accepted members plus actor → membership UPDATE | Own actor lock does not serialize another accepted member entering combat. |
| leave / kick / disband | Actor → party FOR UPDATE → combat predicate → own/target member FOR UPDATE or bulk member DELETE → party delete | Some FK/child locks may delay writes, but there is no combat-predicate recheck after such a wait. Do not assume every possible entry interleaving succeeds: a new arrival-group FK takes party KEY SHARE and can block behind party FOR UPDATE. |
| follow / stop_following | Actor → party → own accepted membership FOR UPDATE → combat predicate → following flag UPDATE | Self status mutation serialized with coordinated mover derivation. Actor lock is not a freeze of all other accepted members' entry. |
| combat_enter | Public engagement gate → canary gate → persistent entry body: node advisory → encounter FOR UPDATE → accepted-party read → arrival group → fighter FOR UPDATE / INSERT → event and encounter version/claim invalidation | No party-lifecycle lock or explicit character FOR UPDATE in the preserved entry body. Lifecycle child trigger takes character KEY SHARE; this may wait on actor locks but is not a combat membership guard. |
| hostile action | Node advisory → preserved entry → intent in a subtransaction | Entry and intent atomic; does not add a party mutation boundary. |
| node_tick_claim | Canary/boss/stance wrappers → encounter FOR UPDATE SKIP LOCKED (no node advisory established in these claim wrappers) → lease/token/cutoff and snapshot | Claim transaction ends before worker resolves/commits. Lease is not a held row lock across worker execution. Party predicate checks existing fighter/lease state, but does not lock its establishment. |
| combat2_party_depart | Sorted origin/destination node advisories → party-lifecycle/request advisory → sorted encounter pair → frozen mover characters UUID order → fighter/request/effects | Supported membership/follow mutations cannot change frozen mover set during coordinated departure. Immediate finalizer runs within same outer transaction; follower movement order distinct from lock order. |
| solo departure / arrival | Sorted node pair → encounters/character/departure state; relocation trigger enters destination with node lock reentrant, character already held, destination encounter/fighter | Solo departure does not establish the global party boundary. Trigger-only arrival requires movement marker, takes character FOR UPDATE and reads accepted membership; source child fence does not enforce combat membership. |

Exact sources (repository-relative, lines at this checkpoint):

- [Party lifecycle](../../supabase/migrations/20260908101012_50a06710-aefe-4487-a7ed-f0c2e5858ab2.sql):19–32 predicate;35–85 request/actor/accept;96–163 party lock, guard, leave/kick/disband. Follow patch [September follow/departure](../../supabase/migrations/20260908122530_e728cbda-72d0-415c-96bf-a8758fe327ac.sql):18–27; original departure90–169 is subsequently composed, not final lock order.
- [Persistent entry and arrival-group FK](../../supabase/migrations/20260902093129_6e2ff6de-db65-4d4d-83e1-dadcfebaa70c.sql):4–15 group party FK ON DELETE SET NULL;157–235 entry. The August entry is superseded by this body. [Canary wrappers](../../supabase/migrations/20260909210000_combat2_node_canary_control.sql):63–100; [engagement gate](../../supabase/migrations/20260922140000_combat2_engagement_release_lifecycle.sql):13–56.
- [Arrival/global lock composition](../../supabase/migrations/20260928100000_combat2_authoritative_arrival_hostile_initiation.sql):148–270 trigger-only entry,307–387 movement/commit wrappers; claim-chain metadata guards at94–142 do not introduce a claim node lock;421–505 hostile action. [Immediate departure](../../supabase/migrations/20260929100000_combat2_immediate_authoritative_departure.sql):53–205 party predecessor guard/composition,210–286 solo finalizer,308–359 party finalizer/wrapper.
- [Historical claim base](../../supabase/migrations/20260830064542_10f5dc3d-4931-4a0d-8fd9-2c7faa7bb412.sql):20–49 encounter/lease;67–96 current membership and entry provenance snapshot (later tank/snapshot composition is reused from B; no reward or tank audit repeated). [Stance wrapper](../../supabase/migrations/20261001130000_combat2_character_persistent_stances.sql):394–412 delegates claim, does not lock party lifecycle. B's installed stance commit correction does not change this party boundary.
- [Lifecycle cutover](progression-001G-C2-integrated-cutover.sql):489–528 child fence checks deleted_at under character FOR KEY SHARE, including party_members/node_fighter. It neither rechecks combat predicate nor freezes membership on fighter insertion.
- [Table authority](../../supabase/migrations/20260908112320_21e93e42-d887-4725-83f3-95379c287b76.sql): browser read-only versus retained service DML. Effective current hosted ACLs remain outside this task.

## Concrete interleaving

Use living invitation recipient A and accepted member B of party P, neither presently in combat; B is at a valid node with eligible creatures. No active fighter or pending departure/live claim blocks P initially. These are ordinary owner RPC calls, not raw service writes.

1. T1: A calls accept. Holds lifecycle advisory, A character FOR UPDATE and A's pending membership FOR UPDATE. Its combat predicate returns false.
2. Pause T1 before status UPDATE. T2: B calls permitted combat entry/hostile action. Takes node advisory and encounter lock, reads B's committed accepted membership P, inserts/reuses arrival group and fighter, commits. T1 has not locked P or B; arrival-group party KEY SHARE is compatible with this situation. Character child fence concerns B, not locked A. No shared lifecycle advisory blocks T2.
3. T1 resumes, accepts A, records success and commits without rechecking combat state. P now gained an accepted member while B is present in an active encounter, despite the explicit combat_active refusal policy.

No malformed input, privileged bypass or unusual isolation is needed for this schedule at normal READ COMMITTED. It establishes failure of the intended combat-active membership freeze, not proof of wrong rewards/damage or hosted exploitation. It does not change B's identity/presence. A claim can also be established after step2 while T1 is paused; the lease predicate is then stale. This is the same entry-first gap, not an independently proved claim-only exploit.

A more destructive kick/disband schedule needs attention to actual FK locks and existing arrival groups; it is unnecessary to establish the boundary classification and is not claimed reproduced. Leave/follow/stop_following share actor and party locks, but another member's entry is not universally fenced. No blanket assertion that every operation is unsafe or all different locks imply defects.

## Safe boundaries and consequences

Coordinated departure and party mutation share the global advisory for their complete transaction: either membership changes first and departure derives the new set, or departure freezes/revalidates its set first and mutation waits. Immediate release/arrival remains atomic, preserving claim invalidation and follower-before-leader relocation. Entry/departure share node serialization; claim holds the encounter row independently. Neither boundary protects party_mutate because it acquires no node/encounter locks. Raw service DML and retained service predecessors may skip these supported boundaries; unknown callers remain an authority limitation, not evidence of a browser exploit.

## Smallest next step

Prepare a narrowly scoped installed-definition/trigger parity check before authorizing a correction: party_mutate with follow patch, predicate, preserved entry chain, arrival/claim wrappers, departure composition and relevant FK/child trigger bindings; metadata only, no gameplay rows or probes. No new hosted request was executed or SQL authored here.

Correction candidate: make membership guard and write share affected nodes' serialization with entry and affected encounter row locks with claim, acquiring sorted node advisories **before** lifecycle, character and membership locks, then acquire affected encounters in deterministic order before character/membership rows and revalidate the discovered party/member/node set. If discovery changes, abort/retry rather than acquire new nodes after lifecycle. Include invite recipient and all affected accepted members, including off-node members. This preserves the existing node-first movement hierarchy and avoids adding lifecycle acquisition inside arrival while it already holds characters. It needs a bounded design and two-session regression fixture before implementation; merely adding a lock inside the predicate would create lifecycle/character→node inversion against node→lifecycle departure. Alternatives require the same lock-graph proof; no fix authorized in F2.

Parties should remain IN PROGRESS pending disposition of this concrete source gap. The independent F1 malformed-response retry-UUID weakness remains a separate correction candidate; no API changes made. Hosted parity, isolation and independent-session behavior remain unverified. Prior closures, all four OPEN progression F limitations, privileged delegation uncertainty and accepted risks are preserved. Administrative XP grants remain paused; normal gameplay XP earning is not intentionally disabled by that policy and is not verified here.

## Validation

Documentation/state-only checks recorded in the task report; no SQL execution or concurrency proof. F1 work and recovery stash preserved. No commit or push.
