

## Plan: Gender-based Nobility Titles

### Title Hierarchy (every other level from 28 to 40)
| Level | Male | Female |
|-------|------|--------|
| 28 | Lord | Lady |
| 30 | Baron | Baroness |
| 32 | Count | Countess |
| 34 | Marquis | Marquise |
| 36 | Duke | Duchess |
| 38 | Prince | Princess |
| 40 | King | Queen |

### Changes Required

**1. Update `getCharacterTitle` in `src/lib/game-data.ts`**
- Change `MILESTONE_TITLES` to store male/female title pairs instead of a single string.
- Update `getCharacterTitle(level, gender)` to accept gender and return the appropriate title.

**2. Add `gender` to presence systems** (so titles display correctly for other players)
- `src/hooks/usePresence.ts` — add `gender` to `PlayerPresence` and `PresenceCharacter` interfaces, and include it in track/sync.
- `src/hooks/useGlobalPresence.ts` — add `gender` to `OnlinePlayer` and `PresenceCharacter`, include in track/sync.

**3. Update all call sites to pass gender:**
- `src/components/game/CharacterPanel.tsx` — pass `character.gender` to `getCharacterTitle`.
- `src/components/game/PartyPanel.tsx` — pass `m.character.gender` (need to check if gender is available on party member data).
- `src/components/game/OnlinePlayersDialog.tsx` — pass `p.gender` (from updated presence).
- `src/components/game/NodeView.tsx` — pass `p.gender` (from updated presence).
- `src/components/admin/UserManager.tsx` — pass `c.gender`.
- `src/components/admin/GameManual.tsx` — show both title variants or use a neutral display.

**4. Party member data** — need to verify `useParty.ts` includes gender on member characters. If not, add it to the query.

### Technical Notes
- The function signature changes from `getCharacterTitle(level)` to `getCharacterTitle(level, gender)` with a default of `'male'` for backward compatibility.
- Presence data is ephemeral so adding gender there has no migration cost — just include it in the tracked payload.

