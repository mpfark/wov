## Goal

- A character without an order is presented as a **Wayfarer** everywhere the player sees text.
- The central **Classless Tutorial Banner** (the big info box listing the seven Order Halls) is removed from the node view; finding orders happens via NPC dialogue only.
- **No new abilities** for Wayfarers — they keep weapon autoattacks only (existing behavior).

Internal keys (`classless` enum value, `is_classless` flag, DB columns) stay untouched. This is a label-only rename — lowest risk, no migration.

## Changes

### 1. Rename to "Wayfarer" (UI + log copy)

- `src/shared/formulas/classes.ts` and `supabase/functions/_shared/formulas/classes.ts`
  - `CLASS_LABELS.classless`: `'Classless Adventurer'` → `'Wayfarer'`.
- `src/lib/game-data.ts`
  - `CLASS_DESCRIPTIONS.classless`: tighten the copy and replace "Classless Adventurer" framing with Wayfarer voice. Existing "find a hall in the world" wording stays.
- `src/pages/CharacterCreation.tsx`
  - Toast: "…sets out into the world as a **Wayfarer**."
  - Info card heading: "You begin as a **Wayfarer**" (card itself stays — it's the creation-screen card, not the in-world banner).
- `src/features/character/components/ClassBondRow.tsx`
  - Doc comment: "Wayfarers render nothing".
- Any code-comment occurrences of "classless" in `combat-tick` / `combat-catchup` / plan / memory left as-is (internal, references the flag/enum, not user-facing).

### 2. Remove the central tutorial banner

- `src/features/world/components/NodeView.tsx`
  - Remove the `ClasslessTutorialBanner` import and the `{(character as any).is_classless && <ClasslessTutorialBanner />}` render at line 242.
- `src/features/world/components/ClasslessTutorialBanner.tsx`
  - Delete the file (no other consumers).
- `src/features/world/utils/directions.ts` is still used by NPC dialogue topics — leave it.

### 3. Wayfarer abilities

- **No changes.** Wayfarers keep weapon autoattacks. Ability bar already gates on a real class via `is_classless`.

### 4. Memory + plan touch-ups

- Update `.lovable/plan.md` Phase 2b section: replace "Classless Adventurer" wording with "Wayfarer" and note that the in-world banner has been retired in favor of NPC-only discovery.

## Out of scope

- DB enum rename (would require migration + edge-function updates with no player-facing benefit).
- New Wayfarer abilities or kit changes.
- NPC dialogue rewrites — existing Order-Hall topics already cover all seven halls.

## Verification

- Create a new character → toast says "Wayfarer", creation card heading says "Wayfarer".
- Enter the world → no central banner; Knut and other Order-Hall NPCs still answer "where is the X hall?" questions.
- Character Panel → Attributes tab shows no Bond row for Wayfarers (unchanged behavior).
- Existing classed characters unaffected.
