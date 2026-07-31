/**
 * ClassAuthorDialog — Phase 4: create a brand-new class as a draft.
 *
 * Inserts the `classes` row with neutral defaults plus the canonical five
 * ability roles, so the class immediately has slots the ability editor can
 * fill. Drafts are never selectable in a class hall.
 */
import { useMemo, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { AlertTriangle, Loader2 } from 'lucide-react';
import {
  CLASS_ROLE_TEMPLATE, NEW_CLASS_DEFAULTS, validateNewClassKey,
} from '@/shared/config/class-authoring';

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  existingKeys: string[];
  nextSortOrder: number;
  onCreated: () => void;
}

export default function ClassAuthorDialog({
  open, onOpenChange, existingKeys, nextSortOrder, onCreated,
}: Props) {
  const [label, setLabel] = useState('');
  const [key, setKey] = useState('');
  const [icon, setIcon] = useState('🛡️');
  const [description, setDescription] = useState('');
  const [saving, setSaving] = useState(false);

  const errors = useMemo(() => {
    const errs = validateNewClassKey(key, existingKeys);
    if (!label.trim()) errs.push('Label is required.');
    return errs;
  }, [key, label, existingKeys]);

  const create = async () => {
    if (errors.length) { toast.error(errors[0]); return; }
    setSaving(true);

    const { error: classError } = await supabase.from('classes').insert({
      class_key: key,
      label: label.trim(),
      icon,
      color: '',
      description: description.trim(),
      status: 'draft',
      is_pre_class: false,
      is_selectable: false,
      sort_order: nextSortOrder,
      base_hp: NEW_CLASS_DEFAULTS.base_hp,
      base_ac: NEW_CLASS_DEFAULTS.base_ac,
      crit_range: NEW_CLASS_DEFAULTS.crit_range,
      level_bonuses: NEW_CLASS_DEFAULTS.level_bonuses as never,
      weapon_proficiencies: NEW_CLASS_DEFAULTS.weapon_proficiencies,
      restrictions: {} as never,
    });
    if (classError) { setSaving(false); toast.error(classError.message); return; }

    const { error: roleError } = await supabase.from('class_ability_roles').insert(
      CLASS_ROLE_TEMPLATE.map(r => ({ ...r, class_key: key })),
    );
    setSaving(false);
    if (roleError) { toast.error(`Class created but roles failed: ${roleError.message}`); return; }

    toast.success(`${label} created as a draft with ${CLASS_ROLE_TEMPLATE.length} empty ability slots.`);
    setLabel(''); setKey(''); setDescription('');
    onOpenChange(false);
    onCreated();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="font-display text-sm">New class (draft)</DialogTitle>
        </DialogHeader>

        <div className="space-y-3">
          <div className="grid grid-cols-4 gap-3">
            <div className="col-span-3 space-y-1">
              <Label className="text-[11px]">Label</Label>
              <Input
                value={label}
                onChange={e => {
                  setLabel(e.target.value);
                  if (!key) setKey(e.target.value.toLowerCase().replace(/[^a-z0-9]+/g, '_'));
                }}
                className="h-8 text-xs"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-[11px]">Icon</Label>
              <Input value={icon} onChange={e => setIcon(e.target.value)} className="h-8 text-xs" />
            </div>
            <div className="col-span-4 space-y-1">
              <Label className="text-[11px]">Class key</Label>
              <Input
                value={key}
                onChange={e => setKey(e.target.value.toLowerCase().replace(/[^a-z0-9_]+/g, '_'))}
                className="h-8 text-xs font-mono"
              />
            </div>
          </div>
          <div className="space-y-1">
            <Label className="text-[11px]">Description</Label>
            <Textarea value={description} rows={2} onChange={e => setDescription(e.target.value)} className="text-xs" />
          </div>
          <p className="text-[10px] text-muted-foreground">
            Created as a draft with neutral baselines (HP {NEW_CLASS_DEFAULTS.base_hp}, AC {NEW_CLASS_DEFAULTS.base_ac})
            and the standard role ladder. Tune it here, author its abilities, then publish.
          </p>
          {errors.map(err => (
            <p key={err} className="text-xs text-destructive flex items-start gap-1.5">
              <AlertTriangle className="w-3.5 h-3.5 mt-px shrink-0" /> {err}
            </p>
          ))}
        </div>

        <DialogFooter>
          <Button size="sm" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button size="sm" onClick={create} disabled={saving || errors.length > 0}>
            {saving && <Loader2 className="w-3 h-3 mr-1 animate-spin" />}Create class
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
