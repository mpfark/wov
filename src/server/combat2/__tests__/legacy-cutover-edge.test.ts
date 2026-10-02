// @vitest-environment node
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { describe, expect, it, vi } from 'vitest';

// Execute the actual entrypoint and retained modules; no credentials or network.
// Reject unexpected dependencies rather than mocking away a resolver call.
function loadShell(name: string) {
  let handler: (req: Request) => Promise<Response>;
  const createClient = vi.fn(() => { throw new Error('database client forbidden'); });
  const envGet = vi.fn(() => { throw new Error('environment lookup forbidden'); });
  const boot = vi.fn();
  const loaded: string[] = [];
  function load(file: string): Record<string, any> {
    loaded.push(file);
    const exports = {};
    const result = ts.transpileModule(readFileSync(file, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2021 },
      reportDiagnostics: true,
    });
    expect(result.diagnostics?.filter(d => d.category === ts.DiagnosticCategory.Error)).toEqual([]);
    runInNewContext(result.outputText, {
      exports, Response, console: { log: boot },
      Deno: { serve: (fn: typeof handler) => { handler = fn; }, env: { get: envGet } },
      require: (specifier: string) => {
        if (specifier === 'npm:@supabase/supabase-js@2') return { createClient };
        const dependency = resolve(dirname(file), specifier);
        expect(dependency).toMatch(/[/\\\\]_shared[/\\\\](http\.ts|combat[/\\\\]build-identity\.ts)$/);
        return load(dependency);
      },
    });
    return exports;
  }
  load(resolve(`supabase/functions/${name}/index.ts`));
  return { handler: handler!, createClient, envGet, boot, loaded };
}

describe.each(['combat-tick', 'combat-catchup'])('%s production retirement', name => {
  it.each(['OPTIONS', 'POST', 'GET', 'PUT', 'PATCH', 'DELETE', 'HEAD'])(
    'preserves the exact %s response without credentials/body reads or combat execution', async method => {
      const shell = loadShell(name);
      const json = vi.fn(() => { throw new Error('body read forbidden'); });
      const headerGet = vi.fn(() => { throw new Error('authorization read forbidden'); });
      const response = await shell.handler({ method, json, headers: { get: headerGet } } as unknown as Request);
      expect(response.status).toBe(method === 'OPTIONS' ? 200 : 410);
      expect(Object.fromEntries(response.headers)).toEqual({
        'access-control-allow-origin': '*',
        'access-control-allow-headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
        ...(method === 'OPTIONS' ? {} : { 'content-type': 'application/json' }),
      });
      expect(await response.text()).toBe(method === 'OPTIONS' ? '' : JSON.stringify({
        ok: false, kind: 'legacy_retired', serverBuild: 'r8-bosscast-lifecycle-respawn-buildid',
      }));
      expect(shell.boot).toHaveBeenCalledExactlyOnceWith(`[${name}] boot`, {
        serverBuild: 'r8-bosscast-lifecycle-respawn-buildid',
      });
      expect(shell.createClient).not.toHaveBeenCalled();
      expect(shell.envGet).not.toHaveBeenCalled();
      expect(json).not.toHaveBeenCalled();
      expect(headerGet).not.toHaveBeenCalled();
      expect(shell.loaded).toHaveLength(3);
    },
  );

  it('contains no unreachable resolver, catalogue, authentication or mutation tail', () => {
    const source = readFileSync(`supabase/functions/${name}/index.ts`, 'utf8');
    expect(source).not.toMatch(/orchestrateCombatResolution|buildAbilityCatalog|createClient|Deno\.env|\.rpc\(|req\.json|internalCaller|UUID_RE/);
  });
});
