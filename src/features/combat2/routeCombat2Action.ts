import type { ClassAbility } from '@/features/combat/utils/class-abilities';
import { isStanceActive, resolveStanceForAbility, type ReservedBuffsMap } from '@/features/combat/utils/stances';
import type { Combat2IntentAction } from './intent';
import type { Combat2IntentResult } from './useCombat2IntentSession';
import type { Combat2TargetResolution } from './target-resolution';

export interface RouteCombat2ActionOptions {
  enabled: boolean;
  sessionReady: boolean;
  ability: ClassAbility | null;
  resolveTarget(): Combat2TargetResolution;
  reservedBuffs: Record<string, unknown>;
  legacy(): void | Promise<void>;
  submit(action: Combat2IntentAction, feedback?: { message: string }): Promise<Combat2IntentResult>;
  diagnose(message: string | null): void;
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
      kind: isStanceActive(options.reservedBuffs as ReservedBuffsMap, stance.key) ? 'stance_drop' : 'stance_activate',
      abilityKey: null,
      stanceKey: stance.key,
      targetCreatureId: null,
    };
  } else {
    if (ability.targetType === 'ally') {
      options.diagnose('This targeted action is not supported by the Combat2 intent contract.');
      return;
    }
    let targetCreatureId: string | null = null;
    if (ability.targetType === 'enemy') {
      const resolved = options.resolveTarget();
      if (resolved.ok === false) {
        options.diagnose(resolved.reason);
        return;
      }
      targetCreatureId = resolved.target.creatureId;
    }
    action = { kind: 'ability', abilityKey: ability.abilityKey, stanceKey: null, targetCreatureId };
  }

  const message = stance
    ? `You prepare to ${action.kind === 'stance_drop' ? 'drop' : 'activate'} ${stance.label}.`
    : `You prepare ${ability.label}.`;
  const result = await options.submit(action, { message });
  if (result.status === 'stale') return;
  if (result.status === 'local_refusal' && result.classification === 'in_flight') return;
  if (result.status === 'accepted') { options.diagnose(null); return; }
  const detail = 'reason' in result && result.reason ? `: ${result.reason}` : '';
  options.diagnose(`Combat2 refused ${ability.label}${detail}`);
}

export async function routeCombat2BasicAttack(options: Omit<RouteCombat2ActionOptions, 'ability' | 'reservedBuffs'>): Promise<void> {
  if (!options.enabled) { await options.legacy(); return; }
  if (!options.sessionReady) { options.diagnose('Combat2 is not ready to accept an attack.'); return; }
  const resolved = options.resolveTarget();
  if (resolved.ok === false) { options.diagnose(resolved.reason); return; }
  const result = await options.submit({ kind: 'basic_attack', abilityKey: null, stanceKey: null,
    targetCreatureId: resolved.target.creatureId }, { message: `You begin attacking ${resolved.target.name}.` });
  if (result.status === 'stale') return;
  if (result.status === 'local_refusal' && result.classification === 'in_flight') return;
  if (result.status === 'accepted') { options.diagnose(null); return; }
  options.diagnose(`Combat2 attack refused${'reason' in result && result.reason ? `: ${result.reason}` : ''}`);
}
