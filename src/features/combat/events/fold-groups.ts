/**
 * fold-groups.ts — presentation-only correlation folding.
 *
 * The committed batch always keeps the authoritative events separate: a stance
 * pulse and the stack it landed are two events, and so are a creature swing and
 * the mitigation that ate it. Rendering them as two log lines is what reads
 * wrong, so this pure pass folds a group into ONE line — and only when the
 * structured facts prove the fold is truthful.
 *
 * Folding NEVER inspects prose and never invents an outcome:
 *   - pulse + stack fold only when both carry the same `group_id` and the pulse
 *     dealt positive damage. A stack applied without a damage pulse keeps its
 *     own line.
 *   - a creature hit folds into its mitigation only when they share `group_id`,
 *     the attack landed, `applied_amount === 0`, and mitigation covered the
 *     whole attempted amount. Misses, dodges, immunity, natural zero damage and
 *     partial mitigation are never folded, and two swings in one tick carry
 *     different groups so they can never cross-match.
 */

/** Loose shape of a server tick event, as it arrives from a committed batch. */
export interface FoldableEvent {
  type: string;
  message: string;
  group_id?: string;
  damage?: number;
  amount?: number;
  attempted_amount?: number;
  mitigated_amount?: number;
  applied_amount?: number;
  mitigation_source?: string;
  stacks?: number;
  max_stacks?: number;
  effect_type?: string;
  /** Presentation hint written by this pass; never sent by the server. */
  fold?: FoldHint;
  [key: string]: unknown;
}

export type FoldHint =
  | { kind: 'pulse_with_stack'; stacks: number; maxStacks: number; effectType?: string }
  | { kind: 'full_block'; mitigated: number; source: string };

// A boss cast that resolved against a character is the same beat shape as a
// swing: one attack event plus the defensive result that ate part or all of it.
const LANDED_CREATURE_ATTACKS = new Set(['creature_hit', 'creature_crit', 'boss_cast_hit']);

function num(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
}

/**
 * Return the event list to render: unchanged order, folded members removed and
 * the surviving member annotated with a `fold` hint.
 */
export function foldPresentationGroups<T extends FoldableEvent>(events: readonly T[]): T[] {
  // Index groups once — a group is only ever a handful of events.
  const byGroup = new Map<string, T[]>();
  for (const ev of events) {
    const gid = typeof ev.group_id === 'string' ? ev.group_id : null;
    if (!gid) continue;
    const list = byGroup.get(gid);
    if (list) list.push(ev);
    else byGroup.set(gid, [ev]);
  }

  const dropped = new Set<T>();
  const hints = new Map<T, FoldHint>();

  for (const group of byGroup.values()) {
    // ── stance pulse + the stack it landed ──────────────────────────
    const pulse = group.find((e) => e.type === 'stance_pulse');
    const stack = group.find((e) => e.type === 'stack_applied');
    if (pulse && stack) {
      const dmg = num(pulse.damage) ?? num(pulse.amount) ?? 0;
      const stacks = num(stack.stacks) ?? num(pulse.stacks);
      const maxStacks = num(stack.max_stacks) ?? num(pulse.max_stacks);
      if (dmg > 0 && stacks !== undefined && maxStacks !== undefined) {
        dropped.add(stack);
        hints.set(pulse, {
          kind: 'pulse_with_stack',
          stacks,
          maxStacks,
          effectType: stack.effect_type ?? pulse.effect_type,
        });
      }
    }

    // ── creature swing fully eaten by mitigation ────────────────────
    const attack = group.find((e) => LANDED_CREATURE_ATTACKS.has(e.type));
    const mitigation = group.find((e) => typeof e.mitigation_source === 'string');
    if (attack && mitigation) {
      const attempted = num(mitigation.attempted_amount) ?? num(attack.attempted_amount);
      const mitigated = num(mitigation.mitigated_amount);
      const applied = num(mitigation.applied_amount) ?? num(attack.applied_amount);
      const fullyEaten =
        attempted !== undefined &&
        mitigated !== undefined &&
        applied === 0 &&
        attempted > 0 &&
        mitigated >= attempted;
      if (fullyEaten) {
        dropped.add(attack);
        hints.set(mitigation, {
          kind: 'full_block',
          mitigated: mitigated!,
          source: mitigation.mitigation_source as string,
        });
      }
    }
  }

  if (dropped.size === 0 && hints.size === 0) return [...events];
  const out: T[] = [];
  for (const ev of events) {
    if (dropped.has(ev)) continue;
    const hint = hints.get(ev);
    out.push(hint ? ({ ...ev, fold: hint } as T) : ev);
  }
  return out;
}
