import { useGameContext } from '@/contexts/GameContext';
import { Navigate, useNavigate } from 'react-router-dom';
import { useEffect, useRef, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import GamePage from './GamePage';
import { EmailVerificationGate } from '@/components/EmailVerificationGate';
import { LoadingScreen } from '@/components/LoadingScreen';
import { combat2ArenaReservesLegacy } from '@/features/combat2/test-config';
import { COMBAT2_CLIENT_ENABLED } from '@/shared/config/feature-flags';
import { Button } from '@/components/ui/button';

export default function GameRoute() {
  const { user, authLoading, character, charLoading, nodesLoading, updateCharacter, updateCharacterLocal, clearCharacterFields, signOut, isAdmin, nodes, startingNode, clearSelectedCharacter, refetchCharacters, resourceDelivery } = useGameContext();


  const navigate = useNavigate();
  // Track which character id has finished the entry-sync. Using state (not a
  // ref) ensures the gate below re-renders when sync completes, and crucially
  // prevents GamePage from mounting before sync — a pre-sync mount would emit
  // the first-entry welcome on a bus that gets discarded when sync flips this
  // value, leaving the player with only "Welcome back" on the real mount.
  const [syncedGeneration, setSyncedGeneration] = useState<number | null>(null);
  const [entryError, setEntryError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  const syncStartedForRef = useRef<string | null>(null);
  const restrictedTester = combat2ArenaReservesLegacy(character?.current_node_id);
  const restrictedRef = useRef(restrictedTester);
  restrictedRef.current = restrictedTester;
  const characterIdRef = useRef(character?.id);
  characterIdRef.current = character?.id;
  const entryIdentity = useRef({ characterId: character?.id, restrictedTester, generation: 0 });
  if (entryIdentity.current.characterId !== character?.id || entryIdentity.current.restrictedTester !== restrictedTester) {
    entryIdentity.current = { characterId: character?.id, restrictedTester, generation: entryIdentity.current.generation + 1 };
  }
  const entryGeneration = entryIdentity.current.generation;
  const routeActive = useRef(true);
  useEffect(() => {
    routeActive.current = true;
    return () => { routeActive.current = false; };
  }, []);

  // On world entry, recalculate gear-adjusted max_hp/max_cp/max_mp on the
  // server so the persisted row matches the gear baseline. Prevents the
  // HP/CP/MP "snap-back" caused by the row's max_* lagging behind gear.
  useEffect(() => {
    if (!character?.id) return;
    if (restrictedTester) { setSyncedGeneration(entryGeneration); setEntryError(null); return; }
    const attemptKey = `${character.id}:${entryGeneration}:${retry}`;
    if (syncStartedForRef.current === attemptKey) return;
    syncStartedForRef.current = attemptKey;
    setEntryError(null);
    // Stances are only wiped on the FIRST entry of a browser session. A remount
    // of this route (or a tab reload) must not drop the player's active stances.
    const entryKey = `wov:entrySynced:${character.id}`;
    const firstEntryThisSession = sessionStorage.getItem(entryKey) !== '1';
    // The existing once-per-character entry attempt must survive Strict Mode replay.
    const current = () => routeActive.current && !restrictedRef.current && characterIdRef.current === character.id
      && entryIdentity.current.generation === entryGeneration;
    (async () => {
      try {
        if (!current()) return;
        if (firstEntryThisSession && !COMBAT2_CLIENT_ENABLED) {
          // Wipe leftover stance reservations from a previous session.
          const cleared = await supabase.rpc('clear_stances' as any, { p_character_id: character.id });
          if (cleared.error) throw cleared.error;
          if (!current()) return;
        }
        const result = await supabase.rpc('sync_character_resources' as any, { p_character_id: character.id });
        if (result.error) throw result.error;
        if (!current()) return;
        sessionStorage.setItem(entryKey, '1');
        refetchCharacters();
        setSyncedGeneration(entryGeneration);
      } catch (e) {
        if (current()) setEntryError('Your character could not be prepared. Please try again.');
      }
    })();
  }, [character?.id, refetchCharacters, restrictedTester, entryGeneration, retry]);


  const isSyncedForCurrent = !!character?.id && syncedGeneration === entryGeneration;

  if (!authLoading && !charLoading && !nodesLoading && (!user || !character)) {
    return <Navigate to="/" replace />;
  }

  if (entryError && !isSyncedForCurrent) {
    return <div className="flex min-h-screen flex-col items-center justify-center gap-3 parchment-bg">
      <p role="alert" className="font-display text-destructive text-center px-4">{entryError}</p>
      <Button onClick={() => { setEntryError(null); setRetry(value => value + 1); }}>Retry</Button>
      <Button variant="outline" onClick={() => { clearSelectedCharacter(); navigate('/'); }}>Choose character</Button>
    </div>;
  }

  if (authLoading || charLoading || nodesLoading || (!!character?.id && !isSyncedForCurrent)) {
    return <LoadingScreen />;
  }

  if (!user || !character) {
    return <Navigate to="/" replace />;
  }

  // Email verification gate. Users created via OAuth (Google) have an email_confirmed_at
  // set automatically. Email/password signups must click the confirmation link before
  // entering the world.
  if (user.email && !user.email_confirmed_at) {
    return <EmailVerificationGate email={user.email} onSignOut={signOut} />;
  }


  return (
    <GamePage
      key={character.id}
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
      resourcesSynced={isSyncedForCurrent}
      resourceDelivery={resourceDelivery}
    />
  );
}
