/**
 * Owns: left-side viewport gutter panel showing online players (display-only).
 */
import { Button } from '@/components/ui/button';
import { Users } from 'lucide-react';
import { ScrollArea } from '@/components/ui/scroll-area';
import { OnlinePlayer } from '@/hooks/useGlobalPresence';
import { formatCharacterName } from '@/lib/character-name';
import { getCharacterTitle } from '@/lib/game-data';

const RACE_LABELS: Record<string, string> = {
  human: 'Human', elf: 'Elf', dwarf: 'Dwarf', halfling: 'Halfling', edain: 'Edain', half_elf: 'Half-Elf',
};
const CLASS_LABELS: Record<string, string> = {
  warrior: 'Warrior', wizard: 'Wizard', ranger: 'Ranger', assassin: 'Assassin', healer: 'Healer', bard: 'Bard',
};

interface OnlinePanelProps {
  onlinePlayers: OnlinePlayer[];
  myCharacterId?: string;
  onClose: () => void;
}

export default function OnlinePanel({ onlinePlayers, myCharacterId, onClose }: OnlinePanelProps) {
  return (
    <div className="h-full w-full ornate-border bg-card/60 flex flex-col min-w-0">
      <div className="px-2 py-1.5 border-b border-border-subtle shrink-0 flex items-center justify-between gap-2">
        <div className="text-[11px] font-display px-1">
          Online <span className="ml-1 text-primary">{onlinePlayers.length}</span>
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="w-6 h-6 shrink-0"
          onClick={onClose}
          title="Collapse online players panel"
        >
          <Users className="w-3 h-3" />
        </Button>
      </div>

      <ScrollArea className="flex-1 min-h-0">
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
    </div>
  );
}
