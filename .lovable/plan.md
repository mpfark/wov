

# AI Rulebook Tab for World Builder

## Overview
Add a "Rulebook" mode/tab to the World Builder panel that displays a formatted, read-only reference of all the rules the AI follows when generating content. This gives admins transparency into how the AI thinks without needing to read edge function code.

## What It Shows
The rulebook will be organized into clear sections:

- **General Rules** -- naming conventions, ASCII-only names, no copyrighted content, directional codes (N/S/E/W)
- **Region Rules** -- must have at least one inn, level range requirements
- **Node Rules** -- naming standards, connection rules, bidirectional links, expansion syntax
- **Creature Rules** -- 2-4 per node, stat ranges (5-30), HP/AC formulas by rarity, aggressive/passive mix, humanoid flagging
- **NPC Rules** -- 1-2 per service node (inn/vendor/blacksmith), lore-appropriate dialogue
- **Item Rules** -- only for humanoids, 1-2 max per creature, stat budget formula, rarity multipliers, valid slots, durability ranges, gold value formula, no unique items generated
- **Populate Mode Rules** -- no new nodes/NPCs, real node IDs, level matching
- **Expand Mode Rules** -- connect to existing nodes via `existing:<id>`, no duplicate names

## UI Placement
Add a "Rulebook" button before the existing New Region / Expand / Populate mode buttons. When selected, the generation input and preview area are replaced with a scrollable, styled reference document using existing Card and ScrollArea components.

## Technical Details

### File: `src/components/admin/WorldBuilderPanel.tsx`
- Add `'rulebook'` to the `Mode` type
- Add a `Book` icon button (from lucide-react) as the first option in the mode toggle row
- When `mode === 'rulebook'`, render a `ScrollArea` with formatted rulebook content instead of the prompt/preview area
- The rulebook content is static JSX -- no database calls needed
- All rule values (formulas, multipliers, slot lists) match exactly what the edge function system prompt uses

### No other files need changes
The edge function and preview graph remain untouched. This is a purely frontend, read-only reference panel.

