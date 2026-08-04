/**
 * AbilityAssignPicker — the ONE path that assigns an existing base ability to a
 * class slot.
 *
 * It never creates an `abilities` row: it inserts a `class_ability_assignments`
 * row pointing at a base ability that already exists in the library. Authoring a
 * brand-new base ability is a separate, explicitly labelled action that opens
 * `BaseAbilityCreateDialog` first and only then offers assignment.
 */
import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Loader2, Plus, Search } from 'lucide-react';
import BaseAbilityCreateDialog from '../ability/BaseAbilityCreateDialog';

interface LibraryRow {
  id: string;
  ability_key: string;
  label: string;
  description: string;
  mechanic_key: string;
  ability_type: string;
  status: string;
  cp_cost: number;
}

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  classKey: string;
  classLabel: string;
  roleId: string;
  roleName: string;
  roleSlot: number;
  roleUnlockLevel: number;
  /** Ability ids already assigned to this slot — not offered again. */
  assignedAbilityIds: string[];
  /** True when the slot already has a default, so this becomes an alternative. */
  slotHasDefault: boolean;
  onAssigned: () => void;
}

export default function AbilityAssignPicker({
  open, onOpenChange, classKey, classLabel, roleId, roleName, roleSlot,
  roleUnlockLevel, assignedAbilityIds, slotHasDefault, onAssigned,
}: Props) {
  const [library, setLibrary] = useState<LibraryRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<string | null>(null);
  const [unlockLevel, setUnlockLevel] = useState(roleUnlockLevel);
  const [saving, setSaving] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);

  const loadLibrary = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('abilities')
      .select('id, ability_key, label, description, mechanic_key, ability_type, status, cp_cost')
      .order('label');
    setLoading(false);
    if (error) { toast.error(error.message); return; }
    setLibrary((data ?? []) as LibraryRow[]);
  };

  useEffect(() => {
    if (!open) return;
    setQuery(''); setSelected(null); setUnlockLevel(roleUnlockLevel);
    loadLibrary();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, roleUnlockLevel]);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    return library
      .filter(a => !assignedAbilityIds.includes(a.id))
      .filter(a => !q
        || a.label.toLowerCase().includes(q)
        || a.ability_key.includes(q)
        || a.mechanic_key.includes(q));
  }, [library, query, assignedAbilityIds]);

  const assign = async (abilityId: string, level = unlockLevel) => {
    setSaving(true);
    const { error } = await supabase.from('class_ability_assignments').insert({
      class_key: classKey,
      role_id: roleId,
      ability_id: abilityId,
      unlock_level: level,
      is_default: !slotHasDefault,
      status: 'draft',
    });
    setSaving(false);
    if (error) { toast.error(error.message); return; }
    toast.success(
      `Assigned to ${classLabel} · slot ${roleSlot} ${roleName} as a draft `
      + `${slotHasDefault ? 'alternative' : 'default'}.`,
    );
    onOpenChange(false);
    onAssigned();
  };

  return (
    <>
      <BaseAbilityCreateDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreated={async (abilityId) => {
          setCreateOpen(false);
          await loadLibrary();
          setSelected(abilityId);
          toast.info('Base ability created in the library — assign it below when ready.');
        }}
      />

      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="font-display text-sm">
              Assign ability — {classLabel} · slot {roleSlot} {roleName}
            </DialogTitle>
            <DialogDescription className="text-[11px]">
              Pick an existing base ability from the library. Assigning never creates a new
              base definition; it only records that {classLabel} uses this ability
              {slotHasDefault ? ' as a selectable alternative.' : ' as the slot default.'}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <div className="flex items-end gap-2">
              <div className="flex-1 space-y-1">
                <Label className="text-[11px]">Search the base library</Label>
                <div className="relative">
                  <Search className="w-3.5 h-3.5 absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    value={query} onChange={e => setQuery(e.target.value)}
                    placeholder="name, ability key or mechanic"
                    className="h-8 text-xs pl-7"
                  />
                </div>
              </div>
              <div className="w-28 space-y-1">
                <Label className="text-[11px]">Unlock level</Label>
                <Input
                  type="number" value={unlockLevel}
                  onChange={e => setUnlockLevel(Number(e.target.value))}
                  className="h-8 text-xs"
                />
              </div>
            </div>

            <div className="max-h-72 overflow-y-auto rounded border border-border/60 divide-y divide-border/40">
              {loading && (
                <p className="p-3 text-xs text-muted-foreground flex items-center gap-2">
                  <Loader2 className="w-3 h-3 animate-spin" /> Loading library…
                </p>
              )}
              {!loading && results.length === 0 && (
                <p className="p-3 text-xs text-muted-foreground">
                  No unassigned base ability matches that search.
                </p>
              )}
              {results.map(a => (
                <button
                  key={a.id}
                  onClick={() => setSelected(a.id)}
                  className={`w-full text-left px-2.5 py-2 text-xs transition-colors ${
                    selected === a.id ? 'bg-primary/10' : 'hover:bg-muted/40'
                  }`}
                >
                  <span className="font-medium">{a.label}</span>
                  <span className="ml-2 text-[10px] font-mono text-muted-foreground">{a.ability_key}</span>
                  <Badge variant="outline" className="ml-2 text-[9px]">{a.ability_type}</Badge>
                  <Badge variant="outline" className="ml-1 text-[9px]">{a.cp_cost} CP</Badge>
                  {a.status !== 'active' && (
                    <Badge variant="secondary" className="ml-1 text-[9px] capitalize">{a.status}</Badge>
                  )}
                  <p className="text-[10px] text-muted-foreground line-clamp-1">{a.description}</p>
                </button>
              ))}
            </div>
          </div>

          <DialogFooter className="sm:justify-between">
            <Button size="sm" variant="ghost" className="text-[11px]" onClick={() => setCreateOpen(true)}>
              <Plus className="w-3 h-3 mr-1" /> Create new base ability
            </Button>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
              <Button size="sm" disabled={!selected || saving} onClick={() => selected && assign(selected)}>
                {saving && <Loader2 className="w-3 h-3 mr-1 animate-spin" />}
                Assign {slotHasDefault ? 'as alternative' : 'as default'}
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
