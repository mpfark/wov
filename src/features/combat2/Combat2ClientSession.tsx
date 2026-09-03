import { useCallback, useEffect, useState } from 'react';
import { useCombat2DeliverySession } from './useCombat2DeliverySession';
import { useCombat2EntrySession } from './useCombat2EntrySession';
import { useCombat2FleeSession } from './useCombat2FleeSession';
import { useCombat2IntentSession } from './useCombat2IntentSession';
import { useCombat2Presentation } from './useCombat2Presentation';

export interface Combat2ClientSessionProps {
  controlled?: boolean;
  inputLocked?: boolean;
  enabled: boolean;
  characterId: string | null;
  nodeId: string | null;
  hasLivingCreatures: boolean | null;
}

/** Shared client session: entry owns the identity consumed by delivery and intents. */
export function useCombat2ClientSession(props: Combat2ClientSessionProps) {
  const entry = useCombat2EntrySession(props);
  const enteredEncounterId = entry.status === 'entered' ? entry.encounterId : null;
  const enteredSessionKey = props.enabled && props.characterId && props.nodeId && enteredEncounterId
    ? `${props.characterId}:${props.nodeId}:${enteredEncounterId}`
    : null;
  const [exitedSessionKey, setExitedSessionKey] = useState<string | null>(null);
  const [pendingFleeKey, setPendingFleeKey] = useState<string | null>(null);
  useEffect(() => {
    if (!enteredSessionKey) setExitedSessionKey(null);
  }, [enteredSessionKey]);
  const encounterId = enteredSessionKey && exitedSessionKey !== enteredSessionKey ? enteredEncounterId : null;
  const delivery = useCombat2DeliverySession({
    enabled: props.enabled,
    characterId: props.characterId,
    encounterId,
    preserveOnDetach: true,
  });
  const presentation = useCombat2Presentation(enteredSessionKey, delivery);
  const model = presentation.model;
  const dead = !!model && (model.character.hp <= 0 || model.fighterExitState === 'dead');
  const pendingFlee = !!enteredSessionKey && (pendingFleeKey === enteredSessionKey || model?.fighterExitState === 'pending');
  const fighter = delivery.snapshot?.fighter as Record<string, unknown> | null | undefined;
  const actionsReady = !props.inputLocked && !!encounterId && presentation.status === 'live'
    && !!model && !dead && !pendingFlee && model.encounterStatus === 'active'
    && fighter?.present === true && fighter.characterId === props.characterId
    && typeof fighter.entrySeq === 'number' && Number.isSafeInteger(fighter.entrySeq)
    && typeof fighter.id === 'string' && !!fighter.id && model.fighterExitState === null;
  const intents = useCombat2IntentSession({
    canSubmit: props.controlled ? actionsReady : true,
    enabled: props.enabled,
    characterId: props.characterId,
    nodeId: props.nodeId,
    encounterId,
  });
  const onExited = useCallback((sessionKey: string) => setExitedSessionKey(sessionKey), []);
  const flee = useCombat2FleeSession({
    canSubmit: props.controlled ? actionsReady : true,
    onQueued: () => setPendingFleeKey(enteredSessionKey),
    enabled: props.enabled,
    characterId: props.characterId,
    nodeId: props.nodeId,
    encounterId,
    onExited,
  });
  useEffect(() => {
    if (enteredSessionKey && presentation.model?.fighterExitState === 'exited') {
      setExitedSessionKey(enteredSessionKey);
    }
  }, [enteredSessionKey, presentation.model?.fighterExitState]);
  return {
    entry,
    intents,
    flee,
    delivery,
    presentation,
    actionsReady,
    dead,
    pendingFlee,
    encounterId,
    sessionStatus: encounterId ? 'active' as const : exitedSessionKey === enteredSessionKey && enteredSessionKey
      ? 'exited' as const
      : 'idle' as const,
  };
}

/** Isolated, invisible bridge retained for consumers that need delivery only. */
export function Combat2ClientSession(props: Combat2ClientSessionProps) {
  useCombat2ClientSession(props);
  return null;
}
