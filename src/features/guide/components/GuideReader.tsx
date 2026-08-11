/**
 * GuideReader — the Wayfarer's Guide reading surface.
 * Desktop: Dialog. Mobile: bottom Sheet (GamePage closes the map sheet first).
 * Purely informational; opening or reading it changes no game state.
 */
import { useEffect, useMemo, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Button } from '@/components/ui/button';
import { ChevronLeft } from 'lucide-react';
import { cn } from '@/lib/utils';
import { GuideBody } from './GuideBody';
import { useGuide } from '../hooks/useGuide';
import { ATTENTION_SLUG } from '../types';

export const GUIDE_MOTTO = "DON'T WANDER UNPREPARED";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  characterId: string | undefined;
  isMobile?: boolean;
}

export function GuideReader({ open, onOpenChange, characterId, isMobile = false }: Props) {
  const { groups, entries, loading, error, unreadEntryIds, markRead } = useGuide(characterId);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showListOnMobile, setShowListOnMobile] = useState(true);

  // Default selection: Getting Started if present, else first entry.
  const defaultId = useMemo(() => {
    if (!entries.length) return null;
    return entries.find(e => e.slug === ATTENTION_SLUG)?.id ?? entries[0].id;
  }, [entries]);

  useEffect(() => {
    if (!open) return;
    setShowListOnMobile(false);
    setSelectedId(prev => prev ?? defaultId);
  }, [open, defaultId]);

  const selected = entries.find(e => e.id === selectedId) ?? null;

  // Mark read once an entry is actually shown.
  useEffect(() => {
    if (open && selected) void markRead(selected.id);
  }, [open, selected, markRead]);

  const nav = (
    <ScrollArea className="h-full">
      <nav className="space-y-4 p-3">
        {groups.map(({ category, entries: catEntries }) => (
          <div key={category.id} className="space-y-1">
            <p className="px-2 text-[11px] uppercase tracking-widest text-muted-foreground/70">
              {category.title}
            </p>
            {catEntries.map(entry => {
              const active = entry.id === selectedId;
              return (
                <button
                  key={entry.id}
                  type="button"
                  onClick={() => {
                    setSelectedId(entry.id);
                    setShowListOnMobile(false);
                  }}
                  className={cn(
                    'flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm transition-colors',
                    active
                      ? 'bg-primary/15 text-foreground'
                      : 'text-muted-foreground hover:bg-muted/40 hover:text-foreground',
                  )}
                >
                  <span className="flex-1 truncate">{entry.title}</span>
                  {unreadEntryIds.has(entry.id) && (
                    <span
                      className="h-1.5 w-1.5 shrink-0 rounded-full bg-primary"
                      aria-label="Unread"
                    />
                  )}
                </button>
              );
            })}
          </div>
        ))}
      </nav>
    </ScrollArea>
  );

  const reading = (
    <ScrollArea className="h-full">
      <article className="p-4">
        {loading && <p className="text-sm text-muted-foreground">Leafing through the pages...</p>}
        {error && (
          <p className="text-sm text-destructive">
            The Guide's pages are stuck together. Try again shortly.
          </p>
        )}
        {!loading && !error && !selected && (
          <p className="text-sm text-muted-foreground">
            The Guide is currently blank. This is either an oversight or a warning.
          </p>
        )}
        {selected && (
          <>
            <h2 className="font-display text-lg text-primary">{selected.title}</h2>
            {selected.summary && (
              <p className="mb-3 mt-1 text-xs italic text-muted-foreground/80">{selected.summary}</p>
            )}
            <GuideBody body={selected.body} />
          </>
        )}
      </article>
    </ScrollArea>
  );

  const footer = (
    <div className="border-t border-border px-4 py-2 text-center text-[10px] uppercase tracking-[0.25em] text-muted-foreground/70">
      {GUIDE_MOTTO}
    </div>
  );

  if (isMobile) {
    return (
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent side="bottom" className="h-[85vh] p-0 flex flex-col bg-card/95">
          <SheetHeader className="border-b border-border px-4 py-3 text-left">
            <SheetTitle className="font-display text-base text-primary">The Wayfarer's Guide</SheetTitle>
            <SheetDescription className="text-xs">
              Mostly accurate. Occasionally load-bearing.
            </SheetDescription>
          </SheetHeader>
          <div className="flex items-center gap-2 border-b border-border px-2 py-1">
            <Button
              variant="ghost"
              size="sm"
              className="h-7 text-xs"
              onClick={() => setShowListOnMobile(v => !v)}
            >
              <ChevronLeft className="mr-1 h-3.5 w-3.5" />
              {showListOnMobile ? 'Close contents' : 'Contents'}
            </Button>
          </div>
          <div className="min-h-0 flex-1">{showListOnMobile ? nav : reading}</div>
          {footer}
        </SheetContent>
      </Sheet>
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl p-0 gap-0 overflow-hidden">
        <DialogHeader className="border-b border-border px-4 py-3">
          <DialogTitle className="font-display text-base text-primary">The Wayfarer's Guide</DialogTitle>
          <DialogDescription className="text-xs">
            Mostly accurate. Occasionally load-bearing.
          </DialogDescription>
        </DialogHeader>
        <div className="flex h-[60vh] min-h-0">
          <div className="w-56 shrink-0 border-r border-border">{nav}</div>
          <div className="min-w-0 flex-1">{reading}</div>
        </div>
        {footer}
      </DialogContent>
    </Dialog>
  );
}
