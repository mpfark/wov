import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';

const unavailable = { join: false, allocate: false, respec: false };
/** One existing projection read when the panel opens; no polling or optimistic authority. */
export function useProgressionAvailability(accountId: string, characterId: string, open: boolean) {
  const [state, setState] = useState({ accountId: '', characterId: '', ...unavailable });
  useEffect(() => {
    let cancelled = false;
    setState({ accountId, characterId, ...unavailable });
    if (!open || !accountId) return;
    void (async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (session?.user.id !== accountId) return;
        const { data, error } = await supabase.rpc('progression_command_projection' as never, { _character: characterId } as never);
        const result = data as unknown as { kind?: string; availability?: Record<string, unknown> };
        if (!cancelled && !error && result?.kind === 'current') setState({ accountId, characterId,
          join: result.availability?.join === true, allocate: result.availability?.allocate === true,
          respec: result.availability?.respec === true });
      } catch { /* Missing/old backend or account transition: fail closed. */ }
    })();
    return () => { cancelled = true; };
  }, [accountId, characterId, open]);
  return state.accountId === accountId && state.characterId === characterId ? state : unavailable;
}
