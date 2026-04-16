

# MUD-Style Text Command System — Implementation Plan

## Overview
Create a command parser utility and wire it into the existing `handleChatSubmit` in GamePage. Add command history (ArrowUp/Down with draft preservation) to CommandInputBar. Four refinements from the user's feedback are incorporated.

## Files

### 1. Create `src/features/chat/utils/commandParser.ts`
Pure function `parseCommand(input: string) → ParsedCommand | null`:
- **Movement**: single-word only — `n`, `north`, `s`, `south`, `e`, `east`, `w`, `west`, `ne`, `nw`, `se`, `sw` + full names
- **Attack**: `attack`, `kill`, `k` — optional target arg (stored but not matched in phase 1)
- **Search**: `search` — single word only
- **Loot**: `loot`, `pickup`, `get` — optional `all` or target arg (stored but not matched in phase 1)
- **Look**: `look`, `l` — single word only
- **Summon**: `summon <name>` — requires at least one arg
- Returns `null` for anything that doesn't clearly match → falls through to chat
- Conservative matching: multi-word input starting with non-command words is always chat

### 2. Modify `src/pages/GamePage.tsx` — wire parser into `handleChatSubmit`
Insert command dispatch after whisper check, before `sendSay`:

```
const cmd = parseCommand(text);
if (cmd) {
  switch (cmd.type):
    'move'   → find connection matching direction on currentNode
               if found: handleMove(targetNodeId, direction)
               else: addLocalLog("You can't go that way.")
    'attack' → if no alive creatures: addLocalLog("Nothing to attack here.")
               else: handleAttackFirst()
               (target arg logged but not resolved to creature by name in phase 1)
    'search' → handleSearch()
    'loot'   → if groundLoot empty: addLocalLog("No loot to pick up.")
               else: handlePickUpFirst()
               (target arg not matched in phase 1)
    'look'   → use getNodeDisplayName + getNodeDisplayDescription to log
               current node name and description via addLocalLog
               (reuses existing helpers from useNodes — no duplication)
    'summon' → call existing summon handler if available, or set summon
               target name into state and show feedback:
               "🌀 Summon target set to <name>. Use the Summon panel to confirm."
  return; // skip chat
}
```

**Summon refinement**: GamePage already renders `SummonPlayerPanel`. We'll expose a `setSummonTarget` callback or simply log actionable feedback so the command doesn't feel like a dead-end.

**Look refinement**: Reuses `getNodeDisplayName` and `getNodeDisplayDescription` from `@/features/world` — same helpers NodeView uses. No duplicated formatting.

**Named targeting honesty**: Parser stores target args but phase-1 dispatch calls `handleAttackFirst()` / `handlePickUpFirst()` without name matching. No misleading feedback — if a target arg is provided, log it transparently: `"⚔️ You attack the nearest creature."` (not `"You attack wolf"`).

### 3. Modify `src/features/chat/components/CommandInputBar.tsx` — add command history
- Add local `useState<string[]>` for history (capped at 20)
- Add `useRef` for `historyIndex` and `draftBeforeHistory`
- **ArrowUp**: save current input as draft (if at bottom), navigate backward
- **ArrowDown**: navigate forward; past newest entry → restore saved draft
- On submit: push to history, reset index and draft
- Session-only, not persisted

### 4. Update `src/features/chat/index.ts` barrel export
Add `parseCommand` export.

## What stays unchanged
- All click actions, keyboard shortcuts, combat logic, backend
- CommandInputBar position and styling
- Chat whisper system (`/w name message`)
- `sendSay` fallthrough for non-command text

## Implementation order
1. `commandParser.ts` — pure utility with types
2. `CommandInputBar.tsx` — add history with draft preservation
3. `GamePage.tsx` — wire parser into `handleChatSubmit`, add look/summon feedback
4. Update barrel export

