import inv from '@/shared/combat/inventory/active-abilities.json';
import { buildAbilityCatalog } from '@/shared/combat2/catalog';
import { decodeClaim } from '@/shared/combat2/decode';
import { adaptClaimedBossCatalog } from '@/shared/combat2/boss-catalog';
import { resolveNodeTick } from '@/shared/combat2/resolver';
import { CLAIM } from '@/shared/combat2/__tests__/roundtrip-contract.test';

function run(withIntent: boolean) {
  const claim: any = structuredClone(CLAIM);
  claim.snapshot.boss_configurations = claim.snapshot.creatures.map((c: any) => ({
    encounter_id: claim.encounter_id, node_creature_id: c.id, creature_id: c.creature_id, spawn_seq: c.spawn_seq, boss_cast: null }));
  if (!withIntent) claim.snapshot.intents = [];
  const d: any = decodeClaim(claim);
  if (!d.ok) { console.log('decode failed', d.errors); return; }
  const cat = buildAbilityCatalog((inv as any).abilities, (inv as any).statuses);
  const b = adaptClaimedBossCatalog(d.snapshot);
  const p: any = resolveNodeTick(b.snapshot, { abilities: cat.specs });
  const keys = Object.keys(p).sort();
  const shape: Record<string, string> = {};
  for (const k of keys) {
    const v = p[k];
    shape[k] = Array.isArray(v) ? `array(${v.length})` : v === undefined ? 'UNDEFINED' : typeof v;
  }
  let ser = 'ok';
  try { JSON.stringify({ _proposed: p }); } catch (e) { ser = 'THROW ' + (e as Error).message; }
  const round = JSON.parse(JSON.stringify(p));
  const lost = keys.filter(k => !(k in round));
  console.log(withIntent ? 'WITH INTENT' : 'NO INTENT', JSON.stringify(shape), 'serialize:', ser, 'lostKeys:', lost);
  // deep scan for undefined/NaN
  const bad: string[] = [];
  (function walk(v: any, path: string) {
    if (v === undefined) bad.push(path + '=undefined');
    else if (typeof v === 'number' && !Number.isFinite(v)) bad.push(path + '=' + v);
    else if (typeof v === 'bigint') bad.push(path + '=bigint');
    else if (v && typeof v === 'object') for (const k of Object.keys(v)) walk(v[k], path + '.' + k);
  })(p, '');
  console.log('  hazards:', bad.slice(0, 20));
}
run(false); run(true);
import { it } from 'vitest';
it('probe', () => {});
