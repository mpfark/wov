import type { Character } from '@/features/character';
import type { Creature } from '@/features/creatures';
import type { GameLogEvent } from '@/features/combat/events/log-event';
import type { Combat2PresentationModel } from './presentation';
import type { Combat2DeliverySessionStatus } from './useCombat2DeliverySession';
import type { Combat2EntryRefusal } from './entry';
import type { Combat2EntrySessionStatus } from './useCombat2EntrySession';

export function selectCombat2Character(
  enabled: boolean,
  model: Combat2PresentationModel | null,
  legacy: Character,
): Character {
  if (!enabled || !model || model.character.id !== legacy.id) return legacy;
  return {
    ...legacy,
    level: model.character.level, xp: model.character.xp, gold: model.character.gold,
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
  const authoritativeTypes = new Set(['reward', 'loot', 'kill', 'death']);
  const byId = new Map(legacy
    .filter((event) => !authoritativeTypes.has(event.type))
    .map((event) => [event.id, event]));
  for (const event of model.events) byId.set(event.id, event);
  return [...byId.values()];
}

/**
 * Idle entry is not a lock. Entry is deliberately never attempted while the node
 * has no living creature (`hasLivingCreatures !== true`), so a peaceful node used
 * to sit on "Entering" forever and claim actions were locked. Only a genuinely
 * in-flight `combat_enter` is "Entering".
 */
export function selectCombat2EntryStatusLabel(
  entryStatus: 'disabled' | 'idle' | 'entering' | 'entered' | 'refused' | 'uncertain' | 'error',
): string {
  if (entryStatus === 'entered') return 'Synchronizing';
  if (entryStatus === 'entering') return 'Entering';
  return 'Idle — no active encounter';
}

/** The lock sentence belongs to real locks, not to an idle, unlocked session. */
export function selectCombat2SessionLocked(status: string): boolean {
  return status !== 'Ready' && status !== 'Idle — no active encounter';
}

export type Combat2VisibleState =
  | 'peaceful' | 'synchronizing' | 'reconnecting' | 'unavailable'
  | 'active' | 'stale' | 'authorization_refusal' | 'pending' | 'dead' | 'historical';

export interface Combat2StatusPresentation {
  state: Combat2VisibleState;
  label: string;
  guidance: string;
  actionsLocked: boolean;
  stale: boolean;
}

interface Combat2StatusInput {
  rolloutEnabled: boolean;
  access: 'checking' | 'allowed' | 'refused' | 'error';
  preflight: 'checking' | 'allowed' | 'refused';
  ownershipLocked: boolean;
  dead: boolean;
  testArenaDeath: boolean;
  sessionStatus: 'active' | 'exited' | 'idle';
  pendingFlee: boolean;
  entryStatus: Combat2EntrySessionStatus;
  entryClassification: Combat2EntryRefusal | string | null;
  presentationStatus: Combat2DeliverySessionStatus;
  actionsReady: boolean;
  hasModel: boolean;
  historical: boolean;
}

const view = (
  state: Combat2VisibleState,
  label: string,
  guidance: string,
  actionsLocked = true,
  stale = false,
): Combat2StatusPresentation => ({ state, label, guidance, actionsLocked, stale });

/** Pure player-facing projection; authoritative readiness remains owned by the session. */
export function selectCombat2StatusPresentation(input: Combat2StatusInput): Combat2StatusPresentation {
  if (input.historical) return view('historical', 'Combat ended', 'Showing the last received combat state.', true, true);
  if (!input.rolloutEnabled) return view('unavailable', 'Combat unavailable', 'Combat is temporarily unavailable.');
  if (input.access === 'checking') return view('synchronizing', 'Checking combat access', 'Waiting for the authoritative combat state.');
  if (input.access === 'refused') return view('authorization_refusal', 'Combat access refused', 'This character is not authorized to use Combat2 here.');
  if (input.access === 'error') return view('unavailable', 'Combat unavailable', 'Combat access could not be verified. Try again shortly.');
  if (input.ownershipLocked) return view('unavailable', 'Combat unavailable', 'Combat actions are unavailable until the party state is resolved.');
  if (input.preflight === 'refused') return view('authorization_refusal', 'Combat access refused', 'Combat eligibility could not be verified for this character.');
  if (input.preflight === 'checking') return view('synchronizing', 'Checking combat readiness', 'Waiting for the authoritative combat state.');
  if (input.dead) return input.testArenaDeath
    ? view('dead', 'Defeated', 'Use the Test Arena reset controls to continue.')
    : view('dead', 'Defeated', 'Authoritative respawn becomes available after 3 seconds.');
  if (input.sessionStatus === 'exited') return view('unavailable', 'Combat ended', 'Combat actions are unavailable until combat resumes.');
  if (input.pendingFlee) return view('pending', 'Movement pending', 'Movement is being finalized — try again shortly.');
  if (input.entryStatus === 'refused') return input.entryClassification === 'not_authorized'
    ? view('authorization_refusal', 'Combat access refused', 'This character is not authorized to enter combat.')
    : view('unavailable', 'Combat unavailable', 'Combat entry is temporarily unavailable.');
  if (input.entryStatus === 'uncertain' || input.entryStatus === 'error') {
    return view('unavailable', 'Combat state unavailable', 'Combat state is temporarily out of sync.');
  }
  if (input.presentationStatus === 'refused') {
    return view('authorization_refusal', 'Combat access refused', 'The authoritative combat state refused this session.', true, input.hasModel);
  }
  if (input.presentationStatus === 'gap') {
    return view('stale', 'Combat state out of sync', 'Waiting for a fresh authoritative snapshot.', true, true);
  }
  if (input.presentationStatus === 'error') {
    return view('unavailable', 'Combat state unavailable', 'Combat state is temporarily out of sync.', true, input.hasModel);
  }
  if (input.actionsReady) return view('active', 'Active combat', 'Combat actions are ready.', false, false);
  if (input.presentationStatus === 'reconnecting') {
    return view('reconnecting', 'Reconnecting', 'Waiting for a fresh authoritative snapshot.', true, input.hasModel);
  }
  if (input.entryStatus === 'entering' || input.entryStatus === 'entered' || input.presentationStatus === 'syncing') {
    return view('synchronizing', 'Synchronizing', 'Waiting for the authoritative combat state.');
  }
  return view('peaceful', 'Peaceful — no active encounter', 'Movement is available. Combat abilities become available when combat begins.', false, false);
}
