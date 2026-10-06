import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.116.0';
import { createProgressionCommandHandler } from '../_shared/progression-command.ts';
Deno.serve(createProgressionCommandHandler({
  async verifyActor(authorization) {
    const client = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: authorization } } });
    const { data, error } = await client.auth.getClaims(authorization.slice(7));
    return error ? null : (data?.claims?.sub as string ?? null);
  },
  async command(request, actor) {
    // Service context never forwards the owner's JWT; actor is verified subject, never body input.
    const service = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    const { data, error } = await service.rpc('progression_command', {
      _character: request.characterId, _actor: actor, _request: request.requestId, _expected_version: request.expectedVersion,
      _operation: 'allocations' in request ? 'allocate' : request.operation,
      _allocations: 'allocations' in request ? request.allocations : null, _target_class: 'targetClass' in request ? request.targetClass : null,
    });
    if (error) throw error;
    return data;
  },
}));
