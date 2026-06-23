import { useGameContext } from '@/contexts/GameContext';
import { useNavigate } from 'react-router-dom';
import { useEffect, useRef, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import GamePage from './GamePage';
import { EmailVerificationGate } from '@/components/EmailVerificationGate';
import { LoadingScreen } from '@/components/LoadingScreen';

export default function GameRoute() {
  const { user, authLoading, character, charLoading, nodesLoading, updateCharacter, updateCharacterLocal, clearCharacterFields, signOut, isAdmin, nodes, startingNode, clearSelectedCharacter, refetchCharacters } = useGameContext();


  const navigate = useNavigate();
  // Track which character id has finished the entry-sync. Using state (not a
  // ref) ensures the gate below re-renders when sync completes, and crucially
  // prevents GamePage from mounting before sync — a pre-sync mount would emit
  // the first-entry welcome on a bus that gets discarded when sync flips this
  // value, leaving the player with only "Welcome back" on the real mount.
  const [syncedCharId, setSyncedCharId] = useState<string | null>(null);
  const syncStartedForRef = useRef<string | null>(null);

  // On world entry, recalculate gear-adjusted max_hp/max_cp/max_mp on the
  // server so the persisted row matches the gear baseline. Prevents the
  // HP/CP/MP "snap-back" caused by the row's max_* lagging behind gear.
  useEffect(() => {
    if (!character?.id) return;
    if (syncStartedForRef.current === character.id) return;
    syncStartedForRef.current = character.id;
    (async () => {
      try {
        // Wipe any leftover stance reservations from a previous session, then
        // recompute gear-adjusted resources. Stances never persist offline.
        await supabase.rpc('clear_stances' as any, { p_character_id: character.id });
        await supabase.rpc('sync_character_resources' as any, { p_character_id: character.id });
        refetchCharacters();
      } catch (e) {
        console.error('Failed to sync character resources on entry:', e);
      } finally {
        setSyncedCharId(character.id);
      }
    })();
  }, [character?.id, refetchCharacters]);

  const isSyncedForCurrent = !!character?.id && syncedCharId === character.id;

  if (authLoading || charLoading || nodesLoading || (!!character?.id && !isSyncedForCurrent)) {
    return <LoadingScreen />;
  }

  if (!user || !character) {
    navigate('/', { replace: true });
    return null;
  }

  // Email verification gate. Users created via OAuth (Google) have an email_confirmed_at
  // set automatically. Email/password signups must click the confirmation link before
  // entering the world.
  if (user.email && !user.email_confirmed_at) {
    return <EmailVerificationGate email={user.email} onSignOut={signOut} />;
  }


  return (
    <GamePage
      character={character}
      updateCharacter={updateCharacter}
      updateCharacterLocal={updateCharacterLocal}
      clearCharacterFields={clearCharacterFields}

      onSignOut={signOut}
      isAdmin={isAdmin}
      onOpenAdmin={() => window.open('/admin', '_blank')}
      startingNodeId={startingNode?.id ?? nodes[0]?.id}
      onSwitchCharacter={() => { clearSelectedCharacter(); navigate('/'); }}
      refetchCharacters={refetchCharacters}
      resourcesSynced={syncedForCharRef.current === character.id && !syncing}
    />
  );
}
