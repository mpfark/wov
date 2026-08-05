# Class Config page cleanup and two-column layout

Reorganize the Class Config page so a selected class shows only its own data, and use the horizontal space on desktop. No redesign of the admin shell, sidebar, typography, colours, cards or buttons — only the internal arrangement of the selected class page.

## Current state (verified)

- `src/components/admin/ClassConfigManager.tsx` renders a 256px class list on the left and one narrow (`max-w-3xl`) single-column editor stack: Lifecycle card → Combat baseline card → `ClassAbilityConfig` → `AssignmentOverview` → Validation card → Save/Reset.
- `AssignmentOverview` (`src/components/admin/class/AssignmentOverview.tsx`) loads every class, every role and every assignment and renders a cross-class table with `highlightClassKey` — so rows for unrelated classes currently appear inside the selected class's page.
- `ClassAbilityConfig` already keeps exactly one editor expanded via its `openId` state, and lists slots from `class_ability_roles` filtered to the selected `classKey` (five per class).
- Tests run on vitest + jsdom with `@testing-library/react` and `@testing-library/jest-dom` already installed; no component test for admin exists yet.

## Changes

**1. Remove the cross-class overview from the class page**

- Drop `<AssignmentOverview highlightClassKey=... />` from the selected-class editor in `ClassConfigManager.tsx`.

**2. Keep it as a separate read-only view on the Classes overview**

- When no class is selected, the main pane shows the cross-class `AssignmentOverview` instead of the current "Select a class…" placeholder (with that hint kept above it).
- Add an "Overview" entry at the top of the existing class list column that clears the selection and returns to that view. Uses the same button styling as the class rows — no new navigation pattern.
- `AssignmentOverview` keeps its `highlightClassKey` prop (now unused from this call site) and stays read-only.

**3. Two-column desktop layout for the selected class**

Replace the single `max-w-3xl` stack with a responsive grid inside the existing scroll area:

```text
grid-cols-1  (default)          xl:grid-cols-12
┌──────────────────────────┐    ┌───────────── 5/12 ─────────────┬────────── 7/12 ──────────┐
│ Class information        │    │ Class information              │ Ability configuration    │
│ Combat baseline          │    │ Combat baseline                │  Slot 1 … Slot 5         │
│ Ability configuration    │    │  (primary/secondary attrs,     │  default / alternative   │
│ Validation + Save        │    │   level bonuses, proficiencies)│  expanded editor         │
└──────────────────────────┘    │ Validation + Save/Reset        │  Base/Class/Effective    │
                                └────────────────────────────────┴──────────────────────────┘
```

- Left column (~40%): the existing Lifecycle/Class information card, Combat baseline card (primary & secondary attributes, level bonuses, weapon proficiencies), Validation card and the Save/Reset row — all unchanged internally.
- Right column (~60%): `ClassAbilityConfig` only, sticky-free, given the wider pane so slot rows, the expanded assignment editor, `EffectiveAbilityPreview` and mechanic/On-Hit sections have room.
- Narrow widths (below `xl`): single column, class-wide configuration first, Ability configuration second — achieved by DOM order plus grid ordering, no duplicated markup.
- Page-width cap moves from `max-w-3xl` to a wide container so the grid can actually use the space; the admin shell, list column and card styling are untouched.

**4. Selected class stays obvious**

- Keep the existing header line (label + `class_key` badge + character/empty-slot badge) at the top of the left column, and add the class label to `ClassAbilityConfig`'s existing subtitle context only if it is not already stated (it already reads "Which base abilities {classLabel} uses…").
- Because the overview is gone, no control or assignment row from another class can render on the page.

## Tests and screenshots

New file `src/components/admin/class/__tests__/class-config-layout.test.tsx` (jsdom + testing-library, Supabase client mocked with fixture rows for one class, its five roles and its assignments):

- Desktop layout: the two-column grid container is present and `ClassAbilityConfig` renders inside the right column while Class information / Combat baseline render inside the left.
- Narrow layout: with the grid collapsed (single-column classes asserted on the container), class-wide configuration precedes Ability configuration in DOM order.
- Exactly five slot summaries render, and every slot label belongs to the selected class.
- No all-classes overview: no other class's label or assignment row appears anywhere in the selected class page.
- One editor at a time: expanding a second assignment collapses the first.

Screenshots captured with Playwright against the running admin page at desktop (1280) and narrow (900) widths, saved under `/tmp/browser/class-config/screenshots/` and reported in chat.

## Files touched

- `src/components/admin/ClassConfigManager.tsx` — layout grid, overview removal, Overview list entry.
- `src/components/admin/class/__tests__/class-config-layout.test.tsx` — new.
- No changes to `AssignmentOverview.tsx`, `ClassAbilityConfig.tsx` internals, `AdminPageShell`, or any shared styling. No database or server changes.
