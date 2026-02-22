import { useGameContext } from '@/contexts/GameContext';
import { useNavigate } from 'react-router-dom';
import GamePage from './GamePage';

export default function GameRoute() {
  const { user, authLoading, character, charLoading, nodesLoading, updateCharacter, signOut, isAdmin, nodes, startingNode, clearSelectedCharacter } = useGameContext();
  const navigate = useNavigate();

  if (authLoading || charLoading || nodesLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center parchment-bg">
        <p className="font-display text-primary text-glow animate-pulse">Loading your adventure...</p>
      </div>
    );
  }

  if (!user || !character) {
    navigate('/', { replace: true });
    return null;
  }

  return (
    <GamePage
      character={character}
      updateCharacter={updateCharacter}
      onSignOut={signOut}
      isAdmin={isAdmin}
      onOpenAdmin={() => navigate('/admin')}
      startingNodeId={startingNode?.id ?? nodes[0]?.id}
      onSwitchCharacter={() => { clearSelectedCharacter(); navigate('/'); }}
    />
  );
}
