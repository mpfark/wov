import { useState, useMemo } from 'react';
import { Check, ChevronsUpDown, MapPin } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { Button } from '@/components/ui/button';

interface NodePickerNode {
  id: string;
  name: string;
  region_id: string;
  area_id?: string | null;
  is_inn?: boolean;
  is_vendor?: boolean;
  is_blacksmith?: boolean;
  is_teleport?: boolean;
  is_trainer?: boolean;
}

interface NodePickerRegion {
  id: string;
  name: string;
}

interface NodePickerArea {
  id: string;
  name: string;
}

interface NodePickerProps {
  nodes: NodePickerNode[];
  regions: NodePickerRegion[];
  areas?: NodePickerArea[];
  value: string | null;
  onChange: (value: string | null) => void;
  placeholder?: string;
  allowNone?: boolean;
  /** Exclude these node IDs from the list */
  excludeIds?: string[];
  className?: string;
}

function getFlags(node: NodePickerNode): string {
  const flags: string[] = [];
  if (node.is_inn) flags.push('🏨');
  if (node.is_vendor) flags.push('🛒');
  if (node.is_blacksmith) flags.push('⚒️');
  if (node.is_teleport) flags.push('✨');
  if (node.is_trainer) flags.push('⚔️');
  return flags.join('');
}

function getNodeLabel(node: NodePickerNode, areas: NodePickerArea[]): string {
  const name = node.name?.trim()
    ? node.name
    : (node.area_id ? areas.find(a => a.id === node.area_id)?.name : null) || `#${node.id.slice(0, 6)}`;
  const flags = getFlags(node);
  return flags ? `${name} ${flags}` : name;
}

export default function NodePicker({
  nodes, regions, areas = [], value, onChange,
  placeholder = 'Select node…', allowNone = false, excludeIds = [], className,
}: NodePickerProps) {
  const [open, setOpen] = useState(false);

  const filteredNodes = useMemo(
    () => nodes.filter(n => !excludeIds.includes(n.id)),
    [nodes, excludeIds],
  );

  const regionMap = useMemo(
    () => Object.fromEntries(regions.map(r => [r.id, r.name])),
    [regions],
  );

  const grouped = useMemo(() => {
    const groups: Record<string, { regionName: string; nodes: NodePickerNode[] }> = {};
    for (const node of filteredNodes) {
      const rid = node.region_id;
      if (!groups[rid]) groups[rid] = { regionName: regionMap[rid] || 'Unknown', nodes: [] };
      groups[rid].nodes.push(node);
    }
    // Sort groups alphabetically
    return Object.entries(groups).sort((a, b) => a[1].regionName.localeCompare(b[1].regionName));
  }, [filteredNodes, regionMap]);

  const selectedNode = value ? nodes.find(n => n.id === value) : null;
  const displayLabel = selectedNode ? getNodeLabel(selectedNode, areas) : (allowNone && !value ? 'Unassigned' : placeholder);

  // Build search keywords per node
  const getSearchKeywords = (node: NodePickerNode) => {
    const parts = [node.name, regionMap[node.region_id] || ''];
    if (node.area_id) {
      const area = areas.find(a => a.id === node.area_id);
      if (area) parts.push(area.name);
    }
    return parts.join(' ').toLowerCase();
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" role="combobox" aria-expanded={open}
          className={cn('h-8 justify-between text-xs font-normal w-full', className)}>
          <span className="truncate flex items-center gap-1">
            <MapPin className="w-3 h-3 shrink-0 text-muted-foreground" />
            {displayLabel}
          </span>
          <ChevronsUpDown className="ml-1 h-3 w-3 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[320px] p-0 z-50" align="start">
        <Command filter={(value, search) => {
          // value is the CommandItem's value which we set to node id
          const node = nodes.find(n => n.id === value);
          if (!node) return value === '__none__' && 'unassigned'.includes(search.toLowerCase()) ? 1 : 0;
          return getSearchKeywords(node).includes(search.toLowerCase()) ? 1 : 0;
        }}>
          <CommandInput placeholder="Search nodes…" className="h-9 text-xs" />
          <CommandList>
            <CommandEmpty className="py-4 text-xs">No nodes found.</CommandEmpty>
            {allowNone && (
              <CommandGroup>
                <CommandItem
                  value="__none__"
                  onSelect={() => { onChange(null); setOpen(false); }}
                  className="text-xs text-muted-foreground"
                >
                  <Check className={cn('mr-2 h-3 w-3', !value ? 'opacity-100' : 'opacity-0')} />
                  Unassigned
                </CommandItem>
              </CommandGroup>
            )}
            {grouped.map(([regionId, { regionName, nodes: regionNodes }]) => (
              <CommandGroup key={regionId} heading={regionName}>
                {regionNodes.map(node => (
                  <CommandItem
                    key={node.id}
                    value={node.id}
                    onSelect={() => { onChange(node.id); setOpen(false); }}
                    className="text-xs"
                  >
                    <Check className={cn('mr-2 h-3 w-3', value === node.id ? 'opacity-100' : 'opacity-0')} />
                    {getNodeLabel(node, areas)}
                  </CommandItem>
                ))}
              </CommandGroup>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
