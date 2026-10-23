import { useEffect, useRef, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useGameContext } from '@/contexts/GameContext';
import NodePicker from '@/components/admin/NodePicker';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { useTestTeleportRequest } from '../hooks/useTestTeleportRequest';

type Destination = { id: string; name: string; region_id: string };
const invoke = (action: string, body: unknown) => supabase.functions.invoke(`admin-users?action=${action}`, { body });
export default function GameplayTestTeleport({ characterId, onMoved }: { characterId: string; onMoved: () => void }) {
  const { user } = useGameContext();
  return user ? <ScopedControl key={`${user.id}:${characterId}`} accountId={user.id} characterId={characterId} onMoved={onMoved} /> : null;
}
function ScopedControl({ accountId, characterId, onMoved }: { accountId: string; characterId: string; onMoved: () => void }) {
  const [destinations, setDestinations] = useState<Destination[]>([]);
  const [destination, setDestination] = useState<string | null>(null);
  const request = useTestTeleportRequest(accountId, characterId);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    let current = true;
    void invoke('test-teleport-access', { character_id: characterId }).then(({ data, error }) => {
      if (current && !error && Array.isArray(data?.destinations)) setDestinations(data.destinations);
    }).catch(() => { /* Unavailable access metadata never enables the control. */ });
    return () => { current = false; mounted.current = false; };
  }, [characterId]);
  if (!destinations.length && !request.pending && !request.recoveryError) return null;
  return <section className="space-y-2 rounded border p-2" aria-label="Authorized gameplay test travel">
    <p className="text-xs text-muted-foreground">Gameplay test travel — approved solo characters and destinations only.</p>
    {request.recoveryError ? <p role="alert">{request.recoveryError}</p> : request.pending ?
      <p className="text-xs">Unresolved test travel. Retry the original destination; no replacement request will be sent.</p> :
      <NodePicker nodes={destinations} regions={[]} value={destination} onChange={setDestination} />}
    <Button size="sm" disabled={request.busy || !!request.recoveryError || (!request.pending && !destinations.some(n => n.id === destination))}
      onClick={async () => {
        try {
          const result = await request.submit(destination, p => invoke('test-teleport', p));
          if (result && mounted.current) { toast.success('Test travel completed.'); onMoved(); }
        } catch (e) { if (mounted.current) toast.error(e instanceof Error ? e.message : 'Test travel uncertain. Retry the pending request.'); }
      }}>{request.busy ? 'Requesting…' : request.pending ? 'Retry pending test travel' : 'Test teleport'}</Button>
  </section>;
}
