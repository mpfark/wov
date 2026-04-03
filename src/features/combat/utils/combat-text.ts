/**
 * combat-text.ts — Pure MUD-style combat text formatter.
 *
 * Owns: attack style resolution, damage tier naming, display mode formatting.
 * Constraints: pure, no React, no side effects.
 */

import { CLASS_COMBAT } from './class-abilities';

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

// ── Player attack style verbs ───────────────────────────────────

/** Weapon tag → verb sets (priority 2) */
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

/** Class → explicit attack style verbs (priority 1 for spell-like autoattacks, priority 3 for melee) */
const CLASS_ATTACK_VERBS: Record<string, { verbs: string[]; isSpell: boolean }> = {
  wizard:  { verbs: ['scorch', 'hurl a fireball at', 'blast arcane flame at', 'incinerate'], isSpell: true },
  healer:  { verbs: ['smite', 'channel divine light against', 'strike with holy power'], isSpell: true },
  bard:    { verbs: ['mock', 'lash with cutting words', 'unleash a discordant note at'], isSpell: true },
  warrior: { verbs: ['swing at', 'strike', 'cleave'], isSpell: false },
  ranger:  { verbs: ['shoot', 'loose an arrow at', 'fire at'], isSpell: false },
  rogue:   { verbs: ['strike from the shadows at', 'stab', 'slice'], isSpell: false },
};

const GENERIC_VERBS = ['strike', 'attack'];

function pickRandom<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

/**
 * Resolve the attack verb for a player attack.
 * Priority: explicit spell class > weapon tag > class fallback > generic
 */
export function resolvePlayerAttackVerb(
  attackerClass?: string,
  weaponTag?: string | null,
): string {
  // Priority 1: Spell-based class autoattack overrides everything
  if (attackerClass) {
    const classInfo = CLASS_ATTACK_VERBS[attackerClass];
    if (classInfo?.isSpell) {
      return pickRandom(classInfo.verbs);
    }
  }

  // Priority 2: Weapon tag
  if (weaponTag) {
    const wVerbs = WEAPON_VERBS[weaponTag];
    if (wVerbs) return pickRandom(wVerbs);
  }

  // Priority 3: Non-spell class fallback
  if (attackerClass) {
    const classInfo = CLASS_ATTACK_VERBS[attackerClass];
    if (classInfo) return pickRandom(classInfo.verbs);
  }

  // Priority 4: Generic
  return pickRandom(GENERIC_VERBS);
}

// ── Creature attack style verbs ─────────────────────────────────

/** Lightweight name-keyword → verb map. NOT a full archetype system. */
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

// ── Structured event types (from enriched server data) ──────────

export interface StructuredAttackEvent {
  type: string;
  message: string;  // Fallback
  // Structured fields (optional — absent for old/non-attack events)
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
}

/**
 * Format a combat event into MUD-style text.
 * Returns the original message if structured data is missing or mode is 'numbers'.
 */
export function formatCombatEvent(
  event: StructuredAttackEvent,
  displayMode: CombatLogDisplayMode,
  localCharacterId: string,
): string {
  // Numbers mode: always return raw message
  if (displayMode === 'numbers') return event.message;

  // Only format auto-attack events with structured data
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
    return formatCreatureAttack(event, displayMode, isLocal, emoji);
  }

  return event.message;
}

function getEventEmoji(event: StructuredAttackEvent): string {
  const classCombat = event.attacker_class ? CLASS_COMBAT[event.attacker_class] : null;

  if (event.type === 'creature_hit' || event.type === 'creature_crit' || event.type === 'creature_miss') {
    return '';  // Creature attacks don't get a prefix emoji
  }
  if (event.is_offhand) return '🗡️';
  if (classCombat) return classCombat.emoji;
  return '⚔️';
}

function formatPlayerAttack(
  event: StructuredAttackEvent,
  displayMode: CombatLogDisplayMode,
  isLocal: boolean,
  emoji: string,
): string {
  const attacker = isLocal ? 'You' : event.attacker_name!;
  const target = event.target_name!;
  const isMiss = event.type === 'attack_miss' || event.type === 'offhand_miss';
  const isCrit = !!event.is_crit;
  const damage = event.damage ?? 0;

  if (isMiss) {
    const verb = resolvePlayerAttackVerb(event.attacker_class, event.weapon_tag);
    return `${emoji} ${attacker} ${verb} ${target} — miss!`;
  }

  const verb = resolvePlayerAttackVerb(event.attacker_class, event.weapon_tag);
  const tierWord = getDamageTierWord(damage);
  const critPrefix = isCrit ? 'CRITICAL! ' : '';
  const dmgSuffix = displayMode === 'both' ? ` [${damage}]` : '';
  const punct = isCrit || damage >= 121 ? '!' : '.';

  return `${emoji} ${critPrefix}${attacker} ${verb} ${target}. ${capitalize(tierWord)}${dmgSuffix}${punct}`;
}

function formatCreatureAttack(
  event: StructuredAttackEvent,
  displayMode: CombatLogDisplayMode,
  isLocal: boolean,
  _emoji: string,
): string {
  const attacker = event.attacker_name!;
  const target = isLocal ? 'you' : event.target_name!;
  const isMiss = event.type === 'creature_miss';
  const isCrit = !!event.is_crit;
  const damage = event.damage ?? 0;

  const verb = resolveCreatureAttackVerb(attacker, event.is_humanoid);

  if (isMiss) {
    return `${attacker} ${verb} ${target} — miss!`;
  }

  const tierWord = getDamageTierWord(damage);
  const critPrefix = isCrit ? 'CRITICAL! ' : '';
  const dmgSuffix = displayMode === 'both' ? ` [${damage}]` : '';
  const punct = isCrit || damage >= 121 ? '!' : '.';

  return `${critPrefix}${attacker} ${verb} ${target}. ${capitalize(tierWord)}${dmgSuffix}${punct}`;
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
