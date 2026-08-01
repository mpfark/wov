/**
 * MechanicCalcsEditor — template-driven editor for an ability's *named* mechanic
 * calculations (`abilities.mechanic_calcs`).
 *
 * The mechanic template registry decides which parameters exist for the
 * selected mechanic, their label, unit and whether they are required. Nothing
 * here is free-form: unknown keys can't be authored, and required params are
 * surfaced as blocking errors so a draft can't be published half-configured.
 */
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { AlertTriangle, Plus } from 'lucide-react';
import CalcBuilder, { EMPTY_CALC } from './CalcBuilder';
import type { AbilityCalc, CalcInputs, CalcUnit } from '@/shared/formulas/ability-calc';
import {
  getMechanicTemplate, validateMechanicCalcs,
  type MechanicCalcParam, type MechanicCalcUnit,
} from '@/shared/config/mechanic-templates';

/** Map a mechanic param unit onto the calc contract's presentation unit. */
const UNIT_MAP: Record<MechanicCalcUnit, CalcUnit> = {
  count: 'count',
  pct: 'percent',
  mult: 'multiplier',
  hp: 'hp',
  cp: 'flat',
  flat: 'flat',
  ms: 'ms',
};

function seedFor(param: MechanicCalcParam): AbilityCalc {
  return {
    ...EMPTY_CALC,
    base: param.unit === 'mult' ? 1 : 0,
    unit: UNIT_MAP[param.unit],
    note: param.label,
  };
}

export default function MechanicCalcsEditor({
  mechanicKey, value, onChange, sample,
}: {
  mechanicKey: string;
  value: Record<string, AbilityCalc>;
  onChange: (next: Record<string, AbilityCalc>) => void;
  sample: CalcInputs;
}) {
  const template = getMechanicTemplate(mechanicKey);
  const errors = validateMechanicCalcs(mechanicKey, value);

  if (!template) {
    return (
      <p className="text-[11px] text-destructive flex items-center gap-1.5">
        <AlertTriangle className="w-3.5 h-3.5" /> Unknown mechanic “{mechanicKey}” — no template registered.
      </p>
    );
  }

  if (template.params.length === 0) {
    return (
      <p className="text-[11px] text-muted-foreground">
        <span className="font-mono">{mechanicKey}</span> exposes no extra tunables — everything it needs
        comes from the amount and duration calculations above.
      </p>
    );
  }

  const setParam = (key: string, calc: AbilityCalc | null) => {
    const next = { ...value };
    if (calc === null) delete next[key];
    else next[key] = calc;
    onChange(next);
  };

  const unknownKeys = Object.keys(value).filter(
    k => !template.params.some(p => p.key === k),
  );

  return (
    <div className="space-y-3">
      {template.requiresStackOp && (
        <p className="text-[10px] text-muted-foreground">
          Stack handling: <span className="font-mono">{template.requiresStackOp.op}</span> of{' '}
          <span className="font-mono">{template.requiresStackOp.stackType}</span> on{' '}
          <span className="font-mono">{template.requiresStackOp.timing}</span> — resolved server-side.
        </p>
      )}

      {template.params.map(param => {
        const calc = value[param.key] ?? null;
        return (
          <div key={param.key} className="rounded border border-border/50 p-2 space-y-2">
            <div className="flex items-center gap-2">
              <Badge variant="outline" className="text-[9px] font-mono">{param.key}</Badge>
              <span className="text-[11px] text-muted-foreground">{param.label}</span>
              <Badge variant="secondary" className="text-[9px] font-mono">{param.unit}</Badge>
              {param.required && (
                <Badge variant="outline" className="text-[9px] border-destructive/60 text-destructive">
                  required
                </Badge>
              )}
              {!calc && (
                <Button
                  size="sm" variant="outline" className="h-6 ml-auto text-[10px]"
                  onClick={() => setParam(param.key, seedFor(param))}
                >
                  <Plus className="w-3 h-3 mr-1" /> Configure
                </Button>
              )}
            </div>
            {calc && (
              <CalcBuilder
                title={param.label}
                value={calc}
                onChange={c => setParam(param.key, c)}
                sample={sample}
              />
            )}
          </div>
        );
      })}

      {unknownKeys.map(key => (
        <div key={key} className="rounded border border-destructive/50 p-2 flex items-center gap-2">
          <AlertTriangle className="w-3.5 h-3.5 text-destructive shrink-0" />
          <p className="text-[11px] text-destructive">
            <span className="font-mono">{key}</span> is not a parameter of{' '}
            <span className="font-mono">{mechanicKey}</span>.
          </p>
          <Button
            size="sm" variant="ghost" className="h-6 ml-auto text-[10px]"
            onClick={() => setParam(key, null)}
          >
            Remove
          </Button>
        </div>
      ))}

      {errors.length > 0 && (
        <div className="space-y-1">
          {errors.map(err => (
            <p key={err} className="text-[11px] text-destructive flex items-start gap-1.5">
              <AlertTriangle className="w-3.5 h-3.5 mt-px shrink-0" /> {err}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}
