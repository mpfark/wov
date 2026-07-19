import { useCallback, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { calculateTeleportCpCost } from '@/lib/game-data';

export interface UseSummonPlayerParams {
  characterId: string;
  currentNodeId: string | null;
  currentRegionMinLevel: number | undefined;
  playerCp: number;
  getRegionForNode: (nodeId: string) => { id: string; min_level: number } | undefined;
  addLog: (msg: string) => void;
  inCombat: boolean;
  isDead: boolean;
}

export interface SummonResult {
  ok: boolean;
  message: string;
  cpCost?: number;
}

/**
 * Shared summon-request creator. Encapsulates all the validation and CP-cost
 * math previously inlined in SummonPlayerPanel so other UI (party shortcuts,
 * etc.) can trigger a summon without duplicating logic.
 */
export function useSummonPlayer(params: UseSummonPlayerParams) {
  const {
    characterId, currentNodeId, currentRegionMinLevel, playerCp,
    getRegionForNode, addLog, inCombat, isDead,
  } = params;

  const [loading, setLoading] = useState(false);

  const summon = useCallback(async (
    targetCharacterId: string,
    targetName: string,
    opts: { requireOnline?: boolean; targetIsOnline?: boolean } = {},
  ): Promise<SummonResult> => {
    if (!currentNodeId) return { ok: false, message: 'Unknown location.' };
    if (inCombat) return { ok: false, message: 'Cannot summon while in combat.' };
    if (isDead) return { ok: false, message: 'Cannot summon while dead.' };
    if (targetCharacterId === characterId) return { ok: false, message: 'Cannot summon yourself.' };
    if (opts.requireOnline && opts.targetIsOnline === false) {
      return { ok: false, message: `${targetName} is offline.` };
    }

    const { data: targetChar } = await supabase
      .from('characters')
      .select('id, current_node_id')
      .eq('id', targetCharacterId)
      .single();

    if (!targetChar?.current_node_id) return { ok: false, message: 'Player not found.' };
    if (targetChar.current_node_id === currentNodeId) {
      return { ok: false, message: `${targetName} is already here.` };
    }

    const targetRegion = getRegionForNode(targetChar.current_node_id);
    const sameRegion = targetRegion && currentRegionMinLevel !== undefined
      ? targetRegion.min_level === currentRegionMinLevel
      : false;
    const cpCost = calculateTeleportCpCost(
      currentRegionMinLevel,
      targetRegion?.min_level ?? 0,
      sameRegion,
    );

    if (playerCp < cpCost) return { ok: false, message: `Not enough CP (need ${cpCost}).`, cpCost };

    const { data: existing } = await supabase
      .from('summon_requests')
      .select('id')
      .eq('summoner_id', characterId)
      .eq('target_id', targetCharacterId)
      .eq('status', 'pending')
      .gt('expires_at', new Date().toISOString())
      .limit(1);
    if (existing && existing.length > 0) {
      return { ok: false, message: 'Summon request already pending.', cpCost };
    }

    setLoading(true);
    try {
      const { error } = await supabase
        .from('summon_requests')
        .insert({
          summoner_id: characterId,
          target_id: targetCharacterId,
          summoner_node_id: currentNodeId,
          cp_cost: cpCost,
        });
      if (error) return { ok: false, message: error.message, cpCost };
      addLog(`🌀 Summon request sent to ${targetName} (${cpCost} CP). Awaiting response...`);
      return { ok: true, message: `Request sent to ${targetName}!`, cpCost };
    } finally {
      setLoading(false);
    }
  }, [characterId, currentNodeId, currentRegionMinLevel, playerCp, getRegionForNode, addLog, inCombat, isDead]);

  return { summon, loading };
}
