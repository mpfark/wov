import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { toast } from 'sonner';
import { Search, KeyRound, Shield, Ban, UserCheck, Pencil, Save, X, ScrollText } from 'lucide-react';
import { CLASS_LABELS, RACE_LABELS, STAT_LABELS, getStatModifier } from '@/lib/game-data';

interface AdminInventoryItem {
  id: string;
  character_id: string;
  item_id: string;
  equipped_slot: string | null;
  current_durability: number;
  item: {
    id: string;
    name: string;
    description: string;
    item_type: string;
    rarity: string;
    slot: string | null;
    stats: Record<string, number>;
    value: number;
    max_durability: number;
    hands: number | null;
  };
}

interface AdminCharacter {
  id: string;
  name: string;
  level: number;
  class: string;
  race: string;
  hp: number;
  max_hp: number;
  gold: number;
  current_node_id: string | null;
  str: number;
  dex: number;
  con: number;
  int: number;
  wis: number;
  cha: number;
  ac: number;
  xp: number;
  unspent_stat_points: number;
  inventory: AdminInventoryItem[];
}

interface AdminUser {
  id: string;
  email: string;
  created_at: string;
  last_sign_in_at: string | null;
  email_confirmed_at: string | null;
  banned_until: string | null;
  role: string;
  profile: { display_name: string | null } | null;
  characters: AdminCharacter[];
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

const RARITY_COLORS: Record<string, string> = {
  common: 'text-foreground',
  uncommon: 'text-chart-2',
  rare: 'text-dwarvish',
  unique: 'text-primary text-glow',
};

const STAT_FULL_NAMES: Record<string, string> = {
  str: 'Strength', dex: 'Dexterity', con: 'Constitution',
  int: 'Intelligence', wis: 'Wisdom', cha: 'Charisma',
};

const STAT_DESCRIPTIONS: Record<string, string> = {
  str: 'Melee attack and damage rolls',
  dex: 'Ranged attack, AC bonus, initiative',
  con: 'Hit points and physical resilience',
  int: 'Arcane power and knowledge checks',
  wis: 'Perception, healing power, willpower',
  cha: 'Persuasion, bardic abilities, leadership',
};

const SLOT_LABELS: Record<string, string> = {
  main_hand: 'Main Hand', off_hand: 'Off Hand',
  head: 'Head', amulet: 'Amulet', shoulders: 'Shoulders', chest: 'Chest',
  gloves: 'Gloves', belt: 'Belt', pants: 'Pants', ring: 'Ring', trinket: 'Trinket',
  boots: 'Boots',
};

function AdminEquipSlot({ slot, item, blocked }: {
  slot: string; item: AdminInventoryItem | undefined; blocked: boolean;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div
          className={`w-[6.5rem] p-1 border rounded text-center transition-colors ${
            blocked ? 'border-border/30 bg-background/10 opacity-50' :
            item ? 'border-primary/50 bg-primary/5' : 'border-border bg-background/30'
          }`}
        >
          <div className="text-[9px] text-muted-foreground capitalize">{SLOT_LABELS[slot]}</div>
          {blocked ? (
            <div className="text-[10px] text-muted-foreground/50">2H</div>
          ) : item ? (
            <>
              <div className={`text-[10px] font-display truncate ${RARITY_COLORS[item.item.rarity]}`}>
                {item.item.name}
              </div>
              <div className="text-[9px] text-muted-foreground">{item.current_durability}%</div>
            </>
          ) : (
            <div className="text-[10px] text-muted-foreground/50">Empty</div>
          )}
        </div>
      </TooltipTrigger>
      {item && !blocked && (
        <TooltipContent className="bg-popover border-border z-50">
          <p className={`font-display ${RARITY_COLORS[item.item.rarity]}`}>{item.item.name}</p>
          <p className="text-xs text-muted-foreground">{item.item.description}</p>
          {item.item.hands && <p className="text-xs text-muted-foreground">{item.item.hands === 2 ? 'Two-Handed' : 'One-Handed'}</p>}
          {Object.entries(item.item.stats || {}).map(([k, v]) => (
            <p key={k} className="text-xs">+{v as number} {k.toUpperCase()}</p>
          ))}
        </TooltipContent>
      )}
    </Tooltip>
  );
}

function AdminCharacterSheet({ c, isEditing, charEdits, setCharEdits, onEdit, onSave, onCancel }: {
  c: AdminCharacter;
  isEditing: boolean;
  charEdits: CharacterEdits;
  setCharEdits: React.Dispatch<React.SetStateAction<CharacterEdits>>;
  onEdit: () => void;
  onSave: () => void;
  onCancel: () => void;
}) {
  const inventory = c.inventory || [];
  const equipped = inventory.filter(i => i.equipped_slot);
  const unequipped = inventory.filter(i => !i.equipped_slot);

  const equipmentBonuses = equipped.reduce((acc, item) => {
    const stats = item.item.stats || {};
    for (const [key, val] of Object.entries(stats)) {
      acc[key] = (acc[key] || 0) + (val as number);
    }
    return acc;
  }, {} as Record<string, number>);

  const hp = isEditing ? (charEdits.hp ?? c.hp) : c.hp;
  const maxHp = isEditing ? (charEdits.max_hp ?? c.max_hp) : c.max_hp;
  const gold = isEditing ? (charEdits.gold ?? c.gold) : c.gold;
  const level = isEditing ? (charEdits.level ?? c.level) : c.level;

  const hpPercent = Math.round((hp / maxHp) * 100);
  const xpForNext = c.level * 100;
  const xpPercent = Math.round((c.xp / xpForNext) * 100);
  const totalAC = c.ac + (equipmentBonuses.ac || 0);

  const getEquippedInSlot = (slot: string) => equipped.find(i => i.equipped_slot === slot);
  const mainHandItem = getEquippedInSlot('main_hand');
  const isTwoHanded = mainHandItem && mainHandItem.item.hands === 2;

  return (
    <div className="border border-border rounded-lg p-3 space-y-3 bg-background/20">
      {/* Name & Identity + Edit button */}
      <div className="flex items-center justify-between">
        <div className="text-center flex-1">
          <h2 className="font-display text-lg text-primary text-glow">{c.name}</h2>
          <p className="text-xs text-muted-foreground">
            {RACE_LABELS[c.race as keyof typeof RACE_LABELS]} {CLASS_LABELS[c.class as keyof typeof CLASS_LABELS]} — Lvl {isEditing ? (
              <input type="number" className="w-10 bg-background border border-border rounded px-1 text-xs text-foreground inline"
                value={level} onChange={e => setCharEdits(p => ({ ...p, level: parseInt(e.target.value) || 1 }))} />
            ) : level}
          </p>
        </div>
        <div className="flex gap-1">
          {isEditing ? (
            <>
              <Button size="sm" variant="ghost" className="h-6 w-6 p-0" onClick={onSave}>
                <Save className="w-3.5 h-3.5 text-chart-2" />
              </Button>
              <Button size="sm" variant="ghost" className="h-6 w-6 p-0" onClick={onCancel}>
                <X className="w-3.5 h-3.5 text-destructive" />
              </Button>
            </>
          ) : (
            <Button size="sm" variant="ghost" className="h-6 w-6 p-0" onClick={onEdit}>
              <Pencil className="w-3.5 h-3.5 text-muted-foreground" />
            </Button>
          )}
        </div>
      </div>

      {/* HP Bar */}
      <div>
        <div className="flex justify-between text-xs mb-1">
          <span className="text-muted-foreground">HP</span>
          {isEditing ? (
            <span className="flex items-center gap-1">
              <input type="number" className="w-12 bg-background border border-border rounded px-1 text-xs text-blood"
                value={hp} onChange={e => setCharEdits(p => ({ ...p, hp: parseInt(e.target.value) || 0 }))} />
              <span className="text-muted-foreground">/</span>
              <input type="number" className="w-12 bg-background border border-border rounded px-1 text-xs text-blood"
                value={maxHp} onChange={e => setCharEdits(p => ({ ...p, max_hp: parseInt(e.target.value) || 1 }))} />
            </span>
          ) : (
            <span className="text-blood">{hp}/{maxHp}</span>
          )}
        </div>
        <div className="h-2 bg-background rounded-full overflow-hidden border border-border">
          <div
            className="h-full transition-all duration-500"
            style={{
              width: `${hpPercent}%`,
              background: hpPercent > 50 ? 'hsl(var(--elvish))' : hpPercent > 25 ? 'hsl(var(--gold))' : 'hsl(var(--blood))',
            }}
          />
        </div>
      </div>

      {/* XP Bar */}
      <div>
        <div className="flex justify-between text-xs mb-1">
          <span className="text-muted-foreground">XP</span>
          <span className="text-primary">{c.xp}/{xpForNext}</span>
        </div>
        <div className="h-1.5 bg-background rounded-full overflow-hidden border border-border">
          <div className="h-full bg-primary transition-all duration-500" style={{ width: `${xpPercent}%` }} />
        </div>
      </div>

      {/* Stats */}
      <div>
        <h3 className="font-display text-xs text-muted-foreground mb-1.5">Attributes</h3>
        <div className="flex items-center justify-between text-[9px] text-muted-foreground/70 px-1 mb-0.5">
          <span className="w-20">Stat</span>
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="flex-1 text-center cursor-help underline decoration-dotted">Base <span className="text-chart-2">+Gear</span></span>
            </TooltipTrigger>
            <TooltipContent className="bg-popover border-border z-50">
              <p className="font-display text-sm">Base + Gear</p>
              <p className="text-xs text-muted-foreground"><strong>Base</strong> — Natural stat from race, class, and level-up points.</p>
              <p className="text-xs text-muted-foreground"><strong>Gear</strong> — Bonus from equipped items (shown in green).</p>
            </TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="w-8 text-right cursor-help underline decoration-dotted">Mod</span>
            </TooltipTrigger>
            <TooltipContent className="bg-popover border-border z-50">
              <p className="font-display text-sm">Modifier</p>
              <p className="text-xs text-muted-foreground">Added to dice rolls. Calculated as (total − 10) ÷ 2, rounded down.</p>
            </TooltipContent>
          </Tooltip>
        </div>
        <div className="space-y-0.5">
          {Object.entries(STAT_LABELS).map(([key, label]) => {
            const base = (c as any)[key] as number;
            const bonus = equipmentBonuses[key] || 0;
            const total = base + bonus;
            const mod = getStatModifier(total);
            return (
              <Tooltip key={key}>
                <TooltipTrigger asChild>
                  <div className="flex items-center justify-between text-xs py-0.5 px-1 rounded hover:bg-accent/30 transition-colors cursor-help">
                    <span className="font-display text-foreground w-20">{STAT_FULL_NAMES[key]}</span>
                    <span className="text-muted-foreground flex-1 text-center tabular-nums">
                      <span className="text-foreground">{base}</span>
                      {bonus > 0 && <span className="text-chart-2 ml-1">+{bonus}</span>}
                    </span>
                    <span className="text-primary text-[10px] w-8 text-right">
                      ({mod >= 0 ? `+${mod}` : mod})
                    </span>
                  </div>
                </TooltipTrigger>
                <TooltipContent className="bg-popover border-border z-50">
                  <p className="font-display text-sm">{STAT_FULL_NAMES[key]}</p>
                  <p className="text-xs text-muted-foreground">{STAT_DESCRIPTIONS[key]}</p>
                </TooltipContent>
              </Tooltip>
            );
          })}
        </div>
        <div className="flex gap-3 justify-center text-xs mt-1.5">
          <span className="font-display text-foreground">
            AC {totalAC}
            {(equipmentBonuses.ac || 0) > 0 && <span className="text-chart-2">+{equipmentBonuses.ac}</span>}
          </span>
          <span className="font-display text-primary">
            Gold {isEditing ? (
              <input type="number" className="w-14 bg-background border border-border rounded px-1 text-xs text-primary inline"
                value={gold} onChange={e => setCharEdits(p => ({ ...p, gold: parseInt(e.target.value) || 0 }))} />
            ) : gold}
          </span>
        </div>
      </div>

      {/* Equipment Paper Doll */}
      <div>
        <h3 className="font-display text-xs text-muted-foreground mb-1.5">Equipment</h3>
        <div className="relative flex flex-col items-center gap-1">
          <div className="grid grid-cols-3 gap-1 w-full justify-items-center relative z-10">
            <AdminEquipSlot slot="trinket" item={getEquippedInSlot('trinket')} blocked={false} />
            <AdminEquipSlot slot="head" item={getEquippedInSlot('head')} blocked={false} />
            <div />
            <div />
            <AdminEquipSlot slot="amulet" item={getEquippedInSlot('amulet')} blocked={false} />
            <div />
            <AdminEquipSlot slot="shoulders" item={getEquippedInSlot('shoulders')} blocked={false} />
            <AdminEquipSlot slot="chest" item={getEquippedInSlot('chest')} blocked={false} />
            <AdminEquipSlot slot="gloves" item={getEquippedInSlot('gloves')} blocked={false} />
            <AdminEquipSlot slot="main_hand" item={getEquippedInSlot('main_hand')} blocked={false} />
            <AdminEquipSlot slot="belt" item={getEquippedInSlot('belt')} blocked={false} />
            <AdminEquipSlot slot="off_hand" item={getEquippedInSlot('off_hand')} blocked={!!isTwoHanded} />
            <AdminEquipSlot slot="ring" item={getEquippedInSlot('ring')} blocked={false} />
            <AdminEquipSlot slot="pants" item={getEquippedInSlot('pants')} blocked={false} />
            <div />
            <div />
            <AdminEquipSlot slot="boots" item={getEquippedInSlot('boots')} blocked={false} />
            <div />
          </div>
        </div>
      </div>

      {/* Inventory */}
      <div>
        <h3 className="font-display text-xs text-muted-foreground mb-1.5">
          Inventory ({unequipped.length})
        </h3>
        <div className="space-y-1 max-h-40 overflow-y-auto">
          {unequipped.length === 0 ? (
            <p className="text-[10px] text-muted-foreground/50 italic">Empty</p>
          ) : unequipped.map(inv => (
            <div key={inv.id} className="flex items-center justify-between p-1.5 rounded border border-border bg-background/30 text-xs">
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className={`font-display truncate flex-1 cursor-help ${RARITY_COLORS[inv.item.rarity]}`}>
                    {inv.item.name}
                    {inv.item.hands && <span className="text-[9px] text-muted-foreground ml-1">({inv.item.hands}H)</span>}
                  </span>
                </TooltipTrigger>
                <TooltipContent className="bg-popover border-border z-50">
                  <p className={`font-display ${RARITY_COLORS[inv.item.rarity]}`}>{inv.item.name}</p>
                  <p className="text-xs text-muted-foreground">{inv.item.description}</p>
                  {Object.entries(inv.item.stats || {}).map(([k, v]) => (
                    <p key={k} className="text-xs">+{v as number} {k.toUpperCase()}</p>
                  ))}
                  <p className="text-[10px] text-muted-foreground">Durability: {inv.current_durability}% | Value: {inv.item.value}g</p>
                </TooltipContent>
              </Tooltip>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
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
    <TooltipProvider delayDuration={200}>
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

              {/* Characters — Full Sheet Mirror */}
              {selectedUser.characters.length > 0 ? (
                <div className="space-y-4">
                  <h4 className="font-display text-[10px] text-muted-foreground">Characters</h4>
                  {selectedUser.characters.map(c => (
                    <AdminCharacterSheet
                      key={c.id}
                      c={c}
                      isEditing={editingChar === c.id}
                      charEdits={charEdits}
                      setCharEdits={setCharEdits}
                      onEdit={() => { setEditingChar(c.id); setCharEdits({ hp: c.hp, max_hp: c.max_hp, gold: c.gold, level: c.level }); }}
                      onSave={() => handleSaveCharacter(c.id)}
                      onCancel={() => { setEditingChar(null); setCharEdits({}); }}
                    />
                  ))}
                </div>
              ) : (
                <p className="text-[10px] text-muted-foreground italic">No characters</p>
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
    </TooltipProvider>
  );
}
