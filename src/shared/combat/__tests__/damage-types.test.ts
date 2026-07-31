import { describe, it, expect } from 'vitest';
import {
  DAMAGE_TYPE_REGISTRY,
  DAMAGE_TYPE_KEYS,
  DAMAGE_TYPE_OPTIONS,
  normalizeDamageType,
  getDamageType,
  damageTypeLabel,
  damageTypeAdjective,
} from '../damage-types';
import { DAMAGE_TYPES, DAMAGE_TYPE_NONE } from '@/components/admin/damage-types';
import { renderFlavor } from '@shared/proc-log-format';

describe('shared damage-type registry', () => {
  it('has unique, lowercase keys with full metadata', () => {
    expect(new Set(DAMAGE_TYPE_KEYS).size).toBe(DAMAGE_TYPE_REGISTRY.length);
    for (const d of DAMAGE_TYPE_REGISTRY) {
      expect(d.key).toBe(d.key.toLowerCase());
      expect(d.label.length).toBeGreaterThan(0);
      expect(d.emoji.length).toBeGreaterThan(0);
      expect(d.adjective.length).toBeGreaterThan(0);
    }
  });

  it('normalizes case, whitespace, none and unknown values', () => {
    expect(normalizeDamageType(' Fire ')).toBe('fire');
    expect(normalizeDamageType('FROST')).toBe('frost');
    expect(normalizeDamageType(DAMAGE_TYPE_NONE)).toBeNull();
    expect(normalizeDamageType('')).toBeNull();
    expect(normalizeDamageType(undefined)).toBeNull();
    expect(normalizeDamageType('sonic')).toBeNull();
  });

  it('renders prose helpers safely for untyped damage', () => {
    expect(damageTypeLabel('holy')).toBe('Holy');
    expect(damageTypeAdjective('holy')).toBe('radiant');
    expect(damageTypeLabel('nope')).toBe('');
    expect(damageTypeAdjective(null)).toBe('');
    expect(getDamageType('shadow')?.emoji).toBe('🌑');
  });

  it('is the only source for the admin dropdown', () => {
    expect(DAMAGE_TYPES).toBe(DAMAGE_TYPE_OPTIONS);
    expect(DAMAGE_TYPES.map(d => d.value)).toEqual([...DAMAGE_TYPE_KEYS]);
  });

  it('feeds the {damage_type} flavor token', () => {
    expect(renderFlavor('{creature} unleashes a {damage_type} {cast} on {target}', {
      creature: 'Vanguard', cast: 'Cataclysm', target: 'you', damageType: 'fire',
    })).toBe('Vanguard unleashes a searing Cataclysm on you');
    expect(renderFlavor('{creature} unleashes a {damage_type} {cast}', {
      creature: 'Vanguard', cast: 'Cataclysm',
    })).toBe('Vanguard unleashes a Cataclysm');
  });
});
