# Dynamic Chat Column — Fills Space Right of Game Panels

Make the chat/online column extend from the right edge of the fixed game-panel area all the way to the browser edge, with no drag handle. If the available space is below the readable threshold (320px), collapse to the small chat-icon button (current behaviour) which slides the column out on click.

## UX

- The three game panels (Character / Center / Map) stay at their current widths and remain centered up to a fixed cap (the existing 1920px `max-w` of the inner row).
- The chat column lives **outside** that capped row, anchored to the right side of the viewport, taking all remaining horizontal space between the game-panel area's right edge and the window edge.
- Minimum readable chat width: **320px**.
  - If remaining space ≥ 320px → chat column is shown, filling that space (no upper cap; on ultra-wide it gets wider, which is fine for the Online tab).
  - If remaining space < 320px → chat column auto-collapses. The thin reopen strip (with the online-count badge) is shown instead, exactly as today's collapsed state. Clicking it opens chat as a floating overlay anchored to the right edge at 320px, dimming/over-laying the rightmost part of the map panel, until the user closes it again.
- The existing manual collapse toggle (the X / MessageCircle button in the chat header) still works and is persisted in `localStorage` (`chatPanelOpen`).
- `chatPanelWidth` and the drag handle are removed — width is purely derived from layout.

## Files

- `src/pages/GamePage.tsx`
  - Restructure the outermost game container:
    - Outer wrapper becomes full-width (`w-full`), no `max-w-[1920px]`.
    - Inside it, a horizontal flex row with two children:
      1. **Game area** (`flex-1` + `max-w-[1920px]` + `mx-auto` for centering when there's slack): contains CharacterPanel / Center / MapPanel exactly as today.
      2. **Chat slot** (`shrink-0`): width driven by a `ResizeObserver` on the window / outer wrapper.
  - Replace `chatPanelWidth` state and drag handle with:
    - `availableChatWidth` derived from `window.innerWidth - <game-area-rendered-width>` via a `ResizeObserver` attached to the game-area ref.
    - `canFitChat = availableChatWidth >= 320`.
  - Rendering rules (desktop, `!isTablet`):
    - `chatPanelOpen && canFitChat` → render chat inline at width `availableChatWidth`.
    - `chatPanelOpen && !canFitChat` → render chat as a fixed-position overlay (`fixed right-0 top-<header> bottom-0 w-[320px] z-40` with `ornate-border` + backdrop shadow). User can still close via the header button.
    - `!chatPanelOpen` → render the thin reopen strip with the online-count badge (current behaviour).
  - Remove all `chatPanelWidth` localStorage logic.

- `src/features/chat/components/ChatPanel.tsx`
  - No structural changes. Already `w-full` and content scrolls. Keep it as-is.

- `.lovable/plan.md`
  - Replace the previous resizable-panel plan with this one.

## Technical notes

- The ResizeObserver watches the game-area `div` (not the window) so the calculation also reacts to character/map panels being toggled.
- Use `useLayoutEffect` to read width synchronously after mount, so initial render doesn't flash a wrong state.
- The capped game-area row keeps `mx-auto`: on screens narrower than 1920px the game area touches the left edge and the chat column gets whatever's on the right; on screens wider than 1920+320, the chat is wider than 320; below that threshold the overlay fallback kicks in.
- No backend, presence, or formatting changes.

## Out of scope

- Manual resize handle (removed).
- Whisper-from-list shortcut, member sorting/filters, mobile chat redesign.
