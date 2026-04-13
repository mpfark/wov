

# Fix Double Aggro Message + Verify Player-Initiated Log

## Problem 1: Two aggro messages for one creature
When entering a node with an aggressive creature, two messages appear because:
- **Initial aggro** (line 121) logs e.g. "⚠️ Scrap-Chitin Hunter locks eyes on you!"
- **Mid-fight join** (line 88-101) immediately fires too, logging "⚠️ Scrap-Chitin Hunter joins the fight!" — because `startCombat` sets `inCombat=true`, which triggers the mid-fight effect before `engagedCreatureIdsRef` is updated.

## Fix

**File: `src/features/combat/hooks/useCombatAggroEffects.ts`**

In the mid-fight join effect (line 91-100), add a check against `aggroProcessedRef` so creatures that were already announced via initial aggro or re-engage don't get a second "joins the fight!" message:

```typescript
if (c.is_aggressive && c.is_alive && c.hp > 0 
    && !engagedCreatureIdsRef.current.includes(c.id) 
    && !recentlyKilledRef.current.has(c.id)
    && !aggroProcessedRef.current.has(c.id)) {  // ← add this
```

This ensures each creature only gets one announcement message.

## Problem 2: Player-initiated message
The "⚔️ You start attacking..." code is already in place (GamePage.tsx lines 595, 603, 618) — it works for non-aggressive creatures. No change needed here.

## Files changed

| File | Change |
|------|--------|
| `src/features/combat/hooks/useCombatAggroEffects.ts` | Add `aggroProcessedRef` check to mid-fight join to prevent duplicate announcements |

