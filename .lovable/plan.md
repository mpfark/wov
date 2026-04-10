

# Fix: Summon Request Placement + Summoner Feedback

## Confirmed Code Locations

- **SummonRequestNotification** (incoming): Currently in `GamePage.tsx` line 881, renders below header — **wrong place**, breaks UI
- **SummonPlayerPanel** (outgoing): In `MapPanel.tsx` line 452 — **correct place**
- Both should live together in the MapPanel summon section

## Changes

### 1. Move notification into MapPanel (`GamePage.tsx` + `MapPanel.tsx`)

**`src/pages/GamePage.tsx`**:
- Remove the `SummonRequestNotification` block (lines 881-898)
- Pass `pendingSummons`, `acceptSummon`, `declineSummon` as new props to `MapPanel`

**`src/features/world/components/MapPanel.tsx`**:
- Add props: `pendingSummons`, `onAcceptSummon`, `onDeclineSummon`, `onSummonRefetch`
- Render `SummonRequestNotification` just above `SummonPlayerPanel` (around line 452), inside the same `border-t` section
- The notification inherits the existing `addLog` and `inCombat` props already available in MapPanel

### 2. Summoner feedback (`SummonPlayerPanel.tsx`)

**`src/features/world/components/SummonPlayerPanel.tsx`**:
- After inserting a summon request, subscribe to realtime changes on `summon_requests` filtered by `summoner_id = characterId`
- When status changes to `accepted` → show success feedback + log message
- When status changes to `declined` → show declined feedback + log message
- Clean up channel on unmount

## Files touched

| File | Change |
|------|--------|
| `src/pages/GamePage.tsx` | Remove notification from header, pass summon props to MapPanel |
| `src/features/world/components/MapPanel.tsx` | Accept summon notification props, render in summon section |
| `src/features/world/components/SummonPlayerPanel.tsx` | Subscribe to outgoing request status changes for summoner feedback |

