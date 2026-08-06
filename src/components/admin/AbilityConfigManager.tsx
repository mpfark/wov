/**
 * AbilityConfigManager — the Ability Library, a genuine three-column hierarchy.
 *
 *   Column 1  BASE ABILITIES (`base_abilities`)
 *             Reusable authoring foundations — Spell Attack, Weapon Attack,
 *             Heal, On-Hit Stance, Orb Stance. Each names the runtime mechanic
 *             that executes it, its activation/target rules, how a follow-up
 *             status is triggered, which configuration sections its class
 *             abilities may edit and which optional On-Hit Effects are allowed.
 *
 *   Column 2  CLASS ABILITIES (`abilities` where base_ability_id = selected)
 *             The playable, named abilities authored on the selected base
 *             (Fireball and Smite under Spell Attack). Every ability belongs to
 *             exactly one base through `abilities.base_ability_id`.
 *
 *   Column 3  CONFIGURATION
 *             The base editor when only a base is selected, otherwise the class
 *             ability editor: identity, taxonomy, calculations, mechanic
 *             tunables and the optional On-Hit Effect — each container shown
 *             only when the base declares that capability.
 *
 * Class-side concerns — which class uses an ability, its slot, unlock level,
 * slot default and per-class overrides — live ONLY in Class Config. This page
 * never creates or edits `class_ability_assignments`; it shows usage read-only.
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
import GlobalModifiersPanel from './ability/GlobalModifiersPanel';
import BaseAbilityCreateDialog from './ability/BaseAbilityCreateDialog';
import ClassAbilityCreateDialog from './ability/ClassAbilityCreateDialog';
import BaseAbilityEditor, { type BaseAbilityRow } from './ability/BaseAbilityEditor';
import { OnHitEffectEditor } from './class/OnHitEffectEditor';
import {
  ABILITY_TYPES, capabilityList,
  type CapabilityKey,
} from './ability/ability-taxonomy';
import type { OnHitEffectConfig, OnHitEffectKey } from '@/shared/combat/on-hit-effects';
import {
  evaluateCalc, type AbilityCalc, type CalcInputs,
} from '@/shared/formulas/ability-calc';
import { validateAbilityForPublish } from '@/shared/config/mechanic-templates';
import {
  composeAbilityRow, indexAppliedStatuses, type AppliedStatusDef,
} from '@/shared/config/compose-ability';

/** Character attributes an ability's scaling roles can bind to. */
const ATTRIBUTES = ['str', 'dex', 'con', 'int', 'wis', 'cha'] as const;
import { CLASS_LABELS } from '@/lib/game-data';
import { DAMAGE_TYPES, DAMAGE_TYPE_NONE } from './damage-types';

/** One authored class ability — an `abilities` row, never an assignment. */
export interface AuthoredAbilityRowState {
  id: string;
  base_ability_id: string;
  ability_key: string;
  label: string;
  description: string;
  tooltip: string;
  mechanic_key: string;
  status: string;
  /** Canonical damage type key, or null for non-damaging abilities. */
  damage_type: string | null;
  ability_type: string;
  admin_notes: string | null;
  combat_text: Record<string, unknown>;
  /** The ONE numeric class-balancing control. */
  class_scale: number;
  primary_attribute: string | null;
  secondary_attribute: string | null;
  applied_status: string | null;
  on_hit_effect: OnHitEffectConfig | null;
}

/** Read-only reference: which classes/slots reference this ability. */
interface UsageRow {
  ability_id: string;
  class_key: string;
  slot: number;
  role_name: string;
  is_default: boolean;
  status: string;
  class_ability_key: string | null;
  unlock_level: number | null;
  overrides: Record<string, unknown>;
}

const ABILITY_STATUSES = ['draft', 'active', 'retired'] as const;
const STATUS_FILTERS = ['all', ...ABILITY_STATUSES] as const;
/** Combat-text slots authored on the class ability. */
const TEXT_SLOTS: { key: string; label: string }[] = [
  { key: 'cast', label: 'Cast line' },
  { key: 'hit', label: 'Hit line' },
];

const TRIGGER_LABELS: Record<string, string> = {
  none: 'resolves on activation',
  on_hit: 'triggers on weapon hits',
  pulse: 'attacks automatically on its own interval',
};

export default function AbilityConfigManager() {
  const [bases, setBases] = useState<BaseAbilityRow[]>([]);
  const [rows, setRows] = useState<AuthoredAbilityRowState[]>([]);
  const [usage, setUsage] = useState<UsageRow[]>([]);
  const [statuses, setStatuses] = useState<AppliedStatusDef[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [selectedBaseId, setSelectedBaseId] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState<AuthoredAbilityRowState | null>(null);
  const [baseSearch, setBaseSearch] = useState('');
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<typeof STATUS_FILTERS[number]>('all');
  const [creatingBase, setCreatingBase] = useState(false);
  const [creatingAbility, setCreatingAbility] = useState(false);

  const [sampleLevel, setSampleLevel] = useState(20);
  const [sampleMod, setSampleMod] = useState(4);
  const [sampleStacks, setSampleStacks] = useState(3);
  const [sampleWeaponDie, setSampleWeaponDie] = useState(8);

  const load = useCallback(async () => {
    setLoading(true);
    const [baseRes, abilityRes, usageRes, statusRes] = await Promise.all([
      supabase
        .from('base_abilities')
        .select(`
          id, base_key, label, description, mechanic_key, activation_mode,
          default_target_type, allowed_target_types, trigger_type, capabilities,
          on_hit_allowed, status, admin_notes, cp_cost, cp_reserve_pct,
          interval_ms, amount_calc, duration_calc, mechanic_calcs, effect_config,
          supports_secondary_scaling, target_type
        `)
        .order('label'),
      supabase
        .from('abilities')
        .select(`
          id, base_ability_id, ability_key, label, description, tooltip,
          mechanic_key, status, damage_type, ability_type, admin_notes,
          combat_text, class_scale, primary_attribute, secondary_attribute,
          applied_status, on_hit_effect
        `)
        .order('label'),
      supabase
        .from('class_ability_assignments')
        .select(`
          ability_id, class_key, is_default, status, class_ability_key,
          unlock_level, overrides, role:class_ability_roles ( slot, name )
        `),
      supabase.from('applied_statuses').select('*').order('label'),
    ]);
    setLoading(false);
    if (baseRes.error) { toast.error(baseRes.error.message); return; }
    if (abilityRes.error) { toast.error(abilityRes.error.message); return; }
    setStatuses(((statusRes.data ?? []) as unknown as AppliedStatusDef[]));

    setBases(((baseRes.data ?? []) as any[]).map(b => ({
      id: b.id,
      base_key: b.base_key,
      label: b.label,
      description: b.description ?? '',
      mechanic_key: b.mechanic_key,
      activation_mode: b.activation_mode ?? 'instant',
      default_target_type: b.default_target_type ?? 'enemy',
      allowed_target_types: b.allowed_target_types ?? [],
      trigger_type: b.trigger_type ?? 'none',
      capabilities: b.capabilities ?? [],
      on_hit_allowed: b.on_hit_allowed ?? [],
      status: b.status ?? 'active',
      admin_notes: b.admin_notes ?? null,
      cp_cost: b.cp_cost ?? 0,
      cp_reserve_pct: b.cp_reserve_pct ?? null,
      interval_ms: b.interval_ms ?? null,
      amount_calc: b.amount_calc ?? null,
      duration_calc: b.duration_calc ?? null,
      mechanic_calcs: (b.mechanic_calcs ?? {}) as Record<string, AbilityCalc>,
      effect_config: (b.effect_config ?? {}) as Record<string, unknown>,
      supports_secondary_scaling: !!b.supports_secondary_scaling,
    })));

    setRows(((abilityRes.data ?? []) as any[]).map(a => ({
      id: a.id,
      base_ability_id: a.base_ability_id,
      ability_key: a.ability_key,
      label: a.label,
      description: a.description ?? '',
      tooltip: a.tooltip ?? '',
      mechanic_key: a.mechanic_key,
      status: a.status ?? 'active',
      damage_type: a.damage_type ?? null,
      ability_type: a.ability_type ?? 'buff',
      admin_notes: a.admin_notes ?? null,
      combat_text: (a.combat_text ?? {}) as Record<string, unknown>,
      class_scale: typeof a.class_scale === 'number' ? a.class_scale : 1,
      primary_attribute: a.primary_attribute ?? null,
      secondary_attribute: a.secondary_attribute ?? null,
      applied_status: a.applied_status ?? null,
      on_hit_effect: (a.on_hit_effect ?? null) as OnHitEffectConfig | null,
    })));

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

  const select = useCallback((row: AuthoredAbilityRowState) => {
    setSelectedId(row.id);
    setDraft({ ...row, combat_text: { ...row.combat_text } });
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

  const visibleBases = useMemo(() => {
    const q = baseSearch.trim().toLowerCase();
    return bases.filter(b => !q
      || b.label.toLowerCase().includes(q)
      || b.base_key.toLowerCase().includes(q)
      || b.mechanic_key.toLowerCase().includes(q));
  }, [bases, baseSearch]);

  const selectedBase = useMemo(
    () => bases.find(b => b.id === selectedBaseId) ?? null,
    [bases, selectedBaseId],
  );

  /** Class abilities authored on the selected base. */
  const visibleRows = useMemo(() => {
    if (!selectedBaseId) return [];
    const q = search.trim().toLowerCase();
    return rows.filter(r =>
      r.base_ability_id === selectedBaseId
      && (statusFilter === 'all' || r.status === statusFilter)
      && (!q
        || r.label.toLowerCase().includes(q)
        || r.ability_key.toLowerCase().includes(q)));
  }, [rows, selectedBaseId, search, statusFilter]);

  const countForBase = useCallback(
    (baseId: string) => rows.filter(r => r.base_ability_id === baseId).length,
    [rows],
  );

  const usageFor = useCallback(
    (abilityId: string) => usage.filter(u => u.ability_id === abilityId),
    [usage],
  );

  const draftUsage = draft ? usageFor(draft.id) : [];
  const draftBase = useMemo(
    () => (draft ? bases.find(b => b.id === draft.base_ability_id) ?? null : null),
    [draft, bases],
  );
  const caps = capabilityList(draftBase?.capabilities);
  /** A base with no declared capabilities exposes everything (safe default). */
  const can = (key: CapabilityKey) => caps.length === 0 || caps.includes(key);

  const draftOnHit = draft?.on_hit_effect ?? null;
  /** Statuses are offered when the base can trigger one. */
  const statusOptions = useMemo(() => (
    draftBase && (draftBase.trigger_type !== 'none' || draft?.applied_status) ? statuses : []
  ), [draftBase, draft?.applied_status, statuses]);
  const activeStatus = useMemo(
    () => statuses.find(st => st.key === draft?.applied_status) ?? null,
    [statuses, draft?.applied_status],
  );

  /** Composed view (base numbers + this ability's identity/scaling). */
  const composed = useMemo(() => (
    draft && draftBase
      ? composeAbilityRow(draft as any, draftBase as any, indexAppliedStatuses(statuses as any))
      : null
  ), [draft, draftBase, statuses]);

  /**
   * Publish gate — a draft with structurally invalid or incomplete calcs is
   * rejected before it can be written. There is no silent legacy fallback.
   */
  const draftErrors = useMemo(() => composed ? validateAbilityForPublish({
    mechanic_key: composed.mechanic_key,
    amount_calc: composed.amount_calc,
    duration_calc: composed.duration_calc,
    mechanic_calcs: composed.mechanic_calcs,
  }) : [], [composed]);

  const previewMagnitude = useMemo(
    () => composed?.amount_calc ? evaluateCalc(composed.amount_calc, sample) : 0,
    [composed?.amount_calc, sample],
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
      combat_text: draft.combat_text as any,
      damage_type: draft.damage_type,
      ability_type: draft.ability_type,
      class_scale: draft.class_scale,
      primary_attribute: draft.primary_attribute,
      secondary_attribute: draftBase?.supports_secondary_scaling ? draft.secondary_attribute : null,
      applied_status: draft.applied_status,
      on_hit_effect: (draft.on_hit_effect ?? null) as any,
      admin_notes: draft.admin_notes,
      status: draft.status,
    }).eq('id', draft.id);

    setSaving(false);
    if (error) { toast.error(error.message); return; }
    toast.success(`${draft.label} saved — players pick it up on next reload.`);
    await load();
  };

  return (
    <div className="h-full flex overflow-hidden" data-testid="ability-library">
      <BaseAbilityCreateDialog
        open={creatingBase}
        onOpenChange={setCreatingBase}
        onCreated={async id => {
          await load();
          setSelectedBaseId(id);
          setSelectedId(null);
          setDraft(null);
        }}
      />
      {selectedBase && (
        <ClassAbilityCreateDialog
          open={creatingAbility}
          onOpenChange={setCreatingAbility}
          base={selectedBase}
          onCreated={async id => { await load(); setSelectedId(id); }}
        />
      )}

      {/* Column 1 — base abilities */}
      <div
        className="w-64 shrink-0 border-r border-border min-h-0 flex flex-col"
        data-testid="base-ability-column"
      >
        <div className="p-3 space-y-2 border-b border-border/60">
          <p className="text-xs font-display">Base abilities</p>
          <Button size="sm" className="w-full h-7 text-[11px]" onClick={() => setCreatingBase(true)}>
            <Plus className="w-3 h-3 mr-1" /> New base ability
          </Button>
          <Input
            value={baseSearch}
            onChange={e => setBaseSearch(e.target.value)}
            placeholder="Search bases…"
            aria-label="Search base abilities"
            className="h-7 text-xs"
          />
          <p className="text-[10px] text-muted-foreground">
            {visibleBases.length} of {bases.length} base abilities
          </p>
        </div>
        <ScrollArea className="flex-1 min-h-0">
          <div className="p-3 space-y-1">
            {loading && (
              <p className="text-xs text-muted-foreground flex items-center gap-2">
                <Loader2 className="w-3 h-3 animate-spin" /> Loading library…
              </p>
            )}
            {!loading && visibleBases.length === 0 && (
              <p className="text-xs text-muted-foreground">No base abilities match.</p>
            )}
            {visibleBases.map(base => {
              const count = countForBase(base.id);
              return (
                <button
                  key={base.id}
                  onClick={() => {
                    setSelectedBaseId(base.id);
                    setSelectedId(null);
                    setDraft(null);
                  }}
                  className={`w-full text-left px-2 py-1.5 rounded border text-xs transition-colors ${
                    selectedBaseId === base.id
                      ? 'border-primary bg-primary/10'
                      : 'border-border/60 hover:bg-muted/40'
                  }`}
                >
                  {base.label}
                  {base.status !== 'active' && (
                    <Badge variant="secondary" className="ml-1 text-[9px] capitalize">{base.status}</Badge>
                  )}
                  <span className="block text-[10px] font-mono text-muted-foreground">{base.mechanic_key}</span>
                  <span className="block text-[10px] text-muted-foreground">
                    {count === 0 ? 'no abilities yet' : `${count} ability${count === 1 ? '' : 's'}`}
                    {base.trigger_type !== 'none' ? ` · ${TRIGGER_LABELS[base.trigger_type]}` : ''}
                  </span>
                </button>
              );
            })}
          </div>
        </ScrollArea>
      </div>

      {/* Column 2 — class abilities authored on the selected base */}
      <div
        className="w-64 shrink-0 border-r border-border min-h-0 flex flex-col"
        data-testid="class-variant-column"
      >
        <div className="p-3 border-b border-border/60 space-y-2">
          <p className="text-xs font-display">Abilities</p>
          <p className="text-[10px] text-muted-foreground">
            {selectedBase
              ? `Built on ${selectedBase.label}`
              : 'Pick a base ability to see its class versions.'}
          </p>
          {selectedBase && (
            <>
              <Button
                size="sm" variant="outline" className="w-full h-7 text-[11px]"
                onClick={() => setCreatingAbility(true)}
              >
                <Plus className="w-3 h-3 mr-1" /> New ability on this base
              </Button>
              <Input
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Search abilities…"
                aria-label="Search abilities"
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
            </>
          )}
        </div>
        <ScrollArea className="flex-1 min-h-0">
          <div className="p-3 space-y-1">
            {selectedBase && visibleRows.length === 0 && (
              <p className="text-[11px] text-muted-foreground">
                No ability uses this base yet.
              </p>
            )}
            {visibleRows.map(row => {
              const used = usageFor(row.id);
              const classes = Array.from(new Set(used.map(u => CLASS_LABELS[u.class_key] ?? u.class_key)));
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
                  {row.class_scale !== 1 && (
                    <span className="ml-1 text-[10px] text-muted-foreground">×{row.class_scale}</span>
                  )}
                  <span className="block text-[10px] font-mono text-muted-foreground">{row.ability_key}</span>
                  <span className="block text-[10px] text-muted-foreground">
                    {classes.length === 0 ? 'unassigned' : classes.join(', ')}
                  </span>
                </button>
              );
            })}
          </div>
        </ScrollArea>
      </div>

      {/* Column 3 — configuration */}
      <div className="flex-1 min-h-0" data-testid="configuration-column">
        <ScrollArea className="h-full">
          {!draft && !selectedBase && (
            <div className="p-6 max-w-xl space-y-2">
              <p className="text-sm font-display">Ability library</p>
              <p className="text-xs text-muted-foreground">
                Pick a base ability on the left to see the abilities built on it,
                or create a new base. Slots, unlock levels, defaults and per-class
                overrides are configured in Class Config.
              </p>
            </div>
          )}

          {!draft && selectedBase && (
            <BaseAbilityEditor
              row={selectedBase}
              usageCount={countForBase(selectedBase.id)}
              onSaved={load}
            />
          )}

          {draft && (
            <div className="p-4 space-y-4 max-w-3xl">
              <Card className="bg-card/80">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-display flex items-center gap-2">
                    {draft.label}
                    <Badge variant="outline" className="text-[10px] capitalize">{draft.ability_type}</Badge>
                    <Badge variant="secondary" className="text-[10px]">
                      {draftBase?.label ?? draft.mechanic_key}
                    </Badge>
                  </CardTitle>
                  <p className="text-[10px] text-muted-foreground">
                    Built on {draftBase?.label ?? 'an unknown base'} — runtime mechanic{' '}
                    <span className="font-mono">{draft.mechanic_key}</span>, which{' '}
                    {TRIGGER_LABELS[draftBase?.trigger_type ?? 'none']}.
                  </p>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="grid grid-cols-4 gap-3">
                    <div className="col-span-2 space-y-1">
                      <Label className="text-[11px]">Label</Label>
                      <Input value={draft.label} onChange={e => setDraft({ ...draft, label: e.target.value })} className="h-8 text-xs" />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-[11px]">Class scale</Label>
                      <Input
                        type="number" step="0.05" min={0.05} max={4}
                        aria-label="Class scale"
                        value={draft.class_scale}
                        onChange={e => setDraft({ ...draft, class_scale: Number(e.target.value) || 1 })}
                        className="h-8 text-xs"
                      />
                      <p className="text-[10px] text-muted-foreground">Magnitude multiplier — the only number owned here.</p>
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
                      <Label className="text-[11px]">Primary attribute</Label>
                      <Select
                        value={draft.primary_attribute ?? 'none'}
                        onValueChange={v => setDraft({ ...draft, primary_attribute: v === 'none' ? null : v })}
                      >
                        <SelectTrigger className="h-8 text-xs" aria-label="Primary attribute"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none" className="text-xs">None</SelectItem>
                          {ATTRIBUTES.map(a => (
                            <SelectItem key={a} value={a} className="text-xs uppercase">{a}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    {draftBase?.supports_secondary_scaling && (
                      <div className="space-y-1">
                        <Label className="text-[11px]">Secondary attribute</Label>
                        <Select
                          value={draft.secondary_attribute ?? 'none'}
                          onValueChange={v => setDraft({ ...draft, secondary_attribute: v === 'none' ? null : v })}
                        >
                          <SelectTrigger className="h-8 text-xs" aria-label="Secondary attribute"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="none" className="text-xs">None</SelectItem>
                            {ATTRIBUTES.map(a => (
                              <SelectItem key={a} value={a} className="text-xs uppercase">{a}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    )}
                    {can('damage_type') && (
                      <div className="space-y-1">
                        <Label className="text-[11px]">Damage type</Label>
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
                    )}
                  </div>
                  <div className="space-y-1">
                    <Label className="text-[11px]">Description</Label>
                    <Textarea value={draft.description} rows={3} onChange={e => setDraft({ ...draft, description: e.target.value })} className="text-xs" />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-[11px]">Tooltip</Label>
                    <Input value={draft.tooltip} onChange={e => setDraft({ ...draft, tooltip: e.target.value })} className="h-8 text-xs" />
                  </div>
                  {can('combat_text') && (
                    <div className="grid grid-cols-2 gap-3">
                      {TEXT_SLOTS.map(slot => (
                        <div key={slot.key} className="space-y-1">
                          <Label className="text-[11px]">{slot.label}</Label>
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
                  )}
                  <div className="rounded border border-border/60 bg-muted/20 px-2 py-1.5">
                    <p className="text-[10px] text-muted-foreground">
                      Slot, unlock level, slot default and per-class overrides are
                      configured in Class Config.
                    </p>
                  </div>
                </CardContent>
              </Card>

              <Card className="bg-card/80" data-testid="inherited-numbers-card">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-display">Inherited numbers (base-owned)</CardTitle>
                  <p className="text-[10px] text-muted-foreground">
                    CP cost, formulas, timing and mechanic tunables belong to{' '}
                    {draftBase?.label ?? 'the base ability'}. Edit them there — every ability
                    on that base changes together. Class scale above is the only number
                    owned by this ability.
                  </p>
                </CardHeader>
                <CardContent className="space-y-2">
                  <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 text-[11px]">
                    <div>
                      <span className="block text-muted-foreground">CP cost</span>
                      {draftBase?.cp_cost ?? 0}
                    </div>
                    <div>
                      <span className="block text-muted-foreground">Target</span>
                      <span className="capitalize">{composed?.target_type ?? '—'}</span>
                    </div>
                    <div>
                      <span className="block text-muted-foreground">Activation</span>
                      <span className="capitalize">{composed?.activation_mode ?? '—'}</span>
                    </div>
                    <div>
                      <span className="block text-muted-foreground">Tick interval</span>
                      {draftBase?.interval_ms ? `${draftBase.interval_ms} ms` : '—'}
                    </div>
                  </div>
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
                  <p className="text-[11px]">
                    Composed magnitude at these inputs:{' '}
                    <span className="font-mono">{Math.round(previewMagnitude)}</span>
                    {draft.class_scale !== 1 && (
                      <span className="text-muted-foreground"> (includes class scale ×{draft.class_scale})</span>
                    )}
                  </p>
                  {draftErrors.length > 0 && (
                    <ul className="text-[10px] text-destructive space-y-0.5">
                      {draftErrors.map(e => <li key={e}>{e}</li>)}
                    </ul>
                  )}
                </CardContent>
              </Card>

              {statusOptions.length > 0 && (
                <Card className="bg-card/80" data-testid="applied-status-card">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm font-display">Applied status</CardTitle>
                    <p className="text-[10px] text-muted-foreground">
                      The reusable status this ability applies. The status owns its damage,
                      duration and stacking rules and binds its scaling roles to the
                      attributes chosen above.
                    </p>
                  </CardHeader>
                  <CardContent className="space-y-2">
                    <Select
                      value={draft.applied_status ?? 'none'}
                      onValueChange={v => setDraft({ ...draft, applied_status: v === 'none' ? null : v })}
                    >
                      <SelectTrigger className="h-8 text-xs max-w-xs" aria-label="Applied status"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none" className="text-xs">None</SelectItem>
                        {statusOptions.filter(st => !!st.key).map(st => (
                          <SelectItem key={st.key} value={st.key} className="text-xs">
                            {st.label ?? st.key}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {activeStatus && (
                      <p className="text-[10px] text-muted-foreground">
                        Magnitude role{' '}
                        <span className="font-mono">{activeStatus.magnitude?.role ?? 'none'}</span>
                        {' '}→{' '}
                        <span className="font-mono uppercase">{composed?.effect_config?.dot_stat as string ?? '—'}</span>
                        {' · '}duration role{' '}
                        <span className="font-mono">{activeStatus.duration?.role ?? 'none'}</span>
                        {' '}→{' '}
                        <span className="font-mono uppercase">{composed?.effect_config?.dot_duration_stat as string ?? '—'}</span>
                      </p>
                    )}
                  </CardContent>
                </Card>
              )}

              {caps.includes('on_hit_effect') && (
                <Card className="bg-card/80" data-testid="on-hit-effect-card">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm font-display">Optional on-hit effect</CardTitle>
                    <p className="text-[10px] text-muted-foreground">
                      A rider rolled only after this ability lands. Classes may replace it
                      in Class Config. This is not a stance — persistent self-stances such as
                      Envenom or Orbs of Fire are authored on their own base ability.
                    </p>
                  </CardHeader>
                  <CardContent>
                    <OnHitEffectEditor
                      allowed={(draftBase?.on_hit_allowed ?? []) as OnHitEffectKey[]}
                      value={draftOnHit}
                      onChange={next => setDraft({ ...draft, on_hit_effect: next })}
                    />
                  </CardContent>
                </Card>
              )}

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
                          <Label className="text-[11px]">Runtime mechanic (base-owned)</Label>
                          <Input value={draft.mechanic_key} readOnly disabled className="h-8 text-xs font-mono" />
                        </div>
                      </div>
                      <p className="text-[10px] text-muted-foreground flex items-start gap-1.5">
                        <AlertTriangle className="w-3 h-3 mt-px shrink-0" />
                        The runtime mechanic belongs to the base ability. Change it there —
                        never on a single ability — so every ability in the family keeps
                        executing the same combat code.
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
