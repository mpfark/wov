// World feature — hooks, components, and types for world/node navigation

export { useNodes, getNodeDisplayName, getNodeDisplayDescription } from './hooks/useNodes';
export type { GameNode, Region, Area, AreaType } from './hooks/useNodes';
export { useNodeChannel } from './hooks/useNodeChannel';
export type { PlayerPresence, NodeChannelHandle } from './hooks/useNodeChannel';
export { useKeyboardMovement, getKeyLabel } from './hooks/useKeyboardMovement';
export type { Direction, KeyBindings, ActionBindings, ActionName } from './hooks/useKeyboardMovement';
export { useAreaTypes } from './hooks/useAreaTypes';
export type { AreaTypeEntry } from './hooks/useAreaTypes';

// Area color utilities
export * from './utils/area-colors';

// Movement action orchestration hook
export { useMovementActions } from './hooks/useMovementActions';
export type { UseMovementActionsParams } from './hooks/useMovementActions';
