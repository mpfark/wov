# Diagnosis: Why XP can be missed on mobile when the character is far from the dying creature

## What I found in the code

There are **two independent gates** that decide whether you get XP for a kill, and both can silently drop a mobile player who is "far from" the creature's node.

### 1. Server-side node filter (`supabase/functions/combat-tick/index.ts`)

When a party tick runs, the function loads party members and filters them:

```ts
members = (membersRaw || []).filter(m => {
  const ch = m.character as any;
  return ch?.current_node_id === node_id && ch?.hp > 0;
});
```

`node_id` is the **driver/leader's** `current_node_id`. Then `recipients = members` is passed straight into `resolveCreatureKill` (`_shared/kill-resolver.ts`).

Consequences:
- A party member who has walked even one node away at the moment the killing tick lands is removed from `recipients` and **gets 0 XP / gold / Renown / loot for that kill**.
- If the **leader** is the one who walked away, the tick body still carries the leader's `current_node_id`, which no longer matches the creature's node. Combat-tick then deletes the session (`session_deleted_reason: 'node_changed'`) and *nobody* gets XP for in-flight kills.

This is the "party-at-node" rule and it's intentional for live combat, but it makes movement timing brittle.

### 2. Client tick cadence under mobile throttling (`src/features/combat/hooks/usePartyCombat.ts`)

- Only the driver (solo player, or party leader) calls `combat-tick`.
- The interval uses `setWorkerInterval(...,2000)` from `src/lib/worker-timer.ts`, which is good — the Web Worker isn't throttled by background tabs **as long as the page is still alive**.
- But on mobile (especially iOS Safari) backgrounded tabs are eventually **suspended entirely**, including workers. When the leader is on mobile and the tab is hidden/locked:
  - Ticks stop firing → kills don't resolve.
  - When the tab comes back, the first tick uses the **current** `current_node_id`. If the player moved meanwhile (or wimped), the session is killed with `node_changed` and the queued damage never converts into a kill event with rewards.
- The leader then re-broadcasts tick results to other members via `channelRef.current?.send({ event: 'combat_tick_result' })`. A backgrounded mobile member can miss that broadcast, so even when the server *did* award them XP, the local UI/XP bar doesn't update until next refresh.

### 3. Offscreen DoT path (`useOffscreenDotWakeup.ts` + `combat-catchup`)

When you walk away with a DoT ticking, the client schedules a `reconcileNode` call. On mobile this scheduler is a plain `setTimeout`, so a backgrounded tab can fire it late or not at all — the kill (and its XP) won't be credited until the next foreground event triggers reconciliation. Solo DoT kills off-node only pay the source, so a far-away mobile soloist relies entirely on this timer.

## Net answer for the user

Yes — there are real, reproducible reasons a mobile player who is far from the dying creature can miss the XP event:

1. **Party kills**: the server only pays members whose `current_node_id` equals the combat node at the exact tick of the kill. Move one step early → no XP for that mob.
2. **Mobile background suspension**: workers/timers stop, so the leader's combat-tick is late; on resume the session is invalidated by `node_changed` and the queued damage is discarded with no reward.
3. **Broadcast loss**: even when the server does award, the result is delivered to non-leaders via realtime broadcast; a suspended mobile tab misses it and the XP bar doesn't visibly update until the next character refresh.

## Proposed fixes (in priority order)

1. **Per-member node check at kill time, not at tick start.**
   In `combat-tick`, when a creature dies, refetch each session member's `current_node_id` (or use the per-tick `members` already loaded) and *re-evaluate eligibility at the moment of the kill*, not at the start of the tick. Members who left between damage-application and creature-death this tick should still count.

2. **Grace window for "just left" party members.**
   When building `recipients`, include any party member whose `current_node_id !== node_id` but whose `last_node_change_at < kill_tick_start - GRACE_MS` (e.g. 1500ms). Matches the existing 1000ms movement grace already used for party-movement sync.

3. **Refresh-on-resume for the driver.**
   In `usePartyCombat`, add a `visibilitychange` handler that, on `visible`, immediately fires a "catchup" tick before resuming the 2s interval. This shortens the window where mobile suspension lets the session be invalidated by `node_changed`.

4. **Self-heal the XP bar on broadcast miss.**
   On `visibilitychange → visible` for non-leader party members, run a lightweight character refresh (`refetchCharacter`) so any XP awarded while suspended appears immediately, even if the broadcast was missed.

5. **Reconciliation safety net for offscreen DoT on mobile.**
   In `useOffscreenDotWakeup`, also subscribe to `visibilitychange`: when the tab returns from hidden, immediately call `reconcileNode` for every tracked node instead of waiting for the predicted timer.

## Files to touch

- `supabase/functions/combat-tick/index.ts` — recipient re-evaluation at kill time + grace window.
- `src/features/combat/hooks/usePartyCombat.ts` — visibilitychange resume tick + non-leader character refresh.
- `src/features/combat/hooks/useOffscreenDotWakeup.ts` — visibilitychange-driven reconcile.

No DB schema changes required. No formula changes; rewards still computed by the existing `resolveCreatureKill` pipeline.

## Verification

- Repro on mobile: engage a slow creature, walk 1–2 nodes away just before death, confirm XP arrives.
- Backgrounded leader: lock phone mid-fight, return after the creature would have died, confirm the kill is credited.
- Party member on mobile far from leader: confirm XP bar updates on return-to-foreground.
