---
name: Offense Buff Consolidation
description: Arcane Surge + Eagle Eye share one offense_buff base; offense_mode (damage_mult | crit_edge) and wording are config
type: feature
---
Consolidation Group F (offensive self-buffs).

- `arcane_surge` (Wizard, T2 stance) and `eagle_eye` (Ranger, T1 stance) both run the single
  `offense_buff` mechanic. Legacy `damage_buff` / `crit_buff` mechanic keys are retired from the
  templates but stay matched at runtime so archived assignments resolve.
- `effect_config.offense_mode` decides behaviour: `'damage_mult'` (amount calc = outgoing damage
  multiplier) or `'crit_edge'` (amount calc = crit-range widening). No class branches.
- `combat-tick` derives the buff bag generically from reserved stances whose mechanic is
  `offense_buff`; the damage-mult half carries `damage_buff: { ability_key }` so `surgeMult`
  resolves the multiplier from the granting ability's own calc (fallback `arcane_surge`,
  neutral value 1).
- Client sends `damage_buff: { ability_key }` from `gatherBuffs`; `DamageBuff` carries `abilityKey`.
- Stance-ness resolves by ability identity: `offense_buff` is in `SHARED_MECHANIC_KEYS`, with
  legacy `crit_buff` / `damage_buff` aliases mapped to Eagle Eye / Arcane Surge.
- Wording is authored `combat_text.activate_text` with `{mult}`, `{crit_low}`, `{seconds}`.
- Guard test: `src/shared/config/__tests__/offense-consolidation.test.ts`.
