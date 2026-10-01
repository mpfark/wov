import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
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
      resolveTarget: () => ({ ok: true as const, target: { encounterId: 'enc', id: 'spawn', creatureId: CREATURE, spawnSeq: 1, name: 'Goblin' } }),
      reservedBuffs: {}, legacy, submit, diagnose,
      ...overrides,
    },
  };
}

describe('Combat2 deliberate action routing', () => {
  it('routes a native basic attack without an ability key or legacy fallback', async () => {
    const h = harness();
    await routeCombat2BasicAttack(h.options);
    expect(h.submit).toHaveBeenCalledWith(
      { kind: 'basic_attack', abilityKey: null, stanceKey: null, targetCreatureId: CREATURE },
      { message: 'You begin attacking Goblin.' },
    );
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
    expect(h.submit).toHaveBeenCalledExactlyOnceWith(
      { kind: 'ability', abilityKey: 'fireball', stanceKey: null, targetCreatureId: CREATURE },
      { message: 'You prepare Fireball.' },
    );
    expect(h.legacy).not.toHaveBeenCalled();
  });

  it('routes stance activation and drop through the persistent authority, including outside combat', async () => {
    const changeStance = vi.fn().mockResolvedValue({ status: 'accepted', classification: 'activated' });
    const activate = harness({ sessionReady: false,
      readiness: { ready: false, reason: 'requires_active_combat', message: 'Requires active combat' },
      changeStance, ability: ability({ abilityKey: 'force_shield', type: 'absorb_buff', targetType: 'self' }) });
    await routeCombat2Action(activate.options);
    expect(changeStance).toHaveBeenCalledExactlyOnceWith('force_shield', 'activate');
    expect(activate.submit).not.toHaveBeenCalled();

    changeStance.mockResolvedValue({ status: 'accepted', classification: 'dropped' });
    const drop = harness({
      ability: ability({ abilityKey: 'force_shield', type: 'absorb_buff', targetType: 'self' }),
      reservedBuffs: { force_shield: { reserved_cp: 10 } },
      changeStance,
    });
    await routeCombat2Action(drop.options);
    expect(changeStance).toHaveBeenLastCalledWith('force_shield', 'drop');
    expect(drop.submit).not.toHaveBeenCalled();
  });

  it('fails closed for unsupported and non-authoritative targets', async () => {
    const unsupported = harness({ ability: ability({ abilityKey: 'divine_aegis', label: 'Divine Aegis', targetType: 'ally' }) });
    await routeCombat2Action(unsupported.options);
    expect(unsupported.submit).not.toHaveBeenCalled();
    expect(unsupported.legacy).not.toHaveBeenCalled();
    expect(unsupported.diagnose).toHaveBeenCalledWith(expect.stringContaining('Select one eligible'));

    const staleTarget = harness({ resolveTarget: () => ({ ok: false, reason: 'Target is stale' }) });
    await routeCombat2Action(staleTarget.options);
    expect(staleTarget.submit).not.toHaveBeenCalled();
    expect(staleTarget.legacy).not.toHaveBeenCalled();
  });

  it('routes exactly one authoritative ally identity and refuses missing or self Transfer Health locally', async () => {
    const ally = { characterId: 'ally', name: 'Ally', present: true, hp: 10 };
    const aegis = harness({ ability: ability({ abilityKey: 'divine_aegis', label: 'Divine Aegis',
      targetType: 'ally', type: 'absorb_buff' }), allyTargetId: 'ally', currentCharacterId: 'self',
      authoritativeAllies: [ally] });
    await routeCombat2Action(aegis.options);
    expect(aegis.submit).toHaveBeenCalledWith(expect.objectContaining({ targetCharacterId: 'ally',
      targetCreatureId: null }), expect.anything());

    const transfer = harness({ ability: ability({ abilityKey: 'transfer_health', label: 'Transfer Health',
      targetType: 'ally', type: 'hp_transfer' }), allyTargetId: 'self', currentCharacterId: 'self',
      authoritativeAllies: [{ ...ally, characterId: 'self' }] });
    await routeCombat2Action(transfer.options);
    expect(transfer.submit).not.toHaveBeenCalled();
    expect(transfer.diagnose).toHaveBeenCalledWith(expect.stringContaining('another eligible'));
  });

  it('uses the atomic hostile-initiation boundary before a session exists', async () => {
    const initiateHostile = vi.fn().mockResolvedValue({ status: 'entered' as const });
    const h = harness({ sessionReady: false, initiateHostile,
      resolveInitiationTarget: () => ({ ok: true as const, target: { creatureId: CREATURE, name: 'Goblin' } }) });
    await routeCombat2Action(h.options);
    expect(initiateHostile).toHaveBeenCalledExactlyOnceWith(CREATURE, 'fireball');
    expect(h.submit).not.toHaveBeenCalled();
    expect(h.legacy).not.toHaveBeenCalled();
  });

  it('does not use hostile initiation for a stance or self/support ability', async () => {
    const initiateHostile = vi.fn();
    const h = harness({ sessionReady: false, initiateHostile,
      resolveInitiationTarget: () => ({ ok: true as const, target: { creatureId: CREATURE, name: 'Goblin' } }),
      ability: ability({ abilityKey: 'force_shield', type: 'absorb_buff', targetType: 'self' }),
    });
    await routeCombat2Action(h.options);
    expect(initiateHostile).not.toHaveBeenCalled();
    expect(h.submit).not.toHaveBeenCalled();
    expect(h.legacy).not.toHaveBeenCalled();
  });

  it('does not bypass death, movement or delivery readiness to initiate hostility', async () => {
    const initiateHostile = vi.fn();
    const h = harness({ sessionReady: false, initiateHostile,
      readiness: { ready: false, reason: 'movement_pending', message: 'Movement is pending' },
      resolveInitiationTarget: () => ({ ok: true as const, target: { creatureId: CREATURE, name: 'Goblin' } }) });
    await routeCombat2Action(h.options);
    expect(initiateHostile).not.toHaveBeenCalled();
    expect(h.diagnose).toHaveBeenCalledWith('Movement is pending');
  });

  it('blocks unaffordable pointer or keyboard routing against authoritative spendable CP', async () => {
    const h = harness({ availableCp: 9 });
    await routeCombat2Action(h.options);
    expect(h.submit).not.toHaveBeenCalled();
    expect(h.legacy).not.toHaveBeenCalled();
    expect(h.diagnose).toHaveBeenCalledWith('Requires 10 CP — 9 available');
  });

  it('uses the same typed refusal for pointer and keyboard entry into the shared router', async () => {
    const readiness = { ready: false as const, reason: 'movement_pending' as const, message: 'Movement is pending' };
    const pointer = harness({ readiness });
    const keyboard = harness({ readiness });
    await routeCombat2Action(pointer.options);
    await routeCombat2Action(keyboard.options);
    for (const path of [pointer, keyboard]) {
      expect(path.submit).not.toHaveBeenCalled();
      expect(path.diagnose).toHaveBeenCalledWith('Movement is pending');
    }
  });

  it('feeds pointer and keyboard actions through the same spendable-CP router', () => {
    const page = readFileSync('src/pages/GamePage.tsx', 'utf8');
    const view = readFileSync('src/features/world/components/NodeView.tsx', 'utf8');
    expect(page).toContain('const handleAbilityKey = useCallback((index: number) => {');
    expect(page).toContain("const targetId = ability?.targetType === 'ally'");
    expect(page).toContain('void handlePlayerUseAbility(index, targetId);');
    expect(page).toContain('onUseAbility={(idx, target) => void handlePlayerUseAbility(idx, target ?? selectedTargetId ?? undefined)}');
    expect(page).toContain('readiness: combat2BlocksLegacy ? getCombat2AbilityReadiness(abilityIndex, targetId) : undefined');
    expect(page).toContain('getAbilityReadiness={combat2BlocksLegacy ? getCombat2AbilityReadiness : undefined}');
    expect(page).toContain('presentedCharacter.cp - authoritativeCombat2ReservedCp');
    expect(page).toContain("['requires_active_combat', 'no_authoritative_snapshot'].includes(combat2.actionReadiness.reason)");
    expect(page).toContain('combat2.entry.engageAction(targetCreatureId, abilityKey)');
    expect(view).toContain('abilityAvailableCp ?? (character.cp ?? 0)');
    expect(view).toContain('const readiness = getAbilityReadiness?.(idx, resolvedTarget);');
  });

  it('still permits dropping an active stance when spendable CP is zero', async () => {
    const changeStance = vi.fn().mockResolvedValue({ status: 'accepted', classification: 'dropped' });
    const h = harness({
      availableCp: 0,
      ability: ability({ abilityKey: 'force_shield', type: 'absorb_buff', targetType: 'self' }),
      reservedBuffs: { force_shield: { reserved_cp: 10 } },
      changeStance,
    });
    await routeCombat2Action(h.options);
    expect(changeStance).toHaveBeenCalledWith('force_shield', 'drop');
    expect(h.submit).not.toHaveBeenCalled();
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
