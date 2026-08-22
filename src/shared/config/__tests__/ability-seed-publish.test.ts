import { describe, it, expect } from 'vitest';
import { ABILITY_SEED } from '@/shared/config/ability-seed';
import { validateAbilityForPublish } from '@/shared/config/mechanic-templates';

describe('seed publish validation', () => {
  it('every seeded ability passes the publish gate', () => {
    const problems: string[] = [];
    for (const a of ABILITY_SEED) {
      const errs = validateAbilityForPublish({
        mechanic_key: a.mechanic_key,
        amount_calc: a.amount_calc,
        duration_calc: a.duration_calc,
        interval_ms: a.interval_ms,
        mechanic_calcs: a.mechanic_calcs ?? {},
        accuracy_stat: a.accuracy_stat ?? null,
        status: 'active',
      });

      for (const e of errs) problems.push(`${a.class_key}:${a.ability_key} → ${e}`);
    }
    expect(problems).toEqual([]);
  });
});
