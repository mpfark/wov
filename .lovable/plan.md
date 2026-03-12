

# Performance Optimization Plan (LPMud-Informed)

## LPMud Lessons Applied

LPMud drivers have decades of optimization wisdom around heartbeats. The key principles that apply directly:

1. **"Don't give objects heartbeats unless really necessary"** — Only objects actively in combat should tick. Our idle detection already does this partially, but we can be stricter.
2. **`clean_up()` / object swapping** — Objects not interacted with get unloaded from memory. Translates to: aggressively unsubscribe from channels and clear state for nodes/entities the player isn't near.
3. **Minimize work per heartbeat** — LPMud docs explicitly say "do as little in `heart_beat()` as reasonable." Our combat tick currently gathers buffs, gathers DoTs, builds a payload, and makes a network call — all synchronous in the tick. We should pre-compute what we can.
4. **`call_out` for one-shots** — LPMud uses `call_out` (setTimeout) for delayed single events instead of keeping a heartbeat alive. Our ability queue currently keeps the heartbeat running just to wait — a simple setTimeout would be lighter.

## Implementation Phases

### Phase 1 — Eliminate Redundant Channels (3 channels saved)

**`useCreatures`**: Remove dedicated `creatures-{nodeId}` channel. Add creature `postgres_changes` listeners to the existing unified `node-{nodeId}` channel in `useNodeChannel`. The creature hook becomes a pure state holder that receives events via callback refs (same pattern as ground loot).

**`useInventory`**: Remove the `inventory-{characterId}` realtime channel. Every inventory mutation already calls `fetchInventory()` after completion — the postgres_changes subscription just triggers a redundant second fetch.

**`usePartyCombatLog`**: Remove the `party-combat-log-{partyId}` channel. Combat log entries already arrive via the `party_combat_msg` broadcast event. The DB subscription is redundant.

**Files**: `useNodeChannel.ts`, `useCreatures.ts`, `useInventory.ts`, `usePartyCombatLog.ts`

### Phase 2 — Eliminate Redundant DB Writes (LPMud: minimize heartbeat work)

The `combat-tick` edge function already persists HP, XP, gold, and level to the database. But `processTickResult` then calls `updateCharacter()` which writes those same values again — a redundant round-trip every 2 seconds per player.

**Fix**: Split `updateCharacter` into two paths:
- `updateCharacterLocal(updates)` — updates React state only (for combat tick results)
- `updateCharacter(updates)` — writes to DB (for player-initiated actions like stat allocation)

`processTickResult` calls the local-only version. This removes ~30 DB writes per minute during combat.

**Files**: `useCharacter.ts`, `usePartyCombat.ts`

### Phase 3 — Heartbeat Discipline (LPMud: `call_out` over `heart_beat`)

**Ability queue via setTimeout**: Currently, queuing an out-of-combat ability starts the full 2s Worker interval just to fire once. LPMud would use `call_out` (a one-shot timer). Replace this with a single `setTimeout` that fires the ability and stops — no interval needed.

**Pre-compute tick payload**: `gatherBuffs()` and `gatherDotStacks()` are called inside `doTick()`. Move gathering to happen when buffs/DoTs change (event-driven), storing the latest snapshot in a ref. The tick just reads the ref — zero computation per heartbeat.

**Guard non-leader broadcast interval**: The 1.8s `setInterval` for broadcasting buff/DoT state runs continuously while in a party, even when not in combat and having no buffs. Add a guard: only broadcast when `inCombat` and there's data to send.

**Files**: `usePartyCombat.ts`, `useGameLoop.ts`

### Phase 4 — Clean Up Stale State (LPMud: `clean_up` / swap)

**Cache visited nodes**: `PlayerGraphView` fetches `character_visited_nodes` from DB on every node change. Instead, maintain a client-side `Set<string>` that grows as the player moves. Only fetch once on initial load.

**Batch creature presence for map**: `PlayerGraphView` queries creature counts for all visible nodes individually. Batch into a single query with an `in` filter.

**Memoize log rendering**: Wrap the event log in `React.memo` and debounce `scrollIntoView` to prevent layout thrashing on rapid log updates.

**Files**: `PlayerGraphView.tsx`, `GamePage.tsx`

## Impact Summary

```text
Before:  7-9 channels, ~30 redundant DB writes/min, full gather per tick
After:   4-6 channels, ~0 redundant writes/min, pre-computed tick payloads

Channel savings:
  - creatures channel      → merged into node channel
  - inventory channel      → removed (client-driven fetches sufficient)
  - combat log channel     → removed (broadcast covers it)

DB write savings:
  - updateCharacter in combat tick → local-only state update
  - visited nodes per move         → client-side cache

Heartbeat savings:
  - ability queue uses setTimeout instead of full interval
  - buff/DoT payload pre-computed, not gathered each tick
  - non-leader broadcast guarded by combat state
```

All changes preserve the 2-second heartbeat and party sync model. The heartbeat itself is untouched — we're just reducing the work done *around* each tick, exactly as LPMud optimization guides recommend.

