

# AI World Builder Assistant

## Overview
Add an "AI World Builder" tab to the Admin panel that lets you generate Middle-earth regions, nodes, creatures, NPCs, and (later) quests using AI. The assistant understands your existing world structure and generates content that fits seamlessly -- proper connections, level gating, lore-accurate descriptions, and balanced encounters.

## How It Works

1. You open the **World Builder** tab in the Admin panel
2. You type a prompt like *"Create the Rivendell region for levels 15-25 with 6 nodes including Elrond's House as an inn"*
3. The AI generates a structured plan: region, nodes, connections, creatures, and NPCs
4. You review the generated content in a preview panel
5. Click **Apply** to insert everything into the database, or edit individual items before saving

## Architecture

### Backend: Edge Function (`ai-world-builder`)
- Uses Lovable AI (Gemini Flash) to generate world content
- System prompt includes:
  - Middle-earth lore guidelines and naming conventions
  - Your current world structure (regions, node names, level ranges) for context
  - Output schema using tool calling for structured JSON (regions, nodes, creatures, NPCs)
  - Rules: proper directional connections, level-appropriate creatures, balanced vendor/inn/blacksmith placement
- Accepts a user prompt + current world summary
- Returns structured data ready for database insertion

### Frontend: Admin Panel Tab
- New **"World Builder"** tab alongside existing tabs (World, Creatures, NPCs, etc.)
- Chat-style interface where you describe what to generate
- Preview panel showing generated content organized by type (Region, Nodes, Creatures, NPCs)
- Edit capability on each generated item before applying
- "Apply All" button that batch-inserts into the database with proper bidirectional connections

## What Gets Generated

| Content Type | Fields | Example |
|---|---|---|
| Region | name, description, min/max level | Rivendell, Lvl 15-25 |
| Nodes | name, description, connections, flags (inn/vendor/blacksmith) | Elrond's House (inn), The Ford of Bruinen |
| Creatures | name, level, hp, stats, rarity, aggressive flag, loot table | Cave Troll (boss, lvl 22) |
| NPCs | name, description, dialogue | Elrond, Glorfindel |

## Future Expansion
The same assistant architecture supports generating quests once a quest system is built -- the edge function just needs an additional tool/schema for quest output.

## Technical Details

### Files to Create
- `supabase/functions/ai-world-builder/index.ts` -- Edge function with Lovable AI integration, structured output via tool calling
- `src/components/admin/WorldBuilderPanel.tsx` -- Chat UI + generated content preview with edit/apply workflow

### Files to Modify
- `src/pages/AdminPage.tsx` -- Add "World Builder" tab
- `supabase/config.toml` -- Register the new edge function

### Database
No schema changes needed -- all generated content uses existing `regions`, `nodes`, `creatures`, and `npcs` tables.

### AI Integration
- Model: `google/gemini-3-flash-preview` (fast, good structured output)
- Uses tool calling to extract structured JSON (no fragile JSON parsing)
- System prompt includes current world state fetched at request time
- Handles bidirectional connection generation automatically

