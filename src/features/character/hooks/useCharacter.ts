import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';
import type { User } from '@supabase/supabase-js';
import { clampResourceUpdates } from '../utils/clampResources';
import { clearCharacter } from '@/features/combat/events/log-archive';
import { isConfiguredCombat2Tester } from '@/features/combat2/test-config';

export interface Character {
  id: string;
  user_id: string;
  name: string;
  gender: 'male' | 'female';
  race: string;
  class: string;
  level: number;
  xp: number;
  hp: number;
  max_hp: number;
  gold: number;
  str: number;
  dex: number;
  con: number;
  int: number;
  wis: number;
  cha: number;
  ac: number;
  current_node_id: string | null;
  unspent_stat_points: number;
  cp: number;
  max_cp: number;
  mp: number;
  max_mp: number;
  respec_points: number;
  // LEGACY: salvage has moved to character_materials (read via useMaterials).
  // The DB column still exists for migration compatibility but is no longer
  // mirrored on this type.
  // `bhp` is legacy storage for the current Renown balance.
  // `bhp_trained` is legacy storage for Renown training ranks.
  // Only the player-facing name changed; the columns kept their original names
  // to avoid a wide rename across types.ts and edge functions.
  bhp: number;
  bhp_trained: Record<string, number>;
  /** Lifetime Renown earned (never decreases). Used by the Renown Board. */
  rp_total_earned: number;
  /** @deprecated Pre-Soulforged-Ring legacy flag. Always false on new chars. */
  soulforged_item_created?: boolean;
  /** @deprecated Pre-Soulforged-Ring legacy flag. Always false on new chars. */
  crown_item_created?: boolean;
  /** Soulforged Ring upgrade tier (0 = not yet forged, 1–5 = current ring). */
  soulring_tier?: number;
  /** Inventory row holding the current Soulforged Ring (NULL if no ring). */
  soulring_inventory_id?: string | null;
  /** Timestamp of the last King Aldric killing blow. Active while < 30 min offline. */
  king_slayer_at?: string | null;
  /** Last time the player was seen online (used to time out the King title). */
  last_online?: string | null;
  /** Optional family/house display name (e.g. "Stark"). NULL when none. */
  family_name?: string | null;
  /** FK to families.id. NULL when the character has no family. */
  family_id?: string | null;
  /** True if the player has already used their post-creation Heraldry change. */
  family_changed_after_creation?: boolean;
  /** Active CP-reservation stances (key → entry). Wiped on character load + death. */
  reserved_buffs?: any;
  /** Persistent stance values (e.g. Force Shield ward HP across combats). */
  stance_state?: { force_shield_hp?: number; force_shield_updated_at?: string } | null;
  /** AI-generated character portrait URL (empty string when none). */
  portrait_url?: string;
  /** Inputs used for the last portrait generation. */
  portrait_metadata?: Record<string, unknown>;
  /** Timestamp of the last portrait generation (24h cooldown). */
  portrait_generated_at?: string | null;
  /** True until the player visits a hall and joins an Order. */
  is_classless?: boolean;
  /** Auto-flee threshold as % of max HP (0 = disabled). */
  wimp_hp_threshold?: number;
  /** Compass direction to flee toward when wimp triggers (N/S/E/W/NE/NW/SE/SW). */
  wimp_direction?: string | null;
  /** ISO timestamp — while in the future, the character cannot move (boss cast stagger). */
  movement_locked_until?: string | null;
}

export function useCharacter(user: User | null) {
  const [characters, setCharacters] = useState<Character[]>([]);
  const [selectedCharacterId, setSelectedCharacterId] = useState<string | null>(
    () => sessionStorage.getItem('selectedCharacterId')
  );

  // Sync selectedCharacterId to sessionStorage
  useEffect(() => {
    if (selectedCharacterId) {
      sessionStorage.setItem('selectedCharacterId', selectedCharacterId);
    } else {
      sessionStorage.removeItem('selectedCharacterId');
    }
  }, [selectedCharacterId]);

  const [loading, setLoading] = useState(true);
  const prevUserIdRef = useRef<string | null>(null);

  // Track fields with pending DB writes so realtime doesn't revert optimistic updates
  const pendingWritesRef = useRef<Map<string, Set<string>>>(new Map());

  // Fields that are optimistic locally and NOT yet persisted. Unlike
  // `pendingWritesRef` these are held indefinitely — until a real DB write for
  // that field happens. Without this, a realtime echo arriving after the 3 s
  // pending window (very common when a backgrounded tab reconnects its
  // realtime socket) reverts local regen to the last persisted values, which
  // is the visible "HP/MP drop on window switch, then regen back" symptom.
  const heldFieldsRef = useRef<Map<string, Set<string>>>(new Map());


  const fetchCharactersRef = useRef(async () => {});
  fetchCharactersRef.current = async () => {
    if (!user) return;
    const { data, error } = await supabase
      .from('characters')
      .select('*')
      .eq('user_id', user.id)
      .order('created_at', { ascending: true });
    if (!error && data) {
      // A fresh fetch is the new source of truth — drop any stale pending masks
      // for the rows we just received so the next realtime echo is honored.
      // (Otherwise, e.g. after re-login, an old 3 s mask from a pre-relog regen
      // write could hide the post-login authoritative HP/CP/MP for several seconds.)
      const fetchedIds = new Set((data as Character[]).map(c => c.id));
      for (const id of fetchedIds) {
        pendingWritesRef.current.delete(id);
        heldFieldsRef.current.delete(id);
      }
      // Drop entries for characters that no longer belong to this user.
      for (const id of Array.from(pendingWritesRef.current.keys())) {
        if (!fetchedIds.has(id)) pendingWritesRef.current.delete(id);
      }
      for (const id of Array.from(heldFieldsRef.current.keys())) {
        if (!fetchedIds.has(id)) heldFieldsRef.current.delete(id);
      }

      setCharacters(data as Character[]);
    }
    setLoading(false);
  };

  const refetchCharacters = useCallback(() => {
    fetchCharactersRef.current();
  }, []);

  const selectedCharacter = characters.find(c => c.id === selectedCharacterId) ?? null;

  useEffect(() => {
    if (!user) {
      prevUserIdRef.current = null;
      setCharacters([]);
      setSelectedCharacterId(null);
      // Drop all pending masks on sign-out so a future login starts clean.
      // Reassign instead of .clear() to be robust against HMR-preserved refs
      // that may have been initialized as a non-Map in a prior code version.
      pendingWritesRef.current = new Map();
      heldFieldsRef.current = new Map();

      setLoading(false);
      return;
    }

    // Only reset loading + refetch when the actual user changes, not on token refreshes
    const isNewUser = prevUserIdRef.current !== user.id;
    prevUserIdRef.current = user.id;
    if (isNewUser) {
      setLoading(true);
      fetchCharactersRef.current();
    }
    // Skip refetch on token refreshes — realtime subscription keeps state in sync
    // and refetching would revert optimistic regen updates (HP/CP/MP).

    const channel = supabase
      .channel('my-characters')
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'characters',
        filter: `user_id=eq.${user.id}`,
      }, (payload) => {
        if (payload.eventType === 'DELETE') {
          const deletedId = (payload.old as any).id;
          setCharacters(prev => prev.filter(c => c.id !== deletedId));
          setSelectedCharacterId(prev => prev === deletedId ? null : prev);
        } else if (payload.eventType === 'INSERT') {
          setCharacters(prev => [...prev, payload.new as Character]);
        } else {
          const incoming = payload.new as Character;
          const pendingFields = pendingWritesRef.current.get(incoming.id);
          const heldFields = heldFieldsRef.current.get(incoming.id);
          setCharacters(prev => prev.map(c => {
            if (c.id !== incoming.id) return c;
            const keep = new Set<string>([
              ...(pendingFields ? Array.from(pendingFields) : []),
              ...(heldFields ? Array.from(heldFields) : []),
            ]);
            if (keep.size === 0) return incoming;
            // Merge: use local optimistic value for pending/held fields, server value for rest
            const merged = { ...incoming };
            for (const field of keep) {
              (merged as any)[field] = (c as any)[field];
            }
            return merged;
          }));

        }
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [user]);

  const selectCharacter = useCallback((id: string) => {
    setSelectedCharacterId(id);
  }, []);

  const clearSelectedCharacter = useCallback(() => {
    setSelectedCharacterId(null);
  }, []);

  const deleteCharacter = useCallback(async (id: string) => {
    // Optimistically remove from UI immediately
    setCharacters(prev => prev.filter(c => c.id !== id));
    setSelectedCharacterId(prev => prev === id ? null : prev);
    // Fully purge the character and all related rows in a single transaction
    const { error } = await supabase.rpc('delete_character_cascade', { _character_id: id });
    if (error) {
      // Revert on failure — refetch
      const { data } = await supabase.from('characters').select('*').eq('user_id', user!.id).order('created_at', { ascending: true });
      if (data) setCharacters(data as Character[]);
      throw error;
    }
    // Purge the player's on-device log archive for this character too.
    void clearCharacter(id);
  }, [user]);

  const createCharacter = async (charData: {
    name: string; race: string; class: string;
    str: number; dex: number; con: number; int: number; wis: number; cha: number;
    hp: number; max_hp: number; ac: number; current_node_id: string;
    is_classless?: boolean;
  }) => {
    if (!user) return null;
    const { data, error } = await supabase
      .from('characters')
      .insert({
        name: charData.name,
        race: charData.race as any,
        class: charData.class as any,
        str: charData.str, dex: charData.dex, con: charData.con,
        int: charData.int, wis: charData.wis, cha: charData.cha,
        hp: charData.hp, max_hp: charData.max_hp, ac: charData.ac,
        current_node_id: charData.current_node_id,
        user_id: user.id,
        is_classless: charData.is_classless ?? false,
      })
      .select()
      .single();
    if (error) throw error;
    const char = data as Character;
    setCharacters(prev => [...prev, char]);
    // Don't select yet — let the caller finish setup (e.g. granting gear) first
    return data;
  };

  const selectCharacterAfterCreate = useCallback((id: string) => {
    setSelectedCharacterId(id);
  }, []);

  /** Update character state locally AND persist to DB (for player-initiated actions).
   *  Optional `effectiveCaps` lets callers (e.g. regen loop) clamp to gear-boosted
   *  effective maxima instead of the base max stored on the row. */
  const updateCharacter = async (
    updates: Partial<Character>,
    effectiveCaps?: { maxHp?: number; maxCp?: number; maxMp?: number }
  ) => {
    if (!selectedCharacter) return;
    const charId = selectedCharacter.id;
    const fields = Object.keys(updates);

    // Mark fields as pending so realtime won't revert them
    const pending = pendingWritesRef.current.get(charId) || new Set<string>();
    fields.forEach(f => pending.add(f));
    pendingWritesRef.current.set(charId, pending);

    // This write persists these fields, so they are no longer "unpersisted".
    const held = heldFieldsRef.current.get(charId);
    if (held) {
      fields.forEach(f => held.delete(f));
      if (held.size === 0) heldFieldsRef.current.delete(charId);
    }

    setCharacters(prev => prev.map(c => c.id === charId ? { ...c, ...updates } : c));

    // Build DB payload — clamp hp/cp/mp so the server-side trigger doesn't
    // silently reduce them. Prefer caller-supplied effective caps (which
    // include equipment bonuses); fall back to the base max on the row.
    const charForCaps = characters.find(c => c.id === charId);
    const dbUpdates = charForCaps
      ? clampResourceUpdates(updates, charForCaps, effectiveCaps)
      : { ...updates };

    try {
      const { error } = await supabase
        .from('characters')
        .update(dbUpdates as any)
        .eq('id', charId);
      if (error) throw error;
    } finally {
      // Delay clearing pending flags so late-arriving realtime echoes are ignored
      setTimeout(() => {
        const current = pendingWritesRef.current.get(charId);
        if (current) {
          fields.forEach(f => current.delete(f));
          if (current.size === 0) pendingWritesRef.current.delete(charId);
        }
      }, 3000);
    }
  };

  /** Update character state locally only — no DB write.
   *  Used by combat tick processing where the server already persisted the values.
   *  Pass `hold: true` when the value is optimistic and NOT yet persisted (e.g.
   *  throttled regen): the field is then protected from realtime echoes until a
   *  real DB write for it happens, instead of only for 3 s. */
  const updateCharacterLocal = useCallback((updates: Partial<Character>, hold = false) => {
    if (!selectedCharacterId) return;
    const charId = selectedCharacterId;
    const fields = Object.keys(updates);

    // Mark fields as pending so realtime won't revert optimistic values
    const pending = pendingWritesRef.current.get(charId) || new Set<string>();
    fields.forEach(f => pending.add(f));
    pendingWritesRef.current.set(charId, pending);

    if (hold) {
      const heldSet = heldFieldsRef.current.get(charId) || new Set<string>();
      fields.forEach(f => heldSet.add(f));
      heldFieldsRef.current.set(charId, heldSet);
    }

    setCharacters(prev => prev.map(c => c.id === charId ? { ...c, ...updates } : c));

    // Clear pending after a short delay to let realtime catch up
    setTimeout(() => {
      const current = pendingWritesRef.current.get(charId);
      if (current) {
        fields.forEach(f => current.delete(f));
        if (current.size === 0) pendingWritesRef.current.delete(charId);
      }
    }, 3000);
  }, [selectedCharacterId]);


  /** Force-clear fields locally AND drop their pending-write masks so the next
   *  realtime echo from the server (which is authoritative) is accepted instead
   *  of merged out. Use for on-death wipes like reserved_buffs where stale
   *  optimistic state must not survive past the server's authoritative reset. */
  const clearCharacterFields = useCallback((updates: Partial<Character>) => {
    if (!selectedCharacterId) return;
    const charId = selectedCharacterId;
    const fields = Object.keys(updates);
    setCharacters(prev => prev.map(c => c.id === charId ? { ...c, ...updates } : c));
    const current = pendingWritesRef.current.get(charId);
    if (current) {
      fields.forEach(f => current.delete(f));
      if (current.size === 0) pendingWritesRef.current.delete(charId);
    }
    const heldSet = heldFieldsRef.current.get(charId);
    if (heldSet) {
      fields.forEach(f => heldSet.delete(f));
      if (heldSet.size === 0) heldFieldsRef.current.delete(charId);
    }

  }, [selectedCharacterId]);


  // ── Force Shield: out-of-combat ward regen ──────────────────────
  // While the Force Shield stance is reserved, periodically nudge the
  // server's lazy-regen RPC so `stance_state.force_shield_hp` ticks back
  // up over time. The RPC is a no-op while the player is in combat
  // (combat-tick owns the value during fights), so this is safe to call
  // unconditionally on a slow cadence.
  const forceShieldActive = !!(selectedCharacter?.reserved_buffs && (selectedCharacter.reserved_buffs as any).force_shield);
  const restrictedTester = isConfiguredCombat2Tester(selectedCharacterId, selectedCharacter?.current_node_id);
  useEffect(() => {
    if (restrictedTester || !forceShieldActive || !selectedCharacterId) return;
    let cancelled = false;
    const tick = async () => {
      try {
        const { data } = await supabase.rpc('apply_force_shield_regen' as any, { _character_id: selectedCharacterId });
        if (cancelled || !data) return;
        setCharacters(prev => prev.map(c => c.id === selectedCharacterId ? { ...c, stance_state: data as any } : c));
      } catch { /* ignore — next tick will retry */ }
    };
    tick();
    const id = setInterval(tick, 4000);
    return () => { cancelled = true; clearInterval(id); };
  }, [forceShieldActive, selectedCharacterId, restrictedTester]);

  return {
    characters,
    character: selectedCharacter,
    loading,
    selectCharacter,
    clearSelectedCharacter,
    deleteCharacter,
    createCharacter,
    updateCharacter,
    updateCharacterLocal,
    clearCharacterFields,
    selectCharacterAfterCreate,
    refetchCharacters,
  };
}
