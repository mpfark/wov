

# Hybrid Combat Model — Implemented

## Summary

Replaced the offscreen catch-up combat-round model with a hybrid model:
- **Live combat** only while players are actively present in the node
- **Offscreen persistent effects** (DoTs) reconciled on node access via `combat-catchup`
- **No full combat rounds offscreen** — no auto-attacks, no creature counterattacks

## Session Lifecycle Rules (enforced in combat-tick)

A session is deleted when ANY of these is true:
1. `session.node_id !== node_id` — player left the node
2. `members.length === 0` — no alive members at the combat node
3. No alive engaged creatures remain after tick processing

Effects survive independently in `active_effects` and are reconciled by `combat-catchup` on next access.

## Changes Made

### `supabase/functions/combat-tick/index.ts`
- Session deleted immediately on node change (no offscreen DoT continuation)
- Session deleted when no alive members at node (checked after session load)
- Removed `isDotOnly` mode entirely — auto-attacks and creature counterattacks always run (sessions only exist when players are present)
- Simplified session-end: ends when no creatures alive (effects persist independently)
- `TICK_CAP` reduced to 3 as defensive safeguard (not the core fix)
- Added `ticks_capped` and `session_deleted_reason` diagnostics

### `supabase/functions/combat-catchup/index.ts`
- Simplified to pure offscreen effect reconciler
- Removed session timeline synchronization logic
- Removed orphaned session cleanup
- Added `effects_resolved` diagnostic

### `src/features/combat/hooks/usePartyCombat.ts`
- Removed `nodeEntryTickRef` (double-reconciliation eliminated by design)
- Updated header comment to document hybrid model
- Updated node-change comment to reflect new ownership model

## What Did NOT Change
- Combat formulas, damage math, class abilities, tick rate (2s)
- `active_effects` table schema — `session_id` remains as optional metadata
- How effects are created during live combat
- `resolveEffectTicks` logic in the shared resolver
- Loot, XP, gold, salvage, BHP award logic
- Party combat mechanics
- Equipment degradation
- Client-side buff/debuff display
- Creature respawn logic
- Skeleton loading on node entry
- `useCreatures` authoritative-first reconciliation
