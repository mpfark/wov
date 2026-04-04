

# Instant Aggro / Immediate First-Beat Polish Pass

## Analysis

The current flow already has:
- Aggro log lines (`⚠️ X is aggressive and attacks you!`) in `useCombatAggroEffects`
- Aggro flash (400ms red glow) in `NodeView` triggered by `engagedCreatureIds`
- Immediate first tick call in `startCombatCore` (line 192: `doTickRef.current()`)

The perceived delay comes from:
1. Generic/flat aggro messages that don't feel threatening
2. The aggro flash fires on `engagedCreatureIds` change, but this happens inside `startCombatCore` which is called from the aggro effect — timing is correct but the visual cue is subtle
3. No intermediate feedback between aggro log + flash and the first server-confirmed combat event (~200-500ms network round trip)

## Changes

### 1. `src/features/combat/hooks/useCombatAggroEffects.ts` — Immersive aggro messages + diagnostics

Replace flat aggro messages with varied, threatening creature-specific lines:

- Initial aggro: `⚠️ {name} lunges at you!` / `⚠️ {name} turns on you!` (randomized)
- Re-engage: `⚠️ {name} attacks!` → `⚠️ {name} charges at you!`
- Mid-fight join: `⚠️ {name} joins the fight!` (keep as-is, already good)

Add a small helper that picks from 3-4 threat phrases randomly.

Add dev-only diagnostic timestamps:
```typescript
if (import.meta.env.DEV) {
  console.debug('[aggro] detected', { creatureId, ts: performance.now().toFixed(0) });
}
```

### 2. `src/features/combat/hooks/usePartyCombat.ts` — Combat-start event + diagnostics

After `setInCombat(true)` in `startCombatCore`, emit a `combat:start` event on the GameEventBus so consuming UI can react instantly:

Currently line 189 logs to console. Add:
```typescript
params.eventBus?.emit('combat:start', { creatureId });
```

This requires threading `eventBus` through params (check if already available — if not, add it).

Add dev-only timing log for first tick response:
```typescript
if (import.meta.env.DEV && combatStartTimeRef.current) {
  console.debug('[combat] first tick confirmed', {
    aggroToConfirm: (performance.now() - combatStartTimeRef.current).toFixed(0) + 'ms'
  });
  combatStartTimeRef.current = null;
}
```

### 3. `src/features/world/components/NodeView.tsx` — Enhanced aggro flash

The existing 400ms flash is good but subtle. Extend it slightly:
- Increase flash duration from 400ms → 600ms
- Add a brief "shake" or scale pulse to the creature row on aggro (CSS animation, 1 cycle)

Add dev-only diagnostic:
```typescript
if (import.meta.env.DEV) {
  console.debug('[aggro] flash shown', { creatureId: cId, ts: performance.now().toFixed(0) });
}
```

### 4. `src/features/combat/hooks/useCombatAggroEffects.ts` — Immediate predicted log line

After the aggro log message, before `startCombat()` returns, add a second immediate log line that hints at impending combat without faking damage:

```typescript
addLocalLog(`⚔️ Combat begins!`);
```

This fills the "dead air" gap — player sees:
1. `⚠️ Obsidian Forge Guardian lunges at you!` (instant)
2. `⚔️ Combat begins!` (instant)
3. First real server-confirmed hit (200-500ms later)

### 5. Dev diagnostics summary

All diagnostics are `import.meta.env.DEV` gated and log to console.debug:

| Metric | Location |
|--------|----------|
| Node entry time | Already exists in NodeView |
| Creatures visible time | Already exists in NodeView |
| Aggro detected time | useCombatAggroEffects |
| Aggro flash shown time | NodeView |
| Combat start (setInCombat) time | usePartyCombat |
| First server tick confirmed time | usePartyCombat |

## Files Modified

| File | Change |
|------|--------|
| `src/features/combat/hooks/useCombatAggroEffects.ts` | Varied threat messages, `Combat begins!` line, dev timing logs |
| `src/features/combat/hooks/usePartyCombat.ts` | `combat:start` event emit, first-tick timing diagnostic |
| `src/features/world/components/NodeView.tsx` | Flash duration 400→600ms, dev diagnostic log |

## What Does NOT Change

- Combat formulas, tick rate, server authority
- Damage prediction logic
- Combat architecture / hook ownership
- Class balance, loot, death rules
- Non-aggro log messages

