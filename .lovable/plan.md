## Goal

Make HP/CP/MP completely consistent across:
1. UI display (status bars, planner, character sheet)
2. Regen loop (client)
3. Combat tick (server edge function)
4. Level-up (client + server)
5. Stat allocation / respec
6. Login / refresh / world-entry (no magical gain or snap-back)

The numbers a player sees should be the numbers persisted, regardless of whether they re-log, swap gear, or get hit by a realtime echo.

---

## What I found in the audit

### Formula sources (3 places, mostly aligned but duplicated)

| Source | HP | CP | MP |
|---|---|---|---|
| `src/lib/game-data.ts` | `getMaxHp` | `getMaxCp` | `getMaxMp` |
| `src/features/combat/utils/combat-math.ts` | `getMaxHp` (duplicate) | — | — |
| `supabase/functions/combat-tick/index.ts` | `calcMaxHp` (re-import) | `calcMaxCp` | `calcMaxMp` |
| `sync_character_resources` SQL RPC | inline formula | inline formula | inline formula |

All four currently compute the same numbers, but the formula is written four times. Drift is just one edit away.

### "Effective" (gear-adjusted) caps

`getEffectiveMaxHp/Cp/Mp` in `game-data.ts` add equipment bonuses on top. These are used by:
- `StatusBarsStrip` (display)
- `useGameLoop` (regen cap)
- `useCombatActions` (heal cap)
- `StatPlannerDialog` (preview)

But the **persisted** `max_hp/max_cp/max_mp` columns store only the **base** (no gear). That mismatch is the root cause of every "snap back on login" symptom.

### Current state of fixes already in place

- `sync_character_resources` RPC writes gear-adjusted maxes to the DB (uses `app.trusted_rpc` to bypass the `restrict_party_leader_updates` lockdown).
- `GameRoute` calls it once on world entry.
- `useInventory.equipItem/unequipItem` call it after every gear change.
- `clampResourceUpdates` clamps regen writes to the supplied effective cap.
- `combat-tick` adds `+ eb.hp` on level-up.

### Remaining gaps / risks

1. **`useStatAllocation`** writes `max_hp/max_cp/max_mp` based on **base** stats only (no gear), then the DB trigger (`restrict_party_leader_updates`) silently reverts them because the call is not "trusted". Result: after spending a stat point, the persisted max may not include the bonus until the next sync, and the client's optimistic update temporarily shows a wrong number.
2. **Level-up in `useCombatActions` (client-side path)** at line ~126 also computes `newMaxHp = getMaxHp(...)` **without gear bonuses**. If this path is ever taken (looks like solo level-up before combat-tick takes over), it persists a base value and triggers a snap-back on next refresh until the next gear-change sync.
3. **Character creation** does not set `mp/max_mp` (DB defaults to 100/100), and does not call `sync_character_resources`. New character → first regen tick recomputes effective cap from gear → tries to write gear-boosted hp → trigger trims it. Brand-new characters may see one snap-back before the world-entry sync runs (the sync now exists, so this is mostly OK, but worth verifying).
4. **`updateCharacter` in `useCharacter`** clamps `hp/cp/mp` against `effectiveCaps` when supplied, but if any caller passes raw `max_hp` etc. in `updates`, those go to the DB directly. The trigger silently rewinds them unless `app.trusted_rpc` is set (which only happens inside RPCs). So any client-side write to `max_*` is discarded — confirming all `max_*` mutation must go through `sync_character_resources` or the combat-tick edge function.
5. **Duplicate `getMaxHp`** in `combat-math.ts` vs `game-data.ts` — risk of future drift.
6. **Stale memory** `mem://game/combat-system/resource-synchronization` still says "client-side effective caps are removed" — directly contradicts current architecture.

---

## Proposed work

### 1. Unify the formula into one place

- Delete the duplicate `getMaxHp` from `src/features/combat/utils/combat-math.ts`; re-export from `@/lib/game-data`.
- Document `getMaxHp / getMaxCp / getMaxMp` (base) and `getEffectiveMaxHp / getEffectiveMaxCp / getEffectiveMaxMp` (gear-adjusted) as the **only** sanctioned client-side formulas.
- Add a one-line JSDoc on each: "If you change this, also update `combat-tick/index.ts` and `sync_character_resources()` in SQL."

### 2. Make `sync_character_resources` the single source of truth for persisted maxes

Audit every place that writes `max_hp / max_cp / max_mp` directly and route them through a sync instead:

- **`useStatAllocation.allocateStatPoint` / `respec`**: stop writing `max_hp/max_cp/max_mp` (the trigger discards them anyway). After the stat write succeeds, call `sync_character_resources` and refetch. Keep the optimistic UI by computing the new effective max with gear bonuses for the local state only.
- **`useCombatActions` solo level-up branch (~line 126)**: include equipment bonuses in `newMaxHp` (mirror the combat-tick behavior), OR call `sync_character_resources` after the level-up commits.
- **`combat-tick` level-up**: already adds `+ eb.hp`. Also fold in `+ eb.con` for HP (already does), `+ eb.int/wis` for CP, `+ eb.dex` for MP — already correct. Verify and leave.

### 3. Lock down login/refresh behavior

- `GameRoute` already syncs once per character on entry — keep, but also call sync **after** `refetchCharacters` so the freshly-loaded row is the synced one (current order is sync → refetch, which is correct; verify no race).
- Consider syncing on `visibilitychange` (returning to tab) or after a long network gap to defend against drift in long-lived sessions. Optional.

### 4. Tests

Add unit tests for:
- `getEffectiveMaxHp/Cp/Mp` against fixtures (warrior L10 with +2 con +5 hp gear, etc.).
- `clampResourceUpdates` already covered.
- A new test asserting the formulas in `game-data.ts` match the formulas in `combat-tick/index.ts` (snapshot-style) so future drift fails CI.

Add a Deno test for `sync_character_resources` covering:
- Equipping +5 HP gear raises `max_hp` by 5 and clamps current `hp` to new max.
- Unequipping gear lowers `max_hp` and trims current `hp` if it exceeded the new cap.
- Broken (durability 0) gear is excluded.

### 5. Memory hygiene

- Update `mem://game/combat-system/resource-synchronization` to reflect today's reality: persisted `max_*` columns now include gear bonuses (kept in sync by `sync_character_resources` on world entry + every gear change), and the client uses these as the canonical caps.

---

## Files touched

- `src/lib/game-data.ts` — JSDoc + (optional) consolidate formula
- `src/features/combat/utils/combat-math.ts` — remove duplicate `getMaxHp`
- `src/features/character/hooks/useStatAllocation.ts` — stop writing `max_*`, call sync RPC instead
- `src/features/combat/hooks/useCombatActions.ts` — include gear in solo level-up max calc OR call sync
- `src/features/character/utils/clampResources.test.ts` — add cases (already has some)
- `src/lib/__tests__/effective-caps.test.ts` — new
- `supabase/functions/sync-character-resources-test/` (Deno) — new edge-function-style test, OR a simple psql-driven assertion in a migration smoke test
- `mem://game/combat-system/resource-synchronization` — rewrite

No new migrations needed (the SQL RPC + trigger are already correct).

---

## Out of scope

- Changing the actual HP/CP/MP formulas (this is purely a consistency / persistence fix).
- Touching combat damage math.
- Reworking the realtime-echo merge in `useCharacter` (already handles `max_*` via pendingWritesRef).
