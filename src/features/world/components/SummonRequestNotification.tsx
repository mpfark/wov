import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import type { SummonRequest } from '@/features/world/hooks/useSummonRequests';
import { buildErrorEvent, buildMovementEvent, buildSystemEvent } from '@/features/combat/events/client-event-builder';
import type { GameLogEvent } from '@/features/combat/events/log-event';

interface Props {
  pendingSummons: SummonRequest[];
  onAccept: (requestId: string) => Promise<string | null>;
  onDecline: (requestId: string) => Promise<string | null>;
  addLogEvent: (event: GameLogEvent) => void;
  inCombat: boolean;
  onRefetch?: () => void;
}

export default function SummonRequestNotification({ pendingSummons, onAccept, onDecline, addLogEvent, inCombat, onRefetch }: Props) {
  const [loading, setLoading] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  // Live countdown — re-render every second
  useEffect(() => {
    if (pendingSummons.length === 0) return;
    const id = setInterval(() => setTick(t => t + 1), 1000);
    return () => clearInterval(id);
  }, [pendingSummons.length]);

  if (pendingSummons.length === 0) return null;

  const handleAccept = async (req: SummonRequest) => {
    if (inCombat) { addLogEvent(buildErrorEvent('Cannot accept summon while in combat.')); return; }
    setLoading(req.id);
    const err = await onAccept(req.id);
    setLoading(null);
    if (err) addLogEvent(buildErrorEvent(`Summon failed: ${err}`));
    else {
      addLogEvent(buildMovementEvent(`You were summoned by ${req.summoner_name}!`, { effectType: 'summon' }));
      onRefetch?.();
    }
  };

  const handleDecline = async (req: SummonRequest) => {
    setLoading(req.id);
    await onDecline(req.id);
    setLoading(null);
    addLogEvent(buildSystemEvent(`You declined the summon from ${req.summoner_name}.`, { effectType: 'summon' }));
  };

  // Use tick in remaining calculation to suppress lint warning
  void tick;

  return (
    <div className="space-y-1">
      {pendingSummons.map(req => {
        const remaining = Math.max(0, Math.round((new Date(req.expires_at).getTime() - Date.now()) / 1000));
        return (
          <div key={req.id} className="flex items-center gap-2 rounded border border-primary/30 bg-primary/5 px-2 py-1.5 animate-in fade-in slide-in-from-top-2">
            <span className="text-xs font-display flex-1">
<strong>{req.summoner_name}</strong> is summoning you ({remaining}s)
            </span>
            <Button
              size="sm"
              variant="outline"
              className="h-6 text-[10px] px-2 font-display text-chart-2 border-chart-2/30"
              onClick={() => handleAccept(req)}
              disabled={loading === req.id}
            >
              Accept
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="h-6 text-[10px] px-2 font-display text-destructive border-destructive/30"
              onClick={() => handleDecline(req)}
              disabled={loading === req.id}
            >
              Decline
            </Button>
          </div>
        );
      })}
    </div>
  );
}
