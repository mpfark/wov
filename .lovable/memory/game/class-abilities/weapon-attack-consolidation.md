---
name: Weapon Attack Consolidation
description: Warrior/Ranger/Assassin signature strikes share one reusable weapon_attack base ability; class identity via class_ability_key + overrides
type: feature
---
Consolidation Phase 3: the three signature weapon strikes (Power Strike, Aimed Shot,
Backstab) are ONE base ability `weapon_attack` in the library.

- Base owns: mechanic (`weapon_attack`), target/activation, CP cost, calc structure,
  on-hit allowlist (`effect_config.on_hit_allowed = ['bleed','poison']`).
- Class assignment owns: `class_ability_key` (power_strike / aimed_shot / backstab),
  label, description, tooltip, `combat_text.hit_verb` / `miss_verb`, and the
  scaling attribute via `overrides.scaling.primary_attribute` (STR / DEX / DEX).
- The amount calc's stat terms are tagged `role: 'primary'` so the class override
  substitutes the attribute without touching the curve or coefficients.
- `combat-tick` derives the scaling stat from the effective amount calc (then
  `effect_config.stat`, then STR) and the verbs from effective `combat_text`;
  no per-class branch. Backstab phrasing is chosen by identity, not mechanic.
- Legacy mechanics `power_strike` / `aimed_shot` / `backstab` stay handled and the
  old library rows are `status='retired'` for archived assignments.
- Guard test: `src/shared/config/__tests__/weapon-attack-consolidation.test.ts`.
