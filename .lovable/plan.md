# Single-Page Character Creation + 4 Enhancements

Replace the 5-step wizard in `src/pages/CharacterCreation.tsx` with a single scrollable page, plus all four extras (hover preview, AI name reroll, recommended-class hints, sticky summary bar).

## Layout

```text
┌────────────────────────────────────────────────────────┐
│ ← Back     Forge Your Hero                             │
├────────────────────────────────────────────────────────┤
│ Name [_________] [🎲 Reroll]   Gender (♂ Male)(♀ Fem)  │
├────────────────────────────────────────────────────────┤
│ Race  (3-col grid; selected = primary border)          │
│ ┌Human─┐ ┌Elf───┐ ┌Dwarf─┐                             │
│ │+stats│ │+stats│ │+stats│   (hover → preview at btm)  │
│ │Best: │ │Best: │ │Best: │                             │
│ │Any   │ │Wiz/  │ │War/  │                             │
│ │      │ │Rgr   │ │Tmpl  │                             │
│ └──────┘ └──────┘ └──────┘                             │
├────────────────────────────────────────────────────────┤
│ Class  (3-col grid)                                    │
│ ┌Warrior┐ ┌Wizard─┐ ...                                │
│ └───────┘ └───────┘                                    │
├────────────────────────────────────────────────────────┤
│ (scroll spacer for sticky bar)                         │
└────────────────────────────────────────────────────────┘
─── sticky bottom (always visible) ──────────────────────
│ STR 10 DEX 12 CON 14 INT 8 WIS 11 CHA 9                │
│ HP 26  AC 13  Gold 10  •  [ Create Character ]         │
─────────────────────────────────────────────────────────
```

## Implementation

### 1. Single-page rewrite — `src/pages/CharacterCreation.tsx`
- Drop `step` state. Keep `name`, `gender`, `race`, `charClass`, `loading`.
- Add `hoverRace`, `hoverClass` state for the hover-preview.
- Computed values use `hoverRace ?? race` and `hoverClass ?? charClass` for the live stats panel — so hovering temporarily previews without committing.
- Card grids reuse current visual style (border highlight, stat chips, descriptions). Wrap in `max-w-4xl`, keep `parchment-bg` + `ornate-border`.
- Sticky summary bar: a `<div class="sticky bottom-0 ...">` inside the card, with backdrop blur, divider, all six stats + HP/AC/Gold + Create button. Disabled until `name && gender && race && charClass`. Shows a muted "Choose a race and class" hint when stats aren't computable.
- `handleCreate` body kept identical.

### 2. AI name reroll button
- New edge function `supabase/functions/ai-suggest-character-name/index.ts`:
  - Auth-gated to any signed-in user (no role check).
  - In-memory rate limit: 10 / 60 s per user.
  - Inputs: `{ race, gender }` (optional; falls back to generic fantasy).
  - Calls Lovable AI Gateway (`google/gemini-3-flash-preview`) with a tool-call schema returning `{ name: string }`.
  - System prompt: "Generate a single-word fantasy first name appropriate for a {gender} {race} adventurer in a high-fantasy MUD. ASCII only. 2–12 letters. Output only the JSON tool call." Non-deterministic via temperature default.
  - Server strips whitespace and non-letters before returning.
- No `supabase/config.toml` block needed — defaults (verify_jwt = true) are correct.
- Frontend: small dice button next to the name input. Disabled while loading; shows spinner. On success sets `name` to the returned value. Tolerates failure with a toast.

### 3. Recommended-class hint
- Add a static map in the same file:
  ```ts
  const RACE_RECOMMENDED_CLASSES: Record<string, string[]> = {
    human:    ['warrior','wizard','ranger','rogue','healer','bard','templar'], // shows "Any"
    elf:      ['wizard','ranger'],
    dwarf:    ['warrior','templar'],
    halfling: ['rogue','ranger'],
    edain:    ['warrior','templar','healer'],
    half_elf: ['bard','healer'],
  };
  ```
- Render under each race card as a small italic "Best: Wizard, Ranger" line (or "Best: Any" for human).
- Optional small visual cue: when a race is selected, the matching class cards get a subtle ring/dot to draw the eye — pure CSS (`ring-1 ring-primary/30`).

### 4. Hover preview (already covered by state model in step 1)
- `onMouseEnter` / `onMouseLeave` on each race + class card sets `hoverRace`/`hoverClass`. Sticky stat bar reads the hovered values when present, the committed values otherwise.

### 5. Sticky summary bar (covered in step 1)
- Implemented as a `sticky bottom-0` flex strip inside the `Card`. The page's outer container becomes scrollable on smaller screens.

## Files touched

- **rewrite**: `src/pages/CharacterCreation.tsx`
- **new**: `supabase/functions/ai-suggest-character-name/index.ts` (auto-deployed)
- No DB migration. No changes to `Index.tsx` or other call sites.

## Out of scope

- Race/class data, formulas, and starting-gear RPC remain unchanged.
- No new memory file needed; the layout choice is local to one page.
