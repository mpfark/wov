# Visual Polish: Depth, Hierarchy & Readability

Goal: Reduce the flat "everything sits on the same parchment" feeling without redesigning any panel. Keep the dark-fantasy aesthetic. All changes happen at the **design-token layer** (`src/index.css`, `tailwind.config.ts`) plus a handful of **shared utility classes** that existing panels already consume (`bg-card`, `border-border`, `ornate-border`, etc.). No component rewrites, no layout changes, no logic changes.

## What changes

### 1. Layered surface tokens (`src/index.css` `:root`)
Introduce a 3-step surface ramp so panels, cards and nested rows visually separate:
- `--surface-1` — outer chrome (app shell, sidebars). Slightly darker than `--background`.
- `--surface-2` — panels (`--card` re-points here). Current card lightness.
- `--surface-3` — nested rows / inventory slots / log container. ~4% lighter than surface-2.
- `--surface-raised` — hover / active row, ~6% lighter, used by tooltips/popovers.

Re-point existing tokens so nothing breaks:
- `--card` → `--surface-2`
- `--popover` → `--surface-raised`
- `--muted` → `--surface-3`

### 2. Border ramp
Single `--border` today reads the same on every edge. Add:
- `--border-subtle` (current −20% alpha) for inner dividers
- `--border` (unchanged) for panel edges
- `--border-strong` (current +25% lightness) for outer chrome / focused cards

Expose all three via tailwind (`border-subtle`, `border-strong`).

### 3. Soft depth shadows
Add two reusable shadow tokens (no big drop shadows — fantasy parchment stays matte):
- `--shadow-inset-soft` — `inset 0 1px 0 hsl(var(--gold) / 0.04), inset 0 0 24px hsl(35 20% 6% / 0.35)` for panels.
- `--shadow-rise` — `0 1px 0 hsl(var(--gold) / 0.05), 0 6px 18px hsl(0 0% 0% / 0.35)` for floating surfaces (popovers, dialogs).

Wire into utility classes `.surface-panel`, `.surface-row`, `.surface-raised` so panels can opt in by swapping one className (or by updating `.ornate-border` to use the new inset shadow — recommended, since most panels already use it).

### 4. Section separators
Replace flat 1px `border-t border-border` dividers with a gilded hairline class:
```css
.divider-hairline {
  height: 1px;
  background: linear-gradient(
    to right,
    transparent,
    hsl(var(--gold) / 0.18) 20%,
    hsl(var(--gold) / 0.18) 80%,
    transparent
  );
}
```
Used opt-in where current dividers feel flat (NodeView section breaks, CharacterPanel tab content separators, EventLogPanel tick separator). Existing `border-t border-border` keeps working everywhere else.

### 5. Readability tuning for long sessions
- Lift `--foreground` lightness +3% (85 → 88) — body text gains contrast on the darker surface-1.
- Lift `--muted-foreground` +5% so meta text remains legible against the new `--surface-3`.
- Tighten `event-log-line` left border to `--border-subtle` so the log stops looking like a striped table.
- Slight bump to `--gold` glow on `.text-glow` (already used for displays) — unchanged hue, just a hair more presence.

## What does NOT change

- No component file is rewritten. Token re-pointing flows through every existing `bg-card`, `border-border`, `bg-popover`, etc. automatically.
- No layout, spacing, font, icon, or copy change.
- Rarity colors, log palette, combat visuals, gateway/auth styling untouched.
- No new dependencies.

## Files touched

- `src/index.css` — add surface/border/shadow tokens, update `.ornate-border`, add `.divider-hairline`, `.surface-panel`, `.surface-row`, `.surface-raised`, tweak `.event-log-line`.
- `tailwind.config.ts` — expose `border-subtle`, `border-strong`, and `surface.{1,2,3,raised}` color tokens (purely additive; existing classes keep working).
- Optional 3–4 surgical className swaps in `NodeView.tsx`, `CharacterPanel.tsx`, `EventLogPanel.tsx` to apply `.divider-hairline` at the most-seen section breaks. Each is a one-line edit.

## Verification

After applying:
1. Open the game preview at `/` → confirm panels read as three depth layers (outer shell darker, panels mid, nested rows lighter).
2. Open Character Panel → equipment slots and inventory rows should sit visibly *on* the panel, not flush with it.
3. Open Event Log during combat → tick separators and entry stripes look gilded, not blocky.
4. Compare night-session readability: body text on `--surface-1` should pass WCAG AA against the darker shell.
5. No regressions in service panels, tooltips, marketplace, blacksmith — they consume the same tokens and inherit the new ramp.
