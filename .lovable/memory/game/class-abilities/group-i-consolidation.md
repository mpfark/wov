---
name: Group I Sustain & Utility Consolidation
description: hp_transfer, regen_buff and stealth_buff are fully config-driven (effect_config knobs + authored combat_text, no hardcoded floors or policies)
type: feature
---
Consolidation Group I (final sustain/utility holdouts). No coded branch knows a class name,
and no handler carries a hardcoded magnitude, floor, merge policy or log line.

- `hp_transfer` (Transfer Health): amount from `amount_calc`, safety floor from the named
  `reserve_hp` calc, absolute floor from `effect_config.min_reserve_hp`; attributes documented
  as `magnitude_stat` / `reserve_stat`. Lines authored as `combat_text.transfer_text` and
  `no_hp_text` (`{caster} {target} {ability} {reserve}`).
- `regen_buff` (Inspire): HP/tick from `amount_calc`, CP/tick from the named `cp_per_tick` calc
  floored by `effect_config.min_cp_per_tick`; recast merging from
  `effect_config.refresh_policy` (`best_of` keeps the stronger values, `replace` always takes
  the new cast). Wording from `activate_text` / `renew_text`.
- `stealth_buff` (Shadowstep): ambush multiplier from `amount_calc`, duration from
  `duration_calc`, attributes documented as `ambush_stat` / `duration_stat`, plus
  `consumed_on_attack`. Wording from `activate_text` (`{ability} {seconds} {mult}`).
- `LEGACY_AMBUSH_MULT` (mechanic-templates, mirrored) is the single shared fallback used when a
  buff bag arrives in the legacy boolean form — client and combat-tick both read it.
- Guard test: `src/shared/config/__tests__/group-i-consolidation.test.ts`.
