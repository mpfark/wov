import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';
import { Plus, Trash2, Upload, Copy, Image as ImageIcon } from 'lucide-react';
import {
  AdminEntityToolbar,
  AdminEditorHeader,
  AdminFormSection,
  AdminStickyActions,
  AdminEmptyState,
} from './common';
import {
  DOLL_CANVAS,
  SLOT_CONTRACT,
  buildPromptForEntry,
  type DollSlot,
} from '@/features/character/utils/doll-contract';

const DOLL_SLOTS: DollSlot[] = [
  'base_body', 'hair', 'cloak', 'legs', 'boots', 'chest', 'hands', 'off_hand', 'main_hand', 'head',
];

const MATERIALS = ['cloth', 'leather', 'mail', 'plate', 'metal', 'wood', 'magical', 'unique', 'male', 'female'];
const TIERS = ['common', 'uncommon', 'unique'];

interface AppearanceEntryRow {
  id: string;
  slot: string;
  material: string;
  tier: string;
  asset_url: string;
  layer_order: number | null;
  occludes: string[];
  prompt_notes: string;
  is_shared: boolean;
  display_name: string;
  created_at: string;
}

const defaultForm = (): Omit<AppearanceEntryRow, 'id' | 'created_at'> => ({
  slot: 'chest',
  material: 'leather',
  tier: 'common',
  asset_url: '',
  layer_order: null,
  occludes: [],
  prompt_notes: '',
  is_shared: true,
  display_name: '',
});

export default function AppearanceLibrary() {
  const [entries, setEntries] = useState<AppearanceEntryRow[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [isNew, setIsNew] = useState(false);
  const [form, setForm] = useState(defaultForm());
  const [filter, setFilter] = useState('');
  const [slotTab, setSlotTab] = useState<string>('all');
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);

  useEffect(() => { loadEntries(); }, []);

  async function loadEntries() {
    const { data, error } = await supabase
      .from('appearance_entries')
      .select('*')
      .order('slot')
      .order('material')
      .order('tier');
    if (error) return toast.error(error.message);
    setEntries((data ?? []) as AppearanceEntryRow[]);
  }

  function openNew() {
    setSelectedId(null);
    setIsNew(true);
    setForm(defaultForm());
  }

  function openEdit(e: AppearanceEntryRow) {
    setSelectedId(e.id);
    setIsNew(false);
    setForm({
      slot: e.slot,
      material: e.material,
      tier: e.tier,
      asset_url: e.asset_url,
      layer_order: e.layer_order,
      occludes: e.occludes ?? [],
      prompt_notes: e.prompt_notes ?? '',
      is_shared: e.is_shared,
      display_name: e.display_name ?? '',
    });
  }

  function closePanel() {
    setSelectedId(null);
    setIsNew(false);
  }

  async function handleUpload(file: File) {
    if (!file.type.startsWith('image/png')) {
      return toast.error('Asset must be a PNG with transparent background');
    }
    setUploading(true);
    try {
      const path = `${form.slot}/${form.material}-${form.tier}-${Date.now()}.png`;
      const { error: upErr } = await supabase.storage
        .from('paper-doll-assets')
        .upload(path, file, { contentType: 'image/png', upsert: false });
      if (upErr) throw upErr;
      const { data: pub } = supabase.storage.from('paper-doll-assets').getPublicUrl(path);
      setForm((f) => ({ ...f, asset_url: pub.publicUrl }));
      toast.success('Asset uploaded');
    } catch (e: any) {
      toast.error(e.message ?? 'Upload failed');
    } finally {
      setUploading(false);
    }
  }

  async function handleSave() {
    if (!form.asset_url) return toast.error('Upload an asset image first');
    setLoading(true);
    const payload = {
      slot: form.slot,
      material: form.material,
      tier: form.tier,
      asset_url: form.asset_url,
      layer_order: form.layer_order,
      occludes: form.occludes,
      prompt_notes: form.prompt_notes,
      is_shared: form.is_shared,
      display_name: form.display_name,
    };
    let savedId = selectedId;
    if (selectedId) {
      const { error } = await supabase.from('appearance_entries').update(payload).eq('id', selectedId);
      if (error) { toast.error(error.message); setLoading(false); return; }
      toast.success('Entry updated');
    } else {
      const { data, error } = await supabase.from('appearance_entries').insert(payload).select().single();
      if (error) { toast.error(error.message); setLoading(false); return; }
      toast.success('Entry created');
      if (data) { savedId = data.id; setSelectedId(data.id); setIsNew(false); }
    }
    setLoading(false);
    await loadEntries();
    if (savedId) {
      const next = entries.find((e) => e.id === savedId);
      if (next) openEdit(next);
    }
  }

  async function handleDelete(id: string) {
    const { error } = await supabase.from('appearance_entries').delete().eq('id', id);
    if (error) return toast.error(error.message);
    toast.success('Entry deleted');
    if (selectedId === id) closePanel();
    loadEntries();
  }

  function copyPrompt() {
    const prompt = buildPromptForEntry(form.slot as DollSlot, form.material, form.tier, form.prompt_notes);
    navigator.clipboard.writeText(prompt);
    toast.success('Prompt copied to clipboard');
  }

  const filtered = useMemo(() => {
    return entries.filter((e) => {
      if (slotTab !== 'all' && e.slot !== slotTab) return false;
      if (filter) {
        const f = filter.toLowerCase();
        return (
          e.display_name.toLowerCase().includes(f) ||
          e.material.toLowerCase().includes(f) ||
          e.tier.toLowerCase().includes(f)
        );
      }
      return true;
    });
  }, [entries, slotTab, filter]);

  return (
    <div className="flex h-full">
      {/* Left: list */}
      <div className="w-[380px] border-r border-border flex flex-col">
        <AdminEntityToolbar
          search={filter}
          onSearchChange={setFilter}
          onNew={openNew}
          newLabel="New Entry"
          searchPlaceholder="Filter by name / material / tier"
        />
        <div className="px-3 pb-2 flex flex-wrap gap-1">
          <Button size="sm" variant={slotTab === 'all' ? 'default' : 'outline'} className="h-6 text-[10px]" onClick={() => setSlotTab('all')}>All</Button>
          {DOLL_SLOTS.map((s) => (
            <Button key={s} size="sm" variant={slotTab === s ? 'default' : 'outline'} className="h-6 text-[10px]" onClick={() => setSlotTab(s)}>{s}</Button>
          ))}
        </div>
        <ScrollArea className="flex-1">
          {filtered.length === 0 ? (
            <AdminEmptyState
              icon={ImageIcon}
              title="No entries yet"
              description="Create the first appearance entry to start building the library."
            />
          ) : (
            <ul className="p-2 space-y-1">
              {filtered.map((e) => (
                <li key={e.id}>
                  <button
                    onClick={() => openEdit(e)}
                    className={`w-full flex items-center gap-2 p-2 rounded border text-left transition ${
                      selectedId === e.id ? 'border-primary bg-primary/10' : 'border-border hover:bg-muted/40'
                    }`}
                  >
                    <div className="w-10 h-14 shrink-0 rounded border border-border bg-muted/30 overflow-hidden">
                      {e.asset_url && (
                        <img src={e.asset_url} alt="" className="w-full h-full object-contain" loading="lazy" />
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="font-display text-xs truncate">
                        {e.display_name || `${e.material} ${e.slot}`}
                      </div>
                      <div className="flex flex-wrap gap-1 mt-0.5">
                        <Badge variant="outline" className="text-[9px] h-4 px-1">{e.slot}</Badge>
                        <Badge variant="outline" className="text-[9px] h-4 px-1">{e.material}</Badge>
                        <Badge variant="outline" className="text-[9px] h-4 px-1">{e.tier}</Badge>
                        {!e.is_shared && <Badge className="text-[9px] h-4 px-1 bg-primary/20 text-primary border-primary/40">unique</Badge>}
                      </div>
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </ScrollArea>
      </div>

      {/* Right: editor */}
      <div className="flex-1 flex flex-col">
        {!selectedId && !isNew ? (
          <AdminEmptyState
            icon={ImageIcon}
            title="Select or create an entry"
            description="Each entry is a reusable visual layer that one or many items can map to."
          />
        ) : (
          <>
            <AdminEditorHeader
              title={isNew ? 'New Appearance Entry' : form.display_name || `${form.material} ${form.slot}`}
              onClose={closePanel}
            />
            <ScrollArea className="flex-1">
              <div className="p-4 space-y-4 max-w-3xl">
                <div className="grid grid-cols-2 gap-4">
                  {/* Preview */}
                  <div>
                    <Label className="text-xs">Preview</Label>
                    <div
                      className="mt-1 mx-auto rounded border border-border bg-gradient-to-b from-muted/20 to-background/40 overflow-hidden flex items-center justify-center"
                      style={{ width: DOLL_CANVAS.width, height: DOLL_CANVAS.height }}
                    >
                      {form.asset_url ? (
                        <img src={form.asset_url} alt="Preview" className="w-full h-full object-contain" />
                      ) : (
                        <span className="text-xs text-muted-foreground italic">No asset</span>
                      )}
                    </div>
                  </div>

                  {/* Upload + meta */}
                  <div className="space-y-3">
                    <AdminFormSection title="Asset">
                      <div className="space-y-2">
                        <input
                          id="asset-upload"
                          type="file"
                          accept="image/png"
                          className="hidden"
                          onChange={(e) => {
                            const f = e.target.files?.[0];
                            if (f) handleUpload(f);
                          }}
                        />
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => document.getElementById('asset-upload')?.click()}
                          disabled={uploading}
                          className="w-full"
                        >
                          <Upload className="w-3 h-3 mr-1" />
                          {uploading ? 'Uploading…' : 'Upload PNG (transparent, 512×768)'}
                        </Button>
                        {form.asset_url && (
                          <Input
                            value={form.asset_url}
                            onChange={(e) => setForm({ ...form, asset_url: e.target.value })}
                            className="text-[10px] font-mono"
                          />
                        )}
                      </div>
                    </AdminFormSection>
                  </div>
                </div>

                <AdminFormSection title="Classification">
                  <div className="grid grid-cols-3 gap-2">
                    <div>
                      <Label className="text-xs">Slot</Label>
                      <Select value={form.slot} onValueChange={(v) => setForm({ ...form, slot: v })}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {DOLL_SLOTS.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <Label className="text-xs">Material</Label>
                      <Select value={form.material} onValueChange={(v) => setForm({ ...form, material: v })}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {MATERIALS.map((m) => <SelectItem key={m} value={m}>{m}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <Label className="text-xs">Tier</Label>
                      <Select value={form.tier} onValueChange={(v) => setForm({ ...form, tier: v })}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {TIERS.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  <div className="mt-2">
                    <Label className="text-xs">Display Name (optional)</Label>
                    <Input value={form.display_name} onChange={(e) => setForm({ ...form, display_name: e.target.value })} placeholder="e.g. Iron Plate Chest" />
                  </div>
                  <div className="flex items-center gap-2 mt-2">
                    <Switch checked={form.is_shared} onCheckedChange={(v) => setForm({ ...form, is_shared: v })} id="is-shared" />
                    <Label htmlFor="is-shared" className="text-xs">Shared (pool entry — multiple items may use this)</Label>
                  </div>
                </AdminFormSection>

                <AdminFormSection title="Layering">
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <Label className="text-xs">Layer Order Override</Label>
                      <Input
                        type="number"
                        value={form.layer_order ?? ''}
                        onChange={(e) => setForm({ ...form, layer_order: e.target.value ? Number(e.target.value) : null })}
                        placeholder={`default: ${SLOT_CONTRACT[form.slot as DollSlot]?.z ?? '—'}`}
                      />
                    </div>
                    <div>
                      <Label className="text-xs">Occludes (comma-separated doll slots)</Label>
                      <Input
                        value={(form.occludes ?? []).join(', ')}
                        onChange={(e) => setForm({ ...form, occludes: e.target.value.split(',').map((s) => s.trim()).filter(Boolean) })}
                        placeholder="e.g. hair, base_torso"
                      />
                    </div>
                  </div>
                </AdminFormSection>

                <AdminFormSection title="AI Generation Prompt">
                  <Textarea
                    value={form.prompt_notes}
                    onChange={(e) => setForm({ ...form, prompt_notes: e.target.value })}
                    placeholder="Custom notes for AI image tools (style direction, color hints, motifs)"
                    rows={3}
                  />
                  <Button variant="outline" size="sm" onClick={copyPrompt} className="mt-2">
                    <Copy className="w-3 h-3 mr-1" /> Copy full prompt (with contract preamble)
                  </Button>
                </AdminFormSection>
              </div>
            </ScrollArea>

            <AdminStickyActions>
              {selectedId && (
                <Button variant="destructive" size="sm" onClick={() => handleDelete(selectedId)}>
                  <Trash2 className="w-3 h-3 mr-1" /> Delete
                </Button>
              )}
              <div className="flex-1" />
              <Button onClick={handleSave} disabled={loading}>
                {loading ? 'Saving…' : selectedId ? 'Save Changes' : 'Create Entry'}
              </Button>
            </AdminStickyActions>
          </>
        )}
      </div>
    </div>
  );
}
