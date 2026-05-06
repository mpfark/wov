import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { Save, RotateCcw } from 'lucide-react';
import {
  DEFAULT_WEAPON_PROGRESSION,
  WEAPON_DAMAGE_DIE,
  getWeaponDieForItem,
  type WeaponProgressionConfig,
} from '@/shared/formulas/combat';

const SAMPLE_LEVELS = [1, 5, 10, 15, 20, 25, 30, 35, 40, 42];
const SAMPLE_WEAPONS: Array<{ tag: string; hands: 1 | 2; label: string }> = [
  { tag: 'dagger', hands: 1, label: 'Dagger (1H)' },
  { tag: 'sword', hands: 1, label: 'Sword (1H)' },
  { tag: 'sword', hands: 2, label: 'Sword (2H)' },
  { tag: 'bow', hands: 2, label: 'Bow (2H)' },
];

export default function WeaponProgressionTab() {
  const [cfg, setCfg] = useState<WeaponProgressionConfig>(DEFAULT_WEAPON_PROGRESSION);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from('weapon_progression_config' as any)
        .select('tier1_level, tier2_level, tier3_level')
        .eq('id', 1)
        .maybeSingle();
      if (data) {
        setCfg({
          tier1_level: (data as any).tier1_level,
          tier2_level: (data as any).tier2_level,
          tier3_level: (data as any).tier3_level,
        });
      }
    })();
  }, []);

  const valid =
    cfg.tier1_level >= 1 &&
    cfg.tier2_level > cfg.tier1_level &&
    cfg.tier3_level > cfg.tier2_level;

  const save = async () => {
    if (!valid) {
      toast.error('Tiers must be ordered: t1 < t2 < t3 (and t1 ≥ 1)');
      return;
    }
    setLoading(true);
    const { error } = await supabase
      .from('weapon_progression_config' as any)
      .update({
        tier1_level: cfg.tier1_level,
        tier2_level: cfg.tier2_level,
        tier3_level: cfg.tier3_level,
      } as any)
      .eq('id', 1);
    setLoading(false);
    if (error) return toast.error(error.message);
    toast.success('Weapon progression saved');
  };

  const reset = () => setCfg(DEFAULT_WEAPON_PROGRESSION);

  return (
    <div className="p-4 space-y-6 max-w-3xl">
      <div className="space-y-1">
        <h3 className="font-display text-sm text-primary">Weapon Die Progression</h3>
        <p className="text-xs text-muted-foreground">
          Higher-level weapons get a bigger damage die on top of their family base
          (sword 1d6, dagger 1d4, bow 1d8…). These thresholds set the item levels
          at which weapons gain +1, +2, and +3 die size.
        </p>
      </div>

      <div className="grid grid-cols-3 gap-3 max-w-md">
        <div>
          <label className="text-[10px] text-muted-foreground">Tier 1 (+1 die)</label>
          <Input
            type="number"
            min={1}
            value={cfg.tier1_level}
            onChange={e => setCfg(c => ({ ...c, tier1_level: Math.max(1, +e.target.value || 1) }))}
            className="h-7 text-xs"
          />
          <p className="text-[9px] text-muted-foreground mt-0.5">Item level ≥ this</p>
        </div>
        <div>
          <label className="text-[10px] text-muted-foreground">Tier 2 (+2 dice)</label>
          <Input
            type="number"
            min={1}
            value={cfg.tier2_level}
            onChange={e => setCfg(c => ({ ...c, tier2_level: Math.max(1, +e.target.value || 1) }))}
            className="h-7 text-xs"
          />
        </div>
        <div>
          <label className="text-[10px] text-muted-foreground">Tier 3 (+3 dice)</label>
          <Input
            type="number"
            min={1}
            value={cfg.tier3_level}
            onChange={e => setCfg(c => ({ ...c, tier3_level: Math.max(1, +e.target.value || 1) }))}
            className="h-7 text-xs"
          />
        </div>
      </div>

      {!valid && (
        <p className="text-xs text-destructive">
          Tiers must satisfy: 1 ≤ t1 &lt; t2 &lt; t3.
        </p>
      )}

      <div className="space-y-2">
        <h4 className="font-display text-xs text-primary">Preview</h4>
        <div className="overflow-x-auto border border-border rounded">
          <table className="w-full text-xs">
            <thead className="bg-muted/50">
              <tr>
                <th className="text-left p-2">Weapon</th>
                {SAMPLE_LEVELS.map(l => (
                  <th key={l} className="p-2 text-center">L{l}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {SAMPLE_WEAPONS.filter(w => WEAPON_DAMAGE_DIE[w.tag]).map(w => (
                <tr key={`${w.tag}-${w.hands}`} className="border-t border-border">
                  <td className="p-2 font-medium">{w.label}</td>
                  {SAMPLE_LEVELS.map(l => {
                    const die = getWeaponDieForItem(w.tag, w.hands, l, cfg);
                    return (
                      <td key={l} className="p-2 text-center font-mono">1d{die}</td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="flex gap-2">
        <Button onClick={save} disabled={loading || !valid} className="font-display text-xs">
          <Save className="w-3 h-3 mr-1" /> Save Progression
        </Button>
        <Button variant="outline" onClick={reset} className="font-display text-xs">
          <RotateCcw className="w-3 h-3 mr-1" /> Reset to defaults (11 / 21 / 31)
        </Button>
      </div>
    </div>
  );
}
