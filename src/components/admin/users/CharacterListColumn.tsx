import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { KeyRound, Shield, Ban, UserCheck, ArrowUpDown } from 'lucide-react';
import { AdminEntityToolbar, AdminEmptyState } from '../common';
import { ROLE_BADGE_COLORS, formatDate } from './constants';
import type { AdminUser, AdminNode } from './constants';
import { CLASS_LABELS, RACE_LABELS } from '@/lib/game-data';

interface Props {
  selectedUser: AdminUser | null;
  selectedCharId: string | null;
  onSelectChar: (id: string) => void;
  allNodes: AdminNode[];
  isValar: boolean;
  onResetPassword: (email: string) => void;
  onBan: (userId: string, ban: boolean) => void;
  onSetRole: (userId: string, role: string) => void;
}

export default function CharacterListColumn({
  selectedUser, selectedCharId, onSelectChar, allNodes,
  isValar, onResetPassword, onBan, onSetRole,
}: Props) {
  const [sortBy, setSortBy] = useState<'alpha' | 'level'>('alpha');

  const roleBadge = (role: string) => (
    <Badge variant="outline" className={`text-[10px] ${ROLE_BADGE_COLORS[role] || ROLE_BADGE_COLORS.player}`}>{role}</Badge>
  );

  const getNodeName = (nodeId: string | null) => {
    if (!nodeId) return null;
    const node = allNodes.find(n => n.id === nodeId);
    return node?.name || null;
  };

  if (!selectedUser) {
    return (
      <div className="w-60 shrink-0 border-r border-border flex flex-col">
        <AdminEmptyState message="Select a user" />
      </div>
    );
  }

  const sortedChars = [...selectedUser.characters].sort((a, b) =>
    sortBy === 'level' ? b.level - a.level : a.name.localeCompare(b.name)
  );

  return (
    <div className="w-60 shrink-0 border-r border-border flex flex-col">
      {/* User info header */}
      <div className="p-3 border-b border-border">
        <div className="flex items-center gap-2 mb-1">
          <h4 className="font-display text-sm text-foreground truncate">
            {selectedUser.profile?.display_name || selectedUser.email.split('@')[0]}
          </h4>
          {roleBadge(selectedUser.role)}
        </div>
        <p className="text-[10px] text-muted-foreground truncate">{selectedUser.email}</p>
        <div className="flex gap-3 mt-1 text-[10px] text-muted-foreground">
          <span>Joined {formatDate(selectedUser.created_at)}</span>
          <span>Last {formatDate(selectedUser.last_sign_in_at)}</span>
        </div>
        {/* Account action buttons */}
        <div className="flex flex-wrap gap-1 mt-2">
          <Button size="sm" variant="outline" className="h-6 text-[10px] gap-1"
            onClick={() => onResetPassword(selectedUser.email)}>
            <KeyRound className="w-3 h-3" /> Reset PW
          </Button>
          {isValar && (
            <>
              {selectedUser.banned_until && new Date(selectedUser.banned_until) > new Date() ? (
                <Button size="sm" variant="outline" className="h-6 text-[10px] gap-1"
                  onClick={() => onBan(selectedUser.id, false)}>
                  <UserCheck className="w-3 h-3" /> Unban
                </Button>
              ) : (
                <Button size="sm" variant="destructive" className="h-6 text-[10px] gap-1"
                  onClick={() => onBan(selectedUser.id, true)}>
                  <Ban className="w-3 h-3" /> Ban
                </Button>
              )}
              <Select value={selectedUser.role} onValueChange={(v) => onSetRole(selectedUser.id, v)}>
                <SelectTrigger className="h-6 w-24 text-[10px]">
                  <Shield className="w-3 h-3 mr-1" /><SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-popover border-border z-50">
                  <SelectItem value="player" className="text-xs">Player</SelectItem>
                  <SelectItem value="steward" className="text-xs">Steward</SelectItem>
                  <SelectItem value="overlord" className="text-xs">Overlord</SelectItem>
                </SelectContent>
              </Select>
            </>
          )}
        </div>
      </div>

      {/* Characters header with sort */}
      <div className="px-3 py-1.5 border-b border-border flex items-center justify-between">
        <span className="font-display text-[10px] text-muted-foreground">Characters ({selectedUser.characters.length})</span>
        <Button
          size="sm" variant="ghost" className="h-5 px-1.5 text-[9px] gap-1"
          onClick={() => setSortBy(s => s === 'alpha' ? 'level' : 'alpha')}
        >
          <ArrowUpDown className="w-2.5 h-2.5" />
          {sortBy === 'alpha' ? 'A-Z' : 'Lvl'}
        </Button>
      </div>

      {/* Character Cards */}
      <ScrollArea className="flex-1">
        <div className="p-3 space-y-2">
          {selectedUser.characters.length === 0 ? (
            <p className="text-[10px] text-muted-foreground/50 italic">No characters</p>
          ) : (
            sortedChars.map(char => {
              const isActive = selectedCharId === char.id;
              const nodeName = getNodeName(char.current_node_id);
              return (
                <div
                  key={char.id}
                  className={`ornate-border rounded-lg p-2.5 cursor-pointer transition-all hover:border-primary/60 hover:shadow-lg hover:shadow-primary/10 ${
                    isActive ? 'border-primary bg-primary/5 shadow-md shadow-primary/10' : 'bg-card/90'
                  }`}
                  onClick={() => onSelectChar(char.id)}
                >
                  <div className="flex items-start justify-between">
                    <div>
                      <h3 className={`font-display text-sm ${isActive ? 'text-primary text-glow' : 'text-foreground'}`}>
                        {char.name}
                      </h3>
                      <p className="text-[10px] text-muted-foreground">
                        {char.gender === 'male' ? '♂' : '♀'} {RACE_LABELS[char.race as keyof typeof RACE_LABELS]} {CLASS_LABELS[char.class as keyof typeof CLASS_LABELS]}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3 text-[11px] mt-1.5">
                    <span className="font-display text-foreground">Lvl {char.level}</span>
                    <span className="text-blood">HP {char.hp}/{char.max_hp}</span>
                    <span className="text-primary">Gold {char.gold}</span>
                  </div>
                  {nodeName && (
                    <div className="text-[9px] text-muted-foreground/70 mt-1 truncate">📍 {nodeName}</div>
                  )}
                  <div className="h-1 bg-background rounded-full overflow-hidden border border-border/50 mt-1.5">
                    <div
                      className="h-full transition-all duration-500"
                      style={{
                        width: `${Math.round((char.hp / char.max_hp) * 100)}%`,
                        background: char.hp / char.max_hp > 0.5 ? 'hsl(var(--elvish))' : char.hp / char.max_hp > 0.25 ? 'hsl(var(--gold))' : 'hsl(var(--blood))',
                      }}
                    />
                  </div>
                </div>
              );
            })
          )}
        </div>
      </ScrollArea>
    </div>
  );
}
