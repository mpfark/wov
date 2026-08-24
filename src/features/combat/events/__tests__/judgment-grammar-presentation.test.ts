import { describe, it, expect } from 'vitest';
import { buildTickLogEvent } from '../tick-event-builder';
import { secondPersonVerb } from '../perspective';
import { presentationForEvent } from '../presentation';
import { foldPresentationGroups } from '../fold-groups';
import { SERVER_EVENT_TYPE_MAP } from '../log-event';

const ME = 'char-1';
const MY_NAME = 'Calikon';
const OTHER = 'char-2';
const CREATURE = 'Crazed Relic-Hunter';

function build(ev: Record<string, unknown>, local = ME) {
  return buildTickLogEvent(ev as never, local, local === ME ? MY_NAME : 'Cithra')!;
}

describe('perspective — verb conjugation', () => {
  it('drops only the -s from raises', () => {
    expect(secondPersonVerb('raises')).toBe('raise');
    expect(secondPersonVerb('raises')).not.toBe('rais');
  });

  it('still strips -es after a genuine sibilant cluster', () => {
    expect(secondPersonVerb('passes')).toBe('pass');
    expect(secondPersonVerb('misses')).toBe('miss');
    expect(secondPersonVerb('crushes')).toBe('crush');
    expect(secondPersonVerb('goes')).toBe('go');
  });

  it('keeps ordinary verbs intact', () => {
    expect(secondPersonVerb('turns')).toBe('turn');
    expect(secondPersonVerb('blocks')).toBe('block');
    expect(secondPersonVerb('parries')).toBe('parry');
  });
});

const FULL_BLOCK = {
  type: 'block',
  message: `${MY_NAME} blocks ${CREATURE}'s blow. [12]`,
  character_id: ME,
  creature_id: 'cr-1',
  creature_name: CREATURE,
  attacker_name: CREATURE,
  target_name: MY_NAME,
  amount: 12,
  group_id: 'swing|1',
  mitigation_source: 'block',
  attempted_amount: 12,
  mitigated_amount: 12,
  applied_amount: 0,
};

const CREATURE_SWING = {
  type: 'creature_hit',
  message: `${CREATURE} hits ${MY_NAME} for 0.`,
  character_id: ME,
  creature_id: 'cr-1',
  creature_name: CREATURE,
  attacker_name: CREATURE,
  target_name: MY_NAME,
  damage: 0,
  group_id: 'swing|1',
  attempted_amount: 12,
  applied_amount: 0,
};

describe('full mitigation folding', () => {
  it('folds to exactly one rendered line', () => {
    const folded = foldPresentationGroups([CREATURE_SWING, FULL_BLOCK] as never[]);
    expect(folded).toHaveLength(1);
    expect((folded[0] as { type: string }).type).toBe('block');
  });

  it('reads grammatically in the first person', () => {
    const [ev] = foldPresentationGroups([CREATURE_SWING, FULL_BLOCK] as never[]);
    const line = build(ev as Record<string, unknown>);
    expect(line.message).toBe(
      `You raise your shield and turn ${CREATURE}'s blow aside!`,
    );
    expect(line.numberText).toBe('[12 blocked]');
  });

  it('reads third-person for an observer', () => {
    const [ev] = foldPresentationGroups([CREATURE_SWING, FULL_BLOCK] as never[]);
    const line = buildTickLogEvent(ev as never, OTHER, 'Cithra')!;
    expect(line.message).toBe(
      `${MY_NAME} raises their shield and turns ${CREATURE}'s blow aside!`,
    );
  });

  it('never emits the truncated verb', () => {
    const [ev] = foldPresentationGroups([CREATURE_SWING, FULL_BLOCK] as never[]);
    const line = build(ev as Record<string, unknown>);
    expect(line.message).not.toMatch(/\brais\b/);
    expect(line.message).not.toMatch(/\bturns\b/);
  });

  it('leaves a partial block truthful and unfolded', () => {
    const partial = [
      { ...CREATURE_SWING, damage: 5, applied_amount: 5, message: `${CREATURE} hits ${MY_NAME} for 5.` },
      { ...FULL_BLOCK, amount: 7, mitigated_amount: 7, applied_amount: 5 },
    ];
    const folded = foldPresentationGroups(partial as never[]);
    expect(folded).toHaveLength(2);
  });

  it('does not fold a miss', () => {
    const miss = [
      { ...CREATURE_SWING, type: 'creature_miss', damage: undefined, applied_amount: undefined },
      FULL_BLOCK,
    ];
    expect(foldPresentationGroups(miss as never[])).toHaveLength(2);
  });
});

const JUDGMENT = {
  character_id: ME,
  creature_id: 'cr-1',
  creature_name: CREATURE,
  attacker_name: MY_NAME,
  target_name: CREATURE,
  ability_key: 'judgment',
};

describe('Judgment identity and presentation', () => {
  it('renders the authored hit line with the amount as a token', () => {
    const line = build({
      ...JUDGMENT,
      type: 'ability_hit',
      message: `${MY_NAME} hits ${CREATURE} with judgment for 48.`,
      damage: 48,
    });
    expect(line.message).toBe(`You pass divine judgment upon ${CREATURE}!`);
    expect(line.amount).toBe(48);
    expect(line.message).not.toMatch(/48/);
    expect(line.message).not.toMatch(/You hits/);
  });

  it('keeps the readable ability identity on a miss', () => {
    const line = build({
      ...JUDGMENT,
      type: 'ability_miss',
      message: `${MY_NAME}'s judgment misses ${CREATURE}.`,
    });
    expect(line.message).toContain('Judgment');
    expect(line.message).not.toContain('judgment ');
    expect(line.abilityKey).toBe('judgment');
  });

  it('routes a critical ability hit through the structured ability path', () => {
    expect(SERVER_EVENT_TYPE_MAP.ability_crit).toBe('ability');
    const line = build({
      ...JUDGMENT,
      type: 'ability_crit',
      message: `${MY_NAME} hits ${CREATURE} with judgment for 96.`,
      damage: 96,
      is_crit: true,
    });
    expect(line.type).toBe('ability');
    expect(line.crit).toBe(true);
    expect(line.message).toBe(`You pass divine judgment upon ${CREATURE}!`);
    expect(line.amount).toBe(96);
  });

  it('gives cast, hit and miss the ability presentation family', () => {
    for (const type of ['ability_cast', 'ability_hit', 'ability_miss', 'ability_crit']) {
      const line = build({ ...JUDGMENT, type, message: 'x', damage: 10 });
      const presentation = presentationForEvent(line);
      expect(presentation.family).toBe('ability');
      expect(presentation.edgeClass).toBe('log-edge-ability');
    }
  });

  it('renders third person for an unrelated observer', () => {
    const line = buildTickLogEvent(
      {
        ...JUDGMENT,
        type: 'ability_hit',
        message: 'ignored',
        damage: 48,
      } as never,
      OTHER,
      'Cithra',
    )!;
    expect(line.message).toBe(`${MY_NAME} passes divine judgment upon ${CREATURE}!`);
  });

  it('falls back to a generic identity sentence when nothing is authored', () => {
    const line = build({
      ...JUDGMENT,
      ability_key: 'totally_unauthored_ability',
      type: 'ability_hit',
      message: `${MY_NAME} hits ${CREATURE} with totally_unauthored_ability for 12.`,
      damage: 12,
    });
    expect(line.message).not.toMatch(/You hits/);
    expect(line.message).not.toMatch(/12/);
    expect(line.amount).toBe(12);
  });
});

describe('no regression on neighbouring lines', () => {
  it('keeps Holy Shield retaliation prose and its single token', () => {
    const line = build({
      type: 'holy_shield_return',
      message: `${MY_NAME}'s ward burns ${CREATURE} for 36.`,
      character_id: ME,
      creature_id: 'cr-1',
      creature_name: CREATURE,
      damage: 36,
    });
    expect(line.message).toContain('Holy Shield');
    expect(line.message).not.toMatch(/for 36/);
    expect(line.amount).toBe(36);
  });

  it('keeps creature attacks in the threat family', () => {
    const line = build({
      type: 'dot_tick',
      message: `${CREATURE} suffers 4 poison damage.`,
      creature_id: 'cr-1',
      creature_name: CREATURE,
    });
    expect(presentationForEvent(line).family).not.toBe('ability');
  });
});
