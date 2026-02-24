import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';

export interface PartyMember {
  id: string;
  character_id: string;
  status: string;
  is_following: boolean;
  character: {
    id: string;
    name: string;
    race: string;
    class: string;
    level: number;
    hp: number;
    max_hp: number;
    current_node_id: string | null;
  };
}

export interface Party {
  id: string;
  leader_id: string;
  tank_id: string | null;
  created_at: string;
}

export function useParty(characterId: string | null) {
  const [party, setParty] = useState<Party | null>(null);
  const [members, setMembers] = useState<PartyMember[]>([]);
  const [pendingInvites, setPendingInvites] = useState<{ party_id: string; id: string; leader_name: string }[]>([]);

  const fetchParty = useCallback(async () => {
    if (!characterId) return;

    // Find party where this character is an accepted member
    const { data: memberRows } = await supabase
      .from('party_members')
      .select('party_id')
      .eq('character_id', characterId)
      .eq('status', 'accepted');

    if (!memberRows || memberRows.length === 0) {
      setParty(null);
      setMembers([]);
    } else {
      const partyId = memberRows[0].party_id;
      const { data: partyData } = await supabase
        .from('parties')
        .select('*')
        .eq('id', partyId)
        .single();

      if (partyData) {
        setParty(partyData as Party);
        // Fetch all accepted members with character info
        const { data: membersData } = await supabase
          .from('party_members')
          .select('id, character_id, status, is_following, character:characters(id, name, race, class, level, hp, max_hp, current_node_id)')
          .eq('party_id', partyId)
          .eq('status', 'accepted');
        if (membersData) setMembers(membersData as unknown as PartyMember[]);
      }
    }

    // Fetch pending invites for this character
    const { data: pending } = await supabase
      .from('party_members')
      .select('id, party_id, party:parties(leader_id)')
      .eq('character_id', characterId)
      .eq('status', 'pending');

    if (pending && pending.length > 0) {
      // Get leader names
      const invites = [];
      for (const inv of pending) {
        const leaderId = (inv as any).party?.leader_id;
        if (leaderId) {
          const { data: leaderName } = await supabase
            .rpc('get_character_name', { _character_id: leaderId });
          invites.push({ party_id: inv.party_id, id: inv.id, leader_name: (leaderName as string) || 'Unknown' });
        }
      }
      setPendingInvites(invites);
    } else {
      setPendingInvites([]);
    }
  }, [characterId]);

  // Lightweight function that only refreshes member character data (HP, level, node, etc.)
  const partyRef = useRef(party);
  useEffect(() => { partyRef.current = party; }, [party]);

  // Debounced fetchMemberStats — prevents redundant concurrent DB queries
  const fetchMemberStatsTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fetchMemberStatsCore = useCallback(async () => {
    const currentParty = partyRef.current;
    if (!currentParty) return;
    const { data } = await supabase
      .from('party_members')
      .select('id, character_id, status, is_following, character:characters(id, name, race, class, level, hp, max_hp, current_node_id)')
      .eq('party_id', currentParty.id)
      .eq('status', 'accepted');
    if (data) setMembers(data as unknown as PartyMember[]);
  }, []);

  const fetchMemberStats = useCallback(() => {
    // Debounce: only fire once per 500ms window
    if (fetchMemberStatsTimer.current) return;
    fetchMemberStatsTimer.current = setTimeout(() => {
      fetchMemberStatsTimer.current = null;
      fetchMemberStatsCore();
    }, 500);
  }, [fetchMemberStatsCore]);

  useEffect(() => {
    fetchParty();
    if (!characterId) return;

    const channel = supabase
      .channel(`party-${characterId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'party_members' }, () => fetchParty())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'parties' }, () => fetchParty())
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [characterId, fetchParty]);

  // Polling fallback — safety net for missed realtime/broadcast events (10s interval)
  useEffect(() => {
    if (!party) return;
    let active = true;
    let timeoutId: ReturnType<typeof setTimeout>;
    const poll = () => {
      if (!active) return;
      fetchMemberStatsCore();
      timeoutId = setTimeout(poll, 10000);
    };
    timeoutId = setTimeout(poll, 10000);
    return () => { active = false; clearTimeout(timeoutId); };
  }, [party?.id, fetchMemberStatsCore]);

  const createParty = useCallback(async () => {
    if (!characterId || party) return;
    const { data, error } = await supabase
      .from('parties')
      .insert({ leader_id: characterId })
      .select()
      .single();
    if (error) return;
    // Add self as accepted member
    await supabase.from('party_members').insert({
      party_id: data.id,
      character_id: characterId,
      status: 'accepted',
    });
    fetchParty();
  }, [characterId, party, fetchParty]);

  const invitePlayer = useCallback(async (targetCharacterId: string) => {
    if (!party) return;
    const { error } = await supabase.from('party_members').insert({
      party_id: party.id,
      character_id: targetCharacterId,
      status: 'pending',
    });
    if (error) return;
  }, [party]);

  const acceptInvite = useCallback(async (membershipId: string) => {
    // If already in a party, leave it first
    if (party) await leaveParty();
    await supabase.from('party_members').update({ status: 'accepted' }).eq('id', membershipId);
    fetchParty();
  }, [party, fetchParty]);

  const declineInvite = useCallback(async (membershipId: string) => {
    await supabase.from('party_members').delete().eq('id', membershipId);
    fetchParty();
  }, [fetchParty]);

  const leaveParty = useCallback(async () => {
    if (!party || !characterId) return;
    if (party.leader_id === characterId) {
      // Disband party
      await supabase.from('party_members').delete().eq('party_id', party.id);
      await supabase.from('parties').delete().eq('id', party.id);
    } else {
      await supabase.from('party_members').delete()
        .eq('party_id', party.id)
        .eq('character_id', characterId);
    }
    fetchParty();
  }, [party, characterId, fetchParty]);

  const kickMember = useCallback(async (targetCharacterId: string) => {
    if (!party) return;
    await supabase.from('party_members').delete()
      .eq('party_id', party.id)
      .eq('character_id', targetCharacterId);
    fetchParty();
  }, [party, fetchParty]);

  const setTank = useCallback(async (tankCharacterId: string | null) => {
    if (!party) return;
    await supabase.from('parties').update({ tank_id: tankCharacterId }).eq('id', party.id);
    fetchParty();
  }, [party, fetchParty]);

  const toggleFollow = useCallback(async (following: boolean) => {
    if (!party || !characterId) return;

    // If enabling follow, check that we're on the same node as the leader
    if (following) {
      const leaderMember = members.find(m => m.character_id === party.leader_id);
      const myMember = members.find(m => m.character_id === characterId);
      if (leaderMember?.character?.current_node_id && myMember?.character?.current_node_id &&
          leaderMember.character.current_node_id !== myMember.character.current_node_id) {
        // Can't follow — not at same location
        return;
      }
    }

    await supabase.from('party_members').update({ is_following: following })
      .eq('party_id', party.id)
      .eq('character_id', characterId);
    fetchParty();
  }, [party, characterId, members, fetchParty]);

  const isLeader = party?.leader_id === characterId;
  const effectiveTankId = party ? (party.tank_id ?? party.leader_id) : null;
  const isTank = effectiveTankId === characterId;
  const myMembership = members.find(m => m.character_id === characterId);

  return {
    party, members, pendingInvites, isLeader, isTank, myMembership,
    createParty, invitePlayer, acceptInvite, declineInvite,
    leaveParty, kickMember, setTank, toggleFollow, fetchParty,
  };
}
