/**
 * AbilityConfigManager — admin editor for the reusable ability BASE LIBRARY.
 *
 * Phase 1 of the ability-ownership correction: this page queries `abilities`
 * DIRECTLY. Every base ability appears exactly once — including abilities no
 * class uses yet — and selection is keyed by the ability id, never by an
 * assignment id. The list is not grouped by class.
 *
 * Owns `abilities` rows only: presentation, taxonomy, damage type, base CP
 * cost, lifecycle and the structured calculations (`amount_calc`,
 * `duration_calc`, `mechanic_calcs`, `interval_ms`). `ability_key` is immutable
 * after creation and `mechanic_key` may only change while an ability is a draft
 * that no class has assigned.
 *
 * Class-side concerns — which class uses an ability, in which slot, at which
 * unlock level, which entry is the slot default, and per-class overrides — live
 * ONLY in the class editor (`class/ClassAbilityConfig`). This page never
 * creates or edits `class_ability_assignments`; it shows their usage read-only.
 *
 * Calculations are authored through the no-code `CalcBuilder` (term rows, dice
 * pickers, threshold ladders, final multipliers) and the template-driven
 * `MechanicCalcsEditor`. Invalid drafts are rejected before save — abilities may
 * not be published with structurally invalid or incomplete calculations.
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
import { AlertTriangle, ChevronDown, Loader2, Plus, Save } from 'lucide-react';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  Collapsible, CollapsibleContent, CollapsibleTrigger,
} from '@/components/ui/collapsible';
import CalcBuilder from './ability/CalcBuilder';
import MechanicCalcsEditor from './ability/MechanicCalcsEditor';
import GlobalModifiersPanel from './ability/GlobalModifiersPanel';
import BaseAbilityCreateDialog, {
  ABILITY_TYPES, ACTIVATION_MODES, TARGET_TYPES,
} from './ability/BaseAbilityCreateDialog';
import {
  evaluateCalc, type AbilityCalc, type CalcInputs,
} from '@/shared/formulas/ability-calc';
import { validateAbilityForPublish } from '@/shared/config/mechanic-templates';
import { getKnownAbilityMechanics } from '@/features/combat/utils/class-abilities';
import { CLASS_LABELS } from '@/lib/game-data';
import { DAMAGE_TYPES, DAMAGE_TYPE_NONE } from './damage-types';

/** One row of the base library — an `abilities` row, never an assignment. */
export interface BaseAbilityRowState {
  id: string;
  ability_key: string;
  label: string;
  description: string;
  tooltip: string;
  cp_cost: number;
  mechanic_key: string;
  status: string;
  interval_ms: number | null;
  /** Canonical damage type key, or null for non-damaging abilities. */
  damage_type: string | null;
  ability_type: string;
  activation_mode: string;
  target_type: string;
  admin_notes: string | null;
  amount_calc: AbilityCalc | null;
  duration_calc: AbilityCalc | null;
  mechanic_calcs: Record<string, AbilityCalc>;
  combat_text: Record<string, unknown>;
}

/** Read-only reference: which classes/slots reference this base ability. */
interface UsageRow {
  ability_id: string;
  class_key: string;
  slot: number;
  role_name: string;
  is_default: boolean;
  status: string;
  /** Per-class identity key (falls back to the base key when unset). */
  class_ability_key: string | null;
  unlock_level: number | null;
  /** Validated per-class override payload, authored in Class Config. */
  overrides: Record<string, unknown>;
}


const ABILITY_STATUSES = ['draft', 'active', 'retired'] as const;
const STATUS_FILTERS = ['all', ...ABILITY_STATUSES] as const;
/** Combat-text slots authored on the base ability. */
const TEXT_SLOTS: { key: string; label: string }[] = [
  { key: 'cast', label: 'Cast line' },
  { key: 'hit', label: 'Hit line' },
];

export default function AbilityConfigManager() {
  const [rows, setRows] = useState<BaseAbilityRowState[]>([]);
  const [usage, setUsage] = useState<UsageRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState<BaseAbilityRowState | null>(null);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<typeof STATUS_FILTERS[number]>('all');
  const [creating, setCreating] = useState(false);

  const [sampleLevel, setSampleLevel] = useState(20);
  const [sampleMod, setSampleMod] = useState(4);
  const [sampleStacks, setSampleStacks] = useState(3);
  const [sampleWeaponDie, setSampleWeaponDie] = useState(8);

  const mechanics = useMemo(() => getKnownAbilityMechanics(), []);

  const load = useCallback(async () => {
    setLoading(true);
    const [abilityRes, usageRes] = await Promise.all([
      supabase
        .from('abilities')
        .select(`
          id, ability_key, label, description, tooltip, cp_cost, mechanic_key,
          status, interval_ms, damage_type, ability_type, activation_mode,
          target_type, admin_notes, amount_calc, duration_calc, mechanic_calcs,
          combat_text
        `)
        .order('label'),
      supabase
        .from('class_ability_assignments')
        .select(`
          ability_id, class_key, is_default, status, class_ability_key,
          unlock_level, overrides, role:class_ability_roles ( slot, name )
        `),

    ]);
    setLoading(false);
    if (abilityRes.error) { toast.error(abilityRes.error.message); return; }

    const mapped: BaseAbilityRowState[] = (abilityRes.data ?? []).map((a: any) => ({
      id: a.id,
      ability_key: a.ability_key,
      label: a.label,
      description: a.description ?? '',
      tooltip: a.tooltip ?? '',
      cp_cost: a.cp_cost ?? 0,
      mechanic_key: a.mechanic_key,
      status: a.status ?? 'active',
      interval_ms: a.interval_ms,
      damage_type: a.damage_type ?? null,
      ability_type: a.ability_type ?? 'buff',
      activation_mode: a.activation_mode ?? 'instant',
      target_type: a.target_type ?? 'enemy',
      admin_notes: a.admin_notes ?? null,
      amount_calc: a.amount_calc,
      duration_calc: a.duration_calc,
      mechanic_calcs: (a.mechanic_calcs ?? {}) as Record<string, AbilityCalc>,
      combat_text: (a.combat_text ?? {}) as Record<string, unknown>,
    }));
    setRows(mapped);

    setUsage(((usageRes.data ?? []) as any[])
      .filter(r => r.ability_id && r.role)
      .map(r => ({
        ability_id: r.ability_id,
        class_key: r.class_key,
        slot: r.role.slot,
        role_name: r.role.name,
        is_default: !!r.is_default,
        status: r.status ?? 'active',
        class_ability_key: r.class_ability_key ?? null,
        unlock_level: r.unlock_level ?? null,
        overrides: (r.overrides ?? {}) as Record<string, unknown>,
      })));

  }, []);

  useEffect(() => { load(); }, [load]);

  const select = useCallback((row: BaseAbilityRowState) => {
    setSelectedId(row.id);
    setDraft({
      ...row,
      mechanic_calcs: { ...row.mechanic_calcs },
      combat_text: { ...row.combat_text },
    });
  }, []);

  const sample: CalcInputs = useMemo(() => ({
    level: sampleLevel,
    mods: {
      str: sampleMod, dex: sampleMod, con: sampleMod,
      int: sampleMod, wis: sampleMod, cha: sampleMod,
    },
    context: { active_stacks: sampleStacks, consumed_stacks: sampleStacks },
    weaponDie: sampleWeaponDie,
  }), [sampleLevel, sampleMod, sampleStacks, sampleWeaponDie]);

  /** Flat, de-duplicated library list: one entry per base ability. */
  const visibleRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter(r =>
      (statusFilter === 'all' || r.status === statusFilter)
      && (!q
        || r.label.toLowerCase().includes(q)
        || r.ability_key.toLowerCase().includes(q)
        || r.mechanic_key.toLowerCase().includes(q)));
  }, [rows, search, statusFilter]);

  const usageFor = useCallback(
    (abilityId: string) => usage.filter(u => u.ability_id === abilityId),
    [usage],
  );

  const draftUsage = draft ? usageFor(draft.id) : [];
  /** Identity guard: mechanics may only change on an unassigned draft. */
  const mechanicLocked = !!draft && (draft.status !== 'draft' || draftUsage.length > 0);

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
    const { error } = await supabase.from('abilities').update({
      label: draft.label,
      description: draft.description,
      tooltip: draft.tooltip,
      cp_cost: draft.cp_cost,
      interval_ms: draft.interval_ms,
      amount_calc: draft.amount_calc as any,
      duration_calc: draft.duration_calc as any,
      mechanic_calcs: draft.mechanic_calcs as any,
      combat_text: draft.combat_text as any,
      damage_type: draft.damage_type,
      ability_type: draft.ability_type,
      activation_mode: draft.activation_mode,
      target_type: draft.target_type,
      admin_notes: draft.admin_notes,
      status: draft.status,
      ...(mechanicLocked ? {} : { mechanic_key: draft.mechanic_key }),
    }).eq('id', draft.id);

    setSaving(false);
    if (error) { toast.error(error.message); return; }
    toast.success(`${draft.label} saved — players pick it up on next reload.`);
    await load();
  };

  return (
    <div className="h-full flex overflow-hidden" data-testid="ability-library">
      <BaseAbilityCreateDialog
        open={creating}
        onOpenChange={setCreating}
        onCreated={async id => { await load(); setSelectedId(id); }}
      />

      {/* Base ability library */}
      <div className="w-72 shrink-0 border-r border-border min-h-0 flex flex-col">
        <div className="p-3 space-y-2 border-b border-border/60">
          <Button size="sm" className="w-full h-7 text-[11px]" onClick={() => setCreating(true)}>
            <Plus className="w-3 h-3 mr-1" /> New base ability
          </Button>
          <Input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search library…"
            aria-label="Search base abilities"
            className="h-7 text-xs"
          />
          <Select value={statusFilter} onValueChange={v => setStatusFilter(v as typeof statusFilter)}>
            <SelectTrigger className="h-7 text-xs" aria-label="Filter by status"><SelectValue /></SelectTrigger>
            <SelectContent>
              {STATUS_FILTERS.map(s => (
                <SelectItem key={s} value={s} className="text-xs capitalize">
                  {s === 'all' ? 'All statuses' : s}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-[10px] text-muted-foreground">
            {visibleRows.length} of {rows.length} base abilities
          </p>
        </div>
        <ScrollArea className="flex-1 min-h-0">
          <div className="p-3 space-y-1">
            {loading && (
              <p className="text-xs text-muted-foreground flex items-center gap-2">
                <Loader2 className="w-3 h-3 animate-spin" /> Loading abilities…
              </p>
            )}
            {!loading && visibleRows.length === 0 && (
              <p className="text-xs text-muted-foreground">No base abilities match.</p>
            )}
            {visibleRows.map(row => {
              const used = usageFor(row.id);
              return (
                <button
                  key={row.id}
                  onClick={() => select(row)}
                  className={`w-full text-left px-2 py-1.5 rounded border text-xs transition-colors ${
                    selectedId === row.id
                      ? 'border-primary bg-primary/10'
                      : 'border-border/60 hover:bg-muted/40'
                  }`}
                >
                  {row.label}
                  {row.status !== 'active' && (
                    <Badge variant="secondary" className="ml-1 text-[9px] capitalize">{row.status}</Badge>
                  )}
                  <span className="ml-1 text-[10px] text-muted-foreground">{row.cp_cost} CP</span>
                  <span className="block text-[10px] text-muted-foreground">
                    {used.length === 0
                      ? 'unassigned'
                      : `used by ${used.length} class assignment${used.length === 1 ? '' : 's'}`}
                  </span>
                </button>
              );
            })}
          </div>
        </ScrollArea>
      </div>

      {/* Editor */}
      <div className="flex-1 min-h-0">
        <ScrollArea className="h-full">
          {!draft ? (
            <div className="p-6 max-w-xl space-y-2">
              <p className="text-sm font-display">Base ability library</p>
              <p className="text-xs text-muted-foreground">
                Every reusable ability definition lives here exactly once. Pick one
                to edit its shared properties and calculations, or create a new
                unassigned base ability. Slots, unlock levels, defaults,
                alternatives and per-class overrides are configured in Class Config.
              </p>
            </div>
          ) : (
            <div className="p-4 space-y-4 max-w-3xl">
              <Card className="bg-card/80">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-display flex items-center gap-2">
                    {draft.label}
                    <Badge variant="outline" className="text-[10px] capitalize">{draft.ability_type}</Badge>
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
                      <Label className="text-[11px]">Base CP cost</Label>
                      <Input type="number" value={draft.cp_cost} onChange={e => setDraft({ ...draft, cp_cost: Number(e.target.value) })} className="h-8 text-xs" />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-[11px]">Lifecycle status</Label>
                      <Select value={draft.status} onValueChange={v => setDraft({ ...draft, status: v })}>
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
                    <div className="space-y-1">
                      <Label className="text-[11px]">Ability type</Label>
                      <Select value={draft.ability_type} onValueChange={v => setDraft({ ...draft, ability_type: v })}>
                        <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {ABILITY_TYPES.map(t => (
                            <SelectItem key={t} value={t} className="text-xs capitalize">{t}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1">
                      <Label className="text-[11px]">Activation</Label>
                      <Select value={draft.activation_mode} onValueChange={v => setDraft({ ...draft, activation_mode: v })}>
                        <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {ACTIVATION_MODES.map(m => (
                            <SelectItem key={m} value={m} className="text-xs capitalize">{m}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1">
                      <Label className="text-[11px]">Target</Label>
                      <Select value={draft.target_type} onValueChange={v => setDraft({ ...draft, target_type: v })}>
                        <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {TARGET_TYPES.map(t => (
                            <SelectItem key={t} value={t} className="text-xs capitalize">{t}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1">
                      <Label className="text-[11px]">Base damage type</Label>
                      <Select
                        value={draft.damage_type ?? DAMAGE_TYPE_NONE}
                        onValueChange={v => setDraft({ ...draft, damage_type: v === DAMAGE_TYPE_NONE ? null : v })}
                      >
                        <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value={DAMAGE_TYPE_NONE} className="text-xs">None (non-damaging)</SelectItem>
                          {DAMAGE_TYPES.map(d => (
                            <SelectItem key={d.value} value={d.value} className="text-xs">{d.label}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
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
                  <div className="grid grid-cols-2 gap-3">
                    {TEXT_SLOTS.map(slot => (
                      <div key={slot.key} className="space-y-1">
                        <Label className="text-[11px]">Base {slot.label.toLowerCase()}</Label>
                        <Input
                          value={String(draft.combat_text[slot.key] ?? '')}
                          placeholder="—"
                          onChange={e => setDraft({
                            ...draft,
                            combat_text: { ...draft.combat_text, [slot.key]: e.target.value },
                          })}
                          className="h-8 text-xs"
                        />
                      </div>
                    ))}
                  </div>
                  <div className="rounded border border-border/60 bg-muted/20 px-2 py-1.5">
                    <p className="text-[10px] text-muted-foreground">
                      Slot, unlock level, slot default, alternatives and per-class
                      overrides are configured in Class Config. This library row is
                      shared by every class that uses it.
                    </p>
                  </div>
                </CardContent>
              </Card>

              <Card className="bg-card/80">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-display">Calculations</CardTitle>
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

              {/* Internal identity + usage reference, collapsed by default. */}
              <Collapsible>
                <CollapsibleTrigger asChild>
                  <Button size="sm" variant="outline" className="h-7 text-[11px]">
                    <ChevronDown className="w-3 h-3 mr-1" /> Advanced (identity and usage)
                  </Button>
                </CollapsibleTrigger>
                <CollapsibleContent className="pt-2">
                  <Card className="bg-card/60">
                    <CardContent className="pt-4 space-y-3">
                      <div className="grid grid-cols-2 gap-3">
                        <div className="space-y-1">
                          <Label className="text-[11px]">Ability key (permanent)</Label>
                          <Input value={draft.ability_key} readOnly disabled className="h-8 text-xs font-mono" />
                        </div>
                        <div className="space-y-1">
                          <Label className="text-[11px]">Mechanic key</Label>
                          {mechanicLocked ? (
                            <Input value={draft.mechanic_key} readOnly disabled className="h-8 text-xs font-mono" />
                          ) : (
                            <Select value={draft.mechanic_key} onValueChange={v => setDraft({ ...draft, mechanic_key: v })}>
                              <SelectTrigger className="h-8 text-xs font-mono"><SelectValue /></SelectTrigger>
                              <SelectContent className="max-h-72">
                                {mechanics.map(m => (
                                  <SelectItem key={m} value={m} className="text-xs font-mono">{m}</SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          )}
                        </div>
                      </div>
                      <p className="text-[10px] text-muted-foreground flex items-start gap-1.5">
                        <AlertTriangle className="w-3 h-3 mt-px shrink-0" />
                        {mechanicLocked
                          ? 'Mechanic is locked: this ability is active or assigned to a class. Changing the code handler would silently change what combat executes for existing loadouts.'
                          : 'This draft is unassigned, so its mechanic may still change. Once it is active or assigned, the mechanic is permanent.'}
                      </p>
                      <div className="space-y-1">
                        <Label className="text-[11px]">Used by (read-only)</Label>
                        {draftUsage.length === 0 ? (
                          <p className="text-[11px] text-muted-foreground">No class uses this ability yet.</p>
                        ) : (
                          <div className="flex flex-wrap gap-1">
                            {draftUsage.map(u => (
                              <Badge
                                key={`${u.class_key}-${u.slot}-${u.is_default}`}
                                variant="outline"
                                className="text-[10px]"
                              >
                                {CLASS_LABELS[u.class_key] ?? u.class_key} · slot {u.slot} · {u.role_name}
                                {u.is_default ? '' : ' (alt)'}
                                {u.status !== 'active' ? ` · ${u.status}` : ''}
                              </Badge>
                            ))}
                          </div>
                        )}
                      </div>
                      <div className="space-y-1">
                        <Label className="text-[11px]">Admin notes</Label>
                        <Textarea
                          value={draft.admin_notes ?? ''}
                          rows={2}
                          onChange={e => setDraft({ ...draft, admin_notes: e.target.value })}
                          className="text-xs"
                        />
                      </div>
                    </CardContent>
                  </Card>
                </CollapsibleContent>
              </Collapsible>

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
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => { const row = rows.find(r => r.id === selectedId); if (row) select(row); }}
                >
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
