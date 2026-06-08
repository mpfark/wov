import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Progress } from '@/components/ui/progress';
import { bondMultiplier } from '@/shared/formulas/bond';
import { CLASS_LABELS } from '@/shared/formulas/classes';

interface Props {
  characterId: string;
  characterClass: string;
  isClassless?: boolean;
}

/**
 * Compact Bond row for the Attributes tab. Shows current Bond + the live
 * damage/DoT/utility multiplier it grants for the character's active class.
 * Wayfarers (no order) render nothing (no class to bond with).
 */
export default function ClassBondRow({ characterId, characterClass, isClassless }: Props) {
  const [bond, setBond] = useState<number>(0);

  useEffect(() => {
    if (!characterId || isClassless) return;
    let cancelled = false;
    const load = async () => {
      const { data } = await supabase
        .from('character_class_bonds')
        .select('bond')
        .eq('character_id', characterId)
        .eq('class', characterClass as any)
        .maybeSingle();
      if (!cancelled) setBond((data as any)?.bond ?? 0);
    };
    load();

    const channel = supabase
      .channel(`bond-${characterId}-${characterClass}`)
      .on('postgres_changes', {
        event: '*', schema: 'public', table: 'character_class_bonds',
        filter: `character_id=eq.${characterId}`,
      }, () => { load(); })
      .subscribe();

    return () => { cancelled = true; supabase.removeChannel(channel); };
  }, [characterId, characterClass, isClassless]);

  if (isClassless || !characterClass) return null;

  const mult = bondMultiplier(bond);
  const classLabel = CLASS_LABELS[characterClass] ?? characterClass;

  return (
    <div className="px-2 py-1.5 mb-1 rounded border border-border bg-background/40">
      <div className="flex items-center justify-between text-[10px] mb-1">
        <span className="font-display text-foreground">{classLabel} Bond</span>
        <span className="text-muted-foreground">
          {bond} / 100 · <span className="text-primary">×{mult.toFixed(2)}</span>
        </span>
      </div>
      <Progress value={bond} className="h-1.5" />
      <p className="text-[9px] text-muted-foreground italic mt-1">
        Mastery scales your damage and ability magnitudes (max +15%).
      </p>
    </div>
  );
}
