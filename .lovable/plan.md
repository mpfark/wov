## Verified current state

Confirmed by reading the repository:

- **Identity is reconstructed, not carried.** The client sends only `ability_type` in the tick payload (`useCombatDriver.ts`). `combat-tick/index.ts` rebuilds config identity via a hardcoded `ABILITY_KEY_BY_TYPE` map plus a `smite`+`templar` → `judgment` special case. Queued actions live in client memory inside the tick payload — no queue table, so no queue migration.
- **Server drops alternatives.** `load-ability-calcs.ts` filters `row.is_default`, so a non-default loadout ability resolves the *default* ability's calcs.
- **Server validation is shape-only.** `asCalc` checks `terms` is an array and `base` is a number; invalid calcs are silently dropped. `validateCalc` runs only on admin publish paths, never at tick time.
- **Registry can be partially replaced.** `setServerAbilityCalcs` clears and re-assigns whenever the fetch returns ≥1 row, even if individual rows are invalid.
- **Stances** persist in `characters.reserved_buffs[stance_key]`; **DoTs** persist as `active_effects.effect_type` (`poison`/`ignite`/`bleed`) — mechanic-typed, no ability attribution.
- **Parameter audit.** Live consumers exist for `max_stacks`, `arrow_count`, `per_stack_multiplier`, `crit_edge`, `block_chance`, `block_amount`, `retaliation_damage`. **No consumer** for `proc_chance`, `orb_chance`, `stacks_applied`, `per_arrow_multiplier`, `damage_multiplier`, `regen_per_tick`, `cp_per_tick`, `flat_reduction`, `final_multiplier`, `dodge_chance`, `root_reduction`, `reserve_hp`. Hardcoded values remain for poison/burn tick damage, DoT durations (25 s fixed, 30–45 s variable), ignite max stacks (5), pulse damage, transfer-health reserve (`max(1, conMod)`), inspire CP/tick, disengage 15 s window, `dodgeChance: 1.0`, and two 5-minute client stance durations. `root_reduction` is written into client buff state but read by no damage path — that debuff is currently cosmetic.

## Identity contract

**`ability_key` is the canonical queued identity** — already the server registry key, already unique in `abilities`, no data migration needed. The client sends `ability_key` plus `role_id`; `role_id` is used **only** for mismatch detection and logging, never for authorization. `ability_type` is kept one release as a compatibility fallback.

Server resolution, per queued ability, **before any mutation**:
1. `ability_key` → active `abilities` row.
2. Derive the authoritative role from the active `class_ability_assignments` row for `(character.class, ability)`.
3. Verify the character's `character_ability_loadout` selection for that derived role matches the ability, or that the ability is the role default when no row exists.
4. If the client-supplied `role_id` disagrees with the derived role, increment a mismatch counter, log, and continue with the derived role.
5. Reject retired / unassigned / wrong-class / unselected abilities with **no CP, HP, stack, stance, effect or cooldown mutation**.
6. Dispatch on the resolved row's `mechanic_key`; every number comes from that row's own `amount_calc` / `duration_calc` / `interval_ms` / `mechanic_calcs`.

Missing `ability_key` (old client) falls back to the legacy map once, increments a `legacy_identity` counter, and resolves normally. The map moves into `legacy-ability-identity.ts` with a removal note.

## Single authoritative source per value

One value, one home — no duplicate parameters:
- **Tick damage → `amount_calc`** (the DoT's own row). No `tick_damage` mechanic parameter is introduced.
- **Duration → `duration_calc`**.
- **Tick interval → `interval_ms`**.
- **Named mechanic parameters** carry only proc/orb chance, stack behaviour and other discrete mechanic knobs (`proc_chance`, `orb_chance`, `stacks_applied`, `max_stacks`, …).

Envenom's proc chance and Ignite's orb chance move off `amount_calc` onto their named params, which frees `amount_calc` to mean tick damage consistently with the editor label. Publish validation enforces that no mechanic parameter shadows an `amount_calc` / `duration_calc` / `interval_ms` value.

## Variable durations

The existing 30–45-second variable duration stays variable. `duration_calc` is extended with an explicit **bounded-random range** (`min`/`max`, or `spread` around a base) resolved from **controlled randomness supplied through `CalcInputs`** — the same injection pattern already used by `roll` for dice terms. The evaluator never generates its own randomness: with no random input supplied it resolves deterministically (midpoint by default, `min`/`max` selectable like `diceMode`), and given the same supplied random input it always produces the same result. Tests cover **both boundaries** (exactly 30000 and 45000), **representative values within the range**, determinism for a repeated input, a guard that `Math.random` is never called, and confirmation that **fixed-duration abilities remain fixed**. No existing duration becomes fixed.

## Work plan

**1. Canonical identity end to end**
- Extend the queued payload in `useCombatActions.ts` / `useCombatDriver.ts` (including the `member_pending_ability` party broadcast) with `ability_key` and `role_id`.
- Add `resolveQueuedAbility()` in `combat-tick`: registry lookup, derived-role authorization, rejection path. Every branch switches from `pa.ability_type` to the resolved `mechanic_key`.
- Load participants' loadouts in one batched query per tick.
- Stances: pass `ability_key` to `activate_stance`, authorized against assignment + loadout server-side (the existing allow-list stays as a mechanic guard, not identity).
- `active_effects`: add nullable `source_ability_key`, populated for **newly created** effects only. **No backfill** — existing ambiguous rows stay null and expire normally. `effect_type` remains the mechanic/stack channel.

**2. Server loads all active assignments**
- Drop the `is_default` filter; key the registry by `class:ability_key` for every active assignment. `is_default` only answers "what does this role fall back to".

**3. Parameter wiring (values preserved exactly)**
Wire each unused-but-supported param to its handler, moving today's hardcoded number into the seed/DB calc so results are numerically identical: `proc_chance`, `orb_chance`, `stacks_applied`, `per_arrow_multiplier`, `final_multiplier` (Judgment 0.8 / Consecrate 0.65 unchanged), `damage_multiplier` (stealth / disengage / damage buff), `flat_reduction`, `regen_per_tick`, `cp_per_tick` (Inspire, now server-authoritative), `reserve_hp` (Transfer Health, now server-authoritative), `dodge_chance`, ignite `max_stacks`, disengage window. DoT tick damage and durations move to `amount_calc` / `duration_calc`.
- **Remove** `root_reduction` from `root_debuff`: no handler consumes it and implementing the reduction would change balance. Documented as needing a future reusable mitigation-channel mechanic. Same treatment for any other param that cannot be wired without changing behaviour.

**4. Requirement-level validation**
- Add `requiresAmount` / `requiresDuration` / `requiresInterval` / `requiredMechanicCalcs` to `MechanicTemplate`, enforced in `validateAbilityForPublish`: unit checks (count → integer, pct → 0..1, mult > 0), floor ≤ cap, allowed term sources and context keys, range validity (`min ≤ max`), stack-op compatibility, no duplicate-source shadowing, and mechanic relationships (DoT needs amount + duration + interval; stack consumers need a declared stack type; multi-hit needs a count and a per-hit amount). Drafts may stay incomplete; only `status='active'` requires the full contract.
- Mirror the rules into the SQL publish guard so the database cannot hold an invalid active row.

**5. No silent zero, full server validation, safe refresh**
- `load-ability-calcs.ts` uses the shared `validateCalc` + `validateAbilityForPublish` contract. A refresh applies **atomically or not at all**: if any active row fails, the previous fully valid registry is kept, one audit row is written and a counter increments.
- `resolveAbilityMagnitude` failures no longer return a quiet `0`: they raise a controlled `AbilityConfigError`, the ability aborts **before resources are spent**, the player sees a neutral "the technique falters" line, and one actionable audit row is written (failures only).

**6. Temporary sealed-configuration mode**
- `ABILITY_RESOLVER_MODE` (`v2` | `sealed`), read through the existing cached configuration path with a documented 60 s TTL (same as the ability-calc cache) — **no uncached `app_secrets` query per tick**.
- `sealed` makes client and server resolve **only** from the parity-verified compiled `ABILITY_SEED`, ignoring database rows. It protects against invalid database configuration, registry-refresh problems and unsafe admin changes. It does **not** protect against bugs shared by both modes in the resolver, evaluator or mechanic handlers. Removable once this pass is verified in production.

**7. Tests**
- A deliberately differently tuned **alternative** ability sharing a `mechanic_key` with a default, assigned to a class, selected in a loadout, queued by `ability_key` through the real queued combat path — asserting it resolves its own numbers.
- Rejection tests: unassigned, other class, retired, forged identity, `role_id` mismatch, legacy `ability_type`-only payload, stance and T0 identity.
- **Resource-immutability tests**: after each authorization rejection and each configuration rejection, assert CP, HP, stacks, stances, active effects and cooldowns are unchanged.
- Variable-duration tests as described above (boundaries, in-range samples, determinism, no self-randomness, fixed durations unchanged).
- One test per admin-visible param: move the fixture value, assert the intended live result moves and neighbours do not; assert removed params are absent from templates; assert no duplicate source for a single value.
- Validation tests for every missing/invalid case, draft-vs-active, a failed refresh keeping the previous registry, and missing context never becoming zero.
- Full existing ability and parity suites stay green.

## Technical notes

- Schema: `active_effects.source_ability_key` (nullable, no backfill) plus validation triggers on the ability tables. `mechanic_calcs` gains seeded params at today's numeric values — a data migration, not a behaviour change.
- Hot path: one extra batched loadout query per tick, no per-resolution writes; audit rows only on rejection, invalid refresh, or sealed-mode activation.
- Final deliverable: verified causes, files changed, migrations, the parameter → consumer → test table, legacy-identifier handling, invalid-config behaviour, sealed-mode docs, test/typecheck/build results, and any values that remain hardcoded with reasons.
