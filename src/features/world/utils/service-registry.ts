/**
 * Single source of truth for "what services a node offers" — used by the
 * adjacency description so that adding a new service (e.g. is_alchemist)
 * automatically appears in nearby-landmark sentences.
 *
 * Note: the icon strip at the top of NodeView still enumerates flags by
 * hand. That's an intentional separate concern (service icons are bespoke,
 * tooltips, NPC-staffed glow, etc.).
 */

export interface ServiceDef {
  /** Node column / flag — checked for truthiness on the target node. */
  key: string;
  /** Short label used inside parentheses after a named landmark. */
  label: string;
  /** Phrase used when the node has no custom name of its own. */
  generic: string;
  /**
   * Marker colour for the service dot rendered at the edge of a map node.
   * Raw HSL triplets (not tokens) because they are consumed by SVG `fill`
   * and inline styles where Tailwind classes cannot reach.
   */
  color: string;
}

export const SERVICES: ServiceDef[] = [
  // Order & Lineage
  { key: 'is_heraldry',     label: 'heraldry',       generic: 'a heraldry hall',        color: 'hsl(275 55% 62%)' },
  { key: 'is_trainer',      label: 'renown trainer', generic: "a renown trainer's hall", color: 'hsl(200 65% 55%)' },
  // Trade & Craft
  { key: 'is_vendor',       label: 'vendor',         generic: 'a vendor stall',          color: 'hsl(45 85% 55%)' },
  { key: 'is_blacksmith',   label: 'blacksmith',     generic: "a blacksmith's forge",    color: 'hsl(18 75% 52%)' },
  { key: 'is_jewelcrafter', label: 'jewelcrafter',   generic: "a jeweler's bench",       color: 'hsl(170 60% 48%)' },
  { key: 'is_soulforge',    label: 'soulforge',      generic: 'a soulforge',             color: 'hsl(300 75% 62%)' },
  { key: 'is_stonebinder',  label: 'stonebinder',    generic: 'a stonebinder shrine',    color: 'hsl(220 70% 62%)' },
  { key: 'is_marketplace',  label: 'marketplace',    generic: 'a marketplace',           color: 'hsl(95 45% 50%)' },
  // Environment
  { key: 'is_inn',          label: 'inn',            generic: 'an inn',                  color: 'hsl(30 45% 60%)' },
  { key: 'is_teleport',     label: 'teleport',       generic: 'a teleport circle',       color: 'hsl(190 85% 60%)' },
];

export interface ServiceMarker extends ServiceDef {
  /** Title-cased label for tooltips. */
  title: string;
}

/** Services present on a node, in canonical SERVICES order. */
export function nodeServiceMarkers(node: unknown): ServiceMarker[] {
  const n = node as Record<string, unknown> | null | undefined;
  if (!n) return [];
  const out: ServiceMarker[] = [];
  for (const svc of SERVICES) {
    if (n[svc.key]) {
      out.push({ ...svc, title: svc.label.charAt(0).toUpperCase() + svc.label.slice(1) });
    }
  }
  if (typeof n.class_hall === 'string' && n.class_hall) {
    const cls = n.class_hall.charAt(0).toUpperCase() + n.class_hall.slice(1);
    out.push({
      key: 'class_hall',
      label: `${cls} order hall`,
      generic: 'an order hall',
      color: 'hsl(50 90% 62%)',
      title: `${cls} Order Hall`,
    });
  }
  return out;
}

