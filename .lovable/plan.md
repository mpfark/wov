# Ability System — Repository-Backed Phased Plan

## Current state (verified in the reverted repository)

The reverted baseline already contains far more of the target architecture than the request assumes. Confirmed by reading code and querying the live database:

**Database (actual, today)**
- `abilities` — 35 rows, all `status='active'`. Columns include `ability_key`, `mechanic_key`, `ability_type`, `damage_type`, `target_type`, `activation_mode`, `cp_cost`, `cp_reserve_pct`, `amount_calc`, `duration_calc`, `mechanic_calcs`, `interval_ms`, `effect_config`, `combat_text`, `calc_version` (=2). No `cooldown_ms`.
- `class_ability_roles` — exactly 5 rows per class for all 7 classes (Signature/Discipline/Doctrine/Pressure/Mastery, unlock 1/5/10/15/20).
- `class_ability_assignments` — exactly 5 active rows per class (`class_key`, `role_id`, `ability_id`, `unlock_level`, `is_default`, `status`). **No class has an alternative yet.**
- `character_ability_loadout` — exists with RLS `loadout_owner_all` and correct grants. **0 rows** (20 characters, all running on defaults).
- `activation_mode` split: 16 instant, 11 queued, 8 stance. **`ignite` and `envenom` are stored as `stance`** — this contradicts the design rule that they are timed effects.
- `damage_type` is NULL on 17 of 35 abilities.

**Server**
- `combat-tick` is the single resolution point for player abilities. The client already sends `ability_key`; `authorizeQueuedAbility()` (in `_shared/load-ability-calcs.ts`) resolves it against the server registry keyed by the character's real class and rejects under-level casts. `preflightAbilityConfig()` aborts a cast with invalid config **before** any CP spend. Finisher stack counts are read from `active_effects`, never from the client.
- Registry is loaded from `class_ability_assignments → abilities`, cached 60s, primed synchronously from the compiled `ABILITY_SEED`, and swapped atomically only if every active row passes `validateAbilityForPublish`. A `sealed` mode ignores DB rows entirely.
- Magnitudes flow through one evaluator (`shared/formulas/ability-calc.ts`, byte-identical mirror in `_shared`), one decision point (`ability-magnitude.ts`), and named typed mechanic params (`config/mechanic-templates.ts`).

**Client / admin**
- Spellbook (`AbilityLoadoutTab`) is already built and mounted in `CharacterPanel`, backed by `useAbilityLoadout` writing `character_ability_loadout` directly.
- Admin has `AbilityConfigManager`, `AbilityAuthorDialog`, `CalcBuilder`, `MechanicCalcsEditor`, `GlobalModifiersPanel`, `ClassConfigManager`. The preview uses the same `evaluateCalc` as combat — not an approximation.
- `CLASS_ABILITIES` in `src/features/combat/utils/class-abilities.ts` is a mutable balance-identical fallback overwritten in place by `setAbilityRegistry()`.

**Therefore**: the requested Phase 1 (canonical model + conversion) and most of Phase 2 (server authority) are already shipped. The real remaining gaps are listed below and drive the phase order.

## Confirmed gaps

| # | Gap | Evidence |
|---|---|---|
| G1 | Client-supplied `cp_cost` is trusted | `combat-tick/index.ts:973` `const cpCost = pa.cp_cost \|\| 0` |
| G2 | Mechanic dispatch still branches on client `pa.ability_type` | `index.ts:1105,1192,1234,1272-1277,1367,1401` |
| G3 | No equipped-slot check — any active assignment for the class is authorized | `load-ability-calcs.ts:316-353` |
| G4 | Loadout swap rules (alive, out of combat, stance not active) are UI-only | `AbilityLoadoutTab` disabled props; no trigger/RPC |
| G5 | 17 abilities have NULL `damage_type`; player damage type is not carried into events | DB query; `normalizeDamageType` only used for creature casts |
| G6 | Zero alternatives exist, so the slot/alternative model is unproven end to end | `class_ability_assignments` = 5 per class |
| G7 | `ignite`/`envenom` are modelled as stances | `abilities.activation_mode='stance'`; `stances.ts` `STANCE_DEFS` |
| G8 | Admin cannot edit class assignment, slot, `is_default`, or `damage_type` | `AbilityConfigManager` field list |
| G9 | Legacy compat path resolves by mechanic when `ability_key` is absent | `load-ability-calcs.ts:336-339` |

---

## Phase 1 — Inventory freeze + damage-type completion (recommended first)

1. **Purpose / outcome.** No player-visible change. Produces a written, test-pinned inventory of all 35 abilities and gives every one an explicit authoritative `damage_type`.
2. **Current code.** `shared/config/ability-seed.ts` (+ `_shared` mirror), `abilities` table, `shared/combat/damage-types.ts`.
3. **DB.** One additive migration: backfill `damage_type` on the 17 NULL rows to their existing implied type; add a validation-trigger rule requiring non-null `damage_type` for damaging mechanics. No column adds.
4. **Server.** None.
5. **Client.** None.
6. **Admin.** None.
7. **Compatibility.** Purely descriptive data; balance untouched.
8. **Tests.** `ability-inventory.test.ts` snapshotting key/class/slot/mechanic/cp_cost/damage_type/calc for all 35; seed↔DB parity check.
9. **Manual checks.** Every ability still fires; numbers in the log unchanged.
10. **Out of scope.** Alternatives, ignite rework, admin edits.
11. **Deploy/rollback.** Migration only; rollback = set the backfilled values back to NULL.
12. **Later dependencies.** Phase 5 consumes the damage-type metadata.
13. **Files.** `supabase/migrations/*`, `src/shared/config/ability-seed.ts`, `supabase/functions/_shared/config/ability-seed.ts`, new test.

## Phase 2 — Close the server-authority gaps (G1, G2, G3, G9)

1. **Outcome.** Casts are fully server-derived; a tampered client cannot alter cost or mechanic.
2. **Current code.** `combat-tick/index.ts` pending-ability loop; `load-ability-calcs.ts`.
3. **DB.** None.
4. **Server.** Take `cpCost` from `auth.entry.cpCost`. Dispatch handlers on `auth.entry.mechanicKey` instead of `pa.ability_type`. Extend `authorizeQueuedAbility` to require the ability be the character's equipped choice for its slot (equipped = explicit `character_ability_loadout` row, else the slot's `is_default`), reading loadout rows in the same tick query. Keep the `ability_type` legacy fallback behind a dated deprecation comment; it becomes removable once Phase 3 ships and telemetry shows zero uses.
5. **Client.** `useCombatDriver` stops sending `cp_cost` (keeps sending `ability_key`; `ability_type` retained one release for rollback).
6. **Admin.** None.
7. **Compatibility.** Characters with no loadout rows resolve to `is_default`, which is today's behaviour for all 20 characters.
8. **Tests.** Extend `ability-identity-authorization.test.ts`: spoofed cost ignored, spoofed mechanic ignored, non-equipped ability rejected, unlock level respected, default fallback works.
9. **Manual checks.** All five bar buttons behave identically; CP deductions unchanged.
10. **Out of scope.** UI changes, new abilities.
11. **Deploy/rollback.** Deploy edge function first, then client. Rollback = redeploy previous function.
12. **Dependencies.** Phase 3 removes the legacy `ability_type` field.
13. **Files.** `supabase/functions/combat-tick/index.ts`, `supabase/functions/_shared/load-ability-calcs.ts`, `src/features/combat/hooks/useCombatDriver.ts`.

## Phase 3 — Authoritative loadout swaps (G4)

1. **Outcome.** Swapping a slot is validated by the server; illegal swaps fail even from a raw API call.
2. **Current code.** `useAbilityLoadout.ts` direct table writes; `AbilityLoadoutTab.tsx`.
3. **DB.** New `set_ability_loadout(character_id, role_id, ability_id)` SECURITY DEFINER RPC (`search_path=public`) enforcing ownership, alive, not in an active `combat_session`, target slot's stance not active in `reserved_buffs`, ability active + assigned to the class + unlocked. Revoke direct INSERT/UPDATE/DELETE on `character_ability_loadout` from `authenticated`, keep SELECT.
4. **Server.** None beyond the RPC.
5. **Client.** `useAbilityLoadout` calls the RPC and surfaces its error text.
6. **Admin.** None.
7. **Compatibility.** Empty loadout stays valid (defaults).
8. **Tests.** RPC rejection cases; hook error propagation.
9. **Manual checks.** Try swapping while in combat, while dead, and with a stance up — each is refused with a clear reason.
10. **Out of scope.** New alternatives.
11. **Deploy/rollback.** Migration then client. Rollback = restore grants.
12. **Dependencies.** Phase 4 relies on this enforcement.
13. **Files.** migration, `src/hooks/useAbilityLoadout.ts`, `src/features/character/components/AbilityLoadoutTab.tsx`.

## Phase 4 — Frost Bolt: the first real alternative (G6)

1. **Outcome.** Every existing wizard immediately sees a second option in the Signature slot. Fireball stays equipped by default; Frost Bolt must be deliberately equipped.
2. **Current code.** `abilities` / `class_ability_assignments`; `ABILITY_SEED`; Spellbook; `combat-tick` T0 branch.
3. **DB.** Insert one `abilities` row `frost_bolt` — same `mechanic_key` as `fireball`, identical `amount_calc`, `cp_cost`, `target_type`, `activation_mode`, only `damage_type='frost'` and its own label/description/combat text. Insert one `class_ability_assignments` row on the wizard Signature role with `unlock_level` **equal to Fireball's** and `is_default=false`, `status='active'`. No admin activation gate.
4. **Server.** No new mechanic. Frost Bolt resolves through the same T0 handler; only the authoritative `damage_type` differs. Explicitly **no** chill, slow or other frost status.
5. **Client.** None beyond what Phase 3 already renders; add the frost damage-type colour/wording to the log formatter if not already present.
6. **Admin.** Visible and editable via `AbilityConfigManager` (full assignment editing arrives in Phase 6).
7. **Compatibility.** Wizards with no loadout row keep casting Fireball (the default). Equipping Frost Bolt writes one loadout row.
8. **Tests.** Only the equipped ability casts; the unequipped sibling is refused server-side; both keys resolve to identical damage numbers with different damage types.
9. **Manual checks.** As a wizard, open Spellbook → Signature slot shows Fireball (equipped) and Frost Bolt; equip Frost Bolt, cast, confirm frost wording and identical damage; confirm the bar no longer offers Fireball.
10. **Out of scope.** Frost status effects, resistances, other classes' alternatives.
11. **Deploy/rollback.** Migration only. Rollback = set the assignment `status='retired'`; any loadout rows pointing at it fall back to the slot default.
12. **Dependencies.** Requires Phases 2 and 3.
13. **Files.** migration, `src/shared/config/ability-seed.ts` + `_shared` mirror, possibly `src/features/combat/utils/cast-flavor.ts`.

## Phase 5 — Orbs of Fire (stance) and Ignite (timed effect) (G7)

1. **Outcome.** The wizard's tier-3 equippable ability is renamed **Orbs of Fire** and remains a stance. **Ignite** becomes the timed fire DoT that Orbs of Fire applies, and the state Conflagrate detects and consumes. Ignite is never equippable and never occupies a slot.
2. **Identity migration (the safest path).** Today the single `ability_key='ignite'` carries both meanings, and `active_effects.effect_type='ignite'` already names the effect. End state:
   - Equippable stance ability → `ability_key = 'orbs_of_fire'`.
   - Timed effect/status → `effect_type = 'ignite'` (unchanged; no data migration on `active_effects`).
   - `stances.ts` stance key becomes `orbs_of_fire`; `characters.reserved_buffs` is migrated in the same transaction (rename the `ignite` map key to `orbs_of_fire` for every row that has it), so stance state and effect state never share a name again.
   - `mechanic_key` stays `ignite_buff` (the coded handler) and `ignite_consume` for Conflagrate — renaming handlers is not required and would widen the diff.
   - **Legacy payload compatibility:** for one release, `authorizeQueuedAbility` maps an incoming `ability_key='ignite'` to `orbs_of_fire`. This is a one-line entry in the existing `LEGACY_ABILITY_KEY_BY_TYPE`-style map, removed once telemetry shows no legacy casts.
3. **DB.** `update abilities set ability_key='orbs_of_fire', label='Orbs of Fire', description/tooltip/combat_text updated where ability_key='ignite'`; rename the `reserved_buffs` stance key on `characters`; no change to `active_effects` rows, `class_ability_assignments` (it references `ability_id`, not the key), or `character_ability_loadout`.
4. **Server.** `combat-tick`: stance activation/drop keyed on `orbs_of_fire`; the orb pulse continues to write `active_effects.effect_type='ignite'`; Conflagrate keeps reading `ignite` stacks from `active_effects`. `activate_stance` / `drop_stance` RPCs accept the new key (and, for one release, the old one).
5. **Client.** Rename in `stances.ts` (`STANCE_DEFS`, `STANCE_FLAVOR`), `useBuffState`, `mapServerEffectsToBuffState`, `interpretCombatTickResult`, `useOffscreenDotWakeup`, `cast-flavor.ts`, `useCombatActions`, `useCombatDriver`, `class-abilities.ts` fallback entry, log/legacy adapters (`log-event.ts`, `tick-event-builder.ts`, `legacy-adapter.ts` — the adapter must keep recognising historical `ignite` stance lines), and the ability tooltip text.
6. **Admin.** `GameManual.tsx` wording; `AbilityConfigManager` picks up the rename from data automatically.
7. **Compatibility.** Existing wizards with the stance up keep it: the `reserved_buffs` key rename runs in the same migration, and any in-flight client sends the legacy key which the server maps.
8. **Balance decision, still open and deliberately not adopted here.** The previously discussed numbers (`2 + intMod` pulse, `floor(wisMod × 0.7 × 0.67)` burn tick, `30s + wisMod` capped 45s) do **not** match the current seed and would be a balance change. This phase performs the **rename and state separation at exactly today's numbers**; adopting the new curves is a separate, later, explicitly-labelled balance pass.
9. **Tests.** Parity test that Orbs of Fire pulse/burn/Conflagrate output is numerically identical before and after; stance-key migration test; legacy `ignite` payload still authorizes; `legacy-adapter` still parses historical log rows; `active_effects` effect type untouched.
10. **Manual checks.** Activate Orbs of Fire, confirm CP reservation and flavour; watch orbs apply Ignite; Conflagrate consumes the burn stacks for the same damage as before; drop the stance and confirm existing Ignite effects tick out normally.
11. **Out of scope.** New ignite formulas, resistances, Envenom restructure (Envenom stays a stance applying `poison`, which already matches the design rule), any new frost behaviour.
12. **Deploy/rollback.** Migration → edge function → client. Rollback = reverse the key rename migration; the legacy mapping means an older client keeps working either way.
13. **Files.** migration, `supabase/functions/combat-tick/index.ts`, `supabase/functions/_shared/load-ability-calcs.ts`, `_shared/config/ability-seed.ts`, `src/shared/config/ability-seed.ts`, `src/features/combat/utils/{stances,cast-flavor,class-abilities,mapServerEffectsToBuffState,interpretCombatTickResult}.ts`, `src/features/combat/hooks/{useCombatActions,useCombatDriver,useBuffState,useOffscreenDotWakeup}.ts`, `src/features/combat/events/{log-event,tick-event-builder,legacy-adapter}.ts`, `src/components/admin/GameManual.tsx`.

## Phase 6 — Admin completion (G8)

Add class assignment, slot, `is_default`, `damage_type`, `activation_mode`, and unlock-level editing to `AbilityConfigManager`, plus an assignment matrix view per class showing each slot's default and its alternatives. Preview continues to use the shared evaluator, so it cannot drift from combat.

## Phase 7 — Alternatives for the remaining classes

One alternative per class per release, each reusing an existing mechanic handler, each validated by the Phase 1 inventory test.

---

## Fallback policy for `class-abilities.ts` (decided)

`class-abilities.ts` is retained purely as the sealed-mode / emergency fallback. The rules it must obey, enforced by tests:

- **Never overrides live config.** `setAbilityRegistry` already mutates in place only when rows load; the fallback is only read before the first successful load, when the payload is empty, or when `ABILITY_RESOLVER_MODE='sealed'`.
- **Not a second authority.** No runtime path may prefer it over loaded configuration, and no new code may read it directly for magnitudes — magnitudes come from the evaluator only.
- **Stays synchronized.** A test asserts `class-abilities.ts` matches `ABILITY_SEED` on label, `cp_cost`, mechanic, slot and unlock level for every ability. It is updated in the same commit as any seed/rename change (including the Phase 5 rename and the Phase 4 addition).
- **Authorizes only verifiable behaviour.** In fallback mode the server authorizes only the slot **defaults** — alternatives (Frost Bolt) are not castable while running on the compiled fallback, because equipped-state cannot be verified against live config. This is stated in the Phase 2 authorization tests.

## Risks and contradictions

- The request's Phase 1/2 largely already exist; implementing them again would duplicate working code. This plan replaces them with the specific closing of G1–G3.
- `ignite` currently names both a stance and an effect. Phase 5 resolves the ambiguity by renaming the ability, not the effect — the reverse would require migrating live `active_effects` rows.
- Removing the mechanic-hint fallback is a wire-protocol change; safe only after Phase 3 telemetry shows no legacy payloads.
- Frost Bolt being castable requires live config, so the sealed-mode fallback intentionally reduces wizards to Fireball. Worth confirming that is acceptable during an emergency.

## Open items (no longer blocking)

Decisions 1–3 are resolved and folded in above. The one remaining question is timing, not design: whether the new Ignite curves should be scheduled as a labelled balance pass immediately after Phase 5 or deferred until Phase 7.

## Recommended first publishable step

Phase 1. One additive migration plus one snapshot test, zero gameplay change, and it produces the inventory every later phase is checked against.
