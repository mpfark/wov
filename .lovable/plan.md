# Correction Plan — Base-Ability Library + Class Ability Configuration

Two defects to correct: (1) presentation is keyed by mechanic, so Frost Bolt speaks with Fireball's voice; (2) the admin surfaces have swapped responsibilities — the Abilities page edits class assignments and duplicates a class/slot matrix, while Class Config has no ability section.

## Problem 1 — Ability identity in presentation

Verified current state:

- `ClassAbility` (`src/features/combat/utils/class-abilities.ts`) has no `abilityKey`; its `type` field *is* the mechanic key, populated from `row.ability.mechanic_key` in `setAbilityRegistry`.
- `useCombatActions.ts` line 289 calls `getCastFlavor(ability.type, class, targetName)` — a mechanic lookup, which is why Frost Bolt gets Fireball text.
- `ability-loadout.ts` already carries `abilityKey` and `damageType` on `LoadoutOption`, but drops both when it builds the `ClassAbility` handed to `setClassAbilityList`.
- Canonical identity already exists for calcs (`ABILITY_CALCS` keyed by `ability_key`, `getAbilityKeyForSlot`) and for the wire (`useCombatDriver.ts` sends `ability_key`; `combat-tick` re-authorizes it server-side). Only presentation lags.
- `abilities.combat_text jsonb` exists on the table and in seed rows, but **no runtime code reads it** — every seed value is `{}` and only `AbilityAuthorDialog` writes an empty object. This is the natural home for ability-specific authored flavor; no new column is needed.

### Changes

1. `ClassAbility` gains `abilityKey: string` and `damageType: string | null`.
   - Populated in `setAbilityRegistry` from `row.ability.ability_key`.
   - Populated in the compiled fallback lists from `ABILITY_SEED` (sealed mode keeps `ability_key`) rather than the hand-written literals, so no path can produce a keyless ability.
   - Preserved by `setClassAbilityList` and by `applyAbilityLoadout` (copy `abilityKey`/`damageType` from the chosen `LoadoutOption`).
2. New resolver `src/features/combat/utils/ability-text.ts`:
   - `getAbilityText(abilityKey)` → authored `combat_text` for that ability from a registry primed by seed and refreshed by `useAbilityRegistry`.
   - `resolveCastFlavor(ability, characterClass, targetName)` order: authored ability `combat_text.cast` → `getCastFlavor(abilityKey, …)` → `getCastFlavor(mechanicKey, …)` as last-resort fallback.
   - `cast-flavor.ts` keeps its tables but is re-keyed by ability key, with the existing mechanic keys retained as fallback entries (fireball/power_strike/… happen to be both today). Adds a `frost_bolt` entry with frost-authored lines.
3. `useCombatActions.ts` calls `resolveCastFlavor(ability, …)` instead of `getCastFlavor(ability.type, …)`. Behavior stays: `ability.type` remains the mechanic switch for execution.
4. Presentation paths audited and switched to ability identity (label/description/tooltip already come from the DB row, so these are the mechanic-keyed leftovers):
   - queued-cast flavor (`useCombatActions.ts`) — fix as above;
   - ability buttons / tooltips (`AbilityBar`, `AbilityLoadoutTab`) — verify they read row label/tooltip and add damage-type display from `ability.damageType`;
   - structured events (`buildAbilityEvent` call sites) — carry `effectType: abilityKey` and `damageType` so the log families and colour resolve per ability;
   - combat-result text in `combat-tick` — resolution already keys by `ability_key`; the shared `combat_text` lookup is added to `_shared/load-ability-calcs.ts` and used for the resolved-hit sentence with the mechanic default as fallback.
5. No `frost_bolt` mechanic handler. Frost Bolt keeps `mechanic_key = fireball`.

### Tests

- `frost-bolt-identity.test.ts`: after applying a wizard loadout selecting Frost Bolt — bar slot 0 has `abilityKey === 'frost_bolt'`, `damageType === 'frost'`, `type === 'fireball'`; `resolveCastFlavor` returns Frost Bolt text and never a Fireball line; Fireball selection still returns Fireball text.
- Fallback test: an ability with no authored `combat_text` and no ability-key flavor entry falls through to the mechanic flavor.
- Sealed-mode test: `ABILITY_RESOLVER_MODE === 'sealed'` still yields non-empty `abilityKey` for every seeded ability.
- Extend `ability-key-identity.test.ts` to assert every runtime `ClassAbility` has a non-empty `abilityKey`.

## Problem 2 — Admin responsibilities

### Abilities page = base library

`AbilityConfigManager.tsx` is rewritten to query `abilities` directly (no join to `class_ability_assignments`, no `CLASS_LABELS` grouping, no `AssignmentMatrix`). Each base ability appears exactly once. Editable fields: `ability_key`, label, description, tooltip, `mechanic_key`, `ability_type`, `activation_mode`, `target_type`, `cp_cost`, `damage_type`, `amount_calc`/`duration_calc`/`interval_ms`, `mechanic_calcs` (template-driven), `combat_text`, `status`. Each field is labelled as a global default. Assignment-only fields (class, slot, unlock level, is_default) are removed from this page.

`AssignmentMatrix.tsx` moves under Class Config as the read-only five-slot overview for the selected class; `AbilityAuthorDialog` loses its role/alternative arguments and simply creates a base ability.

### Class Config = ability configuration

`ClassConfigManager.tsx` gains an "Ability Configuration" section with exactly five slots (from `class_ability_roles`). Per slot: the default base ability, the alternatives list, an ability picker sourced from the base library, unlock level, assignment status, and the class-specific override editor. Promote-to-default uses the existing `set_assignment_default` RPC (already backed by the one-default-per-slot partial unique index). New sub-components under `src/components/admin/class-abilities/`: `AbilitySlotRow.tsx`, `AssignmentOverrideEditor.tsx`, `EffectiveAbilityPreview.tsx`.

The override editor renders **only** fields the selected mechanic's template declares — no generic knobs. The preview uses the shared effective-ability resolver, the same one the client registry and `combat-tick` use.

### Smallest additive schema change

One column on `class_ability_assignments`:

```
overrides jsonb not null default '{}'::jsonb
```

Validated by extending the existing `public.validate_ability_row()` pattern with a sibling `public.validate_assignment_overrides()` trigger. Allowed top-level keys only:

- `label`, `description`, `tooltip` — class-specific presentation override (text).
- `combat_text` — class-specific authored flavor (`{ cast, hit, crit, apply, expire }`, strings).
- `cp_cost` — integer override of base cost.
- `amount_calc`, `duration_calc`, `interval_ms` — class-specific scaling overrides, validated with `validateCalc`.
- `mechanic_calcs` — per-param overrides; each key must belong to the base row's mechanic template (rejects e.g. `block_chance` on a `fireball` row).

No new template table: `abilities` already is the reusable base library and `mechanic-templates.ts` already declares valid params per mechanic.

### Clarifying "flavor / weight-chance / scale"

Mapped to what exists today, so nothing ambiguous is added:

- "flavor" → `combat_text` strings (currently unread; wired in this correction).
- "weight / chance-on-hit" → the named template params that already model chance: `block_chance` (Templar) and the proc-chance/`max_stacks`/`per_stack_multiplier` family (Envenom/Eviscerate). Overrides are per-param `AbilityCalc` records under `overrides.mechanic_calcs`, not a bare numeric weight.
- "scale" → `amount_calc` / `duration_calc` / `interval_ms` overrides, same structured `AbilityCalc` shape as the base.

### One shared effective resolver

`src/shared/config/effective-ability.ts` (mirrored to `supabase/functions/_shared/config/effective-ability.ts`):

```
resolveEffectiveAbility(baseAbilityRow, assignmentRow) -> EffectiveAbility
```

Deep-merges validated overrides over the base, drops unknown/invalid override keys with a warning, and returns label/description/tooltip/cpCost/damageType/calcs/mechanicCalcs/combatText. Consumers: `setAbilityRegistry` + `setAbilityCalcRegistry` + `setLoadoutOptions` (client), `load-ability-calcs.ts` (server), and the admin preview. Covered by the existing `shared-mirror-identity.test.ts` harness plus a parity test asserting client and server produce identical effective output for every seeded assignment.

## Migration, backfill and deployment order

1. Migration A (additive only): add `overrides` column with `'{}'` default; create `validate_assignment_overrides()` + trigger. No data change — every existing assignment starts with no overrides, so all current behavior and balance is preserved bit-for-bit.
2. Regenerate types; add `effective-ability.ts` + mirror; wire `abilityKey`/`damageType`/`combat_text` through the client registries.
3. Author Frost Bolt's `combat_text.cast` (data-only update, not a migration). Fireball stays the wizard slot-0 default; Frost Bolt stays the non-default alternative.
4. Rewrite the Abilities page; move `AssignmentMatrix` into Class Config; add the slot/override editors.
5. Deploy `combat-tick` and `combat-catchup` last, after the shared resolver lands, so server and client resolve identically.

No admin data is lost when the duplicated UI is removed: the assignment rows the old Abilities page edited remain untouched in `class_ability_assignments` and are simply edited from Class Config instead. Only the editor location changes.

## Rollback

- Client/admin: revert the code commit; the additive column is ignored by the previous build.
- Data: `UPDATE class_ability_assignments SET overrides = '{}'` restores base-only resolution instantly without dropping the column.
- Migration A is reversible with `DROP TRIGGER` + `DROP COLUMN overrides` if a full revert is wanted.

## Out of scope (explicitly untouched)

Frost resistance and secondary frost effects; the Orbs of Fire / Ignite mechanic redesign; any balance change; any new mechanic handler.

## Affected files

- `src/features/combat/utils/class-abilities.ts`, `ability-loadout.ts`, `ability-calcs.ts`, `cast-flavor.ts`, new `ability-text.ts`
- `src/features/combat/hooks/useCombatActions.ts`, `useCombatDriver.ts`
- `src/hooks/useAbilityRegistry.ts`, `src/hooks/useAbilityLoadout.ts`
- `src/components/admin/AbilityConfigManager.tsx`, `AbilityAuthorDialog.tsx`, `ClassConfigManager.tsx`, `ability/AssignmentMatrix.tsx` (moved), new `class-abilities/*`
- `src/shared/config/effective-ability.ts` (+ Deno mirror), `src/shared/config/ability-seed.ts` (Frost Bolt text)
- `supabase/functions/_shared/load-ability-calcs.ts`, `supabase/functions/combat-tick/index.ts`, `combat-catchup/index.ts`
- Tests: `frost-bolt-identity.test.ts`, `ability-key-identity.test.ts`, `effective-ability-parity.test.ts`, `assignment-override-validation.test.ts`
