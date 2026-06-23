/**
 * useFirstEntryWelcome — emits a staggered, immersive welcome to the event
 * log the first time a character enters the world on this device, and a
 * short "Welcome back" line on every subsequent entry.
 *
 * Onboarding state is per-character in localStorage (single source of truth).
 * The flag is stamped immediately when we schedule the first-entry lines, so
 * a remount during the opening seconds collapses cleanly to "Welcome back"
 * rather than either double-firing or being silently suppressed.
 *
 * `emit` is held in a ref so staggered timers still reach the *current* event
 * bus even if the component remounts mid-sequence.
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
  const emitRef = useRef(emit);
  emitRef.current = emit;

  useEffect(() => {
    if (!characterId) return;

    const storageKey = key(characterId);
    const hasEntered = !!localStorage.getItem(storageKey);

    if (!hasEntered) {
      // Stamp immediately so any remount during the staggered window collapses
      // to "Welcome back" instead of suppressing the sequence entirely.
      localStorage.setItem(storageKey, '1');
      FIRST_LINES.forEach((line, i) => {
        window.setTimeout(() => emitRef.current(line), i * STAGGER_MS);
      });
    } else {
      emitRef.current('Welcome back, Wayfarer!');
    }
    // No cleanup: scheduled timers are intentionally allowed to fire even if
    // the component briefly unmounts (emit is captured via ref).
  }, [characterId]);
}
