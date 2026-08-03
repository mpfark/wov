/**
 * Phase 5b — shared cast event generation.
 *
 * Turns a resolved telegraphed cast hit into the exact strings and structured
 * `GameLogEvent` the log renders. Single copy (not mirrored): it depends on
 * `../proc-log-format.ts`, which the client already imports through the
 * `@shared` alias.
 *
 * Wording rules preserved byte-for-byte from the previous inline builder:
 *   - An authored `hit_flavor` always wins over the default sentence.
 *   - If the author inlined `{damage}` / `%v`, the canonical ` [N]` suffix is
 *     omitted so the number isn't printed twice.
 *   - The damage type renders as an adjective ("searing Cataclysm") and
 *     collapses cleanly when the cast is untyped.
 */
import { renderFlavor, flavorHasDamageToken } from '../proc-log-format.ts';
import { damageTypeAdjective, normalizeDamageType } from './damage-types.ts';

export interface CastHitInput {
  creatureId: string;
  creatureName: string;
  characterId: string;
  characterName: string;
  /** Display name of the cast (payload label, falling back to cast_key). */
  label: string;
  /** Author-supplied template; blank falls back to the default sentence. */
  hitFlavor?: string | null;
  damage: number;
  damageType?: string | null;
}

export interface CastHitEvent {
  /** Third-person line, shown to everyone else at the node. */
  message: string;
  /** Second-person line, shown to the character who was hit. */
  selfMessage: string;
}

export function buildCastHitMessages(input: CastHitInput): CastHitEvent {
  const flavor = String(input.hitFlavor ?? '').trim();
  const dmgType = normalizeDamageType(input.damageType);
  const adjective = damageTypeAdjective(dmgType);
  const damage = Math.max(0, Math.floor(Number(input.damage) || 0));
  const suffix = flavorHasDamageToken(flavor) ? '' : ` [${damage}]`;

  const render = (target: string) =>
    flavor
      ? `${renderFlavor(flavor, {
          creature: input.creatureName,
          target,
          cast: input.label,
          damage,
          damageType: dmgType ?? undefined,
        })}${suffix}`
      : `${input.creatureName}'s ${adjective ? `${adjective} ` : ''}${input.label} strikes ${target}! [${damage}]`;

  return { message: render(input.characterName), selfMessage: render('you') };
}

/** The full tick event (legacy `message` + structured `log_event`) for one hit. */
export function buildCastHitEvent(input: CastHitInput) {
  const { message, selfMessage } = buildCastHitMessages(input);
  const dmgType = normalizeDamageType(input.damageType);
  const damage = Math.max(0, Math.floor(Number(input.damage) || 0));

  return {
    type: 'boss_cast_hit' as const,
    character_id: input.characterId,
    creature_id: input.creatureId,
    damage,
    message,
    log_event: {
      v: 1 as const,
      id: crypto.randomUUID(),
      ts: Date.now(),
      type: 'boss_cast_hit',
      message: selfMessage,
      remoteMessage: message,
      source: { kind: 'creature', id: input.creatureId, name: input.creatureName },
      target: { kind: 'player', id: input.characterId, name: input.characterName },
      amount: damage,
      amountKind: 'damage',
      damageType: dmgType ?? undefined,
      effectType: input.label,
      scope: 'node',
    },
  };
}
