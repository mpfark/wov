// Inject authentication and the single authoritative transaction for focused tests.
export async function handleBaseCraft(req: Request, authenticate: (header: string) => Promise<string | null>,
  rpc: (args: Record<string, string>) => Promise<{ data: any; error: any }>): Promise<Response> {
  const headers = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version', 'Content-Type': 'application/json' };
  const reply = (body: object, status = 200) => new Response(JSON.stringify(body), { status, headers });
  if (req.method === 'OPTIONS') return reply({});
  if (req.method !== 'POST') return reply({ error: 'POST required' }, 405);
  try {
    const actor = await authenticate(req.headers.get('Authorization') || '');
    if (!actor) return reply({ error: 'Sign in to craft.' }, 401);
    const { character_id, item_id, completion_id } = await req.json();
    const uuid = /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
    if (![character_id, item_id, completion_id].every(v => typeof v === 'string' && uuid.test(v)))
      return reply({ error: 'A character, item and completion UUID are required.' }, 400);
    const { data, error } = await rpc({ _actor: actor, _character_id: character_id, _item_id: item_id, _completion_id: completion_id });
    if (error) {
      // These exceptions occur AFTER the receipt lookup and roll back this RPC.
      const definitive = error.code === 'P0001' && ['craft_inactive', 'craft_item_ineligible', 'craft_tier_locked',
        'craft_wrong_station', 'craft_insufficient_gold', 'craft_insufficient_materials', 'craft_debit_failed',
        'craft_progression_refused', 'craft_receipt_failed'].includes(error.message);
      const messages: Record<string, string> = {
        craft_inactive: 'Only a living, active character can craft.',
        craft_item_ineligible: 'Choose a common plain base item.',
        craft_tier_locked: 'Your level does not unlock this crafting tier.',
        craft_wrong_station: 'Visit a blacksmith for gear or a jewelcrafter for jewelry.',
        craft_insufficient_gold: 'Not enough gold to craft this item.',
        craft_insufficient_materials: 'Not enough salvage to craft this item.',
        craft_progression_refused: 'Canonical progression refused the craft. Nothing was consumed.',
        request_id_conflict: 'This completion ID conflicts with another request. Keep it for support review.',
      };
      return reply({ error: messages[error.message] || (definitive ? 'Craft refused. Nothing was consumed.' : 'Craft outcome unknown. Retry the pending craft.'),
        completion_id, craft_outcome: definitive ? 'not_committed' : 'uncertain' }, 400);
    }
    if (!data || data.completion_id !== completion_id || data.craft_outcome !== 'committed')
      return reply({ error: 'Craft result unknown. Retry the pending craft.', completion_id, craft_outcome: 'uncertain' }, 502);
    return reply(data);
  } catch {
    return reply({ error: 'Craft result unknown. Retry the pending craft.' }, 502);
  }
}
