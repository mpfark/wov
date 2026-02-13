

# Roadmap Feature for Admin Panel

## Overview
Add a new "Roadmap" tab to the admin panel that displays all planned features as a manageable list. Each entry has a **title**, **description**, **category** tag, and a **done** checkbox. Admins can add, edit, and mark entries as implemented. All your brainstormed ideas (A through J) will be pre-seeded into the table.

## Database

### New table: `roadmap_items`

| Column | Type | Default | Notes |
|--------|------|---------|-------|
| id | uuid | gen_random_uuid() | PK |
| title | text | | Required, short name |
| description | text | '' | Detailed explanation |
| category | text | 'general' | e.g. "Combat", "Items", "UI", "NPCs", "Quests", "Classes", "Analytics" |
| is_done | boolean | false | Checkmark when implemented |
| sort_order | integer | 0 | For manual ordering |
| created_at | timestamptz | now() | |

- RLS: SELECT open to all authenticated users; INSERT/UPDATE/DELETE restricted to admins (`is_maiar_or_valar()`)

### Seed data (inserted via migration)
All 10 brainstormed ideas will be inserted as initial rows:

| Title | Category |
|-------|----------|
| Auto-progressing combat system | Combat |
| Class abilities (Healer spells, Bard songs) | Classes |
| Player action logs for balancing | Analytics |
| Non-Player Characters (NPCs) | NPCs |
| Quest system with AI generation | Quests |
| Inn resting for faster HP regen | Mechanics |
| Unique item rules and repair system | Items |
| HP regen rate tooltip | UI |
| Level-difference XP penalty | Mechanics |
| Creature presence indicators on nodes | UI |

## Frontend

### 1. AdminPage.tsx
- Add a "Roadmap" tab trigger to the existing `TabsList`
- Add a `TabsContent` rendering the new `RoadmapManager` component

### 2. New component: `src/components/admin/RoadmapManager.tsx`
A full-height scrollable panel with:

- **Header bar**: Title "Roadmap" + "Add Entry" button + optional category filter dropdown
- **Entry list**: Each row shows:
  - A checkbox to toggle `is_done` (saves immediately to DB)
  - The title (bold) with the category as a colored `Badge`
  - The description below in smaller text
  - An edit button to inline-edit title, description, and category
  - A delete button (with confirmation)
- **Add/Edit form**: A small inline form (or collapsible section at the top) with:
  - Title input
  - Description textarea
  - Category selector (predefined list: Combat, Classes, Analytics, NPCs, Quests, Mechanics, Items, UI, General -- plus ability to type custom)
- Done items are visually muted (strikethrough title, lower opacity) and sorted to the bottom
- Undone items are sorted by `sort_order` then `created_at`

### Visual Style
- Follows the existing admin panel parchment/fantasy aesthetic
- Category badges use different muted colors (e.g. Combat = red, UI = blue, Items = amber)
- Checkmark uses the existing `Checkbox` component
- Consistent with the `font-display text-xs` pattern used across other admin tabs

## Technical Notes
- Uses the standard Supabase client for CRUD -- no edge function needed
- Realtime not required since this is admin-only and low-frequency
- The category list is hardcoded in the component but the column is free-text so custom categories work too
