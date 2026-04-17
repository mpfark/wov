/**
 * Pure MUD-style command parser.
 * Returns a ParsedCommand if the input is a recognized command,
 * or null if it should fall through to chat.
 *
 * Conservative matching: only exact command shapes are intercepted.
 */

export type ParsedCommand =
  | { type: 'move'; direction: string }
  | { type: 'attack'; target?: string }
  | { type: 'search'; target?: string }
  | { type: 'loot'; target?: string; all?: boolean }
  | { type: 'look' }
  | { type: 'summon'; name: string };

// Directions normalize to short compass codes ("N", "NE", etc.) to match
// how node connections store the `direction` field in the database.
const DIRECTION_MAP: Record<string, string> = {
  n: 'N', north: 'N',
  s: 'S', south: 'S',
  e: 'E', east: 'E',
  w: 'W', west: 'W',
  ne: 'NE', northeast: 'NE',
  nw: 'NW', northwest: 'NW',
  se: 'SE', southeast: 'SE',
  sw: 'SW', southwest: 'SW',
};

const ATTACK_VERBS = new Set(['attack', 'kill', 'k']);
const LOOT_VERBS = new Set(['loot', 'pickup', 'get']);

export function parseCommand(input: string): ParsedCommand | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  const lower = trimmed.toLowerCase();
  const parts = lower.split(/\s+/);
  const verb = parts[0];

  // Single-word direction commands
  if (parts.length === 1 && verb in DIRECTION_MAP) {
    return { type: 'move', direction: DIRECTION_MAP[verb] };
  }

  // Single-word look
  if (parts.length === 1 && (verb === 'look' || verb === 'l')) {
    return { type: 'look' };
  }

  // Search — single word or with optional keyword (up to 3 words total)
  if (verb === 'search' && parts.length <= 3) {
    const target = parts.length > 1 ? parts.slice(1).join(' ') : undefined;
    return { type: 'search', target };
  }

  // Attack — single word or with target (up to 4 words total)
  if (ATTACK_VERBS.has(verb) && parts.length <= 4) {
    const target = parts.length > 1 ? parts.slice(1).join(' ') : undefined;
    return { type: 'attack', target };
  }

  // Loot — single word, with 'all', or with target (up to 4 words total)
  if (LOOT_VERBS.has(verb) && parts.length <= 4) {
    if (parts.length === 1) return { type: 'loot' };
    if (parts[1] === 'all' && parts.length === 2) return { type: 'loot', all: true };
    const target = parts.slice(1).join(' ');
    return { type: 'loot', target };
  }

  // Summon — requires at least one argument
  if (verb === 'summon' && parts.length >= 2) {
    const name = parts.slice(1).join(' ');
    return { type: 'summon', name };
  }

  return null;
}
