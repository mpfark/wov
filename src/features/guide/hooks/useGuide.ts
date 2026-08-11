/**
 * useGuide — loads the published Wayfarer's Guide content plus the current
 * character's per-entry read state.
 *
 * Two distinct concepts (see plan):
 *   • unreadEntryIds — per-entry markers shown inside the reader.
 *   • needsAttention — the toolbar dot. MVP rule: driven ONLY by the
 *     Getting Started entry, so reading it clears the dot permanently even
 *     while other entries remain unread.
 *
 * Reading the guide is informational: it never touches combat, movement,
 * inventory, progression or world state.
 */
import { useCallback, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { ATTENTION_SLUG, type GuideCategory, type GuideEntry } from '../types';

const CONTENT_STALE_MS = 5 * 60 * 1000;

async function fetchContent(): Promise<{ categories: GuideCategory[]; entries: GuideEntry[] }> {
  const [cats, ents] = await Promise.all([
    supabase
      .from('guide_categories')
      .select('id, key, title, subtitle, sort_order, is_published')
      .eq('is_published', true)
      .order('sort_order'),
    supabase
      .from('guide_entries')
      .select('id, category_id, slug, title, summary, body, sort_order, is_published')
      .eq('is_published', true)
      .order('sort_order'),
  ]);
  if (cats.error) throw cats.error;
  if (ents.error) throw ents.error;
  return {
    categories: (cats.data ?? []) as GuideCategory[],
    entries: (ents.data ?? []) as GuideEntry[],
  };
}

export interface GuideGroup {
  category: GuideCategory;
  entries: GuideEntry[];
}

export function useGuide(characterId: string | undefined) {
  const qc = useQueryClient();

  const content = useQuery({
    queryKey: ['guide', 'content'],
    queryFn: fetchContent,
    staleTime: CONTENT_STALE_MS,
  });

  const reads = useQuery({
    queryKey: ['guide', 'reads', characterId],
    enabled: !!characterId,
    staleTime: CONTENT_STALE_MS,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('character_guide_reads')
        .select('entry_id')
        .eq('character_id', characterId!);
      if (error) throw error;
      return (data ?? []).map(r => r.entry_id as string);
    },
  });

  const readIds = useMemo(() => new Set(reads.data ?? []), [reads.data]);

  const groups: GuideGroup[] = useMemo(() => {
    const cats = content.data?.categories ?? [];
    const entries = content.data?.entries ?? [];
    return cats
      .map(category => ({
        category,
        entries: entries
          .filter(e => e.category_id === category.id)
          .sort((a, b) => a.sort_order - b.sort_order),
      }))
      .filter(g => g.entries.length > 0);
  }, [content.data]);

  const entries = useMemo(() => groups.flatMap(g => g.entries), [groups]);

  const unreadEntryIds = useMemo(
    () => new Set(entries.filter(e => !readIds.has(e.id)).map(e => e.id)),
    [entries, readIds],
  );

  // Toolbar attention: only the Getting Started entry counts.
  const attentionEntry = entries.find(e => e.slug === ATTENTION_SLUG);
  const needsAttention = !!attentionEntry && !readIds.has(attentionEntry.id);

  const markRead = useCallback(
    async (entryId: string) => {
      if (!characterId || readIds.has(entryId)) return;
      // Optimistic: flip local state first so the dot clears immediately.
      qc.setQueryData<string[]>(['guide', 'reads', characterId], prev =>
        prev ? (prev.includes(entryId) ? prev : [...prev, entryId]) : [entryId],
      );
      await supabase
        .from('character_guide_reads')
        .upsert({ character_id: characterId, entry_id: entryId }, { onConflict: 'character_id,entry_id' });
    },
    [characterId, readIds, qc],
  );

  return {
    groups,
    entries,
    loading: content.isLoading,
    error: content.error ? (content.error as Error) : null,
    refetch: content.refetch,
    unreadEntryIds,
    needsAttention,
    markRead,
  };
}
