import { useState } from 'react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Search, Users } from 'lucide-react';
import { AdminEntityToolbar } from '../common';
import { ROLE_BADGE_COLORS, formatRelativeTime } from './constants';
import type { AdminUser } from './constants';

interface Props {
  users: AdminUser[];
  total: number;
  loading: boolean;
  page: number;
  setPage: (fn: (p: number) => number) => void;
  selectedUserId: string | null;
  onSelectUser: (id: string) => void;
}

export default function UserListColumn({ users, total, loading, page, setPage, selectedUserId, onSelectUser }: Props) {
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState<string>('all');

  const filteredUsers = users.filter(u => {
    const matchesSearch = !search || 
      u.email.toLowerCase().includes(search.toLowerCase()) ||
      (u.profile?.display_name || '').toLowerCase().includes(search.toLowerCase()) ||
      u.characters.some(c => c.name.toLowerCase().includes(search.toLowerCase()));
    const matchesRole = roleFilter === 'all' || u.role === roleFilter;
    return matchesSearch && matchesRole;
  });

  const roleBadge = (role: string) => (
    <Badge variant="outline" className={`text-[10px] ${ROLE_BADGE_COLORS[role] || ROLE_BADGE_COLORS.player}`}>{role}</Badge>
  );

  return (
    <div className="w-56 shrink-0 border-r border-border flex flex-col">
      <AdminEntityToolbar icon={<Users className="w-4 h-4" />} title="Users" count={total}>
        <div className="relative flex-1">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
          <Input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search..."
            className="pl-8 h-7 text-xs"
          />
        </div>
      </AdminEntityToolbar>

      {/* Role filter */}
      <div className="px-3 py-1.5 border-b border-border">
        <Select value={roleFilter} onValueChange={setRoleFilter}>
          <SelectTrigger className="h-6 text-[10px]">
            <SelectValue placeholder="All roles" />
          </SelectTrigger>
          <SelectContent className="bg-popover border-border z-50">
            <SelectItem value="all" className="text-xs">All Roles</SelectItem>
            <SelectItem value="player" className="text-xs">Player</SelectItem>
            <SelectItem value="steward" className="text-xs">Steward</SelectItem>
            <SelectItem value="overlord" className="text-xs">Overlord</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <ScrollArea className="flex-1">
        {loading ? (
          <p className="text-xs text-muted-foreground text-center py-8">Loading...</p>
        ) : filteredUsers.map(u => {
          const isBanned = u.banned_until && new Date(u.banned_until) > new Date();
          const isSelected = selectedUserId === u.id;
          return (
            <div
              key={u.id}
              className={`px-3 py-2 cursor-pointer border-b border-border transition-colors hover:bg-accent/10 ${
                isSelected ? 'bg-accent/20 border-l-2 border-l-primary' : ''
              }`}
              onClick={() => onSelectUser(u.id)}
            >
              <div className="flex items-center gap-1.5">
                <span className="text-xs font-display text-foreground truncate flex-1">
                  {u.profile?.display_name || u.email.split('@')[0]}
                </span>
                {roleBadge(u.role)}
              </div>
              <div className="flex items-center justify-between mt-0.5">
                <span className="text-[10px] text-muted-foreground truncate">{u.email}</span>
                <span className="text-[10px] text-muted-foreground shrink-0 ml-1">
                  {u.characters.length}ch
                </span>
              </div>
              <div className="text-[9px] text-muted-foreground/60 mt-0.5">
                Active {formatRelativeTime(u.last_sign_in_at)}
              </div>
              {isBanned && <Badge variant="destructive" className="text-[9px] mt-0.5">Banned</Badge>}
            </div>
          );
        })}
      </ScrollArea>

      {total > 50 && (
        <div className="flex items-center justify-center gap-2 p-2 border-t border-border">
          <Button size="sm" variant="outline" className="h-6 text-[10px]"
            disabled={page <= 1} onClick={() => setPage(p => p - 1)}>Prev</Button>
          <span className="text-[10px] text-muted-foreground">P{page}</span>
          <Button size="sm" variant="outline" className="h-6 text-[10px]"
            disabled={users.length < 50} onClick={() => setPage(p => p + 1)}>Next</Button>
        </div>
      )}
    </div>
  );
}
