import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { NPC } from '@/features/creatures';
import { supabase } from '@/integrations/supabase/client';
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
  /** Called after a contract is taken/abandoned so character state can refetch. */
  onContractChanged?: () => void;
}

export default function NPCDialogPanel({ npc, open, onClose, worldContext, onContractChanged }: Props) {
  const [activeTopicId, setActiveTopicId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const topics = useMemo(() => {
    if (!npc || !worldContext) return [];
    return expandTopics(parseTopics(npc.dialogue_topics), worldContext);
  }, [npc, worldContext]);

  const activeTopic = useMemo(() => {
    if (!activeTopicId || !worldContext) return null;
    const t = topics.find(x => x.id === activeTopicId);
    return t ? { raw: t, resolved: resolveTopic(t, worldContext) } : null;
  }, [activeTopicId, topics, worldContext]);

  if (!npc) return null;

  const spokenLine = activeTopic?.resolved.response ?? npc.dialogue ?? '...';

  const character = worldContext?.character;
  const isAssassinContractTopic = activeTopic?.raw.kind === 'assassin_contract';
  const isAssassin = character?.class === 'assassin';
  const hasActiveContract = !!character?.active_contract;

  async function takeContract() {
    if (!character) return;
    setBusy(true);
    if (character.active_contract) {
      const { error: abErr } = await supabase.rpc('assassin_abandon_contract', { _character_id: character.id });
      if (abErr) { setBusy(false); toast.error(abErr.message); return; }
    }
    const { data, error } = await supabase.rpc('assassin_take_contract', { _character_id: character.id });
    setBusy(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    const c = data as any;
    toast.success(`Contract: ${c?.creature_name ?? 'target'} (lvl ${c?.target_level ?? '?'}) in ${c?.area_name ?? 'the field'}`);
    onContractChanged?.();
  }


  async function abandonContract() {
    if (!character) return;
    setBusy(true);
    const { error } = await supabase.rpc('assassin_abandon_contract', { _character_id: character.id });
    setBusy(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.message('Contract abandoned.');
    onContractChanged?.();
  }

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

          {isAssassinContractTopic && isAssassin && (
            <div className="mt-3 flex gap-2">
              {!hasActiveContract && (
                <Button size="sm" disabled={busy} onClick={takeContract}>
                  🗡️ Take a contract
                </Button>
              )}
              {hasActiveContract && (
                <>
                  <Button size="sm" variant="outline" disabled={busy} onClick={takeContract} title="Take a new contract">
                    🔄 Re-roll (abandons current)
                  </Button>
                  <Button size="sm" variant="ghost" disabled={busy} onClick={abandonContract}>
                    ✖ Abandon
                  </Button>
                </>
              )}
            </div>
          )}
          {isAssassinContractTopic && hasActiveContract && (
            <p className="mt-2 text-[10px] text-muted-foreground">
              Lifetime contracts completed: <b>{character?.contracts_completed ?? 0}</b>
            </p>
          )}
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
