import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';

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
          <DialogTitle className="font-display text-primary text-glow text-center tracking-wide">
            — {npc.name} —
          </DialogTitle>
          {npc.description && (
            <DialogDescription className="text-xs italic text-center">{npc.description}</DialogDescription>
          )}
        </DialogHeader>

        <div className="px-4 py-3 bg-background/40 rounded border border-border/60 min-h-[80px] relative">
          <span aria-hidden className="absolute -top-1 left-2 font-display text-2xl text-primary/40 leading-none select-none">“</span>
          <p className="text-sm text-foreground/90 leading-relaxed whitespace-pre-wrap italic font-display px-3">
            {spokenLine}
          </p>
          <span aria-hidden className="absolute -bottom-3 right-2 font-display text-2xl text-primary/40 leading-none select-none">”</span>

          {isAssassinContractTopic && isAssassin && (
            <div className="mt-4 flex justify-end items-center gap-3 text-xs font-display">
              {!hasActiveContract && (
                <button
                  disabled={busy}
                  onClick={takeContract}
                  className="text-primary hover:text-glow transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  🗡️ Take a contract
                </button>
              )}
              {hasActiveContract && (
                <>
                  <button
                    disabled={busy}
                    onClick={takeContract}
                    title="Take a new contract"
                    className="text-primary/90 hover:text-primary hover:text-glow transition-all disabled:opacity-50"
                  >
                    🔄 Re-roll
                  </button>
                  <span className="text-border">·</span>
                  <button
                    disabled={busy}
                    onClick={abandonContract}
                    className="text-muted-foreground hover:text-destructive transition-all disabled:opacity-50"
                  >
                    ✖ Abandon
                  </button>
                </>
              )}
            </div>
          )}
          {isAssassinContractTopic && hasActiveContract && (
            <p className="mt-2 text-[10px] text-muted-foreground text-right">
              Lifetime contracts completed: <b>{character?.contracts_completed ?? 0}</b>
            </p>
          )}
        </div>

        {topics.length > 0 && (
          <div className="space-y-2 pt-1">
            <div className="flex items-center gap-2 text-muted-foreground/70">
              <span className="h-px flex-1 bg-border" />
              <span className="text-[10px] uppercase tracking-[0.2em] font-display">— speak —</span>
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
      </DialogContent>
    </Dialog>
  );
}

