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
          <DialogTitle className="font-display text-primary text-glow flex items-center gap-2">
            🏰 {npc?.name ?? 'Recruiter'} — {hallLabel} Hall
          </DialogTitle>
          {npc?.description && (
            <DialogDescription className="text-xs italic">{npc.description}</DialogDescription>
          )}
        </DialogHeader>

        {(npc?.dialogue || activeTopic) && (
          <div className="p-3 bg-background/50 rounded border border-border">
            <p className="text-sm text-foreground/90 leading-relaxed whitespace-pre-wrap">
              {activeTopic?.response ?? npc?.dialogue}
            </p>
          </div>
        )}

        {topics.length > 0 && (
          <div className="space-y-1.5">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-display">
              Ask about
            </p>
            <div className="flex flex-col gap-1.5">
              {topics.map(t => (
                <Button
                  key={t.id}
                  variant={activeTopicId === t.id ? 'secondary' : 'outline'}
                  size="sm"
                  className="justify-start text-left h-auto py-2 font-normal"
                  onClick={() => setActiveTopicId(t.id)}
                >
                  <span className="text-xs">“{t.label}”</span>
                </Button>
              ))}
              {activeTopicId && (
                <Button variant="ghost" size="sm" className="self-end text-xs" onClick={() => setActiveTopicId(null)}>
                  ← Back
                </Button>
              )}
            </div>
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
