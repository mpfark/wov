// Inject authentication and the single authoritative transaction for focused tests.
export async function handleGemApplication(req: Request, authenticate: (header: string) => Promise<string | null>,
  rpc: (args: Record<string, string>) => Promise<{ data: any; error: any }>): Promise<Response> {
  const headers = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version', 'Content-Type': 'application/json' };
  const reply = (body: object, status = 200) => new Response(JSON.stringify(body), { status, headers });
  if (req.method === 'OPTIONS') return reply({});
  if (req.method !== 'POST') return reply({ error: 'POST required' }, 405);
  try {
    const actor = await authenticate(req.headers.get('Authorization') || '');
    if (!actor) return reply({ error: 'Sign in to apply gems.' }, 401);
    const { character_id, inventory_id, gem_key, completion_id } = await req.json();
    const uuid = /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
    if (![character_id, inventory_id, completion_id].every(v => typeof v === 'string' && uuid.test(v)))
      return reply({ error: 'A character, inventory item and completion UUID are required.' }, 400);
    if (!['garnet','topaz','emerald','sapphire','pearl','amethyst'].includes(gem_key)) return reply({ error: 'Choose a primary gem.' }, 400);
    const { data, error } = await rpc({ _actor: actor, _character_id: character_id, _inventory_id: inventory_id, _gem_key: gem_key, _completion_id: completion_id });
    if (error) {
      // These exceptions occur AFTER the receipt lookup and roll back this RPC.
      const messages: Record<string, string> = {
        gem_inactive: 'Only a living, active character can apply gems.',
        gem_item_not_owned: 'The item no longer belongs to this character.',
        gem_item_ineligible: 'This item cannot receive gems.',
        gem_wrong_station: 'Visit a blacksmith for gear or a jewelcrafter for jewelry.',
        gem_missing_gem: 'You do not have the required gem.',
        gem_insufficient_gold: 'Not enough gold to apply this gem.',
        gem_insufficient_materials: 'Not enough salvage to apply this gem.',
        gem_stat_cap: 'This attribute has reached the item cap.',
        gem_stat_budget: 'This item has no remaining stat budget.',
        gem_invalid_item_stats: 'The item has invalid stat data; nothing was consumed.',
        gem_cost_bounds: 'The item level cannot produce valid upgrade costs.',
        gem_invalid_key: 'Choose a primary gem.',
        gem_coverage_changed: 'Your location or encounter changed. Nothing was consumed; try again.',
        gem_movement_pending: 'Finish moving before applying gems.',
        gem_combat_active: 'You cannot apply gems during active combat or a live combat claim.',
        gem_debit_failed: 'The gold debit failed; nothing was consumed.',
        gem_update_failed: 'The item update failed; nothing was consumed.',
        gem_receipt_failed: 'The completion receipt failed; nothing was consumed.',
        gem_progression_refused: 'Canonical progression refused the upgrade; nothing was consumed.',
      };
      const definitive = error.code === 'P0001' && Object.prototype.hasOwnProperty.call(messages, error.message);
      return reply({ error: definitive ? messages[error.message] : 'Gem outcome unknown. Retry the pending application or retain a conflicting completion for support.',
        completion_id, inventory_id, gem_used: gem_key, gem_outcome: definitive ? 'not_committed' : 'uncertain' }, 400);
    }
    if (!data || data.error || !Number.isInteger(data.gold_remaining) || data.gold_remaining < 0 || !Number.isInteger(data.xp_awarded) || data.xp_awarded < 0 || data.xp_awarded > 25 || data.completion_id !== completion_id || data.inventory_id !== inventory_id || data.gem_used !== gem_key || data.gem_outcome !== 'committed')
      return reply({ error: 'Gem result unknown. Retry the pending application.', completion_id, inventory_id, gem_used: gem_key, gem_outcome: 'uncertain' }, 502);
    return reply(data);
  } catch {
    return reply({ error: 'Gem result unknown. Retry the pending application.' }, 502);
  }
}
