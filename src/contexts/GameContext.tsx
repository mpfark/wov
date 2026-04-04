import { createContext, useContext, useCallback, useEffect, useRef, useState, ReactNode } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { useCharacter, Character } from '@/features/character';
import { useRole } from '@/hooks/useRole';
import { useNodes, GameNode, Region } from '@/features/world';
import { useInactivityLogout } from '@/hooks/useInactivityLogout';
import { logActivity } from '@/hooks/useActivityLog';
import { supabase } from '@/integrations/supabase/client';

interface GameContextValue {
  // Auth
  user: ReturnType<typeof useAuth>['user'];
  authLoading: boolean;
  signOut: () => Promise<any>;

  // Character
  characters: Character[];
  character: Character | null;
  charLoading: boolean;
  selectCharacter: (id: string) => void;
  clearSelectedCharacter: () => void;
  deleteCharacter: (id: string) => Promise<void>;
  createCharacter: (data: any) => Promise<any>;
  updateCharacter: (updates: Partial<Character>) => Promise<void>;
  updateCharacterLocal: (updates: Partial<Character>) => void;
  selectCharacterAfterCreate: (id: string) => void;
  refetchCharacters: () => void;

  // Role
  isAdmin: boolean;
  isValar: boolean;
  roleLoading: boolean;

  // Nodes
  nodes: GameNode[];
  regions: Region[];
  nodesLoading: boolean;
  startingNode: GameNode | undefined;

  // Profile / onboarding
  profileLoading: boolean;
  hasCompletedOnboarding: boolean;
  profileFullName: string | null;
  refetchProfile: () => void;
}

const GameContext = createContext<GameContextValue | null>(null);

export function GameProvider({ children }: { children: ReactNode }) {
  const { user, loading: authLoading, signOut } = useAuth();
  const {
    characters, character, loading: charLoading,
    selectCharacter, clearSelectedCharacter, deleteCharacter,
    createCharacter, updateCharacter, updateCharacterLocal, selectCharacterAfterCreate,
    refetchCharacters,
  } = useCharacter(user);
  const { nodes, regions, loading: nodesLoading } = useNodes(!!user);
  const { isAdmin, isValar, loading: roleLoading } = useRole(user);

  // Profile / onboarding state
  const [profileLoading, setProfileLoading] = useState(true);
  const [hasCompletedOnboarding, setHasCompletedOnboarding] = useState(false);
  const [profileFullName, setProfileFullName] = useState<string | null>(null);

  const fetchProfile = useCallback(async () => {
    if (!user) {
      setProfileLoading(false);
      setHasCompletedOnboarding(false);
      setProfileFullName(null);
      return;
    }
    setProfileLoading(true);
    const { data } = await supabase
      .from('profiles')
      .select('full_name, has_accepted_oath')
      .eq('user_id', user.id)
      .single();
    setHasCompletedOnboarding(
      !!(data?.has_accepted_oath && data?.full_name && data.full_name.trim().length > 0)
    );
    setProfileFullName(data?.full_name ?? null);
    setProfileLoading(false);
  }, [user]);

  useEffect(() => { fetchProfile(); }, [fetchProfile]);

  const handleInactiveLogout = useCallback(() => {
    if (user) signOut();
  }, [user, signOut]);

  useInactivityLogout(handleInactiveLogout);

  // Log login event once per session
  const loggedLoginRef = useRef(false);
  useEffect(() => {
    if (user && !loggedLoginRef.current) {
      loggedLoginRef.current = true;
      logActivity(user.id, null, 'login', 'Logged in');
    }
    if (!user) loggedLoginRef.current = false;
  }, [user]);

  const startingNode = nodes.find(n => n.name === 'Hearthvale Square') ?? nodes[0];

  return (
    <GameContext.Provider value={{
      user, authLoading, signOut,
      characters, character, charLoading,
      selectCharacter, clearSelectedCharacter, deleteCharacter,
      createCharacter, updateCharacter, updateCharacterLocal, selectCharacterAfterCreate, refetchCharacters,
      isAdmin, isValar, roleLoading,
      nodes, regions, nodesLoading, startingNode,
      profileLoading, hasCompletedOnboarding, profileFullName,
      refetchProfile: fetchProfile,
    }}>
      {children}
    </GameContext.Provider>
  );
}
export function useGameContext() {
  const ctx = useContext(GameContext);
  if (!ctx) throw new Error('useGameContext must be used within GameProvider');
  return ctx;
}
