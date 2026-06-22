## Problem

On world entry the event log shows only the empty-state placeholder "Your journey begins…" instead of the wakeup sequence (or the "Welcome back, Wayfarer!" line for returning characters).

## Root cause

`useFirstEntryWelcome` is wired to `addLog` in `src/pages/GamePage.tsx`:

```ts
useFirstEntryWelcome(character?.id, addLog);
```

`addLog` does **not** push to the local event log. It emits `bus.emit('log', …)`, whose handler:

1. Writes the message to the shared `party_combat_log` table.
2. Broadcasts it to other players on the same node.

The local event-log panel is populated by `bus.emit('log:local', …)` (via `addLocalLog`) and by **incoming** party-log broadcasts from other players. The incoming-log handler in `GamePage.tsx` explicitly skips the player's own echoes:

```ts
if (ownLogIdsRef.current.has(entry.id)) continue;
```

Result: the welcome lines get persisted/broadcast as party chatter (wrong channel for personal narrative) and are filtered out of the sender's own panel — so the panel stays empty and renders the placeholder.

The same bug also affects the `useSoulringGlow` whisper, which is wired to `addLog` in the same spot.

## Fix

Switch both hooks to the local-only emitter. They are personal, single-player narrative — no need to persist them to the party log or broadcast them to nearby players.

**Edit `src/pages/GamePage.tsx` (lines 440–443):**

```ts
// First-entry immersive welcome (staggered) or short returning greeting.
useFirstEntryWelcome(character?.id, addLocalLog);
// Whisper + transient ring glow when soulring tier increases.
const soulringGlow = useSoulringGlow(character?.id, character?.soulring_tier, addLocalLog);
```

(`addLocalLog` is already defined one line above on line 437.)

No changes needed inside the hooks themselves — they already take an `emit` callback and don't care which bus event it targets.

## Why this also makes the StrictMode-style remount fix from the previous turn unnecessary to revisit

The `useFirstEntryWelcome` hook still keeps its module-level `handledThisPageLoad` guard and late flag write, so the "Welcome back" branch will only fire on genuine subsequent entries — not as a fallback during the create→sync handoff.

## Files touched

- `src/pages/GamePage.tsx` — change two arguments (`addLog` → `addLocalLog`) on the two hook calls.

## Out of scope

- No DB schema changes.
- No changes to the welcome text or stagger timing.
- No changes to combat or chat broadcast paths.
