import { describe, expect, it } from 'vitest';
import { applyMitigationPipeline, readMitigationParams } from '../mitigation';

describe('combat2 mitigation pipeline (plan §6b)', () => {
  it('applies percentage mitigation with no shield equipped', () => {
    const out = applyMitigationPipeline({
      normalDamage: 100,
      critBonus: 0,
      percentMitigation: 0.2,
      shieldDrBonus: 0.05,
      shieldEquipped: false,
    });
    expect(out.percentMitigated).toBe(20);
    expect(out.shieldBonusApplied).toBe(0);
    expect(out.applied).toBe(80);
  });

  it('adds the authored shield bonus only when a shield is equipped', () => {
    const out = applyMitigationPipeline({
      normalDamage: 100,
      critBonus: 0,
      percentMitigation: 0.2,
      shieldDrBonus: 0.05,
      shieldEquipped: true,
    });
    expect(out.percentMitigated).toBe(25);
    expect(out.shieldBonusApplied).toBe(5);
    expect(out.applied).toBe(75);
  });

  it('clamps total percentage mitigation to the authored ceiling', () => {
    const out = applyMitigationPipeline({
      normalDamage: 100,
      critBonus: 0,
      percentMitigation: 0.9,
      shieldDrBonus: 0.05,
      shieldEquipped: true,
      mitigationCeilingPct: 0.5,
    });
    expect(out.percentMitigated).toBe(50);
    expect(out.applied).toBe(50);
  });

  it('softens only the critical bonus (40 normal / 20 crit bonus / 50%)', () => {
    const out = applyMitigationPipeline({
      normalDamage: 40,
      critBonus: 20,
      critSofteningPct: 0.5,
    });
    expect(out.incoming).toBe(50);
    expect(out.critSoftened).toBe(10);
    expect(out.applied).toBe(50);
  });

  it('leaves a non-critical hit untouched by crit softening', () => {
    const out = applyMitigationPipeline({
      normalDamage: 40,
      critBonus: 0,
      critSofteningPct: 0.5,
    });
    expect(out.incoming).toBe(40);
    expect(out.critSoftened).toBe(0);
  });

  it('applies no softening when the magnitude is not authored', () => {
    const params = readMitigationParams({ mitigation_mode: 'percent', shield_dr_bonus: 0.05 });
    expect(params.critSofteningPct).toBeNull();
    const out = applyMitigationPipeline({
      normalDamage: 40,
      critBonus: 20,
      critSofteningPct: params.critSofteningPct ?? undefined,
    });
    expect(out.applied).toBe(60);
  });

  it('orders percent → flat → block → absorb', () => {
    const out = applyMitigationPipeline({
      normalDamage: 100,
      critBonus: 0,
      percentMitigation: 0.5,
      flatMitigation: 10,
      blockAmount: 5,
      absorbPool: 20,
    });
    expect(out.percentMitigated).toBe(50);
    expect(out.flatMitigated).toBe(10);
    expect(out.blocked).toBe(5);
    expect(out.absorbed).toBe(20);
    expect(out.absorbPoolAfter).toBe(0);
    expect(out.applied).toBe(15);
  });

  it('reads flat mode and the taunt flag from authored config', () => {
    const params = readMitigationParams({ mitigation_mode: 'flat', is_taunt: true });
    expect(params.mode).toBe('flat');
    expect(params.isTaunt).toBe(true);
  });

  it('caps glancing damage and never goes below the floor when damage lands', () => {
    const capped = applyMitigationPipeline({ normalDamage: 40, critBonus: 0, gradedCap: 3 });
    expect(capped.applied).toBe(3);
    const floored = applyMitigationPipeline({
      normalDamage: 10, critBonus: 0, percentMitigation: 0.99, minimumDamage: 1,
    });
    expect(floored.applied).toBe(1);
  });
});
