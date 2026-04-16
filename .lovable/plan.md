

# Relocate Chat/Command Input to Center Panel

## Overview
Move the chat input from the right-side ChatPanel and the conditional inline input in EventLogPanel into a new dedicated `CommandInputBar` component, permanently anchored below the event log in the center panel. ChatPanel becomes display-only.

## Changes

### 1. Create `src/features/chat/components/CommandInputBar.tsx`
New reusable component wrapping the existing `<Input>` with:
- Same `onKeyDown` logic (Enter → submit, Escape → blur/clear)
- Placeholder: `"Type a command or message... (/w name to whisper)"`
- Desktop: rendered inline below EventLogPanel in the center column
- Mobile/tablet: fixed to bottom of viewport via `fixed bottom-0 left-0 right-0 z-40` with padding for safe area

Props: `chatInput`, `onChatInputChange`, `onChatSubmit`, `chatInputRef`

### 2. Modify `EventLogPanel.tsx`
- Remove the conditional `(!isWideScreen && chatOpen)` input block (lines 82-97)
- Remove `chatOpen`, `isWideScreen`, `chatInput`, `onChatInputChange`, `onChatSubmit`, `onChatClose`, `chatInputRef` from props
- Component becomes purely a log display + display mode toggle

### 3. Modify `ChatPanel.tsx`
- Remove the `<Input>` block at the bottom (lines 45-57)
- Remove `chatInput`, `onChatInputChange`, `onChatSubmit`, `chatInputRef` from props
- Keep: messages list, close button, header — display-only panel

### 4. Modify `GamePage.tsx`
- Import `CommandInputBar`
- Place `<CommandInputBar>` after `<EventLogPanel>` inside the center column div (line ~999), so it's always visible below the event log
- On mobile (`isMobile`), render it with fixed-bottom positioning instead
- Remove chat-related props from `EventLogPanel` usage
- Remove chat-related props from `ChatPanel` usage
- Remove the `chatOpen` state and `handleOpenChat` — input is always visible
- Update `handleChatSubmit`: remove `setChatOpen(false)` calls since there's no open/close toggle
- Keep `chatInputRef` for keyboard shortcut focus (Enter key in `useKeyboardMovement`)

### 5. Update `useKeyboardMovement` integration
- The existing `onOpenChat` callback focuses `chatInputRef` — keep this working but simplify since input is always rendered (just call `.focus()`)

## Not Changed
- All chat/whisper logic, `handleChatSubmit`, `sendSay`, `sendWhisper` — unchanged
- Backend, database, Supabase — unchanged
- ChatPanel toggle button and localStorage persistence for wide-screen — unchanged
- Command parser (future feature) — not part of this change

