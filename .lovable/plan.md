

# Integrate Teleport into Player World Map

## Goal
Let players click teleport nodes directly on the world map to teleport, instead of using the separate list dialog. Teleport-eligible nodes get a distinctive visual treatment (teleport-colored outline ring). Clicking one shows a confirmation tooltip with the CP cost.

## Design

### Visual Treatment
- Teleport nodes (`is_teleport && visited`) get an extra outline ring using the teleport color (`hsl(var(--primary))` — the 🌀 color used throughout the teleport UI)
- A small 🌀 icon rendered below/inside teleport nodes for quick identification
- Current node is excluded from teleport targets (can't teleport to yourself)

### Interaction Flow
1. Player opens world map
2. Teleport nodes are visually distinct with a colored ring
3. Clicking a teleport node (not the current node) shows a small confirmation popover/tooltip: node name, region, CP cost, and a "Teleport ⚡ X CP" button
4. Clicking the button calls `onTeleport(nodeId, cpCost)` and closes the map
5. If player can't afford the CP, the button is disabled with muted styling
6. Non-teleport nodes remain non-interactive (no click action beyond hover)

### Props Changes

**PlayerWorldMapDialog** — add new props:
```typescript
// Teleport integration
playerCp?: number;
playerMaxCp?: number;
currentRegion?: Region;
onTeleport?: (nodeId: string, cpCost: number) => void;
characterLevel?: number;
inCombat?: boolean;
```

When `onTeleport` is provided, teleport mode is active on the map.

**MapPanel** — pass teleport props through to PlayerWorldMapDialog:
- `playerCp`, `currentRegion`, `onTeleport` (from `onOpenTeleport` handler equivalent), `characterLevel`, `inCombat`

**GamePage** — pass `handleTeleport`, `character.cp`, `currentRegion`, `character.level`, and `inCombat` into the MapPanel props, which forwards them to PlayerWorldMapDialog.

### CP Cost Calculation
Reuse `calculateTeleportCpCost` from TeleportDialog — extract it to a shared location or inline the same logic. It's a pure function: `(fromRegion, toRegion) => cost`.

### Confirmation UI
A small SVG `<foreignObject>` or absolutely-positioned HTML tooltip near the clicked node showing:
- Node name + region name + level range
- "⚡ X CP" teleport button (disabled if insufficient CP)
- Click away to dismiss

### Files Changed

| File | Change |
|------|--------|
| `src/features/world/components/PlayerWorldMapDialog.tsx` | Add teleport ring rendering, click handler, confirmation tooltip, CP cost logic |
| `src/features/world/components/MapPanel.tsx` | Pass teleport-related props through to PlayerWorldMapDialog |
| `src/pages/GamePage.tsx` | Pass `handleTeleport`, CP, region, level, combat state to MapPanel |
| `src/features/world/components/TeleportDialog.tsx` | Export `calculateTeleportCpCost` for reuse |

### Not Changed
- TeleportDialog still works as before (list view remains accessible from the teleport button)
- No combat, movement, or server changes
- Waymark and party-member teleport stay in the list dialog only (map is for node-to-node teleport)

