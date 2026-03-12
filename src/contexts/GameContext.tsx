import { createContext, useContext, useState, useCallback, useEffect, useRef, ReactNode } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { useCharacter, Character } from '@/hooks/useCharacter';
import { useRole } from '@/hooks/useRole';
import { useNodes, GameNode, Region } from '@/hooks/useNodes';
import { useInactivityLogout } from '@/hooks/useInactivityLogout';
import { logActivity } from '@/hooks/useActivityLog';

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

  // Nodes
  nodes: GameNode[];
  regions: Region[];
  nodesLoading: boolean;
  startingNode: GameNode | undefined;
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
  const { isAdmin, isValar } = useRole(user);

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
      isAdmin, isValar,
      nodes, regions, nodesLoading, startingNode,
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
