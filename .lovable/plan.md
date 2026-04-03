

# Refined Gameplay Feel Polish Pass

## Summary

Same scope as the previous plan, refined with visual restraint constraints. The core principle: **the UI should feel alive, not busy**. Every animation is single-cycle or very low amplitude. No more than one attention-grabbing effect per creature row at a time.

## Changes

### 1. CSS Animations (`src/index.css`)

Add four new keyframes, all deliberately subtle:

```css
@keyframes shimmer {
  0% { background-position: -200% 0; }
  100% { background-position: 200% 0; }
}
@keyframes flicker {
  0%, 100% { opacity: 0.85; }
  50% { opacity: 0.6; }
}
@keyframes drip {
  0%, 100% { transform: translateY(0); }
  50% { transform: translateY(0.5px); }
}
@keyframes aggro-flash {
  0%, 100% { box-shadow: none; }
  50% { box-shadow: 0 0 4px 1px hsl(var(--destructive) / 0.25); }
}
```

Key restraint changes vs previous plan:
- `flicker`: reduced from 0.4 min opacity to 0.6 — barely perceptible
- `drip`: reduced from 1px to 0.5px — felt, not seen
- `aggro-flash`: reduced glow radius from 8px/2px to 4px/1px at 25% opacity — a whisper, not a shout

### 2. Tailwind Config (`tailwind.config.ts`)

Register new animations:
- `animate-shimmer`: `shimmer 2s linear infinite` (skeleton loading only)
- `animate-flicker`: `flicker 2s ease-in-out infinite` (ignite DoT)
- `animate-drip`: `drip 2.5s ease-in-out infinite` (bleed DoT)
- `animate-aggro-flash`: `aggro-flash 0.4s ease-out` (single cycle, no repeat)

Also add `animate-fade-in` (0.25s opacity 0→1) for creature row entry.

### 3. NodeView Creature Rows (`src/features/world/components/NodeView.tsx`)

**Priority system** — at most one strong effect per creature row:

```
Priority 1 (exclusive): aggro-flash — plays once on initial engagement, via a local Set<string> tracking "already flashed" creature IDs
Priority 2 (exclusive with P1): HP number brief opacity dip on change — only if aggro-flash is NOT currently playing
Priority 3 (passive, always allowed): DoT indicator animations — these are tiny inline icons, not row-level effects
```

Specific changes:

**a) Creature row fade-in**: Wrap each creature `<div>` in `animate-fade-in` class. Single cycle, 250ms.

**b) Aggro flash**: When `isEngaged` first becomes true for a creature, apply `animate-aggro-flash` class to the row. Track in a `useRef<Set<string>>` so it only fires once per creature per node visit. Remove class after 400ms via `onAnimationEnd`. While aggro-flash is active, suppress HP pulse.

**c) HP bar smoothing**: Change `duration-200` to `duration-300` on HP bar width transition. Add `transition-colors duration-700` for the color shifts. No pulse on HP numbers — replaced with a very brief opacity dip (`opacity-70` for 200ms via inline style toggle) that only fires when aggro-flash is NOT active.

**d) DoT indicators — replace uniform `animate-pulse`**:
- Poison 🧪: keep `animate-pulse` (already subtle)
- Ignite 🔥: use `animate-flicker` instead
- Bleed 🩸: use `animate-drip` instead
- Sunder 🔨: remove animation entirely (static icon is sufficient)
- ⚔️ combat icon: remove `animate-pulse`, make it static — reduces visual noise significantly

**e) Skeleton shimmer**: Replace `Skeleton` background with `animate-shimmer` using a low-contrast gradient (`background-size: 200% 100%`). Subtle.

**f) Combat state ring on NodeView container**: NOT adding this. The existing per-row border colors (red/orange/primary) already communicate combat state. A whole-container ring would be redundant.

### 4. Log Styling (`src/pages/GamePage.tsx`)

Minimal changes to `getLogColor`:

- **Remote party actions**: Lines containing `(remote)` that aren't already styled get `text-foreground/60` — slightly dimmer, not dramatically different. Preserves readability.
- **Miss de-emphasis**: The existing `text-muted-foreground` for miss lines is already correct. No change needed.
- **Crit emphasis**: Already `text-primary font-semibold`. Add a very subtle `text-shadow` via a new CSS class `.log-crit` (`text-shadow: 0 0 6px hsl(var(--gold) / 0.15)`). Barely visible, adds warmth.

No other log color changes — the current hierarchy is already good.

### 5. Death Overlay (`src/pages/GamePage.tsx`)

- Add `animate-fade-in` to the death overlay div.
- Change `backdrop-blur-sm` to `backdrop-blur-md` for slightly more dramatic death feel.
- No other changes to the overlay.

### 6. Dev-Only Diagnostics (`src/features/world/components/NodeView.tsx`, `src/features/combat/hooks/usePartyCombat.ts`)

Two `console.debug` lines gated behind `import.meta.env.DEV`:
- NodeView: log `performance.now()` when creatures first render after loading
- usePartyCombat: log elapsed ms from `startCombat` call to first `processTickResult`

Easy to remove later.

## What Does NOT Change

- Combat math, tick rates, class balance
- Server authority, prediction/reconciliation model
- DB schema, RLS, edge functions
- Movement, inventory, chat, party systems
- Existing border color conventions for engaged/active/selected

## Files Changed

| File | Purpose |
|------|---------|
| `src/index.css` | 4 new keyframes + `.log-crit` class |
| `tailwind.config.ts` | Register 5 new animation utilities |
| `src/features/world/components/NodeView.tsx` | Fade-in, aggro flash, HP smoothing, DoT animations, skeleton shimmer, diagnostics |
| `src/pages/GamePage.tsx` | Remote log dimming, death overlay polish, crit class |

## Restraint Checklist

- Max one attention-grabbing effect per creature row: yes (priority system)
- All animations single-cycle or low-amplitude loops: yes
- No continuous strong pulsing: yes (removed `animate-pulse` from ⚔️ and sunder)
- No thick/heavy combined borders: yes (no container ring added)
- Log readability preserved: yes (only slight opacity changes)
- Transform/opacity only for animations: yes (no layout-triggering properties)
- "Less is more" default: yes (reduced all intensities from original plan)

