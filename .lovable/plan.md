# Service Panel Mini Event Log

Add a small, immersive 5-line log strip inside service popups (Blacksmith, Jewelcrafter, and other service shells) that mirrors the main Event Log entries triggered while the panel is open. Replaces noisy toasts for in-panel actions.

## Goals
- Player gets immediate, visible feedback inside the dialog when something happens (item crafted, gem socketed, refurbished, salvage sold, etc.).
- Mirrors the main Event Log styling/text so it's consistent and immersive.
- Reduces reliance on toast popups for service actions.

## Where it lives
A new component `ServicePanelMiniLog` rendered inside `ServicePanelShell` as an optional strip pinned just above the footer (or above the body's bottom edge when no footer). Max 5 lines, newest at top, fades older lines.

```text
┌───────────────────────────────┐
│ header / tabs                 │
│ left            │ right       │
│                 │             │
├───────────────────────────────┤
│ ✦ mini event log (5 lines)   │  ← new
├───────────────────────────────┤
│ footer (optional)             │
└───────────────────────────────┘
```

## How entries get in
Two sources, no duplication:

1. **Local feed** — each service panel already calls `addLog(msg)` for its actions. We extend the shell to accept a `logFeed` array (or expose a tiny `useServicePanelLog()` hook the panel pushes into). The panel passes its last N lines so the mini-log shows them.
2. **Optional global mirror** — subscribe to the same event-log stream the main `EventLogPanel` reads, filtered to entries for the current character that occurred while the panel is open. This catches server-driven lines like "💎 Forged Iron Ring" that come back via broadcasts.

The hook returns a merged, de-duplicated, time-ordered list capped at 5.

## Styling
- White/parchment text, small (`text-[11px]`), single line each with truncate + title tooltip.
- Use `getLogColor` from `combat-log-utils.ts` so colors match the main Event Log.
- Subtle top divider (`── ✦ ──`) to separate from body, no heavy background.

## Toast cleanup
Within Blacksmith, Jewelcrafter, Vendor, Marketplace, Teleport, Inn, Stonebinder, Soulforge: remove success toasts for actions that now show up in the mini-log. Keep toasts only for:
- Errors that block the action (insufficient gold, validation).
- Out-of-panel notifications (sales completed while away).

## Files to touch
- `src/components/ui/ServicePanelShell.tsx` — new optional `miniLog` slot + render.
- `src/components/ui/ServicePanelMiniLog.tsx` — new component (5-line capped list).
- `src/features/combat/hooks/` — small `useServicePanelLog(characterId, open)` hook that taps the existing event-log broadcast stream.
- Service panels: `BlacksmithPanel.tsx`, `JewelcrafterPanel.tsx`, `VendorPanel.tsx`, `MarketplacePanel.tsx`, `StonebinderPanel.tsx`, `SoulforgeDialog.tsx`, and the Teleport/Inn dialogs — wire the feed and trim redundant toasts.

## Out of scope
- No changes to the main Event Log behavior or storage.
- No new DB tables; reuses existing broadcast/log streams.

## Open question
Should the mini-log show **only events triggered from this panel** (cleanest, most immersive), or **all events for the character while the panel is open** (also shows e.g. a party member's action)? Default proposal: panel-scoped only.
