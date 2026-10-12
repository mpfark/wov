import { useRef, useState } from 'react';

type Payload = { character_id: string; material_key: 'salvage'; amount: number; request_id: string };
type Response = { data: any; error: any };
export function useMaterialSaleRequest() {
  const request = useRef<Payload | null>(null);
  const inFlight = useRef(false);
  const [pending, setPending] = useState<Payload | null>(null);
  const [selling, setSelling] = useState(false);
  const clear = () => { request.current = null; setPending(null); };
  const submit = async (characterId: string, amount: number, stock: number, invoke: (payload: Payload) => Promise<Response>) => {
    if (inFlight.current) return null;
    if (request.current && request.current.character_id !== characterId) throw new Error('Retry the pending sale on its original character.');
    if (!request.current) {
      if (!Number.isSafeInteger(amount) || amount < 1 || amount > stock) throw new Error('Invalid sale amount or insufficient known stock.');
      request.current = { character_id: characterId, material_key: 'salvage', amount, request_id: crypto.randomUUID() };
      setPending(request.current);
    }
    const payload = request.current;
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
      if (!data || data.error || !Number.isInteger(data.gold_remaining) || data.amount_sold !== payload.amount || data.material_key !== payload.material_key) throw new Error('Uncertain sale response; retry the pending sale.');
      clear(); return data;
    } finally { inFlight.current = false; setSelling(false); }
  };
  return { pending, selling, submit };
}
