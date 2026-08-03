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

## Phase 1 — Inventory freeze + damage-type classification (recommended first)

1. **Purpose / outcome.** No player-visible change. Produces a written, test-pinned inventory of all 35 abilities and settles what `damage_type` means for each one.
2. **Current code.** `shared/config/ability-seed.ts` (+ `_shared` mirror), `abilities` table, `shared/combat/damage-types.ts`.
3. **DB — damage-type nullability, classified from the actual 17 NULL rows.** No arbitrary types are assigned. The 17 NULLs, queried today, fall entirely into one category:
   - **Damaging, requires an explicit type:** *none*. Every damaging ability (`ability_type='damage'`) already has a type (physical / fire / holy / psychic).
   - **Non-damaging but applies a typed damaging effect:** already typed and unchanged — `rend` (physical DoT), `dissonance` + `natures_snare` (psychic/nature debuffs), `envenom` (poison), `ignite` (fire), `consecrate`/`holy_shield` (holy).
   - **Genuinely non-damaging — NULL is correct and stays NULL:** `arcane_surge`, `battle_cry`, `cloak_of_shadows`, `crescendo`, `disengage`, `divine_aegis`, `divine_challenge`, `eagle_eye`, `force_shield`, `heal`, `inspire`, `purifying_light`, `second_wind`, `shadowstep`, `shield_wall`, `transfer_health`, `sunder_armor`. Note `arcane_surge` amplifies later damage but deals none itself, so it carries no type.
   - **Validation, per category:** extend `validate_ability_row()` so `damage_type` is **required non-null** when the ability deals or applies damage (`ability_type='damage'`, or a DoT/damaging-effect mechanic: `dot_debuff`, `ignite_buff`, `poison_buff`, `consecrate`, `reactive_holy`, `ignite_consume`), and **required NULL** when `ability_type` is `heal`/`buff` with a non-damaging mechanic. Any value present must be a key in `DAMAGE_TYPE_REGISTRY`.
4. **Server.** None.
5. **Client.** None.
6. **Admin.** None.
7. **Compatibility.** Descriptive metadata and a validation rule only; balance untouched.
8. **Tests.** `ability-inventory.test.ts` snapshotting key/class/slot/mechanic/cp_cost/damage_type/calc for all 35; seed↔DB parity check; a table-driven test of the three damage-type categories.
9. **Manual checks.** Every ability still fires; numbers in the log unchanged; admin cannot save a damaging ability with no type, nor a heal with one.
10. **Out of scope.** Alternatives, ignite rework, admin field additions, event propagation (Phase 3).
11. **Deploy/rollback.** Migration only; rollback = drop the added validation branch.
12. **Later dependencies.** Phase 3 propagates this metadata into events.
13. **Files.** `supabase/migrations/*`, `src/shared/config/ability-seed.ts`, `supabase/functions/_shared/config/ability-seed.ts`, new test.

## Phase 2 — Lock down loadout mutation before anything trusts it (G4)

**Order changed deliberately.** The previous draft made combat trust `character_ability_loadout` (Phase 2) before revoking direct client writes (Phase 3). That would ship a release where any authenticated client could write its own equipped row, bypassing the alive/out-of-combat/stance rules, and combat would honour it. Mutation authority therefore comes **first**; equipped-state enforcement (now Phase 3) only begins relying on those rows once they can no longer be forged.

1. **Outcome.** Swapping a slot is validated by the server; illegal swaps fail even from a raw API call. No gameplay change yet (rows still only affect the client bar, exactly as today).
2. **Current code.** `useAbilityLoadout.ts` direct table writes; `AbilityLoadoutTab.tsx`; `character_ability_loadout` (0 rows).
3. **DB.** New `set_ability_loadout(_character_id, _role_id, _ability_id)` SECURITY DEFINER RPC (`search_path=public`) enforcing: ownership via `owns_character()`; character alive (`hp > 0`); no row in `combat_sessions` for the character or its party; the currently equipped ability for that slot is not an active stance in `reserved_buffs`/`stance_state`; the target ability is `status='active'`, assigned to the character's class on that exact role, and `unlock_level <= level`. Add `clear_ability_loadout(_character_id, _role_id)` for reverting to default. Then `REVOKE INSERT, UPDATE, DELETE ON public.character_ability_loadout FROM authenticated` (SELECT retained), and `GRANT EXECUTE` on both RPCs to `authenticated`.
4. **Server.** None beyond the RPCs.
5. **Client.** `useAbilityLoadout` calls the RPCs and surfaces their error text instead of writing the table.
6. **Admin.** None.
7. **Compatibility.** 0 existing rows, so nothing to migrate; an empty loadout stays valid and means "use the slot default".
8. **Tests.** RPC rejection cases (not owner, dead, in combat, stance up, wrong class, locked level, retired ability); direct table write is denied; hook error propagation.
9. **Manual checks.** Try swapping while in combat, while dead, and with that slot's stance active — each refused with a clear reason. A direct API write to the table fails.
10. **Out of scope.** Combat reading these rows (Phase 3), new alternatives.
11. **Deploy/rollback.** Migration, then client. Rollback = re-grant the direct DML; the client's RPC path keeps working.
12. **Dependencies.** Phase 3 and Phase 4 both depend on this landing first.
13. **Files.** migration, `src/hooks/useAbilityLoadout.ts`, `src/features/character/components/AbilityLoadoutTab.tsx`.

## Phase 3 — Full server authority: identity, cost, mechanic, equipped state, damage type (G1, G2, G3, G5, G9)

1. **Outcome.** Casts are entirely server-derived; a tampered client cannot alter cost, mechanic, damage type, or which ability is equipped. Player damage events start carrying authoritative damage types.
2. **Current code.** `combat-tick/index.ts` pending-ability loop; `_shared/load-ability-calcs.ts` (`ServerAbilityCalcEntry`, `authorizeQueuedAbility`, the live registry query, the compiled-seed prime); `_shared/combat/damage-types.ts`; the tick event builders.
3. **DB.** None.
4. **Registry work — exact additions.** `ServerAbilityCalcEntry` already carries `abilityKey`, `mechanicKey`, `classKey`, `abilityId`, `roleId`, `roleSlot`, `isDefault`, `unlockLevel`. Add two fields: `cpCost: number` and `damageType: DamageTypeKey | null`.
   - **Live registry query** (`class_ability_assignments` select in `load-ability-calcs.ts`): add `cp_cost` and `damage_type` to the nested `ability:abilities(...)` selection; map them onto the entry, running `damage_type` through `normalizeDamageType`.
   - **Compiled fallback** (`_shared/config/ability-seed.ts` + client mirror): each seed row already carries `cp_cost`; add `damage_type` to the seed shape and populate all 35 from the Phase 1 inventory. The seed-prime path fills `cpCost`/`damageType` the same way, so sealed mode and cold start answer identically. `abilityId`/`roleId` remain null for seed entries (already the case) — see the fallback policy section for what that restricts.
   - Extend `ability-seed-publish.test.ts` / `validateAbilityForPublish` so a row missing `cp_cost` or with an unknown `damage_type` cannot enter the registry.
5. **Server — authorization then composition.** The order is strict: (a) resolve `ability_key` → registry entry for the character's real class; (b) verify active, class-assigned, unlocked; (c) verify **equipped**: the entry's `abilityId` equals the character's `character_ability_loadout` row for that `roleId`, or, when no row exists, the entry is that role's `is_default`. Only after (a)–(c) is the authoritative cast composed from `entry.cpCost`, `entry.mechanicKey`, `entry.damageType`, `entry.roleSlot`, and the entry's calcs. Loadout rows are read in the existing tick character query.
   - `const cpCost = pa.cp_cost || 0` is replaced by `entry.cpCost`. Client-sent `cp_cost`, `ability_type` and any client `damage_type` are ignored entirely (never read after this phase).
   - Handler dispatch switches from `pa.ability_type` to `entry.mechanicKey`.
   - **Invalid / retired / wrong-class explicit selections must not silently fall back.** The loadout lookup is a plain read of `character_ability_loadout` (no inner join that can drop the row), so an explicit row is always seen. If the referenced ability is inactive, retired, no longer assigned to that role, or now above the character's level, the cast is **refused with a distinct reason** (`equipped_ability_unavailable`) and the Spellbook surfaces "this slot needs re-selecting" — it does not quietly resolve to the default.
6. **Server — damage-type propagation (metadata only).** The authoritative `entry.damageType` is threaded into every applicable player-originated event construction path in `combat-tick/index.ts` and its shared builders:
   - direct player ability damage (T0 nuke/strike branch, `power_strike`/`aimed_shot`/`backstab`/`fireball`/`smite`/`judgment`/`cutting_words`/`grand_finale`),
   - multi-hit and execute branches (`multi_attack`, `execute_attack`),
   - the Ignite-consume finisher (`ignite_consume`),
   - timed-effect application and each tick of player-applied effects written to `active_effects` (`dot_debuff`, `ignite_buff`, `poison_buff`, `consecrate`, `reactive_holy`) — the type is stamped at application and re-emitted per tick,
   - the same paths inside `combat-catchup` for offscreen DoT ticks,
   - `tick-event-builder.ts` / `log-event.ts` `damageType` field, already present for creature casts.
   Autoattacks keep their existing weapon-derived typing; abilities with NULL type emit no type, which renders exactly as today. **This adds metadata only: no resistance lookup, no mitigation change, no formula change.** A parity test asserts identical damage numbers before and after.
7. **Client.** `useCombatDriver` stops sending `cp_cost` and `ability_type`. Log formatting reads `damageType` from the event (already supported).
8. **Admin.** None.
9. **Compatibility.** Characters with no loadout rows resolve to `is_default` — today's behaviour for all 20 characters. Legacy payload handling is described in the alias section of Phase 5.
10. **Tests.** Extend `ability-identity-authorization.test.ts`: spoofed cost ignored, spoofed mechanic ignored, spoofed damage type ignored, non-equipped ability rejected, explicit-but-retired selection refused rather than defaulted, unlock level respected, default fallback works. Add a damage-type propagation test per event path and a numeric parity test.
11. **Manual checks.** All five bar buttons behave identically; CP deductions unchanged; combat log now names the damage type on ability hits and DoT ticks; damage numbers match a pre-phase recording.
12. **Out of scope.** Resistances, new abilities, UI redesign.
13. **Deploy/rollback.** Requires Phase 2 already live. Deploy edge functions first, then client. Rollback = redeploy the previous functions (the client still sends nothing extra, which the old function tolerates by defaulting cost from the registry-primed seed).
14. **Files.** `supabase/functions/combat-tick/index.ts`, `supabase/functions/combat-catchup/index.ts`, `supabase/functions/_shared/load-ability-calcs.ts`, `supabase/functions/_shared/config/ability-seed.ts`, `src/shared/config/ability-seed.ts`, `src/features/combat/events/{tick-event-builder,log-event}.ts`, `src/features/combat/hooks/useCombatDriver.ts`.

## Phase 4 — Frost Bolt: the first real alternative (G6)

1. **Outcome.** Every existing wizard immediately sees a second option in the Signature slot. Fireball stays equipped by default; Frost Bolt must be deliberately equipped.
2. **Current code.** `abilities` / `class_ability_assignments`; `ABILITY_SEED`; Spellbook; `combat-tick` T0 branch.
3. **DB.** Insert one `abilities` row `frost_bolt` — same `mechanic_key` as `fireball`, identical `amount_calc`, `cp_cost`, `target_type`, `activation_mode`, only `damage_type='frost'` and its own label/description/combat text. Insert one `class_ability_assignments` row on the wizard Signature role with `unlock_level` **equal to Fireball's** and `is_default=false`, `status='active'`. No admin activation gate.
4. **Server.** No new mechanic. Frost Bolt resolves through the same T0 handler; only the authoritative `damage_type` differs. Explicitly **no** chill, slow or other frost status. **Acceptance bar:** Frost Bolt is not "done" until its `frost` type, resolved server-side from the authorized `ability_key`, appears in the structured combat events produced by the Phase 3 propagation path — a matching label in the client alone does not count.
5. **Client.** None beyond what Phase 3 already renders; add the frost damage-type colour/wording to the log formatter if not already present.
6. **Admin.** Visible and editable via `AbilityConfigManager` (full assignment editing arrives in Phase 6).
7. **Compatibility.** Wizards with no loadout row keep casting Fireball (the default). Equipping Frost Bolt writes one loadout row through `set_ability_loadout`.
8. **Tests.** Only the equipped ability casts; the unequipped sibling is refused server-side; both keys resolve to identical damage numbers with different damage types; the emitted event carries `damageType='frost'`.
9. **Manual checks.** As a wizard, open Spellbook → Signature slot shows Fireball (equipped) and Frost Bolt; equip Frost Bolt, cast, confirm frost wording in the log and identical damage; confirm the bar no longer offers Fireball.
10. **Out of scope.** Frost status effects, resistances, other classes' alternatives.
11. **Deploy/rollback.** Migration only. **Rollback is a two-step data migration, not a status flip:** first `update character_ability_loadout set ability_id = <fireball id> where ability_id = <frost bolt id>` (or delete those rows so the slot default applies), verify zero rows remain pointing at Frost Bolt, and only then set the assignment `status='retired'`. This is required because Phase 3 refuses casts whose explicit selection has become unavailable rather than silently defaulting — retiring first would leave those wizards with a dead slot.
12. **Dependencies.** Requires Phases 2 and 3.
13. **Files.** migration, `src/shared/config/ability-seed.ts` + `_shared` mirror, possibly `src/features/combat/utils/cast-flavor.ts`.

## Phase 5 — Orbs of Fire (stance) and Ignite (timed effect) (G7)

1. **Outcome.** The wizard's tier-3 equippable ability is renamed **Orbs of Fire** and remains a stance. **Ignite** becomes the timed fire DoT that Orbs of Fire applies, and the state Conflagrate detects and consumes. Ignite is never equippable and never occupies a slot.
2. **Identity migration (the safest path).** Today the single `ability_key='ignite'` carries both meanings, and `active_effects.effect_type='ignite'` already names the effect. End state:
   - Equippable stance ability → `ability_key = 'orbs_of_fire'`.
   - Timed effect/status → `effect_type = 'ignite'` (unchanged; no data migration on `active_effects`).
   - `stances.ts` stance key becomes `orbs_of_fire`; `characters.reserved_buffs` is migrated in the same transaction (rename the `ignite` map key to `orbs_of_fire` for every row that has it), so stance state and effect state never share a name again.
   - `mechanic_key` stays `ignite_buff` (the coded handler) and `ignite_consume` for Conflagrate — renaming handlers is not required and would widen the diff.
   - **Legacy payload compatibility (corrected).** `LEGACY_ABILITY_KEY_BY_TYPE` (`load-ability-calcs.ts:289`) is keyed by the client's `ability_type`, so it cannot alias an incoming `ability_key`. Add a separate one-entry `LEGACY_ABILITY_KEY_ALIASES = { ignite: 'orbs_of_fire' }`, applied to `args.abilityKey` before registry lookup in `authorizeQueuedAbility`, and record each use through `_shared/ability-telemetry.ts` (which does not track legacy keys today and gains a counter for this). The alias is removed once that counter reads zero for a full release.
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
- **Authorizes only verifiable behaviour.** In fallback mode the server authorizes only the slot **defaults** — alternatives (Frost Bolt) are not castable while running on the compiled fallback, because seed entries carry no `abilityId`/`roleId` and so equipped-state cannot be verified. This is stated in the Phase 3 authorization tests.

## Risks and contradictions

- The request's Phase 1/2 largely already exist; implementing them again would duplicate working code. This plan replaces them with the specific closing of G1–G3 and G5 in Phase 3.
- `ignite` currently names both a stance and an effect. Phase 5 resolves the ambiguity by renaming the ability, not the effect — the reverse would require migrating live `active_effects` rows.
- Removing the mechanic-hint fallback (G9) is a wire-protocol change; safe only after Phase 3 telemetry shows no legacy payloads.
- Frost Bolt being castable requires live config, so the sealed-mode fallback intentionally reduces wizards to Fireball. Worth confirming that is acceptable during an emergency.
- Because Phase 3 refuses unavailable explicit selections instead of defaulting, every future retirement of an assigned ability must repoint or clear loadout rows first (see the Phase 4 rollback).

## Open items (no longer blocking)

Decisions 1–3 are resolved and folded in above. The one remaining question is timing, not design: whether the new Ignite curves should be scheduled as a labelled balance pass immediately after Phase 5 or deferred until Phase 7.

## Recommended first publishable step

Phase 1. One additive migration plus one snapshot test, zero gameplay change, and it produces the inventory every later phase is checked against.
