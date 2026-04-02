

# Revised Plan: Client-Predicted, Broadcast-Assisted, Server-Computed Combat

Three refinements applied to the previously approved plan. Everything else remains unchanged.

## Refinement 1: Conservative HP Prediction

The `combat-predictor.ts` helper must produce stable, conservative damage estimates rather than full random rolls.

**Implementation:**
- Use the **expected average** of the character's damage range (floor of `(min + max) / 2`) instead of a random roll
- Never predict crits — always assume a normal hit
- If the character's effective hit chance is below ~70%, do not predict an HP change at all (bias toward stability)
- Predicted HP should never drop a creature below 1 HP — death is server-only

This ensures HP bars move smoothly and predictably, and server reconciliation produces only tiny corrections (±1-3 HP) rather than large snap-backs.

## Refinement 2: Single-Entry Log with In-Place Resolution

Predicted log entries must not create duplicates. The combat log must show one entry per attack, resolved in place.

**Implementation in `usePartyCombat.ts`:**
- Each predicted log entry gets a unique `tickId` and `predicted: true` flag
- When the server response arrives for that tick, find the matching predicted entry by `tickId` and **replace** it with the authoritative text/data
- If no predicted entry exists (e.g., prediction was skipped due to low hit chance), insert the server entry normally
- Never show both predicted and confirmed entries for the same tick
- The `eventLog` array in GamePage treats `predicted` entries as mutable placeholders

**Rendering in NodeView / log display:**
- Predicted entries render identically to confirmed entries (no dimming, no "(predicted)" label) — since predictions are conservative, visual differences are minimal and labels would add clutter
- If a prediction was wrong (miss predicted as hit, or vice versa), the entry text simply updates in place on server response

## Refinement 3: Strict Prediction Lifecycle and Cleanup

Local prediction state must never linger or stack.

**Rules implemented in `usePartyCombat.ts` and `useMergedCreatureState.ts`:**

1. **Server response clears prediction**: When `processTickResult` runs, all `localPredictionOverrides` for creatures in that tick response are replaced with server values
2. **Combat end clears all**: When `stopCombat` fires, all prediction overrides are cleared to `{}`
3. **Node departure clears all**: When node changes (existing creature clear logic), prediction overrides are also cleared
4. **Safety timeout**: Each prediction override entry stores a timestamp; a 4-second timeout (2x tick interval) automatically clears any prediction that was never confirmed by the server
5. **Single layer per creature**: Setting a new prediction for a creature ID overwrites the previous one — no stacking

**Cleanup responsibility:**
- `useMergedCreatureState` receives `localPredictionOverrides` as a `Record<string, { hp: number; ts: number }>`
- Before merging, it filters out entries older than 4 seconds
- `usePartyCombat.stopCombat` and the node-change effect both reset the prediction map

## Files Changed (full list, unchanged from prior plan except noted)

| File | Action | Description |
|------|--------|-------------|
| `src/features/combat/utils/combat-predictor.ts` | **Create** | Prediction-only helper: average damage, no crits, skip if low hit chance, never predict death |
| `src/features/combat/hooks/usePartyCombat.ts` | **Modify** | Optimistic prediction with tickId-based log replacement, cleanup on stop/node-change, 4s safety timeout |
| `src/features/combat/hooks/useMergedCreatureState.ts` | **Modify** | Accept `localPredictionOverrides` with timestamps, filter stale entries, clear on combat end |
| `src/features/combat/hooks/useCreatureBroadcast.ts` | **Modify** | Add transient hint events |
| `src/features/party/hooks/usePartyBroadcast.ts` | **Modify** | Add `party_attack_event` transient hint |
| `src/features/world/hooks/useNodeChannel.ts` | **Modify** | Add callback refs for broadcast combat events |
| `src/features/combat/hooks/useOffscreenDotWakeup.ts` | **Modify** | Add reconcile hint broadcast |
| `src/hooks/useBroadcastDebug.ts` | **Modify** | Add predict/reconcile categories |
| `src/features/combat/index.ts` | **Modify** | Export predictor types |
| `src/pages/GamePage.tsx` | **Modify** | Wire prediction overrides into merged state |

## What Does NOT Change

- `combat-tick` edge function (server computes all combat)
- `combat-catchup` edge function (server reconciles offscreen)
- Combat math formulas, class/ability balance
- Leader-authoritative party model
- Database schema / RLS policies
- Movement, inventory, chat systems

