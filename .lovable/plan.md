## Goal
Let players set an HP threshold and a flee direction; when their HP drops at or below the threshold during combat, the client automatically triggers the existing flee-move in that direction.

## Approach

**Client-driven**, reusing existing flee path. Combat tick runs server-side but movement is already client-driven (`useMovementActions.moveToNode` with `fleeStopCombat`), so a small watcher hook decides when to fire it. Settings persist on the character row so they survive relog and follow the character.

## Changes

**Database (migration)**
- Add two columns to `characters`:
  - `wimp_hp_threshold int NOT NULL DEFAULT 0` (0 = disabled)
  - `wimp_direction text` nullable, one of `N, S, E, W, NE, NW, SE, SW`

**Settings UI — new small panel inside Character sheet (Attributes tab footer) or a dedicated "Combat" section**
- Number input for threshold (0–100 % of max HP; stored as percent for portability across level-ups).
- Dropdown of 8 compass directions + "Disabled".
- Save button calls `updateCharacter({ wimp_hp_threshold, wimp_direction })`.

> Decision: store as **percent of max HP**, not absolute HP — otherwise the threshold becomes meaningless after a level-up. UI label: "Flee when HP drops below X %".

**Watcher hook — `src/features/combat/hooks/useWimp.ts` (new)**
- Inputs: `character`, `inCombat`, `currentNode`, `moveToNode`.
- When `inCombat && character.wimp_hp_threshold > 0 && character.wimp_direction` and `character.hp / character.max_hp * 100 <= threshold`:
  - Find the connection in the configured direction from `currentNode.connections`.
  - If found and not locked, call `moveToNode(targetNodeId, direction)` — this reuses the existing flee path (opportunity attacks + `fleeStopCombat`).
  - Add a log line: `⚠️ Wimp triggered — fleeing <direction>!`
  - Guard with a ref so it fires once per combat session (reset when `inCombat` flips false).
  - If no valid exit in that direction, log a warning: `⚠️ Wimp wanted to flee <dir> but no path exists.`

**Wire-up — `src/pages/GamePage.tsx`**
- Call `useWimp({ character, inCombat, currentNode, moveToNode, addLog })` alongside the other combat hooks.

**Types — regenerated automatically after migration**; no manual `types.ts` edits.

## Edge cases
- Party leader vs. follower: only the leader's `moveToNode` actually relocates the party, but a follower triggering wimp would still want to bail. Followers leaving the party mid-combat is already handled by existing flee logic, so the hook can run for everyone.
- Locked connections: skip and log warning (don't auto-unlock).
- Dead character: skip (hp <= 0 already ends combat).
- Already moving / on cooldown: `moveToNode` no-ops naturally; we just don't reset the "fired" flag so it retries on next HP tick.

## Out of scope
- Smart pathing (always X exits away). Single-step flee only.
- Per-creature wimp rules.
- Auto-potion before wimp (could be a follow-up).