import { useGameContext } from '@/contexts/GameContext';
import { useNavigate } from 'react-router-dom';
import { useEffect, useRef, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import GamePage from './GamePage';

export default function GameRoute() {
  const { user, authLoading, character, charLoading, nodesLoading, updateCharacter, updateCharacterLocal, signOut, isAdmin, nodes, startingNode, clearSelectedCharacter, refetchCharacters } = useGameContext();
  const navigate = useNavigate();
  const [syncing, setSyncing] = useState(false);
  const syncedForCharRef = useRef<string | null>(null);

  // On world entry, recalculate gear-adjusted max_hp/max_cp/max_mp on the
  // server so the persisted row matches the gear baseline. Prevents the
  // HP/CP/MP "snap-back" caused by the row's max_* lagging behind gear.
  useEffect(() => {
    if (!character?.id) return;
    if (syncedForCharRef.current === character.id) return;
    syncedForCharRef.current = character.id;
    setSyncing(true);
    (async () => {
      try {
        await supabase.rpc('sync_character_resources' as any, { p_character_id: character.id });
        refetchCharacters();
      } catch (e) {
        console.error('Failed to sync character resources on entry:', e);
      } finally {
        setSyncing(false);
      }
    })();
  }, [character?.id, refetchCharacters]);

  if (authLoading || charLoading || nodesLoading || syncing) {
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
      updateCharacterLocal={updateCharacterLocal}
      onSignOut={signOut}
      isAdmin={isAdmin}
      onOpenAdmin={() => window.open('/admin', '_blank')}
      startingNodeId={startingNode?.id ?? nodes[0]?.id}
      onSwitchCharacter={() => { clearSelectedCharacter(); navigate('/'); }}
      refetchCharacters={refetchCharacters}
    />
  );
}
