export const ADMIN_MATERIAL_KEYS = ['salvage','garnet','topaz','emerald','sapphire','pearl','amethyst'] as const;
export function materialGrantCap(role: string, key: string) {
  if (role === 'steward') return key === 'salvage' ? 1000 : 25;
  if (role === 'overlord') return key === 'salvage' ? 100000 : 1000;
  return 0;
}
export async function handleAdminMaterialGrant(req: Request, actor: string, role: string,
  rpc: (args: Record<string, unknown>) => Promise<{ data: any; error: any }>) {
  const headers = { 'Content-Type':'application/json', 'Access-Control-Allow-Origin':'*',
    'Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type' };
  const reply = (body: object, status = 200) => new Response(JSON.stringify(body), { status, headers });
  if (!actor || !['steward','overlord'].includes(role)) return reply({ error:'Administrative authorization required.' },403);
  if (req.method !== 'POST') return reply({ error:'POST required.' },405);
  try {
    const body = await req.json();
    const uuid = /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
    if (!body || Object.keys(body).some(k => !['character_id','request_id','material_key','amount','reason'].includes(k))
      || ![body.character_id,body.request_id].every(x => typeof x === 'string' && uuid.test(x))
      || !ADMIN_MATERIAL_KEYS.includes(body.material_key) || !Number.isInteger(body.amount) || body.amount < 1 || body.amount > 100000
      || typeof body.reason !== 'string' || !body.reason.trim() || body.reason.trim().length > 1000)
      return reply({ error:'Valid target, completion UUID, approved material, integer quantity and reason required.',grant_outcome:'uncertain' },400);
    // SQL owns per-role caps and replay before mutable policy. Do not reject an exact replay using a new client cap.
    const { data,error } = await rpc({ _actor:actor,_character:body.character_id,_request:body.request_id,
      _material:body.material_key,_amount:body.amount,_reason:body.reason.trim() });
    const identity = { request_id:body.request_id,character_id:body.character_id,material_key:body.material_key,amount:body.amount };
    if (error) {
      const messages: Record<string,string> = {
        material_grant_cap:'Quantity exceeds the approved limit for your role.',
        material_grant_inactive_target:'The target character is deleted or inactive.',
        material_grant_catalogue_missing:'The approved material is missing from the catalogue.',
        material_grant_invalid_balance:'The existing material balance is invalid; a separate repair is required.',
        material_grant_overflow:'This grant would exceed the material balance limit.',
        material_grant_balance_changed:'The material balance changed unexpectedly; nothing was granted.',
      };
      const definite = error.code === 'P0001' && Object.prototype.hasOwnProperty.call(messages,error.message);
      const other: Record<string,string> = {material_grant_self_denied:'Stewards cannot grant materials to their own characters.',
        material_grant_unauthorized:'Administrative authority is no longer valid.',material_grant_invalid_target:'Target character is unavailable.',
        material_grant_request_conflict:'This completion UUID belongs to different grant details. Retain the request for support.'};
      return reply({...identity,grant_outcome:definite?'not_committed':'uncertain',
        error:messages[error.message] || other[error.message] || 'Grant outcome unknown. Retry the original pending grant.'},409);
    }
    if (!data || data.error || data.grant_outcome !== 'committed' || Object.entries(identity).some(([k,v]) => data[k] !== v) || typeof data.self_grant !== 'boolean')
      return reply({...identity,grant_outcome:'uncertain',error:'Grant result unknown. Retry the original pending grant.'},502);
    return reply(data);
  } catch { return reply({grant_outcome:'uncertain',error:'Grant result unknown. Retain and retry the pending grant.'},502); }
}
