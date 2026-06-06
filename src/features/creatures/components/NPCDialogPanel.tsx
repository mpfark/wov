import { useMemo, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { NPC } from '@/features/creatures';
import {
  expandTopics,
  parseTopics,
  resolveTopic,
  type ResolverContext,
} from '@/features/creatures/utils/dialogue-topics';

interface Props {
  npc: NPC | null;
  open: boolean;
  onClose: () => void;
  /** World context for resolving dynamic topics (directions, etc.). */
  worldContext?: ResolverContext;
}

export default function NPCDialogPanel({ npc, open, onClose, worldContext }: Props) {
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

  if (!npc) return null;

  const spokenLine = activeTopic?.response ?? npc.dialogue ?? '...';

  return (
    <Dialog
      open={open}
      onOpenChange={v => {
        if (!v) {
          setActiveTopicId(null);
          onClose();
        }
      }}
    >
      <DialogContent className="sm:max-w-md border-primary/30 bg-card">
        <DialogHeader>
          <DialogTitle className="font-display text-primary text-glow flex items-center gap-2">
            💬 {npc.name}
          </DialogTitle>
          {npc.description && (
            <DialogDescription className="text-xs italic">{npc.description}</DialogDescription>
          )}
        </DialogHeader>

        <div className="p-3 bg-background/50 rounded border border-border min-h-[80px]">
          <p className="text-sm text-foreground/90 leading-relaxed whitespace-pre-wrap">
            {spokenLine}
          </p>
        </div>

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
                <Button
                  variant="ghost"
                  size="sm"
                  className="self-end text-xs"
                  onClick={() => setActiveTopicId(null)}
                >
                  ← Back
                </Button>
              )}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
