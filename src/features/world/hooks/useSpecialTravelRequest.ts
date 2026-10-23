import { useEffect, useRef, useState } from 'react';
type Kind = 'teleport' | 'waymark';
export type SpecialTravelPayload = { _character_id: string; _kind: Kind; _destination_node_id: string; _request_id: string };
type Stored = { accountId: string; payload: SpecialTravelPayload };
const active = new Set<string>();
export function useSpecialTravelRequest(accountId: string | undefined, characterId: string) {
  const key = accountId ? `wov.special-travel.v1:${accountId}:${characterId}` : null;
  const scope = useRef(key); scope.current = key;
  const [pending, setPending] = useState<SpecialTravelPayload | null>(null);
  const [busy, setBusy] = useState(false);
  const [recoveryError, setRecoveryError] = useState<string | null>(null);
  const read = (): SpecialTravelPayload | null => {
    if (!key) throw Error('Authenticated character ownership is unavailable.');
    const raw = sessionStorage.getItem(key); if (raw === null) return null;
    const r: Stored = JSON.parse(raw), p = r.payload;
    if (r.accountId !== accountId || p?._character_id !== characterId || !['teleport','waymark'].includes(p?._kind)
      || typeof p._destination_node_id !== 'string' || !p._destination_node_id || typeof p._request_id !== 'string'
      || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(p._request_id)) throw Error('Pending teleport recovery is invalid; do not replace it.');
    return p;
  };
  useEffect(() => {
    setBusy(key ? active.has(key) : false);
    try { setPending(read()); setRecoveryError(null); }
    catch (e) { setPending(null); setRecoveryError(e instanceof Error ? e.message : 'Teleport recovery unavailable.'); }
  }, [key]);
  const submit = async (kind: Kind, destination: string, invoke: (p: SpecialTravelPayload) => Promise<{ data: any; error: any }>) => {
    if (!key || !accountId) throw Error('Authenticated character ownership is unavailable.');
    if (active.has(key)) return null;
    const previous = read();
    if (previous && (previous._kind !== kind || previous._destination_node_id !== destination)) throw Error('Retry the unresolved teleport before choosing another destination.');
    const payload = previous ?? { _character_id: characterId, _kind: kind, _destination_node_id: destination, _request_id: crypto.randomUUID() };
    sessionStorage.setItem(key, JSON.stringify({ accountId, payload })); // must succeed before dispatch
    setPending(payload); setBusy(true); active.add(key);
    try {
      const { data, error } = await invoke({ ...payload });
      const matches = !error && data?.request_id === payload._request_id && data?.account_id === accountId && data?.character_id === characterId
        && data?.travel_kind === payload._kind && data?.destination_node_id === payload._destination_node_id;
      if (matches && (data.outcome === 'not_committed' || (data.outcome === 'committed' && data.ok === true))) {
        sessionStorage.removeItem(key); if (scope.current === key) setPending(null);
        return { result: data, payload };
      }
      throw Error('Teleport outcome uncertain. Retry the original pending request.');
    } finally { active.delete(key); if (scope.current === key) setBusy(false); }
  };
  return { pending, busy, recoveryError, submit };
}
