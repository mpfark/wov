

## Collapsible Wide-Screen Chat Panel

### Problem
On laptops near the 1600px breakpoint, the chat panel appears but takes up valuable screen space. Users should be able to collapse it and bring it back via a toggle button.

### Changes

**`src/pages/GamePage.tsx`**

1. **Add state**: `const [chatPanelOpen, setChatPanelOpen] = useState(true)` — defaults to open when wide screen is active.

2. **Toggle button**: When `isWideScreen && !isTablet`, render a small toggle button on the right edge of the main content area (or left edge of the chat panel). Use a `MessageCircle` icon similar to the admin chat widget, positioned as a fixed/absolute button at the right side.

3. **Conditional render**: Change the chat panel condition from `{isWideScreen && !isTablet && (` to `{isWideScreen && !isTablet && chatPanelOpen && (`. When collapsed, chat messages flow back into the event log (reuse the existing `filteredEventLog` logic by factoring in `chatPanelOpen`).

4. **When collapsed**: Show a small floating button (right edge, vertically centered) with `MessageCircle` icon to re-open. Style it like the admin chat widget's bubble button.

5. **Filter logic update**: Change `filteredEventLog` to only filter out chat when `isWideScreen && chatPanelOpen`, so collapsing the panel restores chat to the event log.

6. **Persist preference** (optional): Store in `localStorage` so it remembers across sessions.

