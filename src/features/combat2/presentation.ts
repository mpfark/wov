import type { GameLogEvent, LogActor, LogEventType } from '@/features/combat/events/log-event';
import type { Combat2DeliverySessionState } from './useCombat2DeliverySession';
import type { Combat2SafeEvent, Combat2TickBatch } from './delivery';

export interface Combat2PresentationCharacter {
  id: string;
  hp: number;
  maxHp: number;
  cp: number;
  maxCp: number;
  mp: number;
  maxMp: number;
}

export interface Combat2PresentationCreature {
  id: string;
  creatureId: string;
  name: string;
  hp: number;
  maxHp: number;
  isAlive: boolean;
  pendingAction: { abilityKey: string | null; resolveAtTick: number } | null;
}

export interface Combat2PresentationModel {
  encounterId: string;
  encounterTick: number;
  stateVersion: number;
  encounterStatus: string;
  character: Combat2PresentationCharacter;
  creatures: readonly Combat2PresentationCreature[];
  events: readonly GameLogEvent[];
  lastAppliedTick: number;
}

export interface Combat2PresentationState {
  status: Combat2DeliverySessionState['status'];
  model: Combat2PresentationModel | null;
  error: string | null;
}

export class Combat2PresentationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'Combat2PresentationError';
  }
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function stringField(row: Record<string, unknown>, key: string): string {
  if (typeof row[key] !== 'string' || row[key] === '') throw new Combat2PresentationError(`combat2_sync ${key} is invalid`);
  return row[key] as string;
}

function numberField(row: Record<string, unknown>, key: string): number {
  const value = row[key];
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Combat2PresentationError(`combat2_sync ${key} is invalid`);
  return value;
}

function integerField(row: Record<string, unknown>, key: string): number {
  const value = numberField(row, key);
  if (!Number.isSafeInteger(value) || value < 0) throw new Combat2PresentationError(`combat2_sync ${key} is invalid`);
  return value;
}

function actor(value: unknown): LogActor | undefined {
  const row = record(value);
  if (!row || (row.type !== 'character' && row.type !== 'creature')) return undefined;
  return {
    kind: row.type === 'character' ? 'player' : 'creature',
    ...(typeof row.id === 'string' ? { id: row.id } : {}),
    ...(typeof row.name === 'string' ? { name: row.name } : {}),
  };
}

const EVENT_TYPES: Record<string, LogEventType> = {
  attack: 'ability', creature_attack: 'attack', heal: 'heal', hp_transfer: 'heal',
  buff_applied: 'buff', aura: 'ability', aura_started: 'buff', reservation: 'buff',
  stance_activated: 'buff', stance_dropped: 'buff', stack: 'debuff', stack_applied: 'debuff',
  effect_pulse: 'dot_tick', effect_expired: 'debuff', action_rejected: 'error',
  boss_telegraph: 'boss_telegraph', boss_cast_evaded: 'mitigation',
  creature_died: 'kill', character_died: 'death', multi_attack_summary: 'ability',
};

function eventMessage(event: Combat2SafeEvent): string {
  const text = record(event.meta)?.text;
  if (typeof text === 'string' && text.trim()) return text.trim();
  const actorName = event.actor?.name ?? (event.actor?.type === 'creature' ? 'Creature' : 'You');
  const targetName = event.target?.name;
  const label = event.kind.replaceAll('_', ' ');
  return `${actorName}: ${label}${targetName ? ` → ${targetName}` : ''}${typeof event.amount === 'number' ? ` (${event.amount})` : ''}.`;
}

function presentEvents(batches: readonly Combat2TickBatch[]): GameLogEvent[] {
  const events = new Map<string, GameLogEvent>();
  for (const batch of [...batches].sort((a, b) => a.tick - b.tick)) {
    batch.events.forEach((event, index) => {
      if (!event || typeof event.kind !== 'string' || !event.kind) return;
      const id = `${batch.id}:${typeof event.seq === 'number' ? event.seq : index}`;
      if (events.has(id)) return;
      const type = EVENT_TYPES[event.kind] ?? 'unknown';
      events.set(id, {
        v: 1,
        id,
        ts: Number.isFinite(Date.parse(batch.createdAt)) ? Date.parse(batch.createdAt) : batch.tick,
        type,
        message: eventMessage(event),
        source: actor(event.actor),
        target: actor(event.target),
        ...(typeof event.amount === 'number' ? { amount: event.amount } : {}),
        ...(typeof event.abilityKey === 'string' ? { abilityKey: event.abilityKey } : {}),
        ...(type === 'unknown' ? { severity: 'notable' as const } : {}),
      });
    });
  }
  return [...events.values()];
}

export function buildCombat2Presentation(delivery: Combat2DeliverySessionState): Combat2PresentationModel {
  const sync = delivery.snapshot;
  if (!sync) throw new Combat2PresentationError('combat2_sync has no authoritative snapshot');
  const encounter = record(sync.encounter);
  const character = record(sync.character);
  if (!encounter || !character || !Array.isArray(sync.creatures)) throw new Combat2PresentationError('combat2_sync snapshot is malformed');

  const ordered = [...delivery.batches].sort((a, b) => a.tick - b.tick);
  if (ordered.length > 0 && ordered[0].tick !== 1) {
    throw new Combat2PresentationError('combat2_sync presentation begins after a tick gap');
  }
  for (let index = 1; index < ordered.length; index += 1) {
    if (ordered[index].tick !== ordered[index - 1].tick + 1) {
      throw new Combat2PresentationError('combat2_sync batches are not contiguous');
    }
  }
  if (ordered.length > 0 && ordered.at(-1)!.tick !== delivery.lastAppliedTick) {
    throw new Combat2PresentationError('combat2_sync presentation cursor does not match batches');
  }

  const creatures = sync.creatures.map((value) => {
    const row = record(value);
    if (!row || typeof row.isAlive !== 'boolean') throw new Combat2PresentationError('combat2_sync creature is malformed');
    const pending = row.pendingAction === null ? null : record(row.pendingAction);
    if (row.pendingAction !== null && !pending) throw new Combat2PresentationError('combat2_sync pending action is malformed');
    return {
      id: stringField(row, 'id'),
      creatureId: stringField(row, 'creatureId'),
      name: stringField(row, 'name'),
      hp: numberField(row, 'hp'),
      maxHp: numberField(row, 'maxHp'),
      isAlive: row.isAlive,
      pendingAction: pending ? {
        abilityKey: typeof pending.abilityKey === 'string' ? pending.abilityKey : null,
        resolveAtTick: integerField(pending, 'resolveAtTick'),
      } : null,
    };
  });

  return {
    encounterId: stringField(encounter, 'id'),
    encounterTick: integerField(encounter, 'tick'),
    stateVersion: integerField(encounter, 'stateVersion'),
    encounterStatus: stringField(encounter, 'status'),
    character: {
      id: stringField(character, 'id'),
      hp: numberField(character, 'hp'), maxHp: numberField(character, 'maxHp'),
      cp: numberField(character, 'cp'), maxCp: numberField(character, 'maxCp'),
      mp: numberField(character, 'mp'), maxMp: numberField(character, 'maxMp'),
    },
    creatures,
    events: presentEvents(ordered),
    lastAppliedTick: delivery.lastAppliedTick,
  };
}
