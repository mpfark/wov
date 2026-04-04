import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useGameContext } from '@/contexts/GameContext';
import AuthPage from './AuthPage';
import CharacterCreation from './CharacterCreation';
import CharacterSelect from './CharacterSelect';
import ProfilePage from './ProfilePage';
import OnboardingGatePage from './OnboardingGatePage';

const Index = () => {
  const navigate = useNavigate();
  const {
    user, authLoading, signOut,
    characters, character, charLoading,
    selectCharacter, clearSelectedCharacter: _clearSelectedCharacter, deleteCharacter,
    createCharacter, selectCharacterAfterCreate,
    nodes: _nodes, nodesLoading, startingNode,
    isAdmin: _isAdmin,
    profileLoading, hasCompletedOnboarding, refetchProfile,
  } = useGameContext();

  const [showCreateNew, setShowCreateNew] = useState(false);
  const [showProfile, setShowProfile] = useState(false);

  // When a character is selected, navigate to game
  useEffect(() => {
    if (character && !showCreateNew) {
      navigate('/game', { replace: true });
    }
  }, [character, showCreateNew, navigate]);

  if (authLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center parchment-bg">
        <p className="font-display text-primary text-glow animate-pulse">Preparing your adventure...</p>
      </div>
    );
  }

  if (!user) return <AuthPage />;

  // Onboarding gate — wait for profile to load, then check
  if (profileLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center parchment-bg">
        <p className="font-display text-primary text-glow animate-pulse">Loading your adventure...</p>
      </div>
    );
  }

  if (!hasCompletedOnboarding) {
    return (
      <OnboardingGatePage
        userId={user.id}
        onComplete={refetchProfile}
      />
    );
  }

  if (charLoading || nodesLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center parchment-bg">
        <p className="font-display text-primary text-glow animate-pulse">Loading your adventure...</p>
      </div>
    );
  }

  // Character creation flow
  if (characters.length === 0 || showCreateNew) {
    if (!startingNode) {
      return (
        <div className="flex min-h-screen items-center justify-center parchment-bg">
          <p className="font-display text-muted-foreground">No world data found. An Overlord must seed the world.</p>
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
        onCharacterReady={(id: string) => selectCharacterAfterCreate(id)}
        startingNodeId={startingNode.id}
        onBack={characters.length > 0 ? () => setShowCreateNew(false) : undefined}
      />
    );
  }

  // Profile page
  if (showProfile) {
    return <ProfilePage onBack={() => setShowProfile(false)} />;
  }

  // Character selection screen
  return (
    <CharacterSelect
      characters={characters}
      onSelect={selectCharacter}
      onCreateNew={() => setShowCreateNew(true)}
      onDelete={deleteCharacter}
      onSignOut={signOut}
      onProfile={() => setShowProfile(true)}
    />
  );
};

export default Index;
