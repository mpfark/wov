/**
 * useFirstEntryWelcome — emits a staggered, immersive welcome to the event
 * log the first time a character enters the world on this device, and a
 * short "Welcome back" line on every subsequent entry.
 *
 * Onboarding state is per-character in localStorage; no DB change.
 */
import { useEffect, useRef } from 'react';

const FIRST_LINES = [
  'You awaken from a wandering daydream, as though your mind had drifted far beyond the waking world. The thought that held your attention is gone now, lost like mist in the morning sun.',
  'As your senses return, you find yourself standing in Hearthvale Square. Familiar voices mingle with the scent of fresh bread and woodsmoke. In your pockets are a few gems and bits of salvaged material gathered from your recent travels.',
  'From somewhere to the northeast comes the rhythmic song of hammer against anvil.',
  'Clang... clang... clang...',
  'Ah, of course.',
  'You were on your way to see the blacksmith.',
  'What happens next is up to you. Welcome to Wayfarers of Varneth.',
];

const STAGGER_MS = 900;
const key = (cid: string) => `entry.first-welcome.${cid}.v1`;

type Emit = (msg: string) => void;

export function useFirstEntryWelcome(characterId: string | undefined, emit: Emit) {
  const firedFor = useRef<string | null>(null);

  useEffect(() => {
    if (!characterId) return;
    if (firedFor.current === characterId) return;
    firedFor.current = characterId;

    const hasEntered = !!localStorage.getItem(key(characterId));
    const timers: number[] = [];

    if (!hasEntered) {
      FIRST_LINES.forEach((line, i) => {
        const t = window.setTimeout(() => emit(line), i * STAGGER_MS);
        timers.push(t);
      });
      localStorage.setItem(key(characterId), '1');
    } else {
      emit('Welcome back, Wayfarer!');
    }

    return () => { timers.forEach(t => window.clearTimeout(t)); };
  }, [characterId, emit]);
}
