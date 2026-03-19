import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { X } from 'lucide-react';

interface Props {
  selectedNodeIds: Set<string>;
  regions: Array<{ id: string; name: string }>;
  areas: Array<{ id: string; name: string; region_id: string }>;
  onClose: () => void;
  onSaved: () => void;
}

export default function BatchNodeEditPanel({ selectedNodeIds, regions, areas, onClose, onSaved }: Props) {
  const [areaId, setAreaId] = useState<string>('');
  const [regionId, setRegionId] = useState<string>('');
  const [saving, setSaving] = useState(false);

  const count = selectedNodeIds.size;

  const applyChanges = async () => {
    if (!areaId && !regionId) {
      toast.error('Select at least one property to change');
      return;
    }
    setSaving(true);
    try {
      const updates: Record<string, unknown> = {};
      if (areaId === '__clear__') updates.area_id = null;
      else if (areaId) updates.area_id = areaId;
      if (regionId) updates.region_id = regionId;

      const ids = Array.from(selectedNodeIds);
      const { error } = await supabase
        .from('nodes')
        .update(updates)
        .in('id', ids);

      if (error) throw error;
      toast.success(`Updated ${count} node(s)`);
      onSaved();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setSaving(false);
    }
  };

  const filteredAreas = regionId
    ? areas.filter(a => a.region_id === regionId)
    : areas;

  return (
    <div className="h-full flex flex-col bg-card border-l border-border">
      <div className="flex items-center justify-between px-4 py-3 border-b border-border">
        <h3 className="font-display text-sm text-primary">
          Batch Edit · {count} node{count !== 1 ? 's' : ''}
        </h3>
        <Button variant="ghost" size="icon" className="h-6 w-6" onClick={onClose}>
          <X className="w-4 h-4" />
        </Button>
      </div>

      <div className="flex-1 p-4 space-y-4 overflow-auto">
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-muted-foreground">Region</label>
          <Select value={regionId} onValueChange={setRegionId}>
            <SelectTrigger className="h-8 text-xs">
              <SelectValue placeholder="Don't change" />
            </SelectTrigger>
            <SelectContent>
              {regions.map(r => (
                <SelectItem key={r.id} value={r.id} className="text-xs">{r.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1.5">
          <label className="text-xs font-medium text-muted-foreground">Area</label>
          <Select value={areaId} onValueChange={setAreaId}>
            <SelectTrigger className="h-8 text-xs">
              <SelectValue placeholder="Don't change" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__clear__" className="text-xs italic text-muted-foreground">Clear area</SelectItem>
              {filteredAreas.map(a => (
                <SelectItem key={a.id} value={a.id} className="text-xs">{a.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <Button
          size="sm"
          className="w-full text-xs"
          onClick={applyChanges}
          disabled={saving || (!areaId && !regionId)}
        >
          {saving ? 'Applying…' : `Apply to ${count} node${count !== 1 ? 's' : ''}`}
        </Button>
      </div>
    </div>
  );
}
