/**
 * resync.ts — C4: authoritative resynchronisation after an unrecoverable gap.
 *
 * A committed tick that can no longer be fetched (pruned past the 180s retention
 * window, or read access expired) must never be skipped by simply advancing the
 * sequencer cursor: the client would then render state derived from a tick it
 * never applied. Instead the client fetches an authoritative snapshot with
 * `public.encounter_resync_snapshot(_encounter_id, _character_id)`, replaces the
 * local combat state with it, and only then re-anchors the cursor to the
 * snapshot's tick.
 *
 * The snapshot is read-only and scoped by the same rules as the batch stream:
 * the caller must own the character, and the character must still be a
 * participant or hold a live `encounter_access_grants` row.
 */

export interface ResyncCreature {
  readonly id: string;
  readonly hp: number;
  readonly maxHp: number;
  readonly alive: boolean;
  readonly name: string | null;
}

export interface ResyncCharacter {
  readonly id: string;
  readonly hp: number;
  readonly max_hp: number;
  readonly cp: number;
  readonly max_cp: number;
  readonly mp: number;
  readonly max_mp: number;
  readonly xp: number;
  readonly gold: number;
  readonly level: number;
  readonly bhp?: number;
  readonly rp_total_earned?: number;
  readonly unspent_stat_points?: number;
  readonly respec_points?: number;
}

export interface ResyncSnapshot {
  readonly encounterId: string;
  readonly nodeId: string | null;
  readonly ended: boolean;
  /** Authoritative tick the snapshot represents; the new cursor position. */
  readonly tick: number;
  /** Oldest tick still retained server-side, if any batches remain. */
  readonly retainedFromTick: number | null;
  readonly character: ResyncCharacter | null;
  readonly creatures: readonly ResyncCreature[];
  readonly engagedCreatureIds: readonly string[];
  readonly effects: readonly Record<string, unknown>[];
}

function num(v: unknown, fallback = 0): number {
  const n = typeof v === 'string' ? Number(v) : v;
  return typeof n === 'number' && Number.isFinite(n) ? n : fallback;
}

/** Parse the RPC payload defensively — a malformed snapshot must not re-anchor. */
export function parseResyncSnapshot(raw: unknown): ResyncSnapshot | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const encounterId = typeof o.encounter_id === 'string' ? o.encounter_id : null;
  if (!encounterId) return null;

  const rawChar = (o.character && typeof o.character === 'object' ? o.character : null) as Record<string, unknown> | null;
  const character: ResyncCharacter | null = rawChar && typeof rawChar.id === 'string'
    ? {
        id: rawChar.id,
        hp: num(rawChar.hp),
        max_hp: num(rawChar.max_hp),
        cp: num(rawChar.cp),
        max_cp: num(rawChar.max_cp),
        mp: num(rawChar.mp),
        max_mp: num(rawChar.max_mp),
        xp: num(rawChar.xp),
        gold: num(rawChar.gold),
        level: num(rawChar.level, 1),
        bhp: num(rawChar.bhp),
        rp_total_earned: num(rawChar.rp_total_earned),
        unspent_stat_points: num(rawChar.unspent_stat_points),
        respec_points: num(rawChar.respec_points),
      }
    : null;

  const creatures: ResyncCreature[] = Array.isArray(o.creatures)
    ? o.creatures
        .filter((c): c is Record<string, unknown> => !!c && typeof c === 'object')
        .filter(c => typeof c.id === 'string')
        .map(c => ({
          id: c.id as string,
          hp: num(c.hp),
          maxHp: num(c.max_hp),
          alive: c.alive === true || num(c.hp) > 0,
          name: typeof c.name === 'string' ? c.name : null,
        }))
    : [];

  return {
    encounterId,
    nodeId: typeof o.node_id === 'string' ? o.node_id : null,
    ended: o.ended === true,
    tick: num(o.tick),
    retainedFromTick: o.retained_from_tick === null || o.retained_from_tick === undefined
      ? null
      : num(o.retained_from_tick),
    character,
    creatures,
    engagedCreatureIds: Array.isArray(o.engaged_creature_ids)
      ? o.engaged_creature_ids.filter((id): id is string => typeof id === 'string')
      : [],
    effects: Array.isArray(o.effects)
      ? (o.effects.filter(e => !!e && typeof e === 'object') as Record<string, unknown>[])
      : [],
  };
}
