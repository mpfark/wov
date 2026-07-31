import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Progress } from '@/components/ui/progress';
import { bondMultiplier } from '@/shared/formulas/bond';
import { CLASS_LABELS } from '@/shared/formulas/classes';

interface Props {
  characterId: string;
  isClassless?: boolean;
  activeClass?: string | null;
}

interface BondRow {
  class: string;
  bond: number;
}

/**
 * Bond container for the Attributes tab. Shows the bond with the character's
 * CURRENT order only — leaving a class permanently erases its bond, so there is
 * no dormant-bond history to display. Wayfarers render nothing.
 */
export default function ClassBondRow({ characterId, isClassless, activeClass }: Props) {
  const [bonds, setBonds] = useState<BondRow[]>([]);

  useEffect(() => {
    if (!characterId || isClassless) return;
    let cancelled = false;
    const load = async () => {
      const { data } = await supabase
        .from('character_class_bonds')
        .select('class, bond')
        .eq('character_id', characterId)
        .order('class', { ascending: true });
      if (!cancelled) setBonds((data as BondRow[] | null) ?? []);
    };
    load();

    const channel = supabase
      .channel(`bond-${characterId}`)
      .on('postgres_changes', {
        event: '*', schema: 'public', table: 'character_class_bonds',
        filter: `character_id=eq.${characterId}`,
      }, () => { load(); })
      .subscribe();

    return () => { cancelled = true; supabase.removeChannel(channel); };
  }, [characterId, isClassless]);

  const visible = activeClass ? bonds.filter(b => b.class === activeClass) : bonds;

  if (isClassless || visible.length === 0) return null;


  return (
    <div className="border-t border-border-subtle pt-1.5">
      <h4 className="t-label mb-1">Bond</h4>
      <div className="space-y-1">
        {visible.map(({ class: cls, bond }) => {
          const mult = bondMultiplier(bond);
          const classLabel = CLASS_LABELS[cls] ?? cls;
          return (
            <div key={cls} className="px-2 py-1.5 rounded border border-border bg-background/40">
              <div className="flex items-center justify-between text-[10px] mb-1">
                <span className="font-display text-foreground">{classLabel} Bond</span>
                <span className="text-muted-foreground">
                  {bond} / 100 · <span className="text-primary">×{mult.toFixed(2)}</span>
                </span>
              </div>
              <Progress value={bond} className="h-1.5" />
            </div>
          );
        })}
      </div>
      <p className="text-[9px] text-muted-foreground italic mt-1">
        Mastery scales your damage and ability magnitudes (max +15%).
      </p>
    </div>
  );
}
