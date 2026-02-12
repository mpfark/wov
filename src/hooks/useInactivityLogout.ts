import { useEffect, useRef, useCallback } from 'react';

const INACTIVITY_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes

/**
 * Monitors user activity (mouse, keyboard, touch) and calls onInactive
 * after the specified timeout of no activity.
 */
export function useInactivityLogout(onInactive: () => void) {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onInactiveRef = useRef(onInactive);
  useEffect(() => { onInactiveRef.current = onInactive; }, [onInactive]);

  const resetTimer = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      onInactiveRef.current();
    }, INACTIVITY_TIMEOUT_MS);
  }, []);

  useEffect(() => {
    const events = ['mousemove', 'mousedown', 'keydown', 'touchstart', 'scroll'];
    events.forEach(e => window.addEventListener(e, resetTimer, { passive: true }));
    resetTimer(); // start the timer

    return () => {
      events.forEach(e => window.removeEventListener(e, resetTimer));
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [resetTimer]);
}
