import { useMemo } from 'react';
import { useMaterials } from './useMaterials';

/**
 * Transitional compatibility wrapper.
 * Materials ownership now lives in character_materials via useMaterials().
 * Will be removed once all callers migrate to useMaterials directly.
 */
export function useOwnedGems(characterId: string | null | undefined) {
  const { byCategory } = useMaterials(characterId);
  const owned = useMemo(() => {
    const map: Record<string, number> = {};
    for (const e of byCategory('gem')) {
      if (e.count > 0) map[e.key] = e.count;
    }
    return map;
  }, [byCategory]);
  // setOwned kept as no-op for legacy callers; data flows from realtime now.
  const setOwned = (_: unknown) => {};
  return { owned, setOwned };
}
