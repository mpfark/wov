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
}

export const SERVICES: ServiceDef[] = [
  // Order & Lineage
  { key: 'is_heraldry',     label: 'heraldry',       generic: 'a heraldry hall' },
  { key: 'is_trainer',      label: 'renown trainer', generic: "a renown trainer's hall" },
  // Trade & Craft
  { key: 'is_vendor',       label: 'vendor',         generic: 'a vendor stall' },
  { key: 'is_blacksmith',   label: 'blacksmith',     generic: "a blacksmith's forge" },
  { key: 'is_jewelcrafter', label: 'jewelcrafter',   generic: "a jeweler's bench" },
  { key: 'is_soulforge',    label: 'soulforge',      generic: 'a soulforge' },
  { key: 'is_stonebinder',  label: 'stonebinder',    generic: 'a stonebinder shrine' },
  // Environment
  { key: 'is_inn',          label: 'inn',            generic: 'an inn' },
  { key: 'is_teleport',     label: 'teleport',       generic: 'a teleport circle' },
];
