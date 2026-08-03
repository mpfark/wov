/**
 * BaseAbilityCreateDialog — creates a reusable BASE ability row only.
 *
 * Phase 1 of the ability-ownership correction: the Abilities page is a base
 * library. Creating a base ability here NEVER writes a
 * `class_ability_assignments` row — assignment is Class Config's job.
 *
 * New rows land as `draft` so they can never appear on a live ability bar
 * before an admin reviews their calculations and a class deliberately assigns
 * them.
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
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { AlertTriangle, Loader2 } from 'lucide-react';
import { getKnownAbilityMechanics } from '@/features/combat/utils/class-abilities';
import {
  suggestAbilityKey, validateNewAbility, type NewAbilityDraft,
} from '@/shared/config/class-authoring';
import { DAMAGE_TYPES, DAMAGE_TYPE_NONE } from '../damage-types';

export const ABILITY_TYPES = ['damage', 'heal', 'buff', 'debuff', 'utility'] as const;
export const ACTIVATION_MODES = ['instant', 'queued', 'stance'] as const;
export const TARGET_TYPES = ['self', 'ally', 'enemy', 'party', 'node'] as const;

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  /** Called with the new ability id once the base row exists. */
  onCreated: (abilityId: string) => void;
}

interface Taxonomy {
  ability_type: string;
  damage_type: string | null;
  target_type: string;
  activation_mode: string;
}

export default function BaseAbilityCreateDialog({ open, onOpenChange, onCreated }: Props) {
  const mechanics = useMemo(() => getKnownAbilityMechanics(), []);
  const [existingKeys, setExistingKeys] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [draft, setDraft] = useState<NewAbilityDraft>({
    ability_key: '', label: '', description: '', tooltip: '',
    mechanic_key: mechanics[0] ?? '', cp_cost: 10, unlock_level: 1,
  });
  const [taxonomy, setTaxonomy] = useState<Taxonomy>({
    ability_type: 'damage', damage_type: 'physical',
    target_type: 'enemy', activation_mode: 'instant',
  });

  useEffect(() => {
    if (!open) return;
    supabase.from('abilities').select('ability_key').then(({ data }) => {
      setExistingKeys((data ?? []).map(r => r.ability_key));
    });
  }, [open]);

  /** Suggest taxonomy from a sibling ability on the same mechanic, if any. */
  useEffect(() => {
    if (!open || !draft.mechanic_key) return;
    let cancelled = false;
    supabase
      .from('abilities')
      .select('ability_type, damage_type, target_type, activation_mode')
      .eq('mechanic_key', draft.mechanic_key)
      .limit(1)
      .maybeSingle()
      .then(({ data }) => {
        if (cancelled || !data) return;
        setTaxonomy({
          ability_type: data.ability_type,
          damage_type: data.damage_type ?? null,
          target_type: data.target_type,
          activation_mode: data.activation_mode,
        });
      });
    return () => { cancelled = true; };
  }, [open, draft.mechanic_key]);

  const errors = validateNewAbility(draft, { existingKeys, knownMechanics: mechanics });

  const create = async () => {
    if (errors.length) { toast.error(errors[0]); return; }
    setSaving(true);
    const { data: inserted, error } = await supabase.from('abilities').insert({
      ability_key: draft.ability_key,
      label: draft.label,
      description: draft.description,
      tooltip: draft.tooltip || draft.description,
      mechanic_key: draft.mechanic_key,
      ability_type: taxonomy.ability_type,
      damage_type: taxonomy.damage_type,
      target_type: taxonomy.target_type,
      activation_mode: taxonomy.activation_mode,
      cp_cost: draft.cp_cost,
      effect_config: {},
      combat_text: {},
      status: 'draft',
      admin_notes: 'Created in the base ability library (unassigned).',
    }).select('id').single();
    setSaving(false);
    if (error || !inserted) { toast.error(error?.message ?? 'Insert failed'); return; }
    toast.success(`${draft.label} created as an unassigned draft — assign it from Class Config.`);
    onOpenChange(false);
    onCreated(inserted.id);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="font-display text-sm">New base ability</DialogTitle>
          <DialogDescription className="text-xs">
            Creates a reusable library definition only. It is not assigned to any
            class — do that from Class Config once its calculations are set.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="grid grid-cols-4 gap-3">
            <div className="col-span-2 space-y-1">
              <Label className="text-[11px]">Label</Label>
              <Input
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
              <Select value={taxonomy.ability_type} onValueChange={v => setTaxonomy({ ...taxonomy, ability_type: v })}>
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
                value={draft.ability_key}
                onChange={e => setDraft({ ...draft, ability_key: suggestAbilityKey(e.target.value) })}
                className="h-8 text-xs font-mono"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-[11px]">Target</Label>
              <Select value={taxonomy.target_type} onValueChange={v => setTaxonomy({ ...taxonomy, target_type: v })}>
                <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {TARGET_TYPES.map(t => (
                    <SelectItem key={t} value={t} className="text-xs capitalize">{t}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-[11px]">Activation</Label>
              <Select value={taxonomy.activation_mode} onValueChange={v => setTaxonomy({ ...taxonomy, activation_mode: v })}>
                <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {ACTIVATION_MODES.map(m => (
                    <SelectItem key={m} value={m} className="text-xs capitalize">{m}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="col-span-2 space-y-1">
              <Label className="text-[11px]">Mechanic (code handler, permanent)</Label>
              <Select value={draft.mechanic_key} onValueChange={v => setDraft({ ...draft, mechanic_key: v })}>
                <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent className="max-h-72">
                  {mechanics.map(m => (
                    <SelectItem key={m} value={m} className="text-xs font-mono">{m}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="col-span-2 space-y-1">
              <Label className="text-[11px]">Base damage type</Label>
              <Select
                value={taxonomy.damage_type ?? DAMAGE_TYPE_NONE}
                onValueChange={v => setTaxonomy({ ...taxonomy, damage_type: v === DAMAGE_TYPE_NONE ? null : v })}
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
            {saving && <Loader2 className="w-3 h-3 mr-1 animate-spin" />}Create base ability
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
