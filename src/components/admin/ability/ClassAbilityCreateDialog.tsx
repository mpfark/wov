/**
 * ClassAbilityCreateDialog — authors a playable ability ON TOP of a Base Ability.
 *
 * The base decides the runtime mechanic, activation mode and target rules, so
 * none of those are asked for here: the new `abilities` row inherits them and
 * `base_ability_id` is always set. The row lands as a `draft` so it can never
 * reach a live ability bar before its calculations are reviewed and a class
 * deliberately assigns it in Class Config.
 */
import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { AlertTriangle, Loader2 } from 'lucide-react';
import {
  suggestAbilityKey, validateNewAbility, type NewAbilityDraft,
} from '@/shared/config/class-authoring';
import { DAMAGE_TYPES, DAMAGE_TYPE_NONE } from '../damage-types';
import { ABILITY_TYPES } from './ability-taxonomy';
import type { BaseAbilityRow } from './BaseAbilityEditor';

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  /** The base ability the new class ability is built on. */
  base: BaseAbilityRow;
  onCreated: (abilityId: string) => void;
}

export default function ClassAbilityCreateDialog({ open, onOpenChange, base, onCreated }: Props) {
  const [existingKeys, setExistingKeys] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [abilityType, setAbilityType] = useState<string>('damage');
  const [damageType, setDamageType] = useState<string | null>('physical');
  const [targetType, setTargetType] = useState<string>(base.default_target_type);
  const [draft, setDraft] = useState<NewAbilityDraft>({
    ability_key: '', label: '', description: '', tooltip: '',
    mechanic_key: base.mechanic_key, cp_cost: 10, unlock_level: 1,
  });

  useEffect(() => {
    setDraft(d => ({ ...d, mechanic_key: base.mechanic_key }));
    setTargetType(base.default_target_type);
  }, [base.mechanic_key, base.default_target_type]);

  useEffect(() => {
    if (!open) return;
    supabase.from('abilities').select('ability_key').then(({ data }) => {
      setExistingKeys((data ?? []).map(r => r.ability_key));
    });
  }, [open]);

  const targets = useMemo(
    () => (base.allowed_target_types?.length ? base.allowed_target_types : [base.default_target_type]),
    [base.allowed_target_types, base.default_target_type],
  );

  const errors = validateNewAbility(draft, {
    existingKeys,
    knownMechanics: [base.mechanic_key],
  });

  const create = async () => {
    if (errors.length) { toast.error(errors[0]); return; }
    setSaving(true);
    const { data: inserted, error } = await supabase.from('abilities').insert({
      base_ability_id: base.id,
      ability_key: draft.ability_key,
      label: draft.label,
      description: draft.description,
      tooltip: draft.tooltip || draft.description,
      mechanic_key: base.mechanic_key,
      ability_type: abilityType,
      damage_type: damageType,
      target_type: targetType,
      activation_mode: base.activation_mode,
      cp_cost: draft.cp_cost,
      // Seed the base-owned numbers so the draft is publishable as authored.
      // The publish guard requires whatever the mechanic requires; the base is
      // the canonical source of those calcs, and the class may retune them.
      amount_calc: (base.amount_calc ?? null) as unknown as never,
      duration_calc: (base.duration_calc ?? null) as unknown as never,
      interval_ms: base.interval_ms ?? null,
      mechanic_calcs: (base.mechanic_calcs ?? {}) as unknown as never,
      effect_config: {},
      combat_text: {},
      status: 'draft',
      admin_notes: `Authored on the ${base.label} base ability.`,
    }).select('id').single();
    setSaving(false);
    if (error || !inserted) { toast.error(error?.message ?? 'Insert failed'); return; }
    toast.success(`${draft.label} created as a draft on ${base.label} — assign it in Class Config.`);
    onOpenChange(false);
    onCreated(inserted.id);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="font-display text-sm flex items-center gap-2">
            New ability on
            <Badge variant="outline" className="text-[10px]">{base.label}</Badge>
          </DialogTitle>
          <DialogDescription className="text-xs">
            Inherits the {base.mechanic_key} runtime mechanic and {base.activation_mode}{' '}
            activation from the base. Slot and unlock level are set in Class Config.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="grid grid-cols-4 gap-3">
            <div className="col-span-2 space-y-1">
              <Label className="text-[11px]">Label</Label>
              <Input
                aria-label="Label"
                value={draft.label}
                onChange={e => setDraft({
                  ...draft,
                  label: e.target.value,
                  ability_key: draft.ability_key || suggestAbilityKey(e.target.value),
                })}
                className="h-8 text-xs"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-[11px]">Base CP cost</Label>
              <Input
                type="number"
                value={draft.cp_cost}
                onChange={e => setDraft({ ...draft, cp_cost: Number(e.target.value) })}
                className="h-8 text-xs"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-[11px]">Ability type</Label>
              <Select value={abilityType} onValueChange={setAbilityType}>
                <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {ABILITY_TYPES.map(t => (
                    <SelectItem key={t} value={t} className="text-xs capitalize">{t}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="col-span-2 space-y-1">
              <Label className="text-[11px]">Ability key (permanent)</Label>
              <Input
                aria-label="Ability key"
                value={draft.ability_key}
                onChange={e => setDraft({ ...draft, ability_key: suggestAbilityKey(e.target.value) })}
                className="h-8 text-xs font-mono"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-[11px]">Target</Label>
              <Select value={targetType} onValueChange={setTargetType}>
                <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {targets.map(t => (
                    <SelectItem key={t} value={t} className="text-xs capitalize">{t}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-[11px]">Damage type</Label>
              <Select
                value={damageType ?? DAMAGE_TYPE_NONE}
                onValueChange={v => setDamageType(v === DAMAGE_TYPE_NONE ? null : v)}
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
            <Textarea
              aria-label="Description"
              value={draft.description}
              rows={2}
              onChange={e => setDraft({ ...draft, description: e.target.value })}
              className="text-xs"
            />
          </div>
          <div className="space-y-1">
            <Label className="text-[11px]">Tooltip (optional)</Label>
            <Input
              value={draft.tooltip}
              onChange={e => setDraft({ ...draft, tooltip: e.target.value })}
              className="h-8 text-xs"
            />
          </div>

          {errors.map(err => (
            <p key={err} className="text-xs text-destructive flex items-start gap-1.5">
              <AlertTriangle className="w-3.5 h-3.5 mt-px shrink-0" /> {err}
            </p>
          ))}
        </div>

        <DialogFooter>
          <Button size="sm" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button size="sm" onClick={create} disabled={saving || errors.length > 0}>
            {saving && <Loader2 className="w-3 h-3 mr-1 animate-spin" />}Create ability
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
