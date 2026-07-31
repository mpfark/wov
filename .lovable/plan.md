Move the Bond display to the bottom of the CharacterPanel Attributes tab, below the Defense section, and give it its own titled container so it no longer sits at the top of the attribute list.

Plan

1. Reorder the Attributes tab layout
   - In `src/features/character/components/CharacterPanel.tsx`, remove the `ClassBondRow` from the top of the `attributes` tab content.
   - Place it at the bottom, after the `Defense` derived-stats section.

2. Wrap the Bond display in a dedicated container
   - Add a titled section (`t-label` heading "Bond") matching the visual style of the existing `Pools`, `Offense`, and `Defense` sections.
   - The container should sit as its own block at the end of the attributes panel.

3. Make the Bond component support multiple rows
   - Refactor `ClassBondRow` (or create a lightweight wrapper) to fetch all rows from `character_class_bonds` for the character instead of only the active class.
   - Render each bond as a compact row with class label, progress bar, and multiplier.
   - If the character is classless or has no bonds, render nothing (or a minimal "No class bond" placeholder) so the container does not take up space unnecessarily.

4. Preserve real-time behavior
   - Keep the existing Supabase realtime subscription on `character_class_bonds` so bond values update live.

Files to modify
- `src/features/character/components/CharacterPanel.tsx`
- `src/features/character/components/ClassBondRow.tsx`

No database or backend changes are needed; this is a UI-only layout change.