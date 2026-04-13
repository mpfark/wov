

# Safety Verification Results

## 1. `broadcastReward` — Confirmed Dead

**Search results**: Only 2 files reference it:
- `usePartyBroadcast.ts` — defines it (lines 138–145) and returns it
- `GamePage.tsx` — destructures it as `_broadcastReward` (underscore-prefixed = unused)

No other file imports or calls `broadcastReward`. The **receiving** side (`party_reward` listener in `usePartyBroadcast`) is fully wired and works independently — it's a listener on the channel, not dependent on this sender function. Party rewards are actually sent by the server-side combat-tick function, not by the client.

**Verdict**: Safe to remove. Will add a brief comment in the removal commit noting that `party_reward` events are server-originated.

## 2. `CombatLogEntry` — Confirmed Dead

**Search results**: Only 2 files reference it:
- `usePartyCombatLog.ts` — defines the interface (used only for the always-empty `entries` array)
- `combat/index.ts` — re-exports the type

**No file imports `CombatLogEntry`** from either location. Zero consumer imports found.

**Verdict**: Safe to remove the type export from `index.ts` and the interface from `usePartyCombatLog.ts`. The `entries` state (always `[]`) is also dead and should be removed together.

## Plan

Proceed with the full cleanup plan as previously approved, with these two items now verified safe:

| Item | Action |
|------|--------|
| `broadcastReward` in `usePartyBroadcast.ts` | Remove function + return entry |
| `_broadcastReward` in `GamePage.tsx` | Remove from destructuring |
| `CombatLogEntry` interface in `usePartyCombatLog.ts` | Remove interface + `entries` state |
| `CombatLogEntry` export in `combat/index.ts` | Remove type export line |

No other changes beyond what the original audit plan specified.

