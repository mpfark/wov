const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' };
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
type Rpc = (name: string, args: Record<string, string>) => Promise<{ data: any; error: any }>;
export async function handleGameplayTestTeleport(req: Request, authenticate: () => Promise<string | null>, rpc: Rpc) {
  const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
  if (req.method !== 'POST') return reply({ error: 'Method not allowed' }, 405);
  const actor = await authenticate();
  if (!actor) return reply({ error: 'Authentication required' }, 401);
  let p: any;
  try { p = await req.json(); } catch { return reply({ error: 'Invalid JSON' }, 400); }
  const access = new URL(req.url).searchParams.get('action') === 'test-teleport-access';
  const keys = access ? ['character_id'] : ['character_id', 'destination_node_id', 'request_id'];
  if (!p || typeof p !== 'object' || Object.keys(p).some(k => !keys.includes(k)) || keys.some(k => typeof p[k] !== 'string' || !uuid.test(p[k]))) return reply({ error: 'Valid identifiers required' }, 400);
  try {
    const { data, error } = await rpc(access ? 'gameplay_test_teleport_access_internal' : 'gameplay_test_teleport_internal',
      { _actor: actor, _character: p.character_id, ...(!access ? { _destination: p.destination_node_id, _request: p.request_id } : {}) });
    if (error) {
      // These are explicit SQL exceptions in the atomic RPC. Transport/status alone never clears a retry.
      if (!access && ['42501', '22023', 'P0001', '40001'].includes(error.code)) return reply({
        outcome: 'not_committed', request_id: p.request_id, character_id: p.character_id,
        destination_node_id: p.destination_node_id, error: error.message,
      });
      return reply({ error: 'Test travel outcome unavailable; retain the pending request and retry.' }, 503);
    }
    return reply(access ? { destinations: data } : data);
  } catch { return reply({ error: 'Test travel outcome uncertain; retry the same request.' }, 503); }
}
