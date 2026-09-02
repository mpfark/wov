import type { ClassAbility } from '@/features/combat/utils/class-abilities';
import { isStanceActive, resolveStanceForAbility, type ReservedBuffsMap } from '@/features/combat/utils/stances';
import type { Combat2IntentAction } from './intent';
import type { Combat2IntentResult } from './useCombat2IntentSession';

export interface RouteCombat2ActionOptions {
  enabled: boolean;
  sessionReady: boolean;
  ability: ClassAbility | null;
  targetId: string | null;
  livingCreatureIds: ReadonlySet<string> | null;
  reservedBuffs: Record<string, unknown>;
  legacy(): void | Promise<void>;
  submit(action: Combat2IntentAction): Promise<Combat2IntentResult>;
  diagnose(message: string): void;
}

/** The single deliberate-action switch: legacy when off, Combat2-only when it owns the session. */
export async function routeCombat2Action(options: RouteCombat2ActionOptions): Promise<void> {
  if (!options.enabled) {
    await options.legacy();
    return;
  }
  if (!options.sessionReady) {
    options.diagnose('Combat2 is not ready to accept an action.');
    return;
  }
  const ability = options.ability;
  if (!ability?.abilityKey) {
    options.diagnose('This action is not mapped to an authored Combat2 ability.');
    return;
  }

  const stance = resolveStanceForAbility(ability);
  let action: Combat2IntentAction;
  if (stance) {
    action = {
      kind: isStanceActive(options.reservedBuffs, stance.key) ? 'stance_drop' : 'stance_activate',
      abilityKey: null,
      stanceKey: stance.key,
      targetCreatureId: null,
    };
  } else {
    if (ability.targetType === 'ally') {
      options.diagnose('This targeted action is not supported by the Combat2 intent contract.');
      return;
    }
    const targetCreatureId = ability.targetType === 'enemy' ? options.targetId : null;
    if (ability.targetType === 'enemy'
      && (!targetCreatureId || !options.livingCreatureIds?.has(targetCreatureId))) {
      options.diagnose(`Select a living creature before using ${ability.label}.`);
      return;
    }
    action = { kind: 'ability', abilityKey: ability.abilityKey, stanceKey: null, targetCreatureId };
  }

  const result = await options.submit(action);
  if (result.status === 'stale') return;
  if (result.status !== 'accepted') {
    const detail = 'reason' in result && result.reason ? `: ${result.reason}` : '';
    options.diagnose(`Combat2 refused ${ability.label}${detail}`);
  }
}
