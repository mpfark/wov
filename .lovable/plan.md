# Ability Ownership Simplification: Two Layers Only

Goal: remove the independently balanced "authored ability" layer. Base Abilities own shared mechanics and big numbers; class-configured uses own identity, flavour, damage type, scaling attribute, class scale, and selected effect. Combat runtime and current balance stay as they are.

## Current state (audited)

- `base_abilities` (21 rows) currently owns **no numbers at all** — only mechanic key, activation mode, target rules, trigger type, capabilities, allowed on-hit effects.
- `abilities` (35 rows) owns **all** numbers: `cp_cost`, `amount_calc`, `duration_calc`, `interval_ms`, `mechanic_calcs`, `effect_config`, `target_type`, plus identity (`label`, `description`, `tooltip`, `combat_text`, `damage_type`).
- `class_ability_assignments.overrides` can additionally re-edit identity, combat text, scaling attribute and `mechanic_calcs` — a third editable place.
- One ability row is shared by three classes: `weapon_attack` → warrior `power_strike`, assassin `backstab`, ranger `aimed_shot`, differentiated only by assignment overrides.
- One class already has two uses of one base: wizard `fireball` and `frost_bolt` share the same slot/role (loadout alternatives). Good — this must keep working.
- All other 33 abilities are 1:1 with a single class assignment, and their `overrides` are empty except wizard `ignite` (`label: "Orbs of Fire"`).

### Fields editable in more than one place today

| Field | Editable in |
| --- | --- |
| label / description / tooltip | Ability Library editor, Class Config, assignment `overrides` |
| combat_text | Ability Library editor, Class Config, `overrides` |
| scaling attribute | ability `amount_calc` terms, `overrides.scaling` |
| mechanic_calcs | Ability Library editor, `overrides.mechanic_calcs` |
| on_hit effect allowlist | `base_abilities.on_hit_allowed` and mirrored `abilities.effect_config.on_hit_allowed` (trigger-synced) |
| cp_cost / amount_calc / duration_calc / interval_ms / target_type | ability row only, but presented as if per-class-authored |

## Proposed field ownership

| Field | Owner after change |
| --- | --- |
| mechanic_key, activation_mode, allowed/default target, trigger_type | Base Ability |
| cp_cost, cp_reserve_pct | Base Ability |
| amount_calc, duration_calc, interval_ms, mechanic_calcs | Base Ability |
| dice / weapon requirement, tick behaviour, stack defaults, shared durations | Base Ability (`effect_config` shared knobs) |
| capabilities, on_hit support + allowed effect types + configurable effect params | Base Ability |
| class_key, role/slot, unlock level, assignment status | Configured use |
| label, description, tooltip, combat_text | Configured use |
| damage_type | Configured use |
| primary / secondary scaling attribute (secondary only if base supports) | Configured use |
| class_scale | Configured use |
| selected on-hit effect / applied status + its flavour | Configured use |
| status behaviour (DoT class, tick, duration, stacks) | Base Ability / shared status definition — never per class copy |

Runtime: `final = base calc(with class-chosen attribute) × class_scale`.

## Base mapping and value differences to resolve

Bases whose uses already share identical numbers — safe lift, zero balance change:

- `heal`: heal / second_wind (CP 15, base 0, ×3, floor 3) — differ only by attribute (WIS vs CON).
- `party_regen`: purifying_light / crescendo (CP 40, base 2, 15000/30000ms, 3000ms tick) — identical.
- `spell_attack` (mostly): fireball, smite, judgment, cutting_words all CP 10, base 5, ×2.0 soft damage, +level/3.

Divergent uses of one base (must be decided before migrating):

| Base | Uses | Divergence | Recommendation |
| --- | --- | --- | --- |
| spell_attack | judgment | `finalMult 0.8` | becomes `class_scale 0.80` — identical live output |
| spell_attack | frost_bolt | base 3, ×2.4, CP 12 vs base 5, ×2.0, CP 10 | unify to the shared shape, `class_scale 1.00`, CP 10 — small net change at low INT; flagged for approval |
| absorb_buff | force_shield (CP 15, ×1, 8–15s) vs divine_aegis (CP 60, ×2, 30–60s) | far apart | split into two bases: `absorb_buff_self` and `absorb_buff_ally` |
| mitigation_buff | battle_cry (CP 25, 10% mult, no duration) vs divine_challenge (CP 60, flat 6, 30–45s) | different modes | split: `mitigation_percent` and `mitigation_flat` |
| offense_buff | arcane_surge (CP 25, dmg mult) vs eagle_eye (CP 15, crit edge, 30s) | different modes | split: `offense_damage` and `offense_crit` |
| evasion_buff | cloak_of_shadows (CP 60, 0.4, 10–15s) vs disengage (CP 60, 1.3, 5–8s) | magnitude/duration | keep one base, magnitude via `class_scale`, duration split by config knob if needed |
| control_debuff | dissonance / natures_snare (0.25 reduction, 8–15s) vs sunder_armor (flat 2 AC, 12–20s, CP 60) | different mode | split: `control_damage_reduction` (CP baseline 25, snare 1.60 scale) and `control_armor` |
| stack_consume | eviscerate (CP 40, base 2) vs conflagrate (CP 60, base 4, ×2) | magnitude | one base at eviscerate baseline, conflagrate `class_scale 2.00` + CP override declared class-configurable |
| party_regen / heal / block_buff / others with one use | — | none | lift as-is |

Rule: no base value is silently chosen — every scale above reproduces current live output except the two flagged rows (frost_bolt shape, conflagrate CP).

## Envenom, Poison, Orbs of Fire, Ignite

- `on_hit_stance` base (mechanic `stack_apply`, trigger `on_hit`) owns: self activation, persistent stance, weapon-hit trigger, CP reservation, stack/DoT tick and duration rules. Assassin's configured use `envenom` provides name, applied status Poison (enemy target), primary attribute DEX, class scale, flavour.
- `orb_stance` base (mechanic `stack_apply`, trigger `pulse`) owns: self activation, automatic pulse attacks against current target, existing tick frequency, engage behaviour, DoT duration/stack rules. Wizard's configured use provides name Orbs of Fire, damage type Fire, INT, class scale, flavour, applied status Ignite.
- Ignite stays an enemy-side Fire DoT applied by successful orb attacks — never shown as a player ability. The ability row keeps key `ignite` for FK safety; its player-facing label stays "Orbs of Fire" and the label override on the wizard assignment is folded into the row.
- Optional On-Hit Effect (rider on one successful ability use) remains distinct in storage (`effect_config.on_hit_effect` on the configured use, allowlisted by the base) from these stances (own base rows with a trigger type).

## Schema changes

Additive first, destructive later:

1. Add to `base_abilities`: `cp_cost`, `cp_reserve_pct`, `amount_calc`, `duration_calc`, `interval_ms`, `mechanic_calcs`, `effect_config`, `target_type`, `supports_secondary_scaling`, `class_configurable` (jsonb allowlist of mechanical fields a class may override).
2. Add to `abilities`: `class_key`, `role_id` (nullable during migration), `class_scale numeric not null default 1.0`, `primary_attribute`, `secondary_attribute`, `applied_status`.
3. Backfill: for each base, write the recommended shared baseline into the base row; set each ability's `class_scale`, attributes, damage type, `class_key`/`role_id` from its single assignment.
4. Split the shared `weapon_attack` row into three configured uses (`power_strike`, `backstab`, `aimed_shot`) carrying the current override identity, then repoint `class_ability_assignments.ability_id` and `character_ability_loadout.ability_id` for the affected classes inside the same migration.
5. Create the new split bases listed above and repoint their uses.
6. Retire, only after runtime and admin read the new source and tests pass: numeric columns on `abilities` (`cp_cost`, `amount_calc`, `duration_calc`, `interval_ms`, `mechanic_calcs`, shared `effect_config` knobs) and the identity/scaling/mechanic entries in `class_ability_assignments.overrides`.

Unchanged tables: `class_ability_roles`, `character_ability_loadout` (row shape), `characters`, `character_class_bonds`, all combat/session tables.

## Runtime changes

- `src/shared/config/effective-ability.ts` and its `supabase/functions/_shared` mirror become: base numbers → apply class attribute swap → apply `class_scale` → apply damage type/identity. `OVERRIDABLE_KEYS` shrinks to what the base declares in `class_configurable`.
- `useAbilityRegistry` query joins `base_abilities` numbers and passes `class_scale` through; `load-ability-calcs.ts` in edge functions does the same.
- `combat-tick`, `combat-catchup`, `combat-resolver`, `kill-resolver` keep their mechanic implementations untouched; they only receive resolved values.
- Parity tests assert resolved output per ability equals today's values (except the two flagged rows).

## Admin UI changes

- `AbilityConfigManager.tsx`: column 1 lists Base Abilities only (with use counts); column 2 lists configured uses of the selected base as `Name — Class`; "New configured use" asks class + slot then opens column 3. Column 3 shows identity, class/slot, description, combat text, damage type, primary/secondary attribute, class scale, selected effect/status, plus a compact read-only "Inherited from <Base>" mechanics summary with an "Edit shared <Base> mechanics" action.
- `BaseAbilityEditor.tsx`: gains the shared numeric editors (CP, calc builder, duration, interval, mechanic calcs, target rules, capabilities, on-hit allowlist), a dependent-uses list, and a save warning naming affected abilities.
- `ClassAbilityConfig.tsx`: keeps five slots for the selected class, drops every numeric/mechanic editor, shows inherited mechanics read-only with a link to the base, and edits only slot, base choice, name, description, flavour, damage type, attributes, class scale, selected effect.
- `MechanicCalcsEditor.tsx` / `CalcBuilder.tsx` move to base-only usage. `OnHitEffectEditor.tsx` keeps selection-only behaviour driven by the base allowlist.
- Existing admin shell, navigation and responsive breakpoints unchanged.

## Validation

- Supabase types regenerated; shared mirror identity test still passes.
- Parity test: every ability's resolved cp/amount/duration/interval matches pre-migration snapshot (frost_bolt and conflagrate CP listed as intentional deltas).
- Tests: base number change propagates to all uses; class config cannot write cp/amount/duration; wizard keeps Fireball + Frostball on one base; damage type per use; loadouts and assignments row counts unchanged; Envenom stance→Poison and Orbs of Fire pulse→Ignite behaviour tests.
