import { useCombat2DeliverySession } from './useCombat2DeliverySession';
import { useCombat2EntrySession } from './useCombat2EntrySession';
import { useCombat2IntentSession } from './useCombat2IntentSession';

export interface Combat2ClientSessionProps {
  enabled: boolean;
  characterId: string | null;
  nodeId: string | null;
  hasLivingCreatures: boolean | null;
}

/** Shared client session: entry owns the identity consumed by delivery and intents. */
export function useCombat2ClientSession(props: Combat2ClientSessionProps) {
  const entry = useCombat2EntrySession(props);
  const encounterId = entry.status === 'entered' ? entry.encounterId : null;
  useCombat2DeliverySession({
    enabled: props.enabled,
    characterId: props.characterId,
    encounterId,
  });
  const intents = useCombat2IntentSession({
    enabled: props.enabled,
    characterId: props.characterId,
    nodeId: props.nodeId,
    encounterId,
  });
  return { entry, intents };
}

/** Isolated, invisible bridge retained for consumers that need delivery only. */
export function Combat2ClientSession(props: Combat2ClientSessionProps) {
  useCombat2ClientSession(props);
  return null;
}
