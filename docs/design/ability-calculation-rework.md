# Ability Calculation Rework

Status: **checkpoint 3 landed** (evaluator v2 + mechanic templates). Checkpoints 4–7 pending.

This document is the reference for the migration of every player-ability
calculation into genuinely configurable data. It records the verified audit, the
canonical contract, the mechanic-template model, and the policies that govern
validation, fallback and scope.

---

## 1. Verified roster — 7 classes × 5 abilities = 35

Confirmed by query against `classes` / `class_ability_assignments` /
`abilities`: seven selectable classes, five active default abilities each.

| Class | 1 Signature | 2 Discipline | 3 Doctrine | 4 Pressure | 5 Mastery |
| --- | --- | --- | --- | --- | --- |
| warrior | power_strike\* | second_wind | battle_cry | rend | sunder_armor |
| ranger | aimed_shot\* | eagle_eye | barrage | natures_snare | disengage |
| assassin | backstab\* | shadowstep | envenom | eviscerate\* | cloak_of_shadows |
| wizard | fireball\* | force_shield | arcane_surge | ignite | conflagrate |
| healer | smite\* | heal | transfer_health | purifying_light | divine_aegis |
| templar | judgment\* | holy_shield\* | shield_wall\* | consecrate\* | divine_challenge |
| bard | cutting_words\* | inspire | dissonance | crescendo | grand_finale\* |

`*` = `amount_calc IS NULL` today (12 abilities): power_strike, aimed_shot,
backstab, eviscerate, fireball, smite, judgment, cutting_words, grand_finale,
holy_shield, shield_wall, consecrate. Barrage is **not** null — it has an
`amount_calc` plus an `arrow_count_calc` inside `effect_config`.

### Why the 12 are null

Each needs something the current `CalcTerm` set cannot express:

- **weapon die** — power_strike, aimed_shot, backstab, eviscerate
- **consumed-stack multiplier** — eviscerate (and conflagrate's rider)
- **second named magnitude** — shield_wall, holy_shield, grand_finale
- **final ability multiplier** — judgment (×0.8), consecrate (×0.65)

Nothing is inherently inexpressible; the evaluator is the gap.

### Code-owned scaling still outside config (11 helpers)

`src/shared/formulas/abilities.ts`: `getBattleCryDR`, `getRootReduction`,
`getDisengageMult`, `getCloakDodge`, `getEnvenomProc`, `getEnvenomMaxStacks`,
`getArcaneSurgeMult`, `getConflagratePerStack`, `getIgniteOrbChance`,
`getBarragePerArrowRatio`, `getDivineChallengeFlat`.

### `combat-tick` bypass paths to route through the resolver

T0 dispatch, eviscerate, conflagrate, burst_damage, the templar block / holy /
consecrate handlers, and the three Arcane Surge application sites.

---

## 2. Identity — `ability_key` (checkpoint 1)

Before: the client registry was keyed `class_key:tier` while the server registry
used `class_key:ability_key`, and combat dispatch switched on a
**client-supplied** `ability_type`.

After: **`ability_key` is the single identity.** `ability_key` is unique per
ability, so two classes sharing a mechanic with different scaling (Healer's
Purifying Light WIS/CON vs Bard's Crescendo CHA/INT) remain distinct entries.

- `src/features/combat/utils/ability-calcs.ts` stores entries by `ability_key`
  and keeps a compat map `class_key:tier -> ability_key`.
- Canonical accessors: `getAbilityCalcsByKey`, `resolveAmountByKey`,
  `resolveDurationByKey`, `resolveIntervalByKey`, `getAbilityKeyForSlot`.
- Tier-based `getAbilityCalcs` / `resolveAmount` / `resolveDuration` /
  `resolveInterval` remain as compat wrappers resolving through the map, so this
  checkpoint changes **no math**.
- Bar tier is presentation ordering only; it is no longer an identity.

---

## 3. Canonical contract (checkpoint 3)

```ts
interface AbilityCalcV2 {
  version: 2;
  base: number;
  terms: CalcTerm[];               // + 'dice' and 'context' sources
  finalMult?: number;              // constant ability rider (judgment 0.8, consecrate 0.65)
  multiplierCalc?: AbilityCalcV2;  // calculated multiplier (per-stack riders)
  multRounding?: CalcRounding;     // preserves eviscerate's intermediate round
  rounding?: CalcRounding; floor?: number | null; cap?: number | null;
  unit: CalcUnit; note?: string;
}
```

Fixed evaluation order, never author-chosen:

```text
primary   = base + Σ term(i)                 // per-term rounding only
withConst = primary × (finalMult ?? 1)
mult      = multiplierCalc ? eval(multiplierCalc) : 1
value     = clamp(applyRounding(round(withConst × mult, multRounding)))
```

**One authoritative representation.** `finalMult` and `multiplierCalc` live
*inside* the versioned calc object (`amount_calc`, and each named mechanic calc,
which uses the same type). There is **no** separate `abilities.multiplier_calc`
column — one column, one shape, one evaluator, nothing to keep in sync.
`postMult` folds into `finalMult`; they are one concept.

### New term sources

- `dice`: `{ source: 'dice', count, die: 'weapon_main' | 'd4'…'d12', fallbackDie: 4 }`.
  `weapon_main` resolves via the existing `getMemberWeaponDie()`; unarmed falls
  back to the configured die. Each roll is independent; Barrage rolls once per
  arrow. Randomness lives only in `combat-tick`, behind an injectable
  `RollSource` so tests can seed it.
- `context`: allowlisted to `active_stacks` and `consumed_stacks`.

---

## 4. Named, typed mechanic calculations

There is **no `bonus_calc` catch-all**. Each mechanic template declares the
named calc parameters it supports, each carrying its own semantic key, label,
unit and role. All are edited with the same visual builder and validated by the
same evaluator, preserving the meaning and unit of every value.

```ts
interface MechanicCalcParam {
  key: 'arrow_count' | 'max_stacks' | 'proc_chance' | 'stacks_applied'
     | 'per_arrow_multiplier' | 'per_stack_multiplier' | 'block_chance'
     | 'crit_reduction' | 'crit_edge' | 'retaliation_kicker'
     | 'reserve_hp' | 'cp_per_tick' | 'regen_per_tick' | 'orb_chance';
  label: string;
  unit: 'count' | 'pct' | 'mult' | 'hp' | 'cp' | 'flat' | 'ms';
  required: boolean;
  role: 'magnitude' | 'rate' | 'multiplier' | 'chance' | 'threshold';
}

interface MechanicTemplate {
  mechanicKey: string;
  supportsAmount: boolean; supportsDuration: boolean; supportsInterval: boolean;
  params: MechanicCalcParam[];
  requiresStackOp?: StackOpSpec;
}
```

Stored in `abilities.mechanic_calcs jsonb` as `{ arrow_count: AbilityCalcV2, … }`.
Migration mapping (checkpoint 4):

| Today | Becomes |
| --- | --- |
| `effect_config.arrow_count_calc` (barrage) | `arrow_count` |
| `effect_config.max_stacks_calc` (envenom) | `max_stacks` |
| `effect_config.cp_calc` (inspire) | `cp_per_tick` |
| `effect_config.reserve_hp_calc` (transfer_health) | `reserve_hp` |
| `getEnvenomProc` | `proc_chance` |
| `getIgniteOrbChance` | `orb_chance` |
| `getBarragePerArrowRatio` | `per_arrow_multiplier` |
| `getConflagratePerStack`, eviscerate per-stack | `per_stack_multiplier` |
| shield_wall block chance | `block_chance` |
| `getBattleCryDR` crit leg | `crit_reduction` |
| grand_finale crit edge | `crit_edge` |
| holy_shield CON kicker | `retaliation_kicker` |
| templar ×0.8 (judgment), ×0.65 (consecrate) | `finalMult` on `amount_calc` |

Unknown param keys for a mechanic are rejected by validation.

### Scope: what "generic configuration" means

Configurable means **reusable combinations of supported mechanic templates and
their named parameters** — numbers, curves, stat sources, dice, stacks,
multipliers, floors and caps, freely recombined without code.

It does **not** mean new combat *behaviour*. A mechanic that does something no
existing handler does (a new targeting shape, a new status interaction, a new
resolution step) still requires a coded mechanic handler. The standing rule:

> Once such a handler exists, its tunables **must** be exposed as a
> `MechanicTemplate` with named, typed, unit-carrying params, so they are
> immediately editable through the same visual builder. No handler ships with
> hardcoded magnitudes.

---

## 5. Global rules stay global

**Bond** and **Arcane Surge** are damage-pipeline rules applied once, not
duplicated across individual ability rows. Their controlling values remain
configurable in place (bond curve in `shared/formulas/bond.ts` config; Arcane
Surge magnitude on its own ability row).

The admin preview gains a **global-modifiers panel** — bond-tier and
Arcane-Surge toggles showing `pre-global → post-global` — so an editor sees the
true end number without those factors entering the ability's own calc.

---

## 6. Typed stacks

Canonical names `poison_stacks` / `burn_stacks`, mapped to the existing
`active_effects.effect_type` values `poison` / `ignite` via a shared mapping (no
data migration). Stack behaviour is a validated shared-TS mechanic registry, not
a new table: there are two stack types and both need code handlers, so a table
would add RLS surface without buying configurability.

Abilities reference it through `effect_config.stack_op`:

```ts
{ stackType, op: 'apply' | 'consume_all' | 'consume_n',
  timing: 'on_hit' | 'on_commit', owner: 'target' }
```

with `max_stacks` / `stacks_applied` as named mechanic calcs. Current semantics
are preserved exactly: consumed on commit (including on a miss), clamped to 5.

**Security:** `consume_stacks` is client-supplied today (`useCombatDriver.ts`
sends it; `combat-tick` only clamps it). Checkpoint 2 makes the server read the
count from `active_effects` and drops the client field.

---

## 7. Validation and fallback policy

**Legacy fallback is a pre-cutover-only mechanism.**

Before the `USE_CONFIG_ABILITY_CALCS_V2` flip: a missing or invalid active calc
falls back to the legacy inline math and records the event.

After the flip, legacy is **never silently invoked**:

- Validation happens at **publish time** — an ability row cannot move
  `draft → active` unless every required calc for its mechanic template
  validates. Enforced by the DB validation trigger, not only the UI.
- Active rows are therefore already fully validated. If one still fails at
  resolve time it is a **hard error**: the action is rejected with a clear
  player-facing message and an `actionable_failure` audit row — no silent
  substitution.
- Checkpoint 4 sweeps all 35 active rows for validity; checkpoint 5's suite
  fails if any active row lacks a required calc.

Rejected by validation: unknown term sources, unknown context/stack/param keys,
unknown mechanic keys, dice count outside 1–20, non-finite multipliers,
`floor > cap`, more than 12 terms, nesting depth above 2.

RLS is unchanged: `abilities` is readable by players, writable by
steward/overlord only. The preview evaluates **client-side** on the shared
evaluator — no server preview endpoint, so no formula-execution surface.

---

## 8. Observability — no routine hot-path writes

Parity comparison uses **in-isolate aggregated counters** (compare, match,
fallback, mismatch) plus `console.log` in development. `combat_audit_log`
receives a row **only** for an actual mismatch, a fallback event, or an
actionable failure — never for a successful comparison. A healthy tick performs
zero extra writes.

Comparison mode passes the **same seeded `RollSource`** to both paths so dice
roll once.

---

## 9. Cutover and rollback

One flag, `USE_CONFIG_ABILITY_CALCS_V2`, flipped for **all 7 classes together**
once the full parity suite is green. Legacy stays in place purely as a rollback
path during production verification, with fallback-use monitoring, and is
deleted in checkpoint 7. No long-running mixture of old and new class
resolution.

All new columns are additive; `calc_version` plus the single global flag gate the
resolver, so flipping back restores legacy behaviour with no data change.

---

## 10. Checkpoints

Each is completed and verified independently before the next begins.

1. **Audit + identity** — this document; client registry re-keyed to
   `ability_key` with a `class:tier` compat map. No math change. ✅
2. **One resolver** — `resolveAbilityMagnitude(ctx)` in `_shared`; route every
   bypass path through it with the current inline math as an explicit
   `legacyFallback`; aggregated counters + dev logging; audit rows only for
   mismatch / fallback / actionable failure. Server-read `consume_stacks`.
3. **Evaluator v2** ✅ — dice + context sources, `finalMult`, `multiplierCalc`,
   `multRounding`, injectable `RollSource`, extended `describeCalc` /
   `validateCalc`, mechanic-template registry, mirror-identity test.
4. **Schema + seed** — `abilities.mechanic_calcs jsonb`,
   `abilities.calc_version smallint default 2` (no `multiplier_calc` column);
   validation trigger incl. publish gating; backfill all 12 nulls and migrate the
   table in §4; sweep all 35 active rows.
5. **Parity proof** — all 7 classes × all 35 abilities plus every named mechanic
   calc: levels [1,5,10,15,20,30,42] × stat mods incl. thresholds and negatives;
   seeded rolls (min, max, 3 mid, per-arrow sequences); stacks 0/1/partial/max;
   unarmed vs every weapon die; operation-order distinctions; eviscerate
   intermediate stages; global-modifier panel values. Then flip the flag.
6. **Visual editor** — term rows, dice picker, stack-op picker, floor/cap/rounding
   selects, template-driven named mechanic-calc section, final-multiplier field,
   generated formula line, min/max/avg, level×mod table, context selector,
   global-modifier panel, per-field validation, publish blocking. JSON becomes a
   collapsed read-only diagnostic.
7. **Remove legacy** — delete the inline formulas, the `ability_type` compat map,
   and the superseded helpers in `shared/formulas/abilities.ts`.
