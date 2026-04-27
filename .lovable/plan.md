## Goal

Create a shared `ServicePanelShell` that gives Marketplace, Vendor, Blacksmith, Teleport (and future Inn / Forge) panels a unified, fixed-size, two-column layout with internal scrolling — matching the existing parchment / wax-seal aesthetic. No gameplay logic changes.

## Current state

Today there are two competing patterns:

- **Parchment shell** — `src/features/inventory/components/ScrollPanel.tsx` (used by Vendor, Blacksmith, Teleport). Provides ornate frame, gold filigree corners, wax-seal close, divider. Container size is `max-w-lg` / `max-w-2xl` with `max-h-[80vh]` and `overflow-y-auto` on the whole panel — so the entire parchment scrolls and total height grows with content.
- **Plain `DialogContent`** — `src/features/marketplace/components/MarketplacePanel.tsx`. Standard dialog header, `Tabs`, internal `ScrollArea` regions of `h-[55vh]` / `h-[42vh]`. Visually inconsistent with the parchment service panels.

Inside both patterns each panel hand-rolls its own grid (`grid-cols-1 sm:grid-cols-2 gap-4`) with ad-hoc `max-h-[40vh] overflow-y-auto` blocks per column. Footer actions (Forge button, List Item button, Collect Earnings) are inlined inside content rather than pinned.

## Design

Introduce **one** shell component that subsumes `ScrollPanel`, keeps the parchment look, and adds a fixed-size left/right/footer skeleton. Existing panels move their content into the new slots; `ScrollPanel` is re-exported as a thin wrapper for backward compatibility (single-column callers).

### New component

`src/components/ui/ServicePanelShell.tsx`

```ts
interface ServicePanelShellProps {
  open: boolean;
  onClose: () => void;
  icon: string;                      // e.g. '🪙'
  title: string;                     // e.g. 'Vendor'
  subtitle?: ReactNode;              // optional sub-line under title (e.g. gold counter, badge)
  headerActions?: ReactNode;         // optional top-right slot (next to wax seal)
  tabs?: ReactNode;                  // optional Tabs trigger row rendered under header
  left: ReactNode;                   // scrollable left column (list / nav)
  right: ReactNode;                  // scrollable right column (detail / actions)
  footer?: ReactNode;                // pinned footer (totals, primary CTA)
  size?: 'md' | 'lg';                // default 'lg'
  singleColumn?: boolean;            // collapses to one centered column (Teleport, future Inn)
}
```

### Fixed dimensions

Driven by a shell-internal class (no per-panel sizing):

| Breakpoint | Width | Height |
|---|---|---|
| Desktop (≥1024px) | `min(1100px, 92vw)` for `lg`, `min(820px, 92vw)` for `md` | `min(760px, 84vh)` |
| Tablet (≥640px) | `94vw` | `86vh` |
| Mobile (<640px) | `100vw` | `100vh` (full-screen sheet feel) |

Implemented as a single utility class `service-panel-shell` plus a `service-panel-shell--md` modifier in `src/index.css` so all panels stay in lockstep.

### Internal layout

```text
┌───────────────────────────────────────────────────────┐
│ Header  ❧ icon title  · subtitle      headerActions ✕│  fixed
│ ─────────── ✦ ───────────                            │
│ [optional Tabs row]                                  │  fixed
├───────────────────────┬──────────────────────────────┤
│ Left column           │ Right column                 │
│ overflow-y: auto      │ overflow-y: auto             │  flex-1
│ (list / nav)          │ (detail / actions / form)    │
│                       │                              │
├───────────────────────┴──────────────────────────────┤
│ Footer (totals · primary CTA)                        │  fixed (optional)
└───────────────────────────────────────────────────────┘
```

- Outer wrapper: `flex flex-col` with the fixed `service-panel-shell` size.
- Header: keeps existing `scroll-corner` filigree, `scroll-divider`, `wax-seal-close`. Title row supports `subtitle` and `headerActions`.
- Tabs row: optional thin band; when present, sits between divider and body.
- Body: `flex flex-1 min-h-0` with two children (`left`, `right`) each `flex-1 min-h-0 overflow-y-auto`. A single vertical gold-tinted border separates them. When `singleColumn`, only `left` is rendered, centered with a max-width.
- Footer: optional, separated by a thin divider. Always pinned (does not scroll).

### Backward compatibility

- `ScrollPanel` becomes a thin wrapper that calls `ServicePanelShell` with `singleColumn` and slots `children` into `left`. No call-site changes required for `ScrollPanel` consumers — but Teleport will be migrated to the shell directly during this pass.
- The dialog closure and `Dialog` host stay in each panel (so we don't change focus / onClose behavior). The shell only renders the inner content (it replaces the `<DialogContent>` JSX).

## Per-panel mapping

### MarketplacePanel
- **Header**: title `Marketplace` + `Unique items only` badge in `subtitle`. Player gold + uncollected earnings count moves to `headerActions`.
- **Tabs row**: existing `Browse / My Listings / List Item` tabs.
- **Left**: tab-dependent list — Browse listings table, My Listings table, or eligible inventory picker.
- **Right**: tab-dependent detail/action — for `Browse` shows seller/price/durability detail of the highlighted row (and Buy button); for `Mine` shows uncollected sales summary + warning; for `Create` shows price input, tax breakdown, and the listing warning.
- **Footer**: tab-dependent primary CTA — `Buy` (when row selected), `Collect N gold` (My Listings), `List Item` (Create).

### VendorPanel
- **Header**: title `Vendor`, gold counter in `subtitle`, CHA bonuses note in `headerActions` tooltip.
- **Tabs row**: new `Buy / Sell` tabs (replacing the current side-by-side columns) so the shell's two-pane structure is used for list + detail rather than two parallel lists.
  - **Left**: items list for the active tab (vendor stock or sellable inventory) with stack badges.
  - **Right**: selected-item detail pane (name, slot, stats summary, vendor price vs. CHA-discounted price, Buy/Sell button).
- **Footer**: gold total + `Buy/Sell` CTA for the selected item.

### BlacksmithPanel
- **Header**: title `Blacksmith`. Gold + salvage counters in `subtitle`.
- **Tabs row**: existing `Repair / Forge` tabs.
- **Repair tab**:
  - Left: damaged-items list.
  - Right: How-Repair-Works info + selected item's repair details (cost, durability bar).
  - Footer: `Repair All (Ng)` button when more than one repairable item.
- **Forge tab**:
  - Left: slot picker + Sell-Salvage card.
  - Right: forge-pool list and per-item tooltip preview (kept).
  - Footer: `Forge Selected Item` button (currently inside right column).

### TeleportDialog
- Uses `singleColumn` (no second pane needed).
- **Header**: title `Teleport`, current CP in `subtitle`.
- **Left** (single column): Waymark return → Party members → Standard destinations, in current order.
- **Footer**: none.

### Future (no work this pass, just confirming the shape fits)
- **Inn**: left = service options (rest, save waymark), right = current effects/preview, footer = primary action.
- **Item Forge** (admin AI tool): left = parameter form, right = preview, footer = generate.

## Visual consistency rules baked into the shell

- Header: `font-display text-lg text-primary text-glow text-center tracking-wide`, padding `px-5 pt-4 pb-2`.
- Divider: existing `scroll-divider` `── ✦ ──` line.
- Inter-pane border: `border-l border-gold/20` on the right pane on `sm+`.
- Section titles inside slots: helper class suggestion `font-display text-xs text-muted-foreground uppercase tracking-wide` documented in the shell file's JSDoc (no enforcement).
- Empty-state pattern: helper sub-component `<ServicePanelEmpty>` rendering `text-xs text-muted-foreground italic` so all panels say "No X" the same way.
- Selection highlight on rows: `border-primary bg-primary/10` (already used in Blacksmith forge pool) — documented in JSDoc.

## Files

**New**
- `src/components/ui/ServicePanelShell.tsx` — shell + `ServicePanelEmpty` helper.

**Modified**
- `src/index.css` — add `.service-panel-shell` and `.service-panel-shell--md` size rules; reuse existing `scroll-panel-inner` background.
- `src/features/inventory/components/ScrollPanel.tsx` — re-implement as thin wrapper around `ServicePanelShell` (singleColumn). No call-site breaking changes.
- `src/features/inventory/components/VendorPanel.tsx` — restructure into Buy/Sell tabs feeding `left` (list) + `right` (detail) + `footer` (CTA). Logic untouched: `buyItem`, `sellItem`, RPC calls, CHA math all preserved.
- `src/features/inventory/components/BlacksmithPanel.tsx` — move repair-all and forge buttons into `footer`; split each tab's existing two columns into `left` / `right` slots. All RPC and state logic preserved.
- `src/features/marketplace/components/MarketplacePanel.tsx` — replace `DialogContent` body with shell; keep `useMarketplace`, tab state, formatters, and all transactional handlers identical.
- `src/features/world/components/TeleportDialog.tsx` — switch to `ServicePanelShell` with `singleColumn`.

**Not touched**
- `useMarketplace`, `useInventory`, `blacksmith-forge` edge function, `buy_vendor_item` / `sell_item` RPCs, party / movement code, combat code.

## Testing checklist (post-build)

- Vendor / Blacksmith / Marketplace / Teleport open at the same fixed size.
- Switching tabs or filtering does not change panel size.
- Each pane scrolls independently; header, tab row, and footer never scroll.
- Mobile view: panel goes full-screen; left/right stack vertically.
- Existing flows still work: buy/sell, repair/forge, list/buy/collect on marketplace, teleport (incl. waymark / party member targets).
- `ScrollPanel` consumers (none beyond the four panels) still render correctly through the wrapper.

## Out of scope

- No redesign of any individual workflow.
- No changes to dialog open/close orchestration in `GamePage.tsx`.
- No new gameplay features. No DB migrations.
