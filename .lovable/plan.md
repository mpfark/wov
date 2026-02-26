

# Chat System: Say & Whisper

Add an in-game chat system integrated into the event log, using Supabase Realtime Broadcast (no database tables needed for ephemeral messages).

## How It Works

- **Say** (`/say <message>` or just type without a prefix): Message is broadcast to all players at the same node via the existing presence channel. Appears in everyone's event log at that node.
- **Whisper** (`/w <player_name> <message>` or `/whisper <player_name> <message>`): Private message sent directly to a specific player via a dedicated per-character broadcast channel. Only sender and recipient see it.
- **Enter key** opens/closes a chat input bar docked at the bottom of the event log area.

## User Experience

1. Player presses **Enter** -- a text input appears at the bottom of the event log
2. Player types a message and presses **Enter** to send, or **Escape** to cancel
3. Messages appear in the event log with distinct styling:
   - Say: `💬 [PlayerName]: message` -- styled in a soft white/foreground color
   - Whisper received: `🤫 [PlayerName] whispers: message` -- styled in a purple/magenta tone
   - Whisper sent: `🤫 To [PlayerName]: message` -- styled in a dimmer purple tone
4. While the chat input is focused, keyboard movement/actions are naturally disabled (existing `input`/`textarea` guard in `useKeyboardMovement.ts` handles this)

## Technical Plan

### 1. Create a `useChat` hook (`src/hooks/useChat.ts`)
- Subscribe to a **node-scoped broadcast channel** (`chat-node-{nodeId}`) for "say" messages
- Subscribe to a **character-scoped broadcast channel** (`chat-whisper-{characterId}`) for incoming whispers
- To send a whisper, broadcast on `chat-whisper-{targetCharacterId}`
- Expose: `sendSay(message)`, `sendWhisper(targetName, message)`, `chatMessages[]`
- Each message has: `type` (say/whisper), `senderName`, `text`, `timestamp`
- Re-subscribe to node channel when `nodeId` changes (same pattern as presence)
- Use global presence data to resolve player names to character IDs for whisper targeting

### 2. Integrate chat into GamePage (`src/pages/GamePage.tsx`)
- Add the `useChat` hook
- Add a `chatOpen` state toggled by Enter key (via a new keydown listener)
- Render a text input at the bottom of the event log area when `chatOpen` is true
- Parse input: if starts with `/w ` or `/whisper `, treat as whisper; otherwise treat as say
- Push chat messages into the `eventLog` array so they appear inline with combat/game events
- Pass `onlinePlayers` list to `useChat` for name-to-ID resolution

### 3. Add chat message styling (`src/pages/GamePage.tsx` - `getLogColor`)
- Add color rules for `💬` (say) and `🤫` (whisper) prefixed messages

### 4. Update keyboard handler (`src/hooks/useKeyboardMovement.ts`)
- Add `Enter` key to open chat (callback prop `onOpenChat`)
- The existing input-tag guard prevents conflicts while typing

### 5. Update Game Manual
- Add a brief "Chat" section documenting `/say`, `/whisper`, and the Enter key shortcut

## Files to Create/Modify

| File | Action |
|------|--------|
| `src/hooks/useChat.ts` | **Create** -- broadcast-based chat hook |
| `src/pages/GamePage.tsx` | **Edit** -- integrate chat hook, add input UI, add log colors |
| `src/hooks/useKeyboardMovement.ts` | **Edit** -- add Enter key → onOpenChat callback |
| `src/components/admin/GameManual.tsx` | **Edit** -- document chat commands |

No database changes needed -- all chat is ephemeral via Supabase Broadcast channels.

