---
name: Group G Holdout Consolidation
description: multi_attack, burst_damage, reactive_holy, block_buff, stealth/root/sunder/hp_transfer/regen holdouts are now config-driven (effect_config stats + authored combat_text)
type: feature
---
Consolidation Group G (final single-holdout mechanics). No coded branch knows a class name.

- `multi_attack` (Barrage): to-hit attribute from `effect_config.attack_stat`, arrow count from
  `mechanic_calcs.arrow_count`, per-arrow magnitude from `amount_calc`, all lines authored in
  `combat_text.cast_text` / `hit_text` / `miss_text` with `{caster} {count} {index} {target} {damage}`.
- `burst_damage` (Grand Finale): `effect_config.stat` rolls to hit and sizes the bonus die,
  `crit_threshold_floor` caps the crit edge, wording via `hit_text` / `miss_text`
  (`{ability} {crit} {caster} {target} {damage}`).
- `reactive_holy` (Holy Shield): reserved stances are scanned generically by mechanic;
  `effect_config.magnitude_stat` / `kicker_stat` and `combat_text.retaliate_text`
  (`{caster} {target} {damage}`) are configuration. Buff bag carries `ability_key` so the
  retaliation magnitude resolves from the granting row.
- `block_buff` (Shield Wall): scanned generically by mechanic; final chance ceiling from
  `effect_config.block_chance_cap` (default 0.95).
- Client holdouts (`useCombatActions.ts`): `stealth_buff`, `root_debuff`, `sunder_debuff`,
  `regen_buff` use `combat_text.activate_text` (plus `renew_text` for regen recasts) and
  `hp_transfer` uses `combat_text.transfer_text`.
- Guard test: `src/shared/config/__tests__/group-g-consolidation.test.ts`.
