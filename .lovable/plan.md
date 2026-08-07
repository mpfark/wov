# Consolidate Applied Status + On-Hit Effect into one Status Application system

Structural consolidation only. No balance changes except one legacy conflict (Fireball) that needs a decision.

## 1. Audit findings (verified against the live database and repository)

### Two competing systems exist today

**A. Applied Status (reusable, correct direction)**
- Storage: `abilities.applied_status text` -> `applied_statuses.key`.
- Reusable definitions in `applied_statuses` (live rows): `bleed`, `poison`, `ignite`, `chilled`, each owning `classification`, `is_periodic`, `magnitude`, `duration`, `stacks`, `default_damage_type`, `modifier`.
- Composition: `src/shared/config/compose-ability.ts` -> `statusEffectConfig()` flattens the status onto `effect_config` as `dot_*` keys (periodic) or `amp_*` keys (`damage_amp`), binding `role: primary|secondary` to the configured use's `primary_attribute` / `secondary_attribute`.
- Runtime: mirrored file `supabase/functions/_shared/config/compose-ability.ts`, loaded through `_shared/load-ability-calcs.ts` (which also selects `applied_statuses`), consumed by `combat-tick` (`applyAmpStatus`, `applyConfiguredStack`, `dot_debuff` branch) and `combat-catchup` (`getAppliedStatusDefs`).

**B. Optional On-Hit Effect (legacy, hardcoded)**
- Storage: `abilities.on_hit_effect jsonb` (chance, duration, damage/tick, max stacks) plus base allowlist `base_abilities.on_hit_allowed text[]`.
- Definitions: hardcoded `ON_HIT_EFFECTS` in `src/shared/combat/on-hit-effects.ts` and its Deno mirror — a **second authority** for bleed / poison / ignite (own `effectType`, `damageType`, `stackCeiling: 5`).
- Validation: `validateOnHitEffect` / `allowedOnHitEffects` used by `src/shared/config/effective-ability.ts` (plus `baseOnHitEffect()` reading `effect_config.on_hit_effect`) and a SQL trigger.
- Admin: `src/components/admin/class/OnHitEffectEditor.tsx`, rendered from both `AbilityConfigManager.tsx` (capability `on_hit_effect`) and `class/ClassAbilityConfig.tsx` (writes `class_ability_assignments.overrides.on_hit_effect`).
- Runtime: `combat-tick/index.ts` (~line 1779) rolls `rollOnHitEffect(auth.entry.onHitEffect, Math.random())` after any landed ability hit and writes `active_effects` via `applyStackingEffect`, entirely bypassing `applied_statuses`.

### Confirmed inconsistencies

1. **Live competing definition.** Only one row uses the legacy path: `fireball` -> `on_hit_effect = {effect: ignite, chance_pct: 25, duration_ms: 6000, damage_per_tick: 3, max_stacks: 3}`. Reusable `ignite` says: fire, base 30000 ms (+1000/pt secondary, cap 45000), magnitude `stat_mult 0.7 * global 0.67` from the secondary role, max 5 stacks. **These differ and must be resolved by decision (see 8).** No `class_ability_assignments.overrides` currently contains `on_hit_effect` (verified: zero rows).
2. **Same status through both controls.** `spell_attack` / `spell_bolt` / `weapon_attack` / `multi_attack` all have `on_hit_allowed = [ignite,bleed,poison]` (or `[bleed,poison]`); the Applied Status dropdown is not restricted by classification, so ignite could be picked twice on one ability.
3. **Saves but does nothing.** `combat-tick` only applies an `applied_status` from a `spell_attack`-family hit when it is a **`damage_amp`** status (`applyAmpStatus` requires `amp_effect_type`). Selecting `poison` / `bleed` / `ignite` as Applied Status on Fireball or Frost Bolt saves successfully and is silently ignored at runtime. Conversely `spell_attack` and `spell_bolt` do not even declare the `applied_status` capability, yet `frost_bolt` stores `applied_status = chilled` and works — the capability list and the runtime already disagree.
4. **Trigger is inferred, not declared.** Stack appliers derive trigger from `effect_config.trigger` with a hardcoded fallback keyed on the ability name (`abilityKey === 'ignite' ? 'pulse' : 'on_hit'`), and legacy `mb.poison_buff` / `mb.ignite_buff` flags are name-mapped back to `envenom` / `ignite`.
5. **Chance representations diverge.** Legacy on-hit: integer percent 1..100. Stack appliers: a 0..1 probability produced by the ability's `amount_calc` via `resolveMagnitude`. Applied Status has no chance at all (implicitly 100%).
6. **Zero damage becomes one.** `applyStackingEffect` (`src/shared/combat/status.ts` and its Deno mirror) hardcodes `damage_per_tick: Math.max(1, Math.floor(...))`, so an on-hit effect authored with 0 damage/tick ticks for 1. Also `combat-tick:1796` `Math.max(1, Math.floor(onHit.damagePerTick * bond))`.
7. **Changing a reusable status does not affect on-hit applications** at all today — they read the hardcoded registry plus per-ability JSON.

### Current status-producing inventory (live rows)

| Ability (configured use) | Base | Mechanic | Current status source | Trigger in runtime | Chance |
|---|---|---|---|---|---|
| Frost Bolt | spell_bolt | spell_attack | `applied_status = chilled` | landed ability hit | implicit 100% |
| Fireball | spell_attack | spell_attack | legacy `on_hit_effect` ignite | landed ability hit | 25 (percent) |
| Rend | dot_debuff | dot_debuff | `applied_status = bleed` (+ `effect_config.effect_type`) | landed ability hit | implicit 100% |
| Envenom | on_hit_stance | stack_apply | `applied_status = poison` | later successful weapon hit | `amount_calc` 0..1 |
| Orbs of Fire | orb_stance | stack_apply | `applied_status = ignite` | orb pulse hit | `amount_calc` 0..1 |
| Eviscerate | stack_consume_weapon | stack_consume | consumes `stack_type = poison` | n/a (consumer) | n/a |
| Conflagrate | stack_consume_spell | stack_consume | consumes `stack_type = ignite` | n/a (consumer) | n/a |
| Barrage / Aimed Shot / Backstab / Power Strike / Weapon Strike / Smite / Judgment / Cutting Words | various | — | none configured; only `on_hit_allowed` offered | — | — |

Item procs use a separate `items.procs` system (`resolveProcs`, `_shared/proc-log-format.ts`) and do **not** use `ON_HIT_EFFECTS`; they stay untouched.

## 2. Ownership boundary

**Reusable status (`applied_statuses`)** keeps: classification, periodic flag, damage type, magnitude calc, duration (ms or `duration_ticks`), tick interval, max stacks + stack roles, refresh behaviour, `modifier` (percent + eligible sources), label/description.

**Status Application (new, on the configured use)** owns only: status key, trigger, chance, target, enabled flag. Nothing else — no duration, damage, stacks or amplification percent.

Source-provided inputs stay where they already are: the configured use's `primary_attribute` / `secondary_attribute` (bound to the status's `role` fields) and `class_scale`. That preserves Orbs of Fire's INT proc-chance/orb-damage and WIS ignite magnitude/duration, and lets Fireball apply the same ignite with its own attributes.

## 3. Proposed schema (smallest clean change)

Typed columns on `abilities` (matches the project's existing "typed columns for authored config" pattern; one application per configured use is sufficient — no live ability needs two):

- `applied_status` — kept, becomes the application's status reference (FK-style text to `applied_statuses.key`).
- `status_trigger text` — enum-checked: `ability_hit`, `weapon_hit`, `stance_pulse`, `activation`.
- `status_chance_pct integer` (1..100, default 100) — one authoritative unit; percent integers.
- `status_target text` — `enemy` only for now, derived from the base's target when inherent, stored for clarity.
- `status_application_enabled boolean default true`.
- Drop after cutover: `abilities.on_hit_effect`, `base_abilities.on_hit_allowed`, `effect_config.on_hit_*` keys, `on_hit_effect` capability.
- `base_abilities.capabilities` gains `applied_status` on `spell_attack`, `spell_bolt`, `weapon_attack`, `multi_attack`; `on_hit_effect` removed everywhere.

Compatibility is **derived**, not a new list: a base ability may apply a status when `mechanic_key` is in the typed capability map (which trigger(s) that mechanic can raise) and the status's classification is supported by that trigger's runtime application path. `base_abilities.trigger_type` (`none` / `on_hit` / `pulse`) already carries the stance cases and is reused.

## 4. Trigger model per base

| Base mechanic | Allowed trigger | Derived / editable |
|---|---|---|
| spell_attack, spell_bolt, weapon_attack, multi_attack, burst_damage, dot_debuff | `ability_hit` | derived, read-only |
| on_hit_stance (`trigger_type = on_hit`) | `weapon_hit` | derived, read-only |
| orb_stance (`trigger_type = pulse`) | `stance_pulse` | derived, read-only |
| defensive / heal / buff bases | none | Status Application section hidden |

Triggers are never inferred from names, log text or damage type; the name-based `abilityKey === 'ignite'` fallback and the `poison_buff`/`ignite_buff` name mapping are removed.

## 5. Shared runtime application point

New shared module `applyStatusFromSource()` (`src/shared/combat/status-application.ts` + Deno mirror), used by every path: does status lookup, compatibility assertion, chance roll (caller supplies the sample for determinism), target-alive validation, magnitude/duration composition from the reusable definition, stack/refresh via `applyStackingEffect`, source attribution (`source_id`, `source_ability_key`), activation timing, and returns a structured event. It never computes the source attack.

Call sites converted: `combat-tick` ability branch (replaces both `applyAmpStatus` and the `rollOnHitEffect` block), `dot_debuff` branch, `stack_apply` on-hit branch, `stack_apply` pulse branch; `combat-catchup` reuses the same definitions for historical ticks. Client mirror `src/features/combat/utils/combat-resolver.ts` stays in sync for tests.

Timing preserved exactly as today: periodic statuses tick from `now + tick_rate`; `damage_amp` statuses use the frozen per-tick `ampSnap`, so Frost Bolt's own hit is never amplified and Chilled starts on the following tick, identical for every party member regardless of iteration order.

## 6. Zero-damage correction

`applyStackingEffect` stops forcing a minimum: `damage_per_tick = Math.max(0, Math.floor(input.damagePerTick))`, and non-periodic statuses always write `damage_per_tick: 0`, `next_tick_at: null`. Where a genuine damaging status must never tick for 0, the floor becomes an explicit opt-in field on the status definition (`magnitude.min_per_tick`), set to `1` for the existing `bleed` / `poison` / `ignite` rows so live DoT numbers are unchanged.

## 7. Admin interface

`Applied Status` and `Optional On-Hit Effect` are replaced by one `Status Application` section in `AbilityConfigManager.tsx`; the block in `class/ClassAbilityConfig.tsx` is removed (no live overrides exist), and `OnHitEffectEditor.tsx` is deleted. Layout follows the existing card/label conventions:

```text
Status Application
  Status    [ Chilled              v ]   (only compatible statuses)
  Trigger   Successful ability hit      (inherited)
  Target    Enemy                        (inherited)
  Chance    [ 100 ] %

  Inherited from status "Chilled"  [Edit reusable status]
    +10% damage taken - 3 combat ticks - does not stack - reapplication refreshes
```

DoT fields never render for `damage_amp` statuses and amplification fields never render for DoTs; the summary states that edits to the reusable status affect all sources; invalid combinations cannot be saved and existing incompatible rows surface a validation error.

## 8. Migration (staged, no dual authority)

1. **Migration A** — add the new columns + checks; backfill: every ability with `applied_status` gets its derived trigger, target `enemy`, chance 100; Fireball is backfilled to `applied_status = ignite`, trigger `ability_hit`, `status_chance_pct = 25`; add `magnitude.min_per_tick = 1` to bleed/poison/ignite; extend the four `capabilities` lists.
2. **Step 2** — regenerate Supabase types; land the shared application module, both mirrors, `compose-ability`, `effective-ability` validation, seeds (`ability-seed.ts` `on_hit_allowed` removed), and switch all four runtime call sites in one change so legacy and new paths never both execute.
3. **Step 3** — admin UI replacement.
4. **Migration B** (after verification) — drop `abilities.on_hit_effect`, `base_abilities.on_hit_allowed`, the SQL on-hit validation trigger, the `on_hit_effect` capability, and delete `src/shared/combat/on-hit-effects.ts` + its Deno mirror and `ability-taxonomy` entry.

IDs, base relationships, class assignments, defaults/alternatives and player loadouts are untouched throughout (only new columns added, legacy columns dropped last). Migration A is reversible until Migration B.

**Decision required:** Fireball's legacy ignite (25%, 3 dmg/tick, 6 s, 3 stacks) is weaker and shorter than reusable `ignite` (WIS-scaled magnitude, 30-45 s, 5 stacks). Recommendation: keep chance at 25% and adopt the reusable ignite definition (a small buff), because per-source duration/damage overrides are explicitly out of scope. The alternative is a second `ignite_light` status row preserving the old numbers exactly. Fireball has no `secondary_attribute` today, so adopting reusable ignite also requires setting one (recommend `wis` -> `int` reuse: set `secondary_attribute = int`) — also needs approval.

## 9. Tests

New/extended Vitest suites (`src/test/combat/status-application.test.ts`, extending `chilled-status.test.ts`, `foundation.test.ts`, `ability-library.test.tsx`):
- Frost Bolt applies Chilled at 100% on a landed hit; its own hit is not amplified; Chilled behaviour, damage and CP cost unchanged.
- Bleed / Poison / Ignite resolve from one reusable definition on every path (ability hit, on-hit stance, orb pulse, DoT ability, catch-up).
- Editing a reusable status changes new applications from all sources.
- Chance lives on the relationship: 0% never applies, 100% always applies on the qualifying trigger, intermediate values roll only at the trigger, a miss never applies.
- Unsupported base/status combinations fail validation and cannot be saved; every selectable admin option has a runtime path.
- No double application from one landed hit; intentional stacking and refresh follow the status definition (cadence preserved).
- Non-damaging status never ticks; 0 calculated damage stays 0; bleed/poison/ignite keep their explicit minimum of 1.
- Party determinism, catch-up tick-accurate application/expiry, kill credit and source attribution, structured apply/refresh/stack/expiry events, no emoji.
- Parity: combat numbers unchanged for abilities with no status application.

## 10. Balance observations (not implemented)

- Fireball's ignite is materially weaker than every other ignite source (see 8).
- `spell_attack`'s `on_hit_allowed` currently offers bleed/poison on spells, which is thematically odd; the derived compatibility model narrows this naturally.
