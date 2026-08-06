# Ability Ownership Simplification — Revised (Zero Balance Change)

Two layers only: **Base Ability** owns shared mechanics and numbers; **Class Ability Configuration** owns identity, flavour, damage type, scaling attribute(s), class scale and selected effect. No mechanical value is editable in two places. Combat runtime, timings, CP costs and damage output stay bit-for-bit identical.

Corrections applied from review:
- No balance changes at all. Frost Bolt keeps CP 12 and its own curve; Conflagrate keeps CP 60 and its curve.
- No `class_configurable` mechanical-override allowlist. The only class controls are `class_scale` and scaling-attribute selection. Where numbers genuinely differ, the abilities get **separate Base Abilities**.
- Eviscerate/Conflagrate and Cloak/Disengage are **not** merged: same runtime mechanic, non-inheritable numbers.
- Class and slot stay owned exclusively by `class_ability_assignments`. No `class_key`/`role_id` on `abilities`.
- `abilities.effect_config.on_hit_allowed` is removed; on-hit permissions live only on the base.

## Field ownership (authoritative)

| Field | Owner | Notes |
| --- | --- | --- |
| mechanic_key | Base Ability | immutable once used |
| activation_mode, default/allowed target types | Base Ability | |
| cp_cost, cp_reserve_pct | Base Ability | never per class |
| amount_calc, duration_calc, interval_ms, mechanic_calcs | Base Ability | whole calcs, dice, caps, floors |
| mechanic behaviour knobs (`control_mode`, `offense_mode`, `evasion_source`, `requires_shield`, `consumes_all_cp`, `resolved_by`, pulse cadence, `refresh_policy`, `min_reserve_hp`, …) | Base Ability | moves out of `abilities.effect_config` |
| trigger_type (none / on_hit / pulse) | Base Ability | |
| capabilities (which config sections appear) | Base Ability | |
| on-hit support + allowed effect types + which effect params are configurable | Base Ability | single source; ability mirror deleted |
| class_key, role/slot, unlock_level, assignment status, is_default | `class_ability_assignments` | unchanged source of truth |
| label, description, tooltip | Configured use (`abilities` row) | |
| combat_text | Configured use | |
| damage_type | Configured use | Fire / Frost / Radiant / Psychic per use |
| primary_attribute, secondary_attribute (only if base has a role-tagged term) | Configured use | substitutes the attribute, never the curve |
| class_scale (numeric, default 1.0) | Configured use | the only magnitude control |
| selected on-hit effect / applied status | Configured use | must be in the base's allowlist |
| status behaviour: DoT/debuff class, tick interval, duration rules, stacking, max stacks, default damage type — expressed with **named scaling roles**, not fixed attributes | Applied-status definition | reusable, shared by every ability that applies it |

Runtime: `result = base calc (with the use's chosen attributes) × class_scale`. Class Config exposes no shared mechanical-number editors; `class_scale` remains the one normal editable numeric class-balancing control.

## effect_config decomposition

| Current key(s) | New home |
| --- | --- |
| `resolved_by`, `control_mode`, `offense_mode`, `evasion_source`, `dodge_chance`, `next_hit_window_ms`, `requires_shield`, `block_chance_cap`, `damages_enemies`, `heals_allies`, `magnitude_reduction`, `consumes_all_cp`, `engages_target`, `trigger`, `refresh_policy`, `absorb_shield`, `reforms_out_of_combat`, `crit_threshold_floor`, `min_reserve_hp` | Base Ability `effect_config` |
| `stat`, `magnitude_stat`, `duration_stat`, `regen_stat`, `chance_stat`, `amount_stat`, `crit_edge_stat`, `dot_stat` (as *which role*) | Configured use scaling attributes (role-tagged terms) |
| `effect_type`, `stack_noun`, `dot_stat_mult`, `dot_global_mult`, `dot_duration_ms`, `dot_duration_per_point_ms`, `dot_duration_cap_ms`, `max_stacks_calc`, `mutually_exclusive_with` | Applied-status definition (`poison`, `ignite`, `bleed`, `frozen`) |
| `on_hit_allowed` | deleted from `abilities`; base only |
| `pulse_damage_base`, `pulse_damage_stat` | Base (cadence/base) + configured use (attribute) |

### Applied statuses use scaling roles, not fixed attributes

An applied-status definition owns formulas, intervals, duration rules and stack behaviour, but declares its attribute dependencies as **named roles** (e.g. `dot_magnitude_role`, `dot_duration_role`, `max_stacks_role`). The configured use maps each role to its own primary or secondary attribute. A future second source of Ignite can therefore scale its burn from a different attribute without duplicating the Ignite status.

Current live mappings, preserved exactly:

| Status | Numbers (status-owned) | Roles → attributes, per configured use |
| --- | --- | --- |
| Poison | ×1.2 magnitude mult, 25 000 ms duration, CHA-shaped max-stack calc, tick cadence unchanged | Envenom: magnitude → DEX (primary), max stacks → CHA (secondary) |
| Ignite | ×0.7 stat mult, ×0.67 global mult, 30 000 ms base / 45 000 ms cap, +1 000 ms per point, max stacks 5 flat | Orbs of Fire: burn magnitude → WIS (secondary), burn duration → WIS (secondary) |

Sharing `stack_apply` runtime never makes Poison and Ignite share numbers.

### Orbs of Fire scaling, in full

Its configured use must map both attributes exactly as they behave today:

| Quantity | Owner | Attribute role → attribute |
| --- | --- | --- |
| orb proc chance (0.25 base, +0.04/pt diminishing, cap 0.25) | Base `orb_stance` | primary → INT |
| orb (spark) damage (`pulse_damage_base` 2 + stat) | Base `orb_stance` | primary → INT |
| pulse cadence (per heartbeat), stance CP reservation, mutual exclusivity | Base `orb_stance` | — |
| Ignite burn damage per tick (×0.7 / ×0.67) | Ignite status | magnitude role → WIS |
| Ignite duration (30 000 base, +1 000/pt, 45 000 cap) | Ignite status | duration role → WIS |
| Ignite max stacks (5) | Ignite status | flat, no attribute |


## Complete mapping of all 36 configured uses

CP, calc and timing below are the *current live* values and become the values of the listed base. `scale` is `class_scale`.

| Class | Slot | Configured use | Base Ability | CP | Amount calc (live) | Duration / timing | Damage type | Attr | Scale |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| wizard | 1 | Fireball | spell_attack | 10 | 5 + 2×soft(stat) + lvl/3, floor 1 | — | fire | INT | 1.00 |
| healer | 1 | Smite | spell_attack | 10 | same | — | holy | WIS | 1.00 |
| templar | 1 | Judgment | spell_attack | 10 | same, ×0.8 rider | — | holy | WIS | **0.80** |
| bard | 1 | Cutting Words | spell_attack | 10 | same | — | psychic | CHA | 1.00 |
| wizard | 1 (alt) | Frost Bolt | **spell_bolt** (new) | 12 | 3 + 2.4×soft(stat) + lvl/3 | — | frost | INT | 1.00 |
| warrior | 1 | Power Strike | weapon_attack | 10 | 3 + weapon die + raw + soft(stat) + lvl/3 | — | physical | STR | 1.00 |
| assassin | 1 | Backstab | weapon_attack | 10 | same | — | physical | DEX | 1.00 |
| ranger | 1 | Aimed Shot | weapon_attack | 10 | same | — | physical | DEX | 1.00 |
| healer | 2 | Heal | heal | 15 | 3×mod(stat) + lvl, floor 3 | — | — | WIS | 1.00 |
| warrior | 2 | Second Wind | heal | 15 | same | — | — | CON | 1.00 |
| healer | 4 | Purifying Light | party_regen | 40 | 2 + mod(primary), floor 1 | 15 000 / cap 30 000, tick 3 000 | — | WIS / CON | 1.00 |
| bard | 4 | Crescendo | party_regen | 40 | same | same | — | CHA / INT | 1.00 |
| wizard | 2 | Force Shield | **absorb_self** | 15 | 1×WIS + 0.5×lvl, floor 1 | 8 000 / cap 15 000 (+1 000/pt) | — | WIS / INT | 1.00 |
| healer | 5 | Divine Aegis | **absorb_ally** | 60 | 2×WIS + 0.7×lvl | 30 000 / cap 60 000 (+2 000/pt) | — | WIS / CON | 1.00 |
| warrior | 3 | Battle Cry | **mitigation_percent** | 25 | 0.10 + STR (percent) | — | — | STR | 1.00 |
| templar | 5 | Divine Challenge | **mitigation_flat** | 60 | 6 + WIS (flat) | 30 000 / cap 45 000 | — | WIS | 1.00 |
| wizard | 3 | Arcane Surge | **offense_damage** | 25 | 1.1 + INT (multiplier) | — | — | INT | 1.00 |
| ranger | 2 | Eagle Eye | **offense_crit** | 15 | 0.5×DEX (flat crit edge) | 30 000 | — | DEX | 1.00 |
| assassin | 5 | Cloak of Shadows | **evasion_dodge** | 60 | 0.4 + CHA (dodge percent) | 10 000 / cap 15 000 (+500/pt) | — | CHA / DEX | 1.00 |
| ranger | 5 | Disengage | **evasion_next_hit** | 60 | 1.3 + WIS (multiplier) | 5 000 / cap 8 000 (+500/pt) | — | WIS / DEX | 1.00 |
| bard | 3 | Dissonance | **control_reduction_light** | 25 | 0.25 + INT (percent) | 8 000 / cap 15 000 | psychic | INT | 1.00 |
| ranger | 4 | Nature's Snare | **control_reduction** | 40 | 0.25 + WIS (percent) | 8 000 / cap 15 000 | nature | WIS | 1.00 |
| warrior | 5 | Sunder Armor | **control_armor** | 60 | 2 + STR (flat AC) | 12 000 / cap 20 000 | — | STR / DEX | 1.00 |
| assassin | 4 | Eviscerate | **stack_consume_weapon** | 40 | 2 + weapon die + DEX + lvl/3 | — | physical | DEX | 1.00 |
| wizard | 5 | Conflagrate | **stack_consume_spell** | 60 | 4 + 2×INT | — | fire | INT | 1.00 |
| warrior | 4 | Rend | dot_debuff | 40 | 2 + 1.5×STR | 20 000 / cap 30 000, tick 2 000 | physical | STR | 1.00 |
| templar | 4 | Consecrate | aura_pulse | 40 | 2 + WIS, ×0.65 rider | 6 000 / cap 10 000, tick 2 000 | holy | WIS / CON | 1.00 |
| templar | 3 | Shield Wall | block_buff | 25 | mechanic calcs: block_amount 4.25+CON, block_chance 0.255+WIS | — | — | CON / WIS | 1.00 |
| templar | 2 | Holy Shield | reactive_holy | 15 | mechanic-owned retaliation | 30 000 | holy | WIS / CON | 1.00 |
| ranger | 3 | Barrage | multi_attack | 25 | per-arrow weapon roll, DEX count | — | physical | DEX / WIS | 1.00 |
| bard | 5 | Grand Finale | burst_damage | 60 | 4×soft(CHA) + 1.5×lvl, floor 8; crit_edge INT | — | psychic | CHA / INT | 1.00 |
| healer | 3 | Transfer Health | hp_transfer | 25 | 2×WIS | — | — | WIS / CON | 1.00 |
| bard | 2 | Inspire | regen_buff | 15 | 2 + CHA per tick, floor 2 | 60 000 / cap 180 000 (+8 000/pt) | — | CHA / INT | 1.00 |
| assassin | 2 | Shadowstep | stealth_buff | 15 | 2 + 0.05×CHA, cap 2.5 | 15 000 / cap 25 000 | — | CHA / DEX | 1.00 |
| assassin | 3 | Envenom | on_hit_stance | 50 | 0.25 + DEX proc chance; Poison max stacks from CHA | applies **Poison** status | poison (via status) | DEX / CHA | 1.00 |
| wizard | 4 | Orbs of Fire | orb_stance | 50 | 0.25 + INT proc chance; pulse base 2 + INT | own pulse cadence; applies **Ignite** status (burn damage + duration from WIS) | fire | INT / WIS | 1.00 |

Shared ability row currently spanning three classes: `weapon_attack` (warrior / assassin / ranger). It is split into three configured-use rows (Power Strike, Backstab, Aimed Shot) carrying today's override identity, then `class_ability_assignments.ability_id` and `character_ability_loadout.ability_id` are repointed inside the same migration. After that a unique constraint enforces one class assignment per configured use.

### Multi-use bases — identity of shared numbers

| Base | Uses | Shared numbers identical? |
| --- | --- | --- |
| spell_attack | Fireball, Smite, Judgment, Cutting Words | Yes — all CP 10, base 5, ×2 soft, +lvl/3, floor 1, enemy, instant. Judgment's live ×0.8 rider becomes `class_scale 0.80`, exact same output. |
| weapon_attack | Power Strike, Backstab, Aimed Shot | Yes — one identical calc today; only the tagged attribute differs (STR/DEX/DEX). |
| heal | Heal, Second Wind | Yes — CP 15, 3×mod + level, floor 3; attribute differs (WIS/CON). |
| party_regen | Purifying Light, Crescendo | Yes — CP 40, base 2, 15 000/30 000 ms, 3 000 ms tick; attributes differ. |
| every other base | one use | N/A; numbers lifted verbatim. |

### Separate bases required (numbers not inheritable)

| Abilities | Why a shared base is impossible without a balance change |
| --- | --- |
| Frost Bolt vs Fireball family | CP 12 vs 10 and a different curve shape (3 + ×2.4 vs 5 + ×2.0); no single scale reproduces it. |
| Force Shield vs Divine Aegis | CP 15 vs 60, magnitude ×1 vs ×2, duration 8/15 s vs 30/60 s with different per-point step — three independent ratios. |
| Battle Cry vs Divine Challenge | percent mitigation, no duration vs flat 6 with 30/45 s duration; different units. |
| Arcane Surge vs Eagle Eye | multiplier vs flat crit-edge, CP 25 vs 15, no duration vs 30 s. |
| Cloak of Shadows vs Disengage | dodge-chance percent vs next-hit multiplier, 10/15 s vs 5/8 s; different units and windows. |
| Dissonance vs Nature's Snare | identical calc but CP 25 vs 40. |
| Sunder Armor vs the reduction pair | flat AC vs percent damage reduction, CP 60, longer duration. |
| Eviscerate vs Conflagrate | weapon-die physical (CP 40, base 2) vs pure spell (CP 60, base 4, ×2 INT). |

Merge candidates for a **later, separately approved** balance pass (not part of this migration): Frost Bolt into spell_attack, Nature's Snare CP into control_reduction_light, Eviscerate/Conflagrate, Cloak/Disengage.

## On-Hit Effect vs On-Hit Stance vs Automatic Attack Stance

| Concept | Storage | Execution |
| --- | --- | --- |
| Optional On-Hit Effect (rider) | base declares support + allowed types + which params are configurable; configured use stores the single selected effect key and its flavour | rolled after that ability's own hit resolves |
| On-Hit Stance (Envenom) | own base `on_hit_stance`, trigger `on_hit`, self activation, CP reservation; configured use picks applied status = Poison (enemy) | stance persists; subsequent weapon hits roll the stance proc |
| Automatic Attack Stance (Orbs of Fire) | own base `orb_stance`, trigger `pulse`, self activation, own cadence; configured use picks applied status = Ignite (enemy), damage type Fire, primary INT (proc chance + orb damage), secondary WIS (Ignite magnitude + duration roles) | stance pulses its own attacks each heartbeat; each landed orb applies/stacks Ignite |

Ignite and Poison are enemy-side DoTs defined once in the applied-status layer, never player-selectable abilities.

## Schema changes

1. Add to `base_abilities`: `cp_cost`, `cp_reserve_pct`, `target_type`, `amount_calc`, `duration_calc`, `interval_ms`, `mechanic_calcs`, `effect_config`, `supports_secondary_scaling`.
2. Add to `abilities`: `class_scale numeric not null default 1.0`, `primary_attribute`, `secondary_attribute`, `applied_status`, `on_hit_effect`. No class or slot columns.
3. New table `applied_statuses` (key, effect_type, classification, tick_interval_ms, duration rules, stack rules, default damage type) + GRANTs and read policies; seeded from the current Poison / Ignite / Bleed values.
4. Create the new split bases listed above; backfill every base's numbers from its (single or identical) uses; set `class_scale` (only Judgment ≠ 1.0, replacing its `finalMult`); fold surviving `overrides` (identity, scaling attribute) onto the configured-use rows.
5. Split the shared `weapon_attack` ability row into three; repoint assignments and loadouts; add the one-assignment-per-ability unique constraint.
6. Drop the `on_hit_allowed` mirror on `abilities` and the two sync triggers.
7. Only after runtime + admin read the new source and parity tests pass: drop `abilities.cp_cost`, `amount_calc`, `duration_calc`, `interval_ms`, `mechanic_calcs`, `target_type`, and shrink `class_ability_assignments.overrides` to nothing (column kept nullable for archive).

### Final fate of `abilities.effect_config`

Once every runtime mechanic knob, status behaviour block and On-Hit permission has moved to `base_abilities.effect_config` and `applied_statuses`, `abilities.effect_config` must no longer be read or written by the runtime (`combat-tick`, `combat-catchup`, resolvers, shared config mirrors) or by any admin component. The preferred end state is dropping the column in the final cleanup step of this migration, once parity tests are green and a grep confirms zero readers/writers. If any residual reader is found that cannot be migrated in this pass, the column is retained **only** as a deprecated archive field: made nullable with a `-- DEPRECATED: archive only, no readers` comment, excluded from all admin forms and select lists, and paired with a named follow-up removal migration recorded here (`drop_abilities_effect_config`). No new code may read it in either case.

Untouched: `class_ability_roles`, `character_ability_loadout` shape, `characters`, `character_class_bonds`, combat/session/encounter tables, combat-tick mechanic implementations, kill/reward resolvers.

## Code changes

- `src/shared/config/effective-ability.ts` + `supabase/functions/_shared` mirror: resolver becomes base numbers → attribute substitution → `class_scale`. `OVERRIDABLE_KEYS` and `mechanic_calcs` overrides removed.
- `useAbilityRegistry.ts`, `ability-calcs.ts`, `load-ability-calcs.ts`: select numbers from `base_abilities`, identity/scale from `abilities`, class/slot from assignments.
- `AbilityConfigManager.tsx`: column 1 Base Abilities (with use counts), column 2 configured uses of the selected base as `Name — Class`, "New configured use" asks class + slot, column 3 identity/flavour/damage type/attributes/class scale/selected effect plus a read-only "Inherited from <Base>" summary and an "Edit shared <Base> mechanics" action.
- `BaseAbilityEditor.tsx`: gains the shared numeric editors (CP, calcs, duration, interval, mechanic calcs, target rules, capabilities, on-hit allowlist), dependent-use list, and a save warning naming affected abilities.
- `ClassAbilityConfig.tsx`: five slots for the selected class only; no numeric editors; inherited mechanics read-only with a link to the base.
- `MechanicCalcsEditor.tsx` / `CalcBuilder.tsx` become base-only. `OnHitEffectEditor.tsx` reads the allowlist from the base only.
- Supabase types regenerated; seeds (`ability-seed.ts` and its mirror) restructured to the two layers; shared-mirror identity test kept green.

## Validation

- Snapshot parity test: for all 36 configured uses at several levels and stat spreads, resolved CP / amount / duration / interval equal the pre-migration values exactly — **zero** intentional deltas.
- Changing a number on Spell Attack changes Fireball, Smite, Judgment and Cutting Words together.
- Class Config and assignment writes cannot alter CP, calcs, timing, targeting or duration.
- Wizard keeps Fireball and Frost Bolt in slot 1 as loadout alternatives; damage type stays per use.
- Envenom: self stance → Poison on enemy. Orbs of Fire: own pulses → Ignite on enemy. Ignite never listed as a player ability.
- Orbs of Fire dual-attribute parity: with INT and WIS varied **independently** (e.g. INT 20/WIS 8 and INT 8/WIS 20 across several levels), assert separately that orb damage and orb proc chance track INT only, that Ignite damage per tick and Ignite duration track WIS only, and that Ignite max stacks stays 5 — each equal to the pre-migration value.
- Envenom dual-attribute parity: proc chance tracks DEX only, Poison max stacks tracks CHA only.
- No reader or writer of `abilities.effect_config` remains in runtime or admin code.
- Assignment and loadout row counts unchanged; every configured use has exactly one class/slot.
- Admin shell and responsive layout unchanged.
