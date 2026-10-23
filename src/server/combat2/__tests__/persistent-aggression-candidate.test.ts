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
