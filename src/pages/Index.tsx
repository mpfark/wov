import { useState, useCallback, useEffect, useRef } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { useCharacter } from '@/hooks/useCharacter';
import { useRole } from '@/hooks/useRole';
import { useInactivityLogout } from '@/hooks/useInactivityLogout';
import AuthPage from './AuthPage';
import CharacterCreation from './CharacterCreation';
import CharacterSelect from './CharacterSelect';
import GamePage from './GamePage';
import AdminPage from './AdminPage';
import { useNodes } from '@/hooks/useNodes';
import { logActivity } from '@/hooks/useActivityLog';

const Index = () => {
  const { user, loading: authLoading, signOut } = useAuth();
  const {
    characters, character, loading: charLoading,
    selectCharacter, clearSelectedCharacter, deleteCharacter,
    createCharacter, updateCharacter,
  } = useCharacter(user);
  const { nodes, loading: nodesLoading } = useNodes(!!user);
  const { isAdmin, isValar } = useRole(user);
  const [showAdmin, setShowAdmin] = useState(false);
  const [showCreateNew, setShowCreateNew] = useState(false);

  const handleInactiveLogout = useCallback(() => {
    if (user) {
      signOut();
    }
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

  if (authLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center parchment-bg">
        <p className="font-display text-primary text-glow animate-pulse">Preparing your adventure...</p>
      </div>
    );
  }

  if (!user) return <AuthPage />;

  if (charLoading || nodesLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center parchment-bg">
        <p className="font-display text-primary text-glow animate-pulse">Loading your adventure...</p>
      </div>
    );
  }

  if (showAdmin && isAdmin) {
    return <AdminPage onBack={() => setShowAdmin(false)} isValar={isValar} />;
  }

  const startingNode = nodes[0];

  // Character creation flow (no characters yet, or explicitly creating new)
  if (characters.length === 0 || showCreateNew) {
    if (!startingNode) {
      return (
        <div className="flex min-h-screen items-center justify-center parchment-bg">
          <p className="font-display text-muted-foreground">No world data found. A Valar must seed the world.</p>
        </div>
      );
    }
    return (
      <CharacterCreation
        onCreateCharacter={async (data) => {
          const result = await createCharacter(data);
          setShowCreateNew(false);
          return result;
        }}
        startingNodeId={startingNode.id}
        onBack={characters.length > 0 ? () => setShowCreateNew(false) : undefined}
      />
    );
  }

  // Character selection screen
  if (!character) {
    return (
      <CharacterSelect
        characters={characters}
        onSelect={selectCharacter}
        onCreateNew={() => setShowCreateNew(true)}
        onDelete={deleteCharacter}
        onSignOut={signOut}
      />
    );
  }

  return (
    <GamePage
      character={character}
      updateCharacter={updateCharacter}
      onSignOut={signOut}
      isAdmin={isAdmin}
      onOpenAdmin={() => setShowAdmin(true)}
      startingNodeId={startingNode?.id ?? nodes[0]?.id}
      onSwitchCharacter={clearSelectedCharacter}
    />
  );
};

export default Index;
