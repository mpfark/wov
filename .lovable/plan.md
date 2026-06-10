# Integrate Online Players into a Resizable Chat Panel

The right-side chat column will host both **Chat** and **Online** as tabs, and become user-resizable so the player can decide how much horizontal space it eats.

## UX

- One right-side column with a tab header: `Chat` and `Online (N)`.
  - **Chat** tab: existing message list.
  - **Online** tab: compact, scrollable list of online adventurers (title, name, race, class, level), "you" highlighted, king-slayer styling preserved. Same data as today's popup.
- Column is **resizable** via a draggable vertical handle between the main game area and the chat column.
  - Default width: ~320px.
  - Min: ~280px (keeps tabs and list readable).
  - Max: ~560px (don't let it eat the world view).
  - Persist chosen width in `localStorage` (`chatPanelWidth`).
- Existing collapse/expand toggle stays. When collapsed, the thin reopen strip shows a small "N" badge so online count is still visible.
- Tab choice persisted in `localStorage` (`chatPanelTab`); default `Chat`.
- The "X Online" button in the MapPanel header is removed (no longer needed).
- Tablet and mobile layouts unchanged (chat column is desktop-only today).

## Files

- `src/features/chat/components/ChatPanel.tsx`
  - Add props: `onlinePlayers`, `myCharacterId`.
  - Add shadcn `Tabs` header (`Chat` / `Online (N)`), persist active tab.
  - Render online list inline (reuse `formatCharacterName`, `getCharacterTitle`, race/class label maps from `OnlinePlayersDialog`).
  - Remove the fixed `w-[320px]`; let the parent control width via the resizable panel.

- `src/pages/GamePage.tsx`
  - Wrap the main game area + chat column in `ResizablePanelGroup` (horizontal) using `@/components/ui/resizable`, only when `isWideScreen && !isTablet && chatPanelOpen`.
    - Left panel: existing main content, `defaultSize` derived from remaining space.
    - `ResizableHandle withHandle`.
    - Right panel: `ChatPanel`, `defaultSize` from `localStorage` (fallback 320px → percentage), `minSize`/`maxSize` mapped from 280/560px.
  - On `onLayout`, persist the right panel size to `localStorage`.
  - When chat is collapsed, keep current single-row layout (no panel group) and add the online-count badge to the reopen button.
  - Pass `onlinePlayers` and `myCharacterId` into `<ChatPanel>`.

- `src/features/world/components/MapPanel.tsx`
  - Remove the `OnlinePlayersDialog` import and the header trigger at line ~299. Keep `summonOnlinePlayers` flowing to the summon panel untouched.

- `src/components/game/OnlinePlayersDialog.tsx`
  - Delete (no remaining references after MapPanel change).

## Technical notes

- `ResizablePanelGroup` works in percentages. Convert the saved px width to a percentage of the current container width at mount, and clamp to min/max. Re-clamp on window resize via the panel group's built-in behavior.
- Keep `min-w-0` on the left panel so the game area can shrink correctly when the chat column grows.
- No backend, presence, or formatting changes.

## Out of scope

- Whisper-from-list shortcut, member sorting/filters, mobile chat redesign.
