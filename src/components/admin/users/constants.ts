export interface AdminInventoryItem {
  id: string;
  character_id: string;
  item_id: string;
  equipped_slot: string | null;
  current_durability: number;
  item: {
    id: string;
    name: string;
    description: string;
    item_type: string;
    rarity: string;
    slot: string | null;
    stats: Record<string, number>;
    value: number;
    max_durability: number;
    hands: number | null;
    illustration_url?: string | null;
  };
}

export interface AdminCharacter {
  id: string;
  name: string;
  gender: 'male' | 'female';
  level: number;
  class: string;
  race: string;
  hp: number;
  max_hp: number;
  gold: number;
  current_node_id: string | null;
  str: number;
  dex: number;
  con: number;
  int: number;
  wis: number;
  cha: number;
  ac: number;
  xp: number;
  cp: number;
  max_cp: number;
  unspent_stat_points: number;
  inventory: AdminInventoryItem[];
}

export interface AdminUser {
  id: string;
  email: string;
  created_at: string;
  last_sign_in_at: string | null;
  email_confirmed_at: string | null;
  banned_until: string | null;
  role: string;
  profile: { display_name: string | null } | null;
  characters: AdminCharacter[];
}

export interface CharacterEdits {
  name?: string;
  gold?: number;
  level?: number;
  gender?: 'male' | 'female';
}

export interface AdminNode {
  id: string;
  name: string;
  region_id: string;
  region_name: string;
  area_id?: string | null;
  is_inn?: boolean;
  is_vendor?: boolean;
  is_blacksmith?: boolean;
  is_teleport?: boolean;
  is_trainer?: boolean;
}

export const RARITY_COLORS: Record<string, string> = {
  common: 'text-foreground',
  uncommon: 'text-elvish',
  unique: 'text-primary text-glow',
  soulforged: 'text-soulforged text-glow-soulforged',
};

export const STAT_FULL_NAMES: Record<string, string> = {
  str: 'Strength', dex: 'Dexterity', con: 'Constitution',
  int: 'Intelligence', wis: 'Wisdom', cha: 'Charisma',
};

export const STAT_DESCRIPTIONS: Record<string, string> = {
  str: 'Autoattack damage, damage floor, shield block amount',
  dex: 'Autoattack to-hit, AC, crit range, shield block chance, MP pool',
  con: 'Maximum HP',
  int: 'Bonus to-hit on attacks (sqrt curve, capped at +5)',
  wis: 'Maximum CP pool and anti-crit chance vs incoming hits',
  cha: 'Vendor buy/sell prices and bonus gold from humanoid kills',
};

export const SLOT_LABELS: Record<string, string> = {
  main_hand: 'Main Hand', off_hand: 'Off Hand',
  head: 'Head', amulet: 'Amulet', shoulders: 'Shoulders', chest: 'Chest',
  gloves: 'Gloves', belt: 'Belt', pants: 'Pants', ring: 'Ring', trinket: 'Trinket',
  boots: 'Boots',
};

export const EVENT_TYPE_ICONS: Record<string, string> = {
  login: '🔑', combat_kill: '⚔️', combat_death: '💀', level_up: '🎉',
  item_found: '🔍', item_loot: '💰', move: '🚶', search: '🔎',
  party: '👥', vendor: '🛒', blacksmith: '🔨', revive: '💫',
  admin: '🛡️', general: '📝',
};

export const EVENT_TYPE_COLORS: Record<string, string> = {
  combat_kill: 'text-chart-2', combat_death: 'text-destructive', level_up: 'text-primary',
  item_found: 'text-dwarvish', item_loot: 'text-primary', admin: 'text-chart-2',
};

export const EVENT_TYPE_CATEGORIES: Record<string, string[]> = {
  Combat: ['combat_kill', 'combat_death'],
  Movement: ['move'],
  Items: ['item_found', 'item_loot', 'vendor', 'blacksmith', 'search'],
  Admin: ['admin', 'revive'],
  Social: ['party', 'login'],
};

export const ROLE_BADGE_COLORS: Record<string, string> = {
  overlord: 'bg-primary/20 text-primary border-primary/40',
  steward: 'bg-chart-2/20 text-chart-2 border-chart-2/40',
  player: 'bg-muted text-muted-foreground border-border',
};

export function formatRelativeTime(dateStr: string | null): string {
  if (!dateStr) return '—';
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diffMs = now - then;
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(dateStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export function formatDate(d: string | null): string {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

export function formatDateGroup(dateStr: string): string {
  const date = new Date(dateStr);
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);

  if (date.toDateString() === today.toDateString()) return 'Today';
  if (date.toDateString() === yesterday.toDateString()) return 'Yesterday';
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}
