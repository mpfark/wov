import { useMemo } from 'react';
import { useMaterials } from './useMaterials';

/**
 * Backward-compat wrapper around useMaterials, filtered to gems.
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
  const setOwned = () => {};
  return { owned, setOwned };
}
