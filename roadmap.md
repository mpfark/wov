# Roadmap — WoV Classic Modernization
Plan: .lovable/plan/wov-classic-architectural-modernization-plan-2026-11-09.md

- [x] Phase 0a: repository-based inventory draft (docs/architecture/modernization-phase0-inventory.md)
- [x] Phase 0b: dependency check done — 23 unreachable functions marked DEPRECATED (0032); tables and other functions still live (docs/architecture/modernization-phase0b-dependency-check.md)
- [x] Decisions 1–3 approved by Mik (2026-11-09)
- [x] Phase 1a: golden master — 37 class abilities x 4 seeds + basic attack + catalog rejections recorded
- [x] Phase 1b: all 37 abilities resolve (targets/shield fixed); 8-round fights per class with DoTs/auras recorded
- [x] Phase 1c: same golden master runs on the Edge worker copy — identical output (46/46)
- [x] Phase 0c: static reachability map (docs/architecture/modernization-unreachable-files.md)
- [ ] Phase 1d: golden scenarios for fixed-reservation stances, shared creature statuses, boss windups (the known mirror differences)
- [x] Decide: deploy newer tested combat source to Edge — approved by Mik (2026-11-10)
- [x] Synchronize Combat2 mirror, run focused combat/worker tests, deploy only both Combat2 workers, record refusals and release evidence (613 tests; live GET405/POST401)
- [ ] Phases 2–8 per plan

- [x] Phase 2a: engine entry point `src/shared/combat2/engine.ts` (step / applyTick / advance); golden fights now run through it (2026-11-10). Worker copy generated, not deployed.
- [x] Phase 2b: live workers switched to engine.step and deployed (2026-11-10); GET 405, unsigned POST 401.
- [x] Live full-fight check (2026-11-10): Proving Ground arena, F10-Leader vs low creature, 7 rounds committed by new engine, encounter ended (character died, creature 80->71). World closed: maintenance, asleep, scheduler off.
