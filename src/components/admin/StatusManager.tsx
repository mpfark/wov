/**
 * StatusManager — the admin editor for REUSABLE STATUSES (`applied_statuses`).
 *
 * Statuses are not abilities: Bleed, Poison, Ignite, Scorched and Chilled own
 * their own mechanics (per-tick magnitude, duration, stacking, tick rate,
 * amplification payload) and are *applied* by abilities via the Status
 * Application card in the Abilities editor. This surface is the one place those
 * mechanics can be seen and tuned.
 *
 * Ownership boundary this UI must never blur:
 *   - the status owns HOW MUCH / HOW LONG / HOW IT STACKS,
 *   - the ability owns WHICH status, WHEN it triggers and the chance.
 *
 * Two classifications, mutually exclusive fields (mirrored from the database
 * validation trigger `validate_applied_status`):
 *   - `dot`        periodic damage. Requires a magnitude, must NOT set modifier.
 *   - `damage_amp` damage amplification. Requires modifier
 *                  (kind `damage_taken_pct`, positive whole percent, non-empty
 *                  eligible sources), must NOT set magnitude or tick interval.
 *
 * Scaling roles (`primary` / `secondary`) are bound to concrete attributes by
 * the applying ability, so a status never names a stat directly.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { AlertTriangle, Loader2, Plus, Save } from 'lucide-react';
import type { AppliedStatusDef, ScalingRoleName } from '@/shared/config/compose-ability';
import type { AbilityCalc } from '@/shared/formulas/ability-calc';
import { DAMAGE_TYPES, DAMAGE_TYPE_NONE } from './damage-types';
import CalcBuilder from './ability/CalcBuilder';

/** Categories a `damage_amp` status may declare eligible. */
const ELIGIBLE_SOURCES = ['weapon', 'ability', 'stance', 'dot', 'proc'] as const;
const CLASSIFICATIONS = [
  { value: 'dot', label: 'Damage over time (periodic)' },
  { value: 'damage_amp', label: 'Damage amplification' },
] as const;
const ROLES: { value: ScalingRoleName | 'none'; label: string }[] = [
  { value: 'none', label: 'No attribute scaling' },
  { value: 'primary', label: 'Primary attribute of the applying ability' },
  { value: 'secondary', label: 'Secondary attribute of the applying ability' },
];

interface StatusRow extends AppliedStatusDef {
  key: string;
  label: string;
  effect_type: string;
  classification: string;
  stack_noun: string | null;
  tick_interval_ms: number | null;
  default_damage_type: string | null;
  admin_notes: string | null;
}

/** One ability that applies a status — the "used by" signal. */
interface UsageRow {
  ability_key: string;
  label: string;
  status: string;
  applied_status: string;
  status_application_enabled: boolean;
}

const BLANK: StatusRow = {
  key: '', label: '', effect_type: '', classification: 'dot', stack_noun: 'stack',
  tick_interval_ms: null, default_damage_type: null, admin_notes: null,
  magnitude: { role: 'primary', stat_mult: 1, global_mult: 1 },
  duration: { base_ms: 20000 },
  stacks: { max_stacks_calc: null },
  modifier: null,
};

const numOrNull = (v: string): number | null => {
  if (v.trim() === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

const keyify = (s: string) =>
  s.toLowerCase().trim().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');

/** Client mirror of the database validation so saves fail in the UI, not the DB. */
export function validateStatusDraft(d: StatusRow): string[] {
  const errs: string[] = [];
  if (!/^[a-z][a-z0-9_]*$/.test(d.key)) errs.push('Key must be lower_snake_case.');
  if (!d.label.trim()) errs.push('Label is required.');
  if (!d.effect_type.trim()) errs.push('Effect type is required.');

  if (d.classification === 'dot') {
    const mag = d.magnitude ?? {};
    const hasFlat = typeof mag.flat === 'number';
    const hasScaled = !!mag.role;
    if (!hasFlat && !hasScaled) {
      errs.push('A damage-over-time status needs either flat damage or an attribute role.');
    }
    if (hasFlat && hasScaled) {
      errs.push('Flat damage and attribute scaling are mutually exclusive.');
    }
    if (!d.duration?.base_ms || d.duration.base_ms <= 0) {
      errs.push('Base duration (ms) must be greater than zero.');
    }
  } else {
    const mod = d.modifier ?? {};
    if (!mod.value || mod.value <= 0 || mod.value !== Math.trunc(mod.value)) {
      errs.push('Amplification must be a positive whole percent.');
    }
    if (!mod.eligible_sources?.length) {
      errs.push('Pick at least one damage source the amplification applies to.');
    }
    if (d.tick_interval_ms !== null) {
      errs.push('Amplification statuses have no tick interval.');
    }
    const ticks = d.duration?.duration_ticks;
    if (!ticks || ticks <= 0) errs.push('Duration in combat ticks must be greater than zero.');
  }
  return errs;
}

/** Strip the fields the other classification must never carry. */
function toPayload(d: StatusRow) {
  const isDot = d.classification === 'dot';
  return {
    key: d.key,
    label: d.label.trim(),
    effect_type: d.effect_type.trim(),
    classification: d.classification,
    stack_noun: d.stack_noun?.trim() || 'stack',
    tick_interval_ms: isDot ? d.tick_interval_ms : null,
    default_damage_type: d.default_damage_type,
    admin_notes: d.admin_notes?.trim() || null,
    magnitude: (isDot ? (d.magnitude ?? {}) : {}) as never,
    duration: (d.duration ?? {}) as never,
    stacks: (d.stacks ?? {}) as never,
    modifier: (isDot ? null : (d.modifier ?? null)) as never,
  };
}

export default function StatusManager() {
  const [rows, setRows] = useState<StatusRow[]>([]);
  const [usage, setUsage] = useState<UsageRow[]>([]);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [draft, setDraft] = useState<StatusRow | null>(null);
  const [creating, setCreating] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const [{ data: statuses, error }, { data: abilities }] = await Promise.all([
      supabase.from('applied_statuses').select('*').order('label'),
      supabase.from('abilities')
        .select('ability_key, label, status, applied_status, status_application_enabled')
        .not('applied_status', 'is', null),
    ]);
    setLoading(false);
    if (error) { toast.error(error.message); return; }
    setRows((statuses ?? []) as unknown as StatusRow[]);
    setUsage((abilities ?? []) as unknown as UsageRow[]);
  }, []);

  useEffect(() => { void load(); }, [load]);

  const select = (row: StatusRow) => {
    setCreating(false);
    setSelectedKey(row.key);
    setDraft({ ...row });
  };

  const startCreate = () => {
    setCreating(true);
    setSelectedKey(null);
    setDraft({ ...BLANK });
  };

  const usageFor = useCallback(
    (key: string) => usage.filter(u => u.applied_status === key),
    [usage],
  );

  const draftErrors = useMemo(() => (draft ? validateStatusDraft(draft) : []), [draft]);
  const isDot = draft?.classification === 'dot';

  const save = async () => {
    if (!draft) return;
    if (draftErrors.length) { toast.error(draftErrors[0]); return; }
    setSaving(true);
    const payload = toPayload(draft);
    const { error } = creating
      ? await supabase.from('applied_statuses').insert(payload)
      : await supabase.from('applied_statuses').update(payload).eq('key', draft.key);
    setSaving(false);
    if (error) { toast.error(error.message); return; }
    toast.success(`${draft.label} saved.`);
    setCreating(false);
    setSelectedKey(draft.key);
    await load();
  };

  const patch = (p: Partial<StatusRow>) => setDraft(d => (d ? { ...d, ...p } : d));

  const sample = { level: 20, mods: { str: 4, dex: 4, con: 4, int: 4, wis: 4, cha: 4 } };

  return (
    <div className="flex h-full min-h-0" data-testid="status-manager">
      {/* Column 1 — the status library */}
      <div className="w-72 shrink-0 border-r border-border min-h-0 flex flex-col">
        <div className="p-3 border-b border-border/60 space-y-2">
          <p className="text-xs font-display">Reusable statuses</p>
          <p className="text-[10px] text-muted-foreground">
            Owned mechanics for Bleed, Poison, Ignite, Scorched and Chilled. Abilities
            choose which one they apply, and when, in the Abilities editor.
          </p>
          <Button size="sm" variant="outline" className="w-full h-7 text-[11px]" onClick={startCreate}>
            <Plus className="w-3 h-3 mr-1" /> New status
          </Button>
        </div>
        <ScrollArea className="flex-1 min-h-0">
          <div className="p-3 space-y-1">
            {loading && <p className="text-[11px] text-muted-foreground">Loading…</p>}
            {rows.map(row => {
              const used = usageFor(row.key);
              return (
                <button
                  key={row.key}
                  onClick={() => select(row)}
                  className={`w-full text-left px-2 py-1.5 rounded border text-xs transition-colors ${
                    selectedKey === row.key
                      ? 'border-primary bg-primary/10'
                      : 'border-border/60 hover:bg-muted/40'
                  }`}
                >
                  <span className="flex items-center gap-1.5">
                    {row.label}
                    <Badge variant="secondary" className="text-[9px]">
                      {row.classification === 'dot' ? 'DoT' : 'Amp'}
                    </Badge>
                  </span>
                  <span className="block text-[10px] font-mono text-muted-foreground">{row.key}</span>
                  <span className="block text-[10px] text-muted-foreground">
                    {used.length === 0
                      ? 'not applied by any ability'
                      : `applied by ${used.map(u => u.label).join(', ')}`}
                  </span>
                </button>
              );
            })}
          </div>
        </ScrollArea>
      </div>

      {/* Column 2 — editor */}
      <ScrollArea className="flex-1 min-h-0">
        {!draft && (
          <p className="p-6 text-xs text-muted-foreground">
            Pick a status to tune its damage, duration and stacking rules.
          </p>
        )}
        {draft && (
          <div className="p-4 space-y-3 max-w-4xl">
            <Card className="bg-card/80">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-display flex items-center gap-2">
                  {creating ? 'New status' : draft.label}
                  <Badge variant="outline" className="text-[9px] font-mono">{draft.key || 'key'}</Badge>
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                  <div className="space-y-1">
                    <Label className="text-[10px] uppercase text-muted-foreground">Label</Label>
                    <Input
                      aria-label="Status label"
                      className="h-8 text-xs"
                      value={draft.label}
                      onChange={e => patch({
                        label: e.target.value,
                        key: creating && !draft.key ? keyify(e.target.value) : draft.key,
                        effect_type: creating && !draft.effect_type
                          ? keyify(e.target.value) : draft.effect_type,
                      })}
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-[10px] uppercase text-muted-foreground">
                      Key {creating ? '(permanent)' : '(locked)'}
                    </Label>
                    <Input
                      aria-label="Status key"
                      className="h-8 text-xs font-mono"
                      disabled={!creating}
                      value={draft.key}
                      onChange={e => patch({ key: keyify(e.target.value) })}
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-[10px] uppercase text-muted-foreground">Effect type</Label>
                    <Input
                      aria-label="Effect type"
                      className="h-8 text-xs font-mono"
                      value={draft.effect_type}
                      onChange={e => patch({ effect_type: keyify(e.target.value) })}
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-[10px] uppercase text-muted-foreground">Stack noun</Label>
                    <Input
                      aria-label="Stack noun"
                      className="h-8 text-xs"
                      value={draft.stack_noun ?? ''}
                      onChange={e => patch({ stack_noun: e.target.value })}
                    />
                  </div>
                  <div className="space-y-1 md:col-span-2">
                    <Label className="text-[10px] uppercase text-muted-foreground">Classification</Label>
                    <Select
                      value={draft.classification}
                      onValueChange={v => patch({
                        classification: v,
                        // Keep the payload legal for the new classification.
                        magnitude: v === 'dot'
                          ? (draft.magnitude ?? { role: 'primary', stat_mult: 1, global_mult: 1 })
                          : {},
                        modifier: v === 'damage_amp'
                          ? (draft.modifier ?? {
                            kind: 'damage_taken_pct', value: 10,
                            eligible_sources: [...ELIGIBLE_SOURCES],
                          })
                          : null,
                        tick_interval_ms: v === 'dot' ? draft.tick_interval_ms : null,
                        duration: v === 'dot'
                          ? { base_ms: draft.duration?.base_ms ?? 20000 }
                          : { duration_ticks: draft.duration?.duration_ticks ?? 3 },
                      })}
                    >
                      <SelectTrigger className="h-8 text-xs" aria-label="Classification">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {CLASSIFICATIONS.map(c => (
                          <SelectItem key={c.value} value={c.value} className="text-xs">{c.label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1 md:col-span-2">
                    <Label className="text-[10px] uppercase text-muted-foreground">Damage type</Label>
                    <Select
                      value={draft.default_damage_type ?? DAMAGE_TYPE_NONE}
                      onValueChange={v => patch({
                        default_damage_type: v === DAMAGE_TYPE_NONE ? null : v,
                      })}
                    >
                      <SelectTrigger className="h-8 text-xs" aria-label="Default damage type">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value={DAMAGE_TYPE_NONE} className="text-xs">None</SelectItem>
                        {DAMAGE_TYPES.map(d => (
                          <SelectItem key={d.value} value={d.value} className="text-xs">{d.label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div className="space-y-1">
                  <Label className="text-[10px] uppercase text-muted-foreground">Admin notes</Label>
                  <Textarea
                    aria-label="Admin notes"
                    rows={2}
                    className="text-xs"
                    value={draft.admin_notes ?? ''}
                    onChange={e => patch({ admin_notes: e.target.value })}
                  />
                </div>
              </CardContent>
            </Card>

            {isDot && (
              <Card className="bg-card/80" data-testid="dot-card">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-display">Periodic damage</CardTitle>
                  <p className="text-[10px] text-muted-foreground">
                    Either a flat per-tick number (no attributes at all) or attribute-scaled
                    damage. The role is bound to a concrete attribute by whichever ability
                    applies this status.
                  </p>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                    <div className="space-y-1">
                      <Label className="text-[10px] uppercase text-muted-foreground">Flat per tick</Label>
                      <Input
                        type="number"
                        aria-label="Flat damage per tick"
                        placeholder="attribute-scaled"
                        className="h-8 text-xs"
                        value={draft.magnitude?.flat ?? ''}
                        onChange={e => {
                          const flat = numOrNull(e.target.value);
                          patch({
                            magnitude: flat === null
                              ? { role: 'primary', stat_mult: 1, global_mult: 1 }
                              : { flat },
                          });
                        }}
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-[10px] uppercase text-muted-foreground">Scaling role</Label>
                      <Select
                        value={draft.magnitude?.role ?? 'none'}
                        disabled={typeof draft.magnitude?.flat === 'number'}
                        onValueChange={v => patch({
                          magnitude: {
                            ...(draft.magnitude ?? {}),
                            flat: undefined,
                            role: v === 'none' ? null : (v as ScalingRoleName),
                          },
                        })}
                      >
                        <SelectTrigger className="h-8 text-xs" aria-label="Magnitude role">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {ROLES.map(r => (
                            <SelectItem key={r.value} value={r.value} className="text-xs">{r.label}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1">
                      <Label className="text-[10px] uppercase text-muted-foreground">Attribute mult</Label>
                      <Input
                        type="number" step="0.05"
                        aria-label="Stat multiplier"
                        className="h-8 text-xs"
                        disabled={typeof draft.magnitude?.flat === 'number'}
                        value={draft.magnitude?.stat_mult ?? ''}
                        onChange={e => patch({
                          magnitude: {
                            ...(draft.magnitude ?? {}),
                            stat_mult: numOrNull(e.target.value) ?? undefined,
                          },
                        })}
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-[10px] uppercase text-muted-foreground">Global mult</Label>
                      <Input
                        type="number" step="0.01"
                        aria-label="Global multiplier"
                        className="h-8 text-xs"
                        disabled={typeof draft.magnitude?.flat === 'number'}
                        value={draft.magnitude?.global_mult ?? ''}
                        onChange={e => patch({
                          magnitude: {
                            ...(draft.magnitude ?? {}),
                            global_mult: numOrNull(e.target.value) ?? undefined,
                          },
                        })}
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
                    <div className="space-y-1">
                      <Label className="text-[10px] uppercase text-muted-foreground">Base duration (ms)</Label>
                      <Input
                        type="number"
                        aria-label="Base duration ms"
                        className="h-8 text-xs"
                        value={draft.duration?.base_ms ?? ''}
                        onChange={e => patch({
                          duration: { ...(draft.duration ?? {}), base_ms: numOrNull(e.target.value) ?? undefined },
                        })}
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-[10px] uppercase text-muted-foreground">Duration role</Label>
                      <Select
                        value={draft.duration?.role ?? 'none'}
                        onValueChange={v => patch({
                          duration: {
                            ...(draft.duration ?? {}),
                            role: v === 'none' ? null : (v as ScalingRoleName),
                          },
                        })}
                      >
                        <SelectTrigger className="h-8 text-xs" aria-label="Duration role">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {ROLES.map(r => (
                            <SelectItem key={r.value} value={r.value} className="text-xs">{r.label}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1">
                      <Label className="text-[10px] uppercase text-muted-foreground">Per point (ms)</Label>
                      <Input
                        type="number"
                        aria-label="Duration per point ms"
                        className="h-8 text-xs"
                        disabled={!draft.duration?.role}
                        value={draft.duration?.per_point_ms ?? ''}
                        onChange={e => patch({
                          duration: {
                            ...(draft.duration ?? {}),
                            per_point_ms: numOrNull(e.target.value) ?? undefined,
                          },
                        })}
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-[10px] uppercase text-muted-foreground">Duration cap (ms)</Label>
                      <Input
                        type="number"
                        aria-label="Duration cap ms"
                        className="h-8 text-xs"
                        disabled={!draft.duration?.role}
                        value={draft.duration?.cap_ms ?? ''}
                        onChange={e => patch({
                          duration: {
                            ...(draft.duration ?? {}),
                            cap_ms: numOrNull(e.target.value) ?? undefined,
                          },
                        })}
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-[10px] uppercase text-muted-foreground">Tick interval (ms)</Label>
                      <Input
                        type="number"
                        aria-label="Tick interval ms"
                        placeholder="combat heartbeat"
                        className="h-8 text-xs"
                        value={draft.tick_interval_ms ?? ''}
                        onChange={e => patch({ tick_interval_ms: numOrNull(e.target.value) })}
                      />
                    </div>
                  </div>
                </CardContent>
              </Card>
            )}

            {!isDot && (
              <Card className="bg-card/80" data-testid="amp-card">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-display">Damage amplification</CardTitle>
                  <p className="text-[10px] text-muted-foreground">
                    Increases eligible incoming damage on the affected target. Duration is
                    authoritative in combat ticks, so the promise survives cadence changes.
                    Reflect, self and environment damage can never be amplified.
                  </p>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                    <div className="space-y-1">
                      <Label className="text-[10px] uppercase text-muted-foreground">Amplification %</Label>
                      <Input
                        type="number" min={1}
                        aria-label="Amplification percent"
                        className="h-8 text-xs"
                        value={draft.modifier?.value ?? ''}
                        onChange={e => patch({
                          modifier: {
                            kind: 'damage_taken_pct',
                            eligible_sources: draft.modifier?.eligible_sources ?? [...ELIGIBLE_SOURCES],
                            value: numOrNull(e.target.value) ?? undefined,
                          },
                        })}
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-[10px] uppercase text-muted-foreground">Duration (combat ticks)</Label>
                      <Input
                        type="number" min={1}
                        aria-label="Duration ticks"
                        className="h-8 text-xs"
                        value={draft.duration?.duration_ticks ?? ''}
                        onChange={e => patch({
                          duration: {
                            ...(draft.duration ?? {}),
                            duration_ticks: numOrNull(e.target.value) ?? undefined,
                          },
                        })}
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-[10px] uppercase text-muted-foreground">Modifier kind</Label>
                      <Input className="h-8 text-xs font-mono" value="damage_taken_pct" disabled />
                    </div>
                  </div>

                  <div className="space-y-1">
                    <Label className="text-[10px] uppercase text-muted-foreground">Eligible damage sources</Label>
                    <div className="flex flex-wrap gap-3 pt-1">
                      {ELIGIBLE_SOURCES.map(src => {
                        const list = draft.modifier?.eligible_sources ?? [];
                        return (
                          <label key={src} className="flex items-center gap-1.5 text-[11px] capitalize">
                            <Checkbox
                              aria-label={`Amplify ${src} damage`}
                              checked={list.includes(src)}
                              onCheckedChange={c => patch({
                                modifier: {
                                  kind: 'damage_taken_pct',
                                  value: draft.modifier?.value,
                                  eligible_sources: c
                                    ? Array.from(new Set([...list, src]))
                                    : list.filter(s => s !== src),
                                },
                              })}
                            />
                            {src}
                          </label>
                        );
                      })}
                    </div>
                  </div>
                </CardContent>
              </Card>
            )}

            <Card className="bg-card/80">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-display">Stacking</CardTitle>
                <p className="text-[10px] text-muted-foreground">
                  Maximum simultaneous {draft.stack_noun || 'stack'} count. Leave the formula
                  unset for a single, non-stacking application.
                </p>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-1">
                    <Label className="text-[10px] uppercase text-muted-foreground">Stacking role</Label>
                    <Select
                      value={draft.stacks?.role ?? 'none'}
                      onValueChange={v => patch({
                        stacks: {
                          ...(draft.stacks ?? {}),
                          role: v === 'none' ? null : (v as ScalingRoleName),
                        },
                      })}
                    >
                      <SelectTrigger className="h-8 text-xs" aria-label="Stacking role">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {ROLES.map(r => (
                          <SelectItem key={r.value} value={r.value} className="text-xs">{r.label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <CalcBuilder
                  title="Max stacks"
                  value={(draft.stacks?.max_stacks_calc ?? null) as AbilityCalc | null}
                  onChange={calc => patch({
                    stacks: { ...(draft.stacks ?? {}), max_stacks_calc: calc },
                  })}
                  sample={sample}
                  hint="Attribute terms use the stacking role above, bound by the applying ability."
                />
              </CardContent>
            </Card>

            <Card className="bg-card/80">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-display">Applied by</CardTitle>
              </CardHeader>
              <CardContent className="space-y-1">
                {usageFor(draft.key).length === 0 && (
                  <p className="text-[11px] text-muted-foreground">
                    No ability applies this status yet. Wire it up in the Abilities editor,
                    under Status application.
                  </p>
                )}
                {usageFor(draft.key).map(u => (
                  <p key={u.ability_key} className="text-[11px] flex items-center gap-1.5">
                    {u.label}
                    <Badge variant="outline" className="text-[9px] font-mono">{u.ability_key}</Badge>
                    <Badge variant="secondary" className="text-[9px] capitalize">{u.status}</Badge>
                    {!u.status_application_enabled && (
                      <span className="text-muted-foreground">application disabled</span>
                    )}
                  </p>
                ))}
              </CardContent>
            </Card>

            {draftErrors.length > 0 && (
              <ul className="text-[10px] text-destructive space-y-0.5">
                {draftErrors.map(e => (
                  <li key={e} className="flex items-start gap-1.5">
                    <AlertTriangle className="w-3 h-3 mt-px shrink-0" /> {e}
                  </li>
                ))}
              </ul>
            )}

            <div className="flex gap-2 pb-6">
              <Button size="sm" onClick={save} disabled={saving || draftErrors.length > 0}>
                {saving
                  ? <Loader2 className="w-3 h-3 mr-1 animate-spin" />
                  : <Save className="w-3 h-3 mr-1" />}
                {creating ? 'Create status' : 'Save status'}
              </Button>
              <Button
                size="sm" variant="outline"
                onClick={() => { setDraft(null); setCreating(false); setSelectedKey(null); }}
              >
                Cancel
              </Button>
            </div>
          </div>
        )}
      </ScrollArea>
    </div>
  );
}
