/**
 * AbilityConfigManager — admin editor for the configurable class ability system.
 * Edits `abilities` rows and their class assignment: presentation, cost, unlock
 * level and the structured calculations (`amount_calc`, `duration_calc`,
 * `mechanic_calcs`, `interval_ms`).
 *
 * Checkpoint 6: calculations are authored through the no-code `CalcBuilder`
 * (term rows, dice pickers, threshold ladders, final multipliers) and the
 * template-driven `MechanicCalcsEditor`. JSON is a read-only diagnostic only.
 * Invalid drafts are rejected before save — abilities may not be published with
 * structurally invalid or incomplete calculations.
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
import { AlertTriangle, Loader2, Plus, Save } from 'lucide-react';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import AbilityAuthorDialog from './AbilityAuthorDialog';
import CalcBuilder from './ability/CalcBuilder';
import MechanicCalcsEditor from './ability/MechanicCalcsEditor';
import GlobalModifiersPanel from './ability/GlobalModifiersPanel';
import {
  evaluateCalc, type AbilityCalc, type CalcInputs,
} from '@/shared/formulas/ability-calc';
import { validateAbilityForPublish } from '@/shared/config/mechanic-templates';
import { CLASS_LABELS } from '@/lib/game-data';
import type { Json } from '@/integrations/supabase/types';

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
  mechanic_calcs: Record<string, AbilityCalc>;
  template_id: string;
  template_key: string;
  template_name: string;
}

interface RoleRow { id: string; class_key: string; slot: number; name: string; unlock_level: number }

interface QueryRow {
  id: string;
  class_key: string;
  unlock_level: number;
  is_default: boolean;
  status: string;
  role: { id: string; slot: number; name: string } | null;
  ability: {
    id: string; ability_key: string; label: string; description: string;
    tooltip: string; cp_cost: number; mechanic_key: string; status: string;
    interval_ms: number | null; amount_calc: AbilityCalc | null; duration_calc: AbilityCalc | null;
    mechanic_calcs: Record<string, AbilityCalc> | null;
    template: {
      id: string; template_key: string; name: string; cp_cost: number; mechanic_key: string;
      interval_ms: number | null; amount_calc: AbilityCalc | null; duration_calc: AbilityCalc | null;
      mechanic_calcs: Record<string, AbilityCalc> | null;
    } | null;
  } | null;
}

const ABILITY_STATUSES = ['draft', 'active', 'retired'] as const;


export default function AbilityConfigManager() {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Row | null>(null);

  const [sampleLevel, setSampleLevel] = useState(20);
  const [sampleMod, setSampleMod] = useState(4);
  const [sampleStacks, setSampleStacks] = useState(3);
  const [sampleWeaponDie, setSampleWeaponDie] = useState(8);

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
          id, ability_key, label, description, tooltip, cp_cost,
          mechanic_key, status, interval_ms, amount_calc, duration_calc, mechanic_calcs,
          template:ability_templates (
            id, template_key, name, cp_cost, mechanic_key, interval_ms,
            amount_calc, duration_calc, mechanic_calcs
          )
        )

      `);
    setLoading(false);
    if (error) { toast.error(error.message); return; }
    const queryRows = (data ?? []) as unknown as QueryRow[];
    const mapped: Row[] = queryRows
      // Alternatives (is_default = false) are kept: they are the player-selectable
      // loadout options for the same role.
      .filter((r): r is QueryRow & { ability: NonNullable<QueryRow['ability']>; role: NonNullable<QueryRow['role']> } => !!r.ability && !!r.role)
      .map(r => ({
        assignment_id: r.id,
        class_key: r.class_key,
        unlock_level: r.unlock_level,
        slot: r.role.slot,
        role_name: r.role.name,
        ability_id: r.ability.id,
        ability_key: r.ability.ability_key,
        label: r.ability.label,
        description: r.ability.description,
        tooltip: r.ability.tooltip,
        cp_cost: r.ability.template?.cp_cost ?? r.ability.cp_cost,
        mechanic_key: r.ability.template?.mechanic_key ?? r.ability.mechanic_key,
        ability_status: r.ability.status ?? 'active',
        assignment_status: r.status ?? 'active',
        is_default: !!r.is_default,
        role_id: r.role.id,
        interval_ms: r.ability.template?.interval_ms ?? r.ability.interval_ms,
        amount_calc: r.ability.template?.amount_calc ?? r.ability.amount_calc,
        duration_calc: r.ability.template?.duration_calc ?? r.ability.duration_calc,
        mechanic_calcs: (r.ability.template?.mechanic_calcs ?? r.ability.mechanic_calcs ?? {}) as Record<string, AbilityCalc>,
        template_id: r.ability.template?.id ?? '',
        template_key: r.ability.template?.template_key ?? r.ability.ability_key,
        template_name: r.ability.template?.name ?? `${r.ability.label} template`,
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
    setDraft({ ...row, mechanic_calcs: { ...row.mechanic_calcs } });
  };

  const sample: CalcInputs = useMemo(() => ({
    level: sampleLevel,
    mods: {
      str: sampleMod, dex: sampleMod, con: sampleMod,
      int: sampleMod, wis: sampleMod, cha: sampleMod,
    },
    context: { active_stacks: sampleStacks, consumed_stacks: sampleStacks },
    weaponDie: sampleWeaponDie,
  }), [sampleLevel, sampleMod, sampleStacks, sampleWeaponDie]);

  const byClass = useMemo(() => {
    const map = new Map<string, Row[]>();
    for (const r of rows) map.set(r.class_key, [...(map.get(r.class_key) ?? []), r]);
    return [...map.entries()];
  }, [rows]);

  /**
   * Publish gate — a draft with structurally invalid or incomplete calcs is
   * rejected before it can be written. There is no silent legacy fallback.
   */
  const draftErrors = useMemo(() => draft ? validateAbilityForPublish({
    mechanic_key: draft.mechanic_key,
    amount_calc: draft.amount_calc,
    duration_calc: draft.duration_calc,
    mechanic_calcs: draft.mechanic_calcs,
  }) : [], [draft]);

  const previewMagnitude = useMemo(
    () => draft?.amount_calc ? evaluateCalc(draft.amount_calc, sample) : 0,
    [draft?.amount_calc, sample],
  );

  const save = async () => {
    if (!draft) return;
    if (draftErrors.length) {
      toast.error(`Cannot save — ${draftErrors.length} calculation problem(s) must be fixed first.`);
      return;
    }

    setSaving(true);
    const { error: abilityError } = await supabase.from('abilities').update({
      label: draft.label,
      description: draft.description,
      tooltip: draft.tooltip,
      status: draft.ability_status,
    }).eq('id', draft.ability_id);

    const { error: templateError } = await supabase.from('ability_templates').update({
      name: draft.template_name,
      cp_cost: draft.cp_cost,
      interval_ms: draft.interval_ms,
      amount_calc: draft.amount_calc as unknown as Json,
      duration_calc: draft.duration_calc as unknown as Json,
      mechanic_calcs: draft.mechanic_calcs as unknown as Json,
      status: draft.ability_status,
    }).eq('id', draft.template_id);

    const { error: assignmentError } = await supabase
      .from('class_ability_assignments')
      .update({ unlock_level: draft.unlock_level, status: draft.assignment_status })
      .eq('id', draft.assignment_id);
    setSaving(false);

    const err = abilityError || templateError || assignmentError;
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
                    {draft.label}
                    <Badge variant="outline" className="text-[10px]">
                      {CLASS_LABELS[draft.class_key] ?? draft.class_key} · slot {draft.slot} · {draft.role_name}
                    </Badge>
                    <Badge variant="secondary" className="text-[10px] font-mono">{draft.mechanic_key}</Badge>
                    <Badge variant="outline" className="text-[10px]">Template: {draft.template_name}</Badge>
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="grid grid-cols-4 gap-3">
                    <div className="col-span-2 space-y-1">
                      <Label className="text-[11px]">Label</Label>
                      <Input value={draft.label} onChange={e => setDraft({ ...draft, label: e.target.value })} className="h-8 text-xs" />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-[11px]">Template CP cost</Label>
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
                  <CardTitle className="text-sm font-display">Template calculations</CardTitle>
                  <p className="text-[11px] text-muted-foreground">
                    Changes inherit automatically to every class ability using {draft.template_name}.
                  </p>
                  <div className="flex flex-wrap items-center gap-3 pt-1">
                    <div className="flex items-center gap-1">
                      <Label className="text-[10px] text-muted-foreground">Preview level</Label>
                      <Input type="number" value={sampleLevel} onChange={e => setSampleLevel(Number(e.target.value))} className="h-7 w-16 text-xs" />
                    </div>
                    <div className="flex items-center gap-1">
                      <Label className="text-[10px] text-muted-foreground">Stat mod</Label>
                      <Input type="number" value={sampleMod} onChange={e => setSampleMod(Number(e.target.value))} className="h-7 w-16 text-xs" />
                    </div>
                    <div className="flex items-center gap-1">
                      <Label className="text-[10px] text-muted-foreground">Stacks</Label>
                      <Input type="number" min={0} value={sampleStacks} onChange={e => setSampleStacks(Number(e.target.value))} className="h-7 w-16 text-xs" />
                    </div>
                    <div className="flex items-center gap-1">
                      <Label className="text-[10px] text-muted-foreground">Weapon die</Label>
                      <Input type="number" min={2} value={sampleWeaponDie} onChange={e => setSampleWeaponDie(Number(e.target.value))} className="h-7 w-16 text-xs" />
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  <CalcBuilder
                    title="Amount calc"
                    value={draft.amount_calc}
                    onChange={c => setDraft({ ...draft, amount_calc: c })}
                    sample={sample}
                    hint="Magnitude in the unit chosen above — damage, healing, shield pool, flat reduction."
                  />
                  <CalcBuilder
                    title="Duration calc (ms)"
                    value={draft.duration_calc}
                    onChange={c => setDraft({ ...draft, duration_calc: c })}
                    sample={sample}
                    hint="Durations are wall-clock milliseconds. Bond and Arcane Surge never touch durations."
                  />
                </CardContent>
              </Card>

              <Card className="bg-card/80">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-display flex items-center gap-2">
                    Mechanic tunables
                    <Badge variant="secondary" className="text-[10px] font-mono">{draft.mechanic_key}</Badge>
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <MechanicCalcsEditor
                    mechanicKey={draft.mechanic_key}
                    value={draft.mechanic_calcs}
                    onChange={next => setDraft({ ...draft, mechanic_calcs: next })}
                    sample={sample}
                  />
                </CardContent>
              </Card>

              <Card className="bg-card/80">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-display">Global pipeline rules</CardTitle>
                </CardHeader>
                <CardContent>
                  <GlobalModifiersPanel baseMagnitude={previewMagnitude} intMod={sampleMod} />
                </CardContent>
              </Card>

              {draftErrors.length > 0 && (
                <div className="rounded border border-destructive/50 bg-destructive/5 p-3 space-y-1">
                  <p className="text-[11px] font-semibold text-destructive flex items-center gap-1.5">
                    <AlertTriangle className="w-3.5 h-3.5" /> Publish blocked — fix these first:
                  </p>
                  {draftErrors.map(err => (
                    <p key={err} className="text-[11px] text-destructive pl-5">{err}</p>
                  ))}
                </div>
              )}

              <div className="flex gap-2">
                <Button size="sm" onClick={save} disabled={saving || draftErrors.length > 0}>
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
