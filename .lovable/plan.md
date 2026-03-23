

## Dead Code Cleanup

### Confirmed Unused Files to Delete

| File | Reason |
|------|--------|
| `src/components/NavLink.tsx` | Never imported anywhere |
| `src/components/admin/RegionGraphView.tsx` | Never imported anywhere |
| `src/hooks/usePresence.ts` | Thin re-export shim — update 3 imports to use `useNodeChannel` directly |

### Deprecated Code to Remove

| Location | What | Reason |
|----------|------|--------|
| `src/hooks/useNodes.ts` | `AREA_TYPES` constant (lines 4-7) | Marked `@deprecated`, never imported — fully replaced by `useAreaTypes` hook |

### Import Updates (usePresence elimination)

These 3 files import `PlayerPresence` from `usePresence.ts` and should import from `useNodeChannel` directly:
- `src/components/game/NodeView.tsx`
- `src/components/game/MapPanel.tsx`
- `src/components/game/PartyPanel.tsx`

### Summary
- **3 files deleted** (NavLink, RegionGraphView, usePresence)
- **1 deprecated constant removed** (AREA_TYPES)
- **3 import paths updated** (PlayerPresence → useNodeChannel)

All other files I checked (BroadcastDebugOverlay, worker-timer, area-colors, useItemCache, useGameEvents, useKeyboardMovement, PopulateNodeSelector, ItemPickerList, GameManual, PwaUpdatePrompt, HeartbeatIndicator, version) are actively used.

