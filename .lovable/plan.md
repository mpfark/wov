
# Keyboard Movement Bindings

## Overview

Add keyboard shortcuts so players can move between nodes by pressing direction keys. The current node's connections already have compass directions (N, S, E, W, NE, NW, SE, SW), so we can map keyboard keys to those directions and trigger movement automatically.

## Default Key Bindings

| Key | Direction |
|-----|-----------|
| W / ArrowUp | North |
| S / ArrowDown | South |
| D / ArrowRight | East |
| A / ArrowLeft | West |
| (no default) | NE, NW, SE, SW |

Diagonal directions won't have default bindings but can be assigned by the player.

## How It Works

1. A `useKeyboardMovement` custom hook listens for `keydown` events on the document
2. When a mapped key is pressed, it finds the current node's visible connection matching that direction
3. If a connection exists, it calls `handleMove(connectionNodeId)` automatically
4. Keys are ignored when the player is typing in an input/textarea, when a dialog is open, or when the character is dead

## Keybinding Settings

- A small keyboard icon button on the map panel header opens a compact keybinding editor
- Players can click a direction slot and press any key to rebind it
- Bindings are saved to `localStorage` so they persist between sessions
- A "Reset to Defaults" button restores WASD + Arrow Keys

## Files to Create/Modify

### New: `src/hooks/useKeyboardMovement.ts`
- Custom hook that accepts the current node, nodes list, and move handler
- Reads keybindings from localStorage (with defaults)
- Attaches/detaches keydown listener
- Skips input when focus is on form elements or character is dead
- Exports a function to get/set bindings for the settings UI

### Modified: `src/pages/GamePage.tsx`
- Import and call `useKeyboardMovement(currentNode, nodes, handleMove, isDead)`
- Pass visible (non-hidden) connections to the hook

### Modified: `src/components/game/MapPanel.tsx`
- Add a small keybinding settings button (keyboard icon) near the "Local Area" header
- Inline keybinding editor: shows each direction with its current key, click to rebind

## Technical Details

```text
Hook signature:
  useKeyboardMovement({
    currentNode: GameNode | undefined,
    nodes: GameNode[],
    onMove: (nodeId: string) => void,
    disabled: boolean
  })

Default bindings stored as:
  { N: ['w','ArrowUp'], S: ['s','ArrowDown'], E: ['d','ArrowRight'], W: ['a','ArrowLeft'],
    NE: [], NW: [], SE: [], SW: [] }

localStorage key: 'movement-keybindings'

Key listener logic:
  1. Skip if activeElement is input/textarea/select
  2. Skip if any dialog/modal is open (check for [role="dialog"])
  3. Look up pressed key in bindings map
  4. Find matching direction in currentNode.connections (non-hidden only)
  5. Call onMove(connection.node_id)
  6. preventDefault to avoid scrolling on arrow keys
```
