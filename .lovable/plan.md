

# Middle-earth: Node-Based RPG — MVP Plan

## Overview
A browser-based, real-time multiplayer RPG set in Tolkien's Middle-earth. Players navigate a text-based node world, create D&D-inspired characters, and fight creatures — all backed by Supabase with real-time features.

## Visual Theme
Dark fantasy parchment aesthetic — aged paper textures, ornate borders, warm amber/sepia tones, medieval-style fonts. Think a living Tolkien manuscript.

---

## Phase 1: Foundation

### 1. Authentication & Character Creation
- Login/signup via Supabase Auth
- Character creation flow: choose Name, Race (Human, Elf, Dwarf, Hobbit, etc.), and Class (Warrior, Wizard, Ranger, etc.)
- D&D-style stat generation (STR, DEX, CON, INT, WIS, CHA) based on race/class
- Characters start at Level 1 with basic starter equipment

### 2. Role System
- Three roles: Player, Maiar (Moderator), Valar (Super-Admin)
- Roles stored in a secure `user_roles` table with RLS
- Valar can promote/demote users; Maiar can manage content

### 3. Database Schema (Core Tables)
- Characters (stats, level, XP, HP, race, class, current_node)
- Regions (name, level_range, description)
- Nodes (parent_region, description, connections to other nodes, searchable items)
- Creatures (name, stats, region, node, rarity, loot table, respawn timer)
- Items (name, type, slot, stats, rarity, durability)
- Character inventory (character_id, item_id, equipped slot, durability)

---

## Phase 2: World Navigation

### 4. Three-Column UI Layout
- **Left Panel**: Character sheet showing stats, level, HP, equipment slots (9 slots), inventory list, and quest log
- **Center Panel**: Current node view — location name, parchment-styled description, visible creatures/players, directional navigation buttons (N/S/E/W or named exits), and an Event Log showing combat rolls and world events
- **Right Panel**: World map (Layer 1) as a simple clickable node graph showing regions, and a local area map (Layer 2) showing connected child nodes within the current region

### 5. Node System
- Layer 1: Region-level navigation (The Shire → Bree → Rivendell, etc.)
- Layer 2: Each region contains child nodes (town square, inn, vendor, forest path, etc.)
- Directional travel buttons to move between connected nodes
- Node search action to discover hidden items
- Level-gated regions (can't enter Mordor at Level 5)

### 6. Real-Time Presence
- See other players in your current node via Supabase Realtime
- Player list updates live as people enter/leave nodes

---

## Phase 3: Combat

### 7. Combat System
- D&D-style dice rolling (1d20 + modifiers) for attack/defense
- Aggressive creatures auto-attack when player enters a node
- Turn-based combat with attack, defend, use item, and retreat options
- Retreat triggers an Attack of Opportunity roll from the creature
- Combat math displayed in the Event Log (e.g., "You rolled 14 + 3 STR = 17 vs. Orc AC 15 — Hit! 8 damage")

### 8. HP & Recovery
- HP regenerates slowly over time
- Food and potions provide faster HP recovery
- Creatures also regenerate HP over time when not in combat

---

## Phase 4: Economy & Loot

### 9. Item & Equipment System
- 9 equipment slots: Head, Amulet, Shoulders, Chest, Gloves, Belt, Pants, Ring, Trinket
- Item rarities: Common, Uncommon, Rare, Unique (Named)
- Durability system — items degrade with use
- Unique items cannot be repaired

### 10. Creature Loot & The Return Rule
- Creatures drop items on death based on rarity (Regular/Rare/Boss)
- Boss creatures drop Unique named items
- The Return Rule: Unique items return to boss loot tables when destroyed, dropped, or if the owner is offline for 24 hours

### 11. Vendors & Economy
- Vendor nodes for buying/selling items
- Gold currency earned from creature drops and quest rewards

---

## Phase 5: Social & Party System

### 12. Party Mechanics
- Invite players to party, with a Follow mechanic (party moves together)
- Designate a Tank who absorbs direct creature attacks
- Shared combat encounters
- Loot sharing with a selection system (party members choose who gets what)

---

## Phase 6: Admin Tools

### 13. Maiar Tools (Moderator)
- Edit node descriptions and properties
- Manage creature spawns within nodes
- View player activity in their managed areas

### 14. Valar Tools (Super-Admin)
- Create and configure entire regions
- Set level gates for regions
- View all player logs and activity
- Promote/demote user roles

---

## Starting Scope (MVP Build)
The initial implementation will focus on **Phases 1–3**: Authentication, character creation, the role system, the three-column parchment UI, node-based world navigation with a seed of Middle-earth locations (The Shire as the starter region), real-time player presence, and basic combat. This gives a playable foundation to iterate on.

