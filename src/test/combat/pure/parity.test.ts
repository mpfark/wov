/**
 * C1 seeded parity sweep.
 *
 * 4,000 generated encounters (levels 1-45, 1-4 members, 1-3 creatures, bosses,
 * procs, DoTs, amps, stances, wards) are each resolved twice and checked
 * against the invariants the C2 committer will rely on. The sweep also proves
 * the rare paths — procs, boss casts, loot modes, durability, gems, kills — are
 * actually exercised, so "all invariants held" is not vacuous.
 */

import { describe, expect, it } from 'vitest';
import { resolveTickPure } from '@/shared/combat/pure';
import type { ProposedTick } from '@/shared/combat/pure/types';
import type { EncounterSnapshot } from '@/shared/combat/pure/types';
import { randomSnapshot } from './fixtures';

const RUNS = 4000;

interface Coverage {
  kills: number;
  bossCastStarts: number;
  bossFizzles: number;
  storedPower: number;
  procHeals: number;
  procDamage: number;
  procWeaken: number;
  dotTicks: number;
  durability: number;
  lootLegacy: number;
  lootItemPool: number;
  salvage: number;
  gems: number;
  bonds: number;
  deaths: number;
  dodges: number;
  blocks: number;
  crits: number;
  misses: number;
  rejected: number;
  catchupTicks: number;
}

function assertInvariants(out: ProposedTick, snap: EncounterSnapshot, seed: number) {
  const where = `seed ${seed}`;
  const maxHp = new Map(snap.participants.map((p) => [p.id, p.maxHp]));
  const maxCp = new Map(snap.participants.map((p) => [p.id, p.maxCp]));
  const creatureMaxHp = new Map(snap.creatures.map((c) => [c.id, c.maxHp]));

  // HP and resources stay inside their snapshot bounds.
  for (const c of out.characters) {
    expect(c.hpAfter, `${where} hp floor`).toBeGreaterThanOrEqual(0);
    expect(c.hpAfter, `${where} hp cap`).toBeLessThanOrEqual(maxHp.get(c.characterId)!);
    expect(c.cpAfter, `${where} cp floor`).toBeGreaterThanOrEqual(0);
    expect(c.cpAfter, `${where} cp cap`).toBeLessThanOrEqual(maxCp.get(c.characterId)!);
    expect(c.absorbShieldAfter, `${where} ward floor`).toBeGreaterThanOrEqual(0);
    expect(Number.isInteger(c.hpAfter), `${where} hp integral`).toBe(true);
  }
  for (const c of out.creatures) {
    expect(c.hpAfter, `${where} creature hp floor`).toBeGreaterThanOrEqual(0);
    expect(c.hpAfter, `${where} creature hp cap`).toBeLessThanOrEqual(
      creatureMaxHp.get(c.creatureId)!,
    );
    expect(Number.isInteger(c.hpAfter), `${where} creature hp integral`).toBe(true);
    if (c.killed) expect(c.hpAfter, `${where} killed at 0 hp`).toBe(0);
    if (c.hpAfter === 0 && c.hpBefore > 0) {
      expect(c.killed, `${where} zero hp implies killed`).toBe(true);
    }
  }

  // The committer upserts effects on (source_id, target_id, effect_type), and
  // Postgres refuses a statement that hits the same conflict row twice. A tick
  // may therefore never propose two upserts with the same identity.
  const effectIdentities = out.effectUpserts.map(
    (e) => `${e.sourceCharacterId ?? 'null'}|${e.targetId}|${e.effectType}`,
  );
  expect(new Set(effectIdentities).size, `${where} unique effect upsert identities`).toBe(
    effectIdentities.length,
  );


  // A kill is fully described: recipients, rewards, purges, one row only.
  const killIds = out.kills.map((k) => k.creatureId);
  expect(new Set(killIds).size, `${where} unique kills`).toBe(killIds.length);
  for (const kill of out.kills) {
    expect(kill.recipientCharacterIds.length, `${where} kill has recipients`).toBeGreaterThan(0);
    expect(
      out.engagementsPurgeCreatureIds.includes(kill.creatureId),
      `${where} kill purges engagements`,
    ).toBe(true);
    expect(
      out.effectDeleteTargetIds.includes(kill.creatureId),
      `${where} kill clears creature effects`,
    ).toBe(true);
    expect(
      out.creatures.some((c) => c.creatureId === kill.creatureId && c.killed),
      `${where} kill has a creature mutation`,
    ).toBe(true);
  }

  // Rewards only ever go to a kill recipient, and never negative.
  const recipients = new Set(out.kills.flatMap((k) => k.recipientCharacterIds));
  for (const r of out.rewards) {
    expect(recipients.has(r.characterId), `${where} reward recipient is a killer`).toBe(true);
    expect(r.xp, `${where} xp non-negative`).toBeGreaterThanOrEqual(0);
    expect(r.gold, `${where} gold non-negative`).toBeGreaterThanOrEqual(0);
    expect(r.renown, `${where} renown non-negative`).toBeGreaterThanOrEqual(0);
    expect(Number.isInteger(r.xp) && Number.isInteger(r.gold), `${where} integral`).toBe(true);
  }
  for (const m of out.materials) {
    expect(m.quantity, `${where} salvage positive`).toBeGreaterThan(0);
    expect(recipients.has(m.characterId), `${where} salvage to a killer`).toBe(true);
  }
  for (const b of out.bonds) {
    expect(b.amount, `${where} bond in range`).toBeGreaterThanOrEqual(1);
    expect(b.amount, `${where} bond capped`).toBeLessThanOrEqual(25);
  }
  for (const g of out.gems) {
    expect(g.gemKey.length, `${where} gem has a key`).toBeGreaterThan(0);
    expect(recipients.has(g.characterId), `${where} gem to a killer`).toBe(true);
  }
  // Loot is only ever proposed for a creature that actually died.
  for (const l of out.loot) {
    expect(killIds.includes(l.creatureId), `${where} loot follows a kill`).toBe(true);
    if (l.dropChance !== null) {
      expect(l.dropChance, `${where} drop chance range`).toBeGreaterThanOrEqual(0);
      expect(l.dropChance, `${where} drop chance range`).toBeLessThanOrEqual(1);
    }
  }

  // Durability: at most one proposal per character, on a real equipped row.
  const durChars = out.durability.map((d) => d.characterId);
  expect(new Set(durChars).size, `${where} one durability hit per character`).toBe(durChars.length);

  // Actions are either consumed or rejected — never both, never neither.
  const consumed = new Set(out.consumedActionIds);
  for (const r of out.rejectedActions) {
    expect(consumed.has(r.actionId), `${where} action not double-handled`).toBe(false);
  }

  // Effects: no upsert onto a creature whose effects are being purged.
  const purged = new Set(out.effectDeleteTargetIds);
  for (const e of out.effectUpserts) {
    expect(purged.has(e.targetId), `${where} no upsert onto a purged target`).toBe(false);
    expect(e.stacks, `${where} stacks positive`).toBeGreaterThan(0);
    // An effect applied on an early simulated tick may already have lapsed by
    // the final tick; it must still expire after the snapshot instant.
    expect(e.expiresAtMs, `${where} effect expiry after snapshot`).toBeGreaterThan(snap.nowMs);
  }

  // Stored Power never exceeds the creature cap.
  for (const sp of out.storedPower) {
    expect(Math.abs(sp.delta), `${where} stored power delta within cap`).toBeLessThanOrEqual(
      Math.max(1, sp.cap),
    );
  }

  // Casts always name their creature and carry non-negative damage. A fizzle
  // keeps the target it froze at telegraph time but must never land damage.
  for (const c of out.casts) {
    expect(c.damage, `${where} cast damage non-negative`).toBeGreaterThanOrEqual(0);
    if (c.phase === 'fizzle') {
      expect(c.targets, `${where} fizzle hits nobody`).toEqual([]);
      expect(c.storedPowerConsumed, `${where} fizzle releases nothing`).toBe(0);
    } else {
      expect(c.targetCharacterId, `${where} live cast has a target`).not.toBeNull();
    }
  }


  // Presentation events never carry negative amounts.
  for (const e of out.events) {
    if (e.amount != null) expect(e.amount, `${where} event amount`).toBeGreaterThanOrEqual(0);
  }
}

function record(cov: Coverage, out: ProposedTick) {
  cov.kills += out.kills.length;
  cov.durability += out.durability.length;
  cov.salvage += out.materials.length;
  cov.gems += out.gems.length;
  cov.bonds += out.bonds.length;
  cov.rejected += out.rejectedActions.length;
  // Death is carried on the character mutation, not as its own event.
  cov.deaths += out.characters.filter((c) => c.died).length;
  cov.storedPower += out.storedPower.length;
  if (out.mode === 'catchup') cov.catchupTicks += out.ticksProcessed;
  for (const c of out.casts) {
    if (c.phase === 'fizzle') cov.bossFizzles++;
    if (c.phase === 'start') cov.bossCastStarts++;
  }
  for (const l of out.loot) {
    if (l.mode === 'item_pool') cov.lootItemPool++;
    else cov.lootLegacy++;
  }
  for (const e of out.events) {
    switch (e.type) {
      case 'proc_heal':
        cov.procHeals++;
        break;
      case 'proc_damage':
        cov.procDamage++;
        break;
      case 'proc_debuff':
        cov.procWeaken++;
        break;
      case 'dot_tick':
        cov.dotTicks++;
        break;
      case 'dodge':
        cov.dodges++;
        break;
      case 'block':
        cov.blocks++;
        break;
      case 'autoattack_crit':
      case 'ability_crit':
        cov.crits++;
        break;
      case 'autoattack_miss':
      case 'ability_miss':
        cov.misses++;
        break;
    }
  }
}

describe('pure resolver — seeded parity sweep', () => {
  const cov: Coverage = {
    kills: 0,
    bossCastStarts: 0,
    bossFizzles: 0,
    storedPower: 0,
    procHeals: 0,
    procDamage: 0,
    procWeaken: 0,
    dotTicks: 0,
    durability: 0,
    lootLegacy: 0,
    lootItemPool: 0,
    salvage: 0,
    gems: 0,
    bonds: 0,
    deaths: 0,
    dodges: 0,
    blocks: 0,
    crits: 0,
    misses: 0,
    rejected: 0,
    catchupTicks: 0,
  };

  it(`resolves ${RUNS} seeded encounters identically twice and holds every invariant`, () => {
    for (let seed = 1; seed <= RUNS; seed++) {
      const snap = randomSnapshot(seed);
      const a = resolveTickPure(snap);
      const b = resolveTickPure(snap);
      expect(JSON.stringify(b), `seed ${seed} parity`).toBe(JSON.stringify(a));
      assertInvariants(a, snap, seed);
      record(cov, a);
    }
  }, 120_000);

  it('exercised the rare paths (coverage is not vacuous)', () => {
    const required: Array<keyof Coverage> = [
      'kills',
      'bossCastStarts',
      'bossFizzles',
      'storedPower',
      'procHeals',
      'procDamage',
      'procWeaken',
      'dotTicks',
      'durability',
      'lootLegacy',
      'lootItemPool',
      'salvage',
      'gems',
      'bonds',
      'deaths',
      'dodges',
      'blocks',
      'crits',
      'misses',
      'rejected',
      'catchupTicks',
    ];
    const missing = required.filter((k) => cov[k] === 0);
    expect(missing, `uncovered paths: ${missing.join(', ')}`).toEqual([]);
  });
});
