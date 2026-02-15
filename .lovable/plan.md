

# IP-Safe Renaming Plan

## Overview
Rename all Tolkien-trademarked terms throughout the codebase to original names that are *inspired by* but legally distinct from Tolkien's work. This touches the game title, race names, admin role names, DB enums, RLS policy helper functions, edge functions, the AI world builder prompt, and the admin map view.

## Proposed Name Changes

### Game Title
- "Wayfarers of Arda" -> **"Wayfarers of Eldara"**

### Race Names (DB enum + code)
| Current | New Key | New Label | Rationale |
|---------|---------|-----------|-----------|
| hobbit | halfling | Halfling | Generic fantasy term, not trademarked |
| dunedain | edain | Edain | Evocative but distinct; "Edain" alone is not trademarked in the same way |

*Note: Human, Elf, Dwarf, Half-Elf are generic fantasy terms and safe to keep.*

### Race Descriptions (remove direct references)
- "the Firstborn" -> "the Elder Folk"
- "Durin's Folk" -> "the Mountain Clans"
- "descendants of Numenor" -> "descendants of the Old Kingdom"

### Class Descriptions
- "drawn from the fabric of Arda" -> "drawn from the fabric of the world"

### Admin Role Names (DB enum + all code)
| Current | New |
|---------|-----|
| valar | overlord |
| maiar | steward |

This requires renaming the `app_role` enum values and updating all helper functions (`is_valar()`, `is_maiar_or_valar()`), RLS policies, edge functions, and frontend code.

### AI World Builder Prompt
- "Middle-earth world builder" -> "high-fantasy world builder"
- "fit Tolkien's lore" -> "fit the world's lore"
- Remove all direct Tolkien references; instruct AI to generate names *inspired by* but not taken from any copyrighted works

### Admin Map Region Coordinates
- Replace all Tolkien place names (The Shire, Rivendell, Mordor, etc.) with generic placeholders or remove the hardcoded coordinate map entirely (since regions are dynamic)

---

## Technical Details

### 1. Database Migration (single migration)
```sql
-- Rename app_role enum values
ALTER TYPE public.app_role RENAME VALUE 'valar' TO 'overlord';
ALTER TYPE public.app_role RENAME VALUE 'maiar' TO 'steward';

-- Rename character_race enum values
ALTER TYPE public.character_race RENAME VALUE 'hobbit' TO 'halfling';
ALTER TYPE public.character_race RENAME VALUE 'dunedain' TO 'edain';
```

### 2. Database Functions to Update
- `is_valar()` -> `is_overlord()`
- `is_maiar_or_valar()` -> `is_steward_or_overlord()`
- All RLS policies referencing these functions must be dropped and recreated

### 3. Files to Modify

**Frontend (role references -- "valar"/"maiar" -> "overlord"/"steward"):**
- `src/hooks/useRole.ts`
- `src/pages/Index.tsx`
- `src/pages/AdminPage.tsx`
- `src/components/admin/UserManager.tsx`
- `src/components/admin/NodeEditorPanel.tsx`
- `src/components/admin/NodeEditorDialog.tsx`
- `src/components/admin/RegionManager.tsx`

**Frontend (race + game title + descriptions):**
- `src/lib/game-data.ts` -- rename hobbit/dunedain keys and descriptions
- `src/pages/AuthPage.tsx` -- title
- `src/pages/GamePage.tsx` -- title
- `index.html` -- title and meta tags
- `src/components/admin/AdminWorldMapView.tsx` -- remove Tolkien region coordinates

**Edge Functions:**
- `supabase/functions/admin-users/index.ts` -- role checks + race stats
- `supabase/functions/ai-world-builder/index.ts` -- role checks + system prompt

### 4. Existing Data Considerations
- The DB enum rename (`ALTER TYPE ... RENAME VALUE`) updates all existing rows automatically -- no data migration needed
- Any existing regions in the database with Tolkien names (e.g., "The Shire") will remain as-is in the data; only the hardcoded coordinate map in the admin view changes. You can rename those regions manually via the admin UI if desired.

### 5. Sequence
1. Run the database migration (enum renames + function renames + RLS policy recreation)
2. Update both edge functions
3. Update all frontend files
4. Deploy edge functions

