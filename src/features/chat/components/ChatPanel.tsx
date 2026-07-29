/**
 * Owns: right-side viewport gutter panel showing chat messages (display-only).
 *
 * Shares the line renderer with the Event Log (EventLogLine) so emoji
 * suppression and classification live in one place, but uses the `chat`
 * variant so conversation keeps its own presentation — no combat colours,
 * no left-edge accent, no markers.
 */
import { Button } from '@/components/ui/button';
import { MessageCircle } from 'lucide-react';
import EventLogLine from '@/features/combat/components/EventLogLine';
import type { GameLogEvent } from '@/features/combat/events/log-event';


interface ChatPanelProps {
  messages: GameLogEvent[];
  onClose: () => void;
}

export default function ChatPanel({ messages, onClose }: ChatPanelProps) {
  return (
    <div className="h-full w-full ornate-border bg-card/60 flex flex-col min-w-0">
      <div className="px-2 py-1.5 border-b border-border-subtle shrink-0 flex items-center justify-between gap-2">
        <div className="text-[11px] font-display px-1">Chat</div>
        <Button
          variant="ghost"
          size="icon"
          className="w-6 h-6 shrink-0"
          onClick={onClose}
          title="Collapse chat panel"
        >
          <MessageCircle className="w-3 h-3" />
        </Button>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto p-2 gap-row">
        {messages.length === 0 ? (
          <p className="text-xs text-muted-foreground italic">No messages yet. Press Enter to chat.</p>
        ) : (
          messages.map((event, i) => (
            <EventLogLine key={event.id || i} event={event} variant="chat" className="text-xs" />
          ))

        )}
      </div>
    </div>
  );
}
