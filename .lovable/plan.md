# Combat2 frontend state and movement messaging

## Scope
Frontend and presentation only. No database, migration, resolver, RPC-contract, scheduler, Edge Function, gameplay-data, reward, loot, inventory, vendor, marketplace, party, encounter, or departure changes.

## Implementation
1. **Status presentation**
   - Replace the ordinary-gameplay use of Test Arena language with neutral Combat2 state labels and guidance.
   - Derive explicit presentation states for peaceful idle, entering/synchronizing, reconnecting while waiting for a fresh authoritative snapshot, active combat, stale delivery/gap, temporary delivery failure, and authorization refusal.
   - Keep the existing authoritative `actionsReady` checks unchanged. Peaceful nodes remain movement-capable through the existing departure path while combat abilities remain unavailable because no encounter exists.
   - Keep Test Arena wording conditional to actual Test Arena locations only.

2. **Movement refusal detail**
   - Add a small pure presentation mapper for existing movement result statuses/classifications.
   - Preserve distinct guidance for an in-flight/live claim, queued departure, transition finalization, authorization refusal, stale/unavailable session, and transport failure.
   - Apply the same neutral mapping to ordinary departure, teleport/waymark transition conflicts, and hidden-path search conflicts without changing any request or RPC behavior.

3. **Focused verification**
   - Extend focused Combat2 status tests for peaceful, synchronizing, reconnecting, active, stale, temporary failure, and authorization refusal states.
   - Add focused tests for movement-result message mapping and automatic return to normal presentation after a live snapshot.
   - Run only relevant frontend and Combat2 presentation tests, then root TypeScript, application TypeScript, and the production build.
   - Confirm the final diff is frontend-only, record the final commit SHA and clean-worktree status, and publish only if every check passes.

## Expected files
- `src/pages/GamePage.tsx`
- `src/features/combat2/Combat2TestStatus.tsx` (or a narrowly renamed production-neutral equivalent)
- `src/features/combat2/presentation-selectors.ts`
- `src/features/combat2/entry-status-label.test.tsx`
- A small Combat2 movement-presentation helper and focused test
- Existing Combat2 delivery/presentation tests only where needed
