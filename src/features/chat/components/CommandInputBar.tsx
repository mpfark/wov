/**
 * Owns: the unified command/chat input bar, rendered below the event log.
 */
import { RefObject } from 'react';
import { Input } from '@/components/ui/input';

interface CommandInputBarProps {
  chatInput: string;
  onChatInputChange: (value: string) => void;
  onChatSubmit: () => void;
  chatInputRef: RefObject<HTMLInputElement>;
  isMobile?: boolean;
}

export default function CommandInputBar({
  chatInput, onChatInputChange, onChatSubmit, chatInputRef, isMobile,
}: CommandInputBarProps) {
  const wrapper = isMobile
    ? 'fixed bottom-0 left-0 right-0 z-40 px-3 pb-[env(safe-area-inset-bottom,8px)] pt-1 bg-card/95 border-t border-border'
    : 'shrink-0 px-3 pb-2 pt-1';

  return (
    <div className={wrapper}>
      <Input
        ref={chatInputRef}
        value={chatInput}
        onChange={e => onChatInputChange(e.target.value)}
        onKeyDown={e => {
          if (e.key === 'Enter') { e.preventDefault(); onChatSubmit(); }
          if (e.key === 'Escape') {
            onChatInputChange('');
            chatInputRef.current?.blur();
          }
        }}
        placeholder="Type a command or message... (/w name to whisper)"
        className="h-7 text-xs bg-background/50 border-border"
        autoComplete="off"
      />
    </div>
  );
}
