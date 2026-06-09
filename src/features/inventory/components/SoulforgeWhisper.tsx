/**
 * SoulforgeWhisper — a soft, slowly fading whisper that nags the player to
 * visit the Soulforge whenever they've crossed a Soulforged Ring milestone
 * (L30 / 33 / 36 / 39 / 42) but haven't yet re-forged.
 *
 * Pure derived state from the character; auto-hides when the player is
 * standing at a Soulforge node so it isn't shouting in their face.
 */
import { useMemo } from 'react';
import { Character } from '@/features/character';
import { getNextSoulringStep, SOULRING_TIER_NAMES } from '@/lib/game-data';

interface Props {
  character: Character | null;
  /** True if the player is currently at a node with `is_soulforge`. */
  atSoulforge?: boolean;
}

export default function SoulforgeWhisper({ character, atSoulforge }: Props) {
  const step = useMemo(
    () => character ? getNextSoulringStep(character.level, character.soulring_tier ?? 0) : null,
    [character],
  );

  if (!step || atSoulforge) return null;

  const tierName = SOULRING_TIER_NAMES[step.nextTier - 1];

  return (
    <div className="pointer-events-none fixed bottom-24 left-1/2 z-40 -translate-x-1/2 select-none">
      <div className="soulforge-whisper rounded-md border border-soulforged/30 bg-card/80 px-3 py-1.5 shadow-lg backdrop-blur">
        <p className="text-xs font-display italic text-soulforged text-glow-soulforged">
          💍 "Your ring is increasing in strength… visit the Soulforge."
        </p>
        <p className="text-[10px] text-muted-foreground/80 text-center">
          {tierName} awaits
        </p>
      </div>
    </div>
  );
}
