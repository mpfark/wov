/**
 * GlobalModifiersPanel — read-out of the two global damage-pipeline rules that
 * are deliberately NOT per-ability config: class Bond mastery and the wizard
 * Arcane Surge. The panel exposes the controlling values (bond points, INT mod)
 * and shows the pre → post magnitude so an admin tuning an ability sees the
 * number a real character will actually land.
 */
import { useState } from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { bondMultiplier } from '@/shared/formulas/bond';
import { resolveAmountByKey } from '@/features/combat/utils/ability-calcs';

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export default function GlobalModifiersPanel({
  baseMagnitude, intMod,
}: {
  /** Pre-pipeline magnitude from the ability's amount calc. */
  baseMagnitude: number;
  intMod: number;
}) {
  const [bond, setBond] = useState(100);
  const [surgeOn, setSurgeOn] = useState(false);

  const bondMult = bondMultiplier(bond);
  // Arcane Surge magnitude is configured on its own ability row, so the panel
  // reads it through the same resolver the combat pipeline uses.
  const surgeMult = surgeOn
    ? resolveAmountByKey('arcane_surge', {
        level: 1,
        mods: { str: 0, dex: 0, con: 0, int: intMod, wis: 0, cha: 0 },
      }, 1)
    : 1;
  const final = baseMagnitude * bondMult * surgeMult;

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-1.5">
          <Label className="text-[10px] text-muted-foreground">Bond</Label>
          <Input
            type="number" min={0} max={100} value={bond}
            onChange={e => setBond(Number(e.target.value))}
            className="h-7 w-16 text-[11px]"
          />
          <Badge variant="outline" className="text-[9px] font-mono">×{bondMult.toFixed(4)}</Badge>
        </div>
        <label className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
          <input
            type="checkbox"
            checked={surgeOn}
            onChange={e => setSurgeOn(e.target.checked)}
            className="accent-primary"
          />
          Arcane Surge (INT {intMod >= 0 ? `+${intMod}` : intMod})
          <Badge variant="outline" className="text-[9px] font-mono">×{surgeMult.toFixed(4)}</Badge>
        </label>
      </div>
      <p className="text-[11px] text-muted-foreground">
        pipeline: <span className="font-mono text-foreground">{round2(baseMagnitude)}</span>
        {' → '}
        <span className="font-mono text-primary">{round2(final)}</span>
        <span className="ml-2 text-[10px]">
          Bond and Arcane Surge apply to magnitudes only — never durations, costs or hit chance.
        </span>
      </p>
    </div>
  );
}
