import { useState } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { useCharacter } from '@/hooks/useCharacter';
import { useRole } from '@/hooks/useRole';
import AuthPage from './AuthPage';
import CharacterCreation from './CharacterCreation';
import GamePage from './GamePage';
import AdminPage from './AdminPage';
import { useNodes } from '@/hooks/useNodes';

const Index = () => {
  const { user, loading: authLoading, signOut } = useAuth();
  const { character, loading: charLoading, createCharacter, updateCharacter } = useCharacter(user);
  const { nodes, loading: nodesLoading } = useNodes(!!user);
  const { isAdmin, isValar } = useRole(user);
  const [showAdmin, setShowAdmin] = useState(false);

  if (authLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center parchment-bg">
        <p className="font-display text-primary text-glow animate-pulse">Entering Middle-earth...</p>
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
    />
  );
};

export default Index;
