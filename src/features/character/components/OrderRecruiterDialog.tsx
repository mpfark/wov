import { useEffect, useMemo, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { CLASS_LABELS } from '@/shared/formulas/classes';
import { NPC } from '@/features/creatures';
import {
  expandTopics,
  parseTopics,
  resolveTopic,
  type ResolverContext,
} from '@/features/creatures/utils/dialogue-topics';

interface Props {
  open: boolean;
  onClose: () => void;
  npc: NPC | null;
  hallClass: string | null;
  characterId: string;
  currentClass: string;
  onJoined?: () => void;
  worldContext?: ResolverContext;
}

interface BondRow { class: string; bond: number }

export default function OrderRecruiterDialog({
  open, onClose, npc, hallClass, characterId, currentClass, onJoined, worldContext,
}: Props) {
  const [bonds, setBonds] = useState<BondRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [acting, setActing] = useState(false);
  const [activeTopicId, setActiveTopicId] = useState<string | null>(null);

  const topics = useMemo(() => {
    if (!npc || !worldContext) return [];
    return expandTopics(parseTopics(npc.dialogue_topics), worldContext);
  }, [npc, worldContext]);

  const activeTopic = useMemo(() => {
    if (!activeTopicId || !worldContext) return null;
    const t = topics.find(x => x.id === activeTopicId);
    return t ? resolveTopic(t, worldContext) : null;
  }, [activeTopicId, topics, worldContext]);

  useEffect(() => {
    if (!open || !characterId) return;
    setLoading(true);
    supabase
      .from('character_class_bonds')
      .select('class, bond')
      .eq('character_id', characterId)
      .then(({ data }) => {
        setBonds((data as BondRow[]) || []);
        setLoading(false);
      });
  }, [open, characterId]);

  if (!hallClass) return null;
  const hallLabel = CLASS_LABELS[hallClass] || hallClass;
  const isCurrent = currentClass === hallClass;
  const hallBond = bonds.find(b => b.class === hallClass)?.bond ?? 0;

  const handleJoin = async () => {
    setActing(true);
    try {
      const rpc = currentClass ? 'switch_order' : 'join_order';
      const { error } = await supabase.rpc(rpc as any, {
        _character_id: characterId,
        _class: hallClass as any,
      });
      if (error) throw error;
      toast.success(`You have joined the ${hallLabel} order.`);
      onJoined?.();
      onClose();
    } catch (err: any) {
      toast.error(err?.message || 'Failed to join order');
    } finally {
      setActing(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={v => { if (!v) onClose(); }}>
      <DialogContent className="sm:max-w-md border-primary/30 bg-card">
        <DialogHeader>
          <DialogTitle className="font-display text-primary text-glow text-center tracking-wide">
            — {npc?.name ?? 'Recruiter'} —
          </DialogTitle>
          <DialogDescription className="text-xs italic text-center">
            {hallLabel} Hall{npc?.description ? ` · ${npc.description}` : ''}
          </DialogDescription>
        </DialogHeader>

        <div className="px-4 py-3 bg-background/40 rounded border border-border/60 min-h-[80px] relative">
          <span aria-hidden className="absolute -top-1 left-2 font-display text-2xl text-primary/40 leading-none select-none">“</span>
          <p className="text-sm text-foreground/90 leading-relaxed whitespace-pre-wrap italic font-display px-3">
            {activeTopic?.response ?? npc?.dialogue ?? '...'}
          </p>
          <span aria-hidden className="absolute -bottom-3 right-2 font-display text-2xl text-primary/40 leading-none select-none">”</span>
        </div>

        {topics.length > 0 && (
          <div className="space-y-2 pt-1">
            <div className="flex items-center gap-2 text-muted-foreground/70">
              <span className="h-px flex-1 bg-border" />
              <span className="text-[10px] tracking-[0.15em] font-display text-muted-foreground/70">— speak —</span>
              <span className="h-px flex-1 bg-border" />
            </div>
            <ul className="flex flex-col gap-0.5">
              {topics.map((t, i) => {
                const isActive = activeTopicId === t.id;
                return (
                  <li key={t.id}>
                    <button
                      onClick={() => setActiveTopicId(t.id)}
                      className={[
                        'group w-full text-left flex items-baseline gap-2 py-1.5 pl-2 pr-1',
                        'font-display italic transition-all',
                        isActive
                          ? 'text-primary text-glow border-l-2 border-primary/70'
                          : 'text-foreground/70 hover:text-primary border-l-2 border-transparent hover:border-primary/40',
                      ].join(' ')}
                    >
                      <span className="text-xs text-muted-foreground/60 not-italic w-4 shrink-0">{i + 1}.</span>
                      <span
                        aria-hidden
                        className={[
                          'text-primary transition-opacity',
                          isActive ? 'opacity-100' : 'opacity-0 group-hover:opacity-80',
                        ].join(' ')}
                      >
                        ›
                      </span>
                      <span className="text-sm leading-snug">“{t.label}”</span>
                    </button>
                  </li>
                );
              })}
            </ul>
            {activeTopicId && (
              <div className="flex justify-end pt-1">
                <button
                  onClick={() => setActiveTopicId(null)}
                  className="text-xs italic font-display text-muted-foreground hover:text-primary transition-colors"
                >
                  ‹ say nothing more
                </button>
              </div>
            )}
          </div>
        )}




        <div className="space-y-3">
          <div className="space-y-1">
            <div className="flex items-center justify-between text-xs">
              <span className="font-display text-foreground">{hallLabel} Bond</span>
              <span className="text-muted-foreground">{hallBond} / 100</span>
            </div>
            <Progress value={hallBond} className="h-2" />
            <p className="text-[10px] text-muted-foreground italic">
              Bond grows as you fight, explore, and complete deeds while serving this order.
            </p>
          </div>

          {bonds.length > 0 && (
            <details className="text-xs">
              <summary className="cursor-pointer text-muted-foreground font-display">Your other bonds</summary>
              <ul className="mt-2 space-y-1 pl-2">
                {bonds.filter(b => b.class !== hallClass).map(b => (
                  <li key={b.class} className="flex justify-between text-[11px]">
                    <span>{CLASS_LABELS[b.class] ?? b.class}</span>
                    <span className="text-muted-foreground">{b.bond}</span>
                  </li>
                ))}
                {bonds.filter(b => b.class !== hallClass).length === 0 && (
                  <li className="text-[11px] text-muted-foreground/70 italic">No other bonds yet.</li>
                )}
              </ul>
            </details>
          )}
        </div>

        {currentClass && !isCurrent && (() => {
          const oldLabel = CLASS_LABELS[currentClass] ?? currentClass;
          const oldBond = bonds.find(b => b.class === currentClass)?.bond ?? 0;
          return (
            <div className="rounded border border-destructive/40 bg-destructive/10 p-2 text-xs">
              <p className="text-destructive font-display">⚠ Switching resets your {oldLabel} Bond ({oldBond} → 0).</p>
              <p className="text-[10px] text-muted-foreground mt-1">The old order will remember you no more.</p>
            </div>
          );
        })()}

        <div className="flex justify-end gap-2 pt-2">
          <Button variant="ghost" onClick={onClose} disabled={acting}>Leave</Button>
          <Button
            onClick={handleJoin}
            disabled={acting || loading || isCurrent}
            variant={currentClass && !isCurrent ? 'destructive' : 'default'}
            className="font-display"
          >
            {isCurrent ? `Already a ${hallLabel}` : currentClass ? `Switch to ${hallLabel}` : `Join the ${hallLabel} Order`}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
