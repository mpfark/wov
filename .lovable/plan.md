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

Adds one `abilities` row (`frost_bolt`, `damage_type='frost'`, identical calc/CP/targeting to `fireball`) plus one `class_ability_assignments` row on the wizard's Signature slot with `is_default=false`. No new mechanic, no chill/slow. Proves DB → server authorization → equipped resolution → Spellbook UI → admin. Tests: only the equipped one casts; the other is refused by the server. Manual: equip Frost Bolt, confirm frost wording and that Fireball is refused.

## Phase 5 — Separate stances from timed effects (G7)

Move `ignite` and `envenom` from `activation_mode='stance'` to timed effects backed by `active_effects`, with stances remaining in `reserved_buffs`/`stance_state`. This is a **mechanic change, not a conversion** — it will alter feel and must be scheduled deliberately. The previously discussed formulas (`2 + intMod` pulse, `floor(wisMod × 0.7 × 0.67)` burn tick, `30s + wisMod` capped 45s) do **not** match the current seed values and are therefore a balance change, not parity. Decision required before implementation.

## Phase 6 — Admin completion (G8)

Add class assignment, slot, `is_default`, `damage_type`, `activation_mode`, and unlock-level editing to `AbilityConfigManager`, plus an assignment matrix view per class. Preview continues to use the shared evaluator.

## Phase 7 — Alternatives for the remaining classes

One alternative per class per release, each reusing an existing mechanic handler, each validated by the Phase 1 inventory test.

---

## Risks and contradictions

- The request's Phase 1/2 largely already exist; implementing them again would duplicate working code. This plan replaces them with the specific closing of G1–G3.
- `ignite`/`envenom` as stances is a live contradiction with the stated design rules; it is isolated into Phase 5 so nothing else waits on it.
- `class-abilities.ts` remains a hardcoded fallback. Recommendation: keep it as the sealed-mode safety net rather than delete it, since `ABILITY_RESOLVER_MODE='sealed'` depends on it.
- Removing the mechanic-hint fallback is a wire-protocol change; safe only after Phase 3 telemetry shows no legacy payloads.

## Decisions I need from you

1. Phase 5: adopt the new ignite formulas as an explicit balance change, or convert ignite to a timed effect at exactly today's numbers first?
2. Should Frost Bolt be visible to existing wizards immediately, or gated behind an admin activation toggle?
3. Keep `class-abilities.ts` as the sealed-mode fallback (recommended), or plan its removal?

## Recommended first publishable step

Phase 1. One additive migration plus one snapshot test, zero gameplay change, and it produces the inventory every later phase is checked against.
