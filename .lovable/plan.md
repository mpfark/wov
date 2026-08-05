# Reusable Base Abilities + Class-Configured Identity + On-Hit Effect

Audit-first plan. Nothing is implemented yet. Every current-state claim below was verified against the repository and live ability data this turn.

## 1. Repository findings and conflicts with the intended model

Verified today:

- The base library exists and is queried directly (`abilities`), Class Config owns assignments (`class_ability_assignments`), 5 roles per class (`class_ability_roles`, slots 1-5 in live data), default/alternative flags, and the shared resolver `src/shared/config/effective-ability.ts` (mirrored to `supabase/functions/_shared/config/effective-ability.ts`).
- Overrides are already narrow and typed: `label`, `description`, `tooltip`, `combat_text`, `scaling` (attribute substitution for `role: 'primary' | 'secondary'` tagged terms only — coefficients copied through untouched), `mechanic_calcs` (restricted to the mechanic template's declared params). Any validation error discards the whole override object and falls back to base.
- Server is authoritative: `authorizeQueuedAbility` in `supabase/functions/_shared/load-ability-calcs.ts` treats the client `ability_key`/`ability_type`/`cp_cost` as claims, checks class + unlock level + equipped loadout role, then `preflightAbilityConfig` aborts the cast on invalid config. `combat-tick` stamps canonical `ability_key` on events and persists `source_ability_key` on DoT rows.
- **Conflict 1 — one row per named class ability.** Live `abilities` has 37 rows / 36 distinct labels, essentially one per class ability. Class-facing identity today *is* `abilities.ability_key`, so a merge collapses identity unless a new class-facing key exists.
- **Conflict 2 — mechanic keys are per-class for T0 attacks.** `combat-tick` lines ~1311-1400 dispatch `fireball | power_strike | aimed_shot | backstab | smite | cutting_words` through **one shared code path**, then branch on hardcoded maps: `T0_STAT`, `T0_LABEL` verbs, `PHYSICAL_T0` set, a Backstab-specific message shape, and `if (paMech === 'smite' && c.class === 'templar')` for Judgment's verb and legacy ×0.8. That is the strongest consolidation evidence in the repo — and also the hardcoding that must move into configuration.
- **Conflict 3 — sharing a mechanic across classes already works, so the win is catalog size, not capability.** `root_debuff` is shared by `natures_snare` + `dissonance`; `party_regen` by `purifying_light` + `crescendo`; `smite` by `smite` + `judgment`; `fireball` by `fireball` + `frost_bolt` (wizard slot-1 alternative, and the only live `character_ability_loadout` row: 1 reference to `frost_bolt`).
- **Conflict 4 — no On-Hit Effect concept exists.** The only attached-effect machinery is mechanic-level: `STACK_EFFECT_TYPE` in `mechanic-templates.ts` maps `poison_stacks → poison` and `burn_stacks → ignite`, driven by the `poison_buff` / `ignite_buff` stances and consumed by `execute_attack` / `ignite_consume`. There is no typed effect registry, and no ability-level trigger/chance/stacks contract. `active_effects` is currently empty (0 rows), so no live data blocks a new shape.
- **Conflict 5 — parity blockers for merging (must be approved, not silently implemented):**
  - `judgment` carries the Templar ×0.8 nerf as a `finalMult` inside its own `amount_calc`; class overrides cannot touch whole formulas.
  - CP costs differ between otherwise-identical rows: `frost_bolt` 12 vs `fireball` 10; `dissonance` 25 vs `natures_snare` 40. Merging those pairs onto one base requires either a class-ability-level CP field or keeping them separate.
- Fallback duplication: `src/features/combat/utils/class-abilities.ts` still carries full `FALLBACK_LITERALS` per class and a `type` union listing every mechanic key; `ability-seed.ts` (581 lines) is mirrored to `supabase/functions/_shared/config/ability-seed.ts`. Every consolidation touches all three.

## 2. Current ability inventory (37 rows, all `status = active`, all assigned)

Grouped by mechanic; `D` = default, `A` = alternative.

| Ability key | Label | Mechanic | Class:slot | CP | Damage | Notes |
|---|---|---|---|---|---|---|
| power_strike | Power Strike | power_strike | warrior:1 D | 10 | physical | `physicalT0('str')`, weapon die |
| aimed_shot | Aimed Shot | aimed_shot | ranger:1 D | 10 | physical | `physicalT0('dex')` |
| backstab | Backstab | backstab | assassin:1 D | 10 | physical | `physicalT0('dex')`, custom hit/miss sentence, no weapon-tag suffix |
| fireball | Fireball | fireball | wizard:1 D | 10 | fire | `spellT0('int')` |
| frost_bolt | Frost Bolt | fireball | wizard:1 A | 12 | frost | `spellT0('int')`, CP differs |
| smite | Smite | smite | healer:1 D | 10 | holy | `spellT0('wis')` |
| judgment | Judgment | smite | templar:1 D | 10 | holy | `spellT0('wis')` + ×0.8 `finalMult`, templar verb branch |
| cutting_words | Cutting Words | cutting_words | bard:1 D | 10 | psychic | `spellT0('cha')` |
| second_wind | Second Wind | self_heal | warrior:2 D | 15 | – | CON |
| heal | Heal | heal | healer:2 D | 15 | – | WIS |
| transfer_health | Transfer Health | hp_transfer | healer:3 D | 25 | – | `reserve_hp` (CON) |
| purifying_light | Purifying Light | party_regen | healer:4 D | 40 | – | WIS/tick, CON duration, 3000ms |
| crescendo | Crescendo | party_regen | bard:4 D | 40 | – | CHA/tick, INT duration, 3000ms |
| inspire | Inspire | regen_buff | bard:2 D | 15 | – | `cp_per_tick` |
| divine_aegis | Divine Aegis | ally_absorb | healer:5 D | 60 | – | WIS pool, CON duration |
| force_shield | Force Shield | absorb_buff | wizard:2 D | 15 | – | stance |
| arcane_surge | Arcane Surge | damage_buff | wizard:3 D | 25 | – | stance, empowers wizard damage |
| eagle_eye | Eagle Eye | crit_buff | ranger:2 D | 15 | – | stance, DEX+WIS blend |
| battle_cry | Battle Cry | battle_cry | warrior:3 D | 25 | – | stance, shield DR bonus |
| shield_wall | Shield Wall | block_buff | templar:3 D | 25 | – | `block_chance`, `block_amount`; no `amount_calc` |
| holy_shield | Holy Shield | reactive_holy | templar:2 D | 25 | – | `retaliation_damage`; no `amount_calc` |
| consecrate | Consecrate | consecrate | templar:4 D | 40 | holy | node target, 2000ms ticks |
| divine_challenge | Divine Challenge | mitigation_buff | templar:5 D | 60 | – | flat reduction |
| rend | Rend | dot_debuff | warrior:4 D | 40 | physical | 2000ms, STR magnitude / DEX duration |
| sunder_armor | Sunder Armor | sunder_debuff | warrior:5 D | 60 | – | AC reduction |
| natures_snare | Nature's Snare | root_debuff | ranger:4 D | 40 | nature | base .25 + WIS diminishing .02/cap .15; dur 8000 + WIS, cap 15000 |
| dissonance | Dissonance | root_debuff | bard:3 D | 25 | psychic | identical coefficients on INT; CP differs |
| barrage | Barrage | multi_attack | ranger:3 D | 25 | physical | `arrow_count` ladder (DEX/WIS) |
| grand_finale | Grand Finale | burst_damage | bard:5 D | 60 | psychic | `crit_edge` |
| envenom | Envenom | poison_buff | assassin:3 D | 50 | poison | stance, on-hit poison apply, `max_stacks` |
| eviscerate | Eviscerate | execute_attack | assassin:4 D | 40 | physical | consumes poison stacks, `per_stack_multiplier` |
| ignite | Orbs of Fire | ignite_buff | wizard:4 D | 50 | fire | stance, per-heartbeat pulse |
| conflagrate | Conflagrate | ignite_consume | wizard:5 D | 60 | fire | consumes burn stacks |
| shadowstep | Shadowstep | stealth_buff | assassin:2 D | 15 | – | CHA ambush mult |
| cloak_of_shadows | Cloak of Shadows | evasion_buff | assassin:5 D | 60 | – | CHA dodge |
| disengage | Disengage | disengage_buff | ranger:5 D | 60 | – | next-hit window |

No deprecated, unassigned or orphan rows exist. Loadout references: exactly one (`frost_bolt`).

## 3. Proposed consolidation groups

**Group A — Safe (evidence: identical `physicalT0` calc, identical CP 10, identical damage type, one shared server code path).**
`power_strike` + `aimed_shot` + `backstab` → base **Focused Weapon Attack** (`focused_attack`). Class differences reduce to: scaling attribute (STR/DEX, expressible as a tagged `primary` term) and text (already an override key). Backstab's custom sentence and suppressed weapon-tag suffix move into `combat_text` fields.

| Property | Power Strike | Aimed Shot | Backstab | After (base + class config) |
|---|---|---|---|---|
| calc | physicalT0(str) | physicalT0(dex) | physicalT0(dex) | base physicalT0 with `role: primary`; class picks str/dex |
| CP | 10 | 10 | 10 | base 10 |
| damage type | physical | physical | physical | base physical (not configurable) |
| text | verb map | verb map | custom sentence | class `combat_text` (hit/miss/suffix policy) |
| identity | ability_key | ability_key | ability_key | class-ability key `power_strike` / `aimed_shot` / `backstab` (aliased) |

**Group B — Safe (identical coefficients, interval, caps; only attribute + flavor differ).**
`purifying_light` + `crescendo` → base **Party Regeneration** (`party_regeneration`). Same CP 40, same 3000ms, same 15000+attr×1000 duration cap 30000, same `base 2 + attr` per tick. `effect_config.source` (`healer`/`bard`) must become a derived/class value, not a base constant — verify no consumer branches on it before merging.

**Group C — Requires an approved CP decision + configurable damage type.**
`natures_snare` + `dissonance` → base **Damage Suppression** (`root_debuff` handler retained). Coefficients are byte-identical; blockers are CP 40 vs 25 and damage type nature vs psychic.

**Group D — Requires handler normalization + two approved exceptions.**
`smite` + `judgment` + `cutting_words` → base **Spell Strike**. Blockers: Judgment's ×0.8 `finalMult` (whole-formula, not overridable today) and per-class damage types holy/psychic. Recommended split of the decision: merge `smite` + `judgment` only if a declared class-level "ability multiplier" is approved; otherwise keep Judgment separate and merely retire its hardcoded templar branch in `combat-tick`.

**Remain separate (with reasons).**
- `fireball` / `frost_bolt` — user-directed; separate canonical identity and damage types are valuable, plus CP differs.
- All stances (`battle_cry`, `eagle_eye`, `envenom`, `ignite`, `force_shield`, `arcane_surge`, `shield_wall`) — distinct effect payloads, mutual-exclusion sets and CP reservation tiers.
- `heal` / `second_wind` — different mechanics (`heal` vs `self_heal`) and target rules.
- `eviscerate` / `conflagrate` — different stack types and consume semantics.
- Everything else is 1:1 mechanic:ability with no sibling.

Net effect if A + B are approved and C/D deferred: 37 → 33 rows, with the catalog shrinking further as C/D land.

## 4. Ownership model after the change

**Reusable base (`abilities`)** owns: mechanic handler, activation mode, target rules, calc structure and coefficients, which terms are role-tagged, supported mechanic params, whether damage type is configurable, whether an On-Hit Effect is supported (and which effect keys), default CP, validation schema, lifecycle status.

**Class-specific configuration (`class_ability_assignments`)** owns: stable class-ability key, label, description, tooltip, cast text, hit text, damage type *only where the base permits*, attribute substitution for tagged roles, declared mechanic params, optional On-Hit Effect config, unlock level, default/alternative state, status.

**Never exposed in Class Config:** mechanic selection, raw JSON in the normal UI, whole-formula replacement, coefficient authoring, unsupported mechanic params, CP overrides (unless the Group C/D exception is approved), any client-authored combat value.

Identity split after consolidation:
- base identity — `abilities.ability_key` (e.g. `focused_attack`)
- class-facing identity — new `class_ability_assignments.class_ability_key` (e.g. `power_strike`), protected and immutable after creation
- runtime handler — `abilities.mechanic_key`
- semantic effect — `active_effects.effect_type` / effect registry key
- damage type — resolved server-side from base or class override

Combat events, loadouts, logs, audit rows and admin surfaces switch to the class-facing key. Every existing `ability_key` is preserved verbatim as its class-ability key, so no external or saved reference is invalidated; a small alias table maps retired base keys to their new class-ability keys for one release.

## 5. Schema changes (minimum viable)

1. `class_ability_assignments.class_ability_key text` — not null after backfill, unique per class, immutable via trigger (extend the existing override-validation trigger).
2. `class_ability_assignments.damage_type text null` — accepted only when the base declares damage type configurable; validated in the trigger against the canonical damage-type list.
3. `class_ability_assignments.on_hit_effect jsonb not null default '{}'` — validated against the effect registry.
4. `abilities.damage_type_configurable boolean not null default false` and `abilities.supported_on_hit_effects text[] not null default '{}'`.
5. `ability_key_aliases (alias text pk, class_ability_key text, created_at)` — controlled alias resolution.
6. Optional, only if Group C/D approved: `class_ability_assignments.cp_cost int null` and/or `ability_multiplier numeric null`, both trigger-gated by a base-declared allowance.

No table drops, no column removals, all additive. GRANTs mirror the existing tables' policy set.

## 6. On-Hit Effect data model and trigger semantics

Stored shape on the assignment:

```json
{ "effect": "poison", "proc_chance": 0.25, "stacks_applied": 1, "max_stacks": 5,
  "duration_ms": 12000, "interval_ms": 2000, "roll_scope": "per_hit" }
```

Admin presentation (only fields the selected base + effect declare):

```text
On-Hit Effect: Poison
Trigger chance: 25%
Stacks applied: 1
Maximum stacks: 5
```

Trigger rules (server-resolved, client input ignored):
- rolls only after a successful direct hit on a valid target;
- miss, blocked application and zero-result non-hits never roll;
- periodic (DoT/regen) ticks never roll;
- reflected/retaliation and environmental damage never roll;
- On-Hit Effect damage cannot recursively trigger any On-Hit Effect;
- multi-hit/multi-target must declare `roll_scope`: `per_cast` | `per_target` | `per_hit` (Barrage defaults to `per_hit`, Consecrate to `per_target`);
- existing mechanics with different semantics (Envenom's stance-driven on-hit proc, Orbs of Fire's per-heartbeat pulse) keep their current behaviour and are **not** re-expressed as On-Hit Effects in this work.

Chance stays separate from scaling: `proc_chance` is its own typed field, never `amount_calc`, never a term coefficient. No universal chance field — a base must list the effect keys it supports.

## 7. Effect registry

None exists today, so add the smallest typed one: `src/shared/combat/effect-registry.ts` mirrored to `supabase/functions/_shared/combat/effect-registry.ts`, declaring per effect: key, admin label, `active_effects.effect_type`, allowed target, supported params with types/ranges, stack behaviour, duration/interval requirements, compatible mechanics/hit types, server handler id, presentation metadata. Seeded only with effects the audit found: `poison`, `ignite`, `bleed` (the `dot_debuff` shape). Validation lives in one module shared by admin, Class Config, the resolver, combat execution and tests; invalid configs are rejected before save, runtime falls back to "no effect" and writes one audit row.

## 8. Migration and rollback

Additive, reversible, parity-gated:

1. Add columns/tables and registry code (no behaviour change).
2. Teach resolver + runtime to read `class_ability_key`, class damage type and On-Hit Effect, still preferring existing values.
3. Backfill `class_ability_key` from each row's current `abilities.ability_key`; backfill label/description/tooltip/combat_text/scaling overrides and damage types for rows that will be repointed.
4. Repoint the approved groups' assignments to the consolidated base rows.
5. Migrate the one loadout row and any other persistent reference; populate aliases.
6. Snapshot effective config before and after and diff (test + one-off script).
7. Verify combat parity for all 37 class abilities.
8. Mark redundant base rows `deprecated` (never delete in this migration).
9. Later cleanup migration removes deprecated rows after confirmed parity.

Rollback at any step = revert code + set assignments back to their original `ability_id` (aliases and old rows still exist).

## 9. Admin UI changes

- Abilities page: one row per reusable base, with read-only usage (classes, class-facing names, slots, default/alternative).
- Class Config: shows the named class ability, not base keys; Base / Class / Effective columns from `EffectiveAbilityPreview` using the shared resolver only; On-Hit Effect as a contained optional section shown only when the base supports it, with fields filtered by the selected effect.
- No new combat math in the UI.

## 10. Runtime/server changes

- `combat-tick`: replace the `T0_STAT` / `T0_LABEL` / `PHYSICAL_T0` / templar-`smite` hardcoding with configured scaling + `combat_text`; add the On-Hit Effect roll at the single post-hit resolution point for supported mechanics; stamp class-facing identity on events and `active_effects.source_ability_key`.
- `load-ability-calcs.ts`: authorize and resolve by class-facing key with alias fallback; keep the legacy mechanic-hint path.
- `combat-catchup`, `_shared/combat-resolver.ts`, `_shared/config/*` mirrors updated in lockstep.

## 11. Files and migrations touched

Shared/config: `src/shared/config/{ability-seed,effective-ability,mechanic-templates}.ts`, new `src/shared/combat/effect-registry.ts`, plus the three Deno mirrors under `supabase/functions/_shared/`.
Client: `src/features/combat/utils/{class-abilities,ability-calcs,ability-loadout,ability-text,cast-flavor}.ts`, `src/hooks/{useAbilityRegistry,useAbilityLoadout}.ts`, `src/features/combat/events/*`.
Admin: `src/components/admin/AbilityConfigManager.tsx`, `src/components/admin/ability/*`, `src/components/admin/class/{ClassAbilityConfig,ClassConfigManager}.tsx`, `AbilityAssignPicker`, `EffectiveAbilityPreview`, `MechanicCalcsEditor`, new `OnHitEffectEditor`.
Server: `supabase/functions/combat-tick/index.ts`, `combat-catchup/index.ts`, `_shared/load-ability-calcs.ts`, `_shared/combat-resolver.ts`.
Migrations: (1) additive columns + alias table + trigger updates, (2) backfill + repoint, (3) later deprecation cleanup.

## 12. Tests and parity verification

New/extended suites: consolidated base appears once; multiple classes reuse it with distinct names/text; class-facing identity stable across loadout, events, logs; existing loadouts resolve post-migration; aliases resolve; attributes differ while coefficients are identical; configured damage type is server-authoritative and client-supplied values ignored; trigger chance never read as scaling; On-Hit Effect UI/schema exposes only supported fields; hit triggers, miss/blocked/zero-result does not; periodic and reflected damage cannot trigger or recurse; 0% never applies, 100% always applies; stack-cap/duration/interval validation; invalid config rejected on save; before/after effective-config diff empty for all 37 abilities; damage, timing and CP unchanged in live-equivalent combat tests. Existing `no-emoji`, parity and inventory snapshot suites must stay green (current baseline: full suite green).

## 13. Phases with approval checkpoints

- **Phase 1 — Identity foundation.** Class-facing key column + immutability trigger + alias table, backfill from current keys, resolver/runtime/admin read the new key. No consolidation. Checkpoint: identity tests green, zero behaviour change.
- **Phase 2 — Configurable damage type + On-Hit Effect infrastructure.** Effect registry, base capability flags, assignment columns, validation shared across all five layers, server trigger resolution at the single post-hit point. No ability merged. Checkpoint: trigger-semantics and validation tests green.
- **Phase 3 — Group A consolidation** (Focused Weapon Attack) including removal of the `combat-tick` T0 hardcoding, with before/after parity table. Checkpoint: parity diff empty.
- **Phase 4 — Group B consolidation** (Party Regeneration). Checkpoint: parity diff empty.
- **Phase 5 — Decision + optional Groups C/D**, only if the CP-cost and Judgment-multiplier exceptions are explicitly approved; otherwise these stay separate and only the templar hardcoding is removed.
- **Phase 6 — Cleanup.** Deprecated rows removed, fallback literals in `class-abilities.ts` trimmed to the consolidated set.

## 14. Required vs optional

Required: Phases 1-4 and 6. Optional/future: Groups C and D, retiring `FALLBACK_LITERALS` entirely, and admin usage analytics on the Abilities page.

Excluded per instruction: Orbs/Ignite separation, new abilities, new balance formulas, resistances, frost slow/chill, coefficient authoring, whole-formula overrides, chained effects, effect scripting, unrelated redesigns.
