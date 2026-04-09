

# Combat Feel: Presentation-Layer Improvements

Three targeted changes — no server, polling, math, or ownership changes.

## 1. Instant HP prediction on combat start

**File:** `src/features/combat/hooks/usePartyCombat.ts` — `startCombatCore` (lines 190-199)

After `setInCombat(true)` and before `doTickRef.current()`, run the conservative predictor against the initial creature. This makes the creature's HP bar dip immediately when combat begins, before the first server tick returns.

```typescript
// After line 195 (setInCombat), before doTickRef.current():
const creature = ext.current.creatures.find(c => c.id === creatureId);
if (creature && creature.is_alive && creature.hp > 0) {
  const { CLASS_COMBAT_PROFILES: profiles } = await import('../utils/combat-math');
  const profile = profiles[ext.current.character.class];
  if (profile) {
    const statKey = profile.stat as keyof typeof ext.current.character;
    const attackerStat = (ext.current.character[statKey] as number) || 10;
    const prediction = predictConservativeDamage({
      classKey: ext.current.character.class,
      attackerStat,
      int: ext.current.character.int,
      str: ext.current.character.str,
      creatureAC: creature.ac,
    });
    if (prediction.shouldPredict) {
      const predictedHp = applyPredictedDamage(creature.hp, prediction.predictedDamage);
      setLocalPredictionOverrides({ [creatureId]: { hp: predictedHp, ts: Date.now() } });
    }
  }
}
```

Since `startCombatCore` is currently synchronous (`useCallback`), this needs to become async or use a fire-and-forget helper. The simplest approach: extract the prediction into a separate non-blocking function called right after `setInCombat(true)`.

No predicted log entry — visual HP bar change only.

## 2. Combat start visual cue on NodeView container

**File:** `src/features/world/components/NodeView.tsx`

Track `inCombat` transition from `false → true` using a ref. When detected, set a `combatFlash` state for ~400ms. Apply a CSS class to the outer container `div` (line 131):

```typescript
const prevInCombatRef = useRef(false);
const [combatFlash, setCombatFlash] = useState(false);

useEffect(() => {
  if (inCombat && !prevInCombatRef.current) {
    setCombatFlash(true);
    setTimeout(() => setCombatFlash(false), 400);
  }
  prevInCombatRef.current = !!inCombat;
}, [inCombat]);
```

On the container div: `className={cn("h-full flex flex-col p-3 relative", combatFlash && "combat-start-flash")}`

**File:** `src/index.css` — add animation:

```css
@keyframes combat-start-glow {
  0% { box-shadow: inset 0 0 20px rgba(220, 38, 38, 0.3); }
  100% { box-shadow: inset 0 0 0px rgba(220, 38, 38, 0); }
}
.combat-start-flash {
  animation: combat-start-glow 0.4s ease-out;
}
```

## 3. Victory micro-delay (250ms)

**File:** `src/features/combat/hooks/usePartyCombat.ts` — `processTickResult` (lines 306-307)

Replace immediate `stopCombat()` when all creatures are dead with a short delay:

```typescript
if (result.aliveEngagedIds.length === 0) {
  setTimeout(() => stopCombat(), 250);
} else { ... }
```

Only this specific path (all enemies dead) gets the delay. The `session_ended` path (lines 295-304), death cleanup, and manual stop remain immediate.

## Files changed

| File | Change |
|------|--------|
| `src/features/combat/hooks/usePartyCombat.ts` | Instant prediction in `startCombatCore`; 250ms victory delay in `processTickResult` |
| `src/features/world/components/NodeView.tsx` | Combat start flash effect (ref + CSS class) |
| `src/index.css` | `combat-start-glow` keyframe animation |

## Not changed
- Server tick rate, polling interval, combat math, prediction rules
- `useCombatAggroEffects` — remains single owner of aggro/join logic
- Session lifecycle, no new server calls

