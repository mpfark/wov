---
name: Stack Applier Consolidation
description: Envenom + Orbs of Fire share one stack_apply base; trigger (on_hit/pulse), effect_type, scaling stats, linger and text are config
type: feature
---
Consolidation Group D — stack appliers.

Envenom (Assassin) and Orbs of Fire (Wizard) are the SAME base mechanic:
`stack_apply`. `poison_buff` and `ignite_buff` are retired.

Configuration owns all identity (`abilities.effect_config`):
- `trigger`: `on_hit` (fires on weapon hits) or `pulse` (fires on its own heartbeat)
- `effect_type`: which `active_effects` row the stack writes (`poison` / `ignite`)
- `stack_noun`: wording noun
- `dot_stat`, `dot_stat_mult`, `dot_global_mult`: per-tick DoT magnitude
- `dot_duration_ms`, `dot_duration_stat`, `dot_duration_per_point_ms`, `dot_duration_cap_ms`
- pulse only: `pulse_damage_base`, `pulse_damage_stat`, `engages_target`
- `consumes_all_cp`: drives the drain-all-CP cost (no per-mechanic check)
- `mechanic_calcs.max_stacks`: stack ceiling calc (Envenom scales with CHA)

Authored `combat_text`: `activate_text`, `proc_text` (on_hit), `pulse_text` and
`stack_text` (pulse). Placeholders: `{attacker} {target} {stacks} {damage}`.

Server: one generic `stackAppliersFor` + `applyConfiguredStack` pair in
`combat-tick`; stance hydration seeds `buffs.stack_apply` from any reserved
stance whose mechanic is `stack_apply`. Legacy `poison_buff` / `ignite_buff`
client flags still map back to their stance key for older clients.
Stance resolution stays identity-first (`abilityKey`) since the mechanic key is
now shared.
