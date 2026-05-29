# Combat Scaling Refactor — Effective Modifier Helpers (Soft Scaling Only)

## Philosophy

Effective combat modifiers use **soft scaling, not hard caps**. High stats always continue to provide value, but extreme stacking gives reduced marginal returns. There is no invisible wall — every additional point still moves the needle, just less than the previous one.

## Phase 1 — Shared helper layer (foundation, low risk)

### 1.1 New module `src/shared/formulas/effective.ts` (mirrored to `supabase/functions/_shared/formulas/effective.ts`)

Single public API with named profiles. Profiles keep ability authors declarative and let us re-tune one curve in one place without touching every call site.

```ts
export type EffectiveProfile =
  | 'damage'      // T0 direct hits, Eviscerate base, Holy Shield retaliation
  | 'burst'       // big-cooldown nukes: Grand Finale, Conflagrate base
  | 'dot'         // per-tick DoT magnitudes: Rend, Ignite burn, poison
  | 'utility'     // armor reduction, root strength, debuff magnitudes (Sunder)
  | 'stacking';   // per-stack riders (Eviscerate per-stack, Envenom per-stack)

export interface EffectiveCurve {
  softCap: number;       // mods at/below this are returned 1:1
  postCapRate: number;   // marginal value per point above softCap (0..1)
}

export function getEffectiveCombatMod(statMod: number, profile: EffectiveProfile): number;
```

Implementation (pure, deterministic, no clamp):

```ts
export function getEffectiveCombatMod(mod: number, profile: EffectiveProfile): number {
  if (mod <= 0) return mod;                          // negatives pass through
  const { softCap, postCapRate } = PROFILES[profile];
  if (mod <= softCap) return mod;                    // full value below soft cap
  return softCap + (mod - softCap) * postCapRate;    // soft scaling, no clamp
}
```

Starting profile table (tunable):

| Profile   | softCap | postCapRate |
|-----------|--------:|------------:|
| damage    | 20      | 0.45        |
| burst     | 18      | 0.40        |
| dot       | 20      | 0.50        |
| utility   | 12      | 0.30        |
| stacking  | 10      | 0.25        |

Design intent: direct damage keeps meaningful scaling; burst is controlled more strongly; DoTs still scale well but less explosively; utility effects like Sunder are controlled heavily; per-stack riders are controlled most aggressively.

Reference values (`damage` profile): `15 → 15`, `20 → 20`, `25 → 22.25`, `40 → 29`, `60 → 38`, `100 → 56`. Strictly monotonic, always less than raw above softCap, never clamped.

### 1.2 Tests `src/shared/formulas/__tests__/effective.test.ts`

For each profile, evaluate at `mod = 0, 5, 10, 15, 20, 25, 40, 60, 75, 100` and assert:

- Negative or zero mods pass through unchanged.
- At or below `softCap`, output equals raw mod.
- Above `softCap`, output is strictly increasing across the test grid.
- Above `softCap`, output is strictly less than the raw mod.
- The marginal step `f(n+1) - f(n)` above `softCap` equals `postCapRate` (reduced marginal gain).

No `value <= hardCap` assertions — there is no hard cap.

Add a parity case to `formula-parity.test.ts` (existing pattern) snapshotting one representative value per profile so accidental tuning drift fails CI.

### 1.3 Wiring (no behavioral change yet)

- Export from `src/shared/formulas/index.ts` and `supabase/functions/_shared/formulas/index.ts`.
- Re-exported automatically via the existing barrels (`combat-math.ts`).

Phase 1 ships alone with no ability behavior changes; rolling back means deleting one file.

## Phase 2 — Migrate dangerous formulas (one category per commit)

Recommendation: **migrate by category, not by class.** Each category shares a profile, so one tuning knob moves the whole batch in lockstep. Class-by-class would force us to retune `damage` 7 times.

Order (safest → most disruptive), each its own commit:

### 2.1 Utility debuffs
- **Sunder Armor** (warrior): `max(2, strMod)` → `Math.max(2, 2 + getEffectiveCombatMod(strMod, 'utility'))`

### 2.2 DoT magnitudes
- **Rend** per-tick: `strMod * 1.5 + ...` → uses `getEffectiveCombatMod(strMod, 'dot')`.
- **Ignite** per-stack burn: route the INT magnitude through `'dot'` before the existing per-stack math.
- **Envenom** per-tick damage (if linear today): same treatment.

### 2.3 T0 ability damage (all classes, one pass)
All `5 + 2 * primaryMod`-shaped formulas in `useCombatActions` and `combat-tick` →
`5 + 2 * getEffectiveCombatMod(primaryMod, 'damage')`. Bundled because the formulas are structurally identical across classes and must move together.

### 2.4 Stacking riders
- **Eviscerate** per-stack CHA bonus → `'stacking'` profile.

### 2.5 Burst finishers
- **Grand Finale** (bard, audit's worst offender):
  `chaMod*4 + level*1.5 + 1d(chaMod*2)` →
  let `eff = getEffectiveCombatMod(chaMod, 'burst')` then `eff*4 + level*1.5 + 1d(max(2, eff*2))`.
- **Conflagrate** base damage → same.
- **Holy Shield** retaliation kicker → route the CON magnitude through `'damage'`.

Per step: edit canonical file, mirror to the Deno copy (mirror rule), update the matching client preview in `useCombatActions.ts`, extend parity snapshots.

## Expected before/after with soft scaling

Grand Finale base coefficient `chaMod * 4`:

| CHA mod | Before | After (burst) |
|--------:|-------:|--------------:|
| 10      | 40     | 40            |
| 18      | 72     | 72            |
| 25      | 100    | 83.2          |
| 40      | 160    | 107.2         |
| 75      | 300    | 163.2         |
| 100     | 400    | 203.2         |

Still rewarding to invest in CHA past the soft cap — each additional point adds `0.40 * 4 = 1.6` flat damage on the base coefficient instead of the previous `4`. Stacking helps; runaway is gone.

T0 ability `5 + 2 * intMod` (damage profile):

| INT mod | Before | After |
|--------:|-------:|------:|
| 20      | 45     | 45    |
| 40      | 85     | 63    |
| 60      | 125    | 81    |
| 100     | 205    | 117   |

Sunder AC reduction (utility profile):

| STR mod | Before | After (`2 + eff`) |
|--------:|-------:|-------------------:|
| 6       | 6      | 8                  |
| 12      | 12     | 14                 |
| 25      | 25     | 17.9               |
| 60      | 60     | 28.4               |

Early/mid game preserved (mods ≤ softCap unchanged); extreme stacking tapers smoothly.

## Documentation

Module header for `effective.ts` opens with:

> Effective combat modifiers use **soft scaling**, not hard caps. High stats always continue to provide value, but each additional point past the profile's `softCap` is worth less than the previous one (`postCapRate`). This reduces runaway linear scaling while keeping gear and stat investment meaningful.

Avoid wording like "maximum effective stat", "hard cap", "clamped". Use "soft scaling", "post-cap rate", "reduced marginal gain".

## What is intentionally NOT in scope

- No raw attribute caps on `characters.<stat>`.
- No item generation, item budget, or CP cost changes.
- No creature scaling changes.
- No DEX/AC rebalance (separate task; defender-side).
- No changes to abilities whose magnitude already passes through `diminishingFloat` (Battle Cry, Cloak, Divine Challenge, Disengage, etc.).

## Risks & rollback

- **Client/server drift** — mitigated by the mirror rule and parity tests; every Phase 2 commit touches both sides.
- **Tuning surprises in playtest** — all profile numbers live in one table; one line re-tunes every caller of that profile.
- **Per-commit rollback** — each Phase 2 step is one category in one commit; revert returns those formulas to linear without touching the helper.
- **Phase 1 rollback** — delete `effective.ts` (no callers yet).

## Execution recommendation

Ship **Phase 1 only** in this task (helper + tests + barrel exports, zero behavior change). Phase 2 categories follow as separate tasks so the user can playtest between batches.
