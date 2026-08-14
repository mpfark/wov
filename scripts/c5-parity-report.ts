/**
 * C5 phase 3 — final parity gate.
 *
 * Two seeded sweeps over the pure resolver (the only authority in the new
 * architecture), aggregated into a statistical report:
 *
 *   Sweep A — broad encounters: `randomSnapshot(seed)` across levels 1-45,
 *             1-4 members, 1-3 creatures, bosses, procs, DoTs, stances, wards.
 *             Reports hit/miss/crit/dodge/block rates, damage distributions,
 *             healing, DoT/aura/stack, boss cast + Stored Power, rewards,
 *             durability, deaths, party reward splitting, targeting modes.
 *
 *   Sweep B — per-ability: every active ability from
 *             `src/shared/combat/inventory/active-abilities.json` (36) driven
 *             through `abilityEncounter()` over N seeded ticks, so each ability
 *             and each of the resolver mechanics gets its own outcome profile.
 *
 * Determinism is re-proved inline: every resolution is run twice and compared.
 *
 * Usage: bun scripts/c5-parity-report.ts [runsA] [runsPerAbility]
 */
import { resolveTickPure } from '../src/shared/combat/pure';
import type { EncounterSnapshot, ProposedTick } from '../src/shared/combat/pure/types';
import { randomSnapshot } from '../src/test/combat/pure/fixtures';
import { abilityEncounter, type AbilityRow } from '../src/test/combat/c3a/ability-fixtures';
import inventory from '../src/shared/combat/inventory/active-abilities.json';

const RUNS_A = Number(process.argv[2] ?? 20000);
const RUNS_ABILITY = Number(process.argv[3] ?? 1500);

function stats(xs: number[]) {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const sum = s.reduce((a, b) => a + b, 0);
  const q = (p: number) => s[Math.min(s.length - 1, Math.floor(p * s.length))];
  return {
    n: s.length,
    min: s[0],
    p50: q(0.5),
    p95: q(0.95),
    max: s[s.length - 1],
    mean: +(sum / s.length).toFixed(3),
  };
}

interface Agg {
  ticks: number;
  events: Record<string, number>;
  attackDamage: number[];
  abilityDamage: number[];
  castDamage: number[];
  dotDamage: number[];
  heals: number[];
  transfers: number[];
  partyRegen: number[];
  procDamage: number[];
  weaponHitAttempts: number;
  creatureAttempts: number;
  creatureHits: number;
  creatureCrits: number;
  creatureMisses: number;
  abilityAttempts: number;
  abilityHits: number;
  stackApplications: number;
  hits: number;
  misses: number;
  crits: number;
  dodges: number;
  blocks: number;
  procTriggers: number;
  effectUpserts: number;
  stackUpserts: number;
  auraPulses: number;
  multiAttackHits: number[];
  retaliations: number;
  castStarts: number;
  castCarries: number;
  castStartDamage: number;
  castDoubleResolutions: number;
  castFleeAvoidances: number;
  castLockApplications: number;
  storedPowerBanked: number;
  storedPowerConsumed: number;
  castResolves: number;
  castFizzles: number;
  storedPowerDeltas: number[];
  storedPowerOverCap: number;
  xp: number[];
  gold: number[];
  renown: number[];
  salvage: number[];
  gems: number;
  lootProposals: number;
  lootLegacy: number;
  lootItemPool: number;
  durability: number;
  charDeaths: number;
  creatureDeaths: number;
  kills: number;
  partySplitKills: number;
  soloKills: number;
  multiPartyKills: number;
  rewardRecipients: number[];
  rejected: Record<string, number>;
  invariantFailures: string[];
  parityFailures: number;
  rngDraws: number;
}

function newAgg(): Agg {
  return {
    ticks: 0, events: {}, attackDamage: [], abilityDamage: [], castDamage: [], dotDamage: [],
    heals: [], transfers: [], partyRegen: [], procDamage: [], weaponHitAttempts: 0, creatureAttempts: 0, creatureHits: 0, creatureCrits: 0,
    creatureMisses: 0, abilityAttempts: 0, abilityHits: 0, stackApplications: 0, hits: 0,
    misses: 0, crits: 0, dodges: 0, blocks: 0, procTriggers: 0, effectUpserts: 0, stackUpserts: 0,
    auraPulses: 0, multiAttackHits: [], retaliations: 0, castStarts: 0, castResolves: 0,
    castFizzles: 0, storedPowerDeltas: [], storedPowerOverCap: 0, xp: [], gold: [], renown: [],
    salvage: [], gems: 0, lootProposals: 0, lootLegacy: 0, lootItemPool: 0, durability: 0,
    charDeaths: 0, creatureDeaths: 0, kills: 0, partySplitKills: 0, soloKills: 0,
    multiPartyKills: 0, rewardRecipients: [], rejected: {}, invariantFailures: [],
    parityFailures: 0, rngDraws: 0,
  };
}

function record(a: Agg, snap: EncounterSnapshot, out: ProposedTick) {
  a.ticks += out.ticksProcessed;
  a.rngDraws += out.rngDraws;

  for (const e of out.events) {
    a.events[e.type] = (a.events[e.type] ?? 0) + 1;
    const amt = e.amount ?? 0;
    switch (e.type) {
      // Player weapon swings
      case 'autoattack_hit': a.weaponHitAttempts++; a.hits++; a.attackDamage.push(amt); break;
      case 'autoattack_crit': a.weaponHitAttempts++; a.hits++; a.crits++; a.attackDamage.push(amt); break;
      case 'autoattack_miss': a.weaponHitAttempts++; a.misses++; break;
      // Creature swings (defence-side rates)
      case 'creature_hit': a.creatureAttempts++; a.creatureHits++; break;
      case 'creature_crit': a.creatureAttempts++; a.creatureHits++; a.creatureCrits++; break;
      case 'creature_miss': a.creatureAttempts++; a.creatureMisses++; break;
      // Abilities
      case 'ability_hit': a.abilityAttempts++; a.abilityHits++; a.abilityDamage.push(amt); break;
      case 'ability_crit': a.abilityAttempts++; a.abilityHits++; a.crits++; a.abilityDamage.push(amt); break;
      case 'ability_miss': a.abilityAttempts++; a.misses++; break;
      case 'volley': a.multiAttackHits.push(amt); a.abilityDamage.push(amt); break;
      case 'stack_consume_damage': case 'stack_finisher': a.abilityDamage.push(amt); break;
      case 'dodge': a.dodges++; break;
      case 'block': a.blocks++; break;
      // Healing / resources
      case 'heal': case 'ability_heal': a.heals.push(amt); break;
      case 'hp_transfer': a.transfers.push(amt); break;
      case 'party_regen': case 'regen_pulse': case 'regen_pulse_cp': a.partyRegen.push(amt); break;
      case 'aura_heal': a.auraPulses++; a.heals.push(amt); break;
      case 'aura_damage': case 'aura_pulse_damage': a.auraPulses++; a.abilityDamage.push(amt); break;
      case 'dot_tick': a.dotDamage.push(amt); break;
      case 'stack_applied': a.stackApplications++; break;
      // Procs and reactives
      case 'proc_damage': a.procTriggers++; a.procDamage.push(amt); break;
      case 'proc_heal': case 'proc_debuff': a.procTriggers++; break;
      case 'holy_shield_return': a.retaliations++; break;
      // Boss casts
      case 'boss_cast': a.castDamage.push(amt); break;
      default: break;
    }
  }

  a.effectUpserts += out.effectUpserts.length;
  a.stackUpserts += out.effectUpserts.filter((e) => e.stacks > 1).length;

  for (const c of out.casts) {
    if (c.phase === 'start') a.castStarts++;
    else if (c.phase === 'fizzle') a.castFizzles++;
    else a.castResolves++;
    if (c.damage > 0) a.castDamage.push(c.damage);
  }
  for (const sp of out.storedPower) {
    a.storedPowerDeltas.push(sp.delta);
    if (Math.abs(sp.delta) > Math.max(1, sp.cap)) a.storedPowerOverCap++;
  }

  a.durability += out.durability.length;
  a.charDeaths += out.characters.filter((c) => c.died).length;
  a.creatureDeaths += out.creatures.filter((c) => c.killed).length;
  a.kills += out.kills.length;
  a.gems += out.gems.length;
  for (const m of out.materials) a.salvage.push(m.quantity);
  for (const r of out.rewards) { a.xp.push(r.xp); a.gold.push(r.gold); a.renown.push(r.renown); }
  for (const l of out.loot) {
    a.lootProposals++;
    if (l.mode === 'item_pool') a.lootItemPool++; else a.lootLegacy++;
  }
  const partyOf = new Map(snap.participants.map((p) => [p.id, p.partyId]));
  for (const k of out.kills) {
    a.rewardRecipients.push(k.recipientCharacterIds.length);
    const parties = new Set(k.recipientCharacterIds.map((id) => partyOf.get(id) ?? `solo:${id}`));
    if (k.recipientCharacterIds.length === 1) a.soloKills++;
    else a.partySplitKills++;
    if (parties.size > 1) a.multiPartyKills++;
  }
  for (const r of out.rejectedActions) a.rejected[r.reason] = (a.rejected[r.reason] ?? 0) + 1;
}

function invariants(a: Agg, snap: EncounterSnapshot, out: ProposedTick, tag: string) {
  const fail = (m: string) => { if (a.invariantFailures.length < 40) a.invariantFailures.push(`${tag}: ${m}`); };
  const maxHp = new Map(snap.participants.map((p) => [p.id, p.maxHp]));
  const crMax = new Map(snap.creatures.map((c) => [c.id, c.maxHp]));
  for (const c of out.characters) {
    if (c.hpAfter < 0 || c.hpAfter > (maxHp.get(c.characterId) ?? 0)) fail('character hp out of bounds');
    if (!Number.isInteger(c.hpAfter)) fail('character hp not integral');
    if (c.absorbShieldAfter < 0) fail('negative ward');
  }
  for (const c of out.creatures) {
    if (c.hpAfter < 0 || c.hpAfter > (crMax.get(c.creatureId) ?? 0)) fail('creature hp out of bounds');
    if (c.killed && c.hpAfter !== 0) fail('kill without zero hp');
  }
  const recipients = new Set(out.kills.flatMap((k) => k.recipientCharacterIds));
  for (const r of out.rewards) {
    if (!recipients.has(r.characterId)) fail('reward to a non-killer');
    if (r.xp < 0 || r.gold < 0 || r.renown < 0) fail('negative reward');
  }
  const killIds = new Set(out.kills.map((k) => k.creatureId));
  if (killIds.size !== out.kills.length) fail('duplicate kill row');
  for (const l of out.loot) if (!killIds.has(l.creatureId)) fail('loot without a kill');
  const durChars = out.durability.map((d) => d.characterId);
  if (new Set(durChars).size !== durChars.length) fail('duplicate durability proposal');
  const consumed = new Set(out.consumedActionIds);
  for (const r of out.rejectedActions) if (consumed.has(r.actionId)) fail('action consumed and rejected');
  const purged = new Set(out.effectDeleteTargetIds);
  for (const e of out.effectUpserts) {
    if (purged.has(e.targetId)) fail('effect upsert onto purged target');
    if (e.stacks <= 0) fail('non-positive stacks');
    if (e.expiresAtMs <= snap.nowMs) fail('effect expires in the past');
  }
  // Reactive Holy recursion prevention: retaliation may never itself trigger
  // another retaliation, so retaliations can never exceed incoming hits.
  const retal = out.events.filter((e) => e.type === 'holy_shield_return').length;
  const incoming = out.events.filter((e) => e.type.startsWith('creature_attack') || e.type === 'creature_hit' || e.type === 'creature_crit').length;
  if (retal > 0 && incoming > 0 && retal > incoming) fail('retaliation exceeded incoming hits (recursion)');
}

function run(snap: EncounterSnapshot, tag: string, ...aggs: Agg[]) {
  const first = resolveTickPure(snap);
  const second = resolveTickPure(snap);
  const parity = JSON.stringify(first) === JSON.stringify(second);
  for (const a of aggs) {
    if (!parity) a.parityFailures++;
    invariants(a, snap, first, tag);
    record(a, snap, first);
  }
  return first;
}

// ── Sweep A ───────────────────────────────────────────────────────────────
const A = newAgg();
for (let seed = 1; seed <= RUNS_A; seed++) run(randomSnapshot(seed), `A/seed ${seed}`, A);

// ── Sweep B ───────────────────────────────────────────────────────────────
const rows = (inventory as unknown as { abilities: AbilityRow[] }).abilities;
interface AbilityReport { id: string; mechanic: string; agg: Agg }
const B: AbilityReport[] = [];
const BALL = newAgg();
for (const row of rows) {
  const agg = newAgg();
  const id = `${row.classKey}:${row.classAbilityKey}`;
  const base = abilityEncounter(row);
  for (let i = 0; i < RUNS_ABILITY; i++) {
    const snap: EncounterSnapshot = { ...base, tickNumber: 1000 + i, encounterId: `enc-${id}-${i}` };
    run(snap, `B/${id}#${i}`, agg, BALL);
  }
  B.push({ id, mechanic: row.mechanic, agg });
}

// ── Report ────────────────────────────────────────────────────────────────
const pct = (n: number, d: number) => (d === 0 ? 'n/a' : `${((100 * n) / d).toFixed(2)}%`);

function summary(a: Agg) {
  return {
    ticks: a.ticks,
    rngDraws: a.rngDraws,
    parityFailures: a.parityFailures,
    invariantFailures: a.invariantFailures.length,
    weaponAttempts: a.weaponHitAttempts,
    hitRate: pct(a.hits, a.weaponHitAttempts),
    missRate: pct(a.misses, a.weaponHitAttempts + a.misses),
    critShareOfWeaponHits: pct(a.crits, a.hits),
    creatureAttempts: a.creatureAttempts,
    creatureHitRate: pct(a.creatureHits, a.creatureAttempts),
    creatureCritShare: pct(a.creatureCrits, a.creatureHits),
    abilityAttempts: a.abilityAttempts,
    abilityHitRate: pct(a.abilityHits, a.abilityAttempts),
    dodgeRatePerCreatureSwing: pct(a.dodges, a.creatureAttempts),
    blockRatePerCreatureHit: pct(a.blocks, a.creatureHits),
    stackApplications: a.stackApplications,
    dodges: a.dodges,
    blocks: a.blocks,
    attackDamage: stats(a.attackDamage),
    abilityDamage: stats(a.abilityDamage),
    bossCastDamage: stats(a.castDamage),
    dotTickDamage: stats(a.dotDamage),
    heals: stats(a.heals),
    hpTransfers: stats(a.transfers),
    partyRegenTicks: stats(a.partyRegen),
    procTriggers: a.procTriggers,
    procDamage: stats(a.procDamage),
    effectUpserts: a.effectUpserts,
    stackedUpserts: a.stackUpserts,
    auraPulses: a.auraPulses,
    multiAttackVolleyDamage: stats(a.multiAttackHits),
    retaliations: a.retaliations,
    bossCasts: { starts: a.castStarts, resolves: a.castResolves, fizzles: a.castFizzles },
    storedPower: { mutations: a.storedPowerDeltas.length, overCapViolations: a.storedPowerOverCap, delta: stats(a.storedPowerDeltas) },
    xp: stats(a.xp),
    gold: stats(a.gold),
    renown: stats(a.renown),
    salvage: stats(a.salvage),
    gemDrops: a.gems,
    loot: { proposals: a.lootProposals, legacyTable: a.lootLegacy, itemPool: a.lootItemPool },
    durabilityHits: a.durability,
    characterDeaths: a.charDeaths,
    creatureDeaths: a.creatureDeaths,
    kills: a.kills,
    rewardSplit: { solo: a.soloKills, party: a.partySplitKills, multiParty: a.multiPartyKills, recipients: stats(a.rewardRecipients) },
    rejectedActions: a.rejected,
    eventTypes: Object.fromEntries(Object.entries(a.events).sort((x, y) => y[1] - x[1])),
  };
}

const report = {
  generatedAt: new Date().toISOString(),
  sweepA: { encounters: RUNS_A, ...summary(A) },
  sweepB: {
    abilities: rows.length,
    ticksPerAbility: RUNS_ABILITY,
    mechanics: [...new Set(rows.map((r) => r.mechanic))].sort(),
    aggregate: summary(BALL),
    perAbility: B.map((r) => {
      const a = r.agg;
      return {
        id: r.id,
        mechanic: r.mechanic,
        ticks: a.ticks,
        parityFailures: a.parityFailures,
        invariantFailures: a.invariantFailures.length,
        hitRate: pct(a.hits, a.weaponHitAttempts),
        critShare: pct(a.crits, a.hits + a.abilityHits),
        abilityDamage: stats(a.abilityDamage),
        heals: stats(a.heals),
        transfers: stats(a.transfers),
        dotTicks: stats(a.dotDamage),
        effectUpserts: a.effectUpserts,
        multiAttackVolleyDamage: stats(a.multiAttackHits),
        retaliations: a.retaliations,
        rejected: a.rejected,
        events: Object.fromEntries(Object.entries(a.events).sort((x, y) => y[1] - x[1])),
      };
    }),
  },
  failures: {
    sweepA: A.invariantFailures,
    sweepB: BALL.invariantFailures,
    parity: A.parityFailures + BALL.parityFailures,
  },
};

const out = process.env.C5_REPORT_PATH ?? '/mnt/documents/c5-parity-report.json';
await Bun.write(out, JSON.stringify(report, null, 2));
console.log(JSON.stringify({ sweepA: report.sweepA, sweepB: { ...report.sweepB, perAbility: undefined } }, null, 2));
console.log(`\nwrote ${out}`);
console.log(`parity failures: ${report.failures.parity}`);
console.log(`invariant failures: ${A.invariantFailures.length + BALL.invariantFailures.length}`);
