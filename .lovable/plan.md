## Goal

Split the current combined right-side panel into two independent gutter panels:
- **Right gutter** → Chat only (as today, minus the Online tab)
- **Left gutter** → Online Players only (new), mirroring the chat panel's behavior

## Changes

### 1. New `OnlinePanel` component
`src/features/chat/components/OnlinePanel.tsx` — anchored to the left viewport gutter. Same structural shell as `ChatPanel`:
- Header bar with a title ("Online N") and a collapse button (uses a Users icon).
- Body = the existing online-players list (extracted from `ChatPanel`).
- Collapses to a thin left-edge icon strip with the online count badge.

### 2. Simplify `ChatPanel`
`src/features/chat/components/ChatPanel.tsx`:
- Remove the Tabs + Online tab + `onlinePlayers` / `myCharacterId` props.
- Keep the header (title "Chat" + collapse button) and the messages list only.
- Remove `chatPanelTab` localStorage key.

### 3. Wire the new panel in `GamePage.tsx`
`src/pages/GamePage.tsx` (around lines 94–117 and 1239–1282):
- Add an `onlinePanelOpen` state, persisted in localStorage as `onlinePanelOpen` (default open).
- Mirror the existing right-gutter logic for the left side:
  - When the left gutter is wide enough (`gutterWidth >= 320`) → render `OnlinePanel` absolutely positioned on the left (`left-0`, width = `gutterWidth`).
  - Otherwise, fixed 320px overlay on the left edge.
  - When collapsed → thin left-edge icon button (mirror of the right-edge chat button), showing the online-count badge.
- Remove `onlinePlayers` / `myCharacterId` from the `ChatPanel` render.
- Both panels share the same `gutterWidth` / `canFit` calculation (the gutter math is symmetric, so no change to the existing resize effect is required).

### 4. Behavior
- Independent open/closed state — collapsing chat does not affect the online panel, and vice versa.
- On screens where the right side falls back to the overlay (`!canFitChat`), the left online panel uses the same overlay fallback.
- No changes to tablet/mobile flow (≤1024px still uses the existing sheet behavior; left panel is desktop-only just like chat).

## Out of scope

- No changes to presence data, styling tokens, or the event log layout.
- No changes to the center-column flex ratios.
