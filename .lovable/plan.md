## Goal

In the player's world map dialog, any node the player has already discovered that hosts a **boss** creature gets a skull marker, with the boss name and level on hover. Rare and regular creatures are not marked.

## Behaviour

- Marker appears only on **visited** nodes (same discovery rule as the nodes themselves) — never on ghost/unvisited nodes.
- Static marker: it does not change if the boss is currently slain and awaiting respawn.
- Hover tooltip on the node gains a line like `💀 Vanguard of the Nightfall (Lv 24)`. If a node hosts more than one boss, each gets its own line.
- Visual: a small skull glyph offset above-right of the node dot, drawn above the node circle so it stays readable at any zoom.

## Technical detail

Single file: `src/features/world/components/PlayerWorldMapDialog.tsx`.

1. Alongside the existing creature-levels fetch (which selects `node_id, level` where `is_alive = true`), add a second lightweight query on open: `creatures` → `node_id, name, level` where `rarity = 'boss'`, **without** the `is_alive` filter, so a temporarily dead boss still shows. Store as `Map<nodeId, {name, level}[]>`.
2. In the `visibleNodes` render loop, when the boss map has an entry for `node.id`, render a `<text>` skull glyph near the node dot.
3. In `buildNodeTooltip`, push one `💀 Name (Lv N)` line per boss before the existing creature-level range line.

No database, RLS, or backend changes — `creatures` is already readable by the client and already queried by this dialog.
