/**
 * NPC Dialogue Topics — data-driven branching dialogue.
 *
 * Stored on `npcs.dialogue_topics` as JSONB. Each topic is a small object
 * the admin authors; the player sees them as clickable questions.
 *
 * Reserved fields (`requires`, `follow_up`) are not yet wired but are
 * intentionally part of the shape so future quest/lore work doesn't need
 * another migration.
 */
import type { GameNode, Region, Area } from '@/features/world/hooks/useNodes';
import { describeDirection, directionSentence } from '@/features/world/utils/directions';
import { CLASS_LABELS } from '@/shared/formulas/classes';

export type TopicKind = 'text' | 'class_hall_dir' | 'class_hall_menu' | 'hunt_dir';

export interface DialogueTopic {
  id: string;
  label: string;
  kind: TopicKind;
  response?: string;
  params?: Record<string, any>;
  /** Reserved for future gating (quest flags, bond, class, level, items). */
  requires?: Record<string, any>;
  /** Reserved for nested topics. */
  follow_up?: DialogueTopic[];
}

export interface ResolvedTopic {
  id: string;
  label: string;
  response: string;
}

export interface ResolverContext {
  fromNode: GameNode | null | undefined;
  nodes: GameNode[];
  regions: Region[];
  areas: Area[];
  /** Asking character's level — required for level-aware topics like hunt_dir. */
  characterLevel?: number;
}


function regionName(regions: Region[], id: string): string {
  return regions.find(r => r.id === id)?.name ?? 'an unknown region';
}

function areaName(areas: Area[], id: string | null | undefined): string | null {
  if (!id) return null;
  return areas.find(a => a.id === id)?.name ?? null;
}

function hallResponse(ctx: ResolverContext, klass: string): string {
  const label = CLASS_LABELS[klass] ?? klass;
  const hall = ctx.nodes.find(n => (n as any).class_hall === klass);
  if (!hall) {
    return `The ${label} Order has no hall I know of. Strange days indeed.`;
  }
  if (!ctx.fromNode) {
    return `The ${label} Hall stands in ${regionName(ctx.regions, hall.region_id)}.`;
  }
  if (hall.id === ctx.fromNode.id) {
    return `You stand within the ${label} Hall this very moment.`;
  }
  const sameRegion = hall.region_id === ctx.fromNode.region_id;
  const hint = describeDirection(ctx.fromNode, hall);
  const where = sameRegion
    ? `here in ${regionName(ctx.regions, hall.region_id)}`
    : `in ${regionName(ctx.regions, hall.region_id)}`;
  const area = areaName(ctx.areas, hall.area_id);
  const areaClause = area ? ` (near ${area})` : '';
  return `The ${label} Hall ${directionSentence(hint)}, ${where}${areaClause}.`;
}

function huntResponse(ctx: ResolverContext): string {
  const level = ctx.characterLevel;
  if (!level || level < 1) {
    return "Come back when you've cut your teeth a little. I can't measure prey for one with no measure of their own.";
  }
  // Areas that have valid level bounds and cover this character's level.
  const matches = ctx.areas.filter(
    a => typeof a.min_level === 'number' && typeof a.max_level === 'number'
      && level >= (a.min_level as number) && level <= (a.max_level as number),
  );
  if (matches.length === 0) {
    return `I know no fitting hunting ground for one of your measure (level ${level}). Perhaps no such reach has been charted yet.`;
  }
  // Prefer same region if possible.
  const fromRegion = ctx.fromNode?.region_id;
  const sameRegion = fromRegion ? matches.filter(a => {
    const node = ctx.nodes.find(n => n.area_id === a.id);
    return node?.region_id === fromRegion;
  }) : [];
  const pool = sameRegion.length > 0 ? sameRegion : matches;
  // Pick area whose midpoint is closest to the character's level.
  pool.sort((a, b) => {
    const am = ((a.min_level as number) + (a.max_level as number)) / 2;
    const bm = ((b.min_level as number) + (b.max_level as number)) / 2;
    const d = Math.abs(am - level) - Math.abs(bm - level);
    if (d !== 0) return d;
    if ((a.min_level as number) !== (b.min_level as number)) {
      return (a.min_level as number) - (b.min_level as number);
    }
    return a.name.localeCompare(b.name);
  });
  const area = pool[0];
  // Anchor: a node belonging to this area, picked deterministically by name.
  const anchorNodes = ctx.nodes
    .filter(n => n.area_id === area.id)
    .sort((a, b) => a.name.localeCompare(b.name));
  const anchor = anchorNodes[0];
  const region = ctx.regions.find(r => r.id === (anchor?.region_id ?? ''));
  const regionClause = region ? `, in ${region.name}` : '';
  if (!ctx.fromNode || !anchor) {
    return `If it's prey near your measure, try **${area.name}** (levels ${area.min_level}–${area.max_level})${regionClause}.`;
  }
  if (anchor.id === ctx.fromNode.id) {
    return `If it's prey near your measure, you're already standing in **${area.name}** — sharpen your blade and look around.`;
  }
  const hint = describeDirection(ctx.fromNode, anchor);
  return `If it's prey near your measure, try **${area.name}** (levels ${area.min_level}–${area.max_level}) — it ${directionSentence(hint)}${regionClause}.`;
}

/** Resolve a topic into a player-facing label + response string. */
export function resolveTopic(topic: DialogueTopic, ctx: ResolverContext): ResolvedTopic {
  switch (topic.kind) {
    case 'text':
      return { id: topic.id, label: topic.label, response: topic.response ?? '...' };
    case 'class_hall_dir': {
      const klass = String(topic.params?.class ?? '');
      return { id: topic.id, label: topic.label, response: hallResponse(ctx, klass) };
    }
    case 'class_hall_menu':
      // Handled by expandTopics — fall back to a hint.
      return {
        id: topic.id,
        label: topic.label,
        response: 'Which order would you like to hear about?',
      };
    case 'hunt_dir':
      return { id: topic.id, label: topic.label, response: huntResponse(ctx) };
    default:
      return { id: topic.id, label: topic.label, response: topic.response ?? '...' };
  }
}


/**
 * Expand author-authored topics into the final clickable list.
 * `class_hall_menu` explodes into one auto-topic per known order hall so
 * admins don't have to list seven entries by hand.
 */
export function expandTopics(
  topics: DialogueTopic[] | null | undefined,
  ctx: ResolverContext,
): DialogueTopic[] {
  if (!topics?.length) return [];
  const out: DialogueTopic[] = [];
  for (const t of topics) {
    if (t.kind === 'class_hall_menu') {
      const halls = ctx.nodes
        .map(n => (n as any).class_hall as string | null)
        .filter((c): c is string => !!c);
      const uniq = Array.from(new Set(halls));
      for (const klass of uniq) {
        const label = CLASS_LABELS[klass] ?? klass;
        out.push({
          id: `${t.id}__${klass}`,
          label: `Where is the ${label} Hall?`,
          kind: 'class_hall_dir',
          params: { class: klass },
        });
      }
    } else {
      out.push(t);
    }
  }
  return out;
}

/** Safe parser for the JSONB column. */
export function parseTopics(raw: unknown): DialogueTopic[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (t): t is DialogueTopic =>
      !!t && typeof t === 'object' && typeof (t as any).id === 'string' && typeof (t as any).label === 'string',
  );
}
