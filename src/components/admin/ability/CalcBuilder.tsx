/**
 * CalcBuilder — checkpoint 6: the no-code visual editor for one `AbilityCalc`.
 *
 * Every field of the canonical contract is a control: base, term rows (with a
 * dice picker, stat/transform pickers, threshold ladders and a context
 * selector), the constant `finalMult` rider, an optional nested
 * `multiplierCalc`, rounding at both stages, floor, cap, unit and note.
 *
 * The generated formula line, the min/avg/max spread and the level × stat-mod
 * table are rendered from the SAME shared evaluator the server uses, so the
 * preview is authoritative. JSON is a collapsed read-only diagnostic — it is
 * never the editing surface.
 */
import { useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  Collapsible, CollapsibleContent, CollapsibleTrigger,
} from '@/components/ui/collapsible';
import { AlertTriangle, ChevronRight, Plus, Trash2 } from 'lucide-react';
import {
  describeCalc, evaluateCalc, validateCalc, calcUsesDice,
  type AbilityCalc, type CalcInputs, type CalcRounding, type CalcStat,
  type CalcTerm, type CalcUnit, type CalcTransform, type CalcDie,
  type CalcContextKey,
} from '@/shared/formulas/ability-calc';

const STATS: CalcStat[] = ['str', 'dex', 'con', 'int', 'wis', 'cha'];
const SOURCES: CalcTerm['source'][] = ['const', 'stat', 'level', 'stat_threshold', 'dice', 'context'];
const ROUNDINGS: CalcRounding[] = ['none', 'floor', 'round', 'ceil'];
const UNITS: CalcUnit[] = ['hp', 'ms', 'flat', 'count', 'percent', 'multiplier'];
const DICE: CalcDie[] = ['weapon_main', 'd4', 'd6', 'd8', 'd10', 'd12'];
const CONTEXT_KEYS: CalcContextKey[] = ['active_stacks', 'consumed_stacks'];
const PROFILES = ['damage', 'burst', 'dot', 'utility', 'stacking', 'healing'] as const;

const TRANSFORM_KINDS = ['none', 'soft', 'diminishing', 'diminishing_float'] as const;
type TransformKind = typeof TRANSFORM_KINDS[number];

export const EMPTY_CALC: AbilityCalc = {
  version: 2, base: 0, terms: [], rounding: 'none', floor: null, cap: null, unit: 'hp',
};

function numOrNull(v: string): number | null {
  if (v.trim() === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function defaultTerm(source: CalcTerm['source']): CalcTerm {
  switch (source) {
    case 'stat': return { source: 'stat', stat: 'str', mult: 1, clampAtZero: true };
    case 'level': return { source: 'level', mult: 1, rounding: 'floor' };
    case 'stat_threshold': return { source: 'stat_threshold', stat: 'dex', steps: [{ at: 3, add: 1 }] };
    case 'dice': return { source: 'dice', die: 'weapon_main', fallbackDie: 4, count: 1 };
    case 'context': return { source: 'context', contextKey: 'consumed_stacks', mult: 1 };
    default: return { source: 'const', mult: 1 };
  }
}

function transformKind(t: CalcTransform | undefined): TransformKind {
  return t ? t.kind as TransformKind : 'none';
}

// ── Term row ──────────────────────────────────────────────────────

function TermRow({
  term, index, onChange, onRemove,
}: {
  term: CalcTerm;
  index: number;
  onChange: (t: CalcTerm) => void;
  onRemove: () => void;
}) {
  const set = (patch: Partial<CalcTerm>) => onChange({ ...term, ...patch });
  const kind = transformKind(term.transform);

  const setTransform = (k: TransformKind) => {
    if (k === 'none') { const { transform, ...rest } = term; onChange(rest as CalcTerm); return; }
    if (k === 'soft') { set({ transform: { kind: 'soft', profile: 'damage' } }); return; }
    if (k === 'diminishing') { set({ transform: { kind: 'diminishing', cap: 4 } }); return; }
    set({ transform: { kind: 'diminishing_float', perPoint: 0.02, cap: 0.12 } });
  };

  return (
    <div className="rounded border border-border/60 bg-muted/20 p-2 space-y-2">
      <div className="flex items-center gap-2">
        <Badge variant="outline" className="text-[9px] font-mono shrink-0">#{index + 1}</Badge>
        <Select value={term.source} onValueChange={v => onChange(defaultTerm(v as CalcTerm['source']))}>
          <SelectTrigger className="h-7 w-36 text-[11px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            {SOURCES.map(s => (
              <SelectItem key={s} value={s} className="text-[11px] font-mono">{s}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        {(term.source === 'stat' || term.source === 'stat_threshold') && (
          <Select value={term.stat ?? 'str'} onValueChange={v => set({ stat: v as CalcStat })}>
            <SelectTrigger className="h-7 w-20 text-[11px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              {STATS.map(s => (
                <SelectItem key={s} value={s} className="text-[11px] uppercase">{s}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}

        {term.source === 'context' && (
          <Select value={term.contextKey ?? 'consumed_stacks'} onValueChange={v => set({ contextKey: v as CalcContextKey })}>
            <SelectTrigger className="h-7 w-40 text-[11px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              {CONTEXT_KEYS.map(k => (
                <SelectItem key={k} value={k} className="text-[11px] font-mono">{k}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}

        {term.source !== 'stat_threshold' && (
          <div className="flex items-center gap-1">
            <Label className="text-[10px] text-muted-foreground">×</Label>
            <Input
              value={term.mult ?? 1}
              onChange={e => set({ mult: Number(e.target.value) })}
              type="number" step="any"
              className="h-7 w-20 text-[11px]"
            />
          </div>
        )}

        <Select value={term.rounding ?? 'none'} onValueChange={v => set({ rounding: v as CalcRounding })}>
          <SelectTrigger className="h-7 w-24 text-[11px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            {ROUNDINGS.map(r => (
              <SelectItem key={r} value={r} className="text-[11px] font-mono">{r}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Button size="icon" variant="ghost" className="h-7 w-7 ml-auto shrink-0" onClick={onRemove}>
          <Trash2 className="w-3.5 h-3.5 text-destructive" />
        </Button>
      </div>

      {/* Dice picker */}
      {term.source === 'dice' && (
        <div className="flex items-center gap-2 pl-1">
          <div className="flex items-center gap-1">
            <Label className="text-[10px] text-muted-foreground">count</Label>
            <Input
              type="number" min={1} max={20} value={term.count ?? 1}
              onChange={e => set({ count: Number(e.target.value) })}
              className="h-7 w-16 text-[11px]"
            />
          </div>
          <Select value={term.die ?? 'weapon_main'} onValueChange={v => set({ die: v as CalcDie })}>
            <SelectTrigger className="h-7 w-36 text-[11px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              {DICE.map(d => (
                <SelectItem key={d} value={d} className="text-[11px] font-mono">{d}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          {(term.die ?? 'weapon_main') === 'weapon_main' && (
            <div className="flex items-center gap-1">
              <Label className="text-[10px] text-muted-foreground">unarmed die</Label>
              <Input
                type="number" min={1} value={term.fallbackDie ?? 4}
                onChange={e => set({ fallbackDie: Number(e.target.value) })}
                className="h-7 w-16 text-[11px]"
              />
            </div>
          )}
        </div>
      )}

      {/* Stat shaping */}
      {term.source === 'stat' && (
        <div className="flex flex-wrap items-center gap-2 pl-1">
          <Select value={kind} onValueChange={v => setTransform(v as TransformKind)}>
            <SelectTrigger className="h-7 w-40 text-[11px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              {TRANSFORM_KINDS.map(k => (
                <SelectItem key={k} value={k} className="text-[11px] font-mono">{k}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          {term.transform?.kind === 'soft' && (
            <Select
              value={term.transform.profile}
              onValueChange={v => set({ transform: { kind: 'soft', profile: v as CalcTransform extends { profile: infer P } ? P : never } as CalcTransform })}
            >
              <SelectTrigger className="h-7 w-32 text-[11px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                {PROFILES.map(p => (
                  <SelectItem key={p} value={p} className="text-[11px] font-mono">{p}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          {term.transform?.kind === 'diminishing_float' && (
            <div className="flex items-center gap-1">
              <Label className="text-[10px] text-muted-foreground">per pt</Label>
              <Input
                type="number" step="any" value={term.transform.perPoint}
                onChange={e => set({ transform: { kind: 'diminishing_float', perPoint: Number(e.target.value), cap: (term.transform as any).cap } })}
                className="h-7 w-20 text-[11px]"
              />
            </div>
          )}
          {(term.transform?.kind === 'diminishing' || term.transform?.kind === 'diminishing_float') && (
            <div className="flex items-center gap-1">
              <Label className="text-[10px] text-muted-foreground">cap</Label>
              <Input
                type="number" step="any" value={(term.transform as any).cap}
                onChange={e => set({
                  transform: term.transform!.kind === 'diminishing'
                    ? { kind: 'diminishing', cap: Number(e.target.value) }
                    : { kind: 'diminishing_float', perPoint: (term.transform as any).perPoint, cap: Number(e.target.value) },
                })}
                className="h-7 w-20 text-[11px]"
              />
            </div>
          )}
          <label className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
            <Checkbox
              checked={!!term.clampAtZero}
              onCheckedChange={v => set({ clampAtZero: !!v })}
            />
            clamp negatives to 0
          </label>
        </div>
      )}

      {/* Threshold ladder */}
      {term.source === 'stat_threshold' && (
        <div className="space-y-1 pl-1">
          {(term.steps ?? []).map((step, i) => (
            <div key={i} className="flex items-center gap-2">
              <Label className="text-[10px] text-muted-foreground">at ≥</Label>
              <Input
                type="number" value={step.at}
                onChange={e => set({
                  steps: (term.steps ?? []).map((s, j) => j === i ? { ...s, at: Number(e.target.value) } : s),
                })}
                className="h-7 w-16 text-[11px]"
              />
              <Label className="text-[10px] text-muted-foreground">add</Label>
              <Input
                type="number" step="any" value={step.add}
                onChange={e => set({
                  steps: (term.steps ?? []).map((s, j) => j === i ? { ...s, add: Number(e.target.value) } : s),
                })}
                className="h-7 w-16 text-[11px]"
              />
              <Button
                size="icon" variant="ghost" className="h-7 w-7"
                onClick={() => set({ steps: (term.steps ?? []).filter((_, j) => j !== i) })}
              >
                <Trash2 className="w-3 h-3 text-destructive" />
              </Button>
            </div>
          ))}
          <Button
            size="sm" variant="ghost" className="h-6 text-[10px]"
            onClick={() => set({ steps: [...(term.steps ?? []), { at: 0, add: 1 }] })}
          >
            <Plus className="w-3 h-3 mr-1" /> step
          </Button>
        </div>
      )}
    </div>
  );
}

// ── Preview strip ─────────────────────────────────────────────────

const PREVIEW_LEVELS = [1, 10, 20, 30, 42];
const PREVIEW_MODS = [0, 2, 4, 6, 8];

function CalcPreview({ calc, sample }: { calc: AbilityCalc; sample: CalcInputs }) {
  const rolls = calcUsesDice(calc);
  const spread = useMemo(() => ({
    min: evaluateCalc(calc, { ...sample, diceMode: 'min' }),
    avg: evaluateCalc(calc, { ...sample, diceMode: 'average' }),
    max: evaluateCalc(calc, { ...sample, diceMode: 'max' }),
  }), [calc, sample]);

  return (
    <div className="space-y-2">
      <p className="text-[11px] font-mono text-muted-foreground break-words">{describeCalc(calc)}</p>
      <div className="flex items-center gap-3 text-[11px]">
        {rolls ? (
          <>
            <span className="text-muted-foreground">min <span className="font-mono text-foreground">{spread.min}</span></span>
            <span className="text-muted-foreground">avg <span className="font-mono text-primary">{round2(spread.avg)}</span></span>
            <span className="text-muted-foreground">max <span className="font-mono text-foreground">{spread.max}</span></span>
          </>
        ) : (
          <span className="text-muted-foreground">
            at preview inputs <span className="font-mono text-primary">{round2(spread.avg)}</span>
          </span>
        )}
      </div>

      <table className="text-[10px] font-mono w-full max-w-md">
        <thead>
          <tr className="text-muted-foreground">
            <th className="text-left font-normal">lvl \ mod</th>
            {PREVIEW_MODS.map(m => <th key={m} className="text-right font-normal px-1">+{m}</th>)}
          </tr>
        </thead>
        <tbody>
          {PREVIEW_LEVELS.map(level => (
            <tr key={level}>
              <td className="text-muted-foreground">{level}</td>
              {PREVIEW_MODS.map(mod => (
                <td key={mod} className="text-right px-1">
                  {round2(evaluateCalc(calc, {
                    ...sample,
                    level,
                    mods: { str: mod, dex: mod, con: mod, int: mod, wis: mod, cha: mod },
                    diceMode: 'average',
                    roll: undefined,
                  }))}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

// ── Builder ───────────────────────────────────────────────────────

export default function CalcBuilder({
  title, value, onChange, sample, allowNull = true, depth = 0, hint,
}: {
  title: string;
  value: AbilityCalc | null;
  onChange: (calc: AbilityCalc | null) => void;
  sample: CalcInputs;
  /** Mechanic-owned values may be left unconfigured. */
  allowNull?: boolean;
  depth?: number;
  hint?: string;
}) {
  const [showJson, setShowJson] = useState(false);
  const errors = value ? validateCalc(value) : [];
  const set = (patch: Partial<AbilityCalc>) => onChange({ ...(value ?? EMPTY_CALC), ...patch });

  if (!value) {
    return (
      <div className="space-y-1">
        <Label className="text-[11px] uppercase tracking-wider text-muted-foreground">{title}</Label>
        <div className="rounded border border-dashed border-border/60 p-3 flex items-center justify-between gap-3">
          <p className="text-[11px] text-muted-foreground">
            Not configured — the coded mechanic supplies this value.
          </p>
          <Button size="sm" variant="outline" className="h-7 text-[11px]" onClick={() => onChange({ ...EMPTY_CALC })}>
            <Plus className="w-3 h-3 mr-1" /> Configure
          </Button>
        </div>
        {hint && <p className="text-[10px] text-muted-foreground">{hint}</p>}
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <Label className="text-[11px] uppercase tracking-wider text-muted-foreground">{title}</Label>
        <Badge variant="outline" className="text-[9px] font-mono">v{value.version ?? 1}</Badge>
        {allowNull && (
          <Button
            size="sm" variant="ghost" className="h-6 ml-auto text-[10px] text-muted-foreground"
            onClick={() => onChange(null)}
          >
            Clear
          </Button>
        )}
      </div>

      {/* Header numbers */}
      <div className="grid grid-cols-6 gap-2">
        <div className="space-y-1">
          <Label className="text-[10px] text-muted-foreground">base</Label>
          <Input
            type="number" step="any" value={value.base}
            onChange={e => set({ base: Number(e.target.value) })}
            className="h-7 text-[11px]"
          />
        </div>
        <div className="space-y-1">
          <Label className="text-[10px] text-muted-foreground">final ×</Label>
          <Input
            type="number" step="any" value={value.finalMult ?? value.postMult ?? ''}
            placeholder="1"
            onChange={e => {
              const n = numOrNull(e.target.value);
              const { postMult, finalMult, ...rest } = value;
              onChange(n === null ? { ...rest } as AbilityCalc : { ...rest, finalMult: n } as AbilityCalc);
            }}
            className="h-7 text-[11px]"
          />
        </div>
        <div className="space-y-1">
          <Label className="text-[10px] text-muted-foreground">rounding</Label>
          <Select value={value.rounding ?? 'none'} onValueChange={v => set({ rounding: v as CalcRounding })}>
            <SelectTrigger className="h-7 text-[11px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              {ROUNDINGS.map(r => <SelectItem key={r} value={r} className="text-[11px] font-mono">{r}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label className="text-[10px] text-muted-foreground">floor</Label>
          <Input
            type="number" step="any" value={value.floor ?? ''} placeholder="—"
            onChange={e => set({ floor: numOrNull(e.target.value) })}
            className="h-7 text-[11px]"
          />
        </div>
        <div className="space-y-1">
          <Label className="text-[10px] text-muted-foreground">cap</Label>
          <Input
            type="number" step="any" value={value.cap ?? ''} placeholder="—"
            onChange={e => set({ cap: numOrNull(e.target.value) })}
            className="h-7 text-[11px]"
          />
        </div>
        <div className="space-y-1">
          <Label className="text-[10px] text-muted-foreground">unit</Label>
          <Select value={value.unit} onValueChange={v => set({ unit: v as CalcUnit })}>
            <SelectTrigger className="h-7 text-[11px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              {UNITS.map(u => <SelectItem key={u} value={u} className="text-[11px] font-mono">{u}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Terms */}
      <div className="space-y-1.5">
        {value.terms.map((term, i) => (
          <TermRow
            key={i}
            term={term}
            index={i}
            onChange={t => set({ terms: value.terms.map((x, j) => j === i ? t : x) })}
            onRemove={() => set({ terms: value.terms.filter((_, j) => j !== i) })}
          />
        ))}
        <div className="flex flex-wrap gap-1">
          {SOURCES.map(s => (
            <Button
              key={s} size="sm" variant="outline" className="h-6 text-[10px] font-mono"
              disabled={value.terms.length >= 12}
              onClick={() => set({ terms: [...value.terms, defaultTerm(s)] })}
            >
              <Plus className="w-3 h-3 mr-0.5" />{s}
            </Button>
          ))}
        </div>
      </div>

      {/* Nested multiplier */}
      {depth < 1 && (
        <div className="rounded border border-border/50 p-2 space-y-2">
          <div className="flex items-center gap-2">
            <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">
              Calculated multiplier
            </Label>
            {value.multiplierCalc ? (
              <Button
                size="sm" variant="ghost" className="h-6 ml-auto text-[10px]"
                onClick={() => { const { multiplierCalc, ...rest } = value; onChange(rest as AbilityCalc); }}
              >
                Remove
              </Button>
            ) : (
              <Button
                size="sm" variant="outline" className="h-6 ml-auto text-[10px]"
                onClick={() => set({ multiplierCalc: { ...EMPTY_CALC, base: 1, unit: 'multiplier' } })}
              >
                <Plus className="w-3 h-3 mr-1" /> Add
              </Button>
            )}
          </div>
          {value.multiplierCalc && (
            <>
              <CalcBuilder
                title="multiplier"
                value={value.multiplierCalc}
                onChange={c => set({ multiplierCalc: c ?? undefined })}
                sample={sample}
                allowNull={false}
                depth={depth + 1}
              />
              <div className="flex items-center gap-2">
                <Label className="text-[10px] text-muted-foreground">rounding after multiply</Label>
                <Select value={value.multRounding ?? 'none'} onValueChange={v => set({ multRounding: v as CalcRounding })}>
                  <SelectTrigger className="h-7 w-28 text-[11px]"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {ROUNDINGS.map(r => <SelectItem key={r} value={r} className="text-[11px] font-mono">{r}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </>
          )}
        </div>
      )}

      {/* Note */}
      <div className="space-y-1">
        <Label className="text-[10px] text-muted-foreground">note (admin intent)</Label>
        <Input
          value={value.note ?? ''}
          onChange={e => set({ note: e.target.value || undefined })}
          className="h-7 text-[11px]"
        />
      </div>

      {/* Validation + preview */}
      {errors.length > 0 ? (
        <div className="space-y-1">
          {errors.map(err => (
            <p key={err} className="text-[11px] text-destructive flex items-start gap-1.5">
              <AlertTriangle className="w-3.5 h-3.5 mt-px shrink-0" /> {err}
            </p>
          ))}
        </div>
      ) : (
        <CalcPreview calc={value} sample={sample} />
      )}

      {/* Read-only JSON diagnostic */}
      <Collapsible open={showJson} onOpenChange={setShowJson}>
        <CollapsibleTrigger asChild>
          <Button size="sm" variant="ghost" className="h-6 text-[10px] text-muted-foreground">
            <ChevronRight className={`w-3 h-3 mr-1 transition-transform ${showJson ? 'rotate-90' : ''}`} />
            JSON (read-only)
          </Button>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <pre className="text-[10px] font-mono bg-muted/30 rounded p-2 overflow-x-auto">
            {JSON.stringify(value, null, 2)}
          </pre>
        </CollapsibleContent>
      </Collapsible>

      {hint && <p className="text-[10px] text-muted-foreground">{hint}</p>}
    </div>
  );
}
