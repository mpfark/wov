/**
 * reward-event-builder.ts — Stage 10 of the structured-event migration.
 *
 * Owns everything the player WALKS AWAY WITH:
 *
 *   - loot      — gem drops, item drops, milestone tokens
 *   - reward    — XP / gold / renown / salvage payouts carried on their own line
 *   - level_up  — levels, class bonuses, stat points, respec points
 *   - quest     — contract progress and completion
 *
 * As in every other stage, the server event type declares the category and the
 * payload carries the numbers; nothing downstream reads the prose. Server
 * prose still ships with decorative leading glyphs (/ / …) — those are
 * display noise, so the leading glyph is stripped here and the line's meaning
 * comes purely from `type`, `amountKind` and `severity`.
 */

import {
  createLogEvent,
  mapServerEventType,
  type GameLogEvent,
  type LogActor,
  type LogAmountKind,
  type LogSeverity,
} from './log-event';
import { applySelfPerspective } from './tick-event-builder';

interface Stage10Spec {
  /** Structured effect identity — never parsed from prose. */
  effectType: string;
  /** Set when the line deviates from its type's default severity. */
  severity?: LogSeverity;
  /** Amount semantics when the server sends a number for this event. */
  amountKind?: LogAmountKind;
}

/**
 * Every reward-shaped server event, with its structured identity.
 * The visual family follows the mapped `LogEventType` (loot / reward /
 * level_up / quest) — this table only adds identity and emphasis.
 */
const STAGE10_SPEC: Record<string, Stage10Spec> = {
  // ── Loot ──
  gem_drop: { effectType: 'gem', amountKind: 'stacks' },
  loot_drop: { effectType: 'item' },
  milestone_ember: { effectType: 'milestone', severity: 'notable' },
  // ── Progression ──
  level_up: { effectType: 'level', severity: 'notable' },
  level_bonus: { effectType: 'class_bonus', severity: 'routine' },
  stat_point: { effectType: 'stat_point', severity: 'routine' },
  respec: { effectType: 'respec_point', severity: 'routine' },
  // ── Rewards paid out on their own line ──
  xp_reward: { effectType: 'xp', amountKind: 'xp' },
  gold_reward: { effectType: 'gold', amountKind: 'gold' },
  renown_reward: { effectType: 'renown', amountKind: 'stacks' },
  salvage_reward: { effectType: 'salvage', amountKind: 'stacks' },

  // ── Quests / contracts ──
  contract_complete: { effectType: 'contract', severity: 'notable' },
};

export const STAGE10_SERVER_TYPES = Object.keys(STAGE10_SPEC);

/**
 * Drop a purely decorative leading glyph from server prose.
 * Structured events carry no leading control character — the marker and
 * colour are derived from the event, so the glyph would only duplicate it.
 */
function stripLeadingGlyph(message: string): string {
  return message
    .replace(
      /^(?:[\p{Extended_Pictographic}\uFE0F\u200D\p{Emoji_Modifier}]+\s*)+/u,
      '',
    )
    .trimStart();
}

/**
 * Reward prose is authored third-person ("Aldric gains 60 experience."). Once
 * the local name folds to "You", the verb must drop its third-person -s — that
 * conjugation is shared with every other structured line.
 */


/** Pull a canonical `[N]` suffix, when the server appends one. */
function trailingAmount(message: string): number | undefined {
  const m = message.match(/\[(\d+)\]\s*$/);
  return m ? Number(m[1]) : undefined;
}


export interface RewardEventInput {
  type: string;
  message: string;
  character_id?: string;
  creature_id?: string;
  creature_name?: string;
  /** Structured amount when the server sends one (XP, gold, stacks). */
  amount?: number;
  xp?: number;
  gold?: number;
}

/**
 * Build a structured event for a stage-10 reward/loot/progression/quest
 * server event, or null when the event belongs to another stage.
 */
export function buildRewardLogEvent(
  ev: RewardEventInput,
  localCharacterId: string,
  localCharacterName: string,
): GameLogEvent | null {
  const spec = STAGE10_SPEC[ev.type];
  if (!spec) return null;

  const type = mapServerEventType(ev.type);
  const isLocal = !ev.character_id || ev.character_id === localCharacterId;

  const remoteMessage = stripLeadingGlyph(ev.message);
  const message = isLocal
    ? applySelfPerspective(remoteMessage, localCharacterName)
    : remoteMessage;


  // Rewards always describe what the PLAYER gained — the player is the
  // subject, and any creature involved is only the source of the drop.
  const source: LogActor = ev.character_id
    ? { kind: 'player', id: ev.character_id }
    : { kind: 'player' };
  const target: LogActor | undefined =
    ev.creature_id || ev.creature_name
      ? { kind: 'creature', id: ev.creature_id, name: ev.creature_name }
      : undefined;

  const explicit =
    typeof ev.amount === 'number'
      ? ev.amount
      : spec.amountKind === 'xp' && typeof ev.xp === 'number'
        ? ev.xp
        : spec.amountKind === 'gold' && typeof ev.gold === 'number'
          ? ev.gold
          : undefined;
  const parsed = spec.amountKind ? explicit ?? trailingAmount(remoteMessage) : undefined;
  const amount = parsed !== undefined && parsed > 0 ? parsed : undefined;

  return createLogEvent({
    type,
    message,
    remoteMessage,
    source,
    target,
    amount,
    amountKind: amount !== undefined ? spec.amountKind : undefined,
    effectType: spec.effectType,
    severity: spec.severity,
    scope: 'node',
  });
}
