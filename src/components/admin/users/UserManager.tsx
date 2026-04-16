import { useState, useEffect, useCallback, useRef } from 'react';
import { useGameContext } from '@/contexts/GameContext';
import { supabase } from '@/integrations/supabase/client';
import { TooltipProvider } from '@/components/ui/tooltip';
import { toast } from 'sonner';

import UserListColumn from './UserListColumn';
import CharacterListColumn from './CharacterListColumn';
import CharacterActionsColumn from './CharacterActionsColumn';
import CharacterSheetColumn from './CharacterSheetColumn';
import ActivityLogColumn from './ActivityLogColumn';
import type { AdminUser, AdminNode, CharacterEdits } from './constants';

interface Props {
  isValar: boolean;
}

export default function UserManager({ isValar }: Props) {
  const { refetchCharacters } = useGameContext();
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [selectedCharId, setSelectedCharId] = useState<string | null>(null);
  const [editingChar, setEditingChar] = useState<string | null>(null);
  const [charEdits, setCharEdits] = useState<CharacterEdits>({});
  const [allItems, setAllItems] = useState<{ id: string; name: string; rarity: string; level: number; slot: string | null }[]>([]);
  const [giveItemId, setGiveItemId] = useState<string>('');
  const [givingItem, setGivingItem] = useState(false);
  const [allNodes, setAllNodes] = useState<AdminNode[]>([]);
  const [allRegions, setAllRegions] = useState<{ id: string; name: string }[]>([]);
  const [allAreas, setAllAreas] = useState<{ id: string; name: string }[]>([]);
  const [teleportNodeId, setTeleportNodeId] = useState<string>('');
  const [grantXpAmount, setGrantXpAmount] = useState<number>(100);
  const [grantRespecAmount, setGrantRespecAmount] = useState<number>(1);
  const [grantSalvageAmount, setGrantSalvageAmount] = useState<number>(100);
  const [removeItemId, setRemoveItemId] = useState<string>('');

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

  useEffect(() => {
    Promise.all([
      supabase.from('items').select('id, name, rarity, level, slot').order('name'),
      supabase.from('nodes').select('id, name, region_id, area_id, is_inn, is_vendor, is_blacksmith, is_teleport, is_trainer').order('name'),
      supabase.from('regions').select('id, name'),
      supabase.from('areas').select('id, name'),
    ]).then(([itemsRes, nodesRes, regionsRes, areasRes]) => {
      if (itemsRes.data) {
        setAllItems(itemsRes.data);
        if (itemsRes.data.length > 0 && !giveItemId) setGiveItemId(itemsRes.data[0].id);
      }
      if (regionsRes.data) setAllRegions(regionsRes.data);
      if (areasRes.data) setAllAreas(areasRes.data);
      if (nodesRes.data && regionsRes.data) {
        const regionMap = Object.fromEntries((regionsRes.data || []).map(r => [r.id, r.name]));
        setAllNodes(nodesRes.data.map(n => ({ ...n, region_name: regionMap[n.region_id] || 'Unknown' })));
        if (nodesRes.data.length > 0) setTeleportNodeId(nodesRes.data[0].id);
      }
    });
  }, []);

  const prevSelectedUserIdRef = useRef<string | null>(null);
  useEffect(() => {
    if (selectedUserId === prevSelectedUserIdRef.current) {
      const user = users.find(u => u.id === selectedUserId);
      if (selectedCharId && user && !user.characters.some(c => c.id === selectedCharId)) {
        setSelectedCharId(user.characters[0]?.id || null);
      }
      return;
    }
    prevSelectedUserIdRef.current = selectedUserId;
    const user = users.find(u => u.id === selectedUserId);
    if (user?.characters?.length) {
      setSelectedCharId(user.characters[0].id);
    } else {
      setSelectedCharId(null);
    }
    setRemoveItemId('');
    setEditingChar(null);
    setCharEdits({});
  }, [selectedUserId, users]);

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
      if (charEdits.level !== undefined) {
        await callAdmin('set-level', 'POST', { character_id: charId, new_level: charEdits.level });
        const { level, ...remainingEdits } = charEdits;
        if (Object.keys(remainingEdits).length > 0) {
          await callAdmin('update-character', 'POST', { character_id: charId, updates: remainingEdits });
        }
      } else {
        await callAdmin('update-character', 'POST', { character_id: charId, updates: charEdits });
      }
      toast.success('Character updated');
      setEditingChar(null);
      setCharEdits({});
      loadUsers();
    } catch (err: any) { toast.error(err.message); }
  };

  const handleGiveItem = async (characterId: string) => {
    if (!giveItemId) return;
    setGivingItem(true);
    try {
      await callAdmin('give-item', 'POST', { character_id: characterId, item_id: giveItemId });
      const itemName = allItems.find(i => i.id === giveItemId)?.name || 'Item';
      toast.success(`Gave ${itemName} to character`);
      loadUsers();
    } catch (err: any) { toast.error(err.message); }
    finally { setGivingItem(false); }
  };

  const handleTeleport = async (characterId: string) => {
    if (!teleportNodeId) return;
    try {
      const { error } = await supabase.rpc('admin_teleport', {
        _character_id: characterId,
        _node_id: teleportNodeId,
      });
      if (error) throw error;
      const nodeName = allNodes.find(n => n.id === teleportNodeId)?.name || 'node';
      toast.success(`Teleported to ${nodeName}`);
      refetchCharacters();
      loadUsers();
    } catch (err: any) { toast.error(err.message); }
  };

  const handleGrantXp = async (characterId: string) => {
    if (!grantXpAmount || grantXpAmount <= 0) return;
    try {
      const data = await callAdmin('grant-xp', 'POST', { character_id: characterId, amount: grantXpAmount });
      toast.success(`Granted ${grantXpAmount} XP${data.levels_gained > 0 ? ` (+${data.levels_gained} levels!)` : ''}`);
      loadUsers();
    } catch (err: any) { toast.error(err.message); }
  };

  const handleRevive = async (characterId: string) => {
    try {
      await callAdmin('revive', 'POST', { character_id: characterId });
      toast.success('Character revived');
      loadUsers();
    } catch (err: any) { toast.error(err.message); }
  };

  const handleRemoveItem = async () => {
    if (!removeItemId) return;
    try {
      await callAdmin('remove-item', 'POST', { inventory_id: removeItemId });
      toast.success('Item removed');
      setRemoveItemId('');
      loadUsers();
    } catch (err: any) { toast.error(err.message); }
  };

  const handleResetStats = async (characterId: string) => {
    try {
      const data = await callAdmin('reset-stats', 'POST', { character_id: characterId });
      toast.success(`Stats reset — ${data.refunded_points} points refunded`);
      loadUsers();
    } catch (err: any) { toast.error(err.message); }
  };

  const handleGrantRespec = async (characterId: string) => {
    if (!grantRespecAmount || grantRespecAmount <= 0) return;
    try {
      const data = await callAdmin('grant-respec', 'POST', { character_id: characterId, amount: grantRespecAmount });
      toast.success(`Granted ${grantRespecAmount} respec point${grantRespecAmount > 1 ? 's' : ''} (total: ${data.new_total})`);
      loadUsers();
    } catch (err: any) { toast.error(err.message); }
  };

  const handleGrantSalvage = async (characterId: string) => {
    if (!grantSalvageAmount || grantSalvageAmount <= 0) return;
    try {
      const data = await callAdmin('grant-salvage', 'POST', { character_id: characterId, amount: grantSalvageAmount });
      toast.success(`Granted ${grantSalvageAmount} salvage (total: ${data.new_total})`);
      loadUsers();
    } catch (err: any) { toast.error(err.message); }
  };

  const selectedUser = users.find(u => u.id === selectedUserId) || null;
  const selectedChar = selectedUser?.characters.find(c => c.id === selectedCharId) || null;

  return (
    <TooltipProvider delayDuration={200}>
      <div className="flex h-full">
        <UserListColumn
          users={users}
          total={total}
          loading={loading}
          page={page}
          setPage={setPage}
          selectedUserId={selectedUserId}
          onSelectUser={setSelectedUserId}
        />

        <CharacterListColumn
          selectedUser={selectedUser}
          selectedCharId={selectedCharId}
          onSelectChar={setSelectedCharId}
          allNodes={allNodes}
          isValar={isValar}
          onResetPassword={handleResetPassword}
          onBan={handleBan}
          onSetRole={handleSetRole}
        />

        <CharacterActionsColumn
          selectedUser={selectedUser}
          selectedChar={selectedChar}
          allItems={allItems}
          allNodes={allNodes}
          allRegions={allRegions}
          allAreas={allAreas}
          giveItemId={giveItemId}
          setGiveItemId={setGiveItemId}
          givingItem={givingItem}
          teleportNodeId={teleportNodeId}
          setTeleportNodeId={setTeleportNodeId}
          grantXpAmount={grantXpAmount}
          setGrantXpAmount={setGrantXpAmount}
          grantRespecAmount={grantRespecAmount}
          setGrantRespecAmount={setGrantRespecAmount}
          grantSalvageAmount={grantSalvageAmount}
          setGrantSalvageAmount={setGrantSalvageAmount}
          removeItemId={removeItemId}
          setRemoveItemId={setRemoveItemId}
          onGiveItem={handleGiveItem}
          onTeleport={handleTeleport}
          onGrantXp={handleGrantXp}
          onGrantRespec={handleGrantRespec}
          onGrantSalvage={handleGrantSalvage}
          onRevive={handleRevive}
          onResetStats={handleResetStats}
          onRemoveItem={handleRemoveItem}
        />

        <CharacterSheetColumn
          selectedUser={selectedUser}
          selectedChar={selectedChar}
          editingChar={editingChar}
          charEdits={charEdits}
          setCharEdits={setCharEdits}
          onEdit={(charId) => {
            const c = selectedUser?.characters.find(ch => ch.id === charId);
            if (c) {
              setEditingChar(charId);
              setCharEdits({ name: c.name, gold: c.gold, level: c.level });
            }
          }}
          onSave={handleSaveCharacter}
          onCancel={() => { setEditingChar(null); setCharEdits({}); }}
        />

        <ActivityLogColumn userId={selectedUser?.id ?? null} />
      </div>
    </TooltipProvider>
  );
}
