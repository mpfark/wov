import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { Zap } from 'lucide-react';

export default function XpBoostPanel() {
  const [multiplier, setMultiplier] = useState(2);
  const [duration, setDuration] = useState('1');
  const [durationUnit, setDurationUnit] = useState<'hours' | 'days'>('hours');
  const [currentBoost, setCurrentBoost] = useState<{ multiplier: number; expires_at: string | null } | null>(null);
  const [loading, setLoading] = useState(false);

  const fetchCurrent = async () => {
    const { data } = await supabase.from('xp_boost').select('*').limit(1).single();
    if (data) setCurrentBoost({ multiplier: data.multiplier, expires_at: data.expires_at });
  };

  useEffect(() => { fetchCurrent(); }, []);

  const isActive = currentBoost && currentBoost.multiplier > 1 && currentBoost.expires_at && new Date(currentBoost.expires_at).getTime() > Date.now();

  const timeRemaining = () => {
    if (!isActive || !currentBoost?.expires_at) return '';
    const ms = new Date(currentBoost.expires_at).getTime() - Date.now();
    const hours = Math.floor(ms / 3600000);
    const mins = Math.floor((ms % 3600000) / 60000);
    if (hours > 0) return `${hours}h ${mins}m remaining`;
    return `${mins}m remaining`;
  };

  const activate = async () => {
    setLoading(true);
    const durationMs = parseFloat(duration) * (durationUnit === 'days' ? 86400000 : 3600000);
    const expiresAt = new Date(Date.now() + durationMs).toISOString();

    const { error } = await supabase
      .from('xp_boost')
      .update({ multiplier, expires_at: expiresAt })
      .neq('id', '00000000-0000-0000-0000-000000000000'); // update all rows

    if (error) {
      toast.error('Failed to activate boost: ' + error.message);
    } else {
      toast.success(`${multiplier}x XP boost activated for ${duration} ${durationUnit}!`);
      await fetchCurrent();
    }
    setLoading(false);
  };

  const deactivate = async () => {
    setLoading(true);
    const { error } = await supabase
      .from('xp_boost')
      .update({ multiplier: 1, expires_at: null })
      .neq('id', '00000000-0000-0000-0000-000000000000');

    if (error) {
      toast.error('Failed to deactivate: ' + error.message);
    } else {
      toast.success('XP boost deactivated');
      await fetchCurrent();
    }
    setLoading(false);
  };

  return (
    <div className="flex items-center gap-3 px-4 py-2 border-b border-border bg-card/30">
      <Zap className="w-4 h-4 text-primary" />
      <span className="font-display text-xs text-primary">XP Boost</span>

      {isActive ? (
        <>
          <span className="text-xs text-elvish font-semibold">
            {currentBoost!.multiplier}x Active — {timeRemaining()}
          </span>
          <Button variant="destructive" size="sm" className="text-xs h-7" onClick={deactivate} disabled={loading}>
            Deactivate
          </Button>
        </>
      ) : (
        <>
          <Select value={String(multiplier)} onValueChange={(v) => setMultiplier(Number(v))}>
            <SelectTrigger className="w-20 h-7 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="2">2x</SelectItem>
              <SelectItem value="3">3x</SelectItem>
              <SelectItem value="4">4x</SelectItem>
              <SelectItem value="5">5x</SelectItem>
            </SelectContent>
          </Select>
          <span className="text-xs text-muted-foreground">for</span>
          <Input
            type="number"
            min="0.5"
            step="0.5"
            value={duration}
            onChange={(e) => setDuration(e.target.value)}
            className="w-16 h-7 text-xs"
          />
          <Select value={durationUnit} onValueChange={(v) => setDurationUnit(v as 'hours' | 'days')}>
            <SelectTrigger className="w-20 h-7 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="hours">hours</SelectItem>
              <SelectItem value="days">days</SelectItem>
            </SelectContent>
          </Select>
          <Button size="sm" className="text-xs h-7" onClick={activate} disabled={loading}>
            <Zap className="w-3 h-3 mr-1" /> Activate
          </Button>
        </>
      )}
    </div>
  );
}
