

# Combat Stabilization Pass — Refined Plan

## Summary

Same stabilization pass as previously approved, with two refinements: request-scoped stale response protection and preserved DoT proc feedback.

## Change 1: Request-Scoped Stale Response Guard

**File**: `src/features/combat/hooks/usePartyCombat.ts`

**Approach**: Add an incrementing `tickSeqRef` (number ref, starts at 0). Each `doTick` call increments it and captures the value before the async `combat-tick` invoke. When the response arrives, compare to `tickSeqRef.current` — if the captured value is stale (i.e., a newer tick has already been sent), discard the response.

- Add `const tickSeqRef = useRef(0)` alongside existing refs
- In `doTick`, before the `supabase.functions.invoke` call: `const seq = ++tickSeqRef.current`
- After the response: `if (seq !== tickSeqRef.current) { console.log('[combat] stale tick response ignored', { seq, current: tickSeqRef.current }); return; }`
- Also add `tickSeqRef.current = 0` in `stopCombat` to reset on combat end
- This is strictly stronger than node-id guarding — it catches overlapping requests on the same node too
- The existing `if (!inCombatRef.current) return` guard in `processTickResult` stays as a secondary check

**Diagnostics**: Log on rejection with seq numbers for debugging.

## Change 2: Preserve DoT Proc Feedback, Deduplicate at State Layer

**File**: `src/features/combat/hooks/usePartyCombat.ts`

**No change to lines 242-248** — keep `onPoisonProc` and `onIgniteProc` calls from events. These provide immediate moment-of-application feedback (log messages, animations).

**File**: `src/features/combat/hooks/useBuffState.ts` (or `mapServerEffectsToBuffState.ts`)

The deduplication fix belongs in the state consumption layer:
- In `syncFromServerEffects` / `mapServerEffectsToStacks`: when server `active_effects` arrive, they **replace** the local stack state (already the current behavior — it's a full overwrite, not additive)
- The proc callbacks (`handleAddPoisonStack`, `handleAddIgniteStack`) add stacks optimistically for feel
- When `active_effects` arrives moments later, it overwrites to authoritative values
- This is already correct behavior (optimistic → authoritative overwrite), so **no code change needed** for deduplication
- Add a comment in `processTickResult` explaining the intentional pattern: "proc events provide immediate feedback; active_effects overwrites to authoritative state — no double-counting occurs because syncFromServerEffects replaces, not merges"

## Change 3–6: Unchanged from Previous Plan

| # | Change | File |
|---|--------|------|
| 3 | Fix `elapsed > 0` always-true fallback condition | `useCreatures.ts` |
| 4 | Always clear interval + pending ability in `stopCombat` | `usePartyCombat.ts` |
| 5 | Add `request_duration_ms` diagnostic | `combat-tick/index.ts` |
| 6 | Client timing diagnostics (start, gap, latency) | `usePartyCombat.ts` |

## Files Changed

| File | Change |
|------|--------|
| `src/features/combat/hooks/usePartyCombat.ts` | Request-scoped seq guard in `doTick`; always clear interval in `stopCombat`; client timing diagnostics; explanatory comment on proc vs active_effects pattern |
| `src/features/creatures/hooks/useCreatures.ts` | Fix `elapsed > 0` always-true condition |
| `supabase/functions/combat-tick/index.ts` | Add `request_duration_ms` diagnostic |

## What Does NOT Change

- Combat formulas, tick rate, abilities, balance
- Hybrid model architecture, server authority
- `onPoisonProc` / `onIgniteProc` event callbacks (kept for feel)
- `active_effects` authoritative sync (already overwrites, no merge)
- `combat-catchup`, `_shared/combat-resolver.ts`, `useBuffState` core logic

