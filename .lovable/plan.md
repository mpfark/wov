

## Plan: Replace Local Area title bar with icon toolbar

Replace the "Local Area" header text and the entire top bar with a compact icon-only toolbar across the top of the Map panel. Icons get tooltips on hover. XP boost only renders when active and pulses.

### Layout
The Map panel header row becomes a single horizontal toolbar (no title text), icons spread across the available width:

```text
[⌨️] [☰legend] [👥 Online] [⚡Admin*] [🔄 Switch] [⚠️ Report]    [⚡2x pulsing*]    [🚪 Sign Out]
```
*Admin only visible to admins. XP boost only visible when `xpMultiplier > 1`.

All buttons are `size="icon" variant="ghost"` (h-8 w-8) wrapped in `Tooltip` with descriptive labels.

### Changes

**1. `src/features/world/components/MapPanel.tsx`**
- Remove the "Local Area" `<h2>` text from the header row.
- Restructure header as a flex row of icon buttons spanning full width: keyboard shortcuts (existing), legend (existing if any), Online Players, Admin (conditional), Switch Character, Report Issue, XP boost badge (conditional + pulsing), Sign Out (right-aligned, destructive tint).
- Wrap each icon button in `<Tooltip>` from `@/components/ui/tooltip` with clear labels ("Online Players", "Admin Panel", "Switch Character", "Report Issue", "Sign Out").
- Add new props: `appVersion`, `xpMultiplier`, `onlinePlayers`, `myCharacterId`, `isAdmin`, `onOpenAdmin`, `onSwitchCharacter`, `userId`, `characterId`, `characterName`, `onSignOut`.
- Use `OnlinePlayersDialog` and `ReportIssueDialog` in their existing `compact` mode (icon-only triggers).
- XP boost badge: only render when `xpMultiplier > 1`, using `animate-pulse` Tailwind class with `⚡ {xpMultiplier}x` content and gold styling. Tooltip shows "XP Boost active — expires {time}".
- Wrap the toolbar in a single `TooltipProvider`.

**2. `src/pages/GamePage.tsx`**
- Delete the entire top bar `<div>` block (the one containing title, version, XP badge, Online/Admin/Switch/Report/Sign Out buttons).
- Pass new props through `mapPanelProps` to `MapPanel`.
- Clean up unused imports (`APP_VERSION`, `Zap`, `RefreshCw`, `LogOut`, `OnlinePlayersDialog`, `ReportIssueDialog`) if no longer referenced.

### What stays unchanged
- All dialog components (Online Players, Report Issue) and their internal behavior
- Keyboard shortcuts popover (still icon-only, just sits in the new toolbar)
- Sheet overlays for mobile/tablet (Character, Map, Chat)
- All other game logic

### Edge cases
- Mobile: Map is in a Sheet — toolbar remains icon-only and fits comfortably.
- Tooltips on touch devices: Radix Tooltip auto-handles tap-to-show on touch.
- Layout reflow: removing the top bar gives the node view + event log extra vertical space automatically (existing `flex-1` handles it).

### Files touched
- `src/features/world/components/MapPanel.tsx` — replace title with icon toolbar, add props
- `src/pages/GamePage.tsx` — delete top bar, pass props

