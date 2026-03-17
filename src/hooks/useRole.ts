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

    const fetchRole = async () => {
      try {
        const { data, error } = await supabase
          .from('user_roles')
          .select('role')
          .eq('user_id', user.id);

        if (!active) return;

        if (error) {
          console.error('Error fetching role:', error);
          setRole(null);
          setLoading(false);
          return;
        }

        let effectiveRole: string | null = null;
        if (data && data.length > 0) {
          if (data.some(r => r.role === 'overlord')) effectiveRole = 'overlord';
          else if (data.some(r => r.role === 'steward')) effectiveRole = 'steward';
          else effectiveRole = 'player';
        }

        setRole(effectiveRole);
      } catch (e) {
        if (active) setRole(null);
      } finally {
        if (active) setLoading(false);
      }
    };

    fetchRole();
    return () => { active = false; };
  }, [user?.id]);

  const isAdmin = role === 'steward' || role === 'overlord';
  const isValar = role === 'overlord';

  return { role, loading, isAdmin, isValar };
}
