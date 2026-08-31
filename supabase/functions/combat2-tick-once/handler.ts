import type { AuthoredAbilityRecord } from "../_shared/combat2/catalog.ts";
import type {
  CommitTickArgs,
  NodeTickRunResult,
  ProcessNodeTickDependencies,
} from "../_shared/combat2/process-node-tick-once.ts";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const JSON_HEADERS = { "Content-Type": "application/json" };

interface RpcResult {
  data: unknown;
  error: { code?: string } | null;
}

export interface RpcClient {
  rpc(name: string, args: Record<string, unknown>): PromiseLike<RpcResult>;
}

export interface Combat2TickHandlerDependencies {
  env(name: "SUPABASE_URL" | "SUPABASE_SERVICE_ROLE_KEY" | "COMBAT2_WORKER_SECRET"): string | undefined;
  createClient(url: string, serviceRoleKey: string): RpcClient;
  processNodeTickOnce(
    nodeId: string,
    dependencies: ProcessNodeTickDependencies,
  ): Promise<NodeTickRunResult>;
  abilityRecords: readonly AuthoredAbilityRecord[];
  log?: (message: string, detail: Record<string, unknown>) => void;
}

function json(data: unknown, status: number): Response {
  return new Response(JSON.stringify(data), { status, headers: JSON_HEADERS });
}

function failure(kind: string, reason: string, status: number): Response {
  return json({ ok: false, kind, reason }, status);
}

function bearerToken(header: string | null): string | null {
  if (!header?.toLowerCase().startsWith("bearer ")) return null;
  const token = header.slice(7).trim();
  return token || null;
}

async function constantTimeSecretEqual(supplied: string, expected: string): Promise<boolean> {
  try {
    const encode = new TextEncoder();
    const [suppliedHash, expectedHash] = await Promise.all([
      crypto.subtle.digest("SHA-256", encode.encode(supplied)),
      crypto.subtle.digest("SHA-256", encode.encode(expected)),
    ]);
    const suppliedBytes = new Uint8Array(suppliedHash);
    const expectedBytes = new Uint8Array(expectedHash);
    let difference = 0;
    for (let index = 0; index < suppliedBytes.length; index += 1) {
      difference |= suppliedBytes[index] ^ expectedBytes[index];
    }
    return difference === 0;
  } catch {
    return false;
  }
}

function outcomeStatus(result: NodeTickRunResult): number {
  if (result.ok) return 200;
  switch (result.kind) {
    case "stale_claim":
    case "stale_snapshot":
      return 409;
    case "snapshot_rejected":
    case "player_catalog_rejected":
    case "boss_catalog_rejected":
    case "foreign_reference":
      return 422;
    case "claim_transport_error":
    case "commit_transport_error":
    case "malformed_claim":
    case "malformed_commit":
      return 502;
    case "resolver_failed":
      return 500;
  }
}

function redact(value: unknown, secrets: readonly string[]): unknown {
  if (typeof value === "string") {
    return secrets.reduce(
      (text, secret) => secret ? text.replaceAll(secret, "[REDACTED]") : text,
      value,
    );
  }
  if (Array.isArray(value)) return value.map((item) => redact(item, secrets));
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, redact(item, secrets)]),
    );
  }
  return value;
}

/** Thin HTTP boundary; all combat orchestration remains in processNodeTickOnce. */
export function createCombat2TickHandler(deps: Combat2TickHandlerDependencies) {
  return async (request: Request): Promise<Response> => {
    if (request.method !== "POST") {
      return failure("method_not_allowed", "POST required", 405);
    }

    const url = deps.env("SUPABASE_URL");
    const serviceRoleKey = deps.env("SUPABASE_SERVICE_ROLE_KEY");
    const workerSecret = deps.env("COMBAT2_WORKER_SECRET");
    if (!url || !serviceRoleKey || !workerSecret) {
      return failure("environment_failure", "required server environment is unavailable", 500);
    }
    if (await constantTimeSecretEqual(serviceRoleKey, workerSecret)) {
      return failure("environment_failure", "worker authorization is misconfigured", 500);
    }

    const token = bearerToken(request.headers.get("Authorization"));
    if (!token || !await constantTimeSecretEqual(token, workerSecret)) {
      return failure("unauthorized", "worker authorization required", 401);
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return failure("invalid_request", "body is not valid JSON", 400);
    }
    if (body === null || typeof body !== "object" || Array.isArray(body)) {
      return failure("invalid_request", "body must contain exactly one node_id", 400);
    }
    const entries = Object.entries(body);
    const nodeId = entries.length === 1 && entries[0][0] === "node_id" && typeof entries[0][1] === "string"
      ? entries[0][1]
      : null;
    if (!nodeId || !UUID_RE.test(nodeId)) {
      return failure("invalid_request", "node_id must be a UUID and the only body field", 400);
    }

    let client: RpcClient;
    try {
      client = deps.createClient(url, serviceRoleKey);
    } catch {
      return failure("environment_failure", "privileged transport is unavailable", 500);
    }

    let result: NodeTickRunResult;
    try {
      result = await deps.processNodeTickOnce(nodeId, {
        abilityRecords: deps.abilityRecords,
        transport: {
          async claimNode(id) {
            const { data, error } = await client.rpc("node_tick_claim", { _node_id: id });
            if (error) throw new Error(`node_tick_claim failed: ${error.code ?? "database_error"}`);
            return data;
          },
          async commitTick(args: CommitTickArgs) {
            const { data, error } = await client.rpc("node_tick_commit", args as unknown as Record<string, unknown>);
            if (error) throw new Error(`node_tick_commit failed: ${error.code ?? "database_error"}`);
            return data;
          },
        },
      });
    } catch {
      return failure("execution_failure", "worker execution failed", 500);
    }
    const status = outcomeStatus(result);
    deps.log?.("[combat2-tick-once] completed", { nodeId, kind: result.kind, status });
    return json(redact(result, [serviceRoleKey, workerSecret]), status);
  };
}
