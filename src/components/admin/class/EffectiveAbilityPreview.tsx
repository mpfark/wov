/**
 * EffectiveAbilityPreview — base value / class override / effective value.
 *
 * The effective column is produced SOLELY by the shared resolver
 * (`resolveEffectiveAbility`), so this panel can never disagree with what combat
 * resolves. There is no admin-side math here.
 */
import { Badge } from '@/components/ui/badge';
import type { AbilityCalc } from '@/shared/formulas/ability-calc';
import type { BaseAbilityRow, EffectiveAbility } from '@/shared/config/effective-ability';

function calcSummary(calc: AbilityCalc | null | undefined): string {
  if (!calc) return '—';
  const terms = (calc.terms ?? []).map(t => (
    t.source === 'stat' ? `${String(t.stat).toUpperCase()} x${t.mult}` : `${t.source} x${t.mult}`
  ));
  return [String(calc.base ?? 0), ...terms].join(' + ');
}

interface Row { label: string; base: string; override: string | null; effective: string }

export default function EffectiveAbilityPreview({
  base, effective, overriddenKeys,
}: {
  base: BaseAbilityRow;
  effective: EffectiveAbility;
  overriddenKeys: string[];
}) {
  const rows: Row[] = [
    { label: 'Identity', base: base.ability_key, override: null, effective: effective.ability_key },
    { label: 'Mechanic', base: base.mechanic_key, override: null, effective: effective.mechanic_key },
    {
      label: 'Name', base: base.label,
      override: overriddenKeys.includes('label') ? effective.label : null,
      effective: effective.label,
    },
    { label: 'CP cost', base: `${base.cp_cost}`, override: null, effective: `${effective.cp_cost}` },
    {
      label: 'Damage type', base: base.damage_type ?? '—', override: null,
      effective: effective.damage_type ?? '—',
    },
    {
      label: 'Amount', base: calcSummary(base.amount_calc),
      override: overriddenKeys.includes('scaling') ? calcSummary(effective.amount_calc) : null,
      effective: calcSummary(effective.amount_calc),
    },
    {
      label: 'Duration', base: calcSummary(base.duration_calc),
      override: overriddenKeys.includes('scaling') ? calcSummary(effective.duration_calc) : null,
      effective: calcSummary(effective.duration_calc),
    },
  ];

  const mechanicKeys = new Set([
    ...Object.keys(base.mechanic_calcs ?? {}),
    ...Object.keys(effective.mechanic_calcs ?? {}),
  ]);
  for (const key of mechanicKeys) {
    rows.push({
      label: key,
      base: calcSummary(base.mechanic_calcs?.[key]),
      override: (effective.mechanic_calcs?.[key] ?? null) !== (base.mechanic_calcs?.[key] ?? null)
        ? calcSummary(effective.mechanic_calcs?.[key])
        : null,
      effective: calcSummary(effective.mechanic_calcs?.[key]),
    });
  }

  return (
    <div className="space-y-1.5">
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground flex items-center gap-2">
        Effective preview
        <Badge variant={effective.overridden ? 'secondary' : 'outline'} className="text-[9px]">
          {effective.overridden ? 'class override applied' : 'base configuration'}
        </Badge>
      </p>
      <div className="rounded border border-border/60 overflow-hidden">
        <table className="w-full text-[11px]">
          <thead className="bg-muted/40 text-muted-foreground">
            <tr>
              <th className="text-left px-2 py-1 font-normal">Field</th>
              <th className="text-left px-2 py-1 font-normal">Base</th>
              <th className="text-left px-2 py-1 font-normal">Class override</th>
              <th className="text-left px-2 py-1 font-normal">Effective</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border/40">
            {rows.map(r => (
              <tr key={r.label} className={r.override ? 'bg-primary/5' : undefined}>
                <td className="px-2 py-1 text-muted-foreground">{r.label}</td>
                <td className="px-2 py-1 font-mono">{r.base}</td>
                <td className="px-2 py-1 font-mono">{r.override ?? '—'}</td>
                <td className="px-2 py-1 font-mono">{r.effective}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
