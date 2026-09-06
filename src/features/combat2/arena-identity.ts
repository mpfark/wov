/**
 * Stable, non-secret routing metadata for the permanent Combat2 proving ground.
 * Matching these IDs is only a frontend rollout gate; database access registration
 * and the server RPC authorization checks remain authoritative.
 */
export const COMBAT2_TEST_ARENA = {
  id: 'ffff5000-0000-4000-8000-000000000002',
  key: 'combat2_proving_ground',
  regionId: 'ffff5000-0000-4000-8000-000000000001',
  resetPhrase: 'RESET COMBAT2 TEST ARENA',
  nodes: [
    { id: 'ffff5010-0000-4000-8000-000000000001', purpose: 'staging', label: 'Staging Room' },
    { id: 'ffff5011-0000-4000-8000-000000000001', purpose: 'low', label: 'Low-Level Arena' },
    { id: 'ffff5012-0000-4000-8000-000000000001', purpose: 'equal', label: 'Equal-Level Arena' },
    { id: 'ffff5013-0000-4000-8000-000000000001', purpose: 'high_damage', label: 'High-Damage Arena' },
    { id: 'ffff5014-0000-4000-8000-000000000001', purpose: 'boss', label: 'Boss Chamber' },
  ],
} as const;

const arenaNodeIds = new Set<string>(COMBAT2_TEST_ARENA.nodes.map(node => node.id));
export function isCombat2TestArenaNode(nodeId: string | null | undefined): boolean {
  return typeof nodeId === 'string' && arenaNodeIds.has(nodeId.toLowerCase());
}
