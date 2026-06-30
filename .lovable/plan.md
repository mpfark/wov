## Goal
Streamline the Trainer dialog:
1. Remove the separate **Respec** tab and surface the respec action directly on the **Allocate** tab.
2. Restructure the Allocate tab to a two-column layout so the Impact Preview sits to the **right** of the stat allocator instead of below it (eliminates vertical scroll).

## Changes

### 1. `src/features/character/components/StatPlannerDialog.tsx` (StatPlannerBody)
- Add optional props: `respecAvailable?: boolean`, `respecPoints?: number`, `onRequestRespec?: () => void`, `manualBreakdown?: ReactNode` (or compute internally via passed character helpers).
- Split the body's JSX into two columns when used in panel mode:
  - **Left column**: points-remaining header, the 6 stat allocation rows, the commit/reset actions, and (new) a small **Respec** section at the bottom showing remaining respec points + a "Spend 1 Respec Point — Refund Manual Allocations" button (only when `respecAvailable`). Tucked under a divider so it stays unobtrusive when the player only wants to allocate.
  - **Right column**: the Impact Preview block. Always rendered (placeholder text when `totalSpent === 0`, e.g. "Allocate points to preview their impact").
- Add a layout prop (`layout?: 'stacked' | 'split'`) so the standalone `StatPlannerDialog` keeps its current stacked look while the Trainer uses `split`.

### 2. `src/features/character/components/TrainerPanel.tsx`
- Remove the `'respec'` value from `TrainerTab` and from the `TabsList` (becomes a 3-tab grid: Allocate / Renown / Board).
- Remove the `respecContent` block and the default-tab branch that selects respec.
- Pass respec props into `StatPlannerBody` (`respecAvailable`, `respecPoints`, `onRequestRespec={() => setShowRespecConfirm(true)}`, `layout="split"`).
- Switch the shell from `singleColumn` to two-column for the Allocate tab; Renown and Leaderboard stay single-column. Easiest: keep `singleColumn` on the shell and let `StatPlannerBody` render its own internal 2-column grid (avoids touching ServicePanelShell behavior).
- Keep the existing `AlertDialog` respec confirmation untouched — it now fires from inside the Allocate tab.
- When the user has 0 unspent points but still has respec points, the Allocate tab should still render (showing 0/0 points + the Respec button) instead of the "nothing to refine" empty state. Update that condition accordingly.

### 3. No backend / formula changes
Pure UI restructure. `onFullRespec`, `onBatchAllocateStats`, and all RPCs remain as-is.

## Visual sketch

```text
Allocate tab (split layout inside the panel):
┌───────────────────────────┬───────────────────────────┐
│ 3 / 5 points remaining    │ Impact Preview            │
│                           │  Max HP   42 → 46         │
│ STR  10  [-] +1 [+] 11    │  HP Regen  2 → 3          │
│ DEX  12  [-]  – [+] 12    │  AC        14 → 14        │
│ …                         │  …                        │
│                           │                           │
│ [Reset]   [Commit 3 pts]  │                           │
│ ─────────────────────     │                           │
│ Respec Points: 1          │                           │
│ [Spend 1 — Refund Manual] │                           │
└───────────────────────────┴───────────────────────────┘
```
