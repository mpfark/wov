import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { toast } from 'sonner';
import { Search, KeyRound, Shield, Ban, UserCheck, Pencil, Save, X, ScrollText } from 'lucide-react';
import { CLASS_LABELS, RACE_LABELS } from '@/lib/game-data';

interface AdminUser {
  id: string;
  email: string;
  created_at: string;
  last_sign_in_at: string | null;
  email_confirmed_at: string | null;
  banned_until: string | null;
  role: string;
  profile: { display_name: string | null } | null;
  characters: {
    id: string;
    name: string;
    level: number;
    class: string;
    race: string;
    hp: number;
    max_hp: number;
    gold: number;
    current_node_id: string | null;
  }[];
}

interface CharacterEdits {
  hp?: number;
  max_hp?: number;
  gold?: number;
  level?: number;
}

interface Props {
  isValar: boolean;
}

export default function UserManager({ isValar }: Props) {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [editingChar, setEditingChar] = useState<string | null>(null);
  const [charEdits, setCharEdits] = useState<CharacterEdits>({});

  const callAdmin = useCallback(async (action: string, method: string, body?: any) => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) throw new Error('Not authenticated');
    const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/admin-users?action=${action}`;
    const res = await fetch(url, {
      method,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session.access_token}`,
        apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Request failed');
    return data;
  }, []);

  const loadUsers = useCallback(async () => {
    setLoading(true);
    try {
      const data = await callAdmin(`list&page=${page}`, 'GET');
      setUsers(data.users);
      setTotal(data.total);
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  }, [page, callAdmin]);

  useEffect(() => { loadUsers(); }, [loadUsers]);

  const handleResetPassword = async (email: string) => {
    try {
      await callAdmin('reset-password', 'POST', { email });
      toast.success(`Password reset link generated for ${email}`);
    } catch (err: any) { toast.error(err.message); }
  };

  const handleSetRole = async (userId: string, role: string) => {
    try {
      await callAdmin('set-role', 'POST', { user_id: userId, role });
      toast.success('Role updated');
      loadUsers();
    } catch (err: any) { toast.error(err.message); }
  };

  const handleBan = async (userId: string, ban: boolean) => {
    try {
      await callAdmin('ban', 'POST', { user_id: userId, ban_duration: ban ? '876000h' : 'none' });
      toast.success(ban ? 'User banned' : 'User unbanned');
      loadUsers();
    } catch (err: any) { toast.error(err.message); }
  };

  const handleSaveCharacter = async (charId: string) => {
    try {
      await callAdmin('update-character', 'POST', { character_id: charId, updates: charEdits });
      toast.success('Character updated');
      setEditingChar(null);
      setCharEdits({});
      loadUsers();
    } catch (err: any) { toast.error(err.message); }
  };

  const filteredUsers = search
    ? users.filter(u =>
        u.email.toLowerCase().includes(search.toLowerCase()) ||
        u.profile?.display_name?.toLowerCase().includes(search.toLowerCase()) ||
        u.characters.some(c => c.name.toLowerCase().includes(search.toLowerCase()))
      )
    : users;

  const selectedUser = users.find(u => u.id === selectedUserId) || null;

  const roleBadge = (role: string) => {
    const colors: Record<string, string> = {
      valar: 'bg-primary/20 text-primary border-primary/40',
      maiar: 'bg-chart-2/20 text-chart-2 border-chart-2/40',
      player: 'bg-muted text-muted-foreground border-border',
    };
    return <Badge variant="outline" className={`text-[10px] ${colors[role] || colors.player}`}>{role}</Badge>;
  };

  const formatDate = (d: string | null) => {
    if (!d) return '—';
    return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  };

  return (
    <div className="flex h-full">
      {/* LEFT — User List */}
      <div className="w-64 shrink-0 border-r border-border flex flex-col">
        <div className="p-2 border-b border-border">
          <div className="relative">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
            <Input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search users..."
              className="pl-8 h-7 text-xs"
            />
          </div>
          <p className="text-[10px] text-muted-foreground mt-1">{total} users</p>
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
                className={`px-3 py-2 cursor-pointer border-b border-border transition-colors hover:bg-accent/10 ${isSelected ? 'bg-accent/20' : ''}`}
                onClick={() => setSelectedUserId(u.id)}
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

      {/* CENTER — Character Sheet */}
      <div className="flex-1 overflow-y-auto min-h-0">
        {!selectedUser ? (
          <div className="flex items-center justify-center h-full text-xs text-muted-foreground">
            Select a user to view details
          </div>
        ) : (
          <div className="p-4 space-y-4">
            {/* Header */}
            <div>
              <div className="flex items-center gap-2">
                <h2 className="font-display text-sm text-foreground">
                  {selectedUser.profile?.display_name || selectedUser.email.split('@')[0]}
                </h2>
                {roleBadge(selectedUser.role)}
                {selectedUser.banned_until && new Date(selectedUser.banned_until) > new Date() && (
                  <Badge variant="destructive" className="text-[10px]">Banned</Badge>
                )}
              </div>
              <p className="text-[10px] text-muted-foreground">{selectedUser.email}</p>
            </div>

            {/* Actions */}
            <div className="flex flex-wrap gap-1.5">
              <Button size="sm" variant="outline" className="h-7 text-[10px] gap-1"
                onClick={() => handleResetPassword(selectedUser.email)}>
                <KeyRound className="w-3 h-3" /> Reset Password
              </Button>
              {isValar && (
                <>
                  <Select value={selectedUser.role} onValueChange={(v) => handleSetRole(selectedUser.id, v)}>
                    <SelectTrigger className="h-7 w-28 text-[10px]">
                      <Shield className="w-3 h-3 mr-1" /><SelectValue />
                    </SelectTrigger>
                    <SelectContent className="bg-popover border-border z-50">
                      <SelectItem value="player" className="text-xs">Player</SelectItem>
                      <SelectItem value="maiar" className="text-xs">Maiar</SelectItem>
                      <SelectItem value="valar" className="text-xs">Valar</SelectItem>
                    </SelectContent>
                  </Select>
                  {selectedUser.banned_until && new Date(selectedUser.banned_until) > new Date() ? (
                    <Button size="sm" variant="outline" className="h-7 text-[10px] gap-1"
                      onClick={() => handleBan(selectedUser.id, false)}>
                      <UserCheck className="w-3 h-3" /> Unban
                    </Button>
                  ) : (
                    <Button size="sm" variant="destructive" className="h-7 text-[10px] gap-1"
                      onClick={() => handleBan(selectedUser.id, true)}>
                      <Ban className="w-3 h-3" /> Ban
                    </Button>
                  )}
                </>
              )}
            </div>

            {/* Account info */}
            <div className="grid grid-cols-2 gap-x-4 gap-y-0.5 text-[10px]">
              <span className="text-muted-foreground">Email confirmed</span>
              <span>{selectedUser.email_confirmed_at ? 'Yes' : 'No'}</span>
              <span className="text-muted-foreground">Joined</span>
              <span>{formatDate(selectedUser.created_at)}</span>
              <span className="text-muted-foreground">Last sign-in</span>
              <span>{formatDate(selectedUser.last_sign_in_at)}</span>
            </div>

            {/* Characters */}
            {selectedUser.characters.length > 0 && (
              <div>
                <h4 className="font-display text-[10px] text-muted-foreground mb-1">Characters</h4>
                <div className="space-y-1">
                  {selectedUser.characters.map(c => {
                    const isEditing = editingChar === c.id;
                    return (
                      <div key={c.id} className="flex items-center gap-2 p-1.5 rounded border border-border bg-background/30 text-[10px]">
                        <div className="flex-1 min-w-0">
                          <span className="font-display text-primary">{c.name}</span>
                          <span className="text-muted-foreground ml-1">
                            Lvl {isEditing ? (
                              <input type="number" className="w-8 bg-background border border-border rounded px-1 text-[10px] text-foreground inline"
                                value={charEdits.level ?? c.level}
                                onChange={e => setCharEdits(p => ({ ...p, level: parseInt(e.target.value) || 1 }))} />
                            ) : c.level}
                            {' '}{RACE_LABELS[c.race as keyof typeof RACE_LABELS]} {CLASS_LABELS[c.class as keyof typeof CLASS_LABELS]}
                          </span>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          {isEditing ? (
                            <>
                              <span className="text-muted-foreground">HP</span>
                              <input type="number" className="w-10 bg-background border border-border rounded px-1 text-[10px] text-foreground"
                                value={charEdits.hp ?? c.hp}
                                onChange={e => setCharEdits(p => ({ ...p, hp: parseInt(e.target.value) || 0 }))} />
                              <span className="text-muted-foreground">/</span>
                              <input type="number" className="w-10 bg-background border border-border rounded px-1 text-[10px] text-foreground"
                                value={charEdits.max_hp ?? c.max_hp}
                                onChange={e => setCharEdits(p => ({ ...p, max_hp: parseInt(e.target.value) || 1 }))} />
                              <span className="text-muted-foreground">Gold</span>
                              <input type="number" className="w-12 bg-background border border-border rounded px-1 text-[10px] text-foreground"
                                value={charEdits.gold ?? c.gold}
                                onChange={e => setCharEdits(p => ({ ...p, gold: parseInt(e.target.value) || 0 }))} />
                              <Button size="sm" variant="ghost" className="h-5 w-5 p-0" onClick={() => handleSaveCharacter(c.id)}>
                                <Save className="w-3 h-3 text-chart-2" />
                              </Button>
                              <Button size="sm" variant="ghost" className="h-5 w-5 p-0" onClick={() => { setEditingChar(null); setCharEdits({}); }}>
                                <X className="w-3 h-3 text-destructive" />
                              </Button>
                            </>
                          ) : (
                            <>
                              <span className="text-blood">{c.hp}/{c.max_hp} HP</span>
                              <span className="text-primary">{c.gold}g</span>
                              <Button size="sm" variant="ghost" className="h-5 w-5 p-0"
                                onClick={(e) => { e.stopPropagation(); setEditingChar(c.id); setCharEdits({ hp: c.hp, max_hp: c.max_hp, gold: c.gold, level: c.level }); }}>
                                <Pencil className="w-3 h-3 text-muted-foreground" />
                              </Button>
                            </>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* RIGHT — Player Logs */}
      <div className="w-72 shrink-0 border-l border-border flex flex-col">
        <div className="px-3 py-2 border-b border-border">
          <div className="flex items-center gap-1.5">
            <ScrollText className="w-3.5 h-3.5 text-muted-foreground" />
            <h3 className="font-display text-xs text-muted-foreground">Player Logs</h3>
          </div>
        </div>
        <div className="flex-1 flex items-center justify-center">
          <p className="text-[10px] text-muted-foreground">
            {selectedUser ? 'No logs available yet' : 'Select a user'}
          </p>
        </div>
      </div>
    </div>
  );
}
