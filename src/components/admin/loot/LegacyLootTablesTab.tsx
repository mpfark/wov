import { useState, useEffect, useMemo, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Slider } from '@/components/ui/slider';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { Plus, Trash2, Save, X, Package } from 'lucide-react';
import ItemPicker from '../ItemPicker';
import { createLatestRequestGuard, createSubmissionFence } from '../admin-operation-guards';
import { createLootRequestTracker, MAX_LOOT_ENTRIES, submitLootMutation } from './loot-table-admin';

interface LootTable {
  id: string;
  name: string;
  created_at: string;
}

interface LootEntry {
  id: string;
  loot_table_id: string;
  item_id: string;
  weight: number;
}

interface ItemOption {
  id: string;
  name: string;
  rarity: string;
  level: number;
}

export default function LegacyLootTablesTab() {
  const [tables, setTables] = useState<LootTable[]>([]);
  const [items, setItems] = useState<ItemOption[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [isNew, setIsNew] = useState(false);
  const [tableName, setTableName] = useState('');
  const [entries, setEntries] = useState<LootEntry[]>([]);
  const [filter, setFilter] = useState('');
  const [loading, setLoading] = useState(false);
  const [creatureCounts, setCreatureCounts] = useState<Map<string, number>>(new Map());
  const [entriesByTable,setEntriesByTable]=useState<Map<string,LootEntry[]>>(new Map());
  const [creaturesByTable,setCreaturesByTable]=useState<Map<string,string[]>>(new Map());
  const mutationFence=useRef(createSubmissionFence());const requestTracker=useRef(createLootRequestTracker());const sessionGuard=useRef(createLatestRequestGuard());const editorGuard=useRef(createLatestRequestGuard());

  const loadData = async () => {
    const { fetchAllRows } = await import('@/lib/supabase-paginate');
    const request=sessionGuard.current.begin();
    const [t, items, c, allEntries] = await Promise.all([
      supabase.from('loot_tables').select('*').order('name'),
      fetchAllRows<ItemOption>((from, to) =>
        supabase.from('items').select('id, name, rarity, level').order('name').range(from, to)
      ),
      supabase.from('creatures').select('id, loot_table_id'),
      supabase.from('loot_table_entries').select('*').order('id'),
    ]);
    if(!sessionGuard.current.isCurrent(request))return;
    if (t.data) setTables(t.data as LootTable[]);
    setItems(items);
    if (c.data) {
      const counts = new Map<string, number>();
      const refs=new Map<string,string[]>();
      for (const cr of c.data) {
        if (cr.loot_table_id){counts.set(cr.loot_table_id,(counts.get(cr.loot_table_id)||0)+1);refs.set(cr.loot_table_id,[...(refs.get(cr.loot_table_id)||[]),cr.id].sort());}
      }
      setCreatureCounts(counts);
      setCreaturesByTable(refs);
    }
    const grouped=new Map<string,LootEntry[]>();for(const e of(allEntries.data||[])as LootEntry[])grouped.set(e.loot_table_id,[...(grouped.get(e.loot_table_id)||[]),e]);setEntriesByTable(grouped);
  };

  useEffect(() => { loadData();return()=>{mutationFence.current.invalidate();sessionGuard.current.invalidate();}; }, []);

  const resetMutationSession=()=>{mutationFence.current.invalidate();editorGuard.current.invalidate();requestTracker.current=createLootRequestTracker();};
  const openNew = () => {resetMutationSession();setSelectedId(null); setIsNew(true); setTableName(''); setEntries([]); };

  const openEdit = (table: LootTable) => {
    resetMutationSession();
    setSelectedId(table.id); setIsNew(false); setTableName(table.name);
    setEntries(entriesByTable.get(table.id)||[]);
  };

  const closePanel = () => {if(loading)return;resetMutationSession();setSelectedId(null);setIsNew(false);};

  const handleSave = async () => {
    if (!tableName.trim()) return toast.error('Name is required');
    if(entries.length>MAX_LOOT_ENTRIES)return toast.error(`A loot table supports at most ${MAX_LOOT_ENTRIES} entries`);
    const table=tables.find(t=>t.id===selectedId);if(selectedId&&!table)return toast.error('Refresh required: loot table is unavailable');
    const expectedEntries=selectedId?(entriesByTable.get(selectedId)||[]):[];const persistedIds=new Set(expectedEntries.map(e=>e.id));
    const operation=mutationFence.current.tryAcquire();if(operation===false)return;const editorRequest=editorGuard.current.begin();setLoading(true);
    const result=await submitLootMutation({operation:'save',lootTableId:selectedId,expectedTable:table?{id:table.id,name:table.name}:null,expectedEntries:expectedEntries.map(e=>({id:e.id,item_id:e.item_id,weight:e.weight})),expectedCreatureIds:selectedId?(creaturesByTable.get(selectedId)||[]):[],desiredName:tableName,desiredEntries:entries.map(e=>({entry_id:persistedIds.has(e.id)?e.id:null,item_id:e.item_id,weight:e.weight}))},requestTracker.current);
    if(!mutationFence.current.release(operation)||!editorGuard.current.isCurrent(editorRequest))return;setLoading(false);if(!result.ok){toast.error(result.kind==='stale_loot_table_state'?'Save refused: loot table changed; authoritative state refreshed before retrying':`Loot table save refused: ${result.kind}`);if(result.kind==='stale_loot_table_state')await loadData();return;}
    toast.success(result.kind==='created'?'Loot table created':'Loot table updated');setSelectedId(result.loot_table_id);setIsNew(false);await loadData();
    const{data:refreshed}=await supabase.from('loot_table_entries').select('*').eq('loot_table_id',result.loot_table_id).order('id');if(refreshed&&editorGuard.current.isCurrent(editorRequest))setEntries(refreshed as LootEntry[]);
  };

  const handleDelete = async (id: string) => {
    const table=tables.find(t=>t.id===id);if(!table)return toast.error('Refresh required: loot table is unavailable');
    if(!window.confirm(`Delete loot table "${table.name}"? This is allowed only when no creature references it.`))return;
    const operation=mutationFence.current.tryAcquire();if(operation===false)return;const editorRequest=editorGuard.current.begin();setLoading(true);
    const expectedEntries=entriesByTable.get(id)||[];const result=await submitLootMutation({operation:'delete',lootTableId:id,expectedTable:{id:table.id,name:table.name},expectedEntries:expectedEntries.map(e=>({id:e.id,item_id:e.item_id,weight:e.weight})),expectedCreatureIds:creaturesByTable.get(id)||[],desiredName:null,desiredEntries:[]},requestTracker.current);
    if(!mutationFence.current.release(operation)||!editorGuard.current.isCurrent(editorRequest))return;setLoading(false);if(!result.ok){toast.error(result.kind==='table_in_use'?`Cannot delete: ${result.reference_count} creature(s) use this table`:`Loot table deletion refused: ${result.kind}`);if(result.kind==='stale_loot_table_state')await loadData();return;}
    toast.success('Loot table deleted');
    if (selectedId === id) closePanel();
    loadData();
  };

  const addEntry = () => {
    if (items.length === 0) return;
    if(entries.length>=MAX_LOOT_ENTRIES)return toast.error(`Maximum ${MAX_LOOT_ENTRIES} entries`);
    setEntries(prev => [...prev, { id: crypto.randomUUID(), loot_table_id: selectedId || '', item_id: items[0].id, weight: 10 }]);
  };

  const updateEntry = (idx: number, field: 'item_id' | 'weight', value: string | number) => {
    setEntries(prev => prev.map((e, i) => i === idx ? { ...e, [field]: value } : e));
  };

  const removeEntry = (idx: number) => { setEntries(prev => prev.filter((_, i) => i !== idx)); };

  const totalWeight = useMemo(() => entries.reduce((s, e) => s + e.weight, 0), [entries]);
  const filtered = tables.filter(t => t.name.toLowerCase().includes(filter.toLowerCase()));
  const panelOpen = isNew || selectedId !== null;

  return (
    <div className="h-full flex">
      <div className="flex flex-col w-1/2 border-r border-border">
        <div className="flex items-center gap-2 px-4 py-3 border-b border-border shrink-0">
          <Package className="w-4 h-4 text-primary" />
          <h2 className="font-display text-sm text-primary">Legacy Loot Tables</h2>
          <span className="text-xs text-muted-foreground">({tables.length})</span>
          <div className="flex-1" />
          <Input placeholder="Search..." value={filter} onChange={e => setFilter(e.target.value)} className="w-36 h-7 text-xs" />
          <Button size="sm" onClick={openNew} className="font-display text-xs h-7"><Plus className="w-3 h-3 mr-1" /> New</Button>
        </div>
        <ScrollArea className="flex-1">
          <div className="p-3 space-y-1.5">
            {filtered.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-8 italic">No loot tables yet.</p>
            ) : filtered.map(table => (
              <div key={table.id}
                className={`flex items-center justify-between p-2 rounded border transition-colors cursor-pointer ${selectedId === table.id ? 'border-primary bg-primary/10' : 'border-border bg-card/50 hover:bg-card/80'}`}
                onClick={() => {if(!loading)openEdit(table);}}>
                <div className="flex-1 min-w-0">
                  <span className="font-display text-sm">{table.name}</span>
                  <span className="text-[10px] text-muted-foreground ml-2">{entriesByTable.get(table.id)?.length || 0} entries · {creatureCounts.get(table.id) || 0} creatures</span>
                </div>
                <Button size="sm" variant="destructive" disabled={loading} onClick={(e) => { e.stopPropagation(); handleDelete(table.id); }} className="h-7 w-7 p-0 shrink-0 ml-2">
                  <Trash2 className="w-3 h-3" />
                </Button>
              </div>
            ))}
          </div>
        </ScrollArea>
      </div>
      <div className="w-1/2 flex flex-col bg-card/50">
        {panelOpen ? (
          <>
            <div className="flex items-center justify-between px-3 py-2 border-b border-border shrink-0">
              <h2 className="font-display text-sm text-primary text-glow truncate">{selectedId ? `Edit: ${tableName || 'Table'}` : 'New Loot Table'}</h2>
              <Button variant="ghost" size="sm" onClick={closePanel} className="h-6 w-6 p-0"><X className="w-4 h-4" /></Button>
            </div>
            <ScrollArea className="flex-1">
              <div className="p-3 space-y-3">
                <Input placeholder="Table name" value={tableName} onChange={e => setTableName(e.target.value)} className="h-8 text-xs" />
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <p className="font-display text-xs text-primary">Items ({entries.length})</p>
                    <Button size="sm" variant="outline" onClick={addEntry} className="h-6 text-[10px]"><Plus className="w-3 h-3 mr-1" /> Add Item</Button>
                  </div>
                  {entries.length === 0 ? (
                    <p className="text-xs text-muted-foreground italic">No items. Add items to define what can drop.</p>
                  ) : entries.map((entry, idx) => {
                    const pct = totalWeight > 0 ? ((entry.weight / totalWeight) * 100).toFixed(1) : '0.0';
                    return (
                      <div key={entry.id} className="flex items-center gap-2 p-2 bg-background/50 rounded border border-border">
                        <div className="flex-1">
                          <ItemPicker items={items} value={entry.item_id} onChange={v => { if (v) updateEntry(idx, 'item_id', v); }} placeholder="Select item…" className="h-7" />
                        </div>
                        <div className="flex items-center gap-1 w-32 shrink-0">
                          <Slider value={[entry.weight]} onValueChange={([v]) => updateEntry(idx, 'weight', v)} min={1} max={100} step={1} className="flex-1" />
                          <span className="text-[10px] text-muted-foreground w-6 text-right">{entry.weight}</span>
                        </div>
                        <span className="text-[10px] text-primary w-12 text-right font-mono">{pct}%</span>
                        <Button size="sm" variant="ghost" onClick={() => removeEntry(idx)} className="h-6 w-6 p-0 text-destructive"><Trash2 className="w-3 h-3" /></Button>
                      </div>
                    );
                  })}
                  {entries.length > 0 && <div className="text-[10px] text-muted-foreground">Total weight: {totalWeight}. One item is selected per kill using relative weights; duplicate item rows are allowed and add their weights.</div>}
                </div>
                <div className="flex gap-2 pt-2">
                  <Button onClick={handleSave} disabled={loading} className="font-display text-xs"><Save className="w-3 h-3 mr-1" /> {loading?'Saving table and entries…':selectedId?'Save table and entries atomically':'Create table and entries atomically'}</Button>
                  <Button variant="outline" onClick={closePanel} disabled={loading} className="font-display text-xs"><X className="w-3 h-3 mr-1" /> Cancel</Button>
                </div>
              </div>
            </ScrollArea>
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center text-muted-foreground/50 text-sm italic font-display">Select a loot table to edit</div>
        )}
      </div>
    </div>
  );
}
