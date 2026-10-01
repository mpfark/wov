import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';

export interface Combat2CharacterStance {
  abilityKey: string;
  reservePct: number;
  reservedCp: number;
  state: Record<string, unknown>;
  version: number;
}

export interface Combat2StanceProjection {
  characterId: string;
  rawCp: number;
  maxCp: number;
  reservedCp: number;
  spendableCp: number;
  stances: Combat2CharacterStance[];
}

export type Combat2StanceResult = { status: 'accepted'; classification: 'activated' | 'dropped' }
  | { status: 'refused'; classification: string }
  | { status: 'stale' | 'uncertain' | 'error'; reason: string };

const decodeProjection = (raw: unknown): Combat2StanceProjection | null => {
  if (!raw || typeof raw !== 'object') return null;
  const row = raw as Record<string, unknown>;
  if (row.ok !== true || row.kind !== 'projected' || typeof row.character_id !== 'string'
      || !Array.isArray(row.stances)) return null;
  const stances: Combat2CharacterStance[] = [];
  for (const value of row.stances) {
    if (!value || typeof value !== 'object') return null;
    const stance = value as Record<string, unknown>;
    if (typeof stance.ability_key !== 'string' || typeof stance.reserve_pct !== 'number'
        || typeof stance.reserved_cp !== 'number' || typeof stance.version !== 'number') return null;
    stances.push({ abilityKey: stance.ability_key, reservePct: stance.reserve_pct,
      reservedCp: stance.reserved_cp, version: stance.version,
      state: stance.state && typeof stance.state === 'object' ? stance.state as Record<string, unknown> : {} });
  }
  return { characterId: row.character_id, rawCp: Number(row.raw_cp), maxCp: Number(row.max_cp),
    reservedCp: Number(row.reserved_cp), spendableCp: Number(row.spendable_cp), stances };
};

export function useCombat2StanceSession(options: {
  enabled: boolean;
  characterId: string | null;
  refreshKey?: string | number | null;
  generateRequestId?: () => string;
}) {
  const { enabled, characterId, refreshKey, generateRequestId = () => crypto.randomUUID() } = options;
  const generation = useRef(0);
  const attempt = useRef<{ key: string; requestId: string; action: 'activate' | 'drop'; inFlight: boolean } | null>(null);
  const [projection, setProjection] = useState<Combat2StanceProjection | null>(null);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    if (!enabled || !characterId) { setProjection(null); return; }
    const current = ++generation.current;
    setLoading(true);
    const { data, error } = await supabase.rpc('combat2_character_stances' as never,
      { _character_id: characterId } as never);
    if (current !== generation.current) return;
    setLoading(false);
    const decoded = !error ? decodeProjection(data) : null;
    setProjection(decoded?.characterId === characterId ? decoded : null);
  }, [characterId, enabled]);

  useEffect(() => { void refresh(); return () => { generation.current += 1; }; }, [refresh, refreshKey]);

  const change = useCallback(async (abilityKey: string, action: 'activate' | 'drop'): Promise<Combat2StanceResult> => {
    if (!enabled || !characterId || !projection || projection.characterId !== characterId) {
      return { status: 'error', reason: 'Authoritative stance state is unavailable' };
    }
    const existing = attempt.current;
    if (existing?.inFlight) return { status: 'refused', classification: 'action_in_flight' };
    const next = existing && existing.key === abilityKey && existing.action === action
      ? existing : { key: abilityKey, action, requestId: generateRequestId(), inFlight: false };
    attempt.current = next; next.inFlight = true;
    const current = generation.current;
    try {
      const { data, error } = await supabase.rpc('combat2_change_stance' as never, {
        _character_id: characterId, _ability_key: abilityKey, _action: action, _request_id: next.requestId,
      } as never);
      next.inFlight = false;
      if (generation.current !== current) return { status: 'stale', reason: 'Character changed' };
      if (error) return { status: 'uncertain', reason: 'Stance request outcome is uncertain' };
      const row = data as unknown as Record<string, unknown>;
      if (row?.ok !== true) {
        attempt.current = null;
        return { status: 'refused', classification: String(row?.kind ?? 'malformed_response') };
      }
      const decoded = decodeProjection(row.projection);
      if (!decoded || decoded.characterId !== characterId) {
        attempt.current = null;
        return { status: 'error', reason: 'Malformed stance projection' };
      }
      setProjection(decoded); attempt.current = null;
      return { status: 'accepted', classification: row.kind as 'activated' | 'dropped' };
    } catch {
      next.inFlight = false;
      return { status: 'uncertain', reason: 'Stance request outcome is uncertain' };
    }
  }, [characterId, enabled, generateRequestId, projection]);

  return { projection, loading, ready: !!projection && projection.characterId === characterId, refresh, change };
}
