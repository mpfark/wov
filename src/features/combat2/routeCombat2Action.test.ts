import { describe, expect, it, vi } from 'vitest';
import type { ClassAbility } from '@/features/combat/utils/class-abilities';
import { routeCombat2Action, routeCombat2BasicAttack } from './routeCombat2Action';

const CREATURE = '33333333-3333-4333-8333-333333333333';
const accepted = { status: 'accepted' as const, classification: 'queued' as const, intentId: 'id', seq: 1, intentStatus: null };
const ability = (overrides: Partial<ClassAbility> = {}): ClassAbility => ({
  abilityKey: 'fireball', label: 'Fireball', description: '', tooltip: '', cpCost: 10,
  type: 'spell_attack', tier: 0, levelRequired: 1, damageType: 'fire', targetType: 'enemy',
  ...overrides,
});

function harness(overrides: Partial<Parameters<typeof routeCombat2Action>[0]> = {}) {
  const legacy = vi.fn();
  const submit = vi.fn().mockResolvedValue(accepted);
  const diagnose = vi.fn();
  return {
    legacy, submit, diagnose,
    options: {
      enabled: true, sessionReady: true, ability: ability(),
      resolveTarget: () => ({ ok: true as const, target: { encounterId: 'enc', id: 'spawn', creatureId: CREATURE, spawnSeq: 1 } }),
      reservedBuffs: {}, legacy, submit, diagnose,
      ...overrides,
    },
  };
}

describe('Combat2 deliberate action routing', () => {
  it('routes a native basic attack without an ability key or legacy fallback', async () => {
    const h = harness();
    await routeCombat2BasicAttack(h.options);
    expect(h.submit).toHaveBeenCalledWith({ kind: 'basic_attack', abilityKey: null, stanceKey: null, targetCreatureId: CREATURE });
    expect(h.legacy).not.toHaveBeenCalled();
  });
  it('preserves the legacy path and performs no Combat2 submission when disabled', async () => {
    const h = harness({ enabled: false });
    await routeCombat2Action(h.options);
    expect(h.legacy).toHaveBeenCalledOnce();
    expect(h.submit).not.toHaveBeenCalled();
  });

  it('refuses locally before an authoritative encounter and never falls back', async () => {
    const h = harness({ sessionReady: false });
    await routeCombat2Action(h.options);
    expect(h.submit).not.toHaveBeenCalled();
    expect(h.legacy).not.toHaveBeenCalled();
    expect(h.diagnose).toHaveBeenCalledWith(expect.stringContaining('not ready'));
  });

  it('maps one authored enemy ability and authoritative creature id exactly once', async () => {
    const h = harness();
    await routeCombat2Action(h.options);
    expect(h.submit).toHaveBeenCalledExactlyOnceWith({
      kind: 'ability', abilityKey: 'fireball', stanceKey: null, targetCreatureId: CREATURE,
    });
    expect(h.legacy).not.toHaveBeenCalled();
  });

  it('routes stance activation and drop without an ability or creature target', async () => {
    const activate = harness({ ability: ability({ abilityKey: 'force_shield', type: 'absorb_buff', targetType: 'self' }) });
    await routeCombat2Action(activate.options);
    expect(activate.submit).toHaveBeenCalledWith({ kind: 'stance_activate', abilityKey: null, stanceKey: 'force_shield', targetCreatureId: null });

    const drop = harness({
      ability: ability({ abilityKey: 'force_shield', type: 'absorb_buff', targetType: 'self' }),
      reservedBuffs: { force_shield: { reserved_cp: 10 } },
    });
    await routeCombat2Action(drop.options);
    expect(drop.submit).toHaveBeenCalledWith({ kind: 'stance_drop', abilityKey: null, stanceKey: 'force_shield', targetCreatureId: null });
  });

  it('fails closed for unsupported and non-authoritative targets', async () => {
    const unsupported = harness({ ability: ability({ targetType: 'ally' }) });
    await routeCombat2Action(unsupported.options);
    expect(unsupported.submit).not.toHaveBeenCalled();
    expect(unsupported.legacy).not.toHaveBeenCalled();

    const staleTarget = harness({ resolveTarget: () => ({ ok: false, reason: 'Target is stale' }) });
    await routeCombat2Action(staleTarget.options);
    expect(staleTarget.submit).not.toHaveBeenCalled();
    expect(staleTarget.legacy).not.toHaveBeenCalled();
  });

  it('surfaces structured refusal without legacy fallback', async () => {
    const h = harness();
    h.submit.mockResolvedValue({ status: 'refused', classification: 'invalid_target', reason: 'dead' });
    await routeCombat2Action(h.options);
    expect(h.diagnose).toHaveBeenCalledWith(expect.stringContaining('dead'));
    expect(h.legacy).not.toHaveBeenCalled();
  });

  it('silently discards a stale response from an invalidated session', async () => {
    const h = harness();
    h.submit.mockResolvedValue({ status: 'stale' });
    await routeCombat2Action(h.options);
    expect(h.diagnose).not.toHaveBeenCalled();
    expect(h.legacy).not.toHaveBeenCalled();
  });
});
