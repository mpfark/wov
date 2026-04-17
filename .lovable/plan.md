

# Locked Connection Hints

## Overview
Add an optional `lock_hint` description to locked connections so players can discover where to look for the key when they search the node. Hints are revealed by the existing `search` command (no DB schema change — `connections` is a JSONB array, we just add a new optional field).

## Changes

### 1. Type update — `src/features/world/hooks/useNodes.ts`
Extend the connection shape:
```ts
connections: Array<{
  node_id: string; direction: string; label?: string;
  hidden?: boolean; locked?: boolean; lock_key?: string;
  lock_hint?: string;  // NEW
}>;
```

### 2. Admin editor — `src/components/admin/NodeEditorPanel.tsx`
For both Add and Edit connection forms, when `locked` is checked, show a second field directly under the Lock Key input:
- `Textarea` (rows=2) bound to `addLockHint` / `editLockHint` state
- Placeholder: `"Hint shown when players search (e.g. 'The gate seems sturdy. Perhaps the innkeeper holds the key.')"`
- Persist as `lock_hint` in the connection object (only included if non-empty, mirroring the existing `lock_key` pattern)
- Show a small 💡 indicator in the connection row when a hint is set

### 3. Search reveal — `src/features/world/hooks/useMovementActions.ts` `handleSearch`
After the existing hidden-path / loot resolution, add a final reveal step for locked connections with hints:
- Collect `currentNode.connections.filter(c => c.locked && c.lock_hint)`
- If the search roll `total >= 10` and any locked-with-hint exits exist, append one log line per locked exit:
  - `🗝️ ${direction}: ${lock_hint}`
- This runs **in addition to** the existing outcome (so a successful search that finds nothing material still surfaces hints, making search feel rewarding near locked exits)
- Skip if the player already holds the matching `lock_key` (no need to hint)

### 4. Keyword search (`search gate`) — Phase-1 scope decision
The parser currently treats `search` as single-word only. Extending it to accept a keyword (`search gate`) would require:
- Updating `commandParser.ts` to accept an optional `target` arg on `search`
- Filtering hints by matching the keyword against the connection's `direction`, `label`, or `lock_key` (case-insensitive substring)

**Recommendation**: include this in the same change. It's a small parser tweak and matches the pattern already used for `attack <target>` / `loot <target>`. When `search <keyword>` is used and matches a locked exit, only that exit's hint is shown (and we can lower the DC slightly, e.g. `total >= 8`, since the player is being specific). Unmatched keyword falls back to a generic search.

### 5. Parser — `src/features/chat/utils/commandParser.ts`
Change the `search` branch to accept an optional target (up to 3 words total), mirroring `loot`:
```ts
type ParsedCommand = ... | { type: 'search'; target?: string };
```

### 6. Wire keyword through — `src/pages/GamePage.tsx`
`handleSearch` currently takes no args. Add an optional `keyword?: string` param to `handleSearch` and pass `cmd.target` from the command dispatcher.

## What stays unchanged
- DB schema (connections JSONB already flexible)
- Lock enforcement, key-consumption behavior, 30s unlock window
- Click-driven Search button (calls `handleSearch()` with no keyword — same behavior as before)
- All other commands and chat fallthrough

## Files touched
- `src/features/world/hooks/useNodes.ts` (type)
- `src/components/admin/NodeEditorPanel.tsx` (admin UI)
- `src/features/world/hooks/useMovementActions.ts` (search reveal + optional keyword filter)
- `src/features/chat/utils/commandParser.ts` (allow `search <keyword>`)
- `src/pages/GamePage.tsx` (pass keyword to handleSearch)

