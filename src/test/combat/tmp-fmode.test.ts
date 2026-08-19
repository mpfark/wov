import { readFileSync } from 'node:fs';
import { it } from 'vitest';
import { resolveTickPure } from '@/shared/combat/pure';
import { buildAttackLogEvent, stripFlavorNumber } from '@/features/combat/utils/combat-text';
import { creature, participant, snapshot } from './pure/fixtures';
it('live boss flavor in F mode', () => {

const row = JSON.parse(readFileSync('/tmp/boss.json','utf8'));
const flavors = (row.flavors as any[]).map(f => ({ name: f.name ?? '', text: f.text ?? '', weight: f.weight ?? 1, damageType: f.damage_type ?? null }));
const boss = creature({ id: 'crt-boss', name: row.name, rarity: 'boss', hp: 999999, maxHp: 999999, level: 40,
  attrs: { str: 30, dex: 30, con: 20, int: 10, wis: 10, cha: 10 }, bossCritFlavors: flavors, bossDeathCry: row.cry });
for (let tick = 1; tick < 400; tick++) {
  const out = resolveTickPure(snapshot({ tickNumber: tick,
    participants: [participant({ hp: 100000, maxHp: 100000, ac: 0, hasShield: false })],
    creatures: [boss], engagements: [{ creatureId: 'crt-boss', characterId: 'char-1', lastActionAtMs: 1000 }],
    ticksToSimulate: 4 }));
  const crit = out.events.find(e => e.type === 'creature_crit');
  if (!crit) continue;
  const ev = { type: 'creature_crit', message: crit.message, attacker_name: crit.attackerName!, target_name: crit.targetName!,
    damage: crit.amount!, is_crit: true, character_id: 'char-1', creature_id: 'crt-boss',
    boss_flavor: { name: crit.bossFlavorName!, text: crit.bossFlavorText!, damage_type: crit.damageType ?? undefined } };
  const log = buildAttackLogEvent(ev as any, 'char-1')!;
  console.log('NUMBERS :', log.message);
  console.log('F MODE  :', stripFlavorNumber(log.message));
  break;
}
const dead = resolveTickPure(snapshot({
  participants: [participant({ level: 40, attrs: { str: 40, dex: 40, con: 20, int: 10, wis: 10, cha: 10 } })],
  creatures: [creature({ ...boss, hp: 1 })],
  engagements: [{ creatureId: 'crt-boss', characterId: 'char-1', lastActionAtMs: 1000 }], ticksToSimulate: 6 }));
console.log('DEATH CRY:', dead.events.filter(e => e.type === 'boss_death_cry').map(e => e.message));


});
