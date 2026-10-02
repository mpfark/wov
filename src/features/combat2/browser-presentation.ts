import type { PartyMember } from '@/features/party/hooks/useParty';
import type { Combat2PresentationModel } from './presentation';
import type { Combat2StanceProjection } from './useCombat2StanceSession';

/** Presentation/session health cannot re-enable a retired runtime after cutover. */
export const combat2BrowserBlocksLegacy = (rolloutEnabled: boolean, ownershipReserved: boolean) =>
  rolloutEnabled || ownershipReserved;

/** Party RPC delivery owns membership/location; an attached snapshot refines resources only. */
export function selectCombat2PartyMembers(characterId: string, members: PartyMember[], model: Combat2PresentationModel | null) {
  if (!members.some(member => member.character_id === characterId)) return [];
  if (!model || model.character.id !== characterId) return members;
  return members.map(member => {
    const ally = model.allies.find(row => row.characterId === member.character_id && row.present);
    return ally ? { ...member, character: { ...member.character, hp: ally.hp, max_hp: ally.maxHp } } : member;
  });
}

/** Display remaining ward only; neither projection provides an authoritative ward capacity. */
export function selectCombat2Ward(characterId: string, projection: Combat2StanceProjection | null, model: Combat2PresentationModel | null): number | null {
  if (model?.character.id === characterId) {
    const effect = model.characterEffects.find(row => row.abilityKey === 'force_shield'
      && row.kind === 'absorb' && row.targetCharacterId === characterId && !row.isReservation);
    return typeof effect?.magnitude === 'number' && Number.isFinite(effect.magnitude) && effect.magnitude >= 0
      ? effect.magnitude : null;
  }
  if (projection?.characterId !== characterId) return null;
  const remaining = projection.stances.find(row => row.abilityKey === 'force_shield')?.state.ward_remaining;
  return typeof remaining === 'number' && Number.isFinite(remaining) && remaining >= 0 ? remaining : null;
}
