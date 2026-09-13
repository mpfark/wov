import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe.each(['combat-tick', 'combat-catchup'])('%s production retirement', (name) => {
  const source = readFileSync(`supabase/functions/${name}/index.ts`, 'utf8').replaceAll('\r\n', '\n');

  it('preserves CORS preflight and rejects every runtime invocation before legacy orchestration', () => {
    const options = source.indexOf("req.method === 'OPTIONS'");
    const retired = source.indexOf("kind: 'legacy_retired'");
    const privilegedClient = source.indexOf('const db = createClient', retired);
    expect(options).toBeGreaterThanOrEqual(0);
    expect(retired).toBeGreaterThan(options);
    expect(privilegedClient).toBeGreaterThan(retired);
    expect(source.slice(options, privilegedClient)).toContain('status: 410');
  });

  it('does not disclose or require credentials in the retirement response', () => {
    const retired = source.indexOf("kind: 'legacy_retired'");
    const retiredBlock = source.slice(retired - 100, retired + 200);
    expect(retiredBlock).not.toMatch(/SERVICE_ROLE|Authorization|secret|token/i);
  });
});
