/**
 * Owns: the unified command/chat input bar, rendered below the event log.
 * Supports command history navigation with ArrowUp/Down and draft preservation.
 */
import { RefObject, useState, useRef, useCallback } from 'react';
import { Input } from '@/components/ui/input';

const MAX_HISTORY = 20;

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
  const [history] = useState<string[]>(() => []);
  const historyIndexRef = useRef(-1);
  const draftRef = useRef('');

  const pushHistory = useCallback((entry: string) => {
    if (!entry.trim()) return;
    // Avoid duplicating the last entry
    if (history.length > 0 && history[history.length - 1] === entry) return;
    history.push(entry);
    if (history.length > MAX_HISTORY) history.shift();
  }, [history]);

  const handleSubmit = useCallback(() => {
    pushHistory(chatInput.trim());
    historyIndexRef.current = -1;
    draftRef.current = '';
    onChatSubmit();
  }, [chatInput, onChatSubmit, pushHistory]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleSubmit();
      return;
    }
    if (e.key === 'Escape') {
      onChatInputChange('');
      chatInputRef.current?.blur();
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (history.length === 0) return;
      if (historyIndexRef.current === -1) {
        // Entering history — save current draft
        draftRef.current = chatInput;
        historyIndexRef.current = history.length - 1;
      } else if (historyIndexRef.current > 0) {
        historyIndexRef.current -= 1;
      }
      onChatInputChange(history[historyIndexRef.current]);
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (historyIndexRef.current === -1) return;
      if (historyIndexRef.current < history.length - 1) {
        historyIndexRef.current += 1;
        onChatInputChange(history[historyIndexRef.current]);
      } else {
        // Past newest entry — restore draft
        historyIndexRef.current = -1;
        onChatInputChange(draftRef.current);
      }
      return;
    }
  }, [chatInput, history, onChatInputChange, chatInputRef, handleSubmit]);

  const wrapper = isMobile
    ? 'fixed bottom-0 left-0 right-0 z-40 px-3 pb-[env(safe-area-inset-bottom,8px)] pt-1 bg-card/95 border-t border-border'
    : 'shrink-0 px-3 pb-2 pt-1';

  return (
    <div className={wrapper}>
      <Input
        ref={chatInputRef}
        value={chatInput}
        onChange={e => onChatInputChange(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="Type a command or message... (/w name to whisper)"
        className="h-7 text-xs bg-background/50 border-border"
        autoComplete="off"
      />
    </div>
  );
}
