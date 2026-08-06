---
name: Legacy Mechanic Retirement (final sweep)
description: Combat pipeline has no per-class ability branches; retired mechanic keys are gone and T0 attacks support authored full sentences
type: feature
---
Final sweep of the ability-consolidation programme.

- `combat-tick`'s T0 attack branch gates on `spell_attack` / `weapon_attack` only. The
  legacy mechanic keys (`power_strike`, `aimed_shot`, `backstab`, `fireball`, `smite`,
  `cutting_words`) and their hardcoded stat/verb tables (`T0_STAT`, `T0_LABEL`,
  `PHYSICAL_T0`) are deleted.
- Templar legacy branches removed: Judgment's verb comes from `combat_text.hit_verb`
  and its ×0.8 rider lives in the configured `amount_calc.finalMult`.
- T0 attacks now accept authored FULL sentences: `combat_text.hit_text` /
  `miss_text` with `{caster} {target} {damage} {weapon}`. An authored line suppresses
  the weapon tag suffix. Backstab's possessive phrasing is configuration (seed +
  assassin assignment override), not code.
- Cast-flavour fallback is class-free: `SMITE_FLAVOR_BY_CLASS` deleted; Smite and
  Judgment flavour live in the ability-identity table. `getCastFlavor` and
  `resolveCastFlavor` no longer take a character class.
- Only remaining class comparison in the pipeline is the Assassin contract reward
  bonus — a game feature, not ability behaviour. Guard test:
  `src/shared/config/__tests__/legacy-retirement.test.ts`.
