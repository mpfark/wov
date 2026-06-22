/**
 * Owns: persisted display settings for the Event Log (display mode + font size).
 * Lifted out of EventLogPanel so the controls can be rendered elsewhere
 * (e.g. next to the command input bar) while the panel stays in sync.
 */
import { useCallback, useState } from 'react';
import {
  type CombatLogDisplayMode,
  getStoredDisplayMode,
  setStoredDisplayMode,
} from '@/features/combat/utils/combat-text';

export type EventLogFontSize = 'S' | 'M' | 'L';

const FONT_SIZE_KEY = 'eventLog.fontSize';
const FONT_SIZE_CYCLE: EventLogFontSize[] = ['S', 'M', 'L'];
const MODE_CYCLE: CombatLogDisplayMode[] = ['flavor', 'flavor_numbers'];

export const FONT_SIZE_CLASS: Record<EventLogFontSize, string> = {
  S: 'text-xs',
  M: 'text-sm',
  L: 'text-base',
};

export const FONT_SIZE_TITLE: Record<EventLogFontSize, string> = {
  S: 'Text size: Small (click for Medium)',
  M: 'Text size: Medium (click for Large)',
  L: 'Text size: Large (click for Small)',
};

export const MODE_LABELS: Record<CombatLogDisplayMode, string> = {
  flavor: 'F',
  flavor_numbers: 'F+N',
};

export const MODE_TITLES: Record<CombatLogDisplayMode, string> = {
  flavor: 'Flavor — narrative text only',
  flavor_numbers: 'Flavor + Numbers — narrative text with damage values',
};

function getStoredFontSize(): EventLogFontSize {
  if (typeof window === 'undefined') return 'S';
  const v = window.localStorage.getItem(FONT_SIZE_KEY);
  return v === 'M' || v === 'L' || v === 'S' ? v : 'S';
}

export interface EventLogDisplay {
  displayMode: CombatLogDisplayMode;
  fontSize: EventLogFontSize;
  cycleMode: () => void;
  cycleFontSize: () => void;
}

export function useEventLogDisplay(): EventLogDisplay {
  const [displayMode, setDisplayMode] = useState<CombatLogDisplayMode>(getStoredDisplayMode);
  const [fontSize, setFontSize] = useState<EventLogFontSize>(getStoredFontSize);

  const cycleMode = useCallback(() => {
    setDisplayMode(prev => {
      const idx = MODE_CYCLE.indexOf(prev);
      const next = MODE_CYCLE[(idx + 1) % MODE_CYCLE.length];
      setStoredDisplayMode(next);
      return next;
    });
  }, []);

  const cycleFontSize = useCallback(() => {
    setFontSize(prev => {
      const idx = FONT_SIZE_CYCLE.indexOf(prev);
      const next = FONT_SIZE_CYCLE[(idx + 1) % FONT_SIZE_CYCLE.length];
      if (typeof window !== 'undefined') {
        window.localStorage.setItem(FONT_SIZE_KEY, next);
      }
      return next;
    });
  }, []);

  return { displayMode, fontSize, cycleMode, cycleFontSize };
}
