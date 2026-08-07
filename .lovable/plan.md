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
- `status_trigger text` — enum-checked: `ability_hit`, `weapon_hit`, `successful_pulse_hit`, `activation`. Every trigger name denotes a **successful qualifying event** (see 4).
- `status_chance_pct integer` (**0..100**, default 100) — one authoritative unit; percent integers. `0` is valid and means the application never fires (an explicitly disabled application that keeps its authored configuration).
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
| orb_stance (`trigger_type = pulse`) | `successful_pulse_hit` | derived, read-only |
| defensive / heal / buff bases | none | Status Application section hidden |

Triggers are never inferred from names, log text or damage type; the name-based `abilityKey === 'ignite'` fallback and the `poison_buff`/`ignite_buff` name mapping are removed.

**Triggers are successful qualifying events, not attempts.** Formal semantics, enforced in the single application module (not at call sites):

- `ability_hit` — the ability's own attack resolved against a valid, living target and **landed** (not a miss, not a fizzle, not a cancelled or invalid-target cast).
- `weapon_hit` — a later autoattack from the stance owner **landed** on a valid living target.
- `successful_pulse_hit` (renamed from `stance_pulse`) — the stance's automatic attack (Orbs of Fire's orb) fired **and its attack roll landed damage** on a living target. A pulse that occurs but misses, has no valid target, or is cancelled applies nothing. Orbs of Fire therefore applies Ignite only on a landed orb hit, exactly as today.
- `activation` — the only non-hit trigger: the ability's own activation succeeded and paid its cost (used by self/ally applications; no live row uses it yet).

`applyStatusFromSource()` takes an explicit `landed: boolean` (plus target-alive check) and returns `null` without consuming a chance sample when it is false, so no call site can shortcut the rule.

## 5. Shared runtime application point

New shared module `applyStatusFromSource()` (`src/shared/combat/status-application.ts` + Deno mirror), used by every path: does status lookup, compatibility assertion, successful-event gate (`landed` + target alive), chance roll (caller supplies the sample for determinism), magnitude/duration composition from the reusable definition, stack/refresh via `applyStackingEffect`, source attribution (`source_id`, `source_ability_key`), activation timing, and returns a structured event. It never computes the source attack.

Call sites converted: `combat-tick` ability branch (replaces both `applyAmpStatus` and the `rollOnHitEffect` block), `dot_debuff` branch, `stack_apply` on-hit branch, `stack_apply` pulse branch. Client mirror `src/features/combat/utils/combat-resolver.ts` stays in sync for tests.

### Catch-up integration point

`combat-catchup` does not get a parallel implementation. It calls the **same** `applyStatusFromSource()` from the Deno mirror, once per reconstructed tick, with the same compatibility check, chance semantics, magnitude/duration composition, stacking, refresh (cadence-preserving `next_tick_at`), tick-boundary timing and source attribution. The only difference is the clock: catch-up passes the reconstructed tick timestamp instead of `now`.

Determinism of historical chance samples: catch-up never calls `Math.random()`. The sample is produced by a seeded, pure PRNG derived from a stable tuple — `(source_character_id, target_creature_id, ability_key, status_key, tick_index)` — so:

- Re-running catch-up over the same tick range yields byte-identical outcomes; a repeated or overlapping run cannot reroll a proc into existence.
- Application writes stay idempotent: a status row already carrying the same `source_ability_key` and a `started_at` at that tick index is treated as already applied and is not stacked again.
- Catch-up advances `last_tick_at` (and therefore the tick index) under the existing reconcile lock, so two concurrent invocations cannot both claim the same tick.

Live ticks keep using `Math.random()` (unchanged behaviour); only reconstructed history is seeded, and the seeded sampler lives in the shared module so both paths share one code path for everything else.

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

1. **Migration A** — add the new columns + checks; backfill: every ability with `applied_status` gets its derived trigger, target `enemy`, chance 100; add `magnitude.min_per_tick = 1` to bleed/poison/ignite; extend the four `capabilities` lists. **Fireball's status backfill is held out of Migration A** until the balance decision below is answered, so the structural pass can land without changing any live combat number.
2. **Step 2** — regenerate Supabase types; land the shared application module, both mirrors, `compose-ability`, `effective-ability` validation, seeds (`ability-seed.ts` `on_hit_allowed` removed), and switch all four runtime call sites in one change so legacy and new paths never both execute.
3. **Step 3** — admin UI replacement.
4. **Migration B** (after verification) — drop `abilities.on_hit_effect`, `base_abilities.on_hit_allowed`, the SQL on-hit validation trigger, the `on_hit_effect` capability, and delete `src/shared/combat/on-hit-effects.ts` + its Deno mirror and `ability-taxonomy` entry.

`spell_bolt` is **preserved as-is for this pass.** Frost Bolt keeps its existing `base_ability_id -> spell_bolt` relationship; any later consolidation of `spell_bolt` into `spell_attack` is explicitly out of scope. `spell_bolt` only gains the `applied_status` capability so the capability list matches the runtime path Frost Bolt already uses.

IDs, base relationships, class assignments, defaults/alternatives and player loadouts are untouched throughout (only new columns added, legacy columns dropped last). Migration A is reversible until Migration B.

### Fireball: explicit balance decision required (not a small buff)

Fireball is the one ability whose numbers change, and the change is **substantial** — not cosmetic. Live values: legacy on-hit ignite = 25% chance, 3 damage/tick, 6000 ms, max 3 stacks. Reusable `ignite` = fire, magnitude `secondary * 0.7 * 0.67` (0.469/point), duration `30000 + 1000/point` capped at 45000 ms, max 5 stacks, no explicit tick interval (inherits the 2000 ms combat cadence).

Before/after for one landed 25% proc, at representative Wizard stats (2 s ticks):

| Character | Legacy per application | Reusable ignite per application | Factor |
|---|---|---|---|
| INT 14 (early) | 3 dmg x 3 ticks = **9** | 6 dmg x 22 ticks (44 s) = **132** | ~15x |
| INT 20 (mid) | 3 dmg x 3 ticks = **9** | 9 dmg x 22 ticks (45 s cap) = **198** | ~22x |
| INT 28 (late) | 3 dmg x 3 ticks = **9** | 13 dmg x 22 ticks (45 s cap) = **286** | ~32x |

Fully stacked ceiling: legacy 3 stacks x 3 dmg = 9 dmg/tick for 6 s (**27**); reusable 5 stacks x 13 dmg = 65 dmg/tick for 45 s (**~1430** at INT 28). Because the duration (45 s) far exceeds a normal Fireball cooldown, repeated casts realistically hold Fireball near the stack ceiling in sustained fights, so this is closer to a new damage pillar for the Wizard than a tuning nudge. Setting `secondary_attribute = int` (Fireball has none today) is what unlocks the scaled magnitude and duration, so it is part of the same decision.

Options, ranked:

- **A (recommended, zero balance change): add an `ignite_light` reusable status** — 3 damage/tick equivalent, 6000 ms, max 3 stacks, no attribute scaling. Fireball backfills to `applied_status = ignite_light`, `status_chance_pct = 25`, no `secondary_attribute` change. Consolidation completes with live damage byte-identical, and any Fireball buff becomes a separate, deliberate balance pass.
- **B (adopt shared ignite as-is)** — Fireball gets `applied_status = ignite`, `secondary_attribute = int`, chance 25%. Accepts the 15x-32x per-proc increase above.
- **C (adopt shared ignite, retuned)** — as B, but lower Fireball's chance and/or `class_scale` so measured sustained fire DoT output lands near today's; requires a tuning target from you.

**Nothing is applied to Fireball until you pick A, B or C.**

## 9. Tests

New/extended Vitest suites (`src/test/combat/status-application.test.ts`, extending `chilled-status.test.ts`, `foundation.test.ts`, `ability-library.test.tsx`):
- Frost Bolt applies Chilled at 100% on a landed hit; its own hit is not amplified; Chilled behaviour, damage and CP cost unchanged.
- Bleed / Poison / Ignite resolve from one reusable definition on every path (ability hit, on-hit stance, orb pulse, DoT ability, catch-up).
- Editing a reusable status changes new applications from all sources.
- Chance lives on the relationship: 0% is valid and never applies, 100% always applies on the qualifying successful event, intermediate values roll only at that event.
- Successful-event semantics: a missed attack, a dead/invalid target and a cancelled cast apply nothing and consume no chance sample; an Orbs of Fire pulse that misses applies no Ignite while a landed orb hit does.
- Unsupported base/status combinations fail validation and cannot be saved; every selectable admin option has a runtime path.
- No double application from one landed hit; intentional stacking and refresh follow the status definition (cadence preserved).
- Non-damaging status never ticks; 0 calculated damage stays 0; bleed/poison/ignite keep their explicit minimum of 1.
- Catch-up parity: catch-up and live paths produce identical rows for the same tick; re-running catch-up over an already-processed range is idempotent and cannot reroll a proc (seeded sampler + idempotent write).
- Party determinism, catch-up tick-accurate application/expiry, kill credit and source attribution, structured apply/refresh/stack/expiry events, no emoji.
- Parity: combat numbers unchanged for abilities with no status application; Frost Bolt keeps its `spell_bolt` base.

## 10. Balance observations (not implemented)

- Fireball's ignite is materially weaker than every other ignite source (see 8).
- `spell_attack`'s `on_hit_allowed` currently offers bleed/poison on spells, which is thematically odd; the derived compatibility model narrows this naturally.
