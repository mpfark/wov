

# State Ownership Refactor — Refined Plan

## Build Errors

The three reported errors are **stale** — the current source files already have correct imports:
- `usePartyCombat.ts:193` imports from `@/features/character` (correct)
- `combat/index.ts:19` exports `EffectTickResult`, not `ActiveEffect` (correct, `ActiveEffect` isn't referenced anywhere)
- `TeleportDialog.tsx:3` imports from `@/features/inventory/components/ScrollPanel` (correct)

These will resolve on rebuild. No code changes needed for them.

---

## Phase 1: Remove dead client-side DoT code from useGameLoop

**File: `src/features/combat/hooks/useGameLoop.ts`**

Remove:
- Lines 319-511: three `useEffect` blocks for bleed, poison, and ignite DoT ticking (all guarded by `if (params.inParty) return` — always true)
- `inParty` from `UseGameLoopParams` and destructuring
- `combatStateRef`, `broadcastDamage`, `awardKillRewardsRef` from params (only used by dead DoT code)
- `dotKilledRef` ref (only used by dead DoT code and `notifyCreatureKilled`)
- `bleedStacksRef`, `poisonStacksRef`, `igniteStacksRef` refs + their sync effects (only used by dead DoT intervals)

Keep:
- All 18 buff/debuff `useState` declarations
- `notifyCreatureKilled` (still needed to purge local stack display state when server reports a kill — but remove `dotKilledRef` usage from it, just keep the setPoisonStacks/setBleedStacks/setIgniteStacks cleanup)
- `handleAddPoisonStack`, `handleAddIgniteStack` (used for server proc events)
- Regen intervals, death detection, party regen

**File: `src/pages/GamePage.tsx`**
- Remove `combatStateRef` creation and wiring
- Remove `awardKillRewardsRef` from useGameLoop params
- Remove `inParty: true` param
- Remove `broadcastDamage` from useGameLoop params (keep it for useCreatureBroadcast usage elsewhere)

~200 lines removed from useGameLoop, ~10 lines from GamePage.

---

## Phase 2: Create `useBuffState` — narrowly focused on transient combat UI state

**New file: `src/features/combat/hooks/useBuffState.ts`**

Move from useGameLoop:
- All 18 `useState` calls for buff/debuff state (regenBuff through focusStrikeBuff)
- Their type exports stay in useGameLoop types (or a new `types.ts`)
- `notifyCreatureKilled` (purges local DoT stack display — this is UI cleanup, not business logic)

Export two typed objects:
```typescript
export interface BuffState {
  regenBuff: RegenBuff;
  foodBuff: FoodBuff;
  critBuff: CritBuff;
  stealthBuff: StealthBuff | null;
  // ... all 18 values
}

export interface BuffSetters {
  setRegenBuff: (v: RegenBuff) => void;
  setFoodBuff: (v: FoodBuff) => void;
  // ... all 18 setters
}
```

Also include:
- `syncFromServerEffects(effects)` — the pure mapping logic (calls the helper from Phase 5)
- `clearAllBuffs()` — reset on death/disconnect

Does NOT include: regen intervals, death detection, combat flow, networking.

**File: `src/features/combat/hooks/useGameLoop.ts`**
- Import and use `useBuffState()` instead of owning the 18 useState calls
- Pass buff state/setters through to its return value
- Becomes ~150 lines: regen intervals + death detection + party regen + computed values

---

## Phase 3: Create `useMergedCreatureState` — dedicated selector hook

**New file: `src/features/combat/hooks/useMergedCreatureState.ts`**

```typescript
export function useMergedCreatureState(
  creatures: Creature[],
  combatHpOverrides: Record<string, number>,
  broadcastOverrides: Record<string, number>,
) {
  return useMemo(() => creatures.map(c => ({
    ...c,
    hp: combatHpOverrides[c.id] ?? broadcastOverrides[c.id] ?? c.hp,
  })), [creatures, combatHpOverrides, broadcastOverrides]);
}
```

Priority: combat-tick > broadcast > fetched.

**File: `src/pages/GamePage.tsx`**
- Replace manual HP merge patterns with `useMergedCreatureState(creatures, creatureHpOverrides, broadcastOverrides)`
- Pass `mergedCreatures` to NodeView and useActions instead of separate override objects

---

## Phase 4: Reduce useActions parameter surface

**File: `src/hooks/useActions.ts`**

Replace lines 57-75 (18 individual buff props + 18 setters) with:
```typescript
buffState: BuffState;
buffSetters: BuffSetters;
```

Additionally remove:
- `creatureHpOverrides` + `updateCreatureHp` — useActions uses these for attack HP tracking, but after Phase 3, it receives `mergedCreatures` with correct HP already baked in. Where it still needs to update HP (after an attack result from combat-tick), it can call through combat's `updateCreatureHp` via a single callback
- `stopCombat` — useActions never calls it (verified: only `stopCombatFn` is used in GamePage, not passed through useActions in a meaningful way)

Net result: ~40 fewer individual params, replaced by 2 typed objects + removal of unused params.

**File: `src/pages/GamePage.tsx`**
- Pass `buffState` and `buffSetters` from useBuffState instead of 36 individual destructured values

---

## Phase 5: Extract server effect sync into pure helper

**New file: `src/features/combat/utils/mapServerEffectsToBuffState.ts`**

Extract the mapping logic from `handleActiveDots` (GamePage lines 520-597) into a pure, typed, testable function:

```typescript
export interface ServerDotState {
  poison?: Record<string, { stacks: number; damage_per_tick: number; expires_at: number }>;
  ignite?: Record<string, { stacks: number; damage_per_tick: number; expires_at: number }>;
  bleed?: Record<string, { damage_per_tick: number; expires_at: number }>;
}

export function mapServerEffectsToStacks(
  serverDots: ServerDotState,
  prevPoison: Record<string, PoisonStack>,
  prevIgnite: Record<string, IgniteStack>,
  prevBleed: Record<string, DotDebuff>,
): { poison: Record<string, PoisonStack>; ignite: Record<string, IgniteStack>; bleed: Record<string, DotDebuff> }
```

This is a pure function — no hooks, no side effects. Easy to unit test.

**File: `src/features/combat/hooks/useBuffState.ts`**
- `syncFromServerEffects` calls `mapServerEffectsToStacks` and applies the result to state

**File: `src/pages/GamePage.tsx`**
- Remove the 80-line `handleActiveDots` callback
- Replace with `buffState.syncFromServerEffects(dots[character.id])` in the combat tick handler

---

## Phase 6: Reduce GamePage responsibility

After Phases 1-5, GamePage loses:
- ~80 lines of `handleActiveDots`
- ~10 lines of `combatStateRef` wiring
- ~36 lines of individual buff prop threading to useActions
- `gatherBuffs` callback (move to useBuffState since it only reads buff state)
- `handleConsumedBuffs` callback (move to useBuffState)

GamePage becomes a composition layer that:
- Instantiates feature hooks
- Passes typed objects between them
- Renders the layout

Estimated reduction: ~150 lines from GamePage.

---

## Phase 7: STATE_OWNERSHIP.md

**New file: `src/features/STATE_OWNERSHIP.md`**

Document with concrete examples:
- **Server-authoritative**: HP, XP, gold, creature HP, active_effects, combat sessions, inventory, node position, party membership
- **Fetched/cached**: character record (realtime sub), creature list, ground loot, nodes/areas
- **Local UI**: selectedTargetId, panel states, event log, death countdown, buff display state (synced from server but owned locally for rendering)
- **Derived**: effectiveAC, effectiveMaxHp, inCombat, mergedCreatureHp

Guidelines:
- If state affects simulation → server owns it
- If state affects display only → local UI may own it
- If computable from other state → derive it, don't store it

---

## Files Summary

| File | Change |
|------|--------|
| `src/features/combat/hooks/useGameLoop.ts` | Remove ~200 lines dead DoT code, delegate buff state to useBuffState |
| `src/features/combat/hooks/useBuffState.ts` | **New**: 18 buff states, setters, syncFromServerEffects, gatherBuffs |
| `src/features/combat/hooks/useMergedCreatureState.ts` | **New**: merged creature HP selector |
| `src/features/combat/utils/mapServerEffectsToBuffState.ts` | **New**: pure server→UI effect mapping |
| `src/features/combat/index.ts` | Export new hooks + types |
| `src/hooks/useActions.ts` | Replace 36 individual buff params with BuffState + BuffSetters |
| `src/pages/GamePage.tsx` | Remove handleActiveDots, combatStateRef, buff threading (~150 lines) |
| `src/features/STATE_OWNERSHIP.md` | **New**: ownership documentation |

## Constraints

- Zero gameplay changes
- No combat timing/formula changes
- No networking changes
- Build + typecheck + tests must pass

