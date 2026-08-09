import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Dna, Plus, Trash2 } from 'lucide-react';
import { toast } from '@/hooks/use-toast';
import { STAT_LABELS } from '@/lib/game-data';
import AdminEntityToolbar from '@/components/admin/common/AdminEntityToolbar';
import AdminEditorHeader from '@/components/admin/common/AdminEditorHeader';
import AdminFormSection from '@/components/admin/common/AdminFormSection';

const STAT_KEYS = ['str', 'dex', 'con', 'int', 'wis', 'cha'] as const;
type StatKey = typeof STAT_KEYS[number];

interface RaceRow {
  race_key: string;
  label: string;
  description: string;
  str: number; dex: number; con: number; int: number; wis: number; cha: number;
  portrait_notes: string;
  is_selectable: boolean;
  status: string;
  sort_order: number;
  admin_notes: string | null;
}

const EMPTY: RaceRow = {
  race_key: '', label: '', description: '',
  str: 0, dex: 0, con: 0, int: 0, wis: 0, cha: 0,
  portrait_notes: '', is_selectable: true, status: 'active', sort_order: 100,
  admin_notes: '',
};

function StatBadge({ value }: { value: number }) {
  const color = value > 0 ? 'text-green-400' : value < 0 ? 'text-red-400' : 'text-muted-foreground';
  return <span className={`font-mono text-xs ${color}`}>{value > 0 ? `+${value}` : value}</span>;
}

export default function RaceManager() {
  const [races, setRaces] = useState<RaceRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState<RaceRow | null>(null);
  const [isNew, setIsNew] = useState(false);
  const [saving, setSaving] = useState(false);

  const load = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('races' as any)
      .select('*')
      .order('sort_order', { ascending: true });
    setLoading(false);
    if (error) {
      toast({ title: 'Could not load races', description: error.message, variant: 'destructive' });
      return;
    }
    setRaces((data ?? []) as unknown as RaceRow[]);
  };

  useEffect(() => { load(); }, []);

  const startNew = () => { setDraft({ ...EMPTY }); setIsNew(true); };
  const startEdit = (row: RaceRow) => { setDraft({ ...row }); setIsNew(false); };

  const save = async () => {
    if (!draft) return;
    const key = draft.race_key.trim().toLowerCase().replace(/[^a-z0-9_]/g, '_');
    if (!key) { toast({ title: 'A race key is required', variant: 'destructive' }); return; }
    if (!draft.label.trim()) { toast({ title: 'A display name is required', variant: 'destructive' }); return; }

    setSaving(true);
    const payload = {
      race_key: key,
      label: draft.label.trim(),
      description: draft.description ?? '',
      str: draft.str, dex: draft.dex, con: draft.con,
      int: draft.int, wis: draft.wis, cha: draft.cha,
      portrait_notes: draft.portrait_notes ?? '',
      is_selectable: draft.is_selectable,
      status: draft.status || 'active',
      sort_order: draft.sort_order ?? 100,
      admin_notes: draft.admin_notes || null,
    };

    const { error } = isNew
      ? await supabase.from('races' as any).insert(payload as any)
      : await supabase.from('races' as any).update(payload as any).eq('race_key', key);

    setSaving(false);
    if (error) {
      toast({ title: 'Save failed', description: error.message, variant: 'destructive' });
      return;
    }
    toast({ title: isNew ? 'Race created' : 'Race saved', description: payload.label });
    setDraft(null);
    load();
  };

  const remove = async (row: RaceRow) => {
    const { error } = await supabase.from('races' as any).delete().eq('race_key', row.race_key);
    if (error) {
      toast({
        title: 'Could not delete race',
        description: 'Races in use by existing characters cannot be removed — mark them unavailable instead.',
        variant: 'destructive',
      });
      return;
    }
    toast({ title: 'Race deleted', description: row.label });
    if (draft?.race_key === row.race_key) setDraft(null);
    load();
  };

  const setStat = (stat: StatKey, raw: string) => {
    const n = Number.parseInt(raw, 10);
    setDraft(d => (d ? { ...d, [stat]: Number.isFinite(n) ? n : 0 } : d));
  };

  return (
    <div className="h-full flex flex-col overflow-hidden">
      <AdminEntityToolbar icon={<Dna />} title="Races" count={races.length}>
        <Button size="sm" className="h-7 text-xs" onClick={startNew}>
          <Plus className="w-3 h-3 mr-1" /> New Race
        </Button>
      </AdminEntityToolbar>

      <div className="flex-1 min-h-0 flex">
        <ScrollArea className="flex-1 min-h-0">
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3 p-4">
            {loading && <p className="text-xs text-muted-foreground">Loading races...</p>}
            {!loading && races.length === 0 && (
              <p className="text-xs text-muted-foreground">No races configured yet.</p>
            )}
            {races.map(row => (
              <Card
                key={row.race_key}
                className={`bg-card/80 border-border cursor-pointer transition-colors hover:border-primary/60 ${
                  draft && !isNew && draft.race_key === row.race_key ? 'border-primary' : ''
                }`}
                onClick={() => startEdit(row)}
              >
                <CardHeader className="pb-2 pt-4 px-4">
                  <CardTitle className="text-sm font-display flex items-center gap-2">
                    {row.label}
                    <span className="text-[10px] text-muted-foreground font-mono">{row.race_key}</span>
                    <Badge variant={row.is_selectable && row.status === 'active' ? 'outline' : 'secondary'} className="ml-auto text-[10px]">
                      {row.status === 'active' ? (row.is_selectable ? 'Selectable' : 'Hidden') : row.status}
                    </Badge>
                  </CardTitle>
                  <p className="text-xs text-muted-foreground">{row.description}</p>
                </CardHeader>
                <CardContent className="px-4 pb-4">
                  <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1">Stat Modifiers</p>
                  <div className="grid grid-cols-6 gap-1">
                    {STAT_KEYS.map(s => (
                      <div key={s} className="text-center">
                        <div className="text-[10px] text-muted-foreground">{STAT_LABELS[s]}</div>
                        <StatBadge value={row[s] ?? 0} />
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </ScrollArea>

        {draft && (
          <div className="w-[360px] shrink-0 border-l border-border flex flex-col min-h-0">
            <AdminEditorHeader
              title={isNew ? 'New Race' : `Edit ${draft.label || draft.race_key}`}
              onClose={() => setDraft(null)}
            />
            <ScrollArea className="flex-1 min-h-0">
              <div className="p-3 space-y-4">
                <AdminFormSection title="Identity">
                  <div className="space-y-2">
                    <div>
                      <Label className="text-[10px] text-muted-foreground">Race key</Label>
                      <Input
                        value={draft.race_key}
                        disabled={!isNew}
                        onChange={e => setDraft({ ...draft, race_key: e.target.value })}
                        placeholder="e.g. orc"
                        className="h-7 text-xs font-mono"
                      />
                    </div>
                    <div>
                      <Label className="text-[10px] text-muted-foreground">Display name</Label>
                      <Input
                        value={draft.label}
                        onChange={e => setDraft({ ...draft, label: e.target.value })}
                        className="h-7 text-xs"
                      />
                    </div>
                    <div>
                      <Label className="text-[10px] text-muted-foreground">Description</Label>
                      <Textarea
                        value={draft.description}
                        onChange={e => setDraft({ ...draft, description: e.target.value })}
                        rows={3}
                        className="text-xs"
                      />
                    </div>
                  </div>
                </AdminFormSection>

                <AdminFormSection title="Stat modifiers" description="Applied on top of the base 8 in every attribute.">
                  <div className="grid grid-cols-3 gap-2">
                    {STAT_KEYS.map(s => (
                      <div key={s}>
                        <Label className="text-[10px] text-muted-foreground">{STAT_LABELS[s]}</Label>
                        <Input
                          type="number"
                          value={draft[s]}
                          onChange={e => setStat(s, e.target.value)}
                          className="h-7 text-xs font-mono"
                        />
                      </div>
                    ))}
                  </div>
                </AdminFormSection>

                <AdminFormSection title="Availability">
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <Label className="text-xs">Selectable at creation</Label>
                      <Switch
                        checked={draft.is_selectable}
                        onCheckedChange={v => setDraft({ ...draft, is_selectable: v })}
                      />
                    </div>
                    <div className="flex items-center justify-between">
                      <Label className="text-xs">Active</Label>
                      <Switch
                        checked={draft.status === 'active'}
                        onCheckedChange={v => setDraft({ ...draft, status: v ? 'active' : 'draft' })}
                      />
                    </div>
                    <div>
                      <Label className="text-[10px] text-muted-foreground">Sort order</Label>
                      <Input
                        type="number"
                        value={draft.sort_order}
                        onChange={e => setDraft({ ...draft, sort_order: Number.parseInt(e.target.value, 10) || 0 })}
                        className="h-7 text-xs font-mono"
                      />
                    </div>
                  </div>
                </AdminFormSection>

                <AdminFormSection title="Portrait notes" description="Extra art direction appended to the AI portrait prompt.">
                  <Textarea
                    value={draft.portrait_notes}
                    onChange={e => setDraft({ ...draft, portrait_notes: e.target.value })}
                    rows={2}
                    className="text-xs"
                  />
                </AdminFormSection>

                <AdminFormSection title="Admin notes">
                  <Textarea
                    value={draft.admin_notes ?? ''}
                    onChange={e => setDraft({ ...draft, admin_notes: e.target.value })}
                    rows={2}
                    className="text-xs"
                  />
                </AdminFormSection>

                <div className="flex items-center gap-2 pt-1">
                  <Button size="sm" className="h-7 text-xs flex-1" onClick={save} disabled={saving}>
                    {saving ? 'Saving...' : isNew ? 'Create race' : 'Save changes'}
                  </Button>
                  {!isNew && (
                    <Button
                      size="sm"
                      variant="destructive"
                      className="h-7 text-xs"
                      onClick={() => remove(draft)}
                    >
                      <Trash2 className="w-3 h-3" />
                    </Button>
                  )}
                </div>
              </div>
            </ScrollArea>
          </div>
        )}
      </div>
    </div>
  );
}
