

# Revised Plan: Shared Creature Debuffs + Party Opportunity Attack AC Fix

## Summary

Two refinements applied to the original plan per your feedback: (1) merged debuffs are additive display-only data, raw effects stay untouched; (2) party member AC uses the real `calculateAC` formula with actual DEX from the database.

---

## Change 1: Shared Creature Debuff Display (derived view only)

### `src/features/combat/utils/interpretCombatTickResult.ts`

Add a new field `creatureDebuffs` to `TickInterpretation` — a creature-centric aggregation of all active effects, keyed by creature ID. This is a **derived display view only**:

- `dotsByChar` remains unchanged (per-source grouping, backward compat)
- `activeEffectsSnapshot` remains unchanged (raw effect array)
- New `creatureDebuffs` field aggregates stacks/damage by `target_id` + `effect_type` across all sources

```typescript
// New field in TickInterpretation:
creatureDebuffs: Record<string, {
  poison?: { stacks: number; damage_per_tick: number };
  ignite?: { stacks: number; damage_per_tick: number };
  bleed?: { stacks: number; damage_per_tick: number };
  sunder?: { stacks: number };
}> | null;
```

Built by iterating `data.active_effects` and summing stacks per creature per effect type. No existing fields are modified or replaced.

### `src/pages/GamePage.tsx`

Update the active-dots sync handler to use `creatureDebuffs` (merged) for the UI buff state display, so all party members' debuffs show on creatures. The existing `dotsByChar` flow continues to work for any code that needs per-source data.

### `src/features/combat/hooks/useBuffState.ts`

Update `syncFromServerEffects` to accept the creature-centric merged data for display purposes. The function already maps server data to local stacks — it just needs to read from the merged view instead of filtering by character ID.

---

## Change 2: Real AC for Party Opportunity Attacks

### Problem

Line 102 in `resolveOpportunityAttacks` uses `const memberAC = 10`. The fleeing player's own AC is correctly computed as `calculateAC(class, effectiveDex) + equipmentBonuses.ac`. Party members should use the same formula.

### Investigation

`PartyMember.character` currently lacks `dex`. The `calculateAC(class, dex)` function needs class (already available) and dex. Equipment AC bonuses are not available without querying each member's inventory — impractical for a synchronous flee calculation.

### Solution

1. **`src/features/party/hooks/useParty.ts`** — Add `dex` to the character select query and the `PartyMember` interface:
   - Select: `character:characters(id, name, gender, race, class, level, hp, max_hp, current_node_id, dex)`
   - Interface: add `dex: number` to the character sub-type

2. **`src/features/world/hooks/useMovementActions.ts`** — Replace hardcoded `10` with:
   ```typescript
   const memberAC = calculateAC(member.character.class, member.character.dex);
   ```
   This gives the correct base AC for each member's class and DEX. It won't include gear AC bonuses (not available without inventory queries), but matches the core defensive formula used everywhere else. This is significantly more accurate than `10`.

---

## Files touched

| File | Change |
|------|--------|
| `src/features/combat/utils/interpretCombatTickResult.ts` | Add `creatureDebuffs` derived display field (additive, no replacement) |
| `src/pages/GamePage.tsx` | Use `creatureDebuffs` for UI debuff sync |
| `src/features/combat/hooks/useBuffState.ts` | Accept creature-centric merged data for display |
| `src/features/party/hooks/useParty.ts` | Add `dex` to PartyMember character select + interface |
| `src/features/world/hooks/useMovementActions.ts` | Use `calculateAC(class, dex)` for member opportunity attack AC |

