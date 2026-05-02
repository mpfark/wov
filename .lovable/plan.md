# Combat System Cleanup — Authority, Consistency, Duplication (with Hardening Addon)

A pure structural refactor. **No balance, gameplay, or schema changes.** Existing tests must continue to pass.

---

## 1. Unify formula ownership

`_shared/combat-math.ts` is already a thin barrel re-export of `_shared/formulas/*.ts` (mirror of `src/shared/formulas/*`). The remaining legacy import lives in `combat-tick`.

**Actions**
- Rewrite the import block at the top of `supabase/functions/combat-tick/index.ts` to pull each symbol from its canonical module:
  - `formulas/stats.ts` → `getStatModifier`, `rollD20`, `rollDamage`
  - `formulas/combat.ts` → hit/crit/AC/anti-crit, weapon affinity, hit-quality, shield block, `ARCANE_SURGE_DAMAGE_MULT`, creature damage helpers, `getWeaponDie`
  - `formulas/classes.ts` → `CLASS_LEVEL_BONUSES`, `CLASS_LABELS`, `getClassCritRange`, `OFFHAND_*`, `SHIELD_*`, `isShield`, `isOffhandWeapon`
  - `formulas/resources.ts` → `getMaxHp/Cp/Mp`
  - `formulas/xp.ts` → `getXpForLevel`
- Sweep `_shared/reward-calculator.ts` for the stale `combat-math.ts` reference comment; rewrite to point at canonical modules.
- Convert `supabase/functions/_shared/combat-math.ts` into a `@deprecated` stub that just re-exports from `./formulas/index.ts` (plus the two compat shims). Future pass deletes it.
- Update `src/features/README.md` if it points at the legacy path.
- Client side already routes through `src/shared/formulas/*` via the local `combat-math.ts` barrel — leave untouched.

## 2. Centralize CP + stance helpers (client + server mirror)

**Current duplication**
- Client: `getAvailableCp` (`src/features/combat/utils/cp-display.ts`), `sumStanceReserved` (`src/features/combat/utils/stances.ts`).
- Server: inline `reservedTotal` loop in `combat-tick` (~lines 520-528, again ~1320-1325).

**Create canonical pure helpers**

`src/shared/cp/cp-math.ts` (and byte-mirror at `supabase/functions/_shared/cp/cp-math.ts`):

```ts
// INVARIANTS:
// - rawCp is always server-authoritative.
// - reservedCp comes from characters.reserved_buffs (server-owned).
// - queuedCp is client-only preview and must NEVER be persisted.
// - available CP must never be negative.

export interface ReservedBuffEntry {
  tier?: number;
  reserved?: number;
  activated_at?: number;
}
export type ReservedBuffsMap = Record<string, ReservedBuffEntry | undefined>;

/** Defensive sum: tolerates malformed/partial reserved_buffs maps. */
export function sumReservedCp(map: ReservedBuffsMap | null | undefined): number {
  if (!map) return 0;
  let total = 0;
  for (const entry of Object.values(map)) {
    total += Math.max(entry?.reserved ?? 0, 0);
  }
  return total;
}

/** Self-clamping: result is always >= 0. */
export function getAvailableCp(rawCp: number, reservedCp: number, queuedCp = 0): number {
  return Math.max((rawCp ?? 0) - (reservedCp ?? 0) - (queuedCp ?? 0), 0);
}
```

**Wire-up (no behavior change)**
- `src/features/combat/utils/cp-display.ts`: re-export `getAvailableCp` from `@/shared/cp/cp-math`. Keep the existing `getCpDisplay` UI helper here; have it call the canonical `getAvailableCp` internally.
- `src/features/combat/utils/stances.ts`: implement `sumStanceReserved` as `(map) => sumReservedCp(map)` re-export.
- `supabase/functions/combat-tick/index.ts`: import `{ sumReservedCp, getAvailableCp }` from `../_shared/cp/cp-math.ts` and replace both inline loops:

  ```ts
  // Compute reserved CP once per member per tick.
  const reservedTotal = sumReservedCp(member.c.reserved_buffs);
  if (getAvailableCp(mCp[member.id], reservedTotal) < cpCost) {
    events.push({ type: 'ability_fail', ... });
    continue;
  }
  ```

  If profiling shows repeated computation per member in the same tick, cache via `const reservedById: Record<string, number> = {}` (optional, not required).

**Tests** — `src/shared/cp/__tests__/cp-math.test.ts`:
- `sumReservedCp`: empty map, missing `reserved` field, negative `reserved` clamped to 0, multi-stance sum.
- `getAvailableCp`: simple subtract, clamps to 0 when reserved > raw, queued reduces further.
- Integration sanity:
  ```ts
  it("blocks ability when CP is reserved by stances", () => {
    const available = getAvailableCp(50, 40);
    expect(available).toBe(10);
    expect(available < 15).toBe(true);
  });
  ```

## 3. Remove legacy timed-stance branches in `useCombatActions`

The hook's stance toggle block already early-returns for stance ability types, so entries in `INSTANT_BUFF_TYPES` for stance-routed types are dead code.

**Actions**
- Remove `damage_buff`, `crit_buff`, `battle_cry`, `poison_buff`, `ignite_buff`, `absorb_buff` from `INSTANT_BUFF_TYPES` (verify each is in `STANCE_DEFS` before removing — leave non-stance buffs like `stealth_buff`, `regen_buff`, `evasion_buff`, `disengage_buff`, etc.).
- Add guard comment above the set:
  ```ts
  // IMPORTANT:
  // Stance-based abilities MUST NOT appear in this set.
  // They are handled exclusively via activate_stance/drop_stance.
  // Adding them here will reintroduce legacy timed-buff behavior.
  ```
- Grep `useBuffState`, `EventLogPanel` for any remaining timed-buff fallbacks for stance ability types and remove.

## 4. Validate server authority (`client_cp` and `reserved_buffs`)

**Current** at `combat-tick:384`:
```ts
const freshCp = (!party_id && m.id === character_id && typeof client_cp === 'number')
  ? Math.min(client_cp, dbCp)
  : dbCp;
```
Already clamps downward only. Just needs documentation.

**Actions**
- Top-of-file header in `combat-tick/index.ts`:
  ```ts
  // Combat is server-authoritative.
  // Client input (target ids, queued ability, client_cp) is advisory only and
  // re-validated here. Never trust client-provided CP/HP for writes.
  //
  // DO NOT mutate reserved_buffs inside combat-tick.
  // Stance state is owned exclusively by activate_stance / drop_stance RPCs.
  // combat-tick must treat reserved_buffs as read-only.
  ```
- Inline above `freshCp`:
  ```ts
  // SERVER AUTHORITY: client_cp is advisory only.
  // Math.min(client_cp, dbCp) guarantees the client can only *reduce* perceived
  // CP (UI sync for in-flight ability cost) and can never raise server CP.
  ```
- Audit `combat-tick` writes: confirm only the existing wipe-on-death `updates.reserved_buffs = {}` (line ~1322) ever writes to `reserved_buffs`. That write is intentional (clear stances on death) — annotate it as the sole exception:
  ```ts
  // EXCEPTION: clearing stances on death is the only write combat-tick performs
  // against reserved_buffs. All other paths must treat it as read-only.
  ```

## 5. Comment & assumption sweep

- "INT + WIS" CP pool wording → "WIS-only pool, INT-only regen" (sweep `combat-tick`, `GameManual`, READMEs).
- "class dice" autoattacks → weapon-die.
- "timed buff" / "5-min buff" wording near ignite/envenom/battle_cry → stance-reservation.
- Refresh deprecation banner inside the `_shared/combat-math.ts` stub.

## 6. Validation

- `bun vitest run` — formula-parity, cp-display, clampResources, new cp-math suites.
- `supabase--edge_function_logs combat-tick` after redeploy — confirm clean startup.
- No DB migrations.

---

## Files touched

**Edit**
- `supabase/functions/combat-tick/index.ts` — import paths, two reserved-CP call sites, top-of-file authority header, `client_cp` comment, exception annotation on death-wipe write.
- `supabase/functions/_shared/reward-calculator.ts` — drop stale combat-math comment.
- `supabase/functions/_shared/combat-math.ts` — convert to `@deprecated` re-export stub.
- `src/features/combat/hooks/useCombatActions.ts` — prune `INSTANT_BUFF_TYPES`, add guard comment.
- `src/features/combat/utils/cp-display.ts` — re-export `getAvailableCp`; route internal use through canonical helper.
- `src/features/combat/utils/stances.ts` — `sumStanceReserved` becomes alias of `sumReservedCp`; add stance authority comment.
- `src/features/README.md` — fix combat-math reference if stale.

**Create**
- `src/shared/cp/cp-math.ts` (canonical, with invariants header, self-clamping `getAvailableCp`, defensive `sumReservedCp`)
- `supabase/functions/_shared/cp/cp-math.ts` (byte-mirror)
- `src/shared/cp/__tests__/cp-math.test.ts` (defensive sums, clamping, stance-blocks-ability integration test)

**Delete**
- Nothing this pass. Stub stays one cycle.

## Out of scope
No balance, no new abilities, no UI redesign, no DB schema changes.
