/**
 * AbilityAuthorDialog — Phase 4: author a brand-new ability into an empty
 * class ability slot.
 *
 * Authoring composes existing *code-owned* mechanics: the mechanic dropdown is
 * limited to handlers that exist in `class-abilities`, and the remaining
 * taxonomy columns (ability/damage/target/activation) are inherited from an
 * ability that already uses the chosen mechanic. New rows are created as
 * `draft` so they never appear on a live ability bar before review.
 */
import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
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

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  classKey: string;
  classLabel: string;
  roleId: string;
  roleName: string;
  roleUnlockLevel: number;
  /** True when authoring a player-selectable alternative instead of the role default. */
  asAlternative?: boolean;
  onCreated: () => void;
}

export default function AbilityAuthorDialog({
  open, onOpenChange, classKey, classLabel, roleId, roleName, roleUnlockLevel,
  asAlternative = false, onCreated,
}: Props) {
  const mechanics = useMemo(() => getKnownAbilityMechanics(), []);
  const [existingKeys, setExistingKeys] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [draft, setDraft] = useState<NewAbilityDraft>({
    ability_key: '', label: '', description: '', tooltip: '',
    mechanic_key: mechanics[0] ?? '', cp_cost: 10, unlock_level: roleUnlockLevel,
  });

  useEffect(() => {
    if (!open) return;
    setDraft(d => ({ ...d, unlock_level: roleUnlockLevel }));
    supabase.from('abilities').select('ability_key').then(({ data }) => {
      setExistingKeys((data ?? []).map(r => r.ability_key));
    });
  }, [open, roleUnlockLevel]);

  const errors = validateNewAbility(draft, { existingKeys, knownMechanics: mechanics });

  const create = async () => {
    if (errors.length) { toast.error(errors[0]); return; }
    setSaving(true);

    // Inherit the taxonomy columns from an existing ability on the same mechanic.
    const { data: template } = await supabase
      .from('abilities')
      .select('ability_type, damage_type, target_type, activation_mode, effect_config, interval_ms')
      .eq('mechanic_key', draft.mechanic_key)
      .limit(1)
      .maybeSingle();

    if (!template) {
      setSaving(false);
      toast.error('No existing ability uses that mechanic — cannot infer its type columns.');
      return;
    }

    const { data: inserted, error: abilityError } = await supabase.from('abilities').insert({
      ability_key: draft.ability_key,
      label: draft.label,
      description: draft.description,
      tooltip: draft.tooltip || draft.description,
      mechanic_key: draft.mechanic_key,
      ability_type: template.ability_type,
      damage_type: template.damage_type,
      target_type: template.target_type,
      activation_mode: template.activation_mode,
      cp_cost: draft.cp_cost,
      effect_config: template.effect_config,
      combat_text: {},
      status: 'draft',
      admin_notes: `Authored for ${classLabel} · ${roleName}`
        + (asAlternative ? ' (alternative)' : ''),
    }).select('id').single();

    if (abilityError || !inserted) {
      setSaving(false);
      toast.error(abilityError?.message ?? 'Insert failed');
      return;
    }

    const { error: assignError } = await supabase.from('class_ability_assignments').insert({
      class_key: classKey,
      role_id: roleId,
      ability_id: inserted.id,
      unlock_level: draft.unlock_level,
      is_default: !asAlternative,
      status: 'draft',
    });
    setSaving(false);
    if (assignError) { toast.error(assignError.message); return; }

    toast.success(`${draft.label} authored as a ${asAlternative ? 'draft alternative' : 'draft'} — set its magnitudes, then publish it.`);
    onOpenChange(false);
    onCreated();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="font-display text-sm">
            Author {asAlternative ? 'alternative' : 'ability'} — {classLabel} · {roleName}
          </DialogTitle>
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
              <Label className="text-[11px]">CP cost</Label>
              <Input type="number" value={draft.cp_cost} onChange={e => setDraft({ ...draft, cp_cost: Number(e.target.value) })} className="h-8 text-xs" />
            </div>
            <div className="col-span-2 space-y-1">
              <Label className="text-[11px]">Ability key</Label>
              <Input
                value={draft.ability_key}
                onChange={e => setDraft({ ...draft, ability_key: suggestAbilityKey(e.target.value) })}
                className="h-8 text-xs font-mono"
              />
            </div>
            <div className="col-span-2 space-y-1">
              <Label className="text-[11px]">Unlock level</Label>
              <Input type="number" value={draft.unlock_level} onChange={e => setDraft({ ...draft, unlock_level: Number(e.target.value) })} className="h-8 text-xs" />
            </div>
          </div>

          <div className="space-y-1">
            <Label className="text-[11px]">Mechanic (code handler)</Label>
            <Select value={draft.mechanic_key} onValueChange={v => setDraft({ ...draft, mechanic_key: v })}>
              <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent className="max-h-72">
                {mechanics.map(m => (
                  <SelectItem key={m} value={m} className="text-xs font-mono">{m}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1">
            <Label className="text-[11px]">Description</Label>
            <Textarea value={draft.description} rows={2} onChange={e => setDraft({ ...draft, description: e.target.value })} className="text-xs" />
          </div>
          <div className="space-y-1">
            <Label className="text-[11px]">Tooltip (optional)</Label>
            <Input value={draft.tooltip} onChange={e => setDraft({ ...draft, tooltip: e.target.value })} className="h-8 text-xs" />
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
            {saving && <Loader2 className="w-3 h-3 mr-1 animate-spin" />}Create draft
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
