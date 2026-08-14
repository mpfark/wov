import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import type { CombatTickResponse } from '../utils/interpretCombatTickResult';

/**
 * Telegraphed boss casts — committed-state only (C5).
 *
 * The telegraph is a *view of the authoritative fight*, so it is driven by the
 * same committed tick batches that carry the damage:
 *
 *   - `phase: 'start'`   → open a telegraph for the creature;
 *   - `phase: 'resolve'` → the hit landed, clear it;
 *   - `phase: 'fizzle'`  → nothing landed, clear it;
 *   - `boss_stored_power` → grow the banked-power bar.
 *
 * There is deliberately no broadcast path any more: a dropped or duplicated
 * realtime message can no longer leave a ghost bar running, and a client that
 * never saw the start cannot miss the clear.
 *
 * On mount/node change we hydrate from `encounter_cast_events` (the durable
 * half of a telegraph) so arriving mid-channel or reconnecting shows the same
 * in-flight cast everyone else sees. The expiry sweep remains as a last-resort
 * net for a client that goes silent past the cast window.
 */
export interface BossCast {
  castEventId: string;
  creatureId: string;
  castKey: string;
  label: string;
  startedAt: number; // ms epoch
  expiresAt: number; // ms epoch
  castMs: number;
  amount?: number;
  // `storedPower` grows during the channel. `visualMax` is frozen at cast
  // start (or on first hydration) so the bar scale stays stable even if the
  // cap or predicted max drifts.
  storedPower: number;
  visualMax: number;
}

export interface BossCastFeed {
  casts: Record<string, BossCast>;
  /** Apply one committed tick batch's telegraph transitions. */
  applyCommitted: (result: CombatTickResponse) => void;
}

export function useBossCasts(nodeId: string | null | undefined): BossCastFeed {
  const [casts, setCasts] = useState<Record<string, BossCast>>({});
  const sweepRef = useRef<number | null>(null);
  // Duplicate batch delivery must be idempotent for the telegraph too.
  const appliedBatchesRef = useRef<Set<string>>(new Set());

  const applyCommitted = useCallback((result: CombatTickResponse) => {
    const transitions = result.boss_casts ?? [];
    const stored = result.boss_stored_power ?? [];
    if (transitions.length === 0 && stored.length === 0) return;

    const batchId = result.encounter_batch_id ?? null;
    if (batchId) {
      if (appliedBatchesRef.current.has(batchId)) return;
      appliedBatchesRef.current.add(batchId);
      if (appliedBatchesRef.current.size > 512) {
        appliedBatchesRef.current = new Set([batchId]);
      }
    }

    setCasts((prev) => {
      const next: Record<string, BossCast> = { ...prev };
      const now = Date.now();

      for (const t of transitions) {
        if (t.phase === 'start') {
          const existing = next[t.creature_id];
          const castMs = t.cast_ms > 0 ? t.cast_ms : 4000;
          next[t.creature_id] = {
            castEventId: t.cast_event_id ?? `${t.creature_id}:${t.resolves_at_ms}`,
            creatureId: t.creature_id,
            castKey: t.cast_key,
            label: t.label,
            startedAt: now,
            expiresAt: t.resolves_at_ms > now ? t.resolves_at_ms : now + castMs,
            castMs,
            storedPower: existing?.storedPower ?? 0,
            visualMax: Math.max(1, t.stored_power_cap || existing?.visualMax || 1),
          };
        } else {
          // Resolve and fizzle both end the telegraph. Matching on creature is
          // correct here: the committer only ever closes the row it resolved,
          // and a creature can channel one cast at a time.
          delete next[t.creature_id];
        }
      }

      for (const s of stored) {
        const cast = next[s.creature_id];
        if (!cast) continue;
        next[s.creature_id] = {
          ...cast,
          storedPower: s.current,
          visualMax: cast.visualMax > 0 ? cast.visualMax : Math.max(1, s.cap),
        };
      }

      return next;
    });
  }, []);

  useEffect(() => {
    if (!nodeId) {
      setCasts({});
      return;
    }
    let cancelled = false;

    // Hydrate active casts for this node from the durable cast rows.
    (async () => {
      const { data, error } = await supabase
        .from('encounter_cast_events')
        .select('id, creature_id, cast_key, ability_key, started_at, expires_at, resolved_at, payload, encounter_id')
        .eq('node_id', nodeId)
        .is('resolved_at', null);
      if (cancelled || error || !data) return;
      const now = Date.now();
      const encIds = Array.from(new Set(data.map((r: any) => r.encounter_id).filter(Boolean)));
      const spByEncounter: Record<string, number> = {};
      if (encIds.length > 0) {
        const { data: encs } = await supabase
          .from('encounters')
          .select('id, stored_power')
          .in('id', encIds as string[]);
        for (const e of encs || []) spByEncounter[e.id as string] = Number((e as any).stored_power) || 0;
      }
      const next: Record<string, BossCast> = {};
      for (const row of data) {
        const expires = row.expires_at ? new Date(row.expires_at).getTime() : 0;
        if (!expires || expires < now) continue;
        const payload = (row.payload as any) || {};
        const stored = spByEncounter[(row as any).encounter_id] ?? 0;
        next[row.creature_id as string] = {
          castEventId: row.id as string,
          creatureId: row.creature_id as string,
          castKey: row.cast_key as string,
          label: payload.label ?? (row.cast_key as string),
          startedAt: row.started_at ? new Date(row.started_at).getTime() : now,
          expiresAt: expires,
          castMs: payload.cast_ms ?? Math.max(500, expires - (row.started_at ? new Date(row.started_at).getTime() : now)),
          amount: payload.amount,
          storedPower: stored,
          visualMax: Math.max(stored, Number(payload?.stored_power?.cap) || 0) || Math.max(stored, 1),
        };
      }
      if (!cancelled) setCasts(prev => ({ ...prev, ...next }));
    })();

    // Sweep long-expired casts every 500ms as a safety net for a silent client.
    sweepRef.current = window.setInterval(() => {
      const now = Date.now();
      setCasts(prev => {
        let changed = false;
        const next: Record<string, BossCast> = {};
        for (const [k, v] of Object.entries(prev)) {
          if (v.expiresAt + 2000 > now) next[k] = v;
          else changed = true;
        }
        return changed ? next : prev;
      });
    }, 500);

    return () => {
      cancelled = true;
      if (sweepRef.current) {
        clearInterval(sweepRef.current);
        sweepRef.current = null;
      }
    };
  }, [nodeId]);

  return useMemo(() => ({ casts, applyCommitted }), [casts, applyCommitted]);
}
