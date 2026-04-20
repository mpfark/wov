import { useEffect, useState, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { ArrowLeft, ImageOff } from 'lucide-react';

type Source = 'region' | 'area' | 'node' | 'item';

interface Illustration {
  id: string;
  source: Source;
  name: string;
  description: string;
  illustration_url: string;
  min_level?: number | null;
  max_level?: number | null;
  rarity?: string | null;
}

const SOURCE_LABEL: Record<Source, string> = {
  region: 'Region',
  area: 'Area',
  node: 'Node',
  item: 'Item',
};

const SOURCE_BADGE: Record<Source, string> = {
  region: 'bg-primary/20 text-primary border-primary/40',
  area: 'bg-secondary/30 text-secondary-foreground border-secondary/50',
  node: 'bg-accent/20 text-accent-foreground border-accent/40',
  item: 'bg-amber-500/20 text-amber-300 border-amber-500/40',
};

const FILTERS: Array<{ key: 'all' | Source; label: string }> = [
  { key: 'all', label: 'All' },
  { key: 'region', label: 'Regions' },
  { key: 'area', label: 'Areas' },
  { key: 'node', label: 'Nodes' },
  { key: 'item', label: 'Items' },
];

export default function GalleryPage() {
  const [items, setItems] = useState<Illustration[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'all' | Source>('all');
  const [selected, setSelected] = useState<Illustration | null>(null);
  const [hiddenIds, setHiddenIds] = useState<Set<string>>(new Set());
  const [signedIn, setSignedIn] = useState(false);

  useEffect(() => {
    document.title = 'Gallery of Varneth — Illustrations';
    let metaDesc = document.querySelector('meta[name="description"]');
    if (!metaDesc) {
      metaDesc = document.createElement('meta');
      metaDesc.setAttribute('name', 'description');
      document.head.appendChild(metaDesc);
    }
    metaDesc.setAttribute('content', 'Browse the illustrated regions, areas, and locations of the world of Varneth.');
  }, []);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSignedIn(!!data.session));
  }, []);

  useEffect(() => {
    let mounted = true;
    (async () => {
      const [reg, ar, nd, it] = await Promise.all([
        supabase
          .from('regions')
          .select('id, name, description, illustration_url, min_level, max_level')
          .not('illustration_url', 'is', null)
          .neq('illustration_url', ''),
        supabase
          .from('areas')
          .select('id, name, description, illustration_url, min_level, max_level')
          .not('illustration_url', 'is', null)
          .neq('illustration_url', ''),
        supabase
          .from('nodes')
          .select('id, name, description, illustration_url')
          .not('illustration_url', 'is', null)
          .neq('illustration_url', ''),
        supabase
          .from('items')
          .select('id, name, description, illustration_url, level, rarity')
          .not('illustration_url', 'is', null)
          .neq('illustration_url', ''),
      ]);

      const merged: Illustration[] = [
        ...(reg.data ?? []).map((r): Illustration => ({ ...r, source: 'region' })),
        ...(ar.data ?? []).map((a): Illustration => ({ ...a, source: 'area' })),
        ...(nd.data ?? []).map((n): Illustration => ({
          id: n.id,
          name: n.name || 'Unnamed Location',
          description: n.description || '',
          illustration_url: n.illustration_url || '',
          source: 'node',
        })),
        ...(it.data ?? []).map((i): Illustration => ({
          id: i.id,
          name: i.name,
          description: i.description || '',
          illustration_url: i.illustration_url || '',
          source: 'item',
          min_level: i.level,
          max_level: i.level,
          rarity: i.rarity,
        })),
      ].sort((a, b) => a.name.localeCompare(b.name));

      if (mounted) {
        setItems(merged);
        setLoading(false);
      }
    })();
    return () => {
      mounted = false;
    };
  }, []);

  const filtered = useMemo(
    () => items.filter((i) => (filter === 'all' || i.source === filter) && !hiddenIds.has(i.id)),
    [items, filter, hiddenIds]
  );

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: 0, region: 0, area: 0, node: 0, item: 0 };
    for (const it of items) {
      if (hiddenIds.has(it.id)) continue;
      c.all++;
      c[it.source]++;
    }
    return c;
  }, [items, hiddenIds]);

  const handleImgError = (id: string) => {
    setHiddenIds((prev) => {
      const next = new Set(prev);
      next.add(id);
      return next;
    });
  };

  return (
    <div className="min-h-screen parchment-bg">
      <div className="container mx-auto px-4 py-6 max-w-7xl">
        <header className="mb-6">
          <div className="flex items-center justify-between gap-3 mb-4">
            <Button asChild variant="ghost" size="sm">
              <Link to={signedIn ? '/game' : '/'}>
                <ArrowLeft className="mr-1" /> Back
              </Link>
            </Button>
          </div>
          <h1 className="font-display text-4xl md:text-5xl text-primary text-glow text-center mb-2">
            Gallery of Varneth
          </h1>
          <p className="text-center text-muted-foreground text-sm md:text-base mb-5">
            A collection of illustrations from across the realm.
          </p>
          <div className="flex flex-wrap items-center justify-center gap-2">
            {FILTERS.map((f) => (
              <Button
                key={f.key}
                variant={filter === f.key ? 'default' : 'outline'}
                size="sm"
                onClick={() => setFilter(f.key)}
                className="rounded-full"
              >
                {f.label}
                <span className="ml-2 text-xs opacity-70">{counts[f.key] ?? 0}</span>
              </Button>
            ))}
          </div>
        </header>

        {loading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {Array.from({ length: 8 }).map((_, i) => (
              <Skeleton key={i} className="aspect-[4/3] w-full rounded-lg" />
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-20 text-muted-foreground">
            <ImageOff className="mx-auto mb-3 opacity-50" size={48} />
            <p className="font-display text-lg">No illustrations yet — keep exploring!</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {filtered.map((it) => (
              <GalleryCard key={`${it.source}-${it.id}`} item={it} onClick={() => setSelected(it)} onError={() => handleImgError(it.id)} />
            ))}
          </div>
        )}
      </div>

      <Dialog open={!!selected} onOpenChange={(o) => !o && setSelected(null)}>
        <DialogContent className="max-w-5xl p-0 overflow-hidden bg-card border-border">
          {selected && (
            <div className="flex flex-col">
              <img
                src={selected.illustration_url}
                alt={selected.name}
                className="w-full max-h-[75vh] object-contain bg-background"
              />
              <div className="p-5">
                <div className="flex items-center gap-2 mb-2 flex-wrap">
                  <Badge variant="outline" className={SOURCE_BADGE[selected.source]}>
                    {SOURCE_LABEL[selected.source]}
                  </Badge>
                  {selected.min_level != null && selected.max_level != null && (
                    <Badge variant="outline" className="text-xs">
                      Lv {selected.min_level}–{selected.max_level}
                    </Badge>
                  )}
                </div>
                <DialogTitle className="font-display text-2xl text-primary mb-2">{selected.name}</DialogTitle>
                {selected.description ? (
                  <DialogDescription className="text-sm text-foreground/80 whitespace-pre-wrap">
                    {selected.description}
                  </DialogDescription>
                ) : (
                  <DialogDescription className="sr-only">{selected.name}</DialogDescription>
                )}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function GalleryCard({
  item,
  onClick,
  onError,
}: {
  item: Illustration;
  onClick: () => void;
  onError: () => void;
}) {
  const [loaded, setLoaded] = useState(false);
  return (
    <Card
      className="group overflow-hidden cursor-pointer hover:border-primary/60 transition-colors animate-fade-in"
      onClick={onClick}
    >
      <div className="relative aspect-[4/3] overflow-hidden bg-muted">
        {!loaded && <Skeleton className="absolute inset-0" />}
        <img
          src={item.illustration_url}
          alt={item.name}
          loading="lazy"
          onLoad={() => setLoaded(true)}
          onError={onError}
          className={`w-full h-full object-cover transition-all duration-500 group-hover:scale-105 ${
            loaded ? 'opacity-100' : 'opacity-0'
          }`}
        />
        <div className="absolute top-2 left-2">
          <Badge variant="outline" className={`${SOURCE_BADGE[item.source]} backdrop-blur-sm`}>
            {SOURCE_LABEL[item.source]}
          </Badge>
        </div>
      </div>
      <CardContent className="p-3">
        <h3 className="font-display text-base text-primary truncate">{item.name}</h3>
        {item.description && (
          <p className="text-xs text-muted-foreground line-clamp-2 mt-1">{item.description}</p>
        )}
      </CardContent>
    </Card>
  );
}
