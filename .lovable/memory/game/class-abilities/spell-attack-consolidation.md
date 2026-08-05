---
name: Spell & Heal Consolidation
description: Fireball/Frost Bolt/Smite/Judgment/Cutting Words share one spell_attack base; Heal and Second Wind share one heal base
type: feature
---

Consolidation Phase 4 (companion to `weapon_attack`):

- `spell_attack` is ONE reusable base mechanic. Fireball (INT/fire), Frost Bolt (INT/frost),
  Smite (WIS/holy), Judgment (WIS/holy, ×0.8 rider), Cutting Words (CHA/psychic) all resolve
  through it. Casting attribute comes from the `role: 'primary'` tagged stat term, overridable
  per class via `class_ability_assignments.overrides.scaling.primary_attribute`.
- `heal` is the single self/target heal base. Second Wind (CON) and Heal (WIS) share it; wording
  comes from authored `combat_text.self_text` / `self_full_text`, never a per-class code branch.
- Verbs for spell strikes come from authored `combat_text.hit_verb` / `miss_verb`.
- Legacy mechanics `fireball`, `smite`, `cutting_words`, `self_heal`, `power_strike`,
  `aimed_shot`, `backstab` stay resolvable so archived rows keep working.
- Damage type, CP cost and whole calcs remain base-owned (not overridable), so class identity
  that needs a distinct damage type keeps its own `abilities` row pointing at the shared mechanic.
- Guard: changing `mechanic_key` requires retiring the ability and its assignments first
  (`guard_ability_identity`).
- Test: `src/shared/config/__tests__/spell-attack-consolidation.test.ts`.
