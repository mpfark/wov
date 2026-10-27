/** Creature effect provenance. Call capture only with the producer's claimed source.
 * This prepares a contract; it does not discover a source or create a producer.
 */
import type { CreatureEffectSource, ProposedEffectInsert, SnapshotCreature, SnapshotEffect } from './types';

type EffectSourceFields = Pick<SnapshotEffect, 'source_character_id' | 'source_creature_id' | 'target_character_id' | 'target_creature_id' | 'config'>;
export type CreatureSourceRead = { kind: 'unbound' } | { kind: 'invalid' }
  | { kind: 'bound'; identity: CreatureEffectSource };

function validIdentity(value: unknown): value is CreatureEffectSource {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const row = value as Record<string, unknown>;
  return typeof row.creature_id === 'string' && row.creature_id.trim().length > 0
    && typeof row.node_creature_id === 'string' && row.node_creature_id.trim().length > 0
    && typeof row.spawn_seq === 'number' && Number.isSafeInteger(row.spawn_seq) && row.spawn_seq >= 0;
}

export function readCreatureEffectSource(effect: EffectSourceFields): CreatureSourceRead {
  if (!Object.prototype.hasOwnProperty.call(effect.config, 'creature_source')) return { kind: 'unbound' };
  const identity = effect.config.creature_source;
  if (!validIdentity(identity) || effect.source_character_id !== null
      || effect.source_creature_id !== identity.creature_id || !effect.target_character_id
      || effect.target_creature_id !== null) return { kind: 'invalid' };
  return { kind: 'bound', identity: { ...identity } };
}

/** Capture from a known live source, never a definition lookup. Refuse rebinding. */
export function bindCreatureEffectSource(effect: ProposedEffectInsert, source: SnapshotCreature): ProposedEffectInsert {
  const identity = { creature_id: source.creature_id, node_creature_id: source.id, spawn_seq: source.spawn_seq };
  if (!validIdentity(identity) || !source.is_alive || source.hp <= 0
      || !effect.target_character_id || effect.target_creature_id != null || effect.source_character_id != null
      || (effect.source_creature_id != null && effect.source_creature_id !== source.creature_id)
      || Object.prototype.hasOwnProperty.call(effect.config ?? {}, 'creature_source')) {
    throw new Error('invalid_creature_effect_source_capture');
  }
  return { ...effect, source_character_id: null, source_creature_id: source.creature_id,
    target_creature_id: null, config: { ...effect.config, creature_source: identity } };
}

export type CreatureSourceResolution = Exclude<CreatureSourceRead, { kind: 'bound' }>
  | { kind: 'missing_instance' | 'ambiguous_instance' | 'definition_mismatch' | 'generation_mismatch'; identity: CreatureEffectSource }
  | { kind: 'current' | 'dead'; identity: CreatureEffectSource; creature: SnapshotCreature };

/** Classify provenance only. No expiry, damage or modifier-snapshot policy. */
export function resolveCreatureEffectSource(effect: EffectSourceFields, creatures: readonly SnapshotCreature[]): CreatureSourceResolution {
  const binding = readCreatureEffectSource(effect);
  if (binding.kind !== 'bound') return binding;
  const { identity } = binding;
  const matches = creatures.filter(row => row.id === identity.node_creature_id);
  if (matches.length === 0) return { kind: 'missing_instance', identity };
  if (matches.length !== 1) return { kind: 'ambiguous_instance', identity };
  const creature = matches[0];
  if (creature.creature_id !== identity.creature_id) return { kind: 'definition_mismatch', identity };
  if (creature.spawn_seq !== identity.spawn_seq) return { kind: 'generation_mismatch', identity };
  return { kind: !creature.is_alive || creature.hp <= 0 ? 'dead' : 'current', identity, creature };
}
