

# Same-Node Combat Log Cooperation

## What This Does

When solo players fight on the same node, each player will see the other players' damage in their combat log (e.g. "Thorin hits Goblin for 12 damage."). No session merging, no new broadcasts — we piggyback on the existing `creature_damage` broadcast that already fires on every hit.

## Current State

- `useCreatureBroadcast` already receives `creature_damage` broadcasts from other players on the same node
- These events carry: `attacker_name`, `damage`, `creature_id`, `new_hp`, `killed`
- Currently, only the HP override is applied — no log message is generated
- Creature names are available from the `creatures` array passed to GamePage

## Changes

### 1. Extend `useCreatureBroadcast` to emit log messages

**File: `src/features/combat/hooks/useCreatureBroadcast.ts`**

- Add an `onOtherPlayerDamage` callback parameter (or ref) that gets called when a non-self creature_damage broadcast arrives
- Pass creature name resolution by accepting a `creatures` array or a name-lookup function
- When a broadcast arrives, in addition to setting HP overrides, call the callback with a formatted message like:
  - `"Thorin hits Goblin for 12 damage."` (normal hit)
  - `"Thorin slays Goblin!"` (kill)

### 2. Wire up the log callback in GamePage

**File: `src/pages/GamePage.tsx`**

- Pass a creature name resolver and the event bus (or `addLocalLog`) into `useCreatureBroadcast`
- When the callback fires, emit a log entry so it appears in the EventLogPanel
- Use a muted color style so other players' damage is visually distinct from your own

### 3. Add log color for other-player messages

**File: `src/features/combat/utils/combat-log-utils.ts`**

- Add a prefix/pattern match for other-player damage messages (e.g. lines not starting with "You") to apply a dimmer color like `text-blue-400/70`

## What Won't Change

- No new broadcast events — reuses existing `creature_damage`
- No session merging
- No server changes
- No DB changes
- No changes to combat tick logic

## Files Touched

| File | Change |
|------|--------|
| `src/features/combat/hooks/useCreatureBroadcast.ts` | Add log callback when receiving other players' damage |
| `src/pages/GamePage.tsx` | Wire callback to event log |
| `src/features/combat/utils/combat-log-utils.ts` | Style for other-player damage lines |

