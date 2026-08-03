/**
 * legacy-adapter.ts — TEMPORARY compatibility boundary (Phase 3).
 *
 * This is the ONLY module allowed to look at a log string's leading emoji,
 * keywords or sentence patterns. It converts unstructured strings —
 * historical `party_combat_log` rows, broadcasts from older clients, and
 * emitters not yet migrated — into normal structured `GameLogEvent`s so the
 * rest of the app has exactly one event shape and one presentation map.
 *
 * Rules:
 *  - Explicit structured metadata ALWAYS wins; a structured event never
 *    passes through here, not even when its type is unknown.
 *  - Unrecognised strings become neutral `legacy` (ambient) events.
 *  - The original string is preserved verbatim in `legacy.raw`, so embedded
 *    emoji stay visible and text output is byte-identical to today.
 *
 * REMOVAL CRITERIA (delete this file, `classifyLogLine`, `toPresentation`
 * and the `legacy` event type together when all hold):
 *  1. Stages 2–8 of Phase 3 have shipped and no emitter in `src/` or
 *     `supabase/functions/` produces a control-prefixed log string.
 *  2. The compatibility `party_combat_log.message` text has been retired,
 *     which is no sooner than one full release after stage 8.
 *  3. No supported client or active reader consumes string-only log rows.
 */
import {
  createLogEvent,
  type GameLogEvent,
  type LogActor,
  type LogEventType,
  type LogSeverity,
} from './log-event';
import {
  classifyLogLine,
  type ClassifiedLog,
  type EventLogCategory,
} from '@/features/combat/utils/event-log-styles';

const QUEST_RE = /contract (?:fulfilled|accepted|complete)|quest (?:complete|completed|updated|accepted)/i;
/** was the server sentinel for boss cast starts before stage 2. */
const TELEGRAPH_RE = /^ |begins channeling|flee the node|begins to channel|telegraph/i;
const ERROR_RE = /not enough|no longer valid|failed|cannot |fizzle|unavailable|too far/i;
const PLAYER_DEATH_RE = /you (?:have )?(?:died|been slain|have fallen)|you are dead/i;

const PLAYER_SOURCE: LogActor = { kind: 'player' };
const CREATURE_SOURCE: LogActor = { kind: 'creature' };

/** Legacy fine-grained category → structured type (+ implied actor side). */
const CATEGORY_TYPE: Record<EventLogCategory, { type: LogEventType; source?: LogActor; effectType?: string }> = {
  player_attack: { type: 'attack', source: PLAYER_SOURCE },
  passive: { type: 'proc', source: PLAYER_SOURCE },
  enemy_attack: { type: 'attack', source: CREATURE_SOURCE },
  fire: { type: 'dot_tick', effectType: 'ignite' },
  poison: { type: 'dot_tick', effectType: 'poison' },
  bleed: { type: 'dot_tick', effectType: 'bleed' },
  shadow: { type: 'dot_tick', effectType: 'shadow' },
  heal: { type: 'heal' },
  holy: { type: 'heal', effectType: 'holy' },
  buff: { type: 'buff' },
  mitigation: { type: 'mitigation' },
  system: { type: 'system' },
  xp: { type: 'reward' },
  neutral: { type: 'legacy' },
  loot: { type: 'loot' },
  level_up: { type: 'level_up' },
  kill: { type: 'kill' },
  crit: { type: 'attack' },
  speech: { type: 'speech' },
  whisper: { type: 'whisper' },
};

interface LegacyAdaptOptions {
  /** Preserve the id assigned by the authoritative emitter / DB row. */
  id?: string;
  ts?: number;
  /** Observer name for remote party lines (legacy string rewrite path only). */
  remoteName?: string | null;
}

/**
 * Legacy-only observer rewrite. Structured events use `remoteMessage`
 * instead; this regex exists purely to keep old strings readable and dies
 * with the adapter.
 */
export function rewriteLegacyRemote(message: string, name: string): string {
  let msg = message;
  msg = msg.replace(/^((?:[\p{Emoji_Presentation}\p{Extended_Pictographic}\uFE0F\u200D]+\s*)*)You /u, `$1${name} `);
  msg = msg.replace(/ you /gi, ` ${name} `);
  msg = msg.replace(/^((?:[\p{Emoji_Presentation}\p{Extended_Pictographic}\uFE0F\u200D]+\s*)*)Your /u, `$1${name}'s `);
  msg = msg.replace(/ your /gi, ` ${name}'s `);
  msg = msg.replace(/ you\./gi, ` ${name}.`);
  msg = msg.replace(/ you!/gi, ` ${name}!`);
  return msg;
}

function resolveType(raw: string, cls: ClassifiedLog): { type: LogEventType; source?: LogActor; effectType?: string; severity?: LogSeverity } {
  if (TELEGRAPH_RE.test(raw)) return { type: 'boss_telegraph' };
  if (QUEST_RE.test(raw)) return { type: 'quest' };
  if (cls.baseCategory === 'enemy_attack' && raw.startsWith('\u{26A0}\u{FE0F}') && ERROR_RE.test(raw)) {
    return { type: 'error' };
  }
  if (PLAYER_DEATH_RE.test(raw)) return { type: 'death' };

  if (cls.category === 'crit') {
    // Crits kept their source family before; infer the side from the base
    // category, falling back to the old "you/your" heuristic.
    const base = CATEGORY_TYPE[cls.baseCategory];
    if (base && base.type !== 'legacy' && base.type !== 'speech' && base.type !== 'whisper') return base;
    const isSelf = /\byou(?:r)?\b/i.test(raw) && !/\bhits? you\b/i.test(raw);
    return { type: 'attack', source: isSelf ? PLAYER_SOURCE : CREATURE_SOURCE };
  }

  return CATEGORY_TYPE[cls.category] ?? { type: 'legacy' };
}

/**
 * Convert an unstructured log string into a structured event.
 * Never call this with a value that already has structured metadata.
 */
export function legacyStringToEvent(raw: string, opts: LegacyAdaptOptions = {}): GameLogEvent {
  // Tick divider — a control string, not prose.
  if (raw === '---tick---') {
    return createLogEvent({
      id: opts.id,
      ts: opts.ts,
      type: 'system',
      effectType: 'tick_separator',
      message: '',
      legacy: { raw },
    });
  }

  const message = opts.remoteName ? rewriteLegacyRemote(raw, opts.remoteName) : raw;
  const cls = classifyLogLine(message);
  const { type, source, effectType, severity } = resolveType(message, cls);

  return createLogEvent({
    id: opts.id,
    ts: opts.ts,
    type,
    message,
    source,
    effectType,
    severity,
    crit: cls.isCrit || undefined,
    observed: cls.isRemote || !!opts.remoteName || undefined,
    legacy: { raw: message },
  });
}
