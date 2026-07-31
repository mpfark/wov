/**
 * AbilityConfigManager — admin editor for the configurable class ability system
 * (Phase 2c). Edits the `abilities` rows and their class assignment:
 * presentation (label/emoji/text), cost, unlock level and the structured
 * magnitude calcs (`amount_calc` / `duration_calc` / `interval_ms`).
 *
 * Calcs are edited as JSON with live validation (`validateCalc`), a readable
 * formula preview (`describeCalc`) and a sample evaluation at a chosen
 * level / stat modifier so balance changes can be sanity-checked before saving.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Loader2, Plus, Save } from 'lucide-react';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import AbilityAuthorDialog from './AbilityAuthorDialog';
import {
  describeCalc, evaluateCalc, validateCalc, type AbilityCalc, type CalcInputs,
} from '@/shared/formulas/ability-calc';
import { CLASS_LABELS } from '@/lib/game-data';

interface Row {
  assignment_id: string;
  class_key: string;
  unlock_level: number;
  slot: number;
  role_name: string;
  ability_id: string;
  role_id: string;
  ability_key: string;
  label: string;
  emoji: string;
  description: string;
  tooltip: string;
  cp_cost: number;
  mechanic_key: string;
  ability_status: string;
  assignment_status: string;
  /** False for player-selectable alternatives on the same role. */
  is_default: boolean;
  interval_ms: number | null;
  amount_calc: AbilityCalc | null;
  duration_calc: AbilityCalc | null;
}

interface RoleRow { id: string; class_key: string; slot: number; name: string; unlock_level: number }

const ABILITY_STATUSES = ['draft', 'active', 'retired'] as const;

function parseCalc(text: string): { calc: AbilityCalc | null; errors: string[] } {
  const trimmed = text.trim();
  if (!trimmed || trimmed === 'null') return { calc: null, errors: [] };
  try {
    const parsed = JSON.parse(trimmed) as AbilityCalc;
    return { calc: parsed, errors: validateCalc(parsed) };
  } catch (e) {
    return { calc: null, errors: [`invalid JSON: ${(e as Error).message}`] };
  }
}

function CalcField({
  title, value, onChange, sample,
}: {
  title: string;
  value: string;
  onChange: (v: string) => void;
  sample: CalcInputs;
}) {
  const { calc, errors } = parseCalc(value);
  return (
    <div className="space-y-1">
      <Label className="text-[11px] uppercase tracking-wider text-muted-foreground">{title}</Label>
      <Textarea
        value={value}
        onChange={e => onChange(e.target.value)}
        rows={5}
        spellCheck={false}
        className="font-mono text-[11px]"
        placeholder="null"
      />
      {errors.length > 0 ? (
        <p className="text-[11px] text-destructive">{errors.join(' · ')}</p>
      ) : calc ? (
        <p className="text-[11px] text-muted-foreground">
          <span className="font-mono">{describeCalc(calc)}</span>
          {' → '}
          <span className="text-primary font-mono">{evaluateCalc(calc, sample)}</span>
        </p>
      ) : (
        <p className="text-[11px] text-muted-foreground">Not configured — mechanic-owned value.</p>
      )}
    </div>
  );
}

export default function AbilityConfigManager() {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Row | null>(null);
  const [amountText, setAmountText] = useState('null');
  const [durationText, setDurationText] = useState('null');
  const [sampleLevel, setSampleLevel] = useState(20);
  const [sampleMod, setSampleMod] = useState(4);
  const [roles, setRoles] = useState<RoleRow[]>([]);
  const [authorRole, setAuthorRole] = useState<RoleRow | null>(null);
  const [authorAsAlternative, setAuthorAsAlternative] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const rolesRes = await supabase
      .from('class_ability_roles')
      .select('id, class_key, slot, name, unlock_level');
    setRoles((rolesRes.data as RoleRow[]) ?? []);
    const { data, error } = await supabase
      .from('class_ability_assignments')
      .select(`
        id, class_key, unlock_level, is_default, status,
        role:class_ability_roles ( id, slot, name ),
        ability:abilities (
          id, ability_key, label, emoji, description, tooltip, cp_cost,
          mechanic_key, status, interval_ms, amount_calc, duration_calc
        )
      `);
    setLoading(false);
    if (error) { toast.error(error.message); return; }
    const mapped: Row[] = (data ?? [])
      // Alternatives (is_default = false) are kept: they are the player-selectable
      // loadout options for the same role.
      .filter((r: any) => r.ability && r.role)
      .map((r: any) => ({
        assignment_id: r.id,
        class_key: r.class_key,
        unlock_level: r.unlock_level,
        slot: r.role.slot,
        role_name: r.role.name,
        ability_id: r.ability.id,
        ability_key: r.ability.ability_key,
        label: r.ability.label,
        emoji: r.ability.emoji,
        description: r.ability.description,
        tooltip: r.ability.tooltip,
        cp_cost: r.ability.cp_cost,
        mechanic_key: r.ability.mechanic_key,
        ability_status: r.ability.status ?? 'active',
        assignment_status: r.status ?? 'active',
        is_default: !!r.is_default,
        role_id: r.role.id,
        interval_ms: r.ability.interval_ms,
        amount_calc: r.ability.amount_calc,
        duration_calc: r.ability.duration_calc,
      }))
      .sort((a, b) =>
        a.class_key.localeCompare(b.class_key)
        || a.slot - b.slot
        || Number(b.is_default) - Number(a.is_default)
        || a.label.localeCompare(b.label));
    setRows(mapped);
  }, []);

  useEffect(() => { load(); }, [load]);

  const select = (row: Row) => {
    setSelectedId(row.assignment_id);
    setDraft({ ...row });
    setAmountText(row.amount_calc ? JSON.stringify(row.amount_calc, null, 2) : 'null');
    setDurationText(row.duration_calc ? JSON.stringify(row.duration_calc, null, 2) : 'null');
  };

  const sample: CalcInputs = useMemo(() => ({
    level: sampleLevel,
    mods: {
      str: sampleMod, dex: sampleMod, con: sampleMod,
      int: sampleMod, wis: sampleMod, cha: sampleMod,
    },
  }), [sampleLevel, sampleMod]);

  const byClass = useMemo(() => {
    const map = new Map<string, Row[]>();
    for (const r of rows) map.set(r.class_key, [...(map.get(r.class_key) ?? []), r]);
    return [...map.entries()];
  }, [rows]);

  const save = async () => {
    if (!draft) return;
    const amount = parseCalc(amountText);
    const duration = parseCalc(durationText);
    const errors = [...amount.errors, ...duration.errors];
    if (errors.length) { toast.error(errors.join(' · ')); return; }

    setSaving(true);
    const { error: abilityError } = await supabase.from('abilities').update({
      label: draft.label,
      emoji: draft.emoji,
      description: draft.description,
      tooltip: draft.tooltip,
      cp_cost: draft.cp_cost,
      interval_ms: draft.interval_ms,
      amount_calc: amount.calc as any,
      duration_calc: duration.calc as any,
      status: draft.ability_status,
    }).eq('id', draft.ability_id);

    const { error: assignmentError } = await supabase
      .from('class_ability_assignments')
      .update({ unlock_level: draft.unlock_level, status: draft.assignment_status })
      .eq('id', draft.assignment_id);
    setSaving(false);

    const err = abilityError || assignmentError;
    if (err) { toast.error(err.message); return; }
    toast.success(`${draft.label} saved — players pick it up on next reload.`);
    await load();
  };

  return (
    <div className="h-full flex overflow-hidden">
      {authorRole && (
        <AbilityAuthorDialog
          open={!!authorRole}
          onOpenChange={v => { if (!v) { setAuthorRole(null); setAuthorAsAlternative(false); } }}
          classKey={authorRole.class_key}
          classLabel={CLASS_LABELS[authorRole.class_key] ?? authorRole.class_key}
          roleId={authorRole.id}
          roleName={authorRole.name}
          roleUnlockLevel={authorRole.unlock_level}
          asAlternative={authorAsAlternative}
          onCreated={load}
        />
      )}
      {/* Ability list */}
      <div className="w-72 shrink-0 border-r border-border min-h-0">
        <ScrollArea className="h-full">
          <div className="p-3 space-y-4">
            {loading && (
              <p className="text-xs text-muted-foreground flex items-center gap-2">
                <Loader2 className="w-3 h-3 animate-spin" /> Loading abilities…
              </p>
            )}
            {byClass.map(([classKey, list]) => (
              <div key={classKey}>
                <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">
                  {CLASS_LABELS[classKey] ?? classKey}
                </p>
                <div className="space-y-1">
                  {list.map(row => (
                    <button
                      key={row.assignment_id}
                      onClick={() => select(row)}
                      className={`w-full text-left px-2 py-1.5 rounded border text-xs transition-colors ${
                        selectedId === row.assignment_id
                          ? 'border-primary bg-primary/10'
                          : 'border-border/60 hover:bg-muted/40'
                      }`}
                    >
                      <span className="mr-1">{row.emoji}</span>
                      {row.label}
                      <Badge variant="outline" className="ml-2 text-[9px]">L{row.unlock_level}</Badge>
                      {!row.is_default && (
                        <Badge variant="outline" className="ml-1 text-[9px] border-primary/50 text-primary">alt</Badge>
                      )}
                      {(row.ability_status !== 'active' || row.assignment_status !== 'active') && (
                        <Badge variant="secondary" className="ml-1 text-[9px] capitalize">
                          {row.ability_status !== 'active' ? row.ability_status : row.assignment_status}
                        </Badge>
                      )}
                      <span className="ml-1 text-[10px] text-muted-foreground">{row.cp_cost} CP</span>
                    </button>
                  ))}
                  {roles
                    .filter(r => r.class_key === classKey && list.some(a => a.role_id === r.id && a.is_default))
                    .sort((a, b) => a.slot - b.slot)
                    .map(role => (
                      <Button
                        key={`alt-${role.id}`}
                        size="sm"
                        variant="ghost"
                        className="w-full h-6 justify-start text-[10px] text-muted-foreground"
                        onClick={() => { setAuthorAsAlternative(true); setAuthorRole(role); }}
                      >
                        <Plus className="w-3 h-3 mr-1" /> alternative for {role.name}
                      </Button>
                    ))}
                  {roles
                    .filter(r => r.class_key === classKey && !list.some(a => a.role_id === r.id))
                    .sort((a, b) => a.slot - b.slot)
                    .map(role => (
                      <Button
                        key={role.id}
                        size="sm"
                        variant="outline"
                        className="w-full h-7 justify-start text-[11px] border-dashed"
                        onClick={() => { setAuthorAsAlternative(false); setAuthorRole(role); }}
                      >
                        <Plus className="w-3 h-3 mr-1" /> {role.name} (slot {role.slot})
                      </Button>
                    ))}
                </div>
              </div>
            ))}
            {/* Classes whose roles are all empty still need an entry point. */}
            {[...new Set(roles.map(r => r.class_key))]
              .filter(k => !byClass.some(([ck]) => ck === k))
              .map(classKey => (
                <div key={classKey}>
                  <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">
                    {CLASS_LABELS[classKey] ?? classKey}
                  </p>
                  <div className="space-y-1">
                    {roles.filter(r => r.class_key === classKey).sort((a, b) => a.slot - b.slot).map(role => (
                      <Button
                        key={role.id}
                        size="sm"
                        variant="outline"
                        className="w-full h-7 justify-start text-[11px] border-dashed"
                        onClick={() => { setAuthorAsAlternative(false); setAuthorRole(role); }}
                      >
                        <Plus className="w-3 h-3 mr-1" /> {role.name} (slot {role.slot})
                      </Button>
                    ))}
                  </div>
                </div>
              ))}
          </div>
        </ScrollArea>
      </div>

      {/* Editor */}
      <div className="flex-1 min-h-0">
        <ScrollArea className="h-full">
          {!draft ? (
            <p className="p-6 text-sm text-muted-foreground">
              Select an ability to edit its text, cost and magnitude formulas.
            </p>
          ) : (
            <div className="p-4 space-y-4 max-w-3xl">
              <Card className="bg-card/80">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-display flex items-center gap-2">
                    <span className="text-lg">{draft.emoji}</span>{draft.label}
                    <Badge variant="outline" className="text-[10px]">
                      {CLASS_LABELS[draft.class_key] ?? draft.class_key} · slot {draft.slot} · {draft.role_name}
                    </Badge>
                    <Badge variant="secondary" className="text-[10px] font-mono">{draft.mechanic_key}</Badge>
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="grid grid-cols-4 gap-3">
                    <div className="col-span-2 space-y-1">
                      <Label className="text-[11px]">Label</Label>
                      <Input value={draft.label} onChange={e => setDraft({ ...draft, label: e.target.value })} className="h-8 text-xs" />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-[11px]">Emoji</Label>
                      <Input value={draft.emoji} onChange={e => setDraft({ ...draft, emoji: e.target.value })} className="h-8 text-xs" />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-[11px]">CP cost</Label>
                      <Input type="number" value={draft.cp_cost} onChange={e => setDraft({ ...draft, cp_cost: Number(e.target.value) })} className="h-8 text-xs" />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-[11px]">Unlock level</Label>
                      <Input type="number" value={draft.unlock_level} onChange={e => setDraft({ ...draft, unlock_level: Number(e.target.value) })} className="h-8 text-xs" />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-[11px]">Ability status</Label>
                      <Select value={draft.ability_status} onValueChange={v => setDraft({ ...draft, ability_status: v })}>
                        <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {ABILITY_STATUSES.map(s => (
                            <SelectItem key={s} value={s} className="text-xs capitalize">{s}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1">
                      <Label className="text-[11px]">Assignment status</Label>
                      <Select value={draft.assignment_status} onValueChange={v => setDraft({ ...draft, assignment_status: v })}>
                        <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {ABILITY_STATUSES.map(s => (
                            <SelectItem key={s} value={s} className="text-xs capitalize">{s}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1">
                      <Label className="text-[11px]">Tick interval (ms)</Label>
                      <Input
                        type="number"
                        value={draft.interval_ms ?? ''}
                        placeholder="—"
                        onChange={e => setDraft({ ...draft, interval_ms: e.target.value === '' ? null : Number(e.target.value) })}
                        className="h-8 text-xs"
                      />
                    </div>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-[11px]">Description</Label>
                    <Textarea value={draft.description} rows={3} onChange={e => setDraft({ ...draft, description: e.target.value })} className="text-xs" />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-[11px]">Tooltip</Label>
                    <Input value={draft.tooltip} onChange={e => setDraft({ ...draft, tooltip: e.target.value })} className="h-8 text-xs" />
                  </div>
                </CardContent>
              </Card>

              <Card className="bg-card/80">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-display">Magnitudes</CardTitle>
                  <div className="flex items-center gap-3 pt-1">
                    <div className="flex items-center gap-1">
                      <Label className="text-[10px] text-muted-foreground">Preview level</Label>
                      <Input type="number" value={sampleLevel} onChange={e => setSampleLevel(Number(e.target.value))} className="h-7 w-16 text-xs" />
                    </div>
                    <div className="flex items-center gap-1">
                      <Label className="text-[10px] text-muted-foreground">Stat mod</Label>
                      <Input type="number" value={sampleMod} onChange={e => setSampleMod(Number(e.target.value))} className="h-7 w-16 text-xs" />
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  <CalcField title="Amount calc" value={amountText} onChange={setAmountText} sample={sample} />
                  <CalcField title="Duration calc (ms)" value={durationText} onChange={setDurationText} sample={sample} />
                  <p className="text-[10px] text-muted-foreground">
                    Leave a calc as <span className="font-mono">null</span> to keep the mechanic-owned value
                    (weapon-die rolls, stack consumption and stance timing stay in code).
                  </p>
                </CardContent>
              </Card>

              <div className="flex gap-2">
                <Button size="sm" onClick={save} disabled={saving}>
                  {saving ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : <Save className="w-3 h-3 mr-1" />}
                  Save ability
                </Button>
                <Button size="sm" variant="outline" onClick={() => { const row = rows.find(r => r.assignment_id === selectedId); if (row) select(row); }}>
                  Reset
                </Button>
              </div>
            </div>
          )}
        </ScrollArea>
      </div>
    </div>
  );
}
