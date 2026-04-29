/**
 * combat-text.ts — Pure MUD-style combat text formatter.
 *
 * Owns: tier + flavor sentence construction, damage tier naming, display mode formatting.
 * Constraints: pure, no React, no side effects.
 */

import { CLASS_COMBAT } from './class-abilities';
import { interpolateTemplate } from '@shared/proc-log-format';

// ── Display mode ────────────────────────────────────────────────

export type CombatLogDisplayMode = 'numbers' | 'words' | 'both';

export function getStoredDisplayMode(): CombatLogDisplayMode {
  try {
    const v = localStorage.getItem('combatLogDisplayMode');
    if (v === 'numbers' || v === 'words' || v === 'both') return v;
  } catch {}
  return 'both';
}

export function setStoredDisplayMode(mode: CombatLogDisplayMode) {
  try { localStorage.setItem('combatLogDisplayMode', mode); } catch {}
}

// ── Damage impact tiers (absolute ranges, no verb overlap) ──────

interface DamageTier {
  max: number;
  word: string;
}

const DAMAGE_TIERS: DamageTier[] = [
  { max: 0,   word: 'miss' },
  { max: 5,   word: 'graze' },
  { max: 15,  word: 'nick' },
  { max: 30,  word: 'hit' },
  { max: 50,  word: 'wound' },
  { max: 80,  word: 'maul' },
  { max: 120, word: 'crush' },
  { max: 180, word: 'devastate' },
  { max: 250, word: 'annihilate' },
];

export function getDamageTierWord(damage: number): string {
  for (const tier of DAMAGE_TIERS) {
    if (damage <= tier.max) return tier.word;
  }
  return 'obliterate';
}

// ── Flavor text tables ──────────────────────────────────────────

const DAMAGE_FLAVOR: Record<string, string[]> = {
  graze: ['barely scratching it', 'just nicking it'],
  nick: ['leaving a small mark', 'scratching its surface'],
  hit: ['landing a solid blow', 'striking firmly'],
  wound: ['drawing blood', 'opening a clear wound'],
  maul: ['tearing into it', 'ripping through its defenses'],
  crush: ['hitting with great force', 'battering it'],
  devastate: ['leaving it reeling', 'dealing devastating damage'],
  annihilate: ['leaving it shattered', 'nearly destroying it'],
  obliterate: ['utterly overwhelming it', 'almost destroying it'],
};

const DAMAGE_FLAVOR_YOU: Record<string, string[]> = {
  graze: ['barely scratching you', 'just nicking you'],
  nick: ['leaving a small mark on you', 'scratching you'],
  hit: ['landing a solid blow on you', 'striking you firmly'],
  wound: ['drawing blood', 'opening a clear wound'],
  maul: ['tearing into you', 'ripping through your defenses'],
  crush: ['hitting you with great force', 'battering you'],
  devastate: ['leaving you reeling', 'dealing devastating damage'],
  annihilate: ['leaving you shattered', 'nearly breaking you'],
  obliterate: ['utterly overwhelming you', 'almost destroying you'],
};

// ── Conjugation helper ──────────────────────────────────────────

function conjugateTierWord(word: string): string {
  if (word.endsWith('e')) return word + 's';
  if (word.endsWith('sh') || word.endsWith('ch')) return word + 'es';
  return word + 's';
}

// ── Player attack style verbs (kept as exports for future use) ──

/** Weapon tag → verb sets */
const WEAPON_VERBS: Record<string, string[]> = {
  sword:   ['slash', 'cut', 'cleave'],
  axe:     ['chop', 'hew', 'cleave'],
  dagger:  ['stab', 'pierce', 'shiv'],
  mace:    ['smash', 'crush', 'bludgeon'],
  hammer:  ['smash', 'crush', 'pound'],
  bow:     ['shoot', 'loose an arrow at', 'drive an arrow into'],
  staff:   ['strike', 'crack', 'slam'],
  wand:    ['zap', 'blast', 'channel energy at'],
};

// NOTE (basic-combat-rework v2): basic autoattacks are now weapon-based, so
// the previous "spell-class override" (wizard/healer/bard always cast a spell)
// has been removed. Verbs come from the equipped weapon first, then fall back
// to a generic class verb for narrative variety, then to a generic strike.
const CLASS_ATTACK_VERBS: Record<string, { verbs: string[] }> = {
  wizard:  { verbs: ['strike', 'attack'] },
  healer:  { verbs: ['strike', 'attack'] },
  bard:    { verbs: ['strike', 'attack'] },
  warrior: { verbs: ['swing at', 'strike', 'cleave'] },
  ranger:  { verbs: ['shoot', 'loose an arrow at', 'fire at'] },
  rogue:   { verbs: ['strike from the shadows at', 'stab', 'slice'] },
};

const GENERIC_VERBS = ['strike', 'attack'];

function pickRandom<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

export function resolvePlayerAttackVerb(
  attackerClass?: string,
  weaponTag?: string | null,
): string {
  // Weapon first — autoattack flavor follows the equipped weapon.
  if (weaponTag) {
    const wVerbs = WEAPON_VERBS[weaponTag];
    if (wVerbs) return pickRandom(wVerbs);
  }
  if (attackerClass) {
    const classInfo = CLASS_ATTACK_VERBS[attackerClass];
    if (classInfo) return pickRandom(classInfo.verbs);
  }
  return pickRandom(GENERIC_VERBS);
}

// ── Creature attack style verbs (kept as exports for future use) ──

const CREATURE_VERB_MAP: Record<string, string[]> = {
  wolf:      ['bites', 'snaps at', 'lunges at'],
  warg:      ['bites', 'mauls', 'lunges at'],
  spider:    ['bites', 'stings', 'lunges at'],
  rat:       ['bites', 'gnaws at', 'scratches'],
  snake:     ['bites', 'strikes at', 'lunges at'],
  bear:      ['mauls', 'swipes at', 'claws'],
  troll:     ['smashes', 'clubs', 'bludgeons'],
  ogre:      ['smashes', 'pounds', 'crushes'],
  skeleton:  ['slashes', 'strikes', 'swings at'],
  zombie:    ['claws', 'grabs at', 'bites'],
  bandit:    ['slashes', 'stabs', 'strikes'],
  goblin:    ['stabs', 'slashes', 'swings at'],
  orc:       ['cleaves', 'smashes', 'hacks at'],
  bat:       ['swoops at', 'bites', 'scratches'],
  dragon:    ['bites', 'claws', 'slams'],
  elemental: ['slams', 'blasts', 'crashes into'],
  slime:     ['engulfs', 'oozes onto', 'splashes'],
  ghoul:     ['claws', 'bites', 'rends'],
  wraith:    ['drains', 'touches', 'chills'],
  scorpion:  ['stings', 'snaps at', 'strikes'],
};

const HUMANOID_FALLBACK = ['slashes', 'strikes', 'swings at'];
const GENERIC_CREATURE_VERBS = ['attacks', 'strikes'];

export function resolveCreatureAttackVerb(
  creatureName: string,
  isHumanoid?: boolean,
): string {
  const lower = creatureName.toLowerCase();
  for (const [keyword, verbs] of Object.entries(CREATURE_VERB_MAP)) {
    if (lower.includes(keyword)) return pickRandom(verbs);
  }
  if (isHumanoid) return pickRandom(HUMANOID_FALLBACK);
  return pickRandom(GENERIC_CREATURE_VERBS);
}

// ── Structured event types ──────────────────────────────────────

export interface BossFlavorPayload {
  name: string;
  text: string;
  emoji?: string;
  // `damage_type` is stored for future extensibility (e.g., resistances or UI),
  // but has no effect on combat mechanics in the current implementation.
  damage_type?: string;
}

export interface StructuredAttackEvent {
  type: string;
  message: string;
  attacker_name?: string;
  target_name?: string;
  attacker_class?: string;
  weapon_tag?: string | null;
  damage?: number;
  is_crit?: boolean;
  is_humanoid?: boolean;
  character_id?: string;
  creature_id?: string;
  is_offhand?: boolean;
  boss_flavor?: BossFlavorPayload;
}

// ── Combat event formatting (tier + flavor) ─────────────────────

/**
 * Format a combat event into MUD-style tier + flavor text.
 */
export function formatCombatEvent(
  event: StructuredAttackEvent,
  displayMode: CombatLogDisplayMode,
  localCharacterId: string,
): string {
  if (displayMode === 'numbers') return event.message;

  const isPlayerAttack = (event.type === 'attack_hit' || event.type === 'attack_miss') && event.attacker_name && event.target_name;
  const isCreatureAttack = (event.type === 'creature_hit' || event.type === 'creature_crit' || event.type === 'creature_miss') && event.attacker_name && event.target_name;
  const isOffhand = (event.type === 'offhand_hit' || event.type === 'offhand_miss') && event.attacker_name && event.target_name;

  if (!isPlayerAttack && !isCreatureAttack && !isOffhand) {
    return event.message;
  }

  const emoji = getEventEmoji(event);
  const isLocal = event.character_id === localCharacterId;

  if (isPlayerAttack || isOffhand) {
    return formatPlayerAttack(event, displayMode, isLocal, emoji);
  }
  if (isCreatureAttack) {
    return formatCreatureAttack(event, displayMode, isLocal);
  }

  return event.message;
}

const WEAPON_EMOJI: Record<string, string> = {
  sword: '⚔️', axe: '🪓', mace: '🔨', dagger: '🗡️',
  bow: '🏹', staff: '🪄', wand: '✨',
};

function getEventEmoji(event: StructuredAttackEvent): string {
  if (event.type === 'creature_hit' || event.type === 'creature_crit' || event.type === 'creature_miss') {
    return '';
  }
  if (event.is_offhand) return '🗡️';
  if (event.weapon_tag && WEAPON_EMOJI[event.weapon_tag]) return WEAPON_EMOJI[event.weapon_tag];
  // Fallback to legacy class emoji if weapon tag unknown (older events).
  const classCombat = event.attacker_class ? CLASS_COMBAT[event.attacker_class] : null;
  if (classCombat) return classCombat.emoji;
  return '⚔️';
}

function formatPlayerAttack(
  event: StructuredAttackEvent,
  displayMode: CombatLogDisplayMode,
  isLocal: boolean,
  emoji: string,
): string {
  const target = event.target_name!;
  const isMiss = event.type === 'attack_miss' || event.type === 'offhand_miss';
  const isCrit = !!event.is_crit;
  const damage = event.damage ?? 0;

  if (isMiss) {
    if (isLocal) {
      return `${emoji} You miss ${target}.`;
    }
    return `${emoji} ${event.attacker_name!} misses ${target}.`;
  }

  const tierWord = getDamageTierWord(damage);
  const flavor = pickRandom(DAMAGE_FLAVOR[tierWord] ?? DAMAGE_FLAVOR.hit);
  const dmgSuffix = displayMode === 'both' ? ` [${damage}]` : '';
  const punct = isCrit ? '!' : '.';

  if (isLocal) {
    return `${emoji} You ${tierWord} ${target}, ${flavor}${dmgSuffix}${punct}`;
  }
  return `${emoji} ${event.attacker_name!} ${conjugateTierWord(tierWord)} ${target}, ${flavor}${dmgSuffix}${punct}`;
}

function formatCreatureAttack(
  event: StructuredAttackEvent,
  displayMode: CombatLogDisplayMode,
  isLocal: boolean,
): string {
  const attacker = event.attacker_name!;
  const isMiss = event.type === 'creature_miss';
  const isCrit = !!event.is_crit;
  const damage = event.damage ?? 0;

  if (isMiss) {
    if (isLocal) {
      return `${attacker} misses you.`;
    }
    return `${attacker} misses ${event.target_name!}.`;
  }

  // Boss crit flavor: if present, use themed text instead of tier-word system
  if (isCrit && event.boss_flavor) {
    const bf = event.boss_flavor;
    const emoji = bf.emoji || '';
    const prefix = emoji ? `${emoji} ` : '';
    const dmgSuffix = displayMode === 'both' ? ` [${damage}]` : '';
    const targetLabel = isLocal ? 'you' : event.target_name!;
    // Support %a/%e/%v template variables; fall back to legacy "{creature} {text}" format
    const hasTemplateVars = /%[aev]/.test(bf.text);
    const interpolated = hasTemplateVars
      ? interpolateTemplate(bf.text, attacker, targetLabel, damage)
      : `${attacker} ${bf.text}`;
    return `${prefix}${interpolated}${dmgSuffix}!`;
  }

  const tierWord = getDamageTierWord(damage);
  const dmgSuffix = displayMode === 'both' ? ` [${damage}]` : '';
  const punct = isCrit ? '!' : '.';

  if (isLocal) {
    const flavor = pickRandom(DAMAGE_FLAVOR_YOU[tierWord] ?? DAMAGE_FLAVOR_YOU.hit);
    return `${attacker} ${conjugateTierWord(tierWord)} you, ${flavor}${dmgSuffix}${punct}`;
  }

  const flavor = pickRandom(DAMAGE_FLAVOR[tierWord] ?? DAMAGE_FLAVOR.hit);
  return `${attacker} ${conjugateTierWord(tierWord)} ${event.target_name!}, ${flavor}${dmgSuffix}${punct}`;
}
