import { useEffect, useRef } from 'react';
import { currentCombat2Recording, recordCombat2ResourceState, type Combat2ResourceInput } from './diagnostics';

/** Observe existing React commits and Start only: no timer, request, or state update. */
export function useCombat2ResourceCapture(snapshot: () => Combat2ResourceInput): void {
  const latest = useRef(snapshot);
  latest.current = snapshot;
  const capture = () => {
    try { if (currentCombat2Recording()) recordCombat2ResourceState(latest.current()); }
    catch { /* Diagnostics cannot affect presentation. */ }
  };
  useEffect(capture);
  useEffect(() => {
    window.addEventListener('combat2-diagnostic-change',capture);
    return () => window.removeEventListener('combat2-diagnostic-change',capture);
  }, []);
}
