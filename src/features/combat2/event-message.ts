import inventory from '@/shared/combat/inventory/active-abilities.json';
import type { Combat2SafeEvent } from './delivery';

/** Labels only: no evaluator, orchestration, mutable configuration or IO. */
export function combat2AbilityLabel(key: unknown, classKey?: string): string {
  if (typeof key !== 'string' || !/^[a-z][a-z0-9_]{0,63}$/.test(key)) return 'Effect';
  const matches = inventory.abilities.filter(row =>
    (row.abilityKey === key || row.classAbilityKey === key) && (!classKey || row.classKey === classKey));
  const labels = new Set(matches.map(row => row.label).filter(Boolean));
  if (labels.size === 1) return [...labels][0];
  return key.replaceAll('_', ' ').replace(/\b\w/g, letter => letter.toUpperCase());
}

export interface MessageContext { characterId: string; classKey?: string; stanceActivated?: boolean }

/** Pure display-only projection. Null omits a row, never its delivery cursor. */
export function formatCombat2Event(event: Combat2SafeEvent, context: MessageContext): string | null {
  if (event.kind === 'pending_event') return null;
  const own = event.actor?.type === 'character' && event.actor.id === context.characterId;
  const ownTarget = event.target?.type === 'character' && event.target.id === context.characterId;
  const subject = own ? 'You' : event.actor?.name || (event.actor?.type === 'creature' ? 'The creature' : 'Someone');
  const target = ownTarget ? 'you' : event.target?.name || (event.target?.type === 'character' ? 'the character' : 'the creature');
  const label = combat2AbilityLabel(event.abilityKey ?? event.meta?.effectType, own ? context.classKey : undefined);
  const action = event.meta?.basicAttack === true ? subject
    : event.abilityKey ? (own ? `Your ${label}` : event.actor ? `${subject}'s ${label}` : label)
    : !event.actor && event.kind === 'effect_pulse' ? 'An effect' : subject;
  const amount = typeof event.amount === 'number' && Number.isFinite(event.amount) ? event.amount : null;
  const meta = event.meta ?? {};
  const verb = (singular: string, plural: string) => own ? plural : singular;
  const positive = (key: string) => typeof meta[key] === 'number' && Number.isFinite(meta[key]) && (meta[key] as number) > 0;
  const details = [['percentMitigated', 'prevented by percentage mitigation'], ['flatMitigated', 'prevented by flat mitigation'],
    ['blocked', 'blocked'], ['absorbed', 'absorbed'], ['critSoftened', 'critical bonus reduced']]
    .filter(([key]) => positive(key)).map(([key, text]) => `${meta[key]} ${text}`);
  const damage = () => `${action} ${!event.abilityKey && own ? 'deal' : 'deals'} ${amount === null ? 'damage' : amount === 0 ? 'no damage' : `${amount} damage`} to ${target}${details.length ? ` (${details.join('; ')})` : ''}.`;
  switch (event.kind) {
    case 'attack': case 'creature_attack':
      if (event.hitQuality === 'miss' || event.outcomeReason === 'missed' || event.outcomeReason === 'critical_miss') {
        return `${action} ${!event.abilityKey && own ? 'miss' : 'misses'} ${target}${event.outcomeReason === 'critical_miss' ? ' (critical miss)' : ''}.`;
      }
      return damage();
    case 'effect_pulse':
      return meta.healing === true
        ? `${action} restores ${amount === null ? 'health' : `${amount} HP`} to ${target}.`
        : damage();
    case 'heal': case 'hp_transfer':
      return `${subject} ${verb('uses', 'use')} ${label}${event.target ? ` on ${own && ownTarget ? 'yourself' : target}` : ''}${amount === null ? '' : ` (up to ${amount} healing)`}.`;
    case 'dot_applied': case 'debuff_applied':
      return `${subject} ${verb('applies', 'apply')} ${label} to ${target}.`;
    case 'stance_activated':
      return `${subject} ${verb('activates', 'activate')} ${label}${amount === null ? '' : `, reserving ${amount} CP`}.`;
    case 'stance_dropped': return `${subject} ${verb('drops', 'drop')} ${label}.`;
    case 'buff_applied':
      if (context.stanceActivated) return null;
      return `${subject} ${verb('uses', 'use')} ${label}.`;
    case 'effect_expired':
      // Expiry/pulse records may lack source identity. Never assume they are yours.
      return `${event.actor ? action : label} expires.`;
    case 'fighter_fled': return `${subject} ${verb('flees', 'flee')}.`;
    case 'fighter_exit_failed': return `${subject} ${verb('cannot', 'cannot')} flee${event.outcomeReason === 'dead' ? ': defeated before escape' : ''}.`;
    case 'action_rejected': {
      const reasons: Record<string, string> = { insufficient_cp: 'not enough CP', no_target: 'no valid target',
        target_dead: 'target is dead', not_present_or_dead: 'not present or defeated',
        stance_already_active: 'stance already active', unknown_ability: 'unsupported ability', requires_shield: 'a shield is required' };
      return `${label} refused: ${reasons[event.outcomeReason ?? ''] ?? 'action unavailable'}.`;
    }
    case 'character_died': return `${target === 'you' ? 'You are' : `${event.target?.name || subject} is`} defeated.`;
    case 'creature_died': return `${event.target?.name || subject} is defeated.`;
    case 'boss_cast_evaded': return event.outcomeReason === 'no_target'
      ? `${action} lands on empty ground.` : `${action} is evaded.`;
    case 'boss_telegraph': return typeof meta.text === 'string' && meta.text.trim()
      ? meta.text.trim() : `${subject} prepares ${label}.`;
    default: return 'Combat state updated.';
  }
}

/** The parser has no flee command. Do not echo unhandled input as combat success. */
export function combat2FleeCommandRefusal(owned: boolean, text: string): string | null {
  return owned && /^\/?flee(?:\s+.*)?$/i.test(text.trim())
    ? 'Command refused: flee is unavailable in this controlled Combat2 session. No flee request was sent.' : null;
}
