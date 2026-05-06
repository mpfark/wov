import { WEAPON_TAG_LABELS, CLASS_LABELS } from '@/lib/game-data';

export const RARITY_LABEL: Record<string, string> = {
  common: 'Common',
  uncommon: 'Uncommon',
  rare: 'Rare',
  unique: 'Unique',
  soulforged: 'Soulforged',
};

const ITEM_TYPE_LABEL: Record<string, string> = {
  weapon: 'Weapon',
  armor: 'Armor',
  accessory: 'Accessory',
  consumable: 'Consumable',
  quest: 'Quest Item',
};

const SLOT_LABEL: Record<string, string> = {
  main_hand: 'Main Hand', off_hand: 'Off Hand',
  head: 'Helm', amulet: 'Amulet', shoulders: 'Shoulders', chest: 'Chest',
  gloves: 'Gloves', belt: 'Belt', pants: 'Legs', ring: 'Ring',
  trinket: 'Trinket', boots: 'Boots',
};

export function handsLabel(hands?: number | null): string {
  if (hands === 2) return 'Two-Handed';
  if (hands === 1) return 'One-Handed';
  return '';
}

export interface DisplayItem {
  name: string;
  rarity: string;
  is_soulbound?: boolean;
  item_type: string;
  slot?: string | null;
  hands?: number | null;
  weapon_tag?: string | null;
}

/** Build a header subtitle like "Rare One-Handed Mace" or "Uncommon Helm". */
export function itemSubtitle(item: DisplayItem): string {
  const rarity = item.is_soulbound ? 'Soulforged' : (RARITY_LABEL[item.rarity] || '');
  const parts: string[] = [];
  if (rarity) parts.push(rarity);
  if (item.weapon_tag) {
    const h = handsLabel(item.hands);
    if (h) parts.push(h);
    parts.push(WEAPON_TAG_LABELS[item.weapon_tag] || item.weapon_tag);
  } else if (item.slot && SLOT_LABEL[item.slot]) {
    parts.push(SLOT_LABEL[item.slot]);
  } else {
    parts.push(ITEM_TYPE_LABEL[item.item_type] || item.item_type);
  }
  return parts.join(' ');
}

const STAT_DISPLAY: Record<string, string> = {
  str: 'STR', dex: 'DEX', con: 'CON', int: 'INT', wis: 'WIS', cha: 'CHA',
  hp: 'HP', cp: 'CP', mp: 'MP',
  hp_regen: 'Regen',
  ac: 'AC',
};

export function statLabel(key: string): string {
  return STAT_DISPLAY[key] || key.toUpperCase();
}

export function affinityLabelFor(weaponTag: string | null | undefined, classKey: string | undefined, classWeapons: Record<string, string[]>): string | null {
  if (!weaponTag || !classKey) return null;
  for (const [cls, tags] of Object.entries(classWeapons)) {
    if (tags.includes(weaponTag)) return CLASS_LABELS[cls] || cls;
  }
  return null;
}
