# ENG-LEGACY-001F10A — Fixture and caller readiness

Historical preparation record. Later owner-supplied hosted smoke and cleanup results are reconciled in [F11](legacy-001F11-evidence-and-closure-assessment.md). Missing fixture/caller prerequisites below describe F10A's earlier planning checkpoint; no actual identifiers or raw transcripts were supplied for reconstruction here.

Local source inspection only at46cbfb4a16fd91c55a5b563917bc83c34ed37d6c. No hosted reads, login, creation, movement, party calls or combat executed. [F10 plan](legacy-001F10-runtime-smoke-plan.md) remains NOT EXECUTED. Parties IN PROGRESS; parent OPEN. Engine rules and roadmap scope unchanged.

## Supported creation

[Index](../../src/pages/Index.tsx) renders the existing CharacterCreation flow and selects the returned character. [useCharacter](../../src/features/character/hooks/useCharacter.ts), createCharacter, requires the signed-in owner and rejects delegated targets in this player flow. [creation-client](../../src/features/character/creation-client.ts) calls character_create_c2 with choices, pinned revision and persisted creation request UUID; character_creation_capacity returns retained/limit5. The [creation authority](progression-001G-C2-P2-A-creation-authority.sql) counts all account characters, including soft-deleted ones, before insertion.

Three disposable characters are supported without application changes: A on dedicated test account U1, B/C on dedicated test account U2, provided capacities have at least1 and2 free slots respectively. A third test account is also valid. Existing explicitly designated disposable characters may avoid creation. Do not use the owner's protected-character account as an assumed fixture, bypass quotas, purge slots or use legacy creation. Actual capacity, names, account access and successful creation are NOT established locally. Account registration, if needed, is separate setup authorization. New characters start at the canonical starting node; reaching a different nominated node requires separately approved normal movement.

## Exact authenticated caller

[party-api](../../src/features/party/party-api.ts), createPartyApi().mutate, forwards all six fields directly to party_mutate using the application's ordinary authenticated Supabase client. No service role or auth.uid impersonation is required. The existing UI does not provide a user-editable request UUID; do not assume a second click is an exact replay.

An executable caller option needing no source changes is the existing Vite development application (`npm run dev`): sign into the dedicated test account on that local application origin, then use its browser console module loader:

```js
const { createPartyApi } = await import('/src/features/party/party-api.ts');
const f10Api = createPartyApi();
// Populate from the approved manifest and invitation response before dispatch.
// Values below are variable names, NOT invented UUIDs.
const acceptance = Object.freeze({
  actorCharacterId: memberCharacterId, operation: 'accept',
  partyId: null, targetCharacterId: null,
  membershipId: invitationMembershipId, requestId: crypto.randomUUID()
});
// Record only this non-secret payload before any separately authorized call.
// Initial acceptance: await f10Api.mutate(acceptance)
// Exact replay:       await f10Api.mutate(acceptance)
```

The SDK obtains the logged-in session internally. Do not inspect/copy authentication storage, JWTs, request headers, credentials or HAR exports. This is a proposed execution procedure, not a caller run in F10A. Before use, confirm the local application's configured destination is the intended project, the module loads, and the signed-in account is the approved owner. No assumption that production exposes window.supabase or supports development imports. If that ordinary authenticated local caller cannot be established, STOP; no fallback service-role harness. Keep the two account contexts in separate browser profiles or origins; B/C can share U2's profile with explicit actor arguments. Freeze and record each request separately, including nulls. F1's malformed-response retry weakness remains independent; uncertain outcomes stop the sequence without changing the UUID.

## Minimal manifest — all actual identifiers awaiting owner designation

| Required value | Constraint / source of value |
|---|---|
| U1, U2 (optional U3) account UUIDs | Dedicated controlled test accounts; actual roles and remaining retained quota recorded; never credentials |
| A, B, C character UUIDs | Active, alive, disposable, owned by nominated account; explicitly exclude Calikon and Canaryone and every non-test character |
| Creation choices/UUIDs if needed | Supported race, gender, globally available test names; saved canonical creation intent; no custom attributes/resources |
| Starting node and approved test node UUIDs | Existing world configuration; normal approved route between them; no teleport/configuration changes |
| Live target creature UUID and definition | Existing non-boss, non-unique target at test node; owner accepts temporary combat risk; no kill required |
| Safe exit node/route | Existing eligible connection, affordable normal movement; cleanup can wait for ordinary combat release |
| P, MB, MC | Obtain only from separately authorized create/invite responses; not pre-invented |
| Each six-argument request and UUID | Record immutable payload before dispatch; retain exact acceptance request for replay |
| Encounter/fighter IDs | Capture from supported combat response and scoped presence evidence after separately approved entry |

No actual hosted fixture UUID is selected here. Test accounts must not contain non-test characters for the proposed account-scoped inspection. Existing disposable characters must have no unrelated party, invitation, Arena, active fighter, claim or queued departure dependency.

## Smallest separately authorized read-only verification

Owner first nominates account/character and existing node/creature candidates. Use bounded SELECTs or supported read-only state/capacity calls, without gameplay function execution:

1. Only nominated test accounts: retained slot counts (including deleted), role context; only nominated test characters: ownership, lifecycle, alive/resource/location status, party/invitation and pending-departure dependencies. If creation is needed, record quota before setup and character IDs from canonical responses afterward.
2. Only nominated nodes/route and creature: relevant node/connection definitions, starting-node configuration, movement/Combat2 scope and mode settings, target node/alive/aggression/boss/unique configuration and available safe exit. Reuse F5/F7 metadata; no broad function/ACL scan.
3. At nominated nodes/encounters, obtain anonymous non-test participant/presence counts, not non-test identities or character data. Any non-test presence or unresolved visibility blocks that candidate. Record active encounter, claim availability and departure state only as needed for the fixture. Safety is volatile: recheck immediately before any later gameplay execution.

These are future read scopes, NOT executed queries. No player inventories, broad character listing, protected character reads, credentials or unrelated world inspection. If safety cannot be established by these scopes, request a different owner-nominated fixture; do not reconstruct or reset world state.

[GamePage](../../src/pages/GamePage.tsx), handleSelectedBasicAttack, uses Combat2 entry.engage when appropriate; [entry adapter](../../src/features/combat2/entry.ts) calls combat2_engage, which the [hostile initiation source](../../supabase/migrations/20260928100000_combat2_authoritative_arrival_hostile_initiation.sql) delegates to a basic-attack hostile action. Source requires owned/living character and a live creature at its node and applies mode/entry guards. Arrival can itself establish participation. Therefore movement and attack are gameplay writes, not fixture reads; a safe node cannot be inferred from an empty UI or a successful entry response alone. Do not test kill rewards, repair level1 combat difficulty or use Combat1 fallback. Present authoritative fighter evidence is required for refusal cases.

## Disposition and next authorization

Source-supported creation and exact-payload caller design: READY. Actual hosted fixture and runtime execution: NOT READY pending nominated identities, scoped safety/capacity reads and operational caller confirmation. No demonstrated source blocker added.

Next authorization should be **bounded read-only fixture validation for owner-nominated dedicated test accounts/characters and existing node/creature/exit candidates, with no gameplay writes**. After reviewing the resulting completed manifest, separately authorize canonical creation if needed, ordinary movement/combat, party setup/acceptance/replay/refusals and supported cleanup. Do not infer write authority from read approval. Sequential smoke remains distinct from hosted independent-session concurrency.

All prior limitations remain: unresolved Combat1 deadlock, privileged callers, masked ACL visibility, F1 retry issue, four OPEN progression limitations and earlier closures. Administrative XP grants remain paused; normal gameplay XP is not intentionally disabled and is not runtime-verified by this task. No commit/push authorized.
