/**
 * presentation.ts — the single structured-event → visual mapping (Phase 3).
 *
 * Meaning lives on the event (`type`, `source.kind`, `severity`, `crit`);
 * everything visual is derived here. No component and no emitter picks a
 * family, colour or marker on its own, and nothing in this file inspects
 * `message`. The legacy adapter feeds this same map — it is a translation
 * boundary, not a second styling system.
 */
import type { GameLogEvent, LogEventType, LogSeverity } from './log-event';
import {
  FAMILY_STYLE,
  type EventLogFamily,
  type EventLogMarker,
} from '@/features/combat/utils/event-log-styles';

export type { EventLogFamily, EventLogMarker };

export interface LogPresentation {
  family: EventLogFamily;
  edgeClass: string;
  textClass: string;
  numberClass: string;
  strong: boolean;
  urgent: boolean;
  marker: EventLogMarker | null;
  severity: LogSeverity;
}

/**
 * `bySource` = the family follows who acted: the player acting is `action`,
 * anything else acting on the player is `threat`. Never inferred from words.
 */
interface TypeSpec {
  family: EventLogFamily | 'bySource' | 'byAbilitySource';
  severity: LogSeverity;
  marker?: EventLogMarker;
}

const TYPE_SPEC: Record<LogEventType, TypeSpec> = {
  attack: { family: 'bySource', severity: 'routine' },
  // Player ability casts and their outcomes share one subtle identity, distinct
  // from an ordinary weapon swing. Creature-sourced ability lines stay `threat`.
  ability: { family: 'byAbilitySource', severity: 'routine' },
  proc: { family: 'bySource', severity: 'routine' },
  debuff: { family: 'bySource', severity: 'routine' },
  dot_tick: { family: 'threat', severity: 'routine' },
  boss_cast_hit: { family: 'threat', severity: 'routine' },
  mitigation: { family: 'support', severity: 'routine' },
  heal: { family: 'support', severity: 'routine' },
  buff: { family: 'support', severity: 'routine' },
  boss_telegraph: { family: 'telegraph', severity: 'urgent', marker: 'telegraph' },
  kill: { family: 'notable', severity: 'notable', marker: 'kill' },
  death: { family: 'notable', severity: 'urgent', marker: 'kill' },
  // Stage 9 — who is on whom, and where everyone stands. A creature taking
  // aim reads as incoming threat; the player picking a target or repositioning
  // reads as their own action. Never inferred from wording.
  aggro: { family: 'bySource', severity: 'routine' },
  taunt: { family: 'bySource', severity: 'routine' },
  positioning: { family: 'bySource', severity: 'routine' },

  level_up: { family: 'notable', severity: 'notable', marker: 'level_up' },
  loot: { family: 'notable', severity: 'notable', marker: 'loot_rare' },
  quest: { family: 'notable', severity: 'notable', marker: 'quest' },
  error: { family: 'notable', severity: 'notable', marker: 'error' },
  reward: { family: 'ambient', severity: 'routine' },
  movement: { family: 'ambient', severity: 'routine' },
  system: { family: 'ambient', severity: 'routine' },
  unknown: { family: 'ambient', severity: 'routine' },
  legacy: { family: 'ambient', severity: 'routine' },
  speech: { family: 'chat', severity: 'routine' },
  whisper: { family: 'chat', severity: 'routine' },
};

/** Default severity for a type — emitters only set `severity` to deviate. */
export function defaultSeverity(type: LogEventType): LogSeverity {
  return (TYPE_SPEC[type] ?? TYPE_SPEC.unknown).severity;
}

export function familyForEvent(event: GameLogEvent): EventLogFamily {
  const spec = TYPE_SPEC[event.type] ?? TYPE_SPEC.unknown;
  if (spec.family === 'byAbilitySource') {
    return event.source?.kind === 'player' ? 'ability' : 'threat';
  }
  if (spec.family !== 'bySource') return spec.family;
  return event.source?.kind === 'player' ? 'action' : 'threat';
}

/**
 * Derive the full visual treatment for a structured event.
 * Markers are reserved for non-routine events; routine lines render icon-free.
 */
export function presentationForEvent(event: GameLogEvent): LogPresentation {
  const spec = TYPE_SPEC[event.type] ?? TYPE_SPEC.unknown;
  const family = familyForEvent(event);
  const severity = event.severity ?? spec.severity;
  const marker = severity === 'routine' ? null : spec.marker ?? null;

  return {
    family,
    ...FAMILY_STYLE[family],
    severity,
    marker,
    strong: family === 'notable' || family === 'telegraph' || !!event.crit,
    urgent: severity === 'urgent',
  };
}
