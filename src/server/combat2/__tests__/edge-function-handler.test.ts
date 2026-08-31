import { describe, expect, it, vi } from "vitest";
import {
  createCombat2TickHandler,
  type Combat2TickHandlerDependencies,
  type RpcClient,
} from "../../../../supabase/functions/combat2-tick-once/handler.ts";

const NODE = "11111111-1111-4111-8111-111111111111";
const SERVICE_KEY = "server-only-secret";

function request(body: unknown = { node_id: NODE }, init: RequestInit = {}): Request {
  return new Request("http://local/combat2-tick-once", {
    method: "POST",
    headers: { Authorization: `Bearer ${SERVICE_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
    ...init,
  });
}

function setup(result: unknown = { ok: true, kind: "committed", encounterId: NODE, tick: 2 }) {
  const rpc = vi.fn(async () => ({ data: null, error: null }));
  const process = vi.fn(async () => result) as Combat2TickHandlerDependencies["processNodeTickOnce"];
  const log = vi.fn();
  const deps: Combat2TickHandlerDependencies = {
    env: (name) => name === "SUPABASE_URL" ? "https://project.supabase.co" : SERVICE_KEY,
    createClient: () => ({ rpc }) as RpcClient,
    processNodeTickOnce: process,
    abilityRecords: [],
    log,
  };
  return { handler: createCombat2TickHandler(deps), deps, process, rpc, log };
}

describe("combat2-tick-once Edge handler", () => {
  it("accepts POST only", async () => {
    const { handler, process } = setup();
    const response = await handler(new Request("http://local", { method: "GET" }));
    expect(response.status).toBe(405);
    expect(await response.json()).toMatchObject({ kind: "method_not_allowed" });
    expect(process).not.toHaveBeenCalled();
  });

  it.each([
    ["invalid JSON", new Request("http://local", { method: "POST", headers: { Authorization: `Bearer ${SERVICE_KEY}` }, body: "{" })],
    ["missing node_id", request({})],
    ["extra fields", request({ node_id: NODE, scope: "all" })],
    ["non-UUID node_id", request({ node_id: "not-a-uuid" })],
  ])("rejects %s", async (_label, req) => {
    const { handler, process } = setup();
    const response = await handler(req);
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ kind: "invalid_request" });
    expect(process).not.toHaveBeenCalled();
  });

  it.each([null, "Bearer player-jwt", "Basic token"])("refuses non-service authorization: %s", async (authorization) => {
    const { handler, process } = setup();
    const headers = authorization ? { Authorization: authorization } : undefined;
    const response = await handler(request({ node_id: NODE }, { headers }));
    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ kind: "unauthorized" });
    expect(process).not.toHaveBeenCalled();
  });

  it("calls the single-sourced worker exactly once and forwards its structured outcome", async () => {
    const outcome = { ok: false, kind: "stale_snapshot", encounterId: NODE } as const;
    const { handler, process } = setup(outcome);
    const response = await handler(request());
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual(outcome);
    expect(process).toHaveBeenCalledTimes(1);
    expect(process).toHaveBeenCalledWith(NODE, expect.objectContaining({ abilityRecords: [] }));
  });

  it("redacts credentials from responses and does not log result details", async () => {
    const { handler, log } = setup({ ok: false, kind: "claim_transport_error", diagnostic: `failure ${SERVICE_KEY}` });
    const response = await handler(request());
    expect(await response.text()).toBe('{"ok":false,"kind":"claim_transport_error","diagnostic":"failure [REDACTED]"}');
    expect(JSON.stringify(log.mock.calls)).not.toContain(SERVICE_KEY);
  });

  it("fails closed when the server environment is incomplete", async () => {
    const fixture = setup();
    fixture.deps.env = () => undefined;
    const response = await createCombat2TickHandler(fixture.deps)(request());
    expect(response.status).toBe(500);
    expect(await response.json()).toMatchObject({ kind: "environment_failure" });
    expect(fixture.process).not.toHaveBeenCalled();
  });

  it("returns a redacted failure when privileged transport construction fails", async () => {
    const fixture = setup();
    fixture.deps.createClient = () => { throw new Error(SERVICE_KEY); };
    const response = await createCombat2TickHandler(fixture.deps)(request());
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      ok: false,
      kind: "environment_failure",
      reason: "privileged transport is unavailable",
    });
    expect(fixture.process).not.toHaveBeenCalled();
  });

  it("provides a transport limited to claim and commit RPCs", async () => {
    const fixture = setup();
    fixture.process.mockImplementation(async (_nodeId, deps) => {
      await deps.transport.claimNode(NODE);
      await deps.transport.commitTick({
        _encounter_id: NODE,
        _claim_token: "opaque",
        _candidate_tick: 2,
        _expected_last_tick: 1,
        _expected_state_version: 1,
        _intent_ids: [],
        _proposed: {} as never,
      });
      return { ok: true, kind: "committed", encounterId: NODE, tick: 2 };
    });
    await fixture.handler(request());
    expect(fixture.rpc.mock.calls.map(([name]) => name)).toEqual(["node_tick_claim", "node_tick_commit"]);
    expect(Object.keys(fixture.process.mock.calls[0][1].transport).sort()).toEqual(["claimNode", "commitTick"]);
  });
});
