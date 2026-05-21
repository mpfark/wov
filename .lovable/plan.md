# Surface & Shadow Token Consistency Audit

## What I checked

Searched every panel, popover, tooltip, dialog, and row-style element in `src/features/**`, `src/components/game/**`, and the shadcn primitives. Cross-referenced against the ramp introduced in the last pass:

- Surfaces: `--surface-1` (shell) / `--surface-2` (panel, == card) / `--surface-3` (row, == muted) / `--surface-raised` (popover, tooltip, hover)
- Borders: `--border-subtle` / `--border` / `--border-strong`
- Shadows: `--shadow-inset-soft` (panels), `--shadow-rise` (floating)
- Dividers: `.divider-hairline`
- Row utility: `.surface-row`, panel utility: `.surface-panel`, raised utility: `.surface-raised`

## Findings

### 1. Inventory / equipment / list rows — biggest inconsistency

Across ~25 files the same nested-row treatment is open-coded as `border border-border bg-background/30` (or `/40`, `/50`, `/60`). These should all read as **surface-3** rows so they visibly sit on the panel.

Files: `CharacterPanel.tsx` (equipment slots, inventory items, belt rows, materials, gems, scrolls — ~8 occurrences), `MarketplacePanel.tsx` (×4), `VendorPanel.tsx` (×2), `BlacksmithPanel.tsx` (×3), `JewelcrafterPanel.tsx` (×5), `StonebinderPanel.tsx`, `TrainerPanel.tsx` (×3), `TeleportDialog.tsx`, `NodeView.tsx` (creature/NPC/player/loot cards), `PartyPanel.tsx`, `InspectPlayerDialog.tsx`, `MaterialsSection.tsx`, `GemPouch.tsx`.

Migration: replace the literal `bg-background/30..60 border border-border` pattern with the `surface-row` utility class. Selected/active variants keep their `border-primary bg-primary/10` override on top.

### 2. Floating surfaces don't use the rise shadow

`Tooltip`, `Popover`, `HoverCard`, `BroadcastDebugOverlay`, `gateway-card` consumers, and ad-hoc dropdown menus still render with `shadow-md` / `shadow-lg` / `shadow-xl`. They already pull `bg-popover` (surface-raised), but the shadow is generic.

Migration: add a single `.surface-raised` opt-in (or extend the existing class application) on the three shadcn primitives (`tooltip.tsx`, `popover.tsx`, `hover-card.tsx`) so they all use `var(--shadow-rise)` and the strong border. `BroadcastDebugOverlay` swaps `shadow-xl` → `surface-raised`.

### 3. Dialog uses `bg-background` instead of a panel surface

`src/components/ui/dialog.tsx` renders dialogs on `bg-background shadow-lg` — so dialogs look identical to the app shell, defeating the layer ramp. Every game dialog (NPC, Teleport, SoulforgeDialog, StatPlanner, Inspect, ReportIssue, Summon, etc.) inherits this.

Migration: change shadcn `DialogContent` base to `bg-card border-border-strong shadow-rise` so dialogs read as a raised panel. Per-dialog overrides (`bg-card`, `border-primary/30`, etc.) continue to win.

### 4. Card primitive still uses generic `shadow-sm`

`src/components/ui/card.tsx` uses `shadow-sm`. Either drop it or swap to `shadow-[var(--shadow-inset-soft)]` so generic `<Card>` matches `.ornate-border` panels.

### 5. Flat `border-t border-border` section dividers inside panels

Still present in `CharacterPanel.tsx` (×3 — attribute breakdown, totals row, derived stats), `StatPlannerDialog.tsx`, `MarketplacePanel.tsx`, `TrainerPanel.tsx`, `VendorPanel.tsx` (×2), `BlacksmithPanel.tsx` (×2), `JewelcrafterPanel.tsx` (×2). NodeView and EventLog already migrated.

Migration: replace each visible section break with `<div className="divider-hairline my-2" />`. The flat 1px treatment may stay where it's a true edge (panel header bottom, footer top) — those should switch to `border-border-subtle` instead of being made gilded.

### 6. Event Log container is still flat

`EventLogPanel.tsx`'s scrollable container uses `bg-background/30 rounded border border-border`. The container should be a surface-3 row well: replace with `surface-row rounded`.

### 7. ServicePanelShell footer divider

`ServicePanelShell.tsx:139` hardcodes `border-t border-[hsl(var(--gold)/0.2)] bg-background/20`. Swap to `divider-hairline` above an unstyled footer (or `bg-surface-1/40`) for parity with header treatment.

### 8. ChatPanel uses bare `bg-card/60` and no row treatment

`src/features/chat/components/ChatPanel.tsx` — outer wrapper already uses `ornate-border` ✓, but the header divider is `border-b border-border`; should become `divider-hairline`. Messages render as flat `<p>` — no row treatment needed (chat is a stream, not a list).

### 9. Tab strips are inconsistent

`CharacterPanel.tsx:360` uses `bg-muted/50`, `TrainerPanel.tsx:153` uses `bg-background/40`. Both should land on a single token — recommend `bg-surface-3/60` so tab strips sit visibly on `surface-2` panels.

## Scope of changes

All work happens in the **presentation layer**:

- `src/components/ui/tooltip.tsx`, `popover.tsx`, `hover-card.tsx`, `dialog.tsx`, `card.tsx` — one-line className edit each.
- `src/components/ui/ServicePanelShell.tsx` — footer divider swap.
- ~25 feature files — mechanical replacement of `border border-border bg-background/30..60` → `surface-row`, and `border-t border-border` (inside content) → `<div className="divider-hairline my-2" />`.
- `src/features/combat/components/EventLogPanel.tsx` — log container class swap.
- `src/features/chat/components/ChatPanel.tsx` — header divider swap.

No new tokens. No logic, state, layout, or copy changes. No component rewrites — only className edits to consume the existing ramp.

## What stays as-is

- Selected/active/error states (`border-primary bg-primary/10`, `border-destructive`, `border-elvish/40`) — they override the row class and should keep their meaning.
- Specialized surfaces: `scroll-panel-inner`, `gateway-card`, sidebar — they have their own visual systems.
- Combat status bars (`bg-background rounded-full overflow-hidden`) — these are progress wells, not rows; correct as-is.
- Admin pages — out of scope for player-facing readability pass.

## Verification

1. Open Character Panel → Equipment, Inventory, Belt, Attribute tabs: every row sits visibly on the panel, no flat sections.
2. Hover an item → tooltip pops with rise shadow and stronger border.
3. Open any dialog (Teleport, Soulforge, Inspect, NPC) → dialog reads as a raised panel, not a full-screen flat surface.
4. Open Marketplace, Vendor, Blacksmith, Jewelcrafter, Stonebinder → list rows match Character Panel rows.
5. Event Log container reads as a sunken well; tick dividers and section dividers are gilded hairlines.
6. No regressions in selected/hover/active states (rarity colors, party highlights, target ring).

## Files touched (estimate)

- 5 shadcn primitives (one-line each)
- 1 ServicePanelShell
- ~12 feature panel files (mechanical class swaps)
- 1 EventLogPanel, 1 ChatPanel

All changes are className-only.
