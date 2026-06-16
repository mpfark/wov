## Goal
Let players resize Event Log text independently of the rest of the UI, so they can make it more readable without zooming the whole browser.

## Scope
Frontend-only, isolated to the Event Log panel. No backend, no global theme changes.

## Approach
Add a small text-size toggle next to the existing `F / F+N` button in `EventLogPanel.tsx`.

- Three sizes: **S** (current `text-xs`), **M** (`text-sm`), **L** (`text-base`).
- Default: **S** (preserves today's look).
- Persisted in `localStorage` under a key like `eventLog.fontSize` so the choice sticks per browser.
- A new `Aa` button cycles S → M → L → S, mirroring the styling of the existing mode button. Tooltip shows the current size.
- The selected Tailwind size class is applied to the scroll container so it cascades to all log lines, the empty-state line, icons, and numbers (they all inherit `em`-relative sizing).

## Files touched
- `src/features/combat/components/EventLogPanel.tsx` — add state, persistence helpers, cycle button, apply size class to the log container.

## Out of scope
- No change to the header label, ability bar, status bars, or any other panel.
- No free-form slider, no per-line styling changes, no settings menu entry (kept inline next to F/F+N for discoverability and to match existing pattern).

## Verification
Open the game, click the new `Aa` button in the Event Log header, confirm text grows/shrinks across the three steps, reload the page and confirm the choice persists.
