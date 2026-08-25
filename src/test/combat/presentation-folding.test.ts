/**
 * Phase 3 presentation closure: correlation folding, perspective grammar,
 * full-mitigation folding and ability-identity precedence.
 *
 * Everything here is deterministic and structural: no test asserts on wording
 * the server chose, and no fold is allowed to invent an outcome.
 */
import { describe, expect, it } from 'vitest';
import { foldPresentationGroups, type FoldableEvent } from '@/features/combat/events/fold-groups';
import { buildTickLogEvent } from '@/features/combat/events/tick-event-builder';
import { resolveSelfMarkers, secondPersonVerb, SELF_MARKER } from '@/features/combat/events/perspective';
import { getAbilityCastFlavor } from '@/features/combat/utils/cast-flavor';
import { formatCombatEvent } from '@/features/combat/utils/combat-text';

const LOCAL_ID = 'char-local';
const LOCAL_NAME = 'Aldric';

function pulseGroup(overrides: Partial<FoldableEvent> = {}): FoldableEvent[] {
  const group_id = 'pulse|1|orbs_of_fire|char-local|cr-1';
  return [
    {
      type: 'stance_pulse',
      message: 'Aldric sears Ithram for 7.',
      group_id,
      damage: 7,
      stacks: 3,
      max_stacks: 5,
      effect_type: 'ignite',
      ability_key: 'orbs_of_fire',
      character_id: LOCAL_ID,
      creature_id: 'cr-1',
      attacker_name: LOCAL_NAME,
      target_name: 'Ithram',
      ...overrides,
    },
    {
      type: 'stack_applied',
      message: 'Aldric afflicts Ithram [3/5].',
      group_id,
      stacks: 3,
      max_stacks: 5,
      effect_type: 'ignite',
      ability_key: 'orbs_of_fire',
      character_id: LOCAL_ID,
      creature_id: 'cr-1',
    },
  ];
}

function swingGroup(over: {
  attempted?: number;
  mitigated?: number;
  applied?: number;
  attackType?: string;
  mitigationSource?: string;
} = {}): FoldableEvent[] {
  const group_id = 'swing|1|cr-1|char-local|0';
  const attempted = over.attempted ?? 18;
  const mitigated = over.mitigated ?? 18;
  const applied = over.applied ?? 0;
  return [
    {
      type: 'block',
      message: "Aldric blocks Granite Outlaw's blow. [18]",
      group_id,
      amount: mitigated,
      attempted_amount: attempted,
      mitigated_amount: mitigated,
      applied_amount: applied,
      mitigation_source: over.mitigationSource ?? 'block',
      character_id: LOCAL_ID,
      creature_id: 'cr-1',
      creature_name: 'Granite Outlaw',
    },
    {
      type: over.attackType ?? 'creature_hit',
      message: `Granite Outlaw hits Aldric for ${applied}.`,
      group_id,
      damage: applied,
      attempted_amount: attempted,
      mitigated_amount: mitigated,
      applied_amount: applied,
      character_id: LOCAL_ID,
      creature_id: 'cr-1',
      creature_name: 'Granite Outlaw',
    },
  ];
}

describe('correlation grouping', () => {
  it('1. folds a damaging stance pulse and the stack it landed into one line', () => {
    const out = foldPresentationGroups(pulseGroup());
    expect(out).toHaveLength(1);
    expect(out[0].type).toBe('stance_pulse');
    expect(out[0].fold).toEqual({
      kind: 'pulse_with_stack',
      stacks: 3,
      maxStacks: 5,
      effectType: 'ignite',
    });
  });

  it('2. keeps a standalone stack line when no pulse damage occurred', () => {
    const [pulse, stack] = pulseGroup();
    const out = foldPresentationGroups([{ ...pulse, damage: 0 }, stack]);
    expect(out.map((e) => e.type)).toEqual(['stance_pulse', 'stack_applied']);
    expect(out.every((e) => e.fold === undefined)).toBe(true);
  });

  it('3. never folds events from different groups', () => {
    const [pulse] = pulseGroup();
    const [, stack] = pulseGroup();
    const out = foldPresentationGroups([pulse, { ...stack, group_id: 'other-group' }]);
    expect(out).toHaveLength(2);
  });

  it('4. leaves ungrouped events untouched and in order', () => {
    const events: FoldableEvent[] = [
      { type: 'creature_hit', message: 'a' },
      { type: 'stack_applied', message: 'b' },
    ];
    expect(foldPresentationGroups(events).map((e) => e.message)).toEqual(['a', 'b']);
  });
});

describe('full-mitigation folding', () => {
  it('5. folds a hit whose damage was entirely mitigated', () => {
    const out = foldPresentationGroups(swingGroup());
    expect(out).toHaveLength(1);
    expect(out[0].type).toBe('block');
    expect(out[0].fold).toEqual({ kind: 'full_block', mitigated: 18, source: 'block' });
  });

  it('6. does not fold partial mitigation', () => {
    const out = foldPresentationGroups(swingGroup({ attempted: 18, mitigated: 6, applied: 12 }));
    expect(out.map((e) => e.type)).toEqual(['block', 'creature_hit']);
    expect(out.every((e) => e.fold === undefined)).toBe(true);
  });

  it('7. does not fold misses or dodges', () => {
    const miss: FoldableEvent[] = [
      {
        type: 'dodge',
        message: 'Aldric dodges.',
        group_id: 'g',
        mitigation_source: 'dodge',
        attempted_amount: 12,
        mitigated_amount: 12,
        applied_amount: 0,
      },
      { type: 'creature_miss', message: 'Granite Outlaw misses Aldric.', group_id: 'g' },
    ];
    expect(foldPresentationGroups(miss)).toHaveLength(2);
  });

  it('8. does not fold a zero-damage hit with no mitigation recorded', () => {
    const [, attack] = swingGroup({ attempted: 0, mitigated: 0, applied: 0 });
    const out = foldPresentationGroups([attack]);
    expect(out).toHaveLength(1);
    expect(out[0].fold).toBeUndefined();
  });

  it('9. renders one folded block line with a single blocked token', () => {
    const [folded] = foldPresentationGroups(swingGroup());
    const event = buildTickLogEvent(folded as never, LOCAL_ID, LOCAL_NAME)!;
    expect(event.numberText).toBe('[18 blocked]');
    expect(event.amount).toBeUndefined();
    expect(event.message).not.toMatch(/\[\d+\]/);
  });
});

describe('perspective grammar', () => {
  it('10. resolves self markers by position, not by capitalisation', () => {
    const text = `A flaming orb leaps from ${SELF_MARKER} and sears Ithram! ${SELF_MARKER}'s ward holds.`;
    expect(resolveSelfMarkers(text)).toBe(
      'A flaming orb leaps from you and sears Ithram! Your ward holds.',
    );
  });

  it('11. conjugates only the verb of a subject "You"', () => {
    expect(resolveSelfMarkers(`${SELF_MARKER} blocks the blow.`)).toBe('You block the blow.');
    expect(resolveSelfMarkers(`${SELF_MARKER}'s ward burns Ithram.`)).toBe(
      'Your ward burns Ithram.',
    );
    expect(secondPersonVerb('has')).toBe('have');
  });

  it('12. keeps observer text in third person with names intact', () => {
    const [folded] = foldPresentationGroups(swingGroup());
    const event = buildTickLogEvent(folded as never, 'someone-else', 'Mira')!;
    expect(event.remoteMessage).toContain('Aldric');
    expect(event.remoteMessage).not.toMatch(/\byou\b/i);
  });
});

describe('ability identity and wording', () => {
  it('13. resolves fireball flavor from its ability key, not the spell_attack fallback', () => {
    const flavor = getAbilityCastFlavor('fireball', 'Ithram');
    expect(flavor).toBeTruthy();
    expect(flavor).toMatch(/flame|Embers/);
    expect(flavor).not.toMatch(/Power gathers|shape the spell/);
  });

  it('14. never repeats the attack verb inside its own flavor fragment', () => {
    for (let idx = 0; idx < 12; idx++) {
      const line = formatCombatEvent(
        {
          type: 'creature_hit',
          message: '',
          attacker_name: 'Granite Outlaw',
          target_name: LOCAL_NAME,
          damage: 5 + idx,
          is_humanoid: true,
          character_id: LOCAL_ID,
        },
        LOCAL_ID,
      );
      const [, verb, fragment] = /^Granite Outlaw (\S+)[^,]*, (\S+)/.exec(line) ?? [];
      if (!verb || !fragment) continue;
      const stem = (w: string) => w.toLowerCase().replace(/(?:ing|es|s)$/, '');
      expect(stem(fragment)).not.toBe(stem(verb));
    }
  });
});

/**
 * Boss casts resolved against a character follow the SAME defensive contract as
 * a creature swing: the cast keeps its identity, the mitigation carries the
 * structured breakdown, and full mitigation renders one folded defensive line
 * instead of a bare [0] hit.
 */
describe('boss-cast mitigation folding', () => {
  const group_id = 'cast|cast-1|cr-1|char-local';

  function castGroup(attempted: number, mitigated: number, applied: number): FoldableEvent[] {
    return [
      {
        type: 'boss_cast_mitigated',
        message: "Riptide Cut crashes against Aldric's defenses!",
        group_id,
        character_id: LOCAL_ID,
        creature_id: 'cr-1',
        amount: mitigated,
        attempted_amount: attempted,
        mitigated_amount: mitigated,
        applied_amount: applied,
        mitigation_source: 'cast_mitigation',
        target_name: LOCAL_NAME,
        attacker_name: 'Ser Caldris',
      },
      {
        type: 'boss_cast_hit',
        message: `Riptide Cut strikes Aldric for ${applied}.`,
        group_id,
        character_id: LOCAL_ID,
        creature_id: 'cr-1',
        amount: applied,
        attempted_amount: attempted,
        mitigated_amount: mitigated,
        applied_amount: applied,
      },
    ];
  }

  it('folds a fully mitigated cast into the defensive line', () => {
    const out = foldPresentationGroups(castGroup(31, 31, 0));
    expect(out.map((e) => e.type)).toEqual(['boss_cast_mitigated']);
    expect(out[0].fold).toEqual({ kind: 'full_block', mitigated: 31, source: 'cast_mitigation' });
  });

  it('keeps both lines when the cast was only partly mitigated', () => {
    const out = foldPresentationGroups(castGroup(31, 12, 19));
    expect(out.map((e) => e.type)).toEqual(['boss_cast_mitigated', 'boss_cast_hit']);
    expect(out.every((e) => e.fold === undefined)).toBe(true);
  });

  it('renders the folded cast as a blocked amount, not a [0] hit', () => {
    const folded = foldPresentationGroups(castGroup(31, 31, 0))[0];
    const line = buildTickLogEvent(folded as never, LOCAL_ID, LOCAL_NAME);
    expect(line.message).toContain('31 blocked');
    expect(line.message).not.toContain('[0]');
  });
});
