# Combat2 frontend targeting and creature HP presentation

2026-10-26. **Local source correction; not manually published or live-verified.** Based on source `ec36640d85f2d375543a352b04482c411aa42855`, branch `codex/combat2-targeting-hp-presentation`. The containing commit is the review unit. Reuses ENG-COMBAT-001/002 (targeting/entry) and ENG-DELIVERY-001 (presentation); specification sections Creatures/targeting/initiation and combat/resource presentation retain their existing rules. No new backlog ID or authority change.

## Changes and evidence boundaries

- [NodeView](../../src/features/world/components/NodeView.tsx): enemy ability buttons use the selected living creature, never the saved ally target. Ally selection/self fallback is retained; self abilities use the character. Existing GamePage, router and server readiness/level/CP/movement/target restrictions still decide whether an action can proceed.
- [Entry decoder](../../src/features/combat2/entry.ts) retains bounded lowercase machine refusal codes, including ability_unavailable/non_hostile_action/invalid_target, instead of collapsing them into refused. Unstructured/overlong kinds remain generic; maintenance normalization is preserved. [Router](../../src/features/combat2/routeCombat2Action.ts) displays the code when no separate reason is supplied. Refused remains refused, and only the existing explicit no_engagement exception permits peaceful entry; unknown codes grant no readiness.
- [Creature hook](../../src/features/creatures/hooks/useCreatures.ts) retains immediate name/metadata cache paint. HP in NodeView shows subtle HP… until that node's roster is actionable, except a supplied valid combat override may stay visible. Diagnostics records null HP/maxHP while hidden, never labels cached numbers as displayed. No client regeneration calculation, new polling, movement wait, extra RPC or authoritative state change.
- Node/request checks now reject stale responses before they can overwrite the prefetch cache. Returned roster visibility/authority/status are fenced to the requested node even before node-change effects run. Existing reducer guards continue to reject older visits. [GamePage](../../src/pages/GamePage.tsx) restricts encounter HP overrides to current-node roster identities and matching spawn_seq so a stale life cannot bypass the presentation selector fence.

The earlier [Judgment investigation](templar-ability-and-admin-test-teleport.md) and idle-hostile readiness correction are reused. The saved-ally targeting defect is reproduced through the actual ability bar and fixed. A separate live Judgment/server refusal is **not proven fixed**; capture its tooltip and exact RPC response/normal Diagnostics if it remains. The owner reports persistent-aggression acceptance6/6; this frontend work does not repeat that acceptance or change aggression.

For HP, this corrects stale cache presentation. It does not assert that every observed later HP change was cosmetic: existing server settlement can still legitimately change durable HP. No SQL timing, rate, encounter ownership or regeneration semantics changed.

## Local validation

- **185 focused frontend checks PASS** across NodeView integration, entry decoding/routing/readiness/session, roster authority/RPC contract, presentation and bounded resource diagnostics. Actual NodeView clicks for Judgment/Fireball/Smite use the real frontend entry adapter/router with mocked RPC responses; no gameplay execution. Tests cover ally/self behavior, invalid targets, refused-code display, cached wounded HP followed by fresh healed HP, A→B→A delayed/out-of-order responses, current combat overrides and loading diagnostic values. Existing scope/lifecycle/generation tests retained.
- Root TypeScript and explicit app TypeScript check PASS. Production build PASS, existing large-chunk advisory only. Unrelated generated MCP output restored to its committed bytes.
- Project-state checks/synchronization, local documentation references, unchanged backend/migration history and whitespace checks PASS. No hosted/runtime proof is claimed.

## Reviewed file scope

Frontend: NodeView.tsx, useCreatures.ts, GamePage.tsx, entry.ts and routeCombat2Action.ts. Focused tests: NodeView.integration.test.tsx, entry.test.ts, routeCombat2Action.test.ts, idle-hostile-ability.test.tsx and resource-diagnostics.test.tsx. Documentation: this report, the engine roadmap and project-state JSON/generated Markdown. No SQL, migrations, Edge Functions, deployment configuration or gameplay rules changed.

## Delivery / manual acceptance

1. Owner reviews and merges this exact branch commit. No merge is performed here.
2. **SQL migration: N/A. Edge deployment: N/A. Hosted preflight: N/A** for these browser-only corrections. Existing backend remains unchanged; do not request another broad audit or redeploy workers.
3. **Mik manually Publishes the frontend** after merge. Git push, local build and preview do not publish it.
4. Check Judgment against a passive creature after selecting an ally; compare Fireball/Smite where suitable. Confirm ally/self actions keep correct targets, blocked actions stay blocked, and backend refusals include a useful code/reason.
5. Re-enter a node with a wounded/regenerated creature: name appears immediately, HP… may briefly show, then current HP. Verify combat HP still updates normally. Export existing Diagnostics only if values remain inconsistent; client observations alone are not proof of a server settlement timestamp.

Stop if an independent backend refusal, authoritative resource change or stale encounter identity remains; report that exact evidence for separate authorization rather than loosening readiness or guessing at SQL. Recovery is a reviewed frontend revert/follow-up and Mik's manual publication; no server/data rollback. All prior closures, accepted limitations, progression controls/limitations, administrative XP-grant pause and recovery stash remain unchanged.
