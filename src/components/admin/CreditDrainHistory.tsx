import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Loader2 } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';

interface DrainRun {
  id: string;
  run_started_at: string;
  run_finished_at: string | null;
  generated_count: number;
  cap: number;
  stop_reason: string;
  notes: string | null;
}

const REASON_VARIANT: Record<string, 'default' | 'secondary' | 'destructive' | 'outline'> = {
  cap_hit: 'default',
  credits_exhausted: 'secondary',
  no_targets: 'outline',
  error: 'destructive',
  in_progress: 'outline',
};

export default function CreditDrainHistory() {
  const [runs, setRuns] = useState<DrainRun[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;
    (async () => {
      const { data, error } = await supabase
        .from('ai_credit_drain_log')
        .select('*')
        .order('run_started_at', { ascending: false })
        .limit(12);
      if (!mounted) return;
      if (!error && data) setRuns(data as DrainRun[]);
      setLoading(false);
    })();
    return () => {
      mounted = false;
    };
  }, []);

  return (
    <div className="p-6 max-w-3xl">
      <h2 className="text-2xl font-bold mb-2">Monthly Credit Drain</h2>
      <p className="text-muted-foreground text-sm mb-6">
        On the day before each month change, leftover AI credits are spent generating up to 10 node scene
        illustrations for nodes missing an image. The cron job stops on hard cap or when credits are exhausted.
      </p>

      {loading ? (
        <div className="flex items-center gap-2 text-muted-foreground">
          <Loader2 className="w-4 h-4 animate-spin" /> Loading…
        </div>
      ) : runs.length === 0 ? (
        <Card className="p-6 text-muted-foreground text-sm">No runs yet.</Card>
      ) : (
        <div className="space-y-2">
          {runs.map((r) => (
            <Card key={r.id} className="p-4 flex items-center justify-between gap-4">
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium">
                  {new Date(r.run_started_at).toLocaleString()}{' '}
                  <span className="text-muted-foreground font-normal">
                    ({formatDistanceToNow(new Date(r.run_started_at), { addSuffix: true })})
                  </span>
                </div>
                {r.notes ? (
                  <div className="text-xs text-destructive mt-1 truncate" title={r.notes}>
                    {r.notes}
                  </div>
                ) : null}
              </div>
              <div className="text-right shrink-0">
                <div className="text-sm">
                  <span className="font-semibold">{r.generated_count}</span>
                  <span className="text-muted-foreground"> / {r.cap}</span>
                </div>
                <Badge variant={REASON_VARIANT[r.stop_reason] ?? 'outline'} className="mt-1">
                  {r.stop_reason.replace(/_/g, ' ')}
                </Badge>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
