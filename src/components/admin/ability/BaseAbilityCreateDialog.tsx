/**
 * BaseAbilityCreateDialog — creates a reusable BASE ABILITY (`base_abilities`).
 *
 * A Base Ability is the authoring foundation for a family of class abilities:
 * it names the runtime mechanic that executes it, how it activates, what it may
 * target, how a follow-up status is triggered, and which configuration sections
 * its class abilities may edit. It is never a playable ability itself — those
 * are authored in column two and point here through `abilities.base_ability_id`.
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
import { suggestAbilityKey } from '@/shared/config/class-authoring';
import { ACTIVATION_MODES, TARGET_TYPES, TRIGGER_TYPES } from './ability-taxonomy';

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  /** Called with the new base ability id once the row exists. */
  onCreated: (baseAbilityId: string) => void;
}

export default function BaseAbilityCreateDialog({ open, onOpenChange, onCreated }: Props) {
  const mechanics = useMemo(() => getKnownAbilityMechanics(), []);
  const [existingKeys, setExistingKeys] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [draft, setDraft] = useState({
    base_key: '',
    label: '',
    description: '',
    mechanic_key: mechanics[0] ?? '',
    activation_mode: 'instant',
    default_target_type: 'enemy',
    trigger_type: 'none',
  });

  useEffect(() => {
    if (!open) return;
    supabase.from('base_abilities').select('base_key').then(({ data }) => {
      setExistingKeys((data ?? []).map(r => r.base_key));
    });
  }, [open]);

  const errors: string[] = [];
  if (!draft.label.trim()) errors.push('Name is required.');
  if (!draft.base_key.trim()) errors.push('Base key is required.');
  if (existingKeys.includes(draft.base_key)) errors.push('That base key already exists.');
  if (!draft.description.trim()) errors.push('Description is required.');
  if (!mechanics.includes(draft.mechanic_key)) errors.push('Pick a known runtime mechanic.');

  const create = async () => {
    if (errors.length) { toast.error(errors[0]); return; }
    setSaving(true);
    const { data: inserted, error } = await supabase.from('base_abilities').insert({
      base_key: draft.base_key,
      label: draft.label,
      description: draft.description,
      mechanic_key: draft.mechanic_key,
      activation_mode: draft.activation_mode,
      default_target_type: draft.default_target_type,
      allowed_target_types: [draft.default_target_type],
      trigger_type: draft.trigger_type,
      capabilities: ['identity', 'activation', 'scaling', 'amount', 'combat_text'],
      on_hit_allowed: [],
      status: 'draft',
      admin_notes: 'Created in the Ability Library.',
    }).select('id').single();
    setSaving(false);
    if (error || !inserted) { toast.error(error?.message ?? 'Insert failed'); return; }
    toast.success(`${draft.label} created — tick its configurable sections, then author class abilities on it.`);
    onOpenChange(false);
    onCreated(inserted.id);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="font-display text-sm">New base ability</DialogTitle>
          <DialogDescription className="text-xs">
            A reusable foundation, not a playable ability. Author the named class
            abilities (Fireball, Smite…) on top of it afterwards.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label className="text-[11px]">Name</Label>
              <Input
                aria-label="Label"
                value={draft.label}
                onChange={e => setDraft({
                  ...draft,
                  label: e.target.value,
                  base_key: draft.base_key || suggestAbilityKey(e.target.value),
                })}
                className="h-8 text-xs"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-[11px]">Base key (permanent)</Label>
              <Input
                aria-label="Base key"
                value={draft.base_key}
                onChange={e => setDraft({ ...draft, base_key: suggestAbilityKey(e.target.value) })}
                className="h-8 text-xs font-mono"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-[11px]">Runtime mechanic</Label>
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
            <Label className="text-[11px]">Description</Label>
            <Textarea
              aria-label="Description"
              value={draft.description}
              rows={2}
              onChange={e => setDraft({ ...draft, description: e.target.value })}
              className="text-xs"
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
