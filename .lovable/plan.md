

# Users Page Enhancement and UX Refinement

## Overview
Refactor the 1137-line `UserManager.tsx` into a cleaner multi-file structure with improved UX across all five columns (Users, Characters, Actions, Character Sheet, Logs). No backend or schema changes.

## Architecture

Extract subcomponents from the monolithic file:

```text
src/components/admin/users/
├── UserManager.tsx          (orchestrator — state, handlers, layout)
├── UserListColumn.tsx       (COL 1 — user list with search + role filter)
├── CharacterListColumn.tsx  (COL 2 — user info header + character cards)
├── CharacterActionsColumn.tsx (COL 3 — grouped admin actions)
├── CharacterSheetColumn.tsx (COL 4 — character sheet with summary header)
├── ActivityLogColumn.tsx    (COL 5 — logs with date grouping + event filter)
├── AdminEquipSlot.tsx       (shared equip slot component)
├── AdminCharacterSheet.tsx  (character detail view)
├── CharacterSummaryCard.tsx (compact header for selected character)
└── constants.ts             (RARITY_COLORS, STAT_*, SLOT_LABELS, EVENT_TYPE_*)
```

## Column-by-Column Changes

### COL 1 — Users List
- Add role filter dropdown (All / Player / Steward / Overlord) next to search
- Show "last active" relative time (e.g. "2h ago") under email
- Highlight selected row with stronger left-border accent
- Keep existing pagination

### COL 2 — Characters Panel
- Use `AdminEntityToolbar` header: "Characters (N)"
- Add location display per character card (node name from lookup)
- Add optional sort toggle (alpha / level)
- Keep existing user info header and account action buttons

### COL 3 — Actions (reorganized)
- Add `CharacterSummaryCard` at top: name, class, level, HP/CP bars, location
- Group actions using `AdminFormSection`:
  - **Items & Inventory**: Give Item, Remove Item
  - **Progression**: Grant XP, Grant Respec, Grant Salvage
  - **Movement**: Teleport
  - **Character Management**: Revive, Reset Stats
- Add confirmation dialog for Reset Stats (destructive)

### COL 4 — Character Sheet
- Keep existing `AdminCharacterSheet` component largely intact
- Use `AdminEditorHeader` for consistent header
- Minor spacing/alignment cleanup

### COL 5 — Activity Logs
- Add event type filter dropdown (All / Combat / Movement / Items / Admin)
- Group logs by date with date separator headers
- Use `AdminEntityToolbar` for header consistency

## Technical Details

- **No new state management** — all state stays in the orchestrator
- **No backend changes** — all data already available from existing `callAdmin('list')` and node lookups
- **Node name lookup** for character location: use existing `allNodes` state already fetched
- Constants and interfaces extracted to `constants.ts` for reuse
- All existing handlers (`handleGiveItem`, `handleTeleport`, etc.) preserved exactly as-is
- Parent `AdminPage.tsx` import path updated from `./UserManager` to `./users/UserManager`

## Implementation Order
1. Create `constants.ts` with extracted constants/interfaces
2. Create `CharacterSummaryCard.tsx` and `AdminEquipSlot.tsx`
3. Create `AdminCharacterSheet.tsx` (moved from inline)
4. Create `ActivityLogColumn.tsx` with date grouping + event filter
5. Create `UserListColumn.tsx` with role filter
6. Create `CharacterListColumn.tsx` with location + sort
7. Create `CharacterActionsColumn.tsx` with grouped sections + confirmation
8. Create `CharacterSheetColumn.tsx` wrapper
9. Rewrite `UserManager.tsx` as slim orchestrator
10. Update import in `AdminPage.tsx`

