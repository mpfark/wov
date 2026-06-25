import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import type { User } from '@supabase/supabase-js';

export function useRole(user: User | null) {
  const [role, setRole] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user?.id) {
      setRole(null);
      setLoading(false);
      return;
    }

    let active = true;
    setLoading(true);

    (async () => {
      try {
        // Backend-authoritative: RPC uses auth.uid() and SECURITY DEFINER so it
        // never depends on user_roles RLS visibility in the browser.
        const { data, error } = await supabase.rpc('get_my_admin_role' as any);
        if (!active) return;
        if (error) {
          console.error('Error fetching role:', error);
          setRole(null);
        } else {
          setRole((data as string | null) ?? null);
        }
      } catch (e) {
        if (active) setRole(null);
      } finally {
        if (active) setLoading(false);
      }
    })();

    return () => { active = false; };
  }, [user?.id]);

  const isAdmin = role === 'steward' || role === 'overlord';
  const isValar = role === 'overlord';

  return { role, loading, isAdmin, isValar };
}
