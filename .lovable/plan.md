

# Combined Regen & Shield Overhaul

All the pending changes from our conversation, consolidated into one implementation.

---

## 1. Shield Block Chance — Increase & Uncap
**Current**: `0.05 + √mod × 0.04` → DEX mod 28 = ~17%
**New**: `0.05 + √mod × 0.05` → DEX mod 28 = ~31% (a bit high), or `0.05 + √mod × 0.045` → DEX mod 28 = ~24%

Using `0.045` gives: mod 0 → 5%, mod 4 → 14%, mod 10 → 19%, mod 28 → 24%, mod 50 → 37%

**Files**: `src/features/combat/utils/combat-math.ts`, `supabase/functions/_shared/combat-math.ts`, `src/lib/game-data.ts` (all three mirrors)

---

## 2. Potions — Instant HP Only, No Regen Buff
Remove the regen buff grant when using potions. Potions keep instant HP restore only.

**File**: `src/features/inventory/hooks/useConsumableActions.ts`
- Remove `setRegenBuff()` call and "regen boosted" log on line 41-42

---

## 3. Remove Regen Multipliers (Potion + Inn)
Remove `potionBonus`, `innBonus`, and `totalMult` from HP and CP regen. Also remove `inspireBonus` from CP regen.

**File**: `src/features/combat/hooks/useGameLoop.ts`

---

## 4. Inn → Flat +10 Regen to HP, CP, MP
Replace the removed inn multiplier with a flat `+10` added to the base regen sum for all three resources.

**File**: `src/features/combat/hooks/useGameLoop.ts`

---

## 5. Unify All Regen to Single 4s Tick
Merge the HP+CP (6s) and MP (2s) intervals into one 4s tick. Adjust the HP scaling factor from `0.4` to `0.27` (4/15) and MP regen by `×2` to preserve per-minute rates.

**File**: `src/features/combat/hooks/useGameLoop.ts`
- Delete separate MP `useEffect`/`setInterval` block
- Move MP regen into the unified interval
- Remove `mpCharRef` (add mp/dex fields to `regenCharRef`)

---

## 6. Cleanup regenBuff State
Since nothing sets `regenBuff` anymore, remove it from:
- `src/features/combat/hooks/useBuffState.ts` — remove state + setter
- `src/features/combat/hooks/useGameLoop.ts` — remove `regenBuffRef`
- `src/features/character/components/CharacterPanel.tsx` — remove from active buffs display
- `src/features/character/components/StatusBarsStrip.tsx` — remove from active buffs display
- `src/features/inventory/hooks/useConsumableActions.ts` — remove `setRegenBuff` from Pick type

---

## 7. Update Game Manual
- Shield block chance: new formula
- Regen: document unified 4s tick, additive-only system, inn +10 flat, no potion regen buff
- Block amount formula (already in plan)

**File**: `src/components/admin/GameManual.tsx`

---

## 8. Redeploy Edge Function
Redeploy `combat-tick` to pick up shield block chance changes.

---

## Summary of files touched

| File | Changes |
|------|---------|
| `src/features/combat/utils/combat-math.ts` | Block chance formula |
| `supabase/functions/_shared/combat-math.ts` | Block chance formula |
| `src/lib/game-data.ts` | Block chance formula |
| `src/features/combat/hooks/useGameLoop.ts` | Unify 4s tick, remove multipliers, add inn +10 flat, merge MP |
| `src/features/inventory/hooks/useConsumableActions.ts` | Remove potion regen buff |
| `src/features/combat/hooks/useBuffState.ts` | Remove regenBuff state |
| `src/features/character/components/CharacterPanel.tsx` | Remove regen buff display |
| `src/features/character/components/StatusBarsStrip.tsx` | Remove regen buff display |
| `src/components/admin/GameManual.tsx` | Update all regen + block docs |

