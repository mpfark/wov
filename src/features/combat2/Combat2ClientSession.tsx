import { useCallback, useEffect, useState } from 'react';
import { useCombat2DeliverySession } from './useCombat2DeliverySession';
import { useCombat2EntrySession } from './useCombat2EntrySession';
import { useCombat2FleeSession } from './useCombat2FleeSession';
import { useCombat2IntentSession } from './useCombat2IntentSession';
import { useCombat2Presentation } from './useCombat2Presentation';

export interface Combat2ClientSessionProps {
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
  const intents = useCombat2IntentSession({
    enabled: props.enabled,
    characterId: props.characterId,
    nodeId: props.nodeId,
    encounterId,
  });
  const onExited = useCallback((sessionKey: string) => setExitedSessionKey(sessionKey), []);
  const flee = useCombat2FleeSession({
    enabled: props.enabled,
    characterId: props.characterId,
    nodeId: props.nodeId,
    encounterId,
    onExited,
  });
  const presentation = useCombat2Presentation(enteredSessionKey, delivery);
  return {
    entry,
    intents,
    flee,
    delivery,
    presentation,
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
