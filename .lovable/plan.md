# Chilled — reusable damage-amplification status

Add **Chilled** as a reusable applied status that increases eligible incoming damage on a creature by 10% for 6s (3 ticks), no stacking, refresh on reapply, no periodic damage. Frost Bolt becomes the first source. No balance changes to Frost Bolt.

## 1. Verified current damage flow (audited, not assumed)

Player damage to creatures is resolved entirely in memory inside one `combat-tick` invocation, then written once:

```text
source-specific calculation (per mechanic)
  -> resolveDamage({ amount, hp })            (shared final clamp, no ward on creatures)
  -> cHp[creatureId] mutated in memory
  -> writeCreatureState() -> encounter_apply_damage RPC (single authoritative delta write)
```

Confirmed creature-damage call sites (all funnel through `resolveDamage`, all mutate `cHp`):

| Path | Location |
|---|---|
| Item proc `burst_damage` | `combat-tick/index.ts:136` |
| Multi-arrow volley (Barrage) | `combat-tick/index.ts:1293` |
| Stack finisher (`stack_consume`) | `combat-tick/index.ts:1417` |
| Direct ability damage (`spell_attack`/`weapon_attack`, incl. Frost Bolt) | `combat-tick/index.ts:1526` |
| Burst damage mechanic | `combat-tick/index.ts:1594` |
| Holy Shield retaliation (reactive/reflect-like) | `combat-tick/index.ts:1909` |
| Aura pulse (Consecrate burn) | `combat-tick/index.ts:2150` |
| Main-hand auto-attack | `combat-tick/index.ts:2253` |
| Off-hand auto-attack | `combat-tick/index.ts:2378` |
| Stance pulse spark (Orbs of Fire) | `combat-tick/index.ts:2458` |
| DoT ticks (Ignite/Poison/Bleed), live + offscreen | `_shared/combat-resolver.ts:127` and `:172` (shared with `combat-catchup`) |

So every path already converges on `resolveDamage` immediately before the in-memory HP mutation. That convergence point is where the new modifier stage goes — one insertion per site, no new write path, `writeCreatureState` untouched.

**Source classification today:** only aggregate (`WriteCreatureStateOpts.sourceKind: 'autoattack' | 'ability' | 'dot' | 'proc'`) on the combined write — there is no per-hit classifier. Smallest safe extension: a per-hit `CreatureDamageSource` union passed explicitly at each call site (no inference from log text or ability names).

**Reflected damage:** the runtime has no true damage-reflection mechanic. The closest is Holy Shield retaliation (`:1909`), which is a reactive strike, not reflection. It will be classified `'reflect'` and excluded, giving the exclusion a real home now and a safe default for any future reflect path.

## 2. Shared modifier stage

New pure module `src/shared/combat/creature-damage-modifiers.ts` (mirrored to `supabase/functions/_shared/combat/creature-damage-modifiers.ts`):

```ts
export type CreatureDamageSource =
  | 'weapon'      // main/off-hand auto-attacks
  | 'ability'     // direct ability damage, volleys, finishers, burst
  | 'stance'      // automatic stance pulses (Orbs of Fire)
  | 'dot'         // Ignite / Poison / Bleed ticks
  | 'proc'        // item/ability procs that damage the creature
  | 'reflect'     // retaliation / reflected damage — never amplified
  | 'environment' // never amplified unless explicitly reclassified
  | 'self';       // creature self-damage — never amplified

const AMPLIFIABLE: ReadonlySet<CreatureDamageSource> =
  new Set(['weapon', 'ability', 'stance', 'dot', 'proc']);

export function applyCreatureDamageModifiers(input: {
  amount: number;
  source: CreatureDamageSource;
  /** Pre-computed, tick-frozen amp percent for this creature (see §5). */
  ampPct: number;
}): number;
```

Rules: returns `amount` unchanged for non-amplifiable sources or `ampPct <= 0`; otherwise `Math.max(1, Math.floor(amount * (1 + ampPct / 100)))` — one rounding, matching the project's existing floor-then-clamp-to-1 convention. The function never reads or writes DB state, never recalculates source damage, and cannot amplify twice because it is called exactly once per damage instance, immediately before `resolveDamage`.

`resolveEffectTicks` in `_shared/combat-resolver.ts` gains an optional `ampPctByCreature` argument so DoT ticks (live and `combat-catchup`) use the same stage; when omitted, behaviour is byte-identical to today.

## 3. Status schema extension

`applied_statuses` today: `classification` is `'dot'` for all three rows (bleed/poison/ignite), with role-based `magnitude`, `duration`, `stacks` and `tick_interval_ms`.

Extension (backward-safe, additive):

- Allow `classification = 'damage_amp'` alongside `'dot'`.
- Add nullable `modifier jsonb` — for `damage_amp` statuses: `{ "kind": "damage_taken_pct", "value": 10, "eligible_sources": ["weapon","ability","stance","dot","proc"] }`.
- Add a validation trigger: `dot` rows must have `magnitude` and no `modifier`; `damage_amp` rows must have `modifier` and no periodic damage. Bleed/Poison/Ignite rows are untouched, so their behaviour cannot drift into amplification.
- Seed the Chilled row: `key='chilled'`, `label='Chilled'`, `classification='damage_amp'`, `effect_type='chilled'`, `duration = { base_ms: 6000, role: null }`, `stacks = { max_stacks_calc: { base: 1, terms: [], unit: 'count' } }`, `tick_interval_ms = null`, `default_damage_type = 'frost'`.

**Authoritative unit:** whole percent integer (`10`) stored once in `applied_statuses.modifier.value`. Runtime derives `1 + value/100` locally; nothing stores `0.10` or `1.10`, and no per-ability copy of the value exists.

## 4. Lifecycle reuse

Chilled reuses `active_effects` exactly as DoTs do: same insert/refresh path, same node-scoped load at tick start, same `expires_at` expiry sweep, same upsert (`onConflict: source_id,target_id,effect_type`), same purge on creature death, same client payload in `active_effects` of the tick response. Differences: no `next_tick_at` progression (set beyond `expires_at` so `resolveEffectTicks` never ticks it) and `damage_per_tick = 0`. Refresh uses the shared `applyStackingEffect` primitive with `maxStacks: 1`, which already refreshes duration without resetting cadence.

No Chilled-only tracker is introduced.

## 5. Deterministic same-tick activation

Within one tick the current order is: pending abilities -> creature attacks/retaliation -> aura pulses -> auto-attacks -> stance pulses -> DoT ticks. A status applied by an ability would therefore reach later-processed members but not earlier ones — order-dependent.

Rule (recommended): **snapshot amplification at tick start.** Immediately after `active_effects` is loaded, build a frozen `ampPctByCreature` map from statuses already active at tick start; every damage instance in that tick reads only the frozen map. Consequences:

- Frost Bolt's own triggering hit does not benefit.
- No other party damage in the same tick benefits.
- From the next tick, all eligible party damage benefits identically, regardless of iteration order.

This matches the existing tick-time convention (`now`/`tickTime` are captured once per tick) and requires no change to the status lifecycle.

## 6. Ordering and rounding

Live ordering is preserved everywhere; the new stage is inserted only between the final per-source amount and `resolveDamage`:

```text
base calc -> attribute scaling -> class_scale -> crit -> hit-quality/glancing caps
  -> attacker buffs (Arcane Surge, stealth, disengage) -> bond multiplier
  -> [NEW] target incoming-damage modifiers (Chilled)
  -> resolveDamage() -> HP / ward result
```

No existing multiplier moves, so damage without Chilled stays numerically identical. Chilled rounds once (`floor`, min 1) at the new stage.

## 7. Multiple amplification modifiers

Distinct `damage_taken_pct` statuses **add** (10% + 15% = 25%), computed as a single sum then one rounding. Same-key statuses from different sources do not add — the strongest single instance of a given status key wins. Chilled itself does not stack.

## 8. Frost Bolt integration

Audited record: ability `3084fd4b-cb78-4833-bcbe-702c3b14d6ad`, `ability_key = frost_bolt`, base `spell_bolt` (mechanic `spell_attack`), `cp_cost = 12`, `amount_calc = 3 + 2.4x soft INT + level/3`, `class_scale = 1.0`, `damage_type = frost`, `applied_status = NULL`, assigned to `wizard`. CP cost and damage calc are unchanged by this work.

Integration: set `abilities.applied_status = 'chilled'` for Frost Bolt and allow the `spell_bolt` base to trigger a status on a successful hit. Application is composed in the existing successful-hit block in `combat-tick/index.ts` (~`:1690`), right beside the on-hit-effect roll, gated on `abilityHitLanded`. The typed on-hit **DoT** registry (`on-hit-effects.ts`) is not extended — Chilled arrives through the `applied_status` layer, which is where non-DoT statuses belong.

## 9. Admin interface

`AbilityConfigManager.tsx` currently reads `applied_statuses` read-only. Changes:

- New applied-status editor pane with conditional fields by classification: `dot` shows periodic damage / tick interval / damage type / stacks; `damage_amp` shows the damage-taken percent, eligible source categories, duration, stack and refresh behaviour. DoT magnitude, tick-damage and stack-noun inputs are hidden for `damage_amp`.
- Frost Bolt's configured-use view shows: Applied Status = Chilled, Applied on = Successful hit, Applied Status target = Enemy, an inherited read-only Chilled summary (+10% damage taken, 6s, no stacking, refresh), and a link to edit the reusable status. No per-ability copy of the 10%.

## 10. Player-facing presentation

Creature debuffs are currently surfaced as poison/ignite/bleed chips in `NodeView.tsx` plus structured log events (`*_applied`, `dot_tick`). Chilled adds structured events only (no emoji):

- apply: "The creature is Chilled and takes 10% increased damage."
- refresh: "Chilled has been refreshed."
- expiry: "Chilled fades."

Plus a neutral Chilled chip on the creature row reusing the existing debuff chip layout. No per-damage-instance log lines; damage text keeps showing the final resolved amount.

## 11. Migration and compatibility

Backward-safe migration: additive column + widened classification + validation trigger + one seed row + one `abilities.applied_status` update. Nothing is deleted; ability IDs, base relationships, class assignments and loadouts are untouched. Regenerate Supabase types, update both shared mirrors, and update ability seed/validation so the new classification passes the publish gate.

## 12. Files touched

- New: `src/shared/combat/creature-damage-modifiers.ts` + server mirror.
- `supabase/functions/combat-tick/index.ts` (frozen amp map, 10 call sites, Chilled application + events).
- `supabase/functions/_shared/combat-resolver.ts` (optional amp map for DoT ticks) and `supabase/functions/combat-catchup/index.ts` (pass-through).
- `src/shared/config/{compose-ability,effective-ability,mechanic-templates}.ts` + server mirrors (damage_amp status shape).
- `src/hooks/useAbilityRegistry.ts`, `supabase/functions/_shared/load-ability-calcs.ts` (load `modifier`).
- `src/components/admin/AbilityConfigManager.tsx` (+ status editor component).
- `src/features/world/components/NodeView.tsx`, `src/features/combat/utils/mapServerEffectsToBuffState.ts`, combat event presentation.
- One migration; `src/integrations/supabase/types.ts` regenerated.

## 13. Tests

Parity: existing damage without Chilled numerically identical; Ignite/Poison/Bleed behaviour unchanged; ward/HP clamping unchanged; assignments and loadouts intact.

Chilled: applied only on a successful hit; triggering hit not amplified; amp frozen at tick start so party iteration order is irrelevant; +10% applied to weapon, off-hand, direct ability, volley, finisher, burst, stance pulse, DoT ticks and eligible procs; excluded for `reflect`, `self` and `environment`; deals no periodic damage; does not alter tick rate; does not stack; reapply refreshes; expires after 6s; all party members benefit equally; single floor rounding; additive stacking rule across distinct amp statuses; admin shows mechanic-appropriate fields; events pass the no-emoji guard; no new raw HP write path (`writeCreatureState` remains sole writer).

## 14. Balance notes (not implemented here)

Frost Bolt gains party-wide value while keeping 12 CP and its current damage. If it proves too strong once Chilled lands, options are lowering Chilled to 8%, shortening it to 4s, or trimming Frost Bolt's `class_scale` — each a separate, separately approved change.

## 15. Assumptions needing approval

1. Frost Bolt's own hit does not benefit; Chilled starts amplifying from the next tick (frozen-snapshot rule).
2. Holy Shield retaliation is classified `reflect` and therefore never amplified.
3. Eligible source categories are stored on the status but treated as fixed for Chilled.
4. Distinct amplification statuses add; same-key instances take the strongest.
