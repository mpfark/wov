import { useEffect, useRef, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { testIdentityMatches } from './test-config';
export { testIdentityMatches } from './test-config';

export async function checkSoloColdEntry(characterId: string): Promise<boolean> {
  // Read-only browser preflight, not an authorization boundary. Any ambiguity denies entry.
  const [members, ledParties, sessions] = await Promise.all([
    supabase.from('party_members').select('id').eq('character_id', characterId).eq('status', 'accepted'),
    supabase.from('parties').select('id').eq('leader_id', characterId),
    supabase.from('combat_sessions').select('id').eq('character_id', characterId),
  ]);
  return !members.error && !ledParties.error && !sessions.error
    && Array.isArray(members.data) && members.data.length === 0
    && Array.isArray(ledParties.data) && ledParties.data.length === 0
    && Array.isArray(sessions.data) && sessions.data.length === 0;
}

export function useCombat2TestOwnership(options: {
  enabled: boolean; characterId: string; nodeId: string | null;
  characterSetting: unknown;
  check?: (id: string) => Promise<boolean>;
}) {
  const { characterId, nodeId, check = checkSoloColdEntry } = options;
  const reserved = testIdentityMatches(options.enabled, characterId, nodeId, options.characterSetting);
  const origin = { characterId, nodeId, reserved };
  const [preflight, setPreflight] = useState<'checking' | 'allowed' | 'refused'>('checking');
  const [locked, setLocked] = useState(false);
  const request = useRef<Promise<boolean> | null>(null);
  useEffect(() => {
    if (!origin.reserved) return;
    // Reuse this read-only attempt during Strict Mode effect replay.
    request.current ??= check(origin.characterId);
    let active = true;
    void request.current.then(ok => { if (active) setPreflight(ok ? 'allowed' : 'refused'); })
      .catch(() => { if (active) setPreflight('refused'); });
    return () => { active = false; };
  }, [reserved, characterId, check]);
  useEffect(() => { if (!reserved) { request.current=null; setPreflight('checking'); setLocked(false); } }, [reserved, characterId]);
  const blocksLegacy = reserved;
  const combat2OwnsSession = blocksLegacy && preflight === 'allowed';
  return {
    blocksLegacy, combat2OwnsSession, preflight,
    locked,
    entryEnabled: combat2OwnsSession && !locked,
    origin,
    lock: () => setLocked(true),
  };
}
