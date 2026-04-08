

# Defense System Refactor: Clear Roles for Each Layer

## Summary

Simplify the defense pipeline so each mechanic has exactly one job:
- **AC** = hit quality only (remove AC overflow damage reduction)
- **Battle Cry** = reliable % damage reduction (keep as-is)
- **Shield** = new chance-based flat block (DEX → chance, STR → amount)
- **Awareness** = anti-crit (WIS reduces incoming crit chance, no longer 25% damage reduction)

## Canonical Damage Pipeline

This exact order must be used in all combat paths (server combat-tick, client mirrors) and documented in comments:

```text
base damage
→ hit quality multiplier
→ crit multiplier
→ level gap adjustments
→ shield block (flat reduction, if triggered)
→ absorb effects (if any)
→ Battle Cry damage reduction
→ caps / clamps
→ finalAppliedDamage
```

- Same order in every file — no variations
- Pipeline comment block placed near each implementation
- All events, logs, and HP subtraction use the single `finalAppliedDamage` value

## Changes by File

### 1. `combat-math.ts` (both `src/features/combat/utils/` and `supabase/functions/_shared/`)

**Remove:**
- `getAcOverflowMultiplier()` function
- `SHIELD_AWARENESS_BONUS` constant

**Rename/Redefine:**
- `getWisDodgeChance()` → `getWisAntiCrit()` — same sqrt scaling, same 15% cap, but reduces incoming crit chance instead of being a damage reduction roll

**Add:**
- `getShieldBlockChance(dex)` — base 5% + sqrt(DEX mod) × 2%, capped ~20%
- `getShieldBlockAmount(str)` — flat 2 + sqrt(STR mod) × 1.5, capped ~8
- `rollBlock(dex, str)` — convenience wrapper

**Update `applyDefensiveBuffs()`:**
- Remove `wisAwarenessChance` / `wisReduced`
- Add `blockAmount` parameter (flat subtraction)
- Reorder internals to match canonical pipeline
- Add pipeline comment block

### 2. `supabase/functions/combat-tick/index.ts` — `applyCreatureHit()`

**Remove:**
- AC overflow damage reduction block
- Awareness 25% damage reduction block

**Add:**
- Anti-crit check before crit resolution: `if (isCrit && Math.random() < getWisAntiCrit(wis)) { isCrit = false }` with `awareness_resist` event
- Shield block roll after level gap, before absorb/Battle Cry: subtract flat block amount, emit `shield_block` event
- Pipeline comment block documenting the exact order

### 3. `src/features/character/components/CharacterPanel.tsx`

- WIS display: "X% Awareness" → "X% Crit Resistance"
- Add shield block stats when shield equipped: "X% Block Chance, X Block Amount"
- Remove `SHIELD_AWARENESS_BONUS` references

### 4. `src/features/character/components/StatPlannerDialog.tsx`

- Update WIS display to show anti-crit %

### 5. `src/components/admin/GameManual.tsx`

- Update defense mechanics docs: AC, Block, Battle Cry, Awareness sections
- Document the canonical damage pipeline

### 6. `src/lib/game-data.ts`

- Mirror all combat-math changes

## Block Formulas

```typescript
// Block chance: base 5% + sqrt(DEX mod) × 2%, capped at 20%
function getShieldBlockChance(dex: number): number {
  const mod = Math.max(getStatModifier(dex), 0);
  return Math.min(0.05 + Math.sqrt(mod) * 0.02, 0.20);
}

// Block amount: flat 2 + sqrt(STR mod) × 1.5, capped at 8
function getShieldBlockAmount(str: number): number {
  const mod = Math.max(getStatModifier(str), 0);
  return Math.min(2 + Math.floor(Math.sqrt(mod) * 1.5), 8);
}
```

## Post-Implementation Validation

After implementing, verify shield block in gameplay:
- Triggers occasionally — not too rare, not too frequent
- Visibly reduces damage in combat logs
- Noticeable in boss fights but not dominant
- If block feels too weak or invisible: adjust values slightly in a follow-up pass — do NOT introduce new mechanics or redesign formulas

## Files Modified

| File | Change |
|------|--------|
| `src/features/combat/utils/combat-math.ts` | Remove AC overflow, rename awareness → anti-crit, add block, reorder pipeline |
| `supabase/functions/_shared/combat-math.ts` | Same (mirror) |
| `src/lib/game-data.ts` | Same (mirror) |
| `supabase/functions/combat-tick/index.ts` | Rewrite creature-hit pipeline with canonical order, add anti-crit + block |
| `src/features/character/components/CharacterPanel.tsx` | Update stat displays |
| `src/features/character/components/StatPlannerDialog.tsx` | Update WIS display |
| `src/components/admin/GameManual.tsx` | Update docs with new defense system + pipeline |

