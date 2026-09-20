import type { AuthoredAbilityRecord } from '../_shared/combat2/catalog.ts';
import type { AppliedStatusRow } from '../_shared/config/status-contract.ts';
import { dispatchNodeTicksOnce, DISPATCH_LIMIT, type DispatchRunResult } from '../_shared/combat2/dispatch-node-ticks-once.ts';
import type { CommitTickArgs, NodeTickRunResult, ProcessNodeTickDependencies } from '../_shared/combat2/process-node-tick-once.ts';
import { bearerToken, constantTimeSecretEqual, redact } from '../_shared/combat2-internal-edge-auth.ts';

const JSON_HEADERS = { 'Content-Type': 'application/json' };

interface RpcResult { data: unknown; error: { code?: string } | null }
export interface DispatchRpcClient {
  rpc(name: string, args: Record<string, unknown>): PromiseLike<RpcResult>;
}

export interface Combat2DispatchHandlerDependencies {
  env(name: 'SUPABASE_URL' | 'SUPABASE_SERVICE_ROLE_KEY' | 'COMBAT2_WORKER_SECRET'): string | undefined;
  createClient(url: string, serviceRoleKey: string): DispatchRpcClient;
  processNodeTickOnce(nodeId: string, dependencies: ProcessNodeTickDependencies): Promise<NodeTickRunResult>;
  abilityRecords: readonly AuthoredAbilityRecord[];
  statusRecords?: readonly AppliedStatusRow[];
  log?: (message: string, detail: Record<string, unknown>) => void;
  defer?: (work: PromiseLike<unknown>) => void;
}

interface DiagnosticSession { session_id: string; node_id: string; encounter_id: string }
interface DiagnosticEvent { event_type: string; node_id: string; encounter_id?: string; tick?: number; outcome?: string; elapsed_ms: number }

function json(data: unknown, status: number): Response {
  return new Response(JSON.stringify(data), { status, headers: JSON_HEADERS });
}

function failure(classification: string, reason: string, status: number): Response {
  return json({ ok: false, classification, reason }, status);
}

function statusFor(result: DispatchRunResult): number {
  if (result.ok) return 200;
  if (result.classification === 'maintenance' || result.classification === 'world_asleep') return 503;
  return 502;
}

export function createCombat2DispatchHandler(deps: Combat2DispatchHandlerDependencies) {
  return async (request: Request): Promise<Response> => {
    if (request.method !== 'POST') return failure('method_not_allowed', 'POST required', 405);

    const url = deps.env('SUPABASE_URL');
    const serviceRoleKey = deps.env('SUPABASE_SERVICE_ROLE_KEY');
    const workerSecret = deps.env('COMBAT2_WORKER_SECRET');
    if (!url || !serviceRoleKey || !workerSecret) {
      return failure('environment_failure', 'required server environment is unavailable', 500);
    }
    if (await constantTimeSecretEqual(serviceRoleKey, workerSecret)) {
      return failure('environment_failure', 'worker authorization is misconfigured', 500);
    }
    const token = bearerToken(request.headers.get('Authorization'));
    if (!token || !await constantTimeSecretEqual(token, workerSecret)) {
      return failure('unauthorized', 'worker authorization required', 401);
    }

    const text = await request.text();
    if (text.trim()) {
      let body: unknown;
      try { body = JSON.parse(text); } catch { return failure('invalid_request', 'body is not valid JSON', 400); }
      if (body === null || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).length !== 0) {
        return failure('invalid_request', 'body must be empty or an empty JSON object', 400);
      }
    }

    let client: DispatchRpcClient;
    try { client = deps.createClient(url, serviceRoleKey); }
    catch { return failure('environment_failure', 'privileged transport is unavailable', 500); }

    const candidatesByNode = new Map<string,string>();
    const result = await dispatchNodeTicksOnce({
      async discoverDueNodes(limit) {
        const { data, error } = await client.rpc('combat2_due_nodes', { _limit: limit });
        if (error) throw new Error(`combat2_due_nodes failed: ${error.code ?? 'database_error'}`);
        const envelope=data as {candidates?:Array<{node_id?:unknown;encounter_id?:unknown}>};
        for(const candidate of envelope?.candidates??[]) if(typeof candidate.node_id==='string'&&typeof candidate.encounter_id==='string') candidatesByNode.set(candidate.node_id,candidate.encounter_id);
        return data;
      },
      processNode: async (nodeId) => {
        const events: DiagnosticEvent[]=[];
        const invocationId=crypto.randomUUID();
        events.push({event_type:'dispatcher_requested',node_id:nodeId,encounter_id:candidatesByNode.get(nodeId),outcome:invocationId,elapsed_ms:0});
        const workerResult=await deps.processNodeTickOnce(nodeId, {
        abilityRecords: deps.abilityRecords,
        statusRecords: deps.statusRecords,
        diagnostic: event=>events.push({event_type:event.event,node_id:event.nodeId,encounter_id:event.encounterId,
          tick:event.tick,outcome:event.outcome,elapsed_ms:event.elapsedMs}),
        transport: {
          async claimNode(id) {
            const { data, error } = await client.rpc('node_tick_claim', { _node_id: id });
            if (error) throw Object.assign(new Error('database transport failed'), { code: error.code });
            return data;
          },
          async commitTick(args: CommitTickArgs) {
            const { data, error } = await client.rpc('node_tick_commit', args as unknown as Record<string, unknown>);
            if (error) throw Object.assign(new Error('database transport failed'), { code: error.code });
            return data;
          },
        },
        });
        if(!(workerResult.ok&&(workerResult.kind==='committed'||workerResult.kind==='already_committed'))) {
          events.push({event_type:workerResult.kind.includes('commit')?'commit_refused':'claim_refused',node_id:nodeId,
            encounter_id:'encounterId' in workerResult?workerResult.encounterId:candidatesByNode.get(nodeId),
            tick:'tick' in workerResult?workerResult.tick:undefined,outcome:workerResult.kind,elapsed_ms:0});
        }
        const persist=(async()=>{
          const encounterId=candidatesByNode.get(nodeId);
          if(!encounterId)return;
          const lookup=await client.rpc('combat2_diagnostic_sessions_for_candidates',{_candidates:[{node_id:nodeId,encounter_id:encounterId}]});
          if(lookup.error||!Array.isArray(lookup.data))return;
          const sessions=(lookup.data as DiagnosticSession[]).filter(s=>s.node_id===nodeId&&s.encounter_id===encounterId);
          await Promise.all(sessions.map(session=>Promise.resolve(client.rpc('combat2_diagnostic_record_server_events',
            {_session_id:session.session_id,_events:events})).catch(()=>undefined)));
        })();
        if(deps.defer)deps.defer(persist);else void persist.catch(()=>undefined);
        return workerResult;
      },
    });

    deps.log?.('[combat2-dispatch-once] completed', {
      classification: result.classification,
      candidateCount: result.candidateCount,
      processedCount: result.processedCount,
    });
    return json(redact(result, [serviceRoleKey, workerSecret]), statusFor(result));
  };
}

export { DISPATCH_LIMIT };
