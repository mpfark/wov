/**
 * useFirstEntryWelcome — emits a staggered, immersive welcome to the event
 * log the first time a character enters the world on this device, and a
 * short "Welcome back" line on every subsequent entry.
 *
 * Onboarding state is per-character in localStorage; no DB change.
 *
 * Robustness notes:
 *  - A module-level `handledThisPageLoad` set prevents the welcome from
 *    re-firing if GamePage unmounts/remounts during the create→sync flow
 *    (which would otherwise reset the component-local ref and, because the
 *    flag is already in localStorage, fall through to "Welcome back").
 *  - We hold `emit` in a ref so staggered lines still reach the *current*
 *    event bus even if the component remounts mid-sequence.
 *  - The localStorage flag is written only after every line has been
 *    scheduled to emit, so a race during the opening seconds cannot strand
 *    a new character on the short greeting.
 */
import { useEffect, useRef } from "react";

const FIRST_LINES = [
  "You awaken from a wandering daydream, as though your mind had drifted far beyond the waking world. The thought that held your attention is gone now, lost like mist in the morning sun.",
  "As your senses return, you find yourself standing in Hearthvale Square. Familiar voices mingle with the scent of fresh bread and woodsmoke. In your pockets are a few gems and bits of salvaged material gathered from your recent travels.",
  "From somewhere to the northeast comes the rhythmic song of hammer against anvil.",
  "Clang... clang... clang...",
  "Ah, of course.",
  "You were on your way to see the blacksmith.",
  "What happens next is up to you.",
];

const STAGGER_MS = 900;
const key = (cid: string) => `entry.first-welcome.${cid}.v1`;

type Emit = (msg: string) => void;

// Survives remounts within the same page load so we don't double-fire (or,
// worse, flip from first-entry to "Welcome back" on a remount).
const handledThisPageLoad = new Set<string>();

export function useFirstEntryWelcome(characterId: string | undefined, characterLevel: number | undefined, emit: Emit) {
  const emitRef = useRef(emit);
  emitRef.current = emit;

  useEffect(() => {
    if (!characterId) return;
    if (handledThisPageLoad.has(characterId)) return;
    handledThisPageLoad.add(characterId);

    const hasEntered = !!localStorage.getItem(key(characterId));

    // Only play the full immersive intro for a genuine first entry on a
    // brand-new (level 1) character. Established characters arriving on a
    // new device — or after localStorage eviction — get the short greeting
    // and we backfill the flag so subsequent entries stay consistent.
    if (!hasEntered && (characterLevel ?? 1) <= 1) {
      FIRST_LINES.forEach((line, i) => {
        window.setTimeout(() => emitRef.current(line), i * STAGGER_MS);
      });
      window.setTimeout(() => {
        localStorage.setItem(key(characterId), "1");
      }, FIRST_LINES.length * STAGGER_MS);
    } else {
      emitRef.current("Welcome back, Wayfarer!");
      if (!hasEntered) {
        try { localStorage.setItem(key(characterId), "1"); } catch { /* ignore */ }
      }
    }
    // No cleanup: scheduled timers are intentionally allowed to fire even if
    // the component briefly unmounts (emit is captured via ref).
  }, [characterId, characterLevel]);
}

