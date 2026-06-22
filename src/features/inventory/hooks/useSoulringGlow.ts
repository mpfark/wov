/**
 * useSoulringGlow — fires an event-log whisper and a transient glow flag
 * when the character's `soulring_tier` increases (acquisition or re-forge).
 *
 * The first observed value at mount is a baseline — we do not fire for it,
 * only for subsequent increases. Glow lasts ~8s.
 */
import { useEffect, useRef, useState } from 'react';

const GLOW_MS = 8000;
const WHISPER = '💍 You feel a warmth at your hand — your Soulforged Ring hums with new power. Return to the Soulforge when you are ready.';

type Emit = (msg: string) => void;

export function useSoulringGlow(
  characterId: string | undefined,
  soulringTier: number | null | undefined,
  emit: Emit,
): boolean {
  const lastTierRef = useRef<number | null>(null);
  const lastCharRef = useRef<string | null>(null);
  const [glow, setGlow] = useState(false);

  useEffect(() => {
    if (!characterId) return;
    const tier = soulringTier ?? 0;

    // New character mounted — seed baseline silently.
    if (lastCharRef.current !== characterId) {
      lastCharRef.current = characterId;
      lastTierRef.current = tier;
      return;
    }

    const prev = lastTierRef.current ?? 0;
    if (tier > prev) {
      lastTierRef.current = tier;
      emit(WHISPER);
      setGlow(true);
      const t = window.setTimeout(() => setGlow(false), GLOW_MS);
      return () => window.clearTimeout(t);
    }
    lastTierRef.current = tier;
  }, [characterId, soulringTier, emit]);

  return glow;
}
