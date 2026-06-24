import type { GameNode } from '@/features/world/hooks/useNodes';
import { SERVICES } from './service-registry';

/**
 * Build "you can see ..." flavour lines for nodes adjacent to `node`.
 *
 * Includes a connected node when it has either:
 *   - a non-empty custom name (a named landmark), or
 *   - at least one service flag from SERVICES (or a class_hall).
 *
 * Hidden connections are skipped. Locked connections are kept — you can
 * still see the building from outside.
 */
export function describeAdjacentLandmarks(
  node: GameNode,
  allNodes: GameNode[],
): string[] {
  if (!node?.connections?.length) return [];
  const byId = new Map(allNodes.map(n => [n.id, n]));
  const lines: string[] = [];

  for (const conn of node.connections) {
    if (conn.hidden) continue;
    const target = byId.get(conn.node_id);
    if (!target) continue;

    const services: string[] = [];
    for (const svc of SERVICES) {
      if ((target as any)[svc.key]) services.push(svc.label);
    }
    if (target.class_hall) {
      const cls = target.class_hall.charAt(0).toUpperCase() + target.class_hall.slice(1);
      services.push(`${cls} Order Hall`);
    }

    const hasName = !!(target.name && target.name.trim());
    if (!hasName && services.length === 0) continue;

    const dir = conn.direction || 'nearby';
    if (hasName) {
      const tail = services.length ? ` (${services.join(', ')})` : '';
      lines.push(`To the ${dir} stands ${target.name.trim()}${tail}.`);
    } else {
      // No custom name — fall back to the first service's generic phrase.
      // Pick by SERVICES order so wording is deterministic.
      const firstSvc = SERVICES.find(s => (target as any)[s.key]);
      const generic = firstSvc?.generic ?? 'a place of note';
      lines.push(`To the ${dir} lies ${generic}.`);
    }
  }

  return lines;
}
