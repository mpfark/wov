import { useEffect, useRef, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';

/**
 * M6 — Telegraphed boss casts.
 *
 * Node-scoped subscription to `encounter-node-{nodeId}`:
 *   - `cast_started`: adds a telegraph for the boss (creature_id → cast).
 *   - `cast_resolved`: removes the telegraph.
 *
 * On mount/node change, hydrates any casts already in-flight by querying
 * `encounter_cast_events` where `resolved_at IS NULL` for the node — this
 * covers players who arrive mid-cast or reconnect after the broadcast fired.
 *
 * A safety timer auto-removes casts a moment after `expiresAt` in case the
 * `cast_resolved` broadcast was dropped; the server row is the source of
 * truth for damage regardless.
 */
export interface BossCast {
  castEventId: string;
  creatureId: string;
  castKey: string;
  label: string;
  emoji: string;
  startedAt: number; // ms epoch
  expiresAt: number; // ms epoch
  castMs: number;
  amount?: number;
  // Phase 2 — Stored Power.
  // `storedPower` grows during the channel. `visualMax` is frozen at cast
  // start (or on first hydration) so the UI scales stay stable even if the
  // cap or predicted max drifts.
  storedPower: number;
  visualMax: number;
}

export function useBossCasts(nodeId: string | null | undefined) {
  const [casts, setCasts] = useState<Record<string, BossCast>>({});
  const sweepRef = useRef<number | null>(null);

  useEffect(() => {
    if (!nodeId) {
      setCasts({});
      return;
    }
    let cancelled = false;

    const upsert = (c: BossCast) => {
      setCasts(prev => {
        const existing = prev[c.creatureId];
        // Preserve visualMax once frozen, so the bar scale doesn't jitter.
        const next: BossCast = existing && existing.castEventId === c.castEventId
          ? { ...existing, ...c, visualMax: existing.visualMax || c.visualMax, storedPower: c.storedPower ?? existing.storedPower }
          : c;
        return { ...prev, [c.creatureId]: next };
      });
    };
    const removeByCastId = (castEventId: string) => {
      setCasts(prev => {
        const next: Record<string, BossCast> = {};
        for (const [k, v] of Object.entries(prev)) {
          if (v.castEventId !== castEventId) next[k] = v;
        }
        return next;
      });
    };
    const applyTick = (castEventId: string, storedPower: number, visualMax: number) => {
      setCasts(prev => {
        let changed = false;
        const next: Record<string, BossCast> = { ...prev };
        for (const [k, v] of Object.entries(prev)) {
          if (v.castEventId === castEventId) {
            next[k] = {
              ...v,
              storedPower,
              visualMax: v.visualMax > 0 ? v.visualMax : visualMax,
            };
            changed = true;
          }
        }
        return changed ? next : prev;
      });
    };

    // Hydrate active casts for this node.
    (async () => {
      const { data, error } = await supabase
        .from('encounter_cast_events')
        .select('id, creature_id, cast_key, ability_key, started_at, expires_at, resolved_at, payload, encounter_id')
        .eq('node_id', nodeId)
        .is('resolved_at', null);
      if (cancelled || error || !data) return;
      const now = Date.now();
      // Fetch current stored_power per encounter for hydration.
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
          emoji: payload.emoji ?? '☄️',
          startedAt: row.started_at ? new Date(row.started_at).getTime() : now,
          expiresAt: expires,
          castMs: payload.cast_ms ?? Math.max(500, expires - (row.started_at ? new Date(row.started_at).getTime() : now)),
          amount: payload.amount,
          storedPower: stored,
          visualMax: Math.max(stored, Number(payload?.stored_power?.cap) || 0) || Math.max(stored, 1),
        };
      }
      setCasts(prev => ({ ...prev, ...next }));
    })();

    const channel = supabase
      .channel(`encounter-node-${nodeId}`)
      .on('broadcast', { event: 'cast_started' }, ({ payload }) => {
        const p = payload as any;
        if (!p?.creature_id || !p?.cast_event_id) return;
        upsert({
          castEventId: p.cast_event_id,
          creatureId: p.creature_id,
          castKey: p.cast_key,
          label: p.label ?? p.cast_key,
          emoji: p.emoji ?? '☄️',
          startedAt: p.started_at ? new Date(p.started_at).getTime() : Date.now(),
          expiresAt: p.expires_at ? new Date(p.expires_at).getTime() : Date.now() + (p.cast_ms ?? 4000),
          castMs: p.cast_ms ?? 4000,
          amount: p.amount,
          storedPower: Number(p.stored_power) || 0,
          visualMax: Number(p.visual_max) || 1,
        });
      })
      .on('broadcast', { event: 'cast_tick' }, ({ payload }) => {
        const p = payload as any;
        if (!p?.cast_event_id) return;
        applyTick(p.cast_event_id, Number(p.stored_power) || 0, Number(p.visual_max) || 1);
      })
      .on('broadcast', { event: 'cast_resolved' }, ({ payload }) => {
        const p = payload as any;
        if (p?.cast_event_id) removeByCastId(p.cast_event_id);
      })
      .subscribe();

    // Sweep expired casts every 500ms as a safety net.
    sweepRef.current = window.setInterval(() => {
      const now = Date.now();
      setCasts(prev => {
        let changed = false;
        const next: Record<string, BossCast> = {};
        for (const [k, v] of Object.entries(prev)) {
          if (v.expiresAt + 750 > now) next[k] = v;
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
      supabase.removeChannel(channel);
    };
  }, [nodeId]);

  return casts;
}

