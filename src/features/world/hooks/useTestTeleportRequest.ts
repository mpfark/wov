import { useRef, useState } from 'react';
type Payload = { character_id: string; destination_node_id: string; request_id: string };
const active = new Set<string>();
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function useTestTeleportRequest(accountId: string, characterId: string) {
  const key = `wov.test-teleport.v1:${accountId}:${characterId}`;
  const read = (): Payload | null => {
    const raw = sessionStorage.getItem(key);
    if (raw === null) return null;
    const r = JSON.parse(raw), p = r.payload;
    if (r.accountId !== accountId || p?.character_id !== characterId || !uuid.test(p?.destination_node_id) || !uuid.test(p?.request_id)) throw Error('Unresolved test travel storage is invalid. Do not replace it.');
    return p;
  };
  const [initial] = useState(() => { try { return { payload: read(), error: null }; } catch { return { payload: null, error: 'Test travel recovery unavailable; new requests blocked.' }; } });
  const [pending, setPending] = useState<Payload | null>(initial.payload);
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  const submit = async (destination: string | null, invoke: (p: Payload) => Promise<{ data: any; error: any }>) => {
    if (inFlight.current || active.has(key)) return null;
    if (initial.error) throw Error(initial.error);
    const prior = read();
    if (!prior && (!destination || !uuid.test(destination))) throw Error('Select an approved destination.');
    const payload: Payload = prior ?? { character_id: characterId, destination_node_id: destination!, request_id: crypto.randomUUID() };
    // Persistence MUST succeed before dispatch. Always replay immutable recovered payload.
    sessionStorage.setItem(key, JSON.stringify({ accountId, payload }));
    setPending(payload); active.add(key); inFlight.current = true; setBusy(true);
    try {
      const response = await invoke({ ...payload });
      let body = response.data;
      if (response.error) {
        try { body = await response.error.context?.clone().json(); } catch { body = null; }
      }
      const matches = body?.request_id === payload.request_id && body?.character_id === characterId && body?.destination_node_id === payload.destination_node_id;
      if (matches && (body.outcome === 'not_committed' || (body.outcome === 'committed' && body.ok === true))) {
        sessionStorage.removeItem(key); setPending(null);
        if (body.outcome === 'not_committed') throw Error(body.error || 'Test travel refused.');
        return body;
      }
      throw Error('Test travel outcome uncertain. Retry the pending request.');
    } finally { active.delete(key); inFlight.current = false; setBusy(false); }
  };
  return { pending, busy, recoveryError: initial.error, submit };
}
