import type { GameLogEvent, LogActor, LogEventType } from '@/features/combat/events/log-event';
import type { Combat2DeliverySessionState } from './useCombat2DeliverySession';
import type { Combat2SafeEvent, Combat2TickBatch } from './delivery';

export interface Combat2PresentationCharacter {
  id: string;
  level: number;
  xp: number;
  gold: number;
  hp: number;
  maxHp: number;
  cp: number;
  maxCp: number;
  mp: number;
  maxMp: number;
}

export interface Combat2PresentationRewardClaim {
  id: string;
  encounterId: string;
  characterId: string;
  creatureId: string;
  spawnSeq: number;
  xpAwarded: number;
  goldAwarded: number;
  isKiller: boolean;
  createdAt: string;
}

export interface Combat2PresentationCreature {
  id: string;
  creatureId: string;
  spawnSeq: number;
  name: string;
  hp: number;
  maxHp: number;
  isAlive: boolean;
  engaged: boolean;
  tankFighterId: string | null;
  isCurrentCharacterTank: boolean;
  pendingAction: Combat2PresentationPendingAction | null;
}

export interface Combat2PresentationPendingAction {
  abilityKey: string;
  abilityLabel: string | null;
  startedAtTick: number;
  resolveAtTick: number;
  targetFighterId: string;
  targetCharacterId: string;
  targetEntrySeq: number;
}

export interface Combat2PresentationTelegraph extends Combat2PresentationPendingAction {
  id: string;
  encounterId: string;
  nodeCreatureId: string;
  creatureId: string;
  spawnSeq: number;
  creatureName: string;
  targetIsCurrentCharacter: boolean;
}

export function combat2CreatureLifeKey(creatureId: string, spawnSeq: number): string {
  return `${creatureId}:${spawnSeq}`;
}

export type Combat2EffectCategory = 'beneficial' | 'harmful' | 'stance' | 'unknown';

export interface Combat2PresentationEffect {
  id: string;
  kind: string;
  effectType: string | null;
  abilityKey: string | null;
  sourceCharacterId: string | null;
  sourceCreatureId: string | null;
  targetCharacterId: string | null;
  targetCreatureId: string | null;
  magnitude: number | null;
  stacks: number | null;
  expiresAt: string | null;
  nextDueAt: string | null;
  intervalMs: number | null;
  lastPulseTick: number | null;
  isReservation: boolean;
  category: Combat2EffectCategory;
}

export interface Combat2PresentationModel {
  encounterId: string;
  encounterTick: number;
  stateVersion: number;
  encounterStatus: string;
  fighterExitState: 'pending' | 'exited' | 'dead' | null;
  character: Combat2PresentationCharacter;
  creatures: readonly Combat2PresentationCreature[];
  effects: readonly Combat2PresentationEffect[];
  characterEffects: readonly Combat2PresentationEffect[];
  creatureEffects: Readonly<Record<string, readonly Combat2PresentationEffect[]>>;
  telegraphs: readonly Combat2PresentationTelegraph[];
  telegraphsByCreatureLife: Readonly<Record<string, Combat2PresentationTelegraph>>;
  rewardClaims: readonly Combat2PresentationRewardClaim[];
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

function optionalString(row: Record<string, unknown>, key: string): string | null {
  const value = row[key];
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string' || value === '') throw new Combat2PresentationError(`combat2_sync ${key} is invalid`);
  return value;
}

function optionalNumber(row: Record<string, unknown>, key: string): number | null {
  const value = row[key];
  if (value === null || value === undefined) return null;
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Combat2PresentationError(`combat2_sync ${key} is invalid`);
  return value;
}

function optionalInteger(row: Record<string, unknown>, key: string): number | null {
  const value = optionalNumber(row, key);
  if (value === null) return null;
  if (!Number.isSafeInteger(value) || value < 0) throw new Combat2PresentationError(`combat2_sync ${key} is invalid`);
  return value;
}

function optionalTimestamp(row: Record<string, unknown>, key: string): string | null {
  const value = optionalString(row, key);
  if (value !== null && !Number.isFinite(Date.parse(value))) throw new Combat2PresentationError(`combat2_sync ${key} is invalid`);
  return value;
}

const BENEFICIAL_KINDS = new Set(['absorb', 'aura', 'block', 'evasion', 'mitigation', 'offense', 'reactive', 'regen', 'stealth', 'party_regen']);
const HARMFUL_KINDS = new Set(['control', 'dot', 'stack']);

function parseEffects(values: unknown[], characterId: string): {
  effects: Combat2PresentationEffect[];
  characterEffects: Combat2PresentationEffect[];
  creatureEffects: Record<string, Combat2PresentationEffect[]>;
} {
  const parsed = values.map((value) => {
    const row = record(value);
    if (!row || typeof row.isReservation !== 'boolean') throw new Combat2PresentationError('combat2_sync effect is malformed');
    const targetCharacterId = optionalString(row, 'targetCharacterId');
    const targetCreatureId = optionalString(row, 'targetCreatureId');
    if ((targetCharacterId === null) === (targetCreatureId === null)) {
      throw new Combat2PresentationError('combat2_sync effect target is ambiguous');
    }
    return {
      id: stringField(row, 'id'),
      kind: stringField(row, 'kind'),
      effectType: optionalString(row, 'effectType'),
      abilityKey: optionalString(row, 'abilityKey'),
      sourceCharacterId: optionalString(row, 'sourceCharacterId'),
      sourceCreatureId: optionalString(row, 'sourceCreatureId'),
      targetCharacterId,
      targetCreatureId,
      magnitude: optionalNumber(row, 'magnitude'),
      stacks: optionalInteger(row, 'stacks'),
      expiresAt: optionalTimestamp(row, 'expiresAt'),
      nextDueAt: optionalTimestamp(row, 'nextDueAt'),
      intervalMs: optionalInteger(row, 'intervalMs'),
      lastPulseTick: optionalInteger(row, 'lastPulseTick'),
      isReservation: row.isReservation,
      category: 'unknown' as Combat2EffectCategory,
    };
  });
  const reservations = new Set(parsed.filter((effect) => effect.isReservation).map((effect) => `${effect.targetCharacterId}:${effect.abilityKey}`));
  for (const effect of parsed) {
    const pairedStance = effect.targetCharacterId !== null
      && reservations.has(`${effect.targetCharacterId}:${effect.abilityKey}`);
    effect.category = effect.isReservation || pairedStance
      ? 'stance'
      : BENEFICIAL_KINDS.has(effect.kind)
        ? 'beneficial'
        : HARMFUL_KINDS.has(effect.kind)
          ? 'harmful'
          : 'unknown';
  }
  const characterEffects = parsed.filter((effect) => effect.targetCharacterId === characterId);
  const creatureEffects: Record<string, Combat2PresentationEffect[]> = {};
  for (const effect of parsed) {
    if (!effect.targetCreatureId) continue;
    (creatureEffects[effect.targetCreatureId] ??= []).push(effect);
  }
  return { effects: parsed, characterEffects, creatureEffects };
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
  const abilityLabel = typeof event.abilityKey === 'string'
    ? event.abilityKey.replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase())
    : 'cast';
  if (event.kind === 'boss_cast_evaded') {
    return event.outcomeReason === 'no_target'
      ? `${actorName}'s ${abilityLabel} lands on empty ground.`
      : `${actorName}'s ${abilityLabel} is evaded.`;
  }
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

function parseRewardClaims(
  values: unknown[],
  encounterId: string,
  characterId: string,
): Combat2PresentationRewardClaim[] {
  const claims = new Map<string, Combat2PresentationRewardClaim>();
  for (const value of values) {
    const row = record(value);
    if (!row || typeof row.isKiller !== 'boolean') {
      throw new Combat2PresentationError('combat2_sync reward claim is malformed');
    }
    const creatureId = stringField(row, 'creatureId');
    const spawnSeq = integerField(row, 'spawnSeq');
    const id = JSON.stringify([encounterId, characterId, creatureId, spawnSeq]);
    const createdAt = stringField(row, 'createdAt');
    if (!Number.isFinite(Date.parse(createdAt))) {
      throw new Combat2PresentationError('combat2_sync createdAt is invalid');
    }
    claims.set(id, {
      id, encounterId, characterId, creatureId, spawnSeq,
      xpAwarded: integerField(row, 'xpAwarded'),
      goldAwarded: integerField(row, 'goldAwarded'),
      isKiller: row.isKiller,
      createdAt,
    });
  }
  return [...claims.values()];
}

function presentRewardClaims(claims: readonly Combat2PresentationRewardClaim[]): GameLogEvent[] {
  return claims.map((claim) => ({
    v: 1,
    id: `combat2-reward:${claim.id}`,
    ts: Date.parse(claim.createdAt),
    type: 'reward',
    message: `${claim.isKiller ? 'Killing blow; ' : ''}combat reward: ${claim.xpAwarded} XP and ${claim.goldAwarded} gold.`,
    source: { kind: 'world' },
  }));
}

export function buildCombat2Presentation(delivery: Combat2DeliverySessionState): Combat2PresentationModel {
  const sync = delivery.snapshot;
  if (!sync) throw new Combat2PresentationError('combat2_sync has no authoritative snapshot');
  const encounter = record(sync.encounter);
  const character = record(sync.character);
  if (!encounter || !character || !Array.isArray(sync.creatures) || !Array.isArray(sync.effects) || !Array.isArray(sync.rewardClaims)) throw new Combat2PresentationError('combat2_sync snapshot is malformed');

  const encounterId = stringField(encounter, 'id');
  const encounterTick = integerField(encounter, 'tick');
  const characterId = stringField(character, 'id');
  const fighter = record(sync.fighter);
  const ownFighterId = fighter ? stringField(fighter, 'id') : null;
  const rawExitState = fighter?.exitState;
  if (rawExitState !== null && rawExitState !== undefined && rawExitState !== 'pending' && rawExitState !== 'exited' && rawExitState !== 'dead') {
    throw new Combat2PresentationError('combat2_sync exitState is invalid');
  }
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

  const telegraphs: Combat2PresentationTelegraph[] = [];
  const telegraphsByCreatureLife: Record<string, Combat2PresentationTelegraph> = {};
  const creatures = sync.creatures.map((value) => {
    const row = record(value);
    if (!row || typeof row.isAlive !== 'boolean') throw new Combat2PresentationError('combat2_sync creature is malformed');
    const pending = row.pendingAction === null ? null : record(row.pendingAction);
    if (row.pendingAction !== null && !pending) throw new Combat2PresentationError('combat2_sync pending action is malformed');
    const nodeCreatureId = stringField(row, 'id');
    const creatureId = stringField(row, 'creatureId');
    const spawnSeq = integerField(row, 'spawnSeq');
    const creatureName = stringField(row, 'name');
    const tankFighterId = optionalString(row, 'tankFighterId');
    if (typeof row.engaged !== 'boolean') throw new Combat2PresentationError('combat2_sync engaged is invalid');
    const pendingAction: Combat2PresentationPendingAction | null = pending ? {
      abilityKey: stringField(pending, 'abilityKey'),
      abilityLabel: optionalString(pending, 'abilityLabel'),
      startedAtTick: integerField(pending, 'startedAtTick'),
      resolveAtTick: integerField(pending, 'resolveAtTick'),
      targetFighterId: stringField(pending, 'targetFighterId'),
      targetCharacterId: stringField(pending, 'targetCharacterId'),
      targetEntrySeq: integerField(pending, 'targetEntrySeq'),
    } : null;
    if (pendingAction && pendingAction.resolveAtTick < pendingAction.startedAtTick) {
      throw new Combat2PresentationError('combat2_sync pending action tick boundary is invalid');
    }
    const targetsCurrentCharacter = pendingAction?.targetCharacterId === characterId;
    const currentGenerationMatches = !targetsCurrentCharacter || (
      !!fighter
      && fighter.id === pendingAction.targetFighterId
      && fighter.characterId === characterId
      && fighter.entrySeq === pendingAction.targetEntrySeq
      && fighter.present === true
    );
    if (row.isAlive && pendingAction && currentGenerationMatches) {
      const telegraph: Combat2PresentationTelegraph = {
        ...pendingAction,
        id: JSON.stringify([
          encounterId, nodeCreatureId, creatureId, spawnSeq, pendingAction.abilityKey,
          pendingAction.startedAtTick, pendingAction.resolveAtTick, pendingAction.targetFighterId,
          pendingAction.targetCharacterId, pendingAction.targetEntrySeq,
        ]),
        encounterId, nodeCreatureId, creatureId, spawnSeq, creatureName,
        targetIsCurrentCharacter: targetsCurrentCharacter,
      };
      telegraphs.push(telegraph);
      telegraphsByCreatureLife[combat2CreatureLifeKey(creatureId, spawnSeq)] = telegraph;
    }
    return {
      id: nodeCreatureId,
      creatureId,
      spawnSeq,
      name: creatureName,
      hp: numberField(row, 'hp'),
      maxHp: numberField(row, 'maxHp'),
      isAlive: row.isAlive,
      engaged: row.engaged,
      tankFighterId,
      isCurrentCharacterTank: row.isAlive && tankFighterId !== null && tankFighterId === ownFighterId,
      pendingAction,
    };
  });

  const effectGroups = parseEffects(sync.effects, characterId);
  const rewardClaims = parseRewardClaims(sync.rewardClaims, encounterId, characterId);
  return {
    encounterId,
    encounterTick,
    stateVersion: integerField(encounter, 'stateVersion'),
    encounterStatus: stringField(encounter, 'status'),
    fighterExitState: (rawExitState ?? null) as Combat2PresentationModel['fighterExitState'],
    character: {
      id: characterId,
      level: integerField(character, 'level'), xp: integerField(character, 'xp'), gold: integerField(character, 'gold'),
      hp: numberField(character, 'hp'), maxHp: numberField(character, 'maxHp'),
      cp: numberField(character, 'cp'), maxCp: numberField(character, 'maxCp'),
      mp: numberField(character, 'mp'), maxMp: numberField(character, 'maxMp'),
    },
    creatures,
    ...effectGroups,
    telegraphs,
    telegraphsByCreatureLife,
    rewardClaims,
    events: [...presentEvents(ordered), ...presentRewardClaims(rewardClaims)],
    lastAppliedTick: delivery.lastAppliedTick,
  };
}
