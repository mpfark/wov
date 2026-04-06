import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { Save } from 'lucide-react';

interface PoolConfig {
  equip_level_min_offset: number;
  equip_level_max_offset: number;
  common_pct: number;
  uncommon_pct: number;
  consumable_drop_chance: number;
  consumable_level_min_offset: number;
  consumable_level_max_offset: number;
}

const DEFAULT_CONFIG: PoolConfig = {
  equip_level_min_offset: -3,
  equip_level_max_offset: 0,
  common_pct: 80,
  uncommon_pct: 20,
  consumable_drop_chance: 0.15,
  consumable_level_min_offset: -5,
  consumable_level_max_offset: 0,
};

export default function PoolRulesTab() {
  const [config, setConfig] = useState<PoolConfig>(DEFAULT_CONFIG);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    (async () => {
      const { data } = await supabase.from('loot_pool_config' as any).select('*').eq('id', 1).single();
      if (data) setConfig(data as any);
    })();
  }, []);

  const handleSave = async () => {
    setLoading(true);
    const { error } = await supabase.from('loot_pool_config' as any).update({
      equip_level_min_offset: config.equip_level_min_offset,
      equip_level_max_offset: config.equip_level_max_offset,
      common_pct: config.common_pct,
      uncommon_pct: 100 - config.common_pct,
      consumable_drop_chance: config.consumable_drop_chance,
      consumable_level_min_offset: config.consumable_level_min_offset,
      consumable_level_max_offset: config.consumable_level_max_offset,
    } as any).eq('id', 1);
    setLoading(false);
    if (error) return toast.error(error.message);
    toast.success('Pool rules saved');
  };

  return (
    <div className="p-4 space-y-6 max-w-lg">
      <div className="space-y-1">
        <h3 className="font-display text-sm text-primary">Creature Type Defaults</h3>
        <p className="text-xs text-muted-foreground">These defaults are auto-applied per creature type.</p>
        <div className="grid grid-cols-2 gap-2 mt-2">
          <div className="p-2 bg-background/50 border border-border rounded text-xs">
            <strong>Humanoid</strong>
            <p className="text-muted-foreground">🪙 Gold + 🎲 Item Pool + 🧴 Consumables</p>
          </div>
          <div className="p-2 bg-background/50 border border-border rounded text-xs">
            <strong>Non-Humanoid</strong>
            <p className="text-muted-foreground">🔩 Salvage only (no item drops)</p>
          </div>
        </div>
      </div>

      <div className="space-y-3">
        <h3 className="font-display text-sm text-primary">Equipment Pool</h3>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-[10px] text-muted-foreground">Min Level Offset</label>
            <Input type="number" value={config.equip_level_min_offset}
              onChange={e => setConfig(c => ({ ...c, equip_level_min_offset: +e.target.value }))}
              className="h-7 text-xs" />
            <p className="text-[9px] text-muted-foreground mt-0.5">e.g. -3 → creature_level - 3</p>
          </div>
          <div>
            <label className="text-[10px] text-muted-foreground">Max Level Offset</label>
            <Input type="number" value={config.equip_level_max_offset}
              onChange={e => setConfig(c => ({ ...c, equip_level_max_offset: +e.target.value }))}
              className="h-7 text-xs" />
            <p className="text-[9px] text-muted-foreground mt-0.5">e.g. 0 → creature_level</p>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-[10px] text-muted-foreground">Common %</label>
            <Input type="number" min={0} max={100} value={config.common_pct}
              onChange={e => setConfig(c => ({ ...c, common_pct: Math.min(100, Math.max(0, +e.target.value)) }))}
              className="h-7 text-xs" />
          </div>
          <div>
            <label className="text-[10px] text-muted-foreground">Uncommon %</label>
            <Input type="number" value={100 - config.common_pct} disabled className="h-7 text-xs" />
          </div>
        </div>
      </div>

      <div className="space-y-3">
        <h3 className="font-display text-sm text-primary">Consumable Pool</h3>
        <div className="grid grid-cols-3 gap-3">
          <div>
            <label className="text-[10px] text-muted-foreground">Drop Chance</label>
            <Input type="number" step={0.01} min={0} max={1} value={config.consumable_drop_chance}
              onChange={e => setConfig(c => ({ ...c, consumable_drop_chance: +e.target.value }))}
              className="h-7 text-xs" />
            <p className="text-[9px] text-muted-foreground mt-0.5">{Math.round(config.consumable_drop_chance * 100)}% chance</p>
          </div>
          <div>
            <label className="text-[10px] text-muted-foreground">Min Level Offset</label>
            <Input type="number" value={config.consumable_level_min_offset}
              onChange={e => setConfig(c => ({ ...c, consumable_level_min_offset: +e.target.value }))}
              className="h-7 text-xs" />
          </div>
          <div>
            <label className="text-[10px] text-muted-foreground">Max Level Offset</label>
            <Input type="number" value={config.consumable_level_max_offset}
              onChange={e => setConfig(c => ({ ...c, consumable_level_max_offset: +e.target.value }))}
              className="h-7 text-xs" />
          </div>
        </div>
      </div>

      <Button onClick={handleSave} disabled={loading} className="font-display text-xs">
        <Save className="w-3 h-3 mr-1" /> Save Pool Rules
      </Button>
    </div>
  );
}
