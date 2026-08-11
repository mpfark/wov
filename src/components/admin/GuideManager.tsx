/**
 * GuideManager — steward/overlord editor for The Wayfarer's Guide.
 * Left: categories. Right: entries in the selected category, with an inline
 * editor and a player-facing preview using the same GuideBody renderer.
 */
import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Card } from '@/components/ui/card';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { toast } from 'sonner';
import { Plus, Trash2, Save } from 'lucide-react';
import { cn } from '@/lib/utils';
import { GuideBody } from '@/features/guide/components/GuideBody';
import type { GuideCategory, GuideEntry } from '@/features/guide/types';

const slugify = (s: string) =>
  s.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);

export default function GuideManager() {
  const [categories, setCategories] = useState<GuideCategory[]>([]);
  const [entries, setEntries] = useState<GuideEntry[]>([]);
  const [selectedCategoryId, setSelectedCategoryId] = useState<string | null>(null);
  const [selectedEntryId, setSelectedEntryId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [draft, setDraft] = useState<Partial<GuideEntry>>({});

  const load = async () => {
    setLoading(true);
    const [cats, ents] = await Promise.all([
      supabase.from('guide_categories').select('*').order('sort_order'),
      supabase.from('guide_entries').select('*').order('sort_order'),
    ]);
    if (cats.error || ents.error) {
      toast.error(cats.error?.message ?? ents.error?.message ?? 'Failed to load guide content');
    } else {
      setCategories((cats.data ?? []) as GuideCategory[]);
      setEntries((ents.data ?? []) as GuideEntry[]);
      setSelectedCategoryId(prev => prev ?? (cats.data?.[0]?.id ?? null));
    }
    setLoading(false);
  };

  useEffect(() => { void load(); }, []);

  const categoryEntries = useMemo(
    () => entries.filter(e => e.category_id === selectedCategoryId),
    [entries, selectedCategoryId],
  );

  const selectedEntry = entries.find(e => e.id === selectedEntryId) ?? null;

  useEffect(() => {
    setDraft(selectedEntry ? { ...selectedEntry } : {});
  }, [selectedEntry]);

  const addCategory = async () => {
    const title = window.prompt('Category title');
    if (!title) return;
    const { error } = await supabase.from('guide_categories').insert({
      key: slugify(title),
      title,
      sort_order: (categories[categories.length - 1]?.sort_order ?? 0) + 1,
      is_published: true,
    });
    if (error) toast.error(error.message);
    else { toast.success('Category added'); void load(); }
  };

  const updateCategory = async (cat: GuideCategory, patch: Partial<GuideCategory>) => {
    const { error } = await supabase.from('guide_categories').update(patch).eq('id', cat.id);
    if (error) toast.error(error.message);
    else void load();
  };

  const deleteCategory = async (cat: GuideCategory) => {
    if (entries.some(e => e.category_id === cat.id)) {
      toast.error('Move or delete this category\'s entries first');
      return;
    }
    if (!window.confirm(`Delete category "${cat.title}"?`)) return;
    const { error } = await supabase.from('guide_categories').delete().eq('id', cat.id);
    if (error) toast.error(error.message);
    else { toast.success('Category deleted'); setSelectedCategoryId(null); void load(); }
  };

  const addEntry = async () => {
    if (!selectedCategoryId) return;
    const title = window.prompt('Entry title');
    if (!title) return;
    const { data, error } = await supabase.from('guide_entries').insert({
      category_id: selectedCategoryId,
      slug: slugify(title),
      title,
      body: '# Overview\nWrite the entry here.',
      sort_order: (categoryEntries[categoryEntries.length - 1]?.sort_order ?? 0) + 1,
      is_published: false,
    }).select('id').single();
    if (error) toast.error(error.message);
    else { toast.success('Entry created as draft'); await load(); setSelectedEntryId(data!.id); }
  };

  const saveEntry = async () => {
    if (!selectedEntry) return;
    if (!draft.title?.trim() || !draft.body?.trim()) {
      toast.error('Title and body are required');
      return;
    }
    setSaving(true);
    const { error } = await supabase.from('guide_entries').update({
      title: draft.title,
      summary: draft.summary ?? null,
      body: draft.body,
      sort_order: Number(draft.sort_order) || 0,
      is_published: !!draft.is_published,
    }).eq('id', selectedEntry.id);
    setSaving(false);
    if (error) toast.error(error.message);
    else { toast.success('Entry saved'); void load(); }
  };

  const deleteEntry = async () => {
    if (!selectedEntry) return;
    if (!window.confirm(`Delete entry "${selectedEntry.title}"? Player read markers are removed too.`)) return;
    const { error } = await supabase.from('guide_entries').delete().eq('id', selectedEntry.id);
    if (error) toast.error(error.message);
    else { toast.success('Entry deleted'); setSelectedEntryId(null); void load(); }
  };

  return (
    <div className="p-6 space-y-4">
      <div>
        <h1 className="font-display text-xl text-primary">Wayfarer's Guide</h1>
        <p className="text-xs text-muted-foreground">
          Player-facing guide entries. Line grammar: "# heading", "- bullet", "1. step", "&gt; aside",
          "! caution", blank line for a new paragraph, *emphasis*.
        </p>
      </div>

      {loading ? (
        <p className="text-sm text-muted-foreground">Loading...</p>
      ) : (
        <div className="grid gap-4 lg:grid-cols-[260px_1fr]">
          {/* Categories */}
          <Card className="p-3 space-y-2 h-fit">
            <div className="flex items-center justify-between">
              <span className="font-display text-sm">Categories</span>
              <Button size="icon" variant="ghost" className="h-7 w-7" onClick={addCategory}>
                <Plus className="h-4 w-4" />
              </Button>
            </div>
            <div className="space-y-1">
              {categories.map(cat => (
                <div
                  key={cat.id}
                  className={cn(
                    'rounded-sm border px-2 py-1.5 text-sm cursor-pointer',
                    cat.id === selectedCategoryId ? 'border-primary/60 bg-primary/10' : 'border-border',
                  )}
                  onClick={() => { setSelectedCategoryId(cat.id); setSelectedEntryId(null); }}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate">{cat.title}</span>
                    <div className="flex items-center gap-1">
                      <Switch
                        checked={cat.is_published}
                        onCheckedChange={v => updateCategory(cat, { is_published: v })}
                        aria-label="Published"
                      />
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-6 w-6 text-destructive"
                        onClick={e => { e.stopPropagation(); void deleteCategory(cat); }}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>
                  <p className="text-[10px] text-muted-foreground">order {cat.sort_order} · {cat.key}</p>
                </div>
              ))}
            </div>
          </Card>

          {/* Entries + editor */}
          <div className="space-y-3">
            <Card className="p-3 space-y-2">
              <div className="flex items-center justify-between">
                <span className="font-display text-sm">Entries</span>
                <Button size="sm" variant="secondary" className="h-7 text-xs" onClick={addEntry} disabled={!selectedCategoryId}>
                  <Plus className="mr-1 h-3.5 w-3.5" /> New entry
                </Button>
              </div>
              <div className="flex flex-wrap gap-1">
                {categoryEntries.map(entry => (
                  <Button
                    key={entry.id}
                    size="sm"
                    variant={entry.id === selectedEntryId ? 'default' : 'outline'}
                    className="h-7 text-xs"
                    onClick={() => setSelectedEntryId(entry.id)}
                  >
                    {entry.title}
                    {!entry.is_published && <span className="ml-1 text-[10px] opacity-70">(draft)</span>}
                  </Button>
                ))}
                {categoryEntries.length === 0 && (
                  <p className="text-xs text-muted-foreground">No entries in this category yet.</p>
                )}
              </div>
            </Card>

            {selectedEntry && (
              <Card className="p-3">
                <Tabs defaultValue="edit">
                  <TabsList>
                    <TabsTrigger value="edit">Edit</TabsTrigger>
                    <TabsTrigger value="preview">Player preview</TabsTrigger>
                  </TabsList>

                  <TabsContent value="edit" className="space-y-3 pt-3">
                    <div className="grid gap-3 sm:grid-cols-2">
                      <div className="space-y-1">
                        <Label className="text-xs">Title</Label>
                        <Input
                          value={draft.title ?? ''}
                          onChange={e => setDraft(d => ({ ...d, title: e.target.value }))}
                        />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs">Sort order</Label>
                        <Input
                          type="number"
                          value={draft.sort_order ?? 0}
                          onChange={e => setDraft(d => ({ ...d, sort_order: Number(e.target.value) }))}
                        />
                      </div>
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">Summary (optional)</Label>
                      <Input
                        value={draft.summary ?? ''}
                        onChange={e => setDraft(d => ({ ...d, summary: e.target.value }))}
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">Body</Label>
                      <Textarea
                        rows={16}
                        className="font-mono text-xs"
                        value={draft.body ?? ''}
                        onChange={e => setDraft(d => ({ ...d, body: e.target.value }))}
                      />
                    </div>
                    <div className="flex items-center justify-between">
                      <label className="flex items-center gap-2 text-xs">
                        <Switch
                          checked={!!draft.is_published}
                          onCheckedChange={v => setDraft(d => ({ ...d, is_published: v }))}
                        />
                        Published
                      </label>
                      <div className="flex gap-2">
                        <Button variant="outline" size="sm" className="text-destructive" onClick={deleteEntry}>
                          <Trash2 className="mr-1 h-3.5 w-3.5" /> Delete
                        </Button>
                        <Button size="sm" onClick={saveEntry} disabled={saving}>
                          <Save className="mr-1 h-3.5 w-3.5" /> {saving ? 'Saving...' : 'Save'}
                        </Button>
                      </div>
                    </div>
                    <p className="text-[10px] text-muted-foreground">Slug: {selectedEntry.slug} (permanent)</p>
                  </TabsContent>

                  <TabsContent value="preview" className="pt-3">
                    <div className="rounded-sm border border-border p-4">
                      <h2 className="font-display text-lg text-primary">{draft.title}</h2>
                      {draft.summary && (
                        <p className="mb-3 mt-1 text-xs italic text-muted-foreground/80">{draft.summary}</p>
                      )}
                      <GuideBody body={draft.body ?? ''} />
                      <p className="mt-4 border-t border-border pt-2 text-center text-[10px] uppercase tracking-[0.25em] text-muted-foreground/70">
                        DON'T WANDER UNPREPARED
                      </p>
                    </div>
                  </TabsContent>
                </Tabs>
              </Card>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
