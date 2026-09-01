import type { Character } from '@/features/character';
import type { Creature } from '@/features/creatures';
import type { GameLogEvent } from '@/features/combat/events/log-event';
import type { Combat2PresentationModel } from './presentation';

export function selectCombat2Character(
  enabled: boolean,
  model: Combat2PresentationModel | null,
  legacy: Character,
): Character {
  if (!enabled || !model || model.character.id !== legacy.id) return legacy;
  return {
    ...legacy,
    hp: model.character.hp, max_hp: model.character.maxHp,
    cp: model.character.cp, max_cp: model.character.maxCp,
    mp: model.character.mp, max_mp: model.character.maxMp,
  };
}

export function selectCombat2Creatures(
  enabled: boolean,
  model: Combat2PresentationModel | null,
  legacy: Creature[],
): Creature[] {
  if (!enabled || !model) return legacy;
  const byDefinition = new Map(model.creatures.map((creature) => [creature.creatureId, creature]));
  return legacy.map((creature) => {
    const authoritative = byDefinition.get(creature.id);
    return authoritative ? {
      ...creature,
      hp: authoritative.hp,
      max_hp: authoritative.maxHp,
      is_alive: authoritative.isAlive,
    } : creature;
  });
}

export function selectCombat2Events(
  enabled: boolean,
  model: Combat2PresentationModel | null,
  legacy: readonly GameLogEvent[],
): GameLogEvent[] {
  if (!enabled || !model) return legacy as GameLogEvent[];
  const byId = new Map(legacy.map((event) => [event.id, event]));
  for (const event of model.events) byId.set(event.id, event);
  return [...byId.values()];
}
