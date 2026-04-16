import { useState, useMemo } from 'react';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Search, ScrollText } from 'lucide-react';
import { AdminEntityToolbar } from '../common';
import { useActivityLog } from '@/hooks/useActivityLog';
import { EVENT_TYPE_ICONS, EVENT_TYPE_COLORS, EVENT_TYPE_CATEGORIES, formatDateGroup } from './constants';

interface Props {
  userId: string | null;
}

export default function ActivityLogColumn({ userId }: Props) {
  const { logs, loading } = useActivityLog(userId, 100);
  const [filter, setFilter] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<string>('all');

  const filteredLogs = useMemo(() => {
    let result = logs;

    // Category filter
    if (categoryFilter !== 'all') {
      const allowedTypes = EVENT_TYPE_CATEGORIES[categoryFilter] || [];
      result = result.filter(l => allowedTypes.includes(l.event_type));
    }

    // Text filter
    if (filter) {
      result = result.filter(l =>
        l.message.toLowerCase().includes(filter.toLowerCase()) ||
        l.event_type.toLowerCase().includes(filter.toLowerCase())
      );
    }

    return result;
  }, [logs, filter, categoryFilter]);

  // Group by date
  const groupedLogs = useMemo(() => {
    const groups: { date: string; logs: typeof filteredLogs }[] = [];
    let currentDate = '';

    for (const log of filteredLogs) {
      const dateKey = new Date(log.created_at).toDateString();
      if (dateKey !== currentDate) {
        currentDate = dateKey;
        groups.push({ date: log.created_at, logs: [] });
      }
      groups[groups.length - 1].logs.push(log);
    }

    return groups;
  }, [filteredLogs]);

  return (
    <div className="flex-1 flex flex-col border-l border-border">
      <AdminEntityToolbar icon={<ScrollText className="w-4 h-4" />} title="Activity" count={logs.length}>
      </AdminEntityToolbar>

      {userId && (
        <div className="px-3 py-1.5 border-b border-border space-y-1.5">
          <div className="relative">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-muted-foreground" />
            <Input
              value={filter}
              onChange={e => setFilter(e.target.value)}
              placeholder="Filter logs..."
              className="pl-7 h-6 text-[10px]"
            />
          </div>
          <Select value={categoryFilter} onValueChange={setCategoryFilter}>
            <SelectTrigger className="h-6 text-[10px]">
              <SelectValue placeholder="All events" />
            </SelectTrigger>
            <SelectContent className="bg-popover border-border z-50">
              <SelectItem value="all" className="text-xs">All Events</SelectItem>
              {Object.keys(EVENT_TYPE_CATEGORIES).map(cat => (
                <SelectItem key={cat} value={cat} className="text-xs">{cat}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      <ScrollArea className="flex-1">
        {!userId ? (
          <div className="flex items-center justify-center h-32 text-[10px] text-muted-foreground">
            Select a user
          </div>
        ) : loading ? (
          <div className="flex items-center justify-center h-32 text-[10px] text-muted-foreground animate-pulse">
            Loading logs...
          </div>
        ) : filteredLogs.length === 0 ? (
          <div className="flex items-center justify-center h-32 text-[10px] text-muted-foreground italic">
            No activity yet
          </div>
        ) : (
          <div>
            {groupedLogs.map((group, gi) => (
              <div key={gi}>
                {/* Date separator */}
                <div className="px-3 py-1 bg-muted/30 border-b border-border">
                  <span className="text-[9px] font-display text-muted-foreground uppercase tracking-wider">
                    {formatDateGroup(group.date)}
                  </span>
                </div>
                <div className="divide-y divide-border">
                  {group.logs.map(log => {
                    const icon = EVENT_TYPE_ICONS[log.event_type] || EVENT_TYPE_ICONS.general;
                    const colorClass = EVENT_TYPE_COLORS[log.event_type] || 'text-foreground';
                    const time = new Date(log.created_at);
                    const timeStr = time.toLocaleTimeString('en-US', {
                      hour: '2-digit', minute: '2-digit',
                    });
                    return (
                      <div key={log.id} className="px-3 py-1.5 hover:bg-accent/10 transition-colors">
                        <div className="flex items-start gap-1.5">
                          <span className="text-xs leading-none mt-0.5">{icon}</span>
                          <div className="flex-1 min-w-0">
                            <p className={`text-[10px] leading-tight ${colorClass}`}>{log.message}</p>
                            <div className="flex items-center gap-1.5 mt-0.5">
                              <span className="text-[9px] text-muted-foreground/60">{timeStr}</span>
                              <Badge variant="outline" className="text-[8px] px-1 py-0 h-3.5 border-border/50">
                                {log.event_type}
                              </Badge>
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
      </ScrollArea>
    </div>
  );
}
