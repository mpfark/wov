import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { useGameContext } from '@/contexts/GameContext';
import CharacterCreation from '@/pages/CharacterCreation';
import { requestCreation, acknowledgeCreation } from '@/features/character/creation-client';
import type { AdminCharacter, AdminUser } from './constants';

export default function CharacterLifecycleControls({ target, character, refresh }: {
  target: AdminUser; character: AdminCharacter | null; refresh: () => Promise<void>;
}) {
  const { user } = useGameContext();
  const [creating, setCreating] = useState(false);
  const [reason, setReason] = useState(() => {
    if (!user || !character) return '';
    return JSON.parse(sessionStorage.getItem(`c2-lifecycle:${user.id}:${character.id}`) ?? 'null')?.payload?._reason ?? '';
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const pendingOperation = user && character ? JSON.parse(sessionStorage.getItem(
    `c2-lifecycle:${user.id}:${character.id}`) ?? 'null')?.payload?._operation as string | undefined : undefined;
  const act = async (operation: 'restore' | 'purge') => {
    if (!user || !character || !reason.trim()) return;
    const key = `c2-lifecycle:${user.id}:${character.id}`;
    const payload = { _character: character.id, _expected_version: character.lifecycle_version,
      _operation: operation, _reason: reason.trim() };
    setBusy(true); setError('');
    try {
      let pending = JSON.parse(sessionStorage.getItem(key) ?? 'null') as
        { request: string; payload: typeof payload } | null;
      if (pending && (pending.payload._operation !== operation || pending.payload._reason !== reason.trim()
        || pending.payload._character !== character.id)) {
        throw new Error('Retry the original operation, version and reason before starting another.');
      }
      if (!pending) {
        pending = { request: crypto.randomUUID(), payload };
        sessionStorage.setItem(key, JSON.stringify(pending));
      }
      const { data, error: rpcError } = await supabase.rpc('character_lifecycle_command' as never,
        { ...pending.payload, _request: pending.request } as never);
      if (rpcError) {
        if (/^[0-9A-Z]{5}$/.test(rpcError.code ?? '')) sessionStorage.removeItem(key);
        throw rpcError;
      }
      const result = data as unknown as { kind?: string; characterId?: string };
      if (result?.characterId !== character.id || result.kind !== (operation === 'purge' ? 'purged' : 'restored')) {
        throw new Error('Unexpected lifecycle response; retry the original request.');
      }
      await refresh();
      sessionStorage.removeItem(key);
      setReason(''); setConfirmed(false);
      toast.success(operation === 'purge' ? 'Character permanently purged.' : 'Character restored without new starting grants.');
    } catch (failure: unknown) {
      setError(String((failure as { message?: string })?.message ?? failure));
    } finally { setBusy(false); }
  };
  if (!user) return null;
  if (creating) return <CharacterCreation key={target.id} actorId={user.id} targetAccount={target.id === user.id ? undefined : target.id}
    onBack={() => setCreating(false)} onCreateCharacter={async choices => {
      const id = await requestCreation(user.id, choices);
      await refresh();
      acknowledgeCreation(user.id, choices.targetAccount);
      return { id };
    }} onCharacterReady={() => setCreating(false)} />;
  const deadline = character?.restore_until ? Date.parse(character.restore_until) : NaN;
  const valid = !!character?.deleted_at && Number.isFinite(deadline) && Number.isSafeInteger(character.lifecycle_version);
  return <section className="p-3 space-y-2 border-b">
    <Button onClick={() => setCreating(true)} disabled={busy}>Create Wayfarer for selected account</Button>
    {character?.deleted_at && <>
      <p>Deleted {character.deleted_at}. Restoration deadline: {character.restore_until}.</p>
      <Input aria-label="Lifecycle reason" value={reason} maxLength={2000} disabled={busy}
        onChange={e => setReason(e.target.value)} placeholder="Required audit reason" />
      <Button disabled={busy || !valid || (Date.now() >= deadline && pendingOperation !== 'restore') || !reason.trim()}
        onClick={() => act('restore')}>{pendingOperation === 'restore' ? 'Retry restoration' : 'Restore'}</Button>
      <label><input type="checkbox" checked={confirmed} disabled={busy} onChange={e => setConfirmed(e.target.checked)} />
        I confirm permanent removal of this character and its origin/progression data.</label>
      <Button variant="destructive" disabled={busy || !valid || Date.now() < deadline || !reason.trim() || !confirmed}
        onClick={() => act('purge')}>Permanently purge</Button>
      <p>Eligibility, authority and deadline are checked again by the server. No automatic purge.</p>
    </>}
    {error && <p role="alert">{error}</p>}
  </section>;
}
