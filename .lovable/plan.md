# Ability Calculation Rework — Final Approved Plan (rev. 3)

## A. Verified counts

Confirmed by query against `classes` / `class_ability_assignments` / `abilities`: **7 selectable classes** (assassin, bard, healer, ranger, templar, warrior, wizard) × **5 active default abilities each = 35 active player abilities**. Every audit table, resolver route and parity case below covers all 35.

**Exactly 12 have `amount_calc = null`:** power_strike, aimed_shot, backstab, eviscerate, fireball, smite, judgment, cutting_words, grand_finale, holy_shield, shield_wall, consecrate. Barrage is *not* null (it has an `amount_calc` plus `arrow_count_calc` in `effect_config`).

## B. Verified current state

1. `CLASS_COMBAT_PROFILES` no longer exists (removed with the autoattack purge); remaining code-owned scaling is the 11 helpers in `shared/formulas/abilities.ts`.
2. The evaluator has two byte-identical copies: `src/shared/formulas/ability-calc.ts` and `supabase/functions/_shared/formulas/ability-calc.ts`.
3. The admin editor is JSON-first (`AbilityConfigManager.tsx`: `Textarea` + `JSON.parse` + `validateCalc` + `describeCalc`) — replaced by the visual builder in checkpoint 6.
4. **Security defect:** `consume_stacks` is client-supplied (`useCombatDriver.ts` sends it; `combat-tick` only clamps to 5). Becomes server-read from `active_effects` in checkpoint 2.
5. Registry key drift: client `${classKey}:${tier}`, server `${class_key}:${ability_key}`; combat dispatch switches on client-supplied `ability_type`. Consolidated onto `ability_key`.
6. Effect-key drift: `active_effects.effect_type` uses `poison`/`ignite`, `effect_config.consumes` says `poison_stacks`/`burn_stacks`. Canonical mapping added.
7. Consecrate's nerf is stored as `magnitude_reduction: 0.35` (a ×0.65 final multiplier).

## C. Decisions carried from review

**Bond and Arcane Surge stay global.** Damage-pipeline rules applied once, never duplicated per ability. Controlling values stay configurable in place (bond curve in `shared/formulas/bond.ts` config; Arcane Surge magnitude on its own ability row). The admin preview gains a **global-modifiers panel** — bond-tier and Arcane-Surge toggles showing `pre-global → post-global` — so the editor sees the true end number without those factors entering the ability's own calc.

**Named, typed mechanic calculations — no `bonus_calc` catch-all.** Each mechanic template declares the named calc parameters it supports, each with its own semantic key, unit, label and role. All are edited with the same visual builder and validated by the same evaluator.

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

Stored in `abilities.mechanic_calcs jsonb` (`{ arrow_count: AbilityCalcV2, … }`). Migration folds today's ad-hoc values into proper names: `arrow_count_calc` → `arrow_count`, `max_stacks_calc` → `max_stacks`, `cp_calc` → `cp_per_tick`, `reserve_hp_calc` → `reserve_hp`, plus helper-owned `proc_chance` (Envenom), `orb_chance` (Ignite), `per_arrow_multiplier` (Barrage), `per_stack_multiplier` (Eviscerate, Conflagrate), `block_chance` (Shield Wall), `crit_reduction` (Battle Cry), `crit_edge` (Grand Finale), `retaliation_kicker` (Holy Shield). Unknown param keys are rejected by validation.

**Judgment's ×0.8 becomes configuration.** Removed from the `ability_type==='smite' && class==='templar'` branch in `combat-tick`, stored as `finalMult: 0.8` labelled "Final multiplier (ability nerf)", editable, and rendered in both the generated formula string and the numeric preview. Consecrate's `magnitude_reduction: 0.35` migrates the same way to `finalMult: 0.65`.

**Single global cutover.** One flag, `USE_CONFIG_ABILITY_CALCS_V2`, flipped for all 7 classes at once only after the full parity suite is green. Legacy stays purely as a rollback path during production verification, then is deleted in checkpoint 7. No long-running per-class mixture.

## D. Clarifications from this round (rev. 3)

**1. One authoritative representation of multipliers.** `abilities.multiplier_calc` is **dropped from the schema**. `finalMult` and `multiplierCalc` live **inside the versioned `amount_calc` object** (and inside each named mechanic calc, which uses the same type). One column, one shape, one evaluator; nothing to keep in sync. A separately labelled output column would only be introduced if the implementation proves a case where a multiplier must be resolved without its parent amount — none is known, and if one appears it will be raised before checkpoint 4 rather than pre-built.

**2. Legacy fallback is a pre-cutover-only mechanism.** Before the flip: an invalid or missing active calc falls back to legacy and records the event. After the flip, **legacy is never silently invoked**. Instead:
- Validation moves to publish time — an ability row cannot transition `draft → active` unless every required calc for its mechanic template validates. Enforced by the DB validation trigger, not just the UI.
- Active rows are therefore already fully validated; if one still fails at resolve time it is a **hard error**: the action is rejected with a clear player-facing message and an `actionable_failure` audit row, no silent legacy substitution.
- Checkpoint 4 includes a one-off sweep asserting all 35 active rows validate, and checkpoint 5's suite fails if any active row lacks a required calc.

**3. No routine writes from the combat hot path.** Parity comparison uses **in-isolate aggregated counters** (compare count, match count, fallback count, mismatch count) plus `console.log` in development. `combat_audit_log` receives a row **only** for an actual mismatch, a fallback event, or an actionable failure — never for a successful comparison. Counters are exposed through an existing lightweight periodic flush (with the same guard used by other overlord diagnostics) so a hot tick performs zero extra writes in the healthy path.

**4. "Generic configuration" scope, documented.** Genuinely configurable means **reusable combinations of supported mechanic templates and their named parameters** — new numbers, curves, stat sources, dice, stacks, multipliers, floors and caps, freely recombined without code. It does **not** mean new combat *behaviour*: a mechanic that does something no existing handler does (a new targeting shape, a new status interaction) still requires a coded handler. The rule, written into `docs/design/ability-calculation-rework.md`, is that once such a handler exists it must expose its tunables as a `MechanicTemplate` with named, typed, unit-carrying params so they are immediately editable through the same visual builder — no handler ships with hardcoded magnitudes.

## E. Corrected roster — all 35 abilities

Columns: calc source today · `amount_calc` null? · inputs · dice · stacks · named mechanic calcs · multipliers · floor/round · hardcoded remainder.

**Warrior** — power_strike(1) inline T0 · **null** · str, level · 1d weapon (unarmed d4) · bond · max(1) · whole formula | second_wind(2) config · ok · con, level · floor 3 | battle_cry(3) config + `getBattleCryDR` · ok · str · `crit_reduction` · +0.05 shield | rend(4) config, 2000ms · ok · str, dex, weapon · per-tick weapon leg | sunder_armor(5) config · ok · str, dex

**Ranger** — aimed_shot(1) inline T0 · **null** · dex, level · weapon die · whole formula | eagle_eye(2) config · ok · dex, wis · cap 5 | barrage(3) config + `arrow_count_calc` + `getBarragePerArrowRatio` · ok · dex, wis · weapon die ×N · `arrow_count`, `per_arrow_multiplier` · roll-per-arrow stays mechanic | natures_snare(4) `getRootReduction` · ok · dex/cha · cap 0.40 | disengage(5) `getDisengageMult` · ok · wis, dex · 1.30–1.70

**Assassin** — backstab(1) inline T0 · **null** · dex, level · weapon die · stealth ambush mult, bond · whole formula | shadowstep(2) config · ok · dex, cha · cap 2.5 | envenom(3) config + `max_stacks_calc` + `getEnvenomProc` · ok · dex, cha · applies poison · `max_stacks`, `proc_chance`, `stacks_applied` | eviscerate(4) inline · **null** · dex, cha, level, **consumed_stacks** · weapon die · consumes all poison (≤5) · `per_stack_multiplier` · 1+(0.50+effCHA×0.02)×stacks, bond · round→floor, max(1) · whole formula | cloak_of_shadows(5) `getCloakDodge` · ok · dex, cha · cap 0.60

**Wizard** — fireball(1) inline T0 spell · **null** · int, level · Arcane Surge, bond · max(1), round · `5 + 2×soft(int) + ⌊lvl/3⌋` | force_shield(2) config · ok · int/con · `regen_per_tick` | arcane_surge(3) `getArcaneSurgeMult` · ok · int · global ×1.10–1.22 · applied at 3 sites → centralised | ignite(4) config + `getIgniteOrbChance` · ok · int, wis · applies burn · `orb_chance`, `stacks_applied` | conflagrate(5) config base + `getConflagratePerStack` · ok · int, level, **consumed_stacks** · consumes burn ≤5 · `per_stack_multiplier` · Arcane Surge, bond · floor, max(1)

**Healer** — smite(1) inline T0 spell · **null** · wis, level | heal(2) config · ok · wis, level · floor 3 | transfer_health(3) config + `reserve_hp_calc` · ok · wis, con · `reserve_hp` · max(1) | purifying_light(4) config, 3000ms · ok · wis, con · `regen_per_tick` | divine_aegis(5) config · ok · wis, con · cap 60s

**Templar** — judgment(1) inline T0 spell **+ ×0.8** · **null** · wis, level · `finalMult 0.8` (configured) · class rider removed | holy_shield(2) inline · **null** · wis, con · `retaliation_kicker` · both legs hardcoded | shield_wall(3) inline · **null** · con, wis · `block_chance` (cap 0.95) · both legs hardcoded | consecrate(4) inline ×0.65, 2000ms · **null** · wis, con · `finalMult 0.65` | divine_challenge(5) `getDivineChallengeFlat` · ok · wis, con · round, floor 6

**Bard** — cutting_words(1) inline T0 spell · **null** · cha, level | inspire(2) config + `cp_calc` · ok · cha, int · `cp_per_tick` · floor 1 | dissonance(3) `getRootReduction` · ok · cha, int · cap | crescendo(4) config, 3000ms · ok · cha, int · `regen_per_tick` | grand_finale(5) inline burst · **null** · cha, int, level · `crit_edge` · bond · max(1) · both legs hardcoded

**Why the 12 are null:** each needs something today's `CalcTerm` cannot express — a weapon die (power_strike, aimed_shot, backstab, eviscerate), a consumed-stack multiplier (eviscerate), a second named magnitude (shield_wall, holy_shield, grand_finale), or a final ability multiplier (judgment 0.8, consecrate 0.65). Nothing is inherently inexpressible.

**Bypass paths in `combat-tick` to route through the resolver:** T0 dispatch, eviscerate, conflagrate, burst_damage, templar block / holy / consecrate handlers, and the three Arcane Surge application sites.

## F. Canonical contract

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

Fixed order, never author-chosen:

```
primary   = base + Σ term(i)                    // per-term rounding only
withConst = primary × (finalMult ?? 1)
mult      = multiplierCalc ? eval(multiplierCalc) : 1
value     = clamp(applyRounding(round(withConst × mult, multRounding)))
```

Named mechanic calcs use the same type and evaluate independently with their own rounding/floor/cap. Absent optional component = identity. `postMult` is folded into `finalMult` (one concept, not two).

**New term sources.** `dice`: `{ source:'dice', count, die:'weapon_main'|'d4'…'d12', fallbackDie:4 }` — `weapon_main` resolves via the existing `getMemberWeaponDie()`, unarmed → fallback; each roll independent; Barrage rolls once per arrow. Randomness only in `combat-tick` through an injectable `RollSource` so tests seed it. `context`, allowlisted to `active_stacks` and `consumed_stacks`. Preview shows min/max/avg for dice and lets the editor pick a context value.

## G. Typed stacks

Canonical `poison_stacks` / `burn_stacks`, mapped to existing `active_effects.effect_type` values `poison` / `ignite` (shared mapping; no data migration). Stack behaviour is a validated shared-TS mechanic registry, not a new table — two stack types, both needing code handlers. Abilities reference it via `effect_config.stack_op`: `{ stackType, op: 'apply'|'consume_all'|'consume_n', timing: 'on_hit'|'on_commit', owner: 'target' }`, with `max_stacks` / `stacks_applied` as named mechanic calcs. Current semantics preserved exactly: consumed on commit (also on miss), clamp 5. Server reads the count from `active_effects`; the client field is dropped.

## H. Lookup consolidation

One identity: **`ability_key`**. Client registry re-keyed from `class:tier` to `ability_key` (tier kept only for bar order); queued payload sends `ability_key`; `combat-tick` dispatches on the **server-loaded** `mechanic_key`, with a temporary `ability_type` → key map for in-flight actions.

## I. Checkpoints — each completed and verified independently before the next

1. **Audit + identity (this checkpoint only).** Land `docs/design/ability-calculation-rework.md` with the verified 35-ability roster, the canonical contract, the mechanic-template model, the generic-configuration scope note (D4) and the validation policy (D2). Re-key the client registry from `class:tier` to `ability_key`, keeping tier for bar ordering, with a legacy compat map. **No math change** — verified by the existing `ability-calcs.test.ts` and `ability-calc-parity.test.ts` passing unchanged plus a new key-coverage test asserting all 35 keys resolve.
2. **One resolver** — `resolveAbilityMagnitude(ctx)` in `_shared`; route all bypass paths through it with current inline math as explicit `legacyFallback`; in-isolate aggregated counters, dev logging, audit rows only for mismatch / fallback / actionable failure. Fix `consume_stacks` to server-read here.
3. **Evaluator v2** — dice + context sources, `finalMult`, `multiplierCalc`, `multRounding`, injectable `RollSource`, extended `describeCalc`/`validateCalc`, mechanic-template registry; test asserting the two evaluator mirrors stay identical.
4. **Schema + seed** — add `abilities.mechanic_calcs jsonb` and `abilities.calc_version smallint default 2` (**no** `multiplier_calc` column); validation trigger rejecting unknown sources / param keys / mechanic keys **and blocking `draft → active` when a required calc is missing or invalid**; backfill all 12 nulls, migrate the four existing `*_calc` blobs and the 11 helper values into named params, move judgment 0.8 and consecrate 0.65 into `finalMult`; sweep asserting all 35 active rows validate.
5. **Parity proof** — extend `ability-calc-parity.test.ts` to **all 7 classes × all 35 abilities** plus every named mechanic calc: levels [1,5,10,15,20,30,42] × stat mods including thresholds and negatives; seeded rolls (min, max, 3 mid, per-arrow sequences); stacks 0/1/partial/max; unarmed vs every weapon die; operation-order distinctions; eviscerate intermediate-stage comparison; global-modifier panel values checked against the pipeline. Flip `USE_CONFIG_ABILITY_CALCS_V2` (all classes) only when green — at which point legacy fallback stops being a resolve-time path.
6. **Visual editor** — replace the JSON textarea with term rows (source/stat/mult/transform/rounding), dice picker, stack-op picker, floor/cap/rounding selects, a **named mechanic-calc section driven by the mechanic template** (each param labelled with its unit), a final-multiplier field, generated formula line, min/max/avg, level×mod example table, context selector, the global-modifier preview panel, per-field validation and publish-blocking on invalid drafts. JSON becomes a collapsed read-only diagnostic.
7. **Remove legacy** — once fallback counters read zero for a full production cycle: delete the inline formulas, the `ability_type` compat map, and the superseded helpers in `shared/formulas/abilities.ts`.

## J. Validation, security, rollback

Reject unknown term sources, unknown context/stack/param keys, unknown mechanic keys, dice count outside 1–20, non-finite multipliers, `floor > cap`, >12 terms, nesting depth >2. Enforced by the DB trigger at write and publish time and re-validated server-side on load. RLS unchanged: `abilities` readable by players, writes steward/overlord only. Preview evaluates **client-side** on the shared evaluator — no server preview endpoint, so no formula-execution surface. Rollback: all new columns additive; `calc_version` plus the single global flag gate the resolver, so flipping back restores legacy with no data change; comparison mode passes the **same seeded `RollSource`** to both paths so dice roll once.
