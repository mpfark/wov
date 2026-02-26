import { useState, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { Plus, Pencil } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';

const HEARTHLANDS_ID = '00000000-0000-0000-0000-000000000001';

interface Region {
  id: string;
  name: string;
  description: string;
  min_level: number;
  max_level: number;
}

interface Props {
  regions: Region[];
  onCreated: () => void;
  isValar: boolean;
  onDelete: (id: string) => void;
  editingRegionId?: string | null;
  onEditDone?: () => void;
}

export default function RegionManager({ regions, onCreated, isValar, onDelete, editingRegionId, onEditDone }: Props) {
  const [createOpen, setCreateOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [editingRegion, setEditingRegion] = useState<Region | null>(null);
  const [form, setForm] = useState({ name: '', description: '', min_level: 1, max_level: 10 });

  // Open edit dialog when editingRegionId changes from parent
  useState(() => {});
  // Use effect to react to editingRegionId prop
  const prevEditId = useRef<string | null>(null);
  if (editingRegionId && editingRegionId !== prevEditId.current) {
    const region = regions.find(r => r.id === editingRegionId);
    if (region) {
      prevEditId.current = editingRegionId;
      // Schedule state updates
      setTimeout(() => {
        setEditingRegion(region);
        setEditOpen(true);
      }, 0);
    }
  }
  if (!editingRegionId && prevEditId.current) {
    prevEditId.current = null;
  }

  const create = async () => {
    if (!form.name) return toast.error('Name required');
    const { data: region, error } = await supabase.from('regions').insert({
      name: form.name,
      description: form.description,
      min_level: form.min_level,
      max_level: form.max_level,
    }).select().single();
    if (error) return toast.error(error.message);

    // Create an initial node in the new region
    if (region) {
      await supabase.from('nodes').insert({
        name: `${form.name} Entrance`,
        description: '',
        region_id: region.id,
        connections: [],
      });
    }

    toast.success('Region created with starting node');
    setForm({ name: '', description: '', min_level: 1, max_level: 10 });
    setCreateOpen(false);
    onCreated();
  };

  const openEdit = (region: Region) => {
    setEditingRegion(region);
    setEditOpen(true);
  };

  const saveEdit = async () => {
    if (!editingRegion) return;
    const { error } = await supabase.from('regions').update({
      name: editingRegion.name,
      description: editingRegion.description,
      min_level: editingRegion.min_level,
      max_level: editingRegion.max_level,
    }).eq('id', editingRegion.id);
    if (error) return toast.error(error.message);
    toast.success('Region updated');
    setEditOpen(false);
    setEditingRegion(null);
    prevEditId.current = null;
    onEditDone?.();
    onCreated();
  };

  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setCreateOpen(true)} className="font-display text-xs">
        <Plus className="w-3 h-3 mr-1" /> New Region
      </Button>

      {/* Create dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="bg-card border-border">
          <DialogHeader>
            <DialogTitle className="font-display text-primary">New Region</DialogTitle>
          </DialogHeader>
          <div className="space-y-2">
            <Input placeholder="Region name" value={form.name}
              onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
            <Textarea placeholder="Description" value={form.description}
              onChange={e => setForm(f => ({ ...f, description: e.target.value }))} />
            <div className="flex gap-2">
              <Input type="number" placeholder="Min level" value={form.min_level}
                onChange={e => setForm(f => ({ ...f, min_level: +e.target.value }))} />
              <Input type="number" placeholder="Max level" value={form.max_level}
                onChange={e => setForm(f => ({ ...f, max_level: +e.target.value }))} />
            </div>
            <Button onClick={create} className="font-display text-xs w-full">
              <Plus className="w-3 h-3 mr-1" /> Create Region
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Edit dialog */}
      <Dialog open={editOpen} onOpenChange={(open) => { setEditOpen(open); if (!open) { prevEditId.current = null; onEditDone?.(); } }}>
        <DialogContent className="bg-card border-border">
          <DialogHeader>
            <DialogTitle className="font-display text-primary">Edit Region</DialogTitle>
          </DialogHeader>
          {editingRegion && (
            <div className="space-y-2">
              <Input placeholder="Region name" value={editingRegion.name}
                onChange={e => setEditingRegion(r => r ? { ...r, name: e.target.value } : r)} />
              <Textarea placeholder="Description" value={editingRegion.description}
                onChange={e => setEditingRegion(r => r ? { ...r, description: e.target.value } : r)} />
              <div className="flex gap-2">
                <Input type="number" placeholder="Min level" value={editingRegion.min_level}
                  onChange={e => setEditingRegion(r => r ? { ...r, min_level: +e.target.value } : r)} />
                <Input type="number" placeholder="Max level" value={editingRegion.max_level}
                  onChange={e => setEditingRegion(r => r ? { ...r, max_level: +e.target.value } : r)} />
              </div>
              <Button onClick={saveEdit} className="font-display text-xs w-full">
                Save Changes
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
