

# GamePage.tsx File-Trimming Pass

## Current State

GamePage.tsx is **1,450 lines**. Key bloat sources:

1. **`getLogColor`** (50 lines) — combat log styling logic living at page level
2. **Stat allocation callbacks** (`onAllocateStat`, `onFullRespec`, `onBatchAllocateStats`) — ~100 lines of character math, **copy-pasted identically** for tablet and desktop CharacterPanel renders
3. **CharacterPanel props** — the entire prop block (~75 lines) is **duplicated** for tablet sheet vs desktop sidebar
4. **MapPanel props** — the entire prop block (~55 lines) is **duplicated** for mobile sheet vs desktop sidebar
5. **`activeBuffs` object** — computed inline identically in both MapPanel instances
6. **Event log rendering** — the log panel JSX block with scroll, filtering, chat input

## Extraction Plan

### 1. `getLogColor` → `src/features/combat/utils/combat-log-utils.ts`
**Owns:** log string → CSS class mapping

Move the `logColorCache` + `getLogColor` function. Pure utility, zero dependencies on React or component state.

### 2. Stat allocation logic → `src/features/character/hooks/useStatAllocation.ts`
**Owns:** stat point allocation, full respec, batch allocation

Extract a hook that takes `{ character, updateCharacter, addLog }` and returns `{ handleAllocateStat, handleFullRespec, handleBatchAllocateStats }`. Eliminates ~200 lines of duplication (100 lines × 2 copies).

### 3. De-duplicate CharacterPanel render → local `charPanelProps` variable
**Owns:** nothing new — just a `const charPanelProps = { ... }` computed once

Both tablet and desktop branches render `<CharacterPanel {...charPanelProps} />`. The `onDrop` callback also gets extracted inline. Saves ~75 duplicated lines.

### 4. De-duplicate MapPanel render → local `mapPanelProps` variable
**Owns:** same pattern

Both mobile and desktop branches render `<MapPanel {...mapPanelProps} />`. The `activeBuffs` object is computed once via `useMemo`. Saves ~55 duplicated lines.

### 5. Event log panel → `src/features/combat/components/EventLogPanel.tsx`
**Owns:** log list rendering, scroll-to-bottom, inline chat input

A small presentation component receiving `{ logs, chatOpen, chatInput, onChatInputChange, onChatSubmit, onChatClose, chatInputRef, getLogColor }`. Extracts ~30 lines of JSX.

### 6. Wide-screen chat panel → `src/features/chat/components/ChatPanel.tsx`
**Owns:** chat message list, chat input for wide-screen mode

Receives `{ messages, chatInput, onChatInputChange, onChatSubmit, chatInputRef, onClose, getLogColor }`. Extracts ~40 lines of JSX.

## Files

| File | Action | Owns |
|------|--------|------|
| `src/features/combat/utils/combat-log-utils.ts` | Create | Log string → CSS class mapping |
| `src/features/character/hooks/useStatAllocation.ts` | Create | Stat allocation / respec math |
| `src/features/combat/components/EventLogPanel.tsx` | Create | Event log list rendering |
| `src/features/chat/components/ChatPanel.tsx` | Create | Wide-screen chat panel rendering |
| `src/pages/GamePage.tsx` | Modify | Import new pieces, de-dup prop blocks, remove inlined logic |

## Estimated Reduction

~400-450 lines removed from GamePage.tsx (from ~1,450 to ~1,000-1,050), with the remaining file being primarily hook wiring, layout composition, and prop preparation.

## What Does NOT Change

- Combat logic, tick rates, prediction model
- Party authority model
- Any hook behavior or state ownership
- Database schema, edge functions
- Visual appearance or gameplay behavior

