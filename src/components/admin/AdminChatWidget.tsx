import { useState, useEffect, useRef, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { MessageCircle, X, Send, ChevronDown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';

interface ChatLine {
  id: number;
  text: string;
  timestamp: number;
}

let msgId = 0;

export default function AdminChatWidget() {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<ChatLine[]>([]);
  const [input, setInput] = useState('');
  const [charId, setCharId] = useState<string | null>(null);
  const [charName, setCharName] = useState('');
  const [nodeId, setNodeId] = useState<string | null>(null);
  const [unread, setUnread] = useState(0);
  const bottomRef = useRef<HTMLDivElement>(null);
  const openRef = useRef(open);
  openRef.current = open;

  // Load admin's first character
  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { data } = await supabase
        .from('characters')
        .select('id, name, current_node_id')
        .eq('user_id', user.id)
        .order('last_online', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (data) {
        setCharId(data.id);
        setCharName(data.name);
        setNodeId(data.current_node_id);
      }
    })();
  }, []);

  const addMsg = useCallback((text: string) => {
    setMessages(prev => [...prev.slice(-99), { id: ++msgId, text, timestamp: Date.now() }]);
    if (!openRef.current) setUnread(u => u + 1);
  }, []);

  // Subscribe to node say channel
  useEffect(() => {
    if (!nodeId || !charId) return;
    const channel = supabase.channel(`chat-node-${nodeId}`);
    channel
      .on('broadcast', { event: 'say' }, ({ payload }) => {
        if (payload.senderId === charId) return;
        addMsg(`💬 ${payload.senderName}: ${payload.text}`);
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [nodeId, charId, addMsg]);

  // Subscribe to whisper channel
  useEffect(() => {
    if (!charId) return;
    const channel = supabase.channel(`chat-whisper-${charId}`);
    channel
      .on('broadcast', { event: 'whisper' }, ({ payload }) => {
        addMsg(`🤫 ${payload.senderName} whispers: ${payload.text}`);
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [charId, addMsg]);

  // Poll node changes (admin might have moved the char elsewhere)
  useEffect(() => {
    if (!charId) return;
    const interval = setInterval(async () => {
      const { data } = await supabase
        .from('characters')
        .select('current_node_id')
        .eq('id', charId)
        .maybeSingle();
      if (data && data.current_node_id !== nodeId) {
        setNodeId(data.current_node_id);
      }
    }, 30000);
    return () => clearInterval(interval);
  }, [charId, nodeId]);

  // Auto-scroll
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSend = () => {
    const text = input.trim();
    if (!text || !charId) return;
    setInput('');

    if (text.startsWith('/w ') || text.startsWith('/whisper ')) {
      const parts = text.startsWith('/w ') ? text.slice(3) : text.slice(9);
      const spaceIdx = parts.indexOf(' ');
      if (spaceIdx <= 0) return;
      const targetName = parts.slice(0, spaceIdx);
      const msg = parts.slice(spaceIdx + 1).trim();
      if (!msg) return;

      // We don't have full online players list, so just send blindly
      const targetChannel = supabase.channel(`chat-whisper-search-${targetName}-${Date.now()}`);
      // We need to find the character id by name
      (async () => {
        const { data } = await supabase
          .from('characters')
          .select('id')
          .ilike('name', targetName)
          .limit(1)
          .maybeSingle();
        if (!data) {
          addMsg(`⚠️ Player "${targetName}" not found.`);
          return;
        }
        const ch = supabase.channel(`chat-whisper-${data.id}`);
        ch.subscribe((status) => {
          if (status === 'SUBSCRIBED') {
            ch.send({
              type: 'broadcast',
              event: 'whisper',
              payload: { senderId: charId, senderName: charName, text: msg },
            });
            setTimeout(() => supabase.removeChannel(ch), 2000);
          }
        });
        addMsg(`🤫 To ${targetName}: ${msg}`);
      })();
      return;
    }

    // Say message
    if (nodeId) {
      const channel = supabase.channel(`chat-node-${nodeId}`);
      channel.subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          channel.send({
            type: 'broadcast',
            event: 'say',
            payload: { senderId: charId, senderName: charName, text },
          });
          setTimeout(() => supabase.removeChannel(channel), 2000);
        }
      });
    }
    addMsg(`💬 ${charName}: ${text}`);
  };

  if (!charId) return null;

  return (
    <div className="fixed bottom-4 right-4 z-50">
      {!open && (
        <Button
          size="icon"
          className="rounded-full w-12 h-12 shadow-lg relative"
          onClick={() => { setOpen(true); setUnread(0); }}
        >
          <MessageCircle className="w-5 h-5" />
          {unread > 0 && (
            <span className="absolute -top-1 -right-1 bg-destructive text-destructive-foreground text-[10px] rounded-full w-5 h-5 flex items-center justify-center font-bold">
              {unread > 9 ? '9+' : unread}
            </span>
          )}
        </Button>
      )}

      {open && (
        <div className="w-80 h-96 bg-card border border-border rounded-lg shadow-xl flex flex-col overflow-hidden">
          {/* Header */}
          <div className="flex items-center justify-between px-3 py-2 border-b border-border bg-muted/50">
            <span className="text-xs font-display text-primary">
              💬 Chat — {charName}
            </span>
            <Button variant="ghost" size="icon" className="w-6 h-6" onClick={() => setOpen(false)}>
              <X className="w-3 h-3" />
            </Button>
          </div>

          {/* Messages */}
          <ScrollArea className="flex-1 px-3 py-2">
            {messages.length === 0 && (
              <p className="text-[10px] text-muted-foreground text-center mt-8">
                Listening for say &amp; whisper messages...
              </p>
            )}
            {messages.map(m => (
              <p key={m.id} className={cn(
                "text-[11px] leading-tight mb-1",
                m.text.startsWith('🤫') ? 'text-purple-400' :
                m.text.startsWith('💬') ? 'text-blue-300' :
                m.text.startsWith('⚠️') ? 'text-yellow-400' :
                'text-foreground'
              )}>
                {m.text}
              </p>
            ))}
            <div ref={bottomRef} />
          </ScrollArea>

          {/* Input */}
          <form
            className="flex items-center gap-1 p-2 border-t border-border"
            onSubmit={(e) => { e.preventDefault(); handleSend(); }}
          >
            <Input
              value={input}
              onChange={e => setInput(e.target.value)}
              placeholder="Say or /w name msg"
              className="h-7 text-xs flex-1"
              autoFocus
            />
            <Button type="submit" size="icon" className="w-7 h-7 shrink-0">
              <Send className="w-3 h-3" />
            </Button>
          </form>
        </div>
      )}
    </div>
  );
}
