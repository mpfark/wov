import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { X, ChevronsUpDown, Check } from 'lucide-react';
import { cn } from '@/lib/utils';

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
  const [regionOpen, setRegionOpen] = useState(false);
  const [areaOpen, setAreaOpen] = useState(false);

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

  const groupedAreas = useMemo(() => {
    const groups: Record<string, { regionName: string; areas: Array<{ id: string; name: string; region_id: string }> }> = {};
    for (const a of filteredAreas) {
      const rid = a.region_id;
      if (!groups[rid]) {
        const reg = regions.find(r => r.id === rid);
        groups[rid] = { regionName: reg?.name || 'Unknown', areas: [] };
      }
      groups[rid].areas.push(a);
    }
    return Object.entries(groups).sort((a, b) => a[1].regionName.localeCompare(b[1].regionName));
  }, [filteredAreas, regions]);

  const selectedRegionName = regions.find(r => r.id === regionId)?.name;
  const selectedAreaName = areaId === '__clear__' ? 'Clear area' : areas.find(a => a.id === areaId)?.name;

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
        {/* Region picker */}
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-muted-foreground">Region</label>
          <Popover open={regionOpen} onOpenChange={setRegionOpen}>
            <PopoverTrigger asChild>
              <Button variant="outline" role="combobox" className="w-full h-8 text-xs justify-between">
                {selectedRegionName || <span className="text-muted-foreground">Don't change</span>}
                <ChevronsUpDown className="ml-1 h-3 w-3 shrink-0 opacity-50" />
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
              <Command>
                <CommandInput placeholder="Search regions…" className="h-8 text-xs" />
                <CommandList>
                  <CommandEmpty className="text-xs p-2">No regions found.</CommandEmpty>
                  <CommandGroup>
                    {regions.map(r => (
                      <CommandItem
                        key={r.id}
                        value={r.name}
                        onSelect={() => { setRegionId(r.id); setRegionOpen(false); }}
                        className="text-xs"
                      >
                        <Check className={cn('mr-1.5 h-3 w-3', regionId === r.id ? 'opacity-100' : 'opacity-0')} />
                        {r.name}
                      </CommandItem>
                    ))}
                  </CommandGroup>
                </CommandList>
              </Command>
            </PopoverContent>
          </Popover>
        </div>

        {/* Area picker */}
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-muted-foreground">Area</label>
          <Popover open={areaOpen} onOpenChange={setAreaOpen}>
            <PopoverTrigger asChild>
              <Button variant="outline" role="combobox" className="w-full h-8 text-xs justify-between">
                {selectedAreaName || <span className="text-muted-foreground">Don't change</span>}
                <ChevronsUpDown className="ml-1 h-3 w-3 shrink-0 opacity-50" />
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
              <Command>
                <CommandInput placeholder="Search areas…" className="h-8 text-xs" />
                <CommandList>
                  <CommandEmpty className="text-xs p-2">No areas found.</CommandEmpty>
                  <CommandGroup>
                    <CommandItem
                      value="__clear__"
                      onSelect={() => { setAreaId('__clear__'); setAreaOpen(false); }}
                      className="text-xs italic text-muted-foreground"
                    >
                      <Check className={cn('mr-1.5 h-3 w-3', areaId === '__clear__' ? 'opacity-100' : 'opacity-0')} />
                      Clear area
                    </CommandItem>
                  </CommandGroup>
                  {groupedAreas.map(([rId, { regionName, areas: grpAreas }]) => (
                    <CommandGroup key={rId} heading={regionName}>
                      {grpAreas.map(a => (
                        <CommandItem
                          key={a.id}
                          value={a.name}
                          onSelect={() => { setAreaId(a.id); setAreaOpen(false); }}
                          className="text-xs"
                        >
                          <Check className={cn('mr-1.5 h-3 w-3', areaId === a.id ? 'opacity-100' : 'opacity-0')} />
                          {a.name}
                        </CommandItem>
                      ))}
                    </CommandGroup>
                  ))}
                </CommandList>
              </Command>
            </PopoverContent>
          </Popover>
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
