

## Multi-Character Support

### Overview
Allow each user to own multiple characters and switch between them. Currently the code fetches only one character per user — the database already supports multiple (no unique constraint on `user_id`). This plan adds a **character selection screen** between login and gameplay.

### User Experience Flow

1. **After login**, if the user has 0 characters, they go straight to Character Creation (same as today)
2. If they have 1+ characters, they see a **Character Select** screen showing all their characters as cards
3. From that screen they can:
   - Select a character to play
   - Create a new character (goes to existing Character Creation flow)
   - Delete a character (with confirmation dialog)
4. While in-game, a small button in the header/character panel lets them **Switch Character** (returns to selection screen)

### Technical Changes

#### 1. Update `useCharacter` hook
- Fetch **all** characters for the user instead of `.limit(1).maybeSingle()`
- Return `characters: Character[]` (array) plus `selectedCharacter` state
- Add `selectCharacter(id)` and `deleteCharacter(id)` functions
- Keep `createCharacter` and `updateCharacter` as-is
- Realtime subscription stays filtered to `user_id` but handles the full array

#### 2. Create `CharacterSelect.tsx` page
- Grid of character cards showing: name, race/class, level, HP, gold
- "Create New Character" button
- "Delete" button per character (with AlertDialog confirmation)
- Clicking a card selects that character and enters the game

#### 3. Update `Index.tsx` routing logic
- Instead of `!character -> CharacterCreation`, the flow becomes:
  - `characters.length === 0` -> CharacterCreation
  - `characters.length > 0 && !selectedCharacter` -> CharacterSelect
  - `selectedCharacter` -> GamePage
- Pass a `onSwitchCharacter` callback to GamePage

#### 4. Update `GamePage.tsx`
- Add a "Switch Character" button (in the header area near sign out)
- Calls `onSwitchCharacter()` which clears the selected character, returning to CharacterSelect

#### 5. Update `CharacterCreation.tsx`
- Add a "Back" button when the user already has other characters (to return to selection)

#### 6. Cleanup on delete
- When deleting a character, also delete their `character_inventory`, `party_members` entries
- Use cascading deletes or explicit cleanup before the character row delete

### No Database Changes Needed
The `characters` table already allows multiple rows per `user_id`. The only constraint is `characters_name_unique` (globally unique names), which remains correct.

