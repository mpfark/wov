import { PRIMARY_GEM_KEYS, type GemKey } from '@/shared/formulas/gems';
import { useEffect, useRef, useState } from 'react';

type Payload = { character_id: string; inventory_id: string; gem_key: GemKey; completion_id: string };
const busy = new Set<string>();
const changed = 'wov-gem-application-request';
const uuid = /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
export function useGemApplicationRequest(accountId: string | null, characterId: string) {
  const key = accountId ? `wov.gem-application.v1:${accountId}:${characterId}` : null;
  const [pending, setPending] = useState<Payload | null>(null);
  const [applying, setApplying] = useState(false);
  const [recoveryError, setRecoveryError] = useState<string | null>(null);
  const scope = useRef(key); scope.current = key;
  function read(): Payload | null {
    if (!key) return null;
    const raw = sessionStorage.getItem(key);
    if (!raw) return null;
    const r = JSON.parse(raw), p = r.payload;
    if (r.accountId !== accountId || p?.character_id !== characterId || typeof p?.inventory_id !== 'string' || typeof p?.completion_id !== 'string' || !PRIMARY_GEM_KEYS.includes(p.gem_key) || !uuid.test(p.inventory_id) || !uuid.test(p.completion_id))
      throw new Error('Pending gem application storage is invalid. Do not replace the unresolved request.');
    return p;
  }
  useEffect(() => {
    const recover = () => { try { setPending(read()); setRecoveryError(null); }
      catch { setRecoveryError('Pending gem application recovery unavailable. New gem applications are blocked.'); } };
    setApplying(key ? busy.has(key) : false);
    recover(); window.addEventListener(changed, recover);
    return () => window.removeEventListener(changed, recover);
  }, [key]);
  async function submit(itemId: string | null, gemKey: GemKey | null, affordable: boolean, invoke: (payload: Payload) => Promise<{ data: any; error: any }>) {
    if (!key) throw new Error('Sign in to apply gems.');
    if (busy.has(key)) return null;
    let payload = read();
    if (payload && ((itemId && itemId !== payload.inventory_id) || (gemKey && gemKey !== payload.gem_key))) throw new Error('Resolve the pending gem application first.');
    if (!payload) {
      if (!itemId || !gemKey || !PRIMARY_GEM_KEYS.includes(gemKey) || !uuid.test(itemId) || !affordable) throw new Error('Insufficient known materials or gold.');
      payload = { character_id: characterId, inventory_id: itemId, gem_key: gemKey, completion_id: crypto.randomUUID() };
      // Persist before dispatch; unavailable storage fails closed.
      sessionStorage.setItem(key, JSON.stringify({ accountId, payload }));
      window.dispatchEvent(new Event(changed));
    }
    busy.add(key); setApplying(true);
    const clear = () => { sessionStorage.removeItem(key); window.dispatchEvent(new Event(changed)); };
    try {
      const { data, error } = await invoke({ ...payload });
      let body = data;
      if (error) { try { body = await error.context?.clone().json(); } catch { body = null; } }
      const matches = body?.completion_id === payload.completion_id && body?.inventory_id === payload.inventory_id && body?.gem_used === payload.gem_key;
      if (matches && body?.gem_outcome === 'not_committed') { clear(); throw new Error(body.error || 'Gem application refused.'); }
      if (error) throw new Error(body?.error || 'Gem application outcome unknown. Retry the pending gem application.');
      if (!matches || body?.gem_outcome !== 'committed' || body.error || body.inventory_id !== payload.inventory_id
        || !uuid.test(body.inventory_id) || !Number.isInteger(body.gold_remaining) || body.gold_remaining < 0 || !Number.isInteger(body.xp_awarded) || body.xp_awarded < 0 || body.xp_awarded > 25)
        throw new Error('Gem application outcome unknown. Retry the pending gem application.');
      clear(); return scope.current === key ? body : null;
    } finally { busy.delete(key); if (scope.current === key) setApplying(false); }
  }
  return { pending, applying, recoveryError, submit };
}
