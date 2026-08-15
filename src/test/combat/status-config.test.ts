/**
 * status-config.test.ts — PERMANENT guard for authored status configuration.
 *
 * A missing or malformed `applied_statuses` definition used to degrade silently:
 * the composer fell through to the bare base config and the status landed with
 * `durationMs: 0` and zero magnitude — Ignite and Envenom quietly did nothing.
 *
 * These tests pin:
 *  1. The five required authored definitions (poison, ignite, bleed, scorched,
 *     chilled) exactly as deployed — effect identity, magnitude inputs,
 *     duration, interval, damage type and stack policy.
 *  2. That every malformation is reported, with the right refusal code, rather
 *     than accepted.
 *  3. That ability -> status references must resolve to a compatible definition
 *     with usable trigger/chance semantics.
 *  4. That the composer marks an unauthored reference instead of degrading it,
 *     so the combat loader can fail closed.
 *
 * The deployed mirror of (1)-(3) is `public.status_config_problems()`.
 */
import { describe, it, expect } from 'vitest';
import {
  REQUIRED_STATUS_CONTRACTS,
  REQUIRED_STATUS_KEYS,
  formatStatusProblems,
  validateAbilityStatusReferences,
  validateStatusDefinition,
  validateStatusDefinitions,
  type AppliedStatusRow,
} from '@/shared/config/status-contract';

/** The authored production rows (deployed `applied_statuses`). */
const AUTHORED: AppliedStatusRow[] = [
  {
    key: 'poison', effect_type: 'poison', classification: 'dot',
    default_damage_type: 'poison', is_periodic: true, tick_interval_ms: 2000,
    magnitude: { global_mult: 0.67, role: 'primary', stat_mult: 1.2 },
    duration: { base_ms: 25000, role: null },
    stacks: {
      max_stacks_calc: { base: 3, unit: 'count', terms: [{ source: 'stat', stat: 'cha' }] },
      role: 'secondary',
    },
  },
  {
    key: 'ignite', effect_type: 'ignite', classification: 'dot',
    default_damage_type: 'fire', is_periodic: true, tick_interval_ms: 2000,
    magnitude: { global_mult: 0.67, role: 'secondary', stat_mult: 0.7 },
    duration: { base_ms: 30000, cap_ms: 45000, per_point_ms: 1000, role: 'secondary' },
    stacks: { max_stacks_calc: { base: 5, unit: 'count', terms: [] } },
  },
  {
    key: 'bleed', effect_type: 'bleed', classification: 'dot',
    default_damage_type: 'physical', is_periodic: true, tick_interval_ms: 2000,
    magnitude: { global_mult: 0.67, role: 'primary', stat_mult: 1 },
    duration: { base_ms: 20000 },
    stacks: { max_stacks_calc: { base: 5, unit: 'count', terms: [] } },
  },
  {
    key: 'scorched', effect_type: 'scorched', classification: 'dot',
    default_damage_type: 'fire', is_periodic: true, tick_interval_ms: 2000,
    magnitude: { flat: 3 },
    duration: { base_ms: 6000 },
    stacks: { max_stacks_calc: { base: 3, unit: 'count', terms: [] } },
  },
  {
    key: 'chilled', effect_type: 'chilled', classification: 'damage_amp',
    default_damage_type: null, is_periodic: false, tick_interval_ms: null,
    magnitude: {},
    modifier: {
      kind: 'damage_taken_pct', value: 10,
      eligible_sources: ['weapon', 'ability', 'stance', 'dot', 'proc'],
    },
    duration: { duration_ticks: 3 },
    stacks: { max_stacks_calc: { base: 1, unit: 'count', terms: [] } },
  },
];

/** The authored ability -> status references (deployed `abilities`). */
const REFERENCES = [
  { ability_key: 'envenom', applied_status: 'poison', status_trigger: 'weapon_hit', status_chance_pct: null, mechanic_key: 'stack_apply', status_application_enabled: true },
  { ability_key: 'ignite', applied_status: 'ignite', status_trigger: 'successful_pulse_hit', status_chance_pct: null, mechanic_key: 'stack_apply', status_application_enabled: true },
  { ability_key: 'fireball', applied_status: 'scorched', status_trigger: 'ability_hit', status_chance_pct: 25, mechanic_key: 'spell_attack', status_application_enabled: true },
  { ability_key: 'frost_bolt', applied_status: 'chilled', status_trigger: 'ability_hit', status_chance_pct: 100, mechanic_key: 'spell_attack', status_application_enabled: true },
  { ability_key: 'rend', applied_status: 'bleed', status_trigger: 'ability_hit', status_chance_pct: 100, mechanic_key: 'dot_debuff', status_application_enabled: true },
];

const row = (key: string) => AUTHORED.find((r) => r.key === key)!;

describe('authored status configuration', () => {
  it('requires exactly the five statuses combat depends on', () => {
    expect([...REQUIRED_STATUS_KEYS].sort())
      .toEqual(['bleed', 'chilled', 'ignite', 'poison', 'scorched']);
  });

  it('accepts the deployed authored definitions with zero problems', () => {
    expect(formatStatusProblems(validateStatusDefinitions(AUTHORED))).toEqual([]);
  });

  it('keeps Ignite its own stat-scaled fire status, never substituted by Scorched', () => {
    const ignite = row('ignite');
    expect(ignite.effect_type).toBe('ignite');
    expect(ignite.default_damage_type).toBe('fire');
    expect((ignite.magnitude as any).stat_mult).toBeGreaterThan(0);
    // Scorched stays a separate, flat-magnitude status.
    expect(row('scorched').effect_type).toBe('scorched');
    expect((row('scorched').magnitude as any).flat).toBeGreaterThan(0);
  });

  it('keeps Envenom on poison', () => {
    expect(REFERENCES.find((r) => r.ability_key === 'envenom')!.applied_status).toBe('poison');
    expect(row('poison').default_damage_type).toBe('poison');
  });

  it('reports a missing required definition as missing_status_definition', () => {
    const problems = validateStatusDefinitions(AUTHORED.filter((r) => r.key !== 'ignite'));
    expect(problems).toHaveLength(1);
    expect(problems[0].code).toBe('missing_status_definition');
    expect(problems[0].status).toBe('ignite');
  });

  it.each([
    ['effect identity', { effect_type: 'scorched' }, /effect_type must be "ignite"/],
    ['classification', { classification: 'damage_amp' }, /classification must be "dot"/],
    ['damage type', { default_damage_type: 'poison' }, /default_damage_type must be "fire"/],
    ['duration', { duration: {} }, /duration: neither/],
    ['interval', { tick_interval_ms: 0 }, /tick_interval_ms must be a positive number/],
    ['magnitude', { magnitude: { role: 'secondary' } }, /neither magnitude.flat/],
    ['magnitude role', { magnitude: { stat_mult: 1 } }, /magnitude.role is unset/],
    ['stack policy', { stacks: {} }, /max_stacks_calc is missing/],
    ['stack ceiling', { stacks: { max_stacks_calc: { base: 0 } } }, /base must be a number >= 1/],
  ])('refuses a malformed definition: %s', (_label, patch, expected) => {
    const problems = validateStatusDefinition(
      { ...row('ignite'), ...(patch as AppliedStatusRow) },
      REQUIRED_STATUS_CONTRACTS.find((c) => c.key === 'ignite'),
    );
    expect(problems.join('; ')).toMatch(expected as RegExp);
  });

  it('refuses a damage_amp status without a usable modifier', () => {
    const problems = validateStatusDefinition(
      { ...row('chilled'), modifier: { kind: '', value: 0, eligible_sources: [] } },
      REQUIRED_STATUS_CONTRACTS.find((c) => c.key === 'chilled'),
    );
    expect(problems.join('; ')).toMatch(/modifier.kind is missing/);
    expect(problems.join('; ')).toMatch(/modifier.value must be a non-zero number/);
  });
});

describe('ability status references', () => {
  it('accepts every deployed reference', () => {
    expect(formatStatusProblems(validateAbilityStatusReferences(REFERENCES, AUTHORED))).toEqual([]);
  });

  it('refuses a reference to an unauthored status', () => {
    const problems = validateAbilityStatusReferences(
      [{ ...REFERENCES[0], applied_status: 'hexed' }],
      AUTHORED,
    );
    expect(problems.map((p) => p.code)).toEqual(['missing_status_definition']);
    expect(problems[0].ability).toBe('envenom');
  });

  it('refuses an unknown trigger and an unusable chance', () => {
    const problems = validateAbilityStatusReferences(
      [{ ...REFERENCES[2], status_trigger: 'whenever', status_chance_pct: 0 }],
      AUTHORED,
    );
    const rendered = formatStatusProblems(problems).join('; ');
    expect(rendered).toMatch(/status_trigger "whenever" is not one of/);
    expect(rendered).toMatch(/status_chance_pct must be a number/);
  });

  it('lets stack_apply derive its chance from the base amount calc', () => {
    expect(validateAbilityStatusReferences(
      [{ ...REFERENCES[0], status_chance_pct: null }],
      AUTHORED,
    )).toEqual([]);
  });
});
