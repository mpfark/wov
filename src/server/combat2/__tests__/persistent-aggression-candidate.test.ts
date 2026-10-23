import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { expect, it } from 'vitest';

it('guards the exact original core and produces only the reviewed hostile-attempt SET addition', () => {
  const source = readFileSync('drizzle/migrations/0002_progression_001d_canonical_xp_cutover.sql', 'utf8').replace(/\r\n/g, '\n');
  const tail = source.slice(source.indexOf('CREATE OR REPLACE FUNCTION public.node_tick_commit_without_bounded_failure('));
  const tag = /AS (\$\w*\$)/.exec(tail)!;
  const start = tag.index + tag[0].length;
  let body = tail.slice(start, tail.indexOf(tag[1], start));
  const original = "           is_alive        = COALESCE((rec->>'is_alive')::boolean, nc.is_alive) AND nc.is_alive,";
  const addition = "           engaged         = COALESCE((rec->>'engaged')::boolean, nc.engaged),";
  expect(readFileSync('drizzle/migrations/0024_g4a21_shared_creature_hp.sql', 'utf8')).toContain('engaged         = COALESCE');
  expect(body.split(original)).toHaveLength(2);
  body = body.replace(original, original + '\n' + addition);
  const md5 = createHash('md5').update(body.replace(/\s+/g, ' ')).digest('hex');
  const candidate = readFileSync('docs/operations/combat2-persistent-aggression.sql', 'utf8');
  expect(candidate).toContain(`IS DISTINCT FROM '${md5}'`);
  const needle = "       SET hp = GREATEST(COALESCE((rec->>'hp')::int, cr.hp), 0),";
  const replacement = candidate.split('$change$')[1];
  expect(replacement).toContain("COALESCE((rec->>'hostile_attempt')::boolean,false)");
  expect(replacement).not.toContain("_proposed->'events'");
  expect(createHash('md5').update(body.replace(needle, needle + replacement).replace(/\s+/g, ' ')).digest('hex'))
    .toBe('d17163615c8ce101742c6bb698363a7d');
});
it('preserves the owner-only core ACL without granting any caller new authority', () => {
  const sql = readFileSync('docs/operations/combat2-persistent-aggression.sql', 'utf8');
  expect(sql).toContain("OR has_function_privilege('service_role',target,'EXECUTE')");
  expect(sql).not.toContain("OR NOT has_function_privilege('service_role',target,'EXECUTE')");
  for (const role of ['anon', 'authenticated']) expect(sql).toContain(`has_function_privilege('${role}',target,'EXECUTE')`);
  expect(sql).toContain("NOT has_function_privilege('postgres',target,'EXECUTE')");
  expect(sql).toContain('a.grantee<>p.proowner'); // Includes PUBLIC and any unexpected platform/custom grant.
  expect(sql).toContain('ROW(before.proowner,before.prosecdef,before.proconfig,before.proacl) IS DISTINCT FROM');
  expect(sql).not.toMatch(/^\s*GRANT\s/im);
});

it('the actual Edge transports invoke the service outer definer RPC, never the private core', () => {
  for (const name of ['combat2-dispatch-once', 'combat2-tick-once']) {
    const handler = readFileSync(`supabase/functions/${name}/handler.ts`, 'utf8');
    expect(handler).toContain('deps.createClient(url, serviceRoleKey)');
    expect(handler).toMatch(/client\.rpc\(['"]node_tick_commit['"]/);
    expect(handler).not.toContain('node_tick_commit_without_bounded_failure');
  }
  const chain = ['node_tick_commit', 'node_tick_commit_without_character_stances',
    'node_tick_commit_without_authoritative_arrival', 'node_tick_commit_without_boss_timing',
    'node_tick_commit_without_bounded_failure'];
  for (let index = 0; index < chain.length - 1; index++) {
    const wrapper = readFileSync(`docs/operations/progression-001D-evidence/${chain[index]}.sql`, 'utf8');
    expect(wrapper).toContain('SECURITY DEFINER');
    expect(wrapper).toContain(`public.${chain[index + 1]}(`);
  }
  const cutover = readFileSync('drizzle/migrations/0002_progression_001d_canonical_xp_cutover.sql', 'utf8');
  const acl = cutover.slice(cutover.indexOf('-- Owner-internal composition remains intact;'));
  for (const name of chain) expect(acl).toContain(`public.${name}(`);
  expect(acl).toContain('WHERE grantee<>row.proowner');
  expect(acl).toContain('GRANT EXECUTE ON FUNCTION public.node_tick_commit(uuid,uuid,integer,integer,bigint,uuid[],jsonb) TO service_role');
  expect(acl.match(/GRANT EXECUTE/g)).toHaveLength(1);
});
