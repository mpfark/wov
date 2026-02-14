import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';

export interface ActivityLogEntry {
  id: string;
  user_id: string;
  character_id: string | null;
  event_type: string;
  message: string;
  metadata: Record<string, any>;
  created_at: string;
}

/**
 * Log a player activity event. Fire-and-forget — errors are silently ignored.
 */
export async function logActivity(
  userId: string,
  characterId: string | null,
  eventType: string,
  message: string,
  metadata: Record<string, any> = {},
) {
  await supabase.from('activity_log').insert({
    user_id: userId,
    character_id: characterId,
    event_type: eventType,
    message,
    metadata,
  } as any);
}

/**
 * Hook to fetch activity logs for a specific user (admin view).
 * Supports realtime updates and pagination.
 */
export function useActivityLog(userId: string | null, limit = 50) {
  const [logs, setLogs] = useState<ActivityLogEntry[]>([]);
  const [loading, setLoading] = useState(false);

  const fetchLogs = useCallback(async () => {
    if (!userId) { setLogs([]); return; }
    setLoading(true);
    const { data } = await supabase
      .from('activity_log')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(limit);
    if (data) setLogs((data as any) as ActivityLogEntry[]);
    setLoading(false);
  }, [userId, limit]);

  useEffect(() => {
    fetchLogs();
    if (!userId) return;

    const channel = supabase
      .channel(`activity-log-${userId}`)
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'activity_log',
        filter: `user_id=eq.${userId}`,
      }, (payload) => {
        setLogs(prev => [payload.new as ActivityLogEntry, ...prev].slice(0, limit));
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [userId, fetchLogs, limit]);

  return { logs, loading, refetch: fetchLogs };
}
