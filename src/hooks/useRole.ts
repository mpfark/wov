import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import type { User } from '@supabase/supabase-js';

export function useRole(user: User | null) {
  const [role, setRole] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) {
      setRole(null);
      setLoading(false);
      return;
    }

    const fetch = async () => {
      const { data } = await supabase
        .from('user_roles')
        .select('role')
        .eq('user_id', user.id)
        .maybeSingle();
      setRole(data?.role ?? 'player');
      setLoading(false);
    };

    fetch();
  }, [user]);

  const isAdmin = role === 'maiar' || role === 'valar';
  const isValar = role === 'valar';

  return { role, loading, isAdmin, isValar };
}
