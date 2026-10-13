import { useEffect, useRef, useState } from 'react';

type Payload = { character_id: string; material_key: 'salvage'; amount: number; request_id: string };
type Response = { data: any; error: any };
const busy = new Set<string>();
const eventName = 'wov-material-sale-request';
export function useMaterialSaleRequest(accountId: string | null, characterId: string) {
  const key = accountId ? 'wov.material-sale.v1:' + encodeURIComponent(accountId) + ':' + encodeURIComponent(characterId) : null;
  const scope = useRef(key); scope.current = key;
  const read = (): Payload | null => {
    if (!key) return null;
    const raw = sessionStorage.getItem(key);
    if (raw === null) return null;
    const record = JSON.parse(raw);
    const p = record.payload;
    if (record.version !== 1 || record.accountId !== accountId || !p || p.character_id !== characterId || p.material_key !== 'salvage'
      || !Number.isSafeInteger(p.amount) || p.amount < 1 || p.amount > 2147483647
      || typeof p.request_id !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(p.request_id)) throw new Error('Pending sale storage is invalid; do not replace the unresolved request.');
    return p;
  };
  const request = useRef<Payload | null>(null);
  const inFlight = useRef(false);
  const [pending, setPending] = useState<Payload | null>(null);
  const [selling, setSelling] = useState(false);
  const [recoveryError, setRecoveryError] = useState<string | null>(null);
  useEffect(() => {
    const recover = () => { try { const p = read(); request.current = p; setPending(p); setRecoveryError(null); }
      catch { request.current = null; setPending(null); setRecoveryError('Pending sale recovery unavailable. New sales are blocked until storage can be read safely.'); } };
    recover(); window.addEventListener(eventName, recover);
    return () => window.removeEventListener(eventName, recover);
  }, [key]);
  const clear = () => {
    if (key) sessionStorage.removeItem(key);
    window.dispatchEvent(new Event(eventName));
    if (scope.current === key) { request.current = null; setPending(null); }
  };
  const submit = async (argumentsCharacterId: string, amount: number, stock: number, invoke: (payload: Payload) => Promise<Response>) => {
    if (!accountId || !key || characterId !== argumentsCharacterId) throw new Error('Authenticated account and matching character required.');
    if (inFlight.current || busy.has(key)) return null;
    request.current = read();
    if (request.current && request.current.character_id !== characterId) throw new Error('Retry the pending sale on its original character.');
    if (!request.current) {
      if (!Number.isSafeInteger(amount) || amount < 1 || amount > stock) throw new Error('Invalid sale amount or insufficient known stock.');
      request.current = { character_id: characterId, material_key: 'salvage', amount, request_id: crypto.randomUUID() };
      setPending(request.current);
    }
    const payload = request.current;
    sessionStorage.setItem(key, JSON.stringify({ version: 1, accountId, payload }));
    window.dispatchEvent(new Event(eventName));
    busy.add(key);
    inFlight.current = true; setSelling(true);
    try {
      const { data, error } = await invoke({ ...payload });
      if (error) {
        // Only the explicit application contract resolves uncertainty, never HTTP status alone.
        let body: any = null;
        try { body = await error.context?.clone().json(); } catch { /* ambiguous response */ }
        if (body?.sale_outcome === 'not_committed' && body?.request_id === payload.request_id) clear();
        throw error;
      }
      if (data?.sale_outcome === 'not_committed' && data?.request_id === payload.request_id) { clear(); throw new Error(data.error || 'Sale refused'); }
      if (!data || data.request_id !== payload.request_id || data.error || !Number.isInteger(data.gold_remaining) || data.amount_sold !== payload.amount || data.material_key !== payload.material_key) throw new Error('Uncertain sale response; retry the pending sale.');
      clear(); return data;
    } finally { inFlight.current = false; busy.delete(key); setSelling(false); }
  };
  return { pending, selling, recoveryError, submit };
}
