import { bearerToken, constantTimeSecretEqual, redact } from '../_shared/combat2-internal-edge-auth.ts';

const JSON_HEADERS = { 'Content-Type': 'application/json' };

/** The one Vault entry this function may ever touch. Never caller-supplied. */
export const PROVISION_RPC = 'combat2_provision_worker_secret';

interface RpcResult { data: unknown; error: { code?: string } | null }

export interface ProvisionRpcClient {
  rpc(name: string, args: Record<string, unknown>): PromiseLike<RpcResult>;
}

export interface Combat2ProvisionHandlerDependencies {
  env(name: 'SUPABASE_URL' | 'SUPABASE_SERVICE_ROLE_KEY' | 'COMBAT2_WORKER_SECRET'): string | undefined;
  createClient(url: string, serviceRoleKey: string): ProvisionRpcClient;
  log?: (message: string, detail: Record<string, unknown>) => void;
}

function json(data: unknown, status: number): Response {
  return new Response(JSON.stringify(data), { status, headers: JSON_HEADERS });
}

function failure(classification: string, reason: string, status: number): Response {
  return json({ ok: false, classification, reason }, status);
}

const OK_CLASSIFICATIONS = new Set(['created', 'updated']);
const REFUSAL_CLASSIFICATIONS = new Set(['ambiguous_secret_state', 'invalid_secret', 'vault_write_failed']);

export function createCombat2ProvisionHandler(deps: Combat2ProvisionHandlerDependencies) {
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

    let client: ProvisionRpcClient;
    try { client = deps.createClient(url, serviceRoleKey); }
    catch { return failure('environment_failure', 'privileged transport is unavailable', 500); }

    let payload: unknown;
    try {
      const { data, error } = await client.rpc(PROVISION_RPC, { _secret: workerSecret });
      if (error) return failure('provision_failed', 'vault provisioning was refused', 502);
      payload = data;
    } catch {
      return failure('provision_failed', 'vault provisioning transport failed', 502);
    }

    const record = payload !== null && typeof payload === 'object' && !Array.isArray(payload)
      ? payload as Record<string, unknown>
      : null;
    const classification = typeof record?.classification === 'string' ? record.classification : null;

    if (!classification || (!OK_CLASSIFICATIONS.has(classification) && !REFUSAL_CLASSIFICATIONS.has(classification))) {
      return failure('provision_failed', 'unknown provisioning outcome', 502);
    }

    const ok = OK_CLASSIFICATIONS.has(classification);
    deps.log?.('[combat2-provision-worker-secret] completed', { classification });
    return json(redact({ ok, classification }, [serviceRoleKey, workerSecret]), ok ? 200 : 409);
  };
}
