import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';

// Presentation only: session membership and the 20-minute cutoff are always enforced in SQL.
export function useServerWaymark(accountId: string, characterId: string, nodeId: string | null) {
  const [mark, setMark] = useState<{ node: string; expires: number } | null>(null);
  const generation = useRef(0);
  const sequence = useRef(0);
  const markRef = useRef(mark);
  markRef.current = mark;
  const refresh = useCallback(async (touch = false) => {
    const current = generation.current, request = ++sequence.current;
    try {
      const { data, error } = await supabase.rpc('character_waymark_state' as never, { _character_id: characterId, _touch: touch } as never);
      if (current !== generation.current || request !== sequence.current) return;
      const value = data as unknown as { ok?: boolean; character_id?: string; node_id?: string; expires_at?: string };
      const expires = Date.parse(value?.expires_at ?? '');
      setMark(!error && value?.ok === true && value.character_id === characterId && value.node_id && expires > Date.now()
        ? { node: value.node_id, expires } : null);
    } catch { if (current === generation.current && request === sequence.current) setMark(null); }
  }, [characterId]);
  useEffect(() => {
    generation.current++; setMark(null);
    void refresh();
    return () => { generation.current++; };
  }, [accountId, characterId, nodeId, refresh]);
  useEffect(() => {
    if (!mark) return;
    const timer = setTimeout(() => setMark(null), Math.max(0, mark.expires - Date.now()));
    return () => clearTimeout(timer);
  }, [mark]);
  useEffect(() => {
    // No polling/last_online reuse. At most one touch per 5s, and only real visible input.
    let last = 0;
    const activity = () => {
      if (!markRef.current || document.visibilityState !== 'visible' || Date.now() - last < 5000) return;
      last = Date.now(); void refresh(true);
    };
    const visible = () => { if (document.visibilityState === 'visible') void refresh(); };
    const events = ['mousemove', 'mousedown', 'keydown', 'touchstart', 'scroll'];
    events.forEach(e => window.addEventListener(e, activity, { passive: true }));
    document.addEventListener('visibilitychange', visible);
    return () => {
      events.forEach(e => window.removeEventListener(e, activity));
      document.removeEventListener('visibilitychange', visible);
    };
  }, [accountId, characterId, refresh]);
  return { waymarkNodeId: mark?.node ?? null, refreshWaymark: refresh };
}
