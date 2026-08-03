# Ability System Correction — Three Approved Phases

Retain all existing backend behaviour (canonical `abilityKey`, separate `mechanicKey`, authoritative damage type, shared Fireball/Frost Bolt execution, class primary/secondary attributes, validated overrides, attribute substitution without coefficient change, base-only fallback, server-side loadout authorization, protected identity, shared effective-ability resolver). No new abilities, no balance changes, no Orbs/Ignite redesign, no CP-cost or whole-formula class overrides.

Each phase stops for approval before the next begins.

## Confirmed current state

- `src/components/admin/AbilityConfigManager.tsx` (Abilities page) loads `class_ability_assignments` as its primary list, keys selection by `assignment_id`, sorts/groups by class and slot, carries `is_default`/`slot`/`unlock_level`, and renders `ability/AssignmentMatrix.tsx` plus `AbilityAuthorDialog` with role + alternative state.
- `src/components/admin/class/ClassAbilityConfig.tsx` already exists as the class-side editor.
- `supabase/functions/combat-tick/index.ts` computes `auth.abilityKey` (used only for magnitude labels) and stamps `damage_type` on events, but does not stamp `ability_key` onto player-ability result events.

## Phase 1 — Abilities becomes a true base-ability library

- Rewrite the Abilities page data layer to query `abilities` directly: every base ability exactly once, including unassigned ones, selected by ability id, no class grouping.
- Remove `AssignmentMatrix` from the page and delete slot selection, default/alternative state, unlock level and class-assignment editing from it.
- Keep/extend: search and status filtering of the library, "Create base ability" that creates only an `abilities` row, editing of base properties (name, description, tooltip, base combat text, mechanic, ability type, activation mode, target type, base CP cost, base damage type, base calculations, mechanic config, lifecycle status).
- `ability_key` immutable after creation; `mechanic_key` guarded with strong validation and a block/warning when the ability is active or assigned.
- Read-only "Used by" reference listing classes/slots that reference the ability.
- Move internal identity fields into a collapsed Advanced section.
- Touch `ClassAbilityConfig` only as needed so it keeps working once assignment controls leave the Abilities page.

Tests: base ability appears once when assigned to multiple classes; unassigned ability appears; editing base does not write assignments; creating does not auto-assign; no class grouping/AssignmentMatrix on the page; assignments and loadouts unchanged. Then full typecheck, test suite, production build, screenshots, and a report of files changed.

## Phase 2 — Class Config owns assignments

- Class Config becomes the sole assignment owner: five slots per class, compact slot summary rows (slot name, default ability, alternatives, unlock level, status) with one expandable assignment editor (or drawer) open at a time.
- "Assign existing ability" opens a searchable picker over the base library and creates only a `class_ability_assignments` row — never a second `abilities` row.
- "Create new base ability" is a separate labelled action that creates the base row first, then explicitly offers assignment. `AbilityAuthorDialog` is refactored so creation and assignment are separate responsibilities and it is no longer the normal assign path.
- Safe unassign/remove that blocks removal invalidating an equipped loadout (or offers explicit migration), and enforcement of exactly one default per slot.
- Expanded assignment exposes only: presentation/flavor overrides, scaling-attribute substitution for tagged terms, named mechanic-supported parameters, unlock level, default/alternative state, status. No CP-cost, no whole `amount_calc`/`duration_calc`, no coefficient overrides, no raw JSON, no irrelevant mechanic params.
- Scaling UI shows the affected term, inherited base attribute, selected effective attribute (Primary/Secondary/explicit STR/DEX/CON/INT/WIS/CHA), the unchanged inherited coefficient and the resulting calculation; stores the resolved concrete attribute as today.
- Effective preview produced solely by the shared effective-ability resolver, distinguishing base value / class override / effective value across identity, damage type, CP cost, scaling attribute, calculation and mechanic params. No separate admin math.

Tests: assign existing without new base row; independent base creation; default/alternative behaviour; safe removal; invalid loadout prevention; coefficient preserved across attribute substitution; unsupported overrides rejected; previews match the resolver; characters keep five effective abilities; Fireball default and Frost Bolt alternative for Wizard. Then typecheck, tests, build, screenshots, report.

## Phase 3 — Canonical identity propagation

- In `combat-tick`, stamp both `ability_key: auth.abilityKey` and `damage_type: auth.entry.damageType` on applicable player-ability result events, keeping `abilityKey`, `mechanicKey`, `effectType` and `damageType` as distinct concerns — `effectType` is not replaced.
- Inventory server result events and attach ability identity only to genuine player-ability events, not periodic/environmental ones.
- Update the client server-event adapter to map `ability_key` → `GameLogEvent.abilityKey`.

Tests: Fireball events carry `abilityKey = fireball`; Frost Bolt carries `frost_bolt`; both still dispatch through the shared Fireball mechanic; frost damage metadata retained; `effectType` semantics unchanged; classification/rendering unchanged; timing/damage unchanged.

Final verification: typecheck, full suite, production build, migrations and generated types, existing loadouts, Fireball/Frost Bolt in live-equivalent combat, Abilities page holds unique base definitions only, Class Config is sole assignment owner. Remaining non-blocking polish reported separately.

## Technical notes

- Files expected to change: `src/components/admin/AbilityConfigManager.tsx`, `src/components/admin/ability/AssignmentMatrix.tsx` (removed from Abilities page, reused or deleted in class scope), `src/components/admin/AbilityAuthorDialog.tsx`, `src/components/admin/class/ClassAbilityConfig.tsx`, plus new admin subcomponents for the slot summary, ability picker and effective preview, `supabase/functions/combat-tick/index.ts`, and the client server-event adapter.
- No schema migration is anticipated; `abilities`, `class_ability_roles` and `class_ability_assignments` already support the split. If a defect requires one, it is raised before applying.
