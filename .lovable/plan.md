# Chilled — reusable damage-amplification status

Add **Chilled** as a reusable applied status that increases eligible incoming damage on a creature by 10% for the **next three combat ticks after application** (see §3a for the exact timing rule), no stacking, refresh on reapply, no periodic damage. Frost Bolt becomes the first source. No balance changes to Frost Bolt.

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

Every path already converges on `resolveDamage` immediately before the in-memory HP mutation. That convergence point is where the new modifier stage goes — one insertion per site, no new write path, `writeCreatureState` untouched.

**Source classification today:** only aggregate (`WriteCreatureStateOpts.sourceKind: 'autoattack' | 'ability' | 'dot' | 'proc'`) on the combined write — there is no per-hit classifier. Smallest safe extension: a per-hit `CreatureDamageSource` union passed explicitly at each call site (no inference from log text or ability names).

**Reflected damage:** the runtime has no true damage-reflection mechanic. The closest is Holy Shield retaliation (`:1909`), a reactive strike. It will be classified `'reflect'` and hard-excluded, giving the exclusion a real home now and a safe default for any future reflect path.

## 2. Shared modifier stage (revised — single owner of eligibility)

New pure module `src/shared/combat/creature-damage-modifiers.ts` (mirrored to `supabase/functions/_shared/combat/creature-damage-modifiers.ts`):

```ts
export type CreatureDamageSource =
  | 'weapon' | 'ability' | 'stance' | 'dot' | 'proc'   // amplifiable-capable
  | 'reflect' | 'self' | 'environment';                // hard-excluded

/** Hard runtime safety rule, NOT a definition of eligibility. */
const NEVER_AMPLIFIED: ReadonlySet<CreatureDamageSource> =
  new Set(['reflect', 'self', 'environment']);

/** One active amplification instance, already resolved from a status row. */
export interface DamageAmpInstance {
  statusKey: string;                        // e.g. 'chilled'
  pct: number;                              // whole percent, from the status def
  eligibleSources: CreatureDamageSource[];  // from the status def — the only owner
}

export function resolveAmpPct(
  instances: DamageAmpInstance[],
  source: CreatureDamageSource,
): number;

export function applyCreatureDamageModifiers(input: {
  amount: number;
  source: CreatureDamageSource;
  ampPct: number;
}): number;
```

Eligibility ownership: the **reusable status definition** (`applied_statuses.modifier.eligible_sources`) is the single authoritative source of which categories a given amplification status affects. There is no hardcoded `AMPLIFIABLE` allowlist. `NEVER_AMPLIFIED` is a separate hard safety rule: `reflect`, `self` and `environment` are dropped even if a status definition lists them, and a config that lists them fails admin validation. A future mechanic that deliberately amplifies one of those categories requires an explicit, approved change to this rule.

Zero/non-positive preservation: `applyCreatureDamageModifiers` returns `amount` **unchanged** when `amount <= 0`, when `ampPct <= 0`, or when the source is not eligible. Chilled can never turn 0 damage into 1. Otherwise `Math.max(1, Math.floor(amount * (1 + ampPct / 100)))` — one rounding, matching the project's floor-then-clamp-to-1 convention.

## 3. Status schema extension (revised)

`applied_statuses` today: `classification = 'dot'` for bleed/poison/ignite, with role-based `magnitude`, `duration`, `stacks`, plus `tick_interval_ms` and `default_damage_type`.

Additive, backward-safe changes:

- Allow `classification = 'damage_amp'` alongside `'dot'`.
- Add nullable `modifier jsonb`; for Chilled:
  `{ "kind": "damage_taken_pct", "value": 10, "eligible_sources": ["weapon","ability","stance","dot","proc"] }`
- Periodicity has **one** authority: `classification`. `is_periodic` is either not stored at all (derived in the runtime from the typed classification) or, if stored for query efficiency, added as a **generated column** — `GENERATED ALWAYS AS (classification = 'dot') STORED` — so it can never diverge and cannot be written by admin or code.
- Validation trigger: `dot` rows require `magnitude`, forbid `modifier`; `damage_amp` rows require `modifier` with `kind`, integer `value > 0` and a non-empty `eligible_sources` containing none of `reflect`/`self`/`environment`, and must have `tick_interval_ms IS NULL` and no periodic magnitude. Bleed/Poison/Ignite rows are untouched and cannot drift into amplification.
- `ALTER TABLE public.active_effects ALTER COLUMN next_tick_at DROP NOT NULL` (audited: currently `NOT NULL`) and add nullable `started_at bigint`. Non-periodic effects store `next_tick_at = NULL`; no artificial timestamps.
- Seed Chilled: `key='chilled'`, `label='Chilled'`, `classification='damage_amp'`, `effect_type='chilled'`, `duration = { base_ms: 7000, role: null }` (see §3a), `stacks = { max_stacks_calc: { base: 1, terms: [], unit: 'count' } }`, `tick_interval_ms = NULL`.

**Authoritative unit:** whole percent integer (`10`), stored once in `applied_statuses.modifier.value`. Runtime derives `1 + value/100` locally; no `0.10`/`1.10` field anywhere and no per-ability copy.

**`default_damage_type`:** omitted (left `NULL`) for Chilled. It exists to type periodic tick damage; Chilled deals none, so setting `frost` there would imply damage that never happens. Thematic school is already carried by Frost Bolt's own `damage_type = frost` and by the status label — no new field is introduced for flavour.

## 3a. Timing rule (corrected)

The previous "6s / 3 ticks" wording was inconsistent. With `TICK_RATE = 2000` and the existing active-window test `started_at <= tickTime < expires_at` (identical to the DoT expiry test `expires_at <= tickTime` -> expired), an effect applied at t=0 with a 6000 ms duration is active at 2000 and 4000 but expired at 6000 — two amplified ticks, not three.

Intended result, stated explicitly: **Chilled amplifies the next three combat ticks after application.** Implementation: store the duration as `intended_ticks * TICK_RATE + TICK_RATE / 2` = `3 * 2000 + 1000` = **7000 ms**. Applied at t=0 -> active at 2000, 4000, 6000; expired at 7000+. The half-tick margin absorbs heartbeat jitter without ever granting a fourth tick, because the fourth tick lands at 8000 > 7000.

Existing DoT expiry semantics are unchanged: no comparison operator, no `expires_at` handling and no cadence rule is modified for Ignite, Poison or Bleed. Only Chilled's stored duration value encodes the tick intent.

Player-facing text stays "the next three combat ticks"; the admin editor shows the duration in both ms and resulting amplified ticks so the relationship is visible rather than implied.

## 4. Lifecycle reuse (revised — periodic vs non-periodic)

Chilled reuses the existing `active_effects` lifecycle: same application/refresh code path (`applyStackingEffect` with `maxStacks: 1`, which refreshes duration without resetting cadence), same node-scoped load at tick start, same `expires_at` expiry sweep and `cleanupEffects` delete, same purge on creature death, same `active_effects` payload in the tick response. Non-periodic rows carry `damage_per_tick = 0` and `next_tick_at = NULL`.

**`started_at` semantics:** `started_at` marks the beginning of the current **uninterrupted** instance. First application sets it. A refresh of an already-active row extends `expires_at` only and **preserves the existing `started_at`**. A new `started_at` is assigned only when the previous instance has expired or been removed (row deleted, or `expires_at <= now` at apply time). This keeps catch-up windows historically accurate across refreshes.

`resolveEffectTicks` is split explicitly by classification (derived from the typed status classification — see §3) rather than by field values:

- **Periodic branch** (unchanged behaviour): only effects whose status classification is periodic are considered for damage ticks. Ignite/Poison/Bleed math, messages and cadence are byte-identical.
- **Non-periodic branch** (new): iterates non-periodic effects and performs expiry only — marks `_expired`, pushes the expiry id, pushes a `clearedDots`-equivalent entry and an expiry event. No damage, no `next_tick_at` arithmetic.

No Chilled-only tracker is introduced.

## 5. Deterministic same-tick activation (live ticks)

Within one live tick the order is: pending abilities -> creature attacks/retaliation -> aura pulses -> auto-attacks -> stance pulses -> DoT ticks. A status applied mid-tick would otherwise reach later-processed members only.

Rule: **snapshot amplification at tick start.** Right after `active_effects` is loaded, build a frozen `ampByCreature: Record<creatureId, DamageAmpInstance[]>` from instances active at `tickTime`; every damage instance in that tick reads only the frozen map. Therefore:

- Frost Bolt's triggering hit does not benefit.
- No other party damage in the same tick benefits.
- From the next tick, all eligible party damage benefits identically, regardless of iteration order.

This matches the existing per-tick `now`/`tickTime` capture convention.

## 6. Ordering and rounding

Live ordering is preserved; the new stage is inserted only between the final per-source amount and `resolveDamage`:

```text
base calc -> attribute scaling -> class_scale -> crit -> hit-quality/glancing caps
  -> attacker buffs (Arcane Surge, stealth, disengage) -> bond multiplier
  -> [NEW] target incoming-damage modifiers (Chilled)
  -> resolveDamage() -> HP / ward result
```

No existing multiplier moves, so damage without Chilled stays numerically identical. Chilled rounds once (`floor`, min 1) at the new stage, and never modifies a non-positive amount.

## 7. Multiple instances and multiple statuses (revised)

The `active_effects` uniqueness key is `(source_id, target_id, effect_type)`, so **two party members can each hold their own Chilled row on the same creature**. Aggregation rule:

1. Load all non-expired amplification rows for the creature at snapshot time.
2. **Group by reusable status key** (`effect_type` -> status definition key). Within a key, select the **single strongest active instance** (highest `pct`; tie broken by latest `expires_at`) — same-key instances never add, so N wizards applying Chilled still yield +10%.
3. Across **distinct** status keys, the selected instances **add** their percentages (10% + 15% = 25%), filtered per damage source by each status's own `eligible_sources`, then one rounding.

Each source's row refreshes independently; refreshing one does not extend another's duration.

## 8. Frost Bolt integration

Audited record: ability `3084fd4b-cb78-4833-bcbe-702c3b14d6ad`, `ability_key = frost_bolt`, base `spell_bolt` (mechanic `spell_attack`), `cp_cost = 12`, `amount_calc = 3 + 2.4x soft INT + level/3`, `class_scale = 1.0`, `damage_type = frost`, `applied_status = NULL`, assigned to `wizard`. CP cost and damage calc unchanged by this work.

Integration: set `abilities.applied_status = 'chilled'` and allow the `spell_bolt` base to trigger a status on a successful hit. Application is composed in the existing successful-hit block in `combat-tick/index.ts` (~`:1690`), beside the on-hit-effect roll, gated on `abilityHitLanded`. The typed on-hit **DoT** registry (`on-hit-effects.ts`) is not extended — Chilled arrives via the `applied_status` layer, where non-DoT statuses belong.

## 9. Admin interface

`AbilityConfigManager.tsx` currently reads `applied_statuses` read-only. Changes:

- New applied-status editor pane with fields conditional on classification: `dot` shows periodic damage, tick interval, damage type, stacks; `damage_amp` shows damage-taken percent, eligible source categories (multi-select, excluding the never-amplified set), duration, stack and refresh behaviour. DoT magnitude/tick-damage/stack-noun inputs are hidden for `damage_amp`.
- Frost Bolt's configured-use view shows: Applied Status = Chilled, Applied on = Successful hit, Applied Status target = Enemy, a read-only inherited Chilled summary (+10% damage taken, 6s, no stacking, refresh, no periodic damage), and a link to edit the reusable status. No per-ability copy of the 10%.

## 10. Player-facing presentation (revised — concrete emit sites)

- **Apply / refresh:** emitted in the successful-hit status-application block in `combat-tick/index.ts` (~`:1690`), the same place DoT `*_applied` events are pushed. Whether the row already existed decides apply vs refresh text.
- **Expiry:** emitted by the new non-periodic branch of `resolveEffectTicks` in `_shared/combat-resolver.ts`, which is the code that already detects `expires_at <= tickTime` and returns events consumed by `combat-tick` (`:2496-2515`). This makes "Chilled fades" genuinely emittable — it is not promised anywhere else. `combat-catchup` also consumes resolver events, so offscreen expiry is covered.

Text (no emoji): "The creature is Chilled and takes 10% increased damage." / "Chilled has been refreshed." / "Chilled fades."

Plus a neutral Chilled chip on the creature row reusing the existing debuff chip layout (`NodeView.tsx`). No per-damage-instance log lines; damage text keeps showing the final resolved amount.

## 11. combat-catchup behaviour (new section)

`combat-catchup` runs `resolveEffectTicks` in **bulk mode** (`TICK_CAP = 1000`), replaying each periodic effect's missed ticks at synthetic timestamps `tt = next_tick_at + t * tick_rate_ms`. Chilled must therefore be evaluated **per simulated tick**, not once from present time:

- For each simulated `tt`, amplification uses only instances whose active window contains `tt`, i.e. `started_at <= tt < expires_at` (this is why `started_at` is added in §3 — `expires_at` alone cannot reconstruct the activation edge).
- Ticks before a Chilled instance's `started_at` and at/after its `expires_at` receive no amplification.
- Same-key/multi-key aggregation follows §7, recomputed per `tt`.
- Chilled itself is never ticked in bulk mode (non-periodic branch: expiry only).

Given Chilled's ~7s life, this typically amplifies only the first few replayed ticks — correctness, not throughput, is the point. Because refreshes preserve `started_at` and only push `expires_at` out, a replayed window that spans a refresh is amplified continuously across it with no gap and no double counting.

## 12. Files touched

- New: `src/shared/combat/creature-damage-modifiers.ts` + server mirror.
- `supabase/functions/combat-tick/index.ts` (frozen amp snapshot, 10 call sites, Chilled apply/refresh events).
- `supabase/functions/_shared/combat-resolver.ts` (periodic/non-periodic split, per-tick amp map, expiry events) and `supabase/functions/combat-catchup/index.ts` (pass amp instances).
- `src/shared/config/{compose-ability,effective-ability,mechanic-templates}.ts` + server mirrors (damage_amp status shape).
- `src/hooks/useAbilityRegistry.ts`, `supabase/functions/_shared/load-ability-calcs.ts` (load `modifier`, `is_periodic`).
- `src/components/admin/AbilityConfigManager.tsx` (+ applied-status editor component).
- `src/features/world/components/NodeView.tsx`, `src/features/combat/utils/mapServerEffectsToBuffState.ts`, combat event presentation.
- One migration; `src/integrations/supabase/types.ts` regenerated.

## 13. Tests (revised)

Parity: damage without Chilled numerically identical; Ignite/Poison/Bleed behaviour, cadence and messages unchanged; ward/HP clamping unchanged; assignments and loadouts intact.

Chilled correctness:
- applied only on a successful hit; triggering hit not amplified.
- amp frozen at tick start -> party iteration order irrelevant.
- +10% applied to weapon, off-hand, direct ability, volley, finisher, burst, stance pulse, DoT ticks, eligible procs.
- excluded for `reflect`, `self`, `environment` even if a status config lists them (validation rejects, runtime drops).
- eligibility read from the status definition: narrowing `eligible_sources` to `['weapon']` amplifies only weapon damage, with no code change.
- **zero/non-positive damage stays zero** (0 -> 0, negative -> unchanged).
- no periodic damage of its own; no change to tick rate or attack cadence.
- does not stack; reapply refreshes duration; expires after 6s.
- **exact tick count, single application**: one Chilled application amplifies exactly **three** subsequent ticks (t+2000, t+4000, t+6000) and not the fourth (t+8000).
- **exact tick count, refreshed application**: a refresh at t+4000 preserves `started_at`, moves `expires_at` to t+11000, and yields amplified ticks at 2000, 4000, 6000, 8000, 10000 — five in total, no gap, no fourth-tick-after-refresh overshoot.
- does not stack; reapply refreshes duration; expires after the configured window.
- **two party members apply Chilled**: two rows coexist under the uniqueness key, aggregate to +10% (not +20%), each refreshes independently.
- distinct amp keys add after per-key strongest selection.
- **catch-up boundaries**: replayed ticks before `started_at` are unamplified, ticks inside the window are amplified, ticks at/after `expires_at` are unamplified — asserted on a multi-tick bulk replay.
- **catch-up across a refresh**: a bulk replay spanning an application, a mid-window refresh and the final expiry amplifies the correct ticks both before and after the refresh, with `started_at` unchanged throughout.
- **expiry event emission**: the non-periodic resolver branch emits the expiry event and expired id in both live and bulk mode.
- `next_tick_at` stays `NULL` for Chilled rows and no code path performs cadence arithmetic on them.
- periodicity cannot diverge: `is_periodic` (if stored) is generated from `classification` and rejects direct writes.
- admin shows mechanic-appropriate fields only; events pass the no-emoji guard; `writeCreatureState` remains the sole HP writer.

## 14. Balance notes (not implemented here)

Frost Bolt gains party-wide value while keeping 12 CP and its current damage. If it proves too strong, options are lowering Chilled to 8%, shortening it to two amplified ticks, or trimming Frost Bolt's `class_scale` — each a separate, separately approved change.

## 15. Assumptions needing approval

1. Frost Bolt's own hit does not benefit; Chilled amplifies from the next tick (frozen-snapshot rule).
2. Holy Shield retaliation is classified `reflect` and never amplified.
3. `active_effects.next_tick_at` becomes nullable and `started_at` is added, for correct non-periodic representation and catch-up windows.
4. Same status key: strongest active instance wins; distinct keys add.
5. Chilled stores no `default_damage_type`.
6. Chilled's duration is stored as 7000 ms so it amplifies exactly the next three combat ticks, with existing DoT expiry semantics untouched.
7. `started_at` marks the current uninterrupted instance and is preserved across refreshes.
8. Periodicity is owned solely by `classification`; `is_periodic`, if stored, is a generated column.
