## Goal

Reduce perceived latency when entering nodes and during shared combat, while keeping the server fully authoritative. Build on the existing `useCreatures` prefetch cache and `useCreatureBroadcast` channel rather than introducing parallel systems.

## What's already in place (don't rebuild)

- **Adjacent-node prefetch + 30s `prefetchCache`** in `useCreatures.ts` — already populates from connections and selectively reconciles nodes with active effects.
- **Two-phase load on node entry** — Phase 1 paints from cache or a fast direct DB read; Phase 2 overwrites with the authoritative `combat-catchup` reconcile.
- **Stale-fetch cancellation** via `fetchTokenRef` and `currentNodeIdRef`.
- **150ms reconcile lock** that swallows stale realtime echoes but still lets fresh respawns through.
- **`creature_damage` broadcast** with a `killed: boolean` flag, wired through `useNodeChannel` → `useCreatureBroadcast`. Currently it only updates HP overlays, not visibility.

The remaining gaps are: kills aren't visually applied from broadcasts, there's no soft-state safety net, and movement doesn't preheat the *destination* node before arrival.

## Changes

### 1. Apply kill hints from broadcasts (soft-dead layer)

In `useCreatureBroadcast.ts`, when a `creature_damage` event arrives with `killed: true`:

- Add the creature id to a new `softDeadIds: Set<string>` with `softDeadUntil = now + 8s`.
- Expose `softDeadIds` from the hook alongside `broadcastOverrides`.

In `useCreatures.ts`, accept an optional `softDeadIds` set and filter the rendered `creatures` array through it (creatures in the set are hidden).

Behavior:
- If the server confirms (DELETE / UPDATE with `is_alive=false` arrives via `onCreatureUpdate`), the creature is removed normally and the soft entry becomes a no-op.
- If 8s passes with no server confirmation, the soft entry expires (timer-driven cleanup) and the creature reappears — server truth wins.
- Self-filter is preserved: the killer's own broadcast doesn't echo back.

### 2. Movement-time destination preheat

In `useMovementActions.ts`, at the moment a move is committed to a target `node_id`:

- Call a new `preheatNode(targetNodeId)` helper exported from `useCreatures.ts` (module scope, no hook).
- `preheatNode` does a fast direct `creatures` SELECT (alive-only, current node filter) and writes into the existing `prefetchCache` with a fresh timestamp — only if the cache entry is missing or older than ~5s.

This gives Phase 1 a near-100% cache hit on arrival without any new bookkeeping.

### 3. Tighten the cache freshness model

- Lower `PREFETCH_TTL` from 30s to 15s (the spec's upper bound) so we don't paint very stale state on entry, while still beating the round-trip.
- Add a tiny "is fresh" helper instead of repeating `Date.now() - cached.ts < PREFETCH_TTL` inline.

No change to reconcile throttling (`RECONCILE_THROTTLE_MS = 10s`) — it already plays well with 15s freshness.

### 4. Soft-dead expiry & cleanup

- A single `setTimeout` per soft entry, plus a sweep when any new event comes in, keeps the set small.
- On `nodeId` change, clear `softDeadIds` (same pattern as `broadcastOverrides`).
- `cleanupOverrides(activeCreatureIds)` is extended to also drop soft entries for ids no longer present.

### 5. State-priority documentation

Add a short comment block at the top of `useCreatures.ts` documenting the priority order so future edits don't invert it:

```text
1. Server-authoritative (combat-catchup result, postgres_changes UPDATE/DELETE)
2. Broadcast hints (softDeadIds, broadcastOverrides) — expire in seconds
3. prefetchCache — last-known snapshot, ≤15s old
```

## Files touched

- `src/features/combat/hooks/useCreatureBroadcast.ts` — emit + track `softDeadIds`, return from hook.
- `src/features/creatures/hooks/useCreatures.ts` — accept `softDeadIds`, filter render output, export `preheatNode`, lower TTL, add header doc.
- `src/features/world/hooks/useMovementActions.ts` — call `preheatNode(targetId)` on move commit.
- `src/pages/GamePage.tsx` — thread `softDeadIds` from `useCreatureBroadcast` into `useCreatures`.

## What is explicitly NOT changed

- No edits to `combat-tick`, `combat-catchup`, `kill-resolver`, reward math, loot tables, respawn SQL, or any RLS/RPC.
- No new broadcast event types — reuses existing `creature_damage` with `killed: true`.
- No client-side reward grants or DB writes.
- No changes to `useMergedCreatureHpOverrides` priority (combat-tick still wins over broadcast).

## Success checks (manual)

- Walk fast across 4–5 nodes: creatures visible immediately on every arrival.
- Two players at the same node, one kills a creature: the other sees it disappear within ~100ms instead of waiting for the postgres change.
- Disconnect briefly during a kill broadcast: creature reappears after ~8s if the kill never actually committed (server truth restores it).
- Solo play: behavior unchanged (no broadcasts to apply).
