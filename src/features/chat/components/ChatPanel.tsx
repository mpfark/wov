/**
 * Owns: wide-screen chat message list and chat input rendering.
 */
import { RefObject } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { MessageCircle } from 'lucide-react';
import { getLogColor } from '@/features/combat/utils/combat-log-utils';

interface ChatPanelProps {
  messages: string[];
  chatInput: string;
  onChatInputChange: (value: string) => void;
  onChatSubmit: () => void;
  onClose: () => void;
  chatInputRef: RefObject<HTMLInputElement>;
}

export default function ChatPanel({
  messages, chatInput, onChatInputChange, onChatSubmit, onClose, chatInputRef,
}: ChatPanelProps) {
  return (
    <div className="h-full w-[320px] shrink-0 ornate-border bg-card/60 flex flex-col">
      <div className="px-3 py-2 border-b border-border shrink-0 flex items-center justify-between">
        <h3 className="font-display text-xs text-muted-foreground">Chat</h3>
        <Button
          variant="ghost"
          size="icon"
          className="w-6 h-6"
          onClick={() => { onClose(); localStorage.setItem('chatPanelOpen', 'false'); }}
          title="Collapse chat panel"
        >
          <MessageCircle className="w-3 h-3" />
        </Button>
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto p-2 space-y-0.5">
        {messages.length === 0 ? (
          <p className="text-xs text-muted-foreground italic">No messages yet. Press Enter to chat.</p>
        ) : (
          messages.map((log, i) => (
            <p key={i} className={`text-xs ${getLogColor(log)}`}>{log}</p>
          ))
        )}
      </div>
      <div className="shrink-0 px-2 pb-2">
        <Input
          ref={chatInputRef}
          value={chatInput}
          onChange={e => onChatInputChange(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter') { e.preventDefault(); onChatSubmit(); }
            if (e.key === 'Escape') { onChatInputChange(''); }
          }}
          placeholder="/w name msg to whisper"
          className="h-7 text-xs bg-background/50 border-border"
          autoComplete="off"
        />
      </div>
    </div>
  );
}
