# Roadmap — WoV Classic Modernization
Plan: .lovable/plan/wov-classic-architectural-modernization-plan-2026-11-09.md

- [x] Phase 0a: repository-based inventory draft (docs/architecture/modernization-phase0-inventory.md)
- [ ] Phase 0b: catalog dependency check for `review`/`remove` items — needs Mik's approval for read-only DB inspection
- [x] Decisions 1–3 approved by Mik (2026-11-09)
- [x] Phase 1a: golden master — 37 class abilities x 4 seeds + basic attack + catalog rejections recorded
- [x] Phase 1b: all 37 abilities resolve (targets/shield fixed); 8-round fights per class with DoTs/auras recorded
- [x] Phase 1c: same golden master runs on the Edge worker copy — identical output (46/46)
- [x] Phase 0c: static reachability map (docs/architecture/modernization-unreachable-files.md)
- [ ] Phase 1d: golden scenarios for fixed-reservation stances, shared creature statuses, boss windups (the known mirror differences)
- [x] Decide: deploy newer tested combat source to Edge — approved by Mik (2026-11-10)
- [ ] Synchronize Combat2 mirror, run focused combat/worker tests, deploy only both Combat2 workers, record refusals and release evidence
- [ ] Phases 2–8 per plan
