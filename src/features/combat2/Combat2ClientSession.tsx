import { useCombat2DeliverySession } from './useCombat2DeliverySession';
import { useCombat2EntrySession } from './useCombat2EntrySession';

export interface Combat2ClientSessionProps {
  enabled: boolean;
  characterId: string | null;
  nodeId: string | null;
  hasLivingCreatures: boolean | null;
}

/** Isolated, invisible bridge from authoritative entry identity to delivery. */
export function Combat2ClientSession(props: Combat2ClientSessionProps) {
  const entry = useCombat2EntrySession(props);
  useCombat2DeliverySession({
    enabled: props.enabled,
    characterId: props.characterId,
    encounterId: entry.status === 'entered' ? entry.encounterId : null,
  });
  return null;
}
