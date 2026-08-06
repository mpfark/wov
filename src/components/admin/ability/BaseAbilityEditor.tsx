/**
 * BaseAbilityEditor — the ONLY surface that authors `base_abilities` rows.
 *
 * A Base Ability is the reusable authoring foundation for a family of class
 * abilities (Spell Attack, Weapon Attack, Heal, On-Hit Stance, Orb Stance...).
 * It is never Fireball or Envenom: those are authored `abilities` rows that
 * point at a base through `abilities.base_ability_id`.
 *
 * The base owns:
 *  - which runtime mechanic executes it (`mechanic_key`, immutable once used),
 *  - how it activates and what it may target,
 *  - how a follow-up status is triggered (`trigger_type`),
 *  - which configuration sections its class abilities may edit (`capabilities`),
 *  - which optional On-Hit Effects its class abilities may enable.
 */
import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Loader2, Save } from 'lucide-react';
import CalcBuilder from './CalcBuilder';
import MechanicCalcsEditor from './MechanicCalcsEditor';
import { validateAbilityForPublish } from '@/shared/config/mechanic-templates';
import type { AbilityCalc, CalcInputs } from '@/shared/formulas/ability-calc';
import { getKnownAbilityMechanics } from '@/features/combat/utils/class-abilities';
import { ON_HIT_EFFECTS, ON_HIT_EFFECT_KEYS, type OnHitEffectKey } from '@/shared/combat/on-hit-effects';
import {
  ACTIVATION_MODES, CAPABILITY_SECTIONS, TARGET_TYPES, TRIGGER_TYPES,
  capabilityList, type CapabilityKey,
} from './ability-taxonomy';

export interface BaseAbilityRow {
  id: string;
  base_key: string;
  label: string;
  description: string;
  mechanic_key: string;
  activation_mode: string;
  default_target_type: string;
  allowed_target_types: string[];
  trigger_type: string;
  capabilities: unknown;
  on_hit_allowed: string[];
  status: string;
  admin_notes: string | null;
  // ── Shared mechanical numbers (base-owned, never per class) ─────
  cp_cost: number | null;
  cp_reserve_pct: number | null;
  interval_ms: number | null;
  amount_calc: AbilityCalc | null;
  duration_calc: AbilityCalc | null;
  mechanic_calcs: Record<string, AbilityCalc>;
  effect_config: Record<string, unknown>;
  supports_secondary_scaling: boolean;
}

interface Props {
  row: BaseAbilityRow;
  /** Authored abilities already built on this base — mechanic lock signal. */
  usageCount: number;
  onSaved: () => void;
}

export default function BaseAbilityEditor({ row, usageCount, onSaved }: Props) {
  const [draft, setDraft] = useState<BaseAbilityRow>(row);
  const [saving, setSaving] = useState(false);
  const [sampleLevel, setSampleLevel] = useState(20);
  const [sampleMod, setSampleMod] = useState(4);
  const [sampleStacks, setSampleStacks] = useState(3);
  const [sampleWeaponDie, setSampleWeaponDie] = useState(8);
  useEffect(() => { setDraft(row); }, [row]);

  const sample: CalcInputs = {
    level: sampleLevel,
    mods: {
      str: sampleMod, dex: sampleMod, con: sampleMod,
      int: sampleMod, wis: sampleMod, cha: sampleMod,
    },
    context: { active_stacks: sampleStacks, consumed_stacks: sampleStacks },
    weaponDie: sampleWeaponDie,
  };

  const calcErrors = validateAbilityForPublish({
    mechanic_key: draft.mechanic_key,
    amount_calc: draft.amount_calc,
    duration_calc: draft.duration_calc,
    mechanic_calcs: draft.mechanic_calcs,
  });

  const caps = capabilityList(draft.capabilities);
  const mechanicLocked = usageCount > 0;

  const toggleCap = (key: CapabilityKey, on: boolean) => {
    const next = on ? [...caps, key] : caps.filter(c => c !== key);
    setDraft({ ...draft, capabilities: next });
  };

  const toggleOnHit = (key: OnHitEffectKey, on: boolean) => {
    const current = (draft.on_hit_allowed ?? []).filter(k => k !== key);
    setDraft({ ...draft, on_hit_allowed: on ? [...current, key] : current });
  };

  const save = async () => {
    if (calcErrors.length > 0) {
      toast.error(`Cannot save — ${calcErrors.length} calculation problem(s) must be fixed first.`);
      return;
    }
    setSaving(true);
    const { error } = await supabase.from('base_abilities').update({
      label: draft.label,
      description: draft.description,
      activation_mode: draft.activation_mode,
      default_target_type: draft.default_target_type,
      allowed_target_types: draft.allowed_target_types,
      trigger_type: draft.trigger_type,
      capabilities: caps as unknown as string[],
      on_hit_allowed: draft.on_hit_allowed ?? [],
      status: draft.status,
      admin_notes: draft.admin_notes,
      cp_cost: draft.cp_cost ?? 0,
      cp_reserve_pct: draft.cp_reserve_pct,
      interval_ms: draft.interval_ms,
      amount_calc: draft.amount_calc as any,
      duration_calc: draft.duration_calc as any,
      mechanic_calcs: draft.mechanic_calcs as any,
      supports_secondary_scaling: draft.supports_secondary_scaling,
      ...(mechanicLocked ? {} : { mechanic_key: draft.mechanic_key }),
    }).eq('id', draft.id);
    setSaving(false);
    if (error) { toast.error(error.message); return; }
    toast.success(`Base ability ${draft.label} saved.`);
    onSaved();
  };

  return (
    <div className="p-4 space-y-4" data-testid="base-ability-editor">
      <Card className="bg-card/80">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-display flex items-center gap-2">
            {draft.label}
            <Badge variant="outline" className="text-[10px] font-mono">{draft.base_key}</Badge>
            <Badge variant="secondary" className="text-[10px] font-mono">{draft.mechanic_key}</Badge>
          </CardTitle>
          <p className="text-[10px] text-muted-foreground">
            Reusable foundation. Class abilities built on it appear in the middle column.
          </p>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
            <div className="space-y-1">
              <Label className="text-[11px]">Name</Label>
              <Input
                aria-label="Base ability name"
                value={draft.label}
                onChange={e => setDraft({ ...draft, label: e.target.value })}
                className="h-8 text-xs"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-[11px]">Runtime mechanic {mechanicLocked && '(locked — in use)'}</Label>
              <Select
                value={draft.mechanic_key}
                onValueChange={v => setDraft({ ...draft, mechanic_key: v })}
                disabled={mechanicLocked}
              >
                <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent className="max-h-72">
                  {getKnownAbilityMechanics().map(m => (
                    <SelectItem key={m} value={m} className="text-xs font-mono">{m}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-[11px]">Lifecycle status</Label>
              <Select value={draft.status} onValueChange={v => setDraft({ ...draft, status: v })}>
                <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {['draft', 'active', 'retired'].map(s => (
                    <SelectItem key={s} value={s} className="text-xs capitalize">{s}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-[11px]">Activation mode</Label>
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
              <Label className="text-[11px]">Default target</Label>
              <Select value={draft.default_target_type} onValueChange={v => setDraft({ ...draft, default_target_type: v })}>
                <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {TARGET_TYPES.map(t => (
                    <SelectItem key={t} value={t} className="text-xs capitalize">{t}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-[11px]">Status trigger</Label>
              <Select value={draft.trigger_type} onValueChange={v => setDraft({ ...draft, trigger_type: v })}>
                <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {TRIGGER_TYPES.map(t => (
                    <SelectItem key={t.value} value={t.value} className="text-xs">{t.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-1">
            <Label className="text-[11px]">Allowed targets</Label>
            <div className="flex flex-wrap gap-3">
              {TARGET_TYPES.map(t => (
                <label key={t} className="flex items-center gap-1.5 text-[11px] capitalize">
                  <Checkbox
                    checked={(draft.allowed_target_types ?? []).includes(t)}
                    onCheckedChange={c => setDraft({
                      ...draft,
                      allowed_target_types: c
                        ? [...(draft.allowed_target_types ?? []).filter(x => x !== t), t]
                        : (draft.allowed_target_types ?? []).filter(x => x !== t),
                    })}
                  />
                  {t}
                </label>
              ))}
            </div>
          </div>

          <div className="space-y-1">
            <Label className="text-[11px]">Description</Label>
            <Textarea
              rows={2}
              value={draft.description}
              onChange={e => setDraft({ ...draft, description: e.target.value })}
              className="text-xs"
            />
          </div>
          <div className="space-y-1">
            <Label className="text-[11px]">Admin notes</Label>
            <Textarea
              rows={2}
              value={draft.admin_notes ?? ''}
              onChange={e => setDraft({ ...draft, admin_notes: e.target.value })}
              className="text-xs"
            />
          </div>
        </CardContent>
      </Card>


      <Card className="bg-card/80" data-testid="base-numbers-card">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-display">Shared numbers</CardTitle>
          <p className="text-[10px] text-muted-foreground">
            Every class ability built on this base uses these numbers. Class Config only
            picks the scaling attributes and one class scale multiplier.
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
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <div className="space-y-1">
              <Label className="text-[11px]">CP cost</Label>
              <Input
                type="number" aria-label="Base CP cost"
                value={draft.cp_cost ?? 0}
                onChange={e => setDraft({ ...draft, cp_cost: Number(e.target.value) })}
                className="h-8 text-xs"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-[11px]">CP reserve %</Label>
              <Input
                type="number" step="0.01" placeholder="—"
                value={draft.cp_reserve_pct ?? ''}
                onChange={e => setDraft({ ...draft, cp_reserve_pct: e.target.value === '' ? null : Number(e.target.value) })}
                className="h-8 text-xs"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-[11px]">Tick interval (ms)</Label>
              <Input
                type="number" placeholder="—"
                value={draft.interval_ms ?? ''}
                onChange={e => setDraft({ ...draft, interval_ms: e.target.value === '' ? null : Number(e.target.value) })}
                className="h-8 text-xs"
              />
            </div>
            <label className="flex items-end gap-2 text-[11px] pb-1">
              <Checkbox
                checked={draft.supports_secondary_scaling}
                onCheckedChange={c => setDraft({ ...draft, supports_secondary_scaling: !!c })}
              />
              Uses a second attribute
            </label>
          </div>
          <CalcBuilder
            title="Amount calc"
            value={draft.amount_calc}
            onChange={c => setDraft({ ...draft, amount_calc: c })}
            sample={sample}
            hint="Magnitude — damage, healing, shield pool, flat reduction. Stat terms tagged with a role are bound to each class ability's attributes."
          />
          <CalcBuilder
            title="Duration calc (ms)"
            value={draft.duration_calc}
            onChange={c => setDraft({ ...draft, duration_calc: c })}
            sample={sample}
            hint="Durations are wall-clock milliseconds."
          />
          <MechanicCalcsEditor
            mechanicKey={draft.mechanic_key}
            value={draft.mechanic_calcs}
            onChange={next => setDraft({ ...draft, mechanic_calcs: next })}
            sample={sample}
          />
          {calcErrors.length > 0 && (
            <ul className="text-[10px] text-destructive space-y-0.5">
              {calcErrors.map(e => <li key={e}>{e}</li>)}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card className="bg-card/80">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-display">Configurable sections</CardTitle>
          <p className="text-[10px] text-muted-foreground">
            Only the sections ticked here appear when editing a class ability built on this base.
          </p>
        </CardHeader>
        <CardContent className="grid grid-cols-2 lg:grid-cols-3 gap-2">
          {CAPABILITY_SECTIONS.map(section => (
            <label key={section.key} className="flex items-center gap-2 text-[11px]">
              <Checkbox
                checked={caps.includes(section.key)}
                onCheckedChange={c => toggleCap(section.key, !!c)}
              />
              {section.label}
            </label>
          ))}
        </CardContent>
      </Card>

      <Card className="bg-card/80">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-display">Optional On-Hit Effect permissions</CardTitle>
          <p className="text-[10px] text-muted-foreground">
            A rider belonging to a single damaging ability, rolled only after that ability
            lands a hit. This is NOT the persistent On-Hit Stance (Envenom) or Orb Stance
            (Orbs of Fire) — those are their own base abilities with a status trigger.
          </p>
        </CardHeader>
        <CardContent className="space-y-2">
          {ON_HIT_EFFECT_KEYS.map(key => (
            <label key={key} className="flex items-start gap-2 text-[11px]">
              <Checkbox
                checked={(draft.on_hit_allowed ?? []).includes(key)}
                onCheckedChange={c => toggleOnHit(key as OnHitEffectKey, !!c)}
              />
              <span>
                {ON_HIT_EFFECTS[key].label}
                <span className="text-muted-foreground"> — {ON_HIT_EFFECTS[key].description}</span>
              </span>
            </label>
          ))}
          {!caps.includes('on_hit_effect') && (draft.on_hit_allowed ?? []).length > 0 && (
            <p className="text-[10px] text-destructive">
              Tick the "Optional On-Hit Effect" section above, otherwise the editor stays hidden
              on class abilities.
            </p>
          )}
        </CardContent>
      </Card>

      <div className="flex justify-end">
        <Button size="sm" onClick={save} disabled={saving}>
          {saving ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : <Save className="w-3 h-3 mr-1" />}
          Save base ability
        </Button>
      </div>
    </div>
  );
}
