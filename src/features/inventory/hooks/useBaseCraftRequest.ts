import { useEffect, useRef, useState } from 'react';

type Payload = { character_id: string; item_id: string; completion_id: string };
const busy = new Set<string>();
const changed = 'wov-base-craft-request';
const uuid = /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
export function useBaseCraftRequest(accountId: string | null, characterId: string) {
  const key = accountId ? `wov.base-craft.v1:${accountId}:${characterId}` : null;
  const [pending, setPending] = useState<Payload | null>(null);
  const [crafting, setCrafting] = useState(false);
  const [recoveryError, setRecoveryError] = useState<string | null>(null);
  const scope = useRef(key); scope.current = key;
  function read(): Payload | null {
    if (!key) return null;
    const raw = sessionStorage.getItem(key);
    if (!raw) return null;
    const r = JSON.parse(raw), p = r.payload;
    if (r.accountId !== accountId || p?.character_id !== characterId || typeof p?.item_id !== 'string' || typeof p?.completion_id !== 'string' || !uuid.test(p.item_id) || !uuid.test(p.completion_id))
      throw new Error('Pending craft storage is invalid. Do not replace the unresolved request.');
    return p;
  }
  useEffect(() => {
    const recover = () => { try { setPending(read()); setRecoveryError(null); }
      catch { setRecoveryError('Pending craft recovery unavailable. New crafts are blocked.'); } };
    setCrafting(key ? busy.has(key) : false);
    recover(); window.addEventListener(changed, recover);
    return () => window.removeEventListener(changed, recover);
  }, [key]);
  async function submit(itemId: string | null, affordable: boolean, invoke: (payload: Payload) => Promise<{ data: any; error: any }>) {
    if (!key) throw new Error('Sign in to craft.');
    if (busy.has(key)) return null;
    let payload = read();
    if (payload && itemId && itemId !== payload.item_id) throw new Error('Resolve the pending craft first.');
    if (!payload) {
      if (!itemId || !uuid.test(itemId) || !affordable) throw new Error('Insufficient known materials or gold.');
      payload = { character_id: characterId, item_id: itemId, completion_id: crypto.randomUUID() };
      // Persist before dispatch; unavailable storage fails closed.
      sessionStorage.setItem(key, JSON.stringify({ accountId, payload }));
      window.dispatchEvent(new Event(changed));
    }
    busy.add(key); setCrafting(true);
    const clear = () => { sessionStorage.removeItem(key); window.dispatchEvent(new Event(changed)); };
    try {
      const { data, error } = await invoke({ ...payload });
      let body = data;
      if (error) { try { body = await error.context?.clone().json(); } catch { body = null; } }
      const matches = body?.completion_id === payload.completion_id;
      if (matches && body?.craft_outcome === 'not_committed') { clear(); throw new Error(body.error || 'Craft refused.'); }
      if (error) throw new Error(body?.error || 'Craft outcome unknown. Retry the pending craft.');
      if (!matches || body?.craft_outcome !== 'committed' || body.item_id !== payload.item_id
        || !uuid.test(body.inventory_id) || !Number.isInteger(body.gold_remaining))
        throw new Error('Craft outcome unknown. Retry the pending craft.');
      clear(); return scope.current === key ? body : null;
    } finally { busy.delete(key); if (scope.current === key) setCrafting(false); }
  }
  return { pending, crafting, recoveryError, submit };
}
