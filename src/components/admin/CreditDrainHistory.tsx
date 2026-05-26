import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Loader2, KeyRound, CheckCircle2 } from 'lucide-react';
import { toast } from 'sonner';
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
  const [secretSet, setSecretSet] = useState<boolean | null>(null);
  const [secretInput, setSecretInput] = useState('');
  const [saving, setSaving] = useState(false);

  const reload = async () => {
    const [{ data: runData }, { data: secData }] = await Promise.all([
      supabase
        .from('ai_credit_drain_log')
        .select('*')
        .order('run_started_at', { ascending: false })
        .limit(12),
      supabase.from('app_secrets').select('key').eq('key', 'DRAIN_CRON_SECRET').maybeSingle(),
    ]);
    setRuns((runData as DrainRun[]) || []);
    setSecretSet(!!secData);
    setLoading(false);
  };

  useEffect(() => {
    reload();
  }, []);

  const saveSecret = async () => {
    if (!secretInput.trim()) return;
    setSaving(true);
    const { error } = await supabase
      .from('app_secrets')
      .upsert({ key: 'DRAIN_CRON_SECRET', value: secretInput.trim(), updated_at: new Date().toISOString() });
    setSaving(false);
    if (error) {
      toast.error(`Failed to save: ${error.message}`);
      return;
    }
    toast.success('Cron secret saved. Job is now armed.');
    setSecretInput('');
    reload();
  };

  return (
    <div className="p-6 max-w-3xl">
      <h2 className="text-2xl font-bold mb-2">Monthly Credit Drain</h2>
      <p className="text-muted-foreground text-sm mb-6">
        On the day before each month change, leftover AI credits are spent generating up to 10 node scene
        illustrations for nodes missing an image. The cron job stops on hard cap or when credits are exhausted.
      </p>

      <Card className="p-4 mb-6">
        <div className="flex items-start gap-3">
          <KeyRound className="w-5 h-5 mt-0.5 text-muted-foreground shrink-0" />
          <div className="flex-1">
            <div className="text-sm font-medium mb-1 flex items-center gap-2">
              Cron secret
              {secretSet ? (
                <Badge variant="default" className="gap-1">
                  <CheckCircle2 className="w-3 h-3" /> Armed
                </Badge>
              ) : (
                <Badge variant="destructive">Not set — cron is dead</Badge>
              )}
            </div>
            <p className="text-xs text-muted-foreground mb-3">
              Paste the same value you entered for the <code>DRAIN_CRON_SECRET</code> backend secret. The cron job
              reads this to authenticate against the edge function.
            </p>
            <div className="flex gap-2">
              <Label htmlFor="drain-secret" className="sr-only">Secret</Label>
              <Input
                id="drain-secret"
                type="password"
                value={secretInput}
                onChange={(e) => setSecretInput(e.target.value)}
                placeholder={secretSet ? '••••••••  (replace existing)' : 'Paste secret value'}
                autoComplete="off"
              />
              <Button onClick={saveSecret} disabled={!secretInput.trim() || saving}>
                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Save'}
              </Button>
            </div>
          </div>
        </div>
      </Card>

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
