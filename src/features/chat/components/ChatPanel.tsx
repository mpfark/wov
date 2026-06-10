/**
 * Owns: wide-screen right column hosting Chat and Online tabs (display-only).
 */
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { MessageCircle } from 'lucide-react';
import { getLogColor } from '@/features/combat/utils/combat-log-utils';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { ScrollArea } from '@/components/ui/scroll-area';
import { OnlinePlayer } from '@/hooks/useGlobalPresence';
import { formatCharacterName } from '@/lib/character-name';
import { getCharacterTitle } from '@/lib/game-data';

const RACE_LABELS: Record<string, string> = {
  human: 'Human', elf: 'Elf', dwarf: 'Dwarf', halfling: 'Halfling', edain: 'Edain', half_elf: 'Half-Elf',
};
const CLASS_LABELS: Record<string, string> = {
  warrior: 'Warrior', wizard: 'Wizard', ranger: 'Ranger', rogue: 'Rogue', healer: 'Healer', bard: 'Bard',
};

interface ChatPanelProps {
  messages: string[];
  onClose: () => void;
  onlinePlayers: OnlinePlayer[];
  myCharacterId?: string;
}

type TabValue = 'chat' | 'online';

export default function ChatPanel({
  messages, onClose, onlinePlayers, myCharacterId,
}: ChatPanelProps) {
  const [tab, setTab] = useState<TabValue>(() => {
    const saved = localStorage.getItem('chatPanelTab');
    return (saved === 'online' ? 'online' : 'chat');
  });
  useEffect(() => { localStorage.setItem('chatPanelTab', tab); }, [tab]);

  return (
    <div className="h-full w-full ornate-border bg-card/60 flex flex-col min-w-0">
      <Tabs value={tab} onValueChange={(v) => setTab(v as TabValue)} className="flex-1 min-h-0 flex flex-col">
        <div className="px-2 py-1.5 border-b border-border-subtle shrink-0 flex items-center justify-between gap-2">
          <TabsList className="h-7 p-0.5">
            <TabsTrigger value="chat" className="h-6 text-[11px] px-2 font-display">Chat</TabsTrigger>
            <TabsTrigger value="online" className="h-6 text-[11px] px-2 font-display">
              Online <span className="ml-1 text-primary">{onlinePlayers.length}</span>
            </TabsTrigger>
          </TabsList>
          <Button
            variant="ghost"
            size="icon"
            className="w-6 h-6 shrink-0"
            onClick={() => { onClose(); localStorage.setItem('chatPanelOpen', 'false'); }}
            title="Collapse chat panel"
          >
            <MessageCircle className="w-3 h-3" />
          </Button>
        </div>

        <TabsContent value="chat" className="flex-1 min-h-0 m-0 data-[state=inactive]:hidden">
          <div className="h-full overflow-y-auto p-2 gap-row">
            {messages.length === 0 ? (
              <p className="text-xs text-muted-foreground italic">No messages yet. Press Enter to chat.</p>
            ) : (
              messages.map((log, i) => (
                <p key={i} className={`text-xs ${getLogColor(log)}`}>{log}</p>
              ))
            )}
          </div>
        </TabsContent>

        <TabsContent value="online" className="flex-1 min-h-0 m-0 data-[state=inactive]:hidden">
          <ScrollArea className="h-full">
            {onlinePlayers.length === 0 ? (
              <p className="text-xs text-muted-foreground italic p-2">No adventurers found...</p>
            ) : (
              <ul className="divide-y divide-border-subtle">
                {onlinePlayers.map(p => {
                  const title = getCharacterTitle(p.level, p.gender, !!p.is_king_slayer);
                  const isMe = p.id === myCharacterId;
                  return (
                    <li
                      key={p.id}
                      className={`px-2 py-1.5 flex items-center gap-2 ${isMe ? 'bg-primary/5' : ''}`}
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex items-baseline gap-1.5">
                          <span className="text-xs font-display truncate">
                            {formatCharacterName(p)}
                          </span>
                          {isMe && <span className="text-[9px] text-muted-foreground">(you)</span>}
                        </div>
                        <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
                          {title && (
                            <span className={`font-display tracking-wider uppercase ${p.is_king_slayer ? 'text-soulforged text-glow-soulforged' : 'text-primary/70'}`}>
                              {title}
                            </span>
                          )}
                          {title && <span>·</span>}
                          <span>{RACE_LABELS[p.race] || p.race}</span>
                          <span>·</span>
                          <span>{CLASS_LABELS[p.class] || p.class}</span>
                        </div>
                      </div>
                      <span className="text-xs font-display text-primary shrink-0">L{p.level}</span>
                    </li>
                  );
                })}
              </ul>
            )}
          </ScrollArea>
        </TabsContent>
      </Tabs>
    </div>
  );
}
