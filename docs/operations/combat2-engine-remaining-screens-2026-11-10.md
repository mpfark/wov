# WoV delivery handoff — remaining engine screens

## Reviewed source and scope

- ENG-MODERNIZE-003: engine creature roster/targeting and spellbook; unified admin authoring entry points and compact ability-library navigation. Specification sections: Engine principles and authority; Creatures, targeting and initiation; Effects and stances; Failure, diagnostics and verification. All gameplay rules, server ownership and one heartbeat preserved.
- Starting HEAD/cached origin/main: `6fadf2a1120c276b089b9eac9c514378d9061657`. Baseline `e1faa06b4fbf59d723636bde74af6abd503609a2` is an ancestor. Fresh fetch prohibited by environment Git rules; remote freshness unknown. Managed final commit/push identity pending, not claimed.
- Files: new EngineCreatureRoster/EngineSpellbook and command tests; NodeView, character AbilityLoadoutTab, EngineAdminWorkspace/navigation tests, AdminPage, AbilityConfigManager, AGENTS, engine specification/roadmap and project state.
- Existing installed Combat2 command/loadout/arena and authoring APIs reused. No SQL, types, Edge, permissions, configuration save, world-control or publication changes. No stateful Git operations, stash or unrelated repair.
- Reused evidence: previous engine-screen and arena admin handoffs. Old audit/timing screens are already unreachable; fenced orchestration is not equivalent to dead source.

## Artifacts and local checks

| Artifact | Order | SHA-256 |
|---|---|---|
| `src/features/combat2/ui/EngineCreatureRoster.tsx` | Frontend only | `16923eeb7ef3fc087e5ddc875ef55393bbc40e2dd513d7c97642620bff455b82` |
| `src/features/combat2/ui/EngineSpellbook.tsx` | Frontend only | `38352cf9aff379ef736f956302eb156d38f1df608bdb0e534a7637c07374beff` |
| `src/components/admin/AbilityConfigManager.tsx` | Frontend only | `5ca112e8857442ec2ece1d1dea3a5f970f0dc7cce28b058ec6c1cc533cba5926` |

- 132 tests pass across 12 files: engine screen commands/navigation, NodeView, authoring library, loadout registry, Combat2 session/action routing/browser/resource isolation, 46 golden fights and no-emoji.
- Automatic preview build OK after correcting incomplete typed test fixtures. No manual build/typecheck.
- Creature selection is separate from Attack; pending/engaged/dead/unconfirmed states cannot create duplicate attacks. Effects/tank/telegraphs come only from accepted Combat2 projections. Legacy fallback remains outside the active engine roster.
- Spellbook submits exact configured role/ability identities; level/combat/loading/save gates are presentation fences over existing server validation. Existing loadout hook and API unchanged.
- SQL/ACL/migration/Edge/deployment: N/A.

## Minimal hosted verification and ordered delivery

1. Authenticated requester session restored before admin navigation. `/admin` opens; Engine Abilities reads 35 configured bases.
2. Desktop 1280x1800 and mobile 360x677 screenshots inspected. Compact base selection → abilities → edit base → back navigation succeeds; no horizontal page overflow, no page errors. No save, arena lifecycle or gameplay commands executed.
3. Bounded authenticated `/game` attempt displayed blank, with no page errors. This is **not** player screen or live-fight acceptance. No invented session/character state; full player acceptance remains unverified.
4. Prior arena reset refusal remains unresolved, per `combat2-engine-admin-live-check-2026-11-10.md`; this frontend task does not bypass ownership or revive the tester. World operating state was not freshly inspected or changed.
5. Mik reviews and manually publishes. A Git commit or preview build is not publication.

## Authorization, STOP and recovery

- Authorized/performed: frontend implementation, local checks, requester-session mint and bounded preview navigation. No backend or gameplay mutation authorized by this task.
- Retain legacy files for the separately scoped retirement request; do not remove fenced orchestration or shared event-log utilities by directory name.
- General production encounter-history access requires its own supported read/permission contract; arena reporting is not a substitute. Canonical manual/roadmap integration remains ENG-MANUAL-001/ENG-ADMIN-001, not another combat controller.
- Next safe action: Mik reviews these screens; separately review/authorize the arena-admin recovery repair before the outstanding player live-fight acceptance. Retire old screens only after that acceptance.