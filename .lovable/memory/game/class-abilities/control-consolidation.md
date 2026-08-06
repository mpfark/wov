---
name: Control Debuff Consolidation
description: Nature's Snare, Dissonance and Sunder Armor share one control_debuff base; control_mode picks damage vs AC reduction
type: feature
---
Consolidation Group H. `root_debuff` and `sunder_debuff` are retired; one `control_debuff`
mechanic serves every targeted weakening ability.

- `effect_config.control_mode`: `'damage_reduction'` (Nature's Snare, Dissonance) or
  `'ac_reduction'` (Sunder Armor) selects the local debuff tracker.
- `effect_config.magnitude_stat` / `duration_stat` document the scaling attributes
  (Snare WIS/WIS, Dissonance INT/INT, Sunder STR/DEX); `amount_calc` / `duration_calc` own the math.
- Wording is authored `combat_text.activate_text` with `{ability} {target} {amount} {pct} {seconds}`.
- Legacy rows with no `control_mode` fall back by retired mechanic key.
- Guard test: `src/shared/config/__tests__/group-h-consolidation.test.ts`.
