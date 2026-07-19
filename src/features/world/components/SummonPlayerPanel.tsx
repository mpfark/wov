import { useState, useCallback, useEffect, useRef } from 'react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { supabase } from '@/integrations/supabase/client';
import type { OnlinePlayer } from '@/hooks/useGlobalPresence';
import { useSummonPlayer } from '@/features/world/hooks/useSummonPlayer';

interface Props {
  characterId: string;
  currentNodeId: string;
  currentRegionMinLevel: number | undefined;
  playerCp: number;
  getRegionForNode: (nodeId: string) => { id: string; min_level: number } | undefined;
  onlinePlayers: OnlinePlayer[];
  addLog: (msg: string) => void;
  inCombat: boolean;
  isDead: boolean;
}

export default function SummonPlayerPanel({
  characterId, currentNodeId, currentRegionMinLevel, playerCp,
  getRegionForNode, onlinePlayers, addLog, inCombat, isDead,
}: Props) {
  const [targetName, setTargetName] = useState('');
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error' | 'info'; msg: string } | null>(null);
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);

  const { summon, loading } = useSummonPlayer({
    characterId, currentNodeId, currentRegionMinLevel, playerCp,
    getRegionForNode, addLog, inCombat, isDead,
  });

  // Subscribe to realtime status changes on outgoing summon requests
  useEffect(() => {
    if (channelRef.current) {
      supabase.removeChannel(channelRef.current);
      channelRef.current = null;
    }

    const channel = supabase
      .channel(`summon-outgoing-${characterId}`)
      .on('postgres_changes', {
        event: 'UPDATE',
        schema: 'public',
        table: 'summon_requests',
        filter: `summoner_id=eq.${characterId}`,
      }, async (payload) => {
        const row = payload.new as { status: string; target_id: string };
        if (row.status === 'accepted') {
          const { data: name } = await supabase.rpc('get_character_name', { _character_id: row.target_id });
          const who = (name as string) || 'Player';
          setFeedback({ type: 'success', msg: `${who} accepted your summon!` });
          addLog(`🌀 ${who} accepted your summon and has arrived!`);
        } else if (row.status === 'declined') {
          const { data: name } = await supabase.rpc('get_character_name', { _character_id: row.target_id });
          const who = (name as string) || 'Player';
          setFeedback({ type: 'error', msg: `${who} declined your summon.` });
          addLog(`🌀 ${who} declined your summon request.`);
        }
      })
      .subscribe();

    channelRef.current = channel;

    return () => {
      supabase.removeChannel(channel);
    };
  }, [characterId, addLog]);

  const handleSummon = useCallback(async () => {
    if (!targetName.trim()) { setFeedback({ type: 'error', msg: 'Enter a character name.' }); return; }

    const online = onlinePlayers.find(p => p.name.toLowerCase() === targetName.trim().toLowerCase());
    if (!online) { setFeedback({ type: 'error', msg: 'Player not found or offline.' }); return; }

    const res = await summon(online.id, online.name, { requireOnline: true, targetIsOnline: true });
    if (!res.ok) {
      setFeedback({ type: 'error', msg: res.message });
    } else {
      setFeedback({ type: 'info', msg: res.message });
      setTargetName('');
    }
  }, [targetName, onlinePlayers, summon]);

  return (
    <div className="space-y-1">
      <h4 className="font-display text-[10px] text-muted-foreground">🌀 Summon Player</h4>
      <div className="flex gap-1">
        <Input
          placeholder="Character name"
          value={targetName}
          onChange={e => { setTargetName(e.target.value); setFeedback(null); }}
          className="h-7 text-xs"
          onKeyDown={e => e.key === 'Enter' && handleSummon()}
        />
        <Button size="sm" variant="outline" className="h-7 text-xs font-display shrink-0" onClick={handleSummon} disabled={loading || !targetName.trim()}>
          Summon
        </Button>
      </div>
      {feedback && (
        <p className={`text-[10px] ${feedback.type === 'error' ? 'text-destructive' : feedback.type === 'success' ? 'text-chart-2' : 'text-muted-foreground'}`}>
          {feedback.msg}
        </p>
      )}
    </div>
  );
}

