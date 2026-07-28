/**
 * event-log-styles.ts — Centralized visual style map for the Event Log.
 *
 * Owns: log-line categorization (color/intensity/emphasis) and number-token
 * extraction. Pure, no React, no side effects.
 *
 * The log STRINGS themselves are produced by combat-text.ts and many gameplay
 * hooks; this module only decides how to render them. Wording is preserved
 * byte-for-byte — we only split off an optional leading icon and an optional
 * trailing damage/heal/block number for stronger emphasis.
 */

export type EventLogCategory =
  | 'player_attack'
  | 'enemy_attack'
  | 'heal'
  | 'holy'
  | 'fire'
  | 'poison'
  | 'bleed'
  | 'shadow'
  | 'buff'
  | 'mitigation'
  | 'loot'
  | 'xp'
  | 'level_up'
  | 'crit'
  | 'kill'
  | 'system'
  | 'whisper'
  | 'speech'
  | 'passive'
  | 'neutral';

export interface EventLogStyle {
  textClass: string;
  iconClass: string;
  numberClass: string;
  emphasis: 'normal' | 'strong';
}

/**
 * Single source of truth for log visuals. All colors come from semantic
 * tokens defined in index.css / tailwind.config.ts — never hex.
 */
export const EVENT_STYLE: Record<EventLogCategory, EventLogStyle> = {
  player_attack: {
    textClass: 'text-log-player',
    iconClass: 'text-log-player/80',
    numberClass: 'text-log-number-damage font-semibold',
    emphasis: 'normal',
  },
  enemy_attack: {
    textClass: 'text-log-enemy',
    iconClass: 'text-log-enemy/80',
    numberClass: 'text-log-number-damage font-semibold',
    emphasis: 'normal',
  },
  heal: {
    textClass: 'text-log-heal',
    iconClass: 'text-log-heal/80',
    numberClass: 'text-log-number-heal font-semibold',
    emphasis: 'normal',
  },
  holy: {
    textClass: 'text-log-holy',
    iconClass: 'text-log-holy/80',
    numberClass: 'text-log-number-heal font-semibold',
    emphasis: 'normal',
  },
  fire: {
    textClass: 'text-log-fire',
    iconClass: 'text-log-fire/80',
    numberClass: 'text-log-number-damage font-semibold',
    emphasis: 'normal',
  },
  poison: {
    textClass: 'text-log-poison',
    iconClass: 'text-log-poison/80',
    numberClass: 'text-log-number-damage font-semibold',
    emphasis: 'normal',
  },
  bleed: {
    textClass: 'text-log-bleed',
    iconClass: 'text-log-bleed/80',
    numberClass: 'text-log-number-damage font-semibold',
    emphasis: 'normal',
  },
  shadow: {
    textClass: 'text-log-shadow',
    iconClass: 'text-log-shadow/80',
    numberClass: 'text-log-number-damage font-semibold',
    emphasis: 'normal',
  },
  buff: {
    textClass: 'text-log-buff',
    iconClass: 'text-log-buff/80',
    numberClass: 'text-log-buff font-semibold',
    emphasis: 'normal',
  },
  mitigation: {
    textClass: 'text-log-mitigation',
    iconClass: 'text-log-mitigation/80',
    numberClass: 'text-log-number-block font-semibold',
    emphasis: 'normal',
  },
  loot: {
    textClass: 'text-log-loot',
    iconClass: 'text-log-loot/80',
    numberClass: 'text-log-loot font-semibold',
    emphasis: 'normal',
  },
  xp: {
    textClass: 'text-log-loot/90',
    iconClass: 'text-log-loot/70',
    numberClass: 'text-log-loot font-semibold',
    emphasis: 'normal',
  },
  level_up: {
    textClass: 'text-primary',
    iconClass: 'text-primary',
    numberClass: 'text-primary font-semibold',
    emphasis: 'strong',
  },
  crit: {
    textClass: 'text-primary log-crit',
    iconClass: 'text-primary',
    numberClass: 'text-primary font-bold',
    emphasis: 'strong',
  },
  kill: {
    textClass: 'text-destructive',
    iconClass: 'text-destructive',
    numberClass: 'text-destructive font-semibold',
    emphasis: 'strong',
  },
  system: {
    textClass: 'text-log-system italic',
    iconClass: 'text-log-system/70',
    numberClass: 'text-log-system',
    emphasis: 'normal',
  },
  whisper: {
    textClass: 'text-log-shadow',
    iconClass: 'text-log-shadow/80',
    numberClass: 'text-log-shadow',
    emphasis: 'normal',
  },
  speech: {
    textClass: 'text-foreground',
    iconClass: 'text-foreground/70',
    numberClass: 'text-foreground',
    emphasis: 'normal',
  },
  passive: {
    textClass: 'text-log-player/70',
    iconClass: 'text-log-player/60',
    numberClass: 'text-log-number-damage/80',
    emphasis: 'normal',
  },
  neutral: {
    textClass: 'text-foreground/80',
    iconClass: 'text-foreground/60',
    numberClass: 'text-foreground font-semibold',
    emphasis: 'normal',
  },
};

export interface ClassifiedLog {
  category: EventLogCategory;
  /** Category before the crit/kill/level-up overrides are applied. */
  baseCategory: EventLogCategory;
  isRemote: boolean;
  isCrit: boolean;
  isKill: boolean;
  isLevelUp: boolean;
}

/**
 * Base categorisation from the line's leading glyph / wording, before the
 * strong overrides (crit / kill / level-up) are applied.
 */
function baseCategoryOf(log: string): EventLogCategory {
  // Loot / XP / rewards.
  if (
    log.startsWith('🏆') ||
    log.includes('Legendary') ||
    log.includes('Soulforged item') ||
    log.includes('Unique item')
  ) {
    return 'loot';
  }
  if (log.startsWith('📈') || log.startsWith('💰') || log.includes('XP') || log.includes('gold')) {
    return 'xp';
  }

  // Communication.
  if (log.startsWith('🤫')) return 'whisper';
  if (log.startsWith('💬')) return 'speech';

  // System / travel / queueing.
  if (log.startsWith('⏳') || log.startsWith('🧭') || log.startsWith('🗺️') || log.startsWith('🚪')) {
    return 'system';
  }

  // Mitigation / shield / block.
  if (
    log.startsWith('🛡️') ||
    log.includes('blocks') ||
    log.includes('absorbs') ||
    log.includes('parries') ||
    log.includes('deflects')
  ) {
    return 'mitigation';
  }

  // Healing / restore.
  if (
    log.startsWith('💚') ||
    log.startsWith('💪') ||
    log.startsWith('💉') ||
    log.includes('restore') ||
    log.includes('recover') ||
    log.includes('heals you')
  ) {
    return 'heal';
  }

  // Holy / radiance / consecration.
  if (
    log.startsWith('✨') ||
    log.startsWith('🕊️') ||
    log.startsWith('🌟') ||
    log.startsWith('🔆') ||
    log.startsWith('⚡') ||
    log.includes('holy damage') ||
    log.includes('Consecrate')
  ) {
    return 'holy';
  }

  // Elemental DoTs / effects.
  if (log.startsWith('🔥') || log.startsWith('🌋')) return 'fire';
  if (log.startsWith('🧪') || log.startsWith('🐍')) return 'poison';
  if (log.startsWith('🩸')) return 'bleed';
  if (log.startsWith('🌑') || log.startsWith('🌫️')) return 'shadow';

  // Buffs / songs / stances.
  if (
    log.startsWith('🎶') ||
    log.startsWith('🌿') ||
    log.startsWith('🔄') ||
    log.startsWith('📯') ||
    log.startsWith('🦅') ||
    log.startsWith('🦘') ||
    log.startsWith('⚜️')
  ) {
    return 'buff';
  }

  // Damage warnings / DoT damage taken / creature attacks.
  if (log.startsWith('⚠️') || log.startsWith('💔') || log.startsWith('👹')) {
    return 'enemy_attack';
  }

  // Player attack glyphs (weapons + class fallbacks).
  if (
    log.startsWith('⚔️') ||
    log.startsWith('🗡️') ||
    log.startsWith('🏹') ||
    log.startsWith('🪓') ||
    log.startsWith('🔨') ||
    log.startsWith('🪄') ||
    log.startsWith('🎯') ||
    log.startsWith('🔪') ||
    log.startsWith('🦘')
  ) {
    return 'player_attack';
  }

  // Generic enemy attack heuristic — text without a leading emoji that
  // mentions damage to "you".
  if (log.includes('damage') && (log.includes(' you') || log.startsWith('You '))) {
    return 'enemy_attack';
  }

  return 'neutral';
}

/**
 * Pure classifier — no allocation beyond the result object.
 *
 * Decision order matters: stronger signals (crit / kill / level-up / loot)
 * win over base category so the renderer can apply the correct emphasis.
 */
export function classifyLogLine(log: string): ClassifiedLog {
  const isRemote = log.includes('(remote)');
  const isCrit = log.includes('CRITICAL!') || log.startsWith('💥');
  const isKill =
    log.startsWith('💀') ||
    log.includes('been defeated') ||
    log.includes('struck down');
  const isLevelUp = log.startsWith('🎉') || log.includes('Level Up') || log.startsWith('✨') || log.startsWith('🌋');

  const baseCategory = baseCategoryOf(log);

  // Strong-emphasis categories win over the base category.
  const category: EventLogCategory =
    isLevelUp ? 'level_up' :
    isKill ? 'kill' :
    isCrit ? 'crit' :
    baseCategory;

  return { category, baseCategory, isRemote, isCrit, isKill, isLevelUp };
}


// ── Token splitter ─────────────────────────────────────────────

const EMOJI_PREFIX_RE =
  /^([\p{Extended_Pictographic}\p{Emoji_Presentation}](?:\uFE0F|\u200D[\p{Extended_Pictographic}\p{Emoji_Presentation}]\uFE0F?)*\s*)+/u;

const NUMBER_TAIL_RE =
  /(\s\[\d+\][.!]?|\s+for\s+\d+\s+(?:[a-z]+\s+)?damage[.!]?|\s+restores\s+\d+\s+(?:HP|MP|CP)(?:\s+to\s+\w+)?[.!]?|\s+blocks\s+\d+\s+damage[.!]?|\s+heals\s+(?:you\s+|\w+\s+)?for\s+\d+[.!]?)$/i;

export interface LogTokens {
  icon: string;
  body: string;
  number: string;
}

/**
 * Split a log line into icon / body / number for structured rendering.
 *
 * Always preserves the original wording: icon + body + number, when joined,
 * equals the input string. If no icon or number is detected, those fields
 * are empty and `body` is the full string.
 */
export function splitLogTokens(log: string): LogTokens {
  let rest = log;
  let icon = '';

  const iconMatch = rest.match(EMOJI_PREFIX_RE);
  if (iconMatch) {
    icon = iconMatch[0].trimEnd();
    rest = rest.slice(iconMatch[0].length);
  }

  let number = '';
  const numMatch = rest.match(NUMBER_TAIL_RE);
  if (numMatch) {
    number = numMatch[0].trimStart();
    rest = rest.slice(0, rest.length - numMatch[0].length);
  }

  return { icon, body: rest, number };
}

// ── Presentation layer ─────────────────────────────────────────
//
// The classifier above stays fine-grained (it is also what routing and
// tests rely on). The *rendered* log collapses those categories into five
// restrained visual families so the panel reads as a scannable narrative
// rather than a colour chart.

export type EventLogFamily =
  | 'action'    // player attacks / abilities
  | 'threat'    // incoming attacks and damage
  | 'support'   // healing, regen, buffs, mitigation
  | 'ambient'   // movement, ordinary loot, narration, unknown/legacy
  | 'notable'   // boss telegraphs, death, quests, rare loot, level gains, errors
  | 'chat';     // speech + whispers (conversational, never combat-styled)

/** Monochrome marker keys — mapped to lucide icons by the renderer. */
export type EventLogMarker =
  | 'kill'
  | 'level_up'
  | 'loot_rare'
  | 'quest'
  | 'telegraph'
  | 'error';

export interface EventLogPresentation {
  family: EventLogFamily;
  /** Left-edge accent class (index.css). */
  edgeClass: string;
  textClass: string;
  numberClass: string;
  strong: boolean;
  /** Brief, one-shot attention treatment. Never a looping pulse. */
  urgent: boolean;
  /** Only ever set for exceptional events; routine lines render icon-free. */
  marker: EventLogMarker | null;
}

const FAMILY_STYLE: Record<EventLogFamily, Omit<EventLogPresentation, 'family' | 'strong' | 'urgent' | 'marker'>> = {
  action: {
    edgeClass: 'log-edge-action',
    textClass: 'text-log-player/90',
    numberClass: 'text-log-number-damage',
  },
  threat: {
    edgeClass: 'log-edge-threat',
    textClass: 'text-log-enemy/90',
    numberClass: 'text-log-number-damage',
  },
  support: {
    edgeClass: 'log-edge-support',
    textClass: 'text-log-heal/90',
    numberClass: 'text-log-number-heal',
  },
  ambient: {
    edgeClass: 'log-edge-ambient',
    textClass: 'text-foreground/70',
    numberClass: 'text-foreground/80',
  },
  notable: {
    edgeClass: 'log-edge-notable',
    textClass: 'text-log-loot',
    numberClass: 'text-log-loot',
  },
  chat: {
    edgeClass: 'log-edge-chat',
    textClass: 'text-foreground',
    numberClass: 'text-foreground',
  },
};

const CATEGORY_FAMILY: Record<EventLogCategory, EventLogFamily> = {
  player_attack: 'action',
  passive: 'action',
  enemy_attack: 'threat',
  fire: 'threat',
  poison: 'threat',
  bleed: 'threat',
  shadow: 'threat',
  heal: 'support',
  holy: 'support',
  buff: 'support',
  mitigation: 'support',
  system: 'ambient',
  xp: 'ambient',
  neutral: 'ambient',
  loot: 'notable',
  level_up: 'notable',
  kill: 'notable',
  crit: 'action',
  whisper: 'chat',
  speech: 'chat',
};

const QUEST_RE = /contract (?:fulfilled|accepted|complete)|quest (?:complete|completed|updated|accepted)/i;
const TELEGRAPH_RE = /begins channeling|flee the node|begins to channel|telegraph/i;
const ERROR_RE = /not enough|no longer valid|failed|cannot |fizzle|unavailable|too far/i;
const PLAYER_DEATH_RE = /you (?:have )?(?:died|been slain|have fallen)|you are dead/i;

/**
 * Single source of truth for how a finished log line is rendered.
 *
 * Takes the raw string so every consumer (event log, chat panel, future
 * filters) derives family/marker/emphasis the same way — no component
 * should re-parse emoji or re-derive colours itself.
 */
export function toPresentation(log: string, classified?: ClassifiedLog): EventLogPresentation {
  const cls = classified ?? classifyLogLine(log);

  const isQuest = QUEST_RE.test(log);
  const isTelegraph = TELEGRAPH_RE.test(log);
  const isError = cls.baseCategory === 'enemy_attack' && log.startsWith('⚠️') && ERROR_RE.test(log);
  const isPlayerDeath = PLAYER_DEATH_RE.test(log);

  let family: EventLogFamily;
  if (isQuest || isTelegraph || isError) {
    family = 'notable';
  } else if (cls.category === 'crit') {
    // Crits are frequent — keep them in their source family, just emphasised.
    family = CATEGORY_FAMILY[cls.baseCategory] ?? 'ambient';
    if (family === 'chat') family = 'ambient';
  } else {
    family = CATEGORY_FAMILY[cls.category] ?? 'ambient';
  }

  let marker: EventLogMarker | null = null;
  if (isTelegraph) marker = 'telegraph';
  else if (isQuest) marker = 'quest';
  else if (isError) marker = 'error';
  else if (cls.isKill || isPlayerDeath) marker = 'kill';
  else if (cls.isLevelUp) marker = 'level_up';
  else if (cls.category === 'loot') marker = 'loot_rare';

  const strong = family === 'notable' || cls.isCrit;
  const urgent = isTelegraph || isPlayerDeath;

  return { family, ...FAMILY_STYLE[family], strong, urgent, marker };
}

