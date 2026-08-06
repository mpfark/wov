# Ability System Correction: Real Base Ability Layer

## What is wrong today (verified against the live schema)

- There is no stored Base Ability entity. `public.abilities` holds the 34 finished, named abilities (Fireball, Smite, Backstab, Envenom...). The only grouping is `mechanic_key`, which is the runtime mechanic — exactly the inferred substitute we want to remove.
- The Ability Library page (`AbilityConfigManager.tsx`) queries `abilities` directly, so column 1 lists finished abilities, not reusable bases.
- On-Hit authoring is broken end to end:
  - `ClassAbilityConfig.tsx` selects the ability without `effect_config`, so `OnHitEffectEditor` always sees an empty allowlist and prints "the base ability does not declare any allowed on-hit effects".
  - Only 1 of 34 ability rows carries `effect_config.on_hit_allowed` in the database (the seed data has more, but it was never migrated in).
  - 0 assignments currently store `overrides.on_hit_effect`, so nothing is lost by fixing this.
- Envenom is an `abilities` row on `stack_apply` with `activation_mode` stance, but nothing in the model states "self stance / applies enemy poison on weapon hit", so the UI shows it as a plain buff.

Untouched by this work: `combat-tick`, `combat-catchup`, `_shared/combat-resolver.ts`, on-hit runtime execution, tick timing, CP math, calc evaluation, kill/loot resolution, the five-slot role system, existing assignments and player loadouts.

## New data model

New table `public.base_abilities` (admin-editable, reusable, one row per family):

- `id`, `base_key` (stable, immutable), `label`, `description`
- `mechanic_key` — runtime mechanic; unchanged values
- `activation_mode`, `default_target_type`, `allowed_target_types text[]`
- `capabilities jsonb` — which configuration sections the right column may show
  (`identity`, `scaling`, `damage_type`, `amount`, `duration`, `interval`, `combat_text`, `stance`, `applied_status`, `on_hit_effect`)
- `on_hit_allowed text[]` — allowed On-Hit Effect types (`bleed|poison|ignite`), empty = unsupported
- `status`, `admin_notes`, timestamps + update trigger, GRANTs (`anon`/`authenticated` read, `service_role` all), RLS: read for authenticated, write for steward/overlord — mirroring the existing `abilities` policies.

`public.abilities` gains `base_ability_id uuid references public.base_abilities(id)`, backfilled and then set `NOT NULL`. `mechanic_key` stays on `abilities` so the runtime keeps reading exactly what it reads today (no runtime change, no second source of truth for execution — `base_abilities.mechanic_key` is authoring metadata and is validated to match).

Nothing is deleted from `abilities`; ability IDs, keys, calcs, `effect_config`, `combat_text`, CP costs and assignments are untouched.

## Base Ability set and complete mapping (for review)

One base per existing runtime mechanic, named as an authoring family. Every current ability maps as follows:

| Base Ability (base_key) | Runtime mechanic | On-Hit allowed | Class abilities mapped |
|---|---|---|---|
| Weapon Attack (`weapon_attack`) | weapon_attack | bleed, poison | weapon_attack (used as power_strike / aimed_shot / backstab) |
| Spell Attack (`spell_attack`) | spell_attack | ignite, bleed, poison | fireball, frost_bolt, smite, judgment, cutting_words |
| Multi Attack (`multi_attack`) | multi_attack | bleed, poison | barrage |
| Burst Damage (`burst_damage`) | burst_damage | — | grand_finale |
| Stack Finisher (`stack_consume`) | stack_consume | — | eviscerate, conflagrate |
| On-Hit Stance (`on_hit_stance`) | stack_apply (`trigger: on_hit`) | poison, bleed, ignite | envenom |
| Orb Stance (`orb_stance`) | stack_apply (`trigger: pulse`) | ignite, bleed, poison | orbs_of_fire (currently keyed `ignite`) |
| Damage Over Time (`dot_debuff`) | dot_debuff | — | rend |
| Control Debuff (`control_debuff`) | control_debuff | — | dissonance, natures_snare, sunder_armor |
| Aura Pulse (`aura_pulse`) | aura_pulse | — | consecrate |
| Heal (`heal`) | heal | — | heal, second_wind |
| Health Transfer (`hp_transfer`) | hp_transfer | — | transfer_health |
| Party Regeneration (`party_regen`) | party_regen | — | purifying_light, crescendo |
| Regeneration Buff (`regen_buff`) | regen_buff | — | inspire |
| Absorb Shield (`absorb_buff`) | absorb_buff | — | force_shield, divine_aegis |
| Mitigation Buff (`mitigation_buff`) | mitigation_buff | — | battle_cry, divine_challenge |
| Block Stance (`block_buff`) | block_buff | — | shield_wall |
| Reactive Retaliation (`reactive_holy`) | reactive_holy | — | holy_shield |
| Offensive Buff (`offense_buff`) | offense_buff | — | arcane_surge, eagle_eye |
| Evasion Buff (`evasion_buff`) | evasion_buff | — | cloak_of_shadows, disengage |
| Stealth Opener (`stealth_buff`) | stealth_buff | — | shadowstep |

Backfill is a single deterministic join on `mechanic_key`, so every one of the 34 rows lands on exactly one base. `on_hit_allowed` values come from the existing seed data (`ability-seed.ts`) so authoring finally matches intent.

## Three distinct on-hit concepts (kept separate)

| | Optional On-Hit Effect | On-Hit Stance | Orb Stance |
|---|---|---|---|
| Example | Fireball → Burn rider | Envenom | Orbs of Fire |
| Belongs to | one damaging class ability | a self-stance ability | a self-stance ability |
| Trigger | that ability lands a hit | subsequent **weapon** hits | its own **automatic orb attack** hits the current enemy |
| Stored in | `class_ability_assignments.overrides.on_hit_effect`, gated by `base_abilities.on_hit_allowed` | ability `effect_config` (`trigger: on_hit`, stack type, chance, magnitude, duration, stacks) | ability `effect_config` (`trigger: pulse`, orb damage/interval, stack type, chance, duration, stacks) |
| Runtime | existing generic on-hit path in `combat-tick` | existing `stack_apply` on_hit path | existing `stack_apply` pulse path (unchanged tick cadence and damage) |

Both stance bases already exist in the runtime today — `combat-tick` reads `effect_config.trigger` (`pulse` vs `on_hit`). The correction is that they become two clearly named Base Abilities with distinct capability sets and admin labels: "Optional On-Hit Effect (this ability only)", "On-Hit Stance (self-stance, triggers on weapon hits)", "Orb Stance (self-stance, automatic attacks)".

### Envenom

Authored ability on the `on_hit_stance` base. Its configuration panel states: activation Stance / activation target Self / trigger On weapon hit / applied status Poison / status target Enemy / classification Poison DoT debuff, plus chance, magnitude, duration, stack behaviour and scaling. Numbers and runtime path unchanged. Player-facing labels that call it a "buff" become "Stance".

### Orbs of Fire (replaces the ability currently presented as "Ignite")

The Wizard's authored stance ability on the `orb_stance` base. Ignite is **not** a player-activated stance — it is the enemy-side status the orbs apply. Its configuration panel states: activation Stance / activation target Self / triggered attack Automatic orb attack / triggered attack target Current enemy / applied status Ignite / status target Enemy / classification Fire DoT debuff, plus orb chance, damage, interval, duration, magnitude, stack behaviour and scaling. Only one selectable ability exists — Orbs of Fire; Ignite appears only as the applied status.

Identity migration (audited references): the string `ignite` is used today for three different things — (a) the authored ability key, (b) the persistent stance-state key (`characters.stance_state`, the `activate_stance` / `drop_stance` allowlist and the ignite/envenom mutex, `mb.ignite_buff` in `combat-tick`), and (c) the `active_effects.effect_type` / on-hit effect key. Only (a) is renamed:

- Rename the authored identity: `abilities.label` → "Orbs of Fire", description/tooltip/combat text, and `class_ability_assignments.class_ability_key` → `orbs_of_fire`, keeping the same `abilities.id` and the same assignment row, so default assignments and player loadouts are untouched.
- `abilities.ability_key` stays `ignite` because it *is* the stance-state key: renaming it would orphan every live `characters.stance_state` entry and require changing the `activate_stance` allowlist and mutex. This is documented in the base ability's admin notes, and the admin UI shows the runtime key read-only next to the authored name.
- (b) and (c) keep the `ignite` identifier — it remains the applied-status/effect name, which matches the intent.
- Update seeds and the `_shared` mirror, `class-abilities.ts` fallback labels, `stances.ts`, cast flavour, `GameManual.tsx` and the stance/ability tests to the Orbs of Fire naming while keeping the runtime keys.


## Admin UI work

`AbilityConfigManager.tsx` becomes a true three-column page inside the existing admin shell (40/60 split preserved elsewhere; here roughly 22% / 26% / 52%, collapsing to stacked on small screens):

1. **Base Abilities** — `base_abilities` rows only, with counts of authored abilities; create/edit base metadata including capabilities and `on_hit_allowed`.
2. **Abilities using this base** — `abilities` filtered by `base_ability_id`, each showing name + assigned class(es), plus "New ability from this base" (pre-seeds mechanic, activation and target from the base).
3. **Configuration** — the selected authored ability's editor, split into containers and rendered only for sections the base's `capabilities` allow: identity, activation/targeting, damage or healing, scaling attributes, scale/multiplier, damage type, description, combat text, applied status, stance configuration, On-Hit Effect.

Component and query corrections:

- `ClassAbilityConfig.tsx`: add `effect_config, target_type, activation_mode, base_ability_id` (and the joined base's `on_hit_allowed`, `capabilities`) to the Supabase select; keep `overrides.on_hit_effect` in form state, validation, save payload and reload.
- `OnHitEffectEditor.tsx`: read the allowlist from the base row; add the missing configurable fields (enabled toggle, magnitude, damage type, scaling source) and show only fields relevant to the chosen effect type; hide entirely when the base disallows on-hit effects.
- `BaseAbilityCreateDialog.tsx`: split into base creation (base metadata) and class-ability creation from a selected base.
- `ClassConfigManager.tsx` / `ClassAbilityConfig.tsx`: slots continue to pick authored abilities (never raw mechanics); the per-class page keeps its current structure and shows inherited base configuration alongside class overrides. No cross-class overview added there.
- `useAbilityRegistry.ts` already selects `effect_config`; it gains `base_ability_id` only as metadata — resolution order and merge logic unchanged.
- Shared/mirrored data: `src/shared/config/ability-seed.ts` and the `supabase/functions/_shared` mirror get base keys; regenerate Supabase types.

## Validation

Tests and manual checks covering: column 1 contains no finished abilities; selecting Spell Attack lists exactly fireball, frost_bolt, smite, judgment, cutting_words; creating an ability from a base; every `abilities` row has `base_ability_id`; on-hit permission editing on a base; enabling, saving and reloading an on-hit effect on a class ability; no editor shown for bases that disallow it; Envenom presented as a self On-Hit Stance applying enemy Poison; unchanged combat behaviour (existing 570-test suite plus calc parity), assignments and loadouts intact.

## Technical notes

- Two migrations: (1) create `base_abilities` + GRANTs + RLS + seed the 20 bases + add nullable `base_ability_id`; (2) backfill by `mechanic_key`, then `NOT NULL` + validation trigger that `abilities.mechanic_key` matches its base.
- Obsolete admin paths are removed only after backfill is verified.
- No changes to combat edge functions, tick cadence, CP costs, calc math or balance.
