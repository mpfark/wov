export type ProgressionStat = 'str' | 'dex' | 'con' | 'int' | 'wis' | 'cha';
export type ProgressionAction = { allocations: Record<string, number> } | { operation: 'join' | 'switch'; targetClass: string }
  | { operation: 'respec' } | { operation: 'renown'; stat: ProgressionStat };
export function progressionAction(request: ProgressionAction): ProgressionAction {
  if ('allocations' in request) return { allocations: Object.fromEntries(['str','dex','con','int','wis','cha'].map(k => [k, request.allocations[k] ?? 0])) };
  if ('targetClass' in request) return { operation: request.operation, targetClass: request.targetClass };
  if (request.operation === 'renown') return { operation: 'renown', stat: request.stat };
  return { operation: 'respec' };
}
export type ProgressionRequest = ProgressionAction & { characterId: string; requestId: string; expectedVersion: number };
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const stats = ['str', 'dex', 'con', 'int', 'wis', 'cha'];
export function parseProgressionRequest(value: unknown): ProgressionRequest | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const v = value as Record<string, unknown>;
  if (typeof v.characterId !== 'string' || !uuid.test(v.characterId) || typeof v.requestId !== 'string' || !uuid.test(v.requestId)
    || !Number.isSafeInteger(v.expectedVersion) || (v.expectedVersion as number) < 0) return null;
  const common = ['characterId', 'requestId', 'expectedVersion'];
  if (v.operation === 'respec' || v.operation === 'renown') {
    const allowed = [...common, 'operation', ...(v.operation === 'renown' ? ['stat'] : [])];
    if (Object.keys(v).some(k => !allowed.includes(k))) return null;
    if (v.operation === 'renown' && !stats.includes(v.stat as string)) return null;
    return v as ProgressionRequest;
  }
  if ('allocations' in v) {
    if (Object.keys(v).some(k => ![...common, 'allocations'].includes(k)) || !v.allocations || typeof v.allocations !== 'object' || Array.isArray(v.allocations)) return null;
    const a = v.allocations as Record<string, unknown>;
    if (Object.entries(a).some(([k, n]) => !stats.includes(k) || !Number.isInteger(n) || (n as number) < 0 || (n as number) > 2147483647)) return null;
    const normalized = Object.fromEntries(stats.map(k => [k, (a[k] ?? 0) as number]));
    if (Object.values(normalized).reduce((s, n) => s + n, 0) <= 0) return null;
    return { characterId: v.characterId, requestId: v.requestId, expectedVersion: v.expectedVersion as number, allocations: normalized };
  }
  if (Object.keys(v).some(k => ![...common, 'operation', 'targetClass'].includes(k)) || !['join', 'switch'].includes(v.operation as string)
    || typeof v.targetClass !== 'string' || !/^[a-z][a-z0-9_]{1,31}$/.test(v.targetClass)) return null;
  return v as ProgressionRequest;
}
export function createProgressionCommandHandler(deps: {
  verifyActor: (authorization: string) => Promise<string | null>;
  command: (request: ProgressionRequest, actor: string) => Promise<unknown>;
}) {
  const headers = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Content-Type': 'application/json' };
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers });
  return async (req: Request): Promise<Response> => {
    if (req.method === 'OPTIONS') return new Response(null, { headers });
    if (req.method !== 'POST') return json({ kind: 'refused', reason: 'method_not_allowed' }, 405);
    try {
      const auth = req.headers.get('Authorization');
      if (!auth?.startsWith('Bearer ')) return json({ kind: 'refused', reason: 'unauthorized' }, 401);
      const actor = await deps.verifyActor(auth);
      if (!actor || !uuid.test(actor)) return json({ kind: 'refused', reason: 'unauthorized' }, 401);
      const body = parseProgressionRequest(await req.json().catch(() => null));
      if (!body) return json({ kind: 'refused', reason: 'invalid_request' }, 400);
      return json(await deps.command(body, actor));
    } catch { return json({ kind: 'transport_error' }, 503); }
  };
}
