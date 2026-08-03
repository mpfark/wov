# Correction Plan v2 — Base-Ability Library + Class Ability Configuration

Incorporates the audit feedback. Scope is the correction only: canonical ability identity in presentation and events, Frost Bolt combat text, the admin base/class split, typed validated assignment overrides, correct attribute-scaling configuration, and one shared effective-ability resolver.

## Repository evidence that conflicts with a requirement (report first)

1. **No class "primary/secondary attribute" definition exists.** `classes` carries `base_hp`, `base_ac`, `crit_range`, `level_bonuses`, `weapon_proficiencies`, `restrictions`; `class-authoring.ts` has no stat-priority concept. Class stat identity is **not** inferred from `level_bonuses`. Decision (preferred approach): Migration A adds explicit `primary_attribute` and `secondary_attribute` columns to `classes`, each validated as `str|dex|con|int|wis|cha`. Class Config may then offer "Primary"/"Secondary" as UI shortcuts, but the assignment override always stores the **deliberately resolved concrete attribute**, so a later class-identity change never silently rebalances existing abilities. Backfill sets each class's two columns to the attributes its current formulas already scale from (annotation only, no formula change); if any class is ambiguous, that class ships without shortcuts and shows only the six concrete attributes.
2. **Several approved formulas genuinely blend two attributes** (Eagle Eye DEX+WIS, Warrior STR magnitude / DEX duration, Envenom DEX proc + CHA ceiling). So model **A** (single scaling attribute) cannot represent them. Chosen model is **A-with-roles**: base calc stat terms may be tagged with a role (`primary` / `secondary`), and an assignment override supplies a concrete attribute per tagged role. Untagged terms are never rewritten. **No coefficient authoring at all** in this correction — a tagged term's base coefficient (`mult`) is preserved exactly.

3. **`effect_type` is an existing semantic taxonomy**, not an ability identity: `tick-event-builder.ts` / `reward-event-builder.ts` / `threat-event-builder.ts` map event kinds to values like `resist`, `stack`, `cleanse`, `xp`, `gold`, `engage`. It is used for log classification and effect handling. It will **not** be replaced; `abilityKey` is added alongside it.
4. **`abilities.combat_text jsonb` already exists and is entirely unread at runtime** (all seed values `{}`; only `AbilityAuthorDialog` writes an empty object). It becomes the home for ability-specific authored flavor — no new column for text.
5. **No repository use case for class-specific CP cost exists** — `cp_cost` is read from the ability row everywhere. Per the feedback, `cp_cost` stays a base property and is **excluded** from overrides.

## Part 1 — Canonical ability identity in presentation and events

Verified defects: `ClassAbility.type` *is* the mechanic key (populated from `row.ability.mechanic_key` in `setAbilityRegistry`); `useCombatActions.ts:289` calls `getCastFlavor(ability.type, …)`; `ability-loadout.ts` computes `abilityKey`/`damageType` on `LoadoutOption` but drops both when building the `ClassAbility`. Calc identity (`ABILITY_CALCS` keyed by `ability_key`) and wire identity (`useCombatDriver` sends `ability_key`, `combat-tick` re-authorizes it) are already correct.

Changes:

1. `ClassAbility` gains `abilityKey: string` and `damageType: string | null`. Populated from `row.ability.ability_key` in `setAbilityRegistry`, from `ABILITY_SEED` in the compiled fallback (so sealed mode always carries `ability_key`), and preserved by `setClassAbilityList` and `applyAbilityLoadout`.
2. New `src/features/combat/utils/ability-text.ts`:
   - registry of authored `combat_text` keyed by `ability_key`, primed from the seed and refreshed by `useAbilityRegistry`;
   - `resolveCastFlavor(ability, characterClass, targetName)` resolution order: authored `combat_text.cast` → ability-key flavor entry → mechanic-key flavor entry (fallback only).
3. `cast-flavor.ts` keeps its tables, re-keyed by ability key with the current mechanic keys retained as fallback entries; a `frost_bolt` entry is added.
4. `useCombatActions.ts` uses `resolveCastFlavor(ability, …)`. `ability.type` remains the execution switch — no new mechanic handler.
5. Structured events keep their semantics. Event payloads gain optional `abilityKey` (canonical identity) and keep `effectType` (semantic class), `damageType` (authoritative metadata); `mechanicKey` is added only where a consumer needs the handler identity. Log classification, colour families, severity, effect handling and tick timing all continue to read `effectType`/`damageType` — an inventory pass over `tick-event-builder.ts`, `reward-event-builder.ts`, `threat-event-builder.ts`, `presentation.ts`, `legacy-adapter.ts` and `log-event.ts` confirms no classifier switches on the new field, and a snapshot test pins classification output before/after.
6. Presentation paths audited: queued-cast flavor, ability buttons/tooltips (`AbilityBar`, `AbilityLoadoutTab` — add damage-type display from `ability.damageType`), structured events, and the resolved-hit text in `combat-tick` (which gains the same `combat_text` lookup via `_shared/load-ability-calcs.ts`, mechanic default as fallback).

## Part 2 — Attribute scaling model (correcting "weight")

Scaling attributes live inside `AbilityCalc.terms[].stat` (`ability-calc.ts`). The additive model:

- Base calc stat terms may carry an optional `role: 'primary' | 'secondary'` marker (new optional field on `CalcTerm`; absent = not overridable).
- Assignment override: `scaling: { primary_attribute?: CalcStat, secondary_attribute?: CalcStat }` — attributes only.
- The resolver rewrites **only the `stat` field** of tagged terms. `mult`, transforms, rounding, thresholds and every other term property are copied through untouched, so a class override can never change a coefficient or curve.
- `chance_on_hit` and every other mechanic parameter stay entirely separate — they are `mechanic_calcs` params, never touched by `scaling`.
- Coefficient authoring is explicitly deferred; no `primary_coefficient` / `secondary_coefficient` field exists in the schema, resolver, validator or UI.


### Parameter classification inventory (`mechanic-templates.ts`, verified)

| Param | Mechanic(s) | Classification |
|---|---|---|
| `arrow_count` | multi_attack | count / flat magnitude |
| `max_stacks` | poison_buff | stack cap |
| `per_stack_multiplier` | execute_attack, ignite_consume | multiplier |
| `block_chance` | block_buff | proc/chance — **not** attribute scaling |
| `block_amount` | block_buff | flat magnitude |
| `crit_edge` | burst_damage | flat threshold |
| `retaliation_damage` | reactive_holy | flat magnitude (hp) |
| `reserve_hp` | hp_transfer | threshold |
| `cp_per_tick` | regen_buff | rate |
| `amount_calc` | all | headline magnitude (also the proc chance for `poison_buff` / `ignite_buff`) |
| `duration_calc` / `interval_ms` | timed mechanics | duration / interval |

The Class Config override editor renders only the params the selected mechanic's template declares — no generic fields, no `weight` field anywhere.

### Backfill

For every existing assignment: overrides start empty, and role tags are added to base calcs such that the untagged→tagged conversion is a pure annotation (the stat and mult stay literally identical). Verified by a per-assignment numerical parity test across the level/stat range, so effective values are bit-identical to today. No balance change.

## Part 3 — Admin split

**Abilities page** (`AbilityConfigManager.tsx` rewritten): queries `abilities` directly — no assignment join, no class grouping, no `AssignmentMatrix`. Each base ability appears once. Editable: label, description, tooltip, `ability_type`, `activation_mode`, `target_type`, `cp_cost`, `damage_type`, `amount_calc`/`duration_calc`/`interval_ms`, `mechanic_calcs`, `combat_text`, `status` — each labelled as a global default. Class/slot/unlock/is_default controls removed. `AbilityAuthorDialog` loses its role/alternative arguments.

**Canonical identity protection.** `ability_key` is set at creation only; afterwards it renders read-only with a copy affordance, and renaming requires an explicit migration/alias workflow (documented, not exposed in the UI). `mechanic_key` is presented as a guarded change: a warning that it changes executable behaviour, a re-validation of the row against the new mechanic template (`validateAbilityForPublish`), and it is **blocked** while the ability is `active` or referenced by any non-retired `class_ability_assignments` row. The controlled path is: retire or unassign → change mechanic → re-validate calcs/params → re-publish. Enforced both in the UI and by extending the existing `public.validate_ability_row()` trigger so the block cannot be bypassed. Ordinary presentation fields stay directly editable.

**Class Config page** (`ClassConfigManager.tsx`): the class editor gains explicit `primary_attribute` / `secondary_attribute` selectors, plus a new "Ability Configuration" section with exactly the five `class_ability_roles` slots. Per slot: default base ability, alternatives, ability picker sourced from the base library, unlock level, default/alternative state, assignment status, class-specific override editor (presentation/flavor, `scaling` attributes for tagged terms, supported mechanic params), the effective configuration, and a preview using the shared resolver. Promote-to-default reuses the existing `set_assignment_default` RPC and its one-default-per-slot partial unique index. `AssignmentMatrix.tsx` moves here as the read-only overview. New components under `src/components/admin/class-abilities/`.


No data is lost: the assignment rows the old page edited stay in `class_ability_assignments`; only the editing location moves.

## Part 4 — Shared effective-ability resolver and validation authority

`src/shared/config/effective-ability.ts` (mirrored to `supabase/functions/_shared/config/effective-ability.ts`):

```
validateAssignmentOverrides(baseRow, overrides) -> string[]
resolveEffectiveAbility(baseRow, assignmentRow) -> { ability, errors }
```

Authoritative TypeScript validation (mechanic-aware): allowed override keys, `scaling` roles that actually exist as tagged terms in the base calc, and mechanic params belonging to the base mechanic.

**Override allowlist (narrow).** Exactly: `label`, `description`, `tooltip`, `combat_text`, `scaling` (`primary_attribute` / `secondary_attribute` only), `mechanic_calcs` (params of the base mechanic only). Whole-formula overrides — `amount_calc`, `duration_calc`, `interval_ms` — are **not** permitted: no repository evidence shows an existing class-specific need, so they remain base-ability properties. Unlock level, default/alternative state and lifecycle status stay as their existing dedicated assignment columns, not as JSON overrides. `cp_cost` is excluded (base property).

**Validation-authority split (chosen approach 3, plus a parity test):** SQL validates *structural shape and primitive allowlists only* — `overrides` must be a JSON object, keys drawn from the SQL allowlist above, `scaling` containing only `primary_attribute`/`secondary_attribute` with values in the six stat literals, `combat_text` values as strings within length limits. Whether a field is *supported by the selected mechanic* is decided by the shared TypeScript resolver used by client, server and admin preview. A parity test asserts the SQL key allowlist matches the TypeScript key union, failing loudly if either drifts. No mechanic-template duplication in SQL.


**Failure behaviour (deterministic, no silent partial merge):** if `validateAssignmentOverrides` returns any error, the resolver **discards the override object entirely** and resolves the assignment from its base configuration — never a partial deep-merge. It returns the errors alongside, and:

- server (`combat-tick`, `combat-catchup`): logs a configuration error to `combat_audit_log` (same channel the existing config-error path uses) with `class_key`, `ability_key`, and the error list, then proceeds on base configuration so live combat never breaks;
- admin preview: renders the errors prominently and shows the invalid fields still populated and flagged — nothing disappears silently;
- admin save: blocked while errors exist, so invalid values are not stored in the first place.

Existing assignments have empty overrides, so they are unaffected throughout deployment.

## Migration (additive) and deployment order

1. **Migration A** — additive only:
   - `ALTER TABLE public.class_ability_assignments ADD COLUMN overrides jsonb NOT NULL DEFAULT '{}'::jsonb;`
   - `ALTER TABLE public.classes ADD COLUMN primary_attribute text, ADD COLUMN secondary_attribute text;` with a validation trigger restricting both to `str|dex|con|int|wis|cha` (nullable, so a class may ship without shortcuts), plus a backfill `UPDATE` setting each existing class to the attributes its current formulas already scale from.
   - `CREATE FUNCTION public.validate_assignment_overrides()` (structural/primitive checks above, `SECURITY DEFINER`, `SET search_path = public`) + `BEFORE INSERT OR UPDATE` trigger.
   - Extend `public.validate_ability_row()` to reject a `mechanic_key` change while the ability is `active` or referenced by a non-retired assignment, and to reject any change to `ability_key` after creation.
   - Frost Bolt `combat_text` written in the same migration as an explicit `UPDATE public.abilities SET combat_text = ... WHERE ability_key = 'frost_bolt'` — keeping the live row synchronized with the compiled seed. Nothing else is overwritten.

2. Regenerate types.
3. Land `effective-ability.ts` + Deno mirror, the `CalcTerm.role` tag, the `abilityKey`/`damageType`/`combat_text` wiring, `ability-text.ts` and the `cast-flavor` re-keying. Update `ability-seed.ts` (Frost Bolt text + role tags) so seed and DB match.
4. Rewrite the Abilities page; move `AssignmentMatrix`; add the Class Config slot/override editors.
5. Deploy `combat-tick` and `combat-catchup` **last**, after the shared resolver ships, so server and client resolve identically.

### Verification queries (run after step 1, before step 4)

- `select ability_key, combat_text from public.abilities where ability_key in ('fireball','frost_bolt');`
- `select count(*) from public.class_ability_assignments where overrides <> '{}'::jsonb;` → expected `0`.
- `select class_key, count(*) filter (where is_default) from public.class_ability_assignments where status <> 'retired' group by 1;` → exactly 5 defaults per class.
- Wizard slot 0: `fireball` default, `frost_bolt` non-default alternative.

## Rollback

- Code: revert the commit; the additive column is ignored by the previous build.
- Data: `UPDATE public.class_ability_assignments SET overrides = '{}'::jsonb;` restores base-only resolution immediately.
- Full revert: `DROP TRIGGER` + `DROP FUNCTION public.validate_assignment_overrides()` + `DROP COLUMN overrides`. Frost Bolt's `combat_text` is revertible with a single `UPDATE ... SET combat_text = '{}'::jsonb`.
- No existing production configuration is removed or overwritten before the migrated effective values are verified.

## Tests

- Frost Bolt shows Frost Bolt cast text; Fireball still shows Fireball text.
- Frost Bolt dispatches through the shared `fireball` handler (`type === 'fireball'`) and retains `damageType === 'frost'` authoritatively (server-resolved, not client-supplied).
- `effectType` snapshot test: log classification, severity and families unchanged after `abilityKey` is added.
- Every runtime `ClassAbility` has a non-empty `abilityKey`, including sealed mode.
- Fallback chain: no authored text → ability-key flavor → mechanic flavor.
- Base abilities appear exactly once on the Abilities page (no class grouping, no matrix); assignments/overrides only editable via Class Config.
- Numerical parity: every seeded assignment resolves to identical values pre/post migration across level 1–42 and modifier −2..+10.
- Scaling: explicit attribute override resolves; "Primary"/"Secondary" shortcuts resolve through the class's explicit `primary_attribute`/`secondary_attribute` and are stored as the concrete attribute; untagged terms are never rewritten; a tagged term's `mult` is always preserved.
- No coefficient override exists: an override carrying `primary_coefficient`/`secondary_coefficient`, `amount_calc`, `duration_calc` or `interval_ms` is rejected by both SQL and the resolver.
- `chance_on_hit`/`block_chance`/Envenom params are unaffected by `scaling` overrides.
- Identity protection: `ability_key` cannot be changed after creation; a `mechanic_key` change is blocked while active or assigned (UI and DB trigger).
- Invalid or unsupported override → whole override discarded, base config used, error recorded, deterministic result; admin save blocked and preview shows the errors.
- Admin preview and server resolution agree for every seeded assignment (shared-resolver parity, extending `shared-mirror-identity.test.ts`).
- Existing characters keep the same five effective abilities; Fireball default / Frost Bolt alternative preserved.


## Explicitly out of scope

Orbs of Fire / Ignite separation; new balance formulas; resistance mechanics; frost slow/chill or any secondary effect; unrelated combat, class, item or admin redesigns.

## Affected files

- `src/features/combat/utils/`: `class-abilities.ts`, `ability-loadout.ts`, `ability-calcs.ts`, `cast-flavor.ts`, new `ability-text.ts`
- `src/features/combat/hooks/`: `useCombatActions.ts`, `useCombatDriver.ts`
- `src/features/combat/events/`: `tick-event-builder.ts`, `client-event-builder.ts`, `log-event.ts` (additive `abilityKey` only)
- `src/hooks/useAbilityRegistry.ts`, `src/hooks/useAbilityLoadout.ts`
- `src/components/admin/`: `AbilityConfigManager.tsx`, `AbilityAuthorDialog.tsx`, `ClassConfigManager.tsx`, `ability/AssignmentMatrix.tsx` (moved), new `class-abilities/*`
- `src/shared/config/`: new `effective-ability.ts`, `ability-seed.ts`, `mechanic-templates.ts` (no new params), `src/shared/formulas/ability-calc.ts` (optional `role` tag)
- `supabase/functions/_shared/`: `config/effective-ability.ts` (mirror), `config/ability-seed.ts`, `formulas/ability-calc.ts`, `load-ability-calcs.ts`; `supabase/functions/combat-tick/index.ts`, `combat-catchup/index.ts`
- Migration A (single additive migration)
- Tests: `frost-bolt-identity.test.ts`, `ability-key-identity.test.ts`, `effective-ability-parity.test.ts`, `assignment-override-validation.test.ts`, `override-sql-allowlist-parity.test.ts`, `event-classification-snapshot.test.ts`
