

# Feature-Based Folder Structure Refactor

## Proposed Structure

Based on dependency analysis, here's the mapping of current files to feature folders:

```text
src/features/
├── combat/
│   ├── hooks/
│   │   ├── usePartyCombat.ts
│   │   ├── usePartyCombatLog.ts
│   │   ├── useGameLoop.ts
│   │   └── useCreatureBroadcast.ts
│   ├── utils/
│   │   ├── combat-math.ts        (from src/lib/)
│   │   ├── combat-resolver.ts    (from src/lib/)
│   │   └── class-abilities.ts    (from src/lib/)
│   └── index.ts
│
├── party/
│   ├── hooks/
│   │   ├── useParty.ts
│   │   └── usePartyBroadcast.ts
│   ├── components/
│   │   └── PartyPanel.tsx
│   └── index.ts
│
├── world/
│   ├── hooks/
│   │   ├── useNodes.ts
│   │   ├── useNodeChannel.ts
│   │   ├── useKeyboardMovement.ts
│   │   └── useAreaTypes.ts
│   ├── components/
│   │   ├── MapPanel.tsx
│   │   ├── MovementPad.tsx
│   │   ├── PlayerGraphView.tsx
│   │   ├── PlayerWorldMapDialog.tsx
│   │   ├── TeleportDialog.tsx
│   │   └── NodeView.tsx
│   ├── utils/
│   │   └── area-colors.ts        (from src/lib/)
│   └── index.ts
│
├── character/
│   ├── hooks/
│   │   └── useCharacter.ts
│   ├── components/
│   │   ├── CharacterPanel.tsx
│   │   ├── StatPlannerDialog.tsx
│   │   ├── BossTrainerPanel.tsx
│   │   └── StatusBarsStrip.tsx
│   └── index.ts
│
├── creatures/
│   ├── hooks/
│   │   ├── useCreatures.ts
│   │   └── useNPCs.ts
│   ├── components/
│   │   └── NPCDialogPanel.tsx
│   └── index.ts
│
├── inventory/
│   ├── hooks/
│   │   ├── useInventory.ts
│   │   ├── useItemCache.ts
│   │   └── useGroundLoot.ts
│   ├── components/
│   │   ├── VendorPanel.tsx
│   │   ├── BlacksmithPanel.tsx
│   │   ├── SoulforgeDialog.tsx
│   │   └── ScrollPanel.tsx
│   └── index.ts
│
├── chat/
│   ├── hooks/
│   │   └── useChat.ts
│   └── index.ts
│
└── README.md
```

## What stays in place

- `src/hooks/`: useAuth, useRole, useGlobalPresence, useInactivityLogout, useXpBoost, useBroadcastDebug, useActivityLog, useActions, useGameEvents, use-mobile, use-toast — these are shared/cross-cutting
- `src/lib/`: game-data.ts, utils.ts, version.ts, worker-timer.ts — shared utilities
- `src/components/ui/` — reusable UI primitives
- `src/components/admin/` — admin panel (separate domain, not part of this refactor)
- `src/components/game/`: HeartbeatIndicator, BroadcastDebugOverlay, OnlinePlayersDialog, InspectPlayerDialog, ReportIssueDialog — shared game chrome

## Execution order (incremental)

1. **Combat** — move 4 hooks + 3 utils, create barrel, update ~5 consumer files
2. **Party** — move 2 hooks + 1 component, update ~6 consumer files
3. **World** — move 4 hooks + 6 components + 1 util, update ~15 consumer files
4. **Character** — move 1 hook + 4 components, update ~14 consumer files
5. **Creatures** — move 2 hooks + 1 component, update ~5 consumer files
6. **Inventory** — move 3 hooks + 4 components, update ~6 consumer files
7. **Chat** — move 1 hook, update ~1 consumer file
8. **README** — document the folder philosophy

## Barrel file pattern

Each `index.ts` re-exports public types and hooks:
```typescript
// src/features/combat/index.ts
export { usePartyCombat } from './hooks/usePartyCombat';
export { usePartyCombatLog } from './hooks/usePartyCombatLog';
export { useGameLoop } from './hooks/useGameLoop';
export type { RegenBuff, DotDebuff, ... } from './hooks/useGameLoop';
export { useCreatureBroadcast } from './hooks/useCreatureBroadcast';
export * from './utils/combat-math';
export * from './utils/combat-resolver';
export * from './utils/class-abilities';
```

Consumer imports change from:
```typescript
import { usePartyCombat } from '@/hooks/usePartyCombat';
import { SHIELD_AC_BONUS } from '@/lib/combat-math';
```
To:
```typescript
import { usePartyCombat, SHIELD_AC_BONUS } from '@/features/combat';
```

## Key decisions

- **useActions stays in `src/hooks/`** — it's the central orchestrator that depends on combat, party, world, inventory, and character. It's truly cross-cutting.
- **game-data.ts stays in `src/lib/`** — used by nearly every feature; it's shared game constants/formulas.
- **Admin components not moved** — they're already cleanly grouped under `src/components/admin/`.
- **Tests stay in `src/test/`** — the combat resolver test already imports from `@/lib/combat-resolver`; its import path will update to `@/features/combat`.

## Risk mitigation

- Each feature move is a self-contained step — build/typecheck verified after each
- No logic changes, only file moves + import rewrites
- Barrel files ensure old-style granular imports still work if needed during transition

## Files touched

~40 files total across all 7 features (mostly import path updates). The heaviest consumers are `GamePage.tsx` (~15 import changes) and `useActions.ts` (~5 import changes).

