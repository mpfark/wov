import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { Plus, Save, Pencil, Trash2 } from 'lucide-react';
import { useAreaTypes } from '@/hooks/useAreaTypes';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export default function AreaTypeDialog({ open, onOpenChange }: Props) {
  const { areaTypes, refetch } = useAreaTypes();
  const [editingType, setEditingType] = useState<string | null>(null);
  const [typeForm, setTypeForm] = useState({ name: '', emoji: '📍' });
  const [saving, setSaving] = useState(false);

  const openCreate = () => {
    setEditingType(null);
    setTypeForm({ name: '', emoji: '📍' });
  };

  const openEdit = (t: { name: string; emoji: string }) => {
    setEditingType(t.name);
    setTypeForm({ name: t.name, emoji: t.emoji });
  };

  const saveType = async () => {
    if (!typeForm.name.trim()) return toast.error('Name is required');
    setSaving(true);
    if (editingType) {
      if (editingType !== typeForm.name.trim()) {
        const { error: insertErr } = await supabase.from('area_types').insert({ name: typeForm.name.trim().toLowerCase(), emoji: typeForm.emoji } as any);
        if (insertErr) { toast.error(insertErr.message); setSaving(false); return; }
        await supabase.from('areas').update({ area_type: typeForm.name.trim().toLowerCase() } as any).eq('area_type', editingType);
        await supabase.from('area_types').delete().eq('name', editingType);
      } else {
        const { error } = await supabase.from('area_types').update({ emoji: typeForm.emoji } as any).eq('name', editingType);
        if (error) { toast.error(error.message); setSaving(false); return; }
      }
      toast.success('Type updated');
    } else {
      const { error } = await supabase.from('area_types').insert({ name: typeForm.name.trim().toLowerCase(), emoji: typeForm.emoji } as any);
      if (error) { toast.error(error.message); setSaving(false); return; }
      toast.success('Type created');
    }
    setSaving(false);
    openCreate();
    refetch();
  };

  const deleteType = async (name: string) => {
    if (!window.confirm(`Delete type "${name}"?`)) return;
    const { error } = await supabase.from('area_types').delete().eq('name', name);
    if (error) return toast.error(error.message);
    toast.success('Type deleted');
    refetch();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-card border-border max-w-sm">
        <DialogHeader>
          <DialogTitle className="font-display text-primary text-sm">Manage Area Types</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1 max-h-48 overflow-y-auto">
            {areaTypes.map(t => (
              <div key={t.name} className="flex items-center gap-2 p-1.5 rounded border border-border bg-background/40">
                <span className="text-sm">{t.emoji}</span>
                <span className="text-xs flex-1 capitalize">{t.name}</span>
                <Button variant="ghost" size="sm" onClick={() => openEdit(t)} className="h-5 w-5 p-0">
                  <Pencil className="w-2.5 h-2.5" />
                </Button>
                <Button variant="ghost" size="sm" onClick={() => deleteType(t.name)} className="h-5 w-5 p-0 text-destructive">
                  <Trash2 className="w-2.5 h-2.5" />
                </Button>
              </div>
            ))}
          </div>
          <div className="border-t border-border pt-3 space-y-2">
            <span className="font-display text-xs text-muted-foreground">{editingType ? 'Edit Type' : 'New Type'}</span>
            <div className="flex gap-2">
              <Input placeholder="Emoji" value={typeForm.emoji} onChange={e => setTypeForm(f => ({ ...f, emoji: e.target.value }))} className="h-8 text-xs w-16" maxLength={4} />
              <Input placeholder="Type name" value={typeForm.name} onChange={e => setTypeForm(f => ({ ...f, name: e.target.value }))} className="h-8 text-xs flex-1" />
            </div>
            <div className="flex gap-2">
              <Button onClick={saveType} disabled={saving} className="font-display text-xs flex-1">
                <Save className="w-3 h-3 mr-1" /> {editingType ? 'Save' : 'Add Type'}
              </Button>
              {editingType && (
                <Button variant="outline" onClick={openCreate} className="font-display text-xs">
                  <Plus className="w-3 h-3 mr-1" /> New
                </Button>
              )}
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
