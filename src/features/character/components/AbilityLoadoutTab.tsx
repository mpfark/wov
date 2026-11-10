import type { Character } from '@/features/character';
import { useAbilityLoadout, type AbilityLoadoutState } from '@/hooks/useAbilityLoadout';
import { EngineSpellbook } from '@/features/combat2/ui/EngineSpellbook';

interface Props {
  character: Character;
  inCombat?: boolean;
  loadout?: AbilityLoadoutState;
}

/** Compatibility entry point; engine UI owns spellbook presentation. */
export default function AbilityLoadoutTab({ character, inCombat, loadout }: Props) {
  const local = useAbilityLoadout(loadout ? undefined : character.id, character.class);
  return <EngineSpellbook level={character.level} inCombat={inCombat} loadout={loadout ?? local} />;
}
