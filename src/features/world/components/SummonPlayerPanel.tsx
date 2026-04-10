import { useState, useCallback } from 'react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { supabase } from '@/integrations/supabase/client';
import { calculateTeleportCpCost } from '@/lib/game-data';
import type { OnlinePlayer } from '@/hooks/useGlobalPresence';

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
  const [loading, setLoading] = useState(false);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; msg: string } | null>(null);

  const handleSummon = useCallback(async () => {
    if (!targetName.trim()) { setFeedback({ type: 'error', msg: 'Enter a character name.' }); return; }
    if (inCombat) { setFeedback({ type: 'error', msg: 'Cannot summon while in combat.' }); return; }
    if (isDead) return;

    // Check target is online
    const online = onlinePlayers.find(p => p.name.toLowerCase() === targetName.trim().toLowerCase());
    if (!online) { setFeedback({ type: 'error', msg: 'Player not found or offline.' }); return; }
    if (online.id === characterId) { setFeedback({ type: 'error', msg: 'Cannot summon yourself.' }); return; }

    // Look up target's node for cost calculation
    const { data: targetChar } = await supabase
      .from('characters')
      .select('id, current_node_id')
      .ilike('name', targetName.trim())
      .single();

    if (!targetChar?.current_node_id) { setFeedback({ type: 'error', msg: 'Player not found.' }); return; }

    const targetRegion = getRegionForNode(targetChar.current_node_id);
    const sameRegion = targetRegion && currentRegionMinLevel !== undefined
      ? targetRegion.min_level === currentRegionMinLevel
      : false;
    const cpCost = calculateTeleportCpCost(
      currentRegionMinLevel,
      targetRegion?.min_level ?? 0,
      sameRegion,
    );

    if (playerCp < cpCost) {
      setFeedback({ type: 'error', msg: `Not enough CP (need ${cpCost}).` });
      return;
    }

    // Check for existing pending request to same target
    const { data: existing } = await supabase
      .from('summon_requests')
      .select('id')
      .eq('summoner_id', characterId)
      .eq('target_id', targetChar.id)
      .eq('status', 'pending')
      .gt('expires_at', new Date().toISOString())
      .limit(1);

    if (existing && existing.length > 0) {
      setFeedback({ type: 'error', msg: 'Summon request already pending.' });
      return;
    }

    setLoading(true);
    try {
      const { error } = await supabase
        .from('summon_requests')
        .insert({
          summoner_id: characterId,
          target_id: targetChar.id,
          summoner_node_id: currentNodeId,
          cp_cost: cpCost,
        });

      if (error) {
        setFeedback({ type: 'error', msg: error.message });
      } else {
        addLog(`🌀 Summon request sent to ${targetName.trim()} (${cpCost} CP). Awaiting response...`);
        setFeedback({ type: 'success', msg: `Request sent to ${targetName.trim()}!` });
        setTargetName('');
      }
    } catch (e: any) {
      setFeedback({ type: 'error', msg: e.message || 'Summon failed.' });
    } finally {
      setLoading(false);
    }
  }, [targetName, characterId, currentNodeId, currentRegionMinLevel, playerCp, getRegionForNode, onlinePlayers, addLog, inCombat, isDead]);

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
        <p className={`text-[10px] ${feedback.type === 'error' ? 'text-destructive' : 'text-chart-2'}`}>
          {feedback.msg}
        </p>
      )}
    </div>
  );
}
