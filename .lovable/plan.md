## Goal
Constrain the center game panel's max width so it's just wide enough to fit the widest class's ability bar in a single row, with a small wiggle margin. The remaining horizontal space in the 1920px game row goes to the right gutter (which already feeds the dynamic chat column).

## Widest class — analysis
Summing label characters across each class's 5 ability buttons (the dominant width contributor at `text-[10px] px-2`):

- healer:  Smite / Heal / Transfer Health / Purifying Light / Divine Aegis = 51
- warrior: Power Strike / Second Wind / Battle Cry / Rend / Sunder Armor = 49
- ranger:  Aimed Shot / Eagle Eye / Barrage / Nature's Snare / Disengage = 49
- bard:    Cutting Words / Inspire / Dissonance / Crescendo / Grand Finale = 51
- rogue:   Backstab / Shadowstep / Envenom / Eviscerate / Cloak of Shadows = 51
- wizard:  Fireball / Force Shield / Arcane Surge / Ignite / Conflagrate = 50
- **templar: Judgment / Holy Shield / Shield Wall / Consecrate / Divine Challenge = 56  ← widest**

"Divine Challenge" (16 chars) is the single longest label in the game and makes templar the widest bar.

## Approach — dynamic measurement (preferred over a hardcoded px value)

Hardcoding a number drifts the moment a label, font, padding, or keybind hint changes. Instead, measure the templar bar at runtime once on mount and apply that width (+ wiggle) as a max-width on the middle column.

### Implementation

1. **New component `AbilityBarMeasurer`** (`src/features/combat/components/AbilityBarMeasurer.tsx`)
   - Renders an absolutely-positioned, visually hidden (`opacity-0 pointer-events-none -z-10`), `whitespace-nowrap` flex row containing one disabled `<Button>` per templar ability — same classes as the real bar (`font-display text-[10px] h-6 px-2`), including a fake `[1]`–`[5]` keybind suffix so width matches the worst-case rendered case.
   - Uses `ResizeObserver` on its inner row to report `width` via an `onMeasure(width: number)` callback.
   - Pulls labels from `CLASS_ABILITIES.templar` so it stays in sync with future ability edits.

2. **GamePage wires the measurement**
   - Add `const [abilityBarWidth, setAbilityBarWidth] = useState<number>(720)` (fallback ≈ templar estimate).
   - Mount `<AbilityBarMeasurer onMeasure={setAbilityBarWidth} />` once near the root of the returned tree (sibling of the main game row).
   - Compute `const centerMaxWidth = abilityBarWidth + 64;` (32 px wiggle on each side).
   - Apply to the middle column wrapper:
     ```tsx
     <div
       className="h-full flex-1 min-w-0 ornate-border bg-card/60 flex flex-col"
       style={{ maxWidth: centerMaxWidth }}
     >
     ```
   - Keep `flex-1` so the column still shrinks on narrower viewports; the cap only kicks in once the gutter exists.

3. **Right gutter / chat behavior — unchanged**
   - The existing `gutterWidth = max(0, (vw − usedGameAreaWidth) / 2)` logic stays. With the center column now capped, `gutterWidth` will be larger on wide screens, so the inline chat will fit (≥ 320 px) at smaller viewports than before — exactly the intended outcome.
   - The collapse-to-icon fallback remains for narrow screens.

### Files

- **New:** `src/features/combat/components/AbilityBarMeasurer.tsx`
- **Edit:** `src/pages/GamePage.tsx` — import the measurer, add `abilityBarWidth` state, render measurer, apply `style={{ maxWidth }}` to the middle column.

### Out of scope

- No formula/balance changes, no ability label edits, no character-panel or map-panel width changes, no chat redesign.
