import type { AuthoredAbilityRecord } from '../_shared/combat2/catalog.ts';
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
  log?: (message: string, detail: Record<string, unknown>) => void;
}

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

    const result = await dispatchNodeTicksOnce({
      async discoverDueNodes(limit) {
        const { data, error } = await client.rpc('combat2_due_nodes', { _limit: limit });
        if (error) throw new Error(`combat2_due_nodes failed: ${error.code ?? 'database_error'}`);
        return data;
      },
      processNode: (nodeId) => deps.processNodeTickOnce(nodeId, {
        abilityRecords: deps.abilityRecords,
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
      }),
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
