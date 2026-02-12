import { useState, useCallback } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { useCharacter } from '@/hooks/useCharacter';
import { useRole } from '@/hooks/useRole';
import { useInactivityLogout } from '@/hooks/useInactivityLogout';
import AuthPage from './AuthPage';
import CharacterCreation from './CharacterCreation';
import GamePage from './GamePage';
import AdminPage from './AdminPage';
import { useNodes } from '@/hooks/useNodes';
import { toast } from 'sonner';

const Index = () => {
  const { user, loading: authLoading, signOut } = useAuth();
  const { character, loading: charLoading, createCharacter, updateCharacter } = useCharacter(user);
  const { nodes, loading: nodesLoading } = useNodes(!!user);
  const { isAdmin, isValar } = useRole(user);
  const [showAdmin, setShowAdmin] = useState(false);

  const handleInactiveLogout = useCallback(() => {
    if (user) {
      toast.info('You have been logged out due to inactivity.');
      signOut();
    }
  }, [user, signOut]);

  useInactivityLogout(handleInactiveLogout);

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

  if (!character) {
    if (!startingNode) {
      return (
        <div className="flex min-h-screen items-center justify-center parchment-bg">
          <p className="font-display text-muted-foreground">No world data found. A Valar must seed the world.</p>
        </div>
      );
    }
    return (
      <CharacterCreation
        onCreateCharacter={createCharacter}
        startingNodeId={startingNode.id}
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
    />
  );
};

export default Index;
