/**
 * Guards the classification contract of the reusable-status editor: the client
 * validation must reject exactly what the database trigger
 * `validate_applied_status` rejects, so a bad draft never reaches the server.
 */
import { describe, expect, it } from 'vitest';
import { validateStatusDraft } from '../StatusManager';

const dot = {
  key: 'bleed', label: 'Bleed', effect_type: 'bleed', classification: 'dot',
  stack_noun: 'stack', tick_interval_ms: null, default_damage_type: 'physical',
  admin_notes: null,
  magnitude: { role: 'primary' as const, stat_mult: 1, global_mult: 1 },
  duration: { base_ms: 20000 },
  stacks: { max_stacks_calc: null },
  modifier: null,
};

const amp = {
  ...dot,
  key: 'chilled', label: 'Chilled', effect_type: 'chilled', classification: 'damage_amp',
  magnitude: {},
  duration: { duration_ticks: 3 },
  modifier: { kind: 'damage_taken_pct', value: 10, eligible_sources: ['weapon', 'ability'] },
};

describe('validateStatusDraft', () => {
  it('accepts a scaled damage-over-time status', () => {
    expect(validateStatusDraft(dot)).toEqual([]);
  });

  it('accepts an amplification status', () => {
    expect(validateStatusDraft(amp)).toEqual([]);
  });

  it('rejects a dot with neither flat damage nor a role', () => {
    expect(validateStatusDraft({ ...dot, magnitude: {} }).join(' ')).toMatch(/flat damage or an attribute role/);
  });

  it('rejects flat damage combined with attribute scaling', () => {
    expect(validateStatusDraft({ ...dot, magnitude: { flat: 3, role: 'primary' } }).join(' '))
      .toMatch(/mutually exclusive/);
  });

  it('rejects amplification without eligible sources', () => {
    expect(validateStatusDraft({ ...amp, modifier: { ...amp.modifier, eligible_sources: [] } }).join(' '))
      .toMatch(/at least one damage source/);
  });

  it('rejects a fractional amplification percent', () => {
    expect(validateStatusDraft({ ...amp, modifier: { ...amp.modifier, value: 10.5 } }).join(' '))
      .toMatch(/whole percent/);
  });

  it('rejects a tick interval on an amplification status', () => {
    expect(validateStatusDraft({ ...amp, tick_interval_ms: 3000 }).join(' '))
      .toMatch(/no tick interval/);
  });

  it('rejects a non-snake-case key', () => {
    expect(validateStatusDraft({ ...dot, key: 'Bleed Hard' }).join(' ')).toMatch(/lower_snake_case/);
  });
});
