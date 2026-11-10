# WoV delivery handoff — engine screens

## Reviewed source and scope

- ENG-MODERNIZE-003: engine-owned player ability bar, admin Game Engine workspace, accepted-session inspector and presentation registries. Specification: Engine principles and authority; Creatures, targeting and initiation; Effects and stances; Failure, diagnostics and verification. Every gameplay rule is preserved.
- Starting HEAD and cached origin/main: `e378c1dfbf323e896d51a423eee4a6d40fb59ace`. Baseline `e1faa06b4fbf59d723636bde74af6abd503609a2` is an ancestor. No fresh fetch: stateful Git operations are prohibited in this environment. No push/publication claimed.
- Exact reviewed commit containing this task: managed commit pending at handoff; hashes below identify the reviewed screen bytes, not the starting commit.
- Changed files: new `src/features/combat2/ui` presentation registries, controls and tests; old registry/measurer paths become re-exports; GamePage, NodeView, StatusBarsStrip, registry/loadout hooks, admin base-ability/global preview/manual imports, AdminPage, AdminSidebar, ToolsPanel, action routing/target type imports and test location, AGENTS and engine/project-state/roadmap documentation.
- No unrelated data/schema/worker changes; no stash or repository metadata manipulation. Compatibility exports retain one registry instance, not a second engine.
- Existing Combat2 action, target, stance, loadout and arena boundaries reused. Bootstrap/configured presentation is not worker catalogue proof.

## Artifacts and local checks

| Artifact | Order | SHA-256 |
|---|---|---|
| `src/features/combat2/ui/EngineActionBar.tsx` | Frontend only | `48205b9597d3c4f42c3339a3e1edee03f53a10f0bc2d6edbbe77dd0285d91035` |
| `src/features/combat2/ui/EngineAdminWorkspace.tsx` | Frontend only | `c6c324d9e2f7c26dab3c9599f4777bafea69d578a4f34e85c5a504278ec8e93b` |
| `src/features/combat2/ui/EngineSessionInspector.tsx` | Frontend only | `31b155e762b55ebba8a0da5b2742386f58183ecc4211cd31a09bbad1f45d1685` |

- 211 tests pass across 18 focused files: 124 player/engine tests, 86 registry/admin tests and one workspace navigation test. Includes 46 recorded golden fights, readiness/target submission, zero-CP stance drop, configured identity, shared mutable registry, CP display, arena API, admin authoring and no-emoji.
- Preview build log: build OK after correcting initial missing-file/unused-import/union-narrowing errors. No manual build/typecheck was run.
- SQL, migration registration/history, generated Cloud types, role/ACL, Edge deployment and settings: N/A; unchanged.
- Admin workspace reuses existing Test Arena, Abilities, Statuses and Classes screens; it does not create a second rules editor. Old Combat Audit navigation no longer mounts legacy trace controls. Old files and guarded legacy runtime hooks remain for separate retirement.

## Minimal hosted verification and ordered delivery

1. SQL/Edge: N/A. Existing installed API contracts are retained; no new permissions required or authorized.
2. Authenticated preview attempted at 2026-11-10T22:52:57Z: requester-scoped session minted; `/admin` refused with “Admin access required” and redirected to `/game`. No fabricated session role or bypass. New admin workspace and player live-fight behavior are not end-to-end verified; desktop/mobile screenshots remain unverified.
3. With an authorized admin session, open Game Engine; switch Test Arena/Abilities/Statuses/Classes and confirm configuration/read-only arena status loads. Do not start/wake/reset the world for a screen check.
4. With a playable character, confirm the existing player bar submits the selected identity and queued/refusal/stance/resource projections come back through the established session. Bounded fight acceptance is a separate runtime observation.
5. Mik manually publishes after review; no automatic publication. Current publication evidence is preserved separately, not overwritten with a new claim.

## Authorization, STOP and recovery

- Authorized: frontend implementation and local checks. Performed: source edits/tests and requester-session mint plus browser navigation only. No gameplay, world-control, database, role or Edge mutation.
- STOP at admin refusal; this task does not change access policy. No general production encounter-history API was established, so the workspace does not promise one.
- Remaining fenced legacy orchestration, prose/manual authority integration and generic command-pipeline migration are later work, not closed by this screen task.
- Next action: Mik verifies using his existing authorized admin/game session and handles manual publication. No source rollback, data repair or revived competing writer is required.
