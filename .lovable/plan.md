# CP Pool & Regeneration — Unified WIS/INT Model

Locked decisions (your "defaults"):
1. **Pool multiplier:** WIS only, `wisMod * 6` (small net nerf vs the current INT+WIS dual-stat pool — fixes the double-dip).
2. **In-combat CP regen:** stays at **0% (skipped)**, matching live behavior; Game Manual is corrected to say so.
3. **Drop the vestigial `cha` parameter** from `getMaxCp` / `getEffectiveMaxCp` and update all call sites in the same change.

---

## Part 1 — Audit Summary (current behavior)

**Max CP** is computed identically in three places:
- TS: `src/shared/formulas/resources.ts → getMaxCp(level, int, wis, _cha)`
  `30 + (level-1)*3 + (max(0,intMod) + max(0,wisMod)) * 3`
- Deno mirror: `supabase/functions/_shared/formulas/resources.ts` (byte-mirror).
- SQL: `public.sync_character_resources()` uses the exact same arithmetic.
- Plus three **inlined copies** of the formula in `supabase/functions/admin-users/index.ts` (level set / grant / sync paths).
- `restrict_party_leader_updates` trigger clamps `max_cp` to `[0, 5000]` and forbids non-trusted client writes.

**CP Regen** uses the shared `getStatRegen(stat) = 2 + floor(sqrt(max(0, stat-10)))`:
- Out of combat: client `useGameLoop.ts` regenerates every 4s with `getStatRegen(int + gear.int) + 0.5*foodRegen + getMilestoneCpRegen(level) + innFlat + inspireCp`, floor 1.
- **In combat: CP regen is completely skipped** by the client. `combat-tick`/`combat-catchup` do **no** CP regen either — they only write ability costs and clamp to `max_cp`.

**Class influence on CP today:** none in formulas. Class only affects starting INT/WIS via `CLASS_STATS` and the every-3-levels `CLASS_LEVEL_BONUSES`.

**Real mismatches found:**
| Topic | Code reality | Game Manual today |
|---|---|---|
| Pool stat | INT + WIS (joint) | "INT + WIS scaling" ✓ |
| Regen stat | INT only | "scales with INT" ✓ |
| In-combat CP regen | 0% (skipped) | "reduced to 10%" ✗ |
| `cha` arg on `getMaxCp` | accepted but ignored | n/a |
| `admin-users` edge fn | inlines pool formula 3× | n/a (drift risk) |

---

## Part 2 — Issues Worth Fixing

- **Double-dip on INT.** INT today drives both pool size and regen rate, while WIS only contributes to the pool. That makes balance levers tangled — raise INT regen and you also enlarge the pool.
- **Inlined SQL/JS pool formula** in `admin-users` will silently desync the next time the canonical formula moves.
- **Manual lies about combat CP regen** (says 10%; truth is 0%).
- `getStatRegen` is shared between HP (CON) and CP (INT). Splitting names lets future balance changes diverge safely without surprise.
- `cha` parameter is dead surface area on `getMaxCp` / `getEffectiveMaxCp`.

---

## Part 3 — Proposed Unified Model (locked)

### Pool — WIS only

```
getMaxCp(level, wis) =
  30 + (level - 1) * 3 + max(0, wisMod) * 6
```

- Class-agnostic.
- Hard cap stays at 5000 server-side.
- Examples (vs today, INT==WIS comparison so today's max is at its highest):

| Level | WIS | New max | Today (INT=WIS) |
|---|---|---|---|
| 1  | 10 | 30  | 30 |
| 10 | 14 | 39 + 12 = **51** | 27 + 12 = **69** |
| 20 | 16 | 57 + 18 = **75** | 57 + 18 = **87** |

Net: balanced casters lose ~15-20% pool. Pure-INT builds lose more pool but keep regen — pushes them to invest a little WIS for headroom. Pure-WIS builds gain pool but drip slowly.

### Regen — INT only (numerically identical)

```
getCpRegen(int) = 2 + floor(sqrt(max(0, int - 10)))   // same shape as today
```

- Renamed out of `getStatRegen` for HP-vs-CP independence going forward.
- Out-of-combat tick = 4s (unchanged). Floor of 1 CP/tick (unchanged).
- Additive layers preserved: gear `int_regen` if any, food (×0.5), inn (+10), Inspire flat, milestone (`getMilestoneCpRegen`).
- **In combat: 0%** (current skip preserved, manual updated).

---

## Part 4 — Migration

**Replaced / removed:**
- `(intMod + wisMod) * 3` → `wisMod * 6` everywhere (TS, Deno mirror, SQL `sync_character_resources`, three `admin-users` inlines).
- `cha` parameter dropped from `getMaxCp` / `getEffectiveMaxCp` and ~6 call sites.
- `getStatRegen(int)` for CP usage replaced by `getCpRegen(int)` (HP path keeps `getStatRegen(con)`).

**Preserved:** CLASS_STATS, CLASS_LEVEL_BONUSES, milestone CP regen, all buffs (Inspire/food/inn), ability costs.

**Backfill:** the same migration that updates `sync_character_resources()` runs a one-shot `PERFORM sync_character_resources(id) FROM characters` (with the trusted-rpc bypass) so every existing character row settles to the new pool and `cp` re-clamps. No XP/level/stat changes.

**Manual:** rewrite the §"Max CP by Level" table and pool-formula prose; replace the in-combat "10%" line with "0% (regen pauses while in combat)"; tables otherwise unchanged.

---

## Part 5 — Implementation Plan (files only, no edits yet)

**Canonical formula (source of truth):**
- `src/shared/formulas/resources.ts` — change `getMaxCp` signature/body, drop `cha` from `getEffectiveMaxCp`, add `getCpRegen` export.
- `supabase/functions/_shared/formulas/resources.ts` — byte-mirror.

**SQL mirror + backfill (one new migration):**
- Replace `public.sync_character_resources()` body with the new `30 + (level-1)*3 + wisMod*6` line.
- Trailing `DO $$ ... PERFORM sync_character_resources(id) ... $$` to backfill all rows.

**De-duplication:**
- `supabase/functions/admin-users/index.ts` — collapse the three inline pool computations into a single helper imported from `_shared/formulas/resources.ts` (or call the SQL `sync_character_resources` after the level/grant write).

**Compile-only consumer updates (drop `cha` arg, switch CP regen helper):**
- `src/features/combat/hooks/useGameLoop.ts` (CP regen branch + `getEffectiveMaxCp` call sites).
- `src/features/character/components/CharacterPanel.tsx`
- `src/features/character/components/StatPlannerDialog.tsx`
- `src/features/character/components/RenownTrainerPanel.tsx`
- `src/components/admin/users/AdminCharacterSheet.tsx` (`getStatRegen(int)` → `getCpRegen(int)`)
- `src/pages/CharacterCreation.tsx`
- `src/components/admin/GameManual.tsx` — copy + tables + combat-rule line.

**Tests to update:**
- `src/lib/__tests__/effective-caps.test.ts` — new expected values.
- `src/shared/formulas/__tests__/formula-parity.test.ts` — new expected values + parity guard still passes.

**Client/server parity guarantee:** all TS call sites import from `@/shared/formulas/resources` (or its barrels), Deno paths import from `_shared/formulas/resources.ts`, SQL is the third copy and is touched in the same migration. Backfill ensures existing rows match on day 1.

**Memory updates after implementation:**
- Update `mem://game/combat-system/resource-synchronization` to reflect WIS-pool / INT-regen split and "0% in combat" rule.
- Update `mem://tech/formula-ownership` if the `getCpRegen` split warrants a note.

---

Approve this plan and I'll switch to default mode and implement in the order: (1) canonical TS + Deno mirror, (2) SQL migration with backfill, (3) admin-users de-dupe, (4) consumer compile fixes, (5) tests, (6) Game Manual copy, (7) memory refresh.
