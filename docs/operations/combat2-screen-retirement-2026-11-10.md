# WoV delivery handoff — combat screen retirement

## Reviewed source and scope

- ENG-MODERNIZE-005; Engine principles and authority, Character ownership and lifecycle, Creatures/targeting, Failure/verification. Presentation and recovery corrections, no gameplay rule changes.
- Starting/cached origin `f6cb32d378c13af9c6be86aab8bb55a274c01f27`; baseline `e1faa06b4fbf59d723636bde74af6abd503609a2` confirmed ancestor. Fresh Git fetch prohibited by environment rules; cached origin inspected, remote freshness not claimed. Managed source advanced through reviewed `bbd6a1557fc29378f258bc1fe4becdd37e6d699e`; final documentation commit/push independently managed, not publication.
- Changed GamePage, NodeView, old CombatAuditPanel delegation, removed unused CombatTimingPanel, Combat2ClientSession/recovery and node tests, AGENTS/roadmaps/spec/state/handoff. Retained data/history, workers, shared-domain helpers and unrelated work. Prior engine deployment and 0033 installation evidence reused, not reaudited.

## Artifacts and local checks

| Artifact | Purpose | SHA-256 |
|---|---|---|
| `src/pages/GamePage.tsx` | engine presentation/death path | `970f24142da19d573c5881fbf30fdf05b545f7ef0aef05fe5aafb75f4f70f505` |
| `src/features/world/components/NodeView.tsx` | unconditional engine creature roster | `50d0e220fd5335b7181843095dbea4a436f3862a78bb042b6916ee64b659229f` |
| `src/features/combat2/Combat2ClientSession.tsx` | dead reconnect recovery | `f7068da64ce18118ff9ea93b562ff06d1a85983c7dfb54c4b5ab9d86149c0878` |

-126 tests/10 files passed: node commands/readiness/HP, engine UI, reconnect recovery, route and browser isolation,46 golden fights,28 mirror cases,no-emoji. Automatic build OK23:48:39UTC. No manual build/typecheck.
- Deleted alternative creature renderer including legacy timers/effect inference and cast tracks; always render EngineCreatureRoster. GamePage supplies Combat2 engaged/autoattack/HP/commit timing/pending ability/CP and reservation state, not old broadcast/driver fields. Old audit module delegates to same engine workspace; unused timing screen deleted. Old automatic death countdown screen removed.
- Full-fight refresh exposed dead character with no encounter snapshot losing death screen; owner-read HP fallback and recovery enablement fix it through existing combat2_respawn. Active projection retains precedence; arena nodes remain reset-only. Source test verifies exact owned-character RPC; no backend authority relaxation.
- SQL/migrations/types/Edge changes N/A. No historical migrations replayed, workers redeployed or permission changes.

## Minimal hosted verification and ordered delivery

1. User authorized real-world fight, not only arena. Existing approved tester account had only arena character and no scoped world teleport destinations. Created dedicated `Engineproof` through normal creation UI with name/male/Human; no raw relocation, grants, stat edits or seeded gear. Persistent test character retained; no deletion/history erasure.
2. Normal creation/entry woke world. Walked S,S,SW,E using UI direction controls from Hearthvale, through southern paths to ordinary King's Pastures node `fea9b90e-d506-4ee2-a9d2-502741a061a1`. Natural configured aggressive L1 Sharp-Tooth Rat engaged; accepted engine screen log showed attacks/misses/grazes/damage. No fabricated outcomes or scheduler-loop simulation.
3.23:44:13UTC hosted read: encounter `16ca9a18-614c-47b6-979a-fd23912a6201` ended,tick12,test_arena_id NULL; Engineproof0/16HP. Mobile terminal screenshot and complete visible log inspected; no page errors/overflow. Ordinary-world fight confirmed; not published-frontend bundle verification, class abilities/multiplayer/reward success.
4. Initial refresh hid Respawn; reproduced and fixed owner-read dead fallback. Real UI Respawn completed;23:48:49UTC fresh read confirms16/16HP,Hearthvale starting node,gold180 from200 consistent with canonical death loss. Desktop recovery screenshot inspected. No raw revive; terminal combat/history preserved.
5. Mik authenticated Game Engine desktop/mobile verified; supported Emergency Shutdown accepted, repeated after recovery.23:45:29UTC read asleep/maintenance/0scheduler; final shutdown accepted23:48:36UTC;23:48:49UTC0active encounters/live claims. Admin mobile overflow false. No persistent data rewind.
6. Compatible source ready for Mik's manual publication. No frontend publish performed. SQL, generated types and deployed worker state unchanged.

## Authorization, STOP and recovery

- Authorized: screen retirement and bounded natural-world fight/recovery/control cleanup. No mass table/actions removal, privilege weakening, paused feature activation or automatic publication.
- Old combat presentation retired, but fenced orchestration/shared-domain helpers remain pending their dedicated replacement; this does not claim whole Combat1 codebase deletion or generic pipeline migration.
- Classless/unarmed tester died; no claim of victory, class-loadout, loot/XP or multiplayer acceptance. Real Cloud fight through local preview is separate from Mik activating new frontend publicly.
- Next responsible action: Mik manually publishes reviewed frontend when ready; future controller retirement must preserve inventory/movement/consumable contracts.