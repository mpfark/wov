/**
 * BlacksmithIntroWhisper — a soft fading whisper that nudges brand-new
 * characters to seek out the Hearthvale blacksmith. Once they've stood at
 * a blacksmith node OR crafted once OR dismissed it, it never shows again
 * for this character on this device.
 *
 * Onboarding state lives in localStorage (same pattern as OnboardingCoachmark
 * and SoulforgeWhisper). No DB schema change.
 */
import { useEffect, useState } from 'react';
import { Character } from '@/features/character';

interface Props {
  character: Character | null;
  /** True if the player is currently at a node with `is_blacksmith`. */
  atBlacksmith?: boolean;
}

const dismissKey = (cid: string) => `onboarding.blacksmith-intro.${cid}.dismissed.v1`;
const visitedKey = (cid: string) => `onboarding.blacksmith-intro.${cid}.visited.v1`;
export const craftedKey = (cid: string) => `onboarding.blacksmith-intro.${cid}.crafted.v1`;

export default function BlacksmithIntroWhisper({ character, atBlacksmith }: Props) {
  const [, force] = useState(0);

  // Mark visited the first time the player stands on a blacksmith node.
  useEffect(() => {
    if (!character || !atBlacksmith) return;
    if (localStorage.getItem(visitedKey(character.id))) return;
    localStorage.setItem(visitedKey(character.id), '1');
    force(n => n + 1);
  }, [character?.id, atBlacksmith]);

  if (!character) return null;
  if (character.level > 3) return null;
  if (atBlacksmith) return null;
  if (localStorage.getItem(dismissKey(character.id))) return null;
  if (localStorage.getItem(visitedKey(character.id))) return null;
  if (localStorage.getItem(craftedKey(character.id))) return null;

  const dismiss = () => {
    localStorage.setItem(dismissKey(character.id), '1');
    force(n => n + 1);
  };

  return (
    <div className="fixed bottom-24 left-1/2 z-40 -translate-x-1/2 select-none">
      <button
        onClick={dismiss}
        className="soulforge-whisper block rounded-md border border-primary/30 bg-card/80 px-3 py-1.5 shadow-lg backdrop-blur text-left hover:border-primary/60 transition-colors"
        aria-label="Dismiss blacksmith reminder"
      >
        <p className="text-xs font-display italic text-primary text-glow">
          🔨 A gruff voice whispers: "When you've a coin to spare, come see me at the forge in Hearthvale — to the north-east of the square."
        </p>
        <p className="text-[10px] text-muted-foreground/80 text-center mt-0.5">
          tap to dismiss
        </p>
      </button>
    </div>
  );
}
