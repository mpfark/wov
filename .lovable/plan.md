## Goal

Make the CP bar mimic Path of Exile's reservation visual: the reserved portion stays pinned to the **right end** of the bar as a static, dimmed/hatched segment, and the usable CP fills/drains only inside the remaining left portion. Reserved CP no longer "floats" between the fill and the queued segment — it visually shrinks the bar from the right, exactly like PoE's mana orb.

## Visual Model (PoE-style)

```text
Before any stance:
[██████████░░░░░░░░░░]   100/100 usable, 0 reserved

Tier-2 stance active (15% of 200 max = 30 CP reserved):
[████████████░░░░▓▓▓▓]   170 usable / 200 max ⚓30
                  └── pinned reserved segment on the right (hatched soulforged)

Same stance, after spending some CP:
[██████░░░░░░░░░░▓▓▓▓]   80 / 200  ⚓30
                  └── reserved stays pinned regardless of usable level

Queued ability cost (in-flight, 20 CP) + stance reserved:
[████░░▒▒░░░░░░░░▓▓▓▓]
 fill │queued│ empty │ reserved (pinned right)
```

Key properties:
- The reserved segment sits flush against the right edge and never moves.
- The "effective max" the fill bar can grow into = `maxCp - stanceReserved`.
- Queued ability segment renders just to the right of the fill, still inside the usable area (never overlapping the reserved tail).
- An empty (unfilled) gap is allowed between the queued segment and the reserved tail when CP is low.

## Changes

### 1. `src/features/character/components/StatusBarsStrip.tsx` — CP bar markup

Rewrite the CP bar block so positioning is computed against the full `maxCp` width but the fill only paints the usable region:

- Container stays `width: 100%` representing `maxCp`.
- **Reserved tail (right-pinned)**: absolute, `right: 0`, `width: stancePercent%`, hatched soulforged (same gradient as today). Always rendered when `stancePercent > 0`. Add a left border to mark the boundary.
- **Usable fill**: absolute, `left: 0`, `width: (cpPercent_of_max)%`. The fill width is computed as `displayedCp / maxCp * 100` — same as today — so it naturally never crosses into the reserved tail because `displayedCp ≤ maxCp - stanceReserved`.
- **Queued overlay**: absolute, `left: cpPercent%`, `width: queuedPercent%`. Already correct relative to max; will sit between the fill and the reserved tail.
- Remove the current "stance segment in the middle" rendering.

The numeric label keeps the existing `cp/maxCp ⚓N (-queued)` format. No change to the tooltip.

### 2. `src/features/combat/utils/cp-display.ts` — minor additions

The math is already correct (percentages are all relative to `maxCp`). Add two derived fields used by the new layout for clarity, without breaking back-compat:

- `usableMaxCp = maxCp - stanceReservedCp` (informational; not required for rendering but useful for the upcoming label tweak and for tests).
- `usableMaxPercent = round(usableMaxCp / maxCp * 100)` (so the boundary of the reserved tail can be expressed as `100 - stancePercent` consistently across rounding edges — we'll use `100 - stancePercent` directly in the component to avoid drift).

No change to `getAvailableCp` or affordability semantics.

### 3. Tests

Update `src/features/combat/utils/__tests__/cp-display.test.ts` if it asserts the old segment ordering. Add cases for:
- Stance reserved with low CP (fill shrinks but reserved tail stays at full reserved width).
- Stance + queued together (queued sits left of reserved tail, never overlaps).
- 100% reserved edge (entire bar is the reserved tail; fill = 0).

`StatusBarsStrip.login-display.test.tsx` only asserts numbers — should remain green; re-check to confirm.

## Out of scope

- No backend changes. Stance reservation amounts, RPCs, and combat-tick logic stay as-is.
- Tooltip wording, stance pip row, and the `⚓N` inline indicator next to the number stay unchanged.
- No change to MP/HP/XP bars.

## Files Touched

- `src/features/character/components/StatusBarsStrip.tsx` — CP bar JSX rewrite.
- `src/features/combat/utils/cp-display.ts` — add `usableMaxCp`, `usableMaxPercent` (additive, non-breaking).
- `src/features/combat/utils/__tests__/cp-display.test.ts` — add reservation-tail cases.
