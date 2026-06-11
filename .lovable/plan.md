## Goal
Flip the Event Log so the newest entry appears at the top, tightening the visual connection between the ability bar / status bars and the most recent combat feedback.

## Scope
- Event Log only (`src/features/combat/components/EventLogPanel.tsx`).
- Chat panel unchanged (standard chat convention: newest at bottom).
- No new user toggle, no preference storage — single direction.

## Changes

**`src/features/combat/components/EventLogPanel.tsx`**
1. Render `filteredEventLog` in reverse order (`[...filteredEventLog].reverse().map(...)`), preserving original indices for stable React keys.
2. Remove the `logEndRef` sentinel `<div>` at the bottom — no longer needed since new entries land at the top of an already-scrolled-to-top container.
3. Keep the scroll container scrolled to `scrollTop: 0` on new entries (natural default when content grows at the top, but we'll add a small effect to force it in case the user has scrolled down to read history — TBD: see open question).

**`src/pages/GamePage.tsx`** (or wherever `logEndRef` is created/passed)
- Stop creating/passing `logEndRef` to `EventLogPanel`. Remove the `scrollIntoView` effect that currently keeps the bottom anchored. Leave any chat-related scroll anchors alone.

## Out of scope
- Chat panel direction.
- Tick divider styling (keeps working as-is, just appears between the tick's entries with the newer tick above the older one).
- Combat log display mode toggle (F / F+N) — unchanged.
- No formula, balance, or wording changes.

## Open question (will ask before building)
When the user has scrolled down to read older entries and a new entry arrives, should we:
- **A.** Auto-jump back to the top (always show newest), or
- **B.** Stay put and let them finish reading (newest waits at top until they scroll back up)?

B is friendlier; A matches the current "always show newest" behavior. I lean B.
