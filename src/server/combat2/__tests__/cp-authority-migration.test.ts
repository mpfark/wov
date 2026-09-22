import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const sql = readFileSync('supabase/migrations/20260922100000_int_wis_max_cp_and_combat2_regen.sql','utf8');
const gameLoop = readFileSync('src/features/combat/hooks/useGameLoop.ts', 'utf8');

describe('INT+WIS maximum CP migration', () => {
  it('uses effective INT and WIS with the authoritative clamped formula', () => {
    expect(sql).toContain("(greatest(floor(((c.int+e.bonus_int)-10)/2.0)::int,0)");
    expect(sql).toContain("+greatest(floor(((c.wis+e.bonus_wis)-10)/2.0)::int,0))*3");
    expect(sql).toContain("'sapphire'");
    expect(sql).toContain("'pearl'");
  });
  it('preserves absolute current CP and only clamps above the new maximum', () => {
    expect(sql).toContain('cp=least(greatest(COALESCE(c.cp,0),0),x.new_max_cp)');
    expect(sql).not.toMatch(/(?:^|,)\s*cp\s*=\s*x\.new_max_cp/i);
    expect(sql).not.toMatch(/reserved_buffs\s*=/i);
  });
  it('replaces the future resource-sync authority without broad mutations', () => {
    expect(sql).toContain('CREATE OR REPLACE FUNCTION public.sync_character_resources');
    expect(sql).not.toMatch(/DELETE FROM|TRUNCATE|DROP TABLE/i);
  });
  it('keeps four-second out-of-combat modifiers but sources passive CP from effective WIS', () => {
    expect(gameLoop).toContain('}, 4000);');
    expect(gameLoop).toContain('const wisWithGear = wis + (eqB.wis || 0);');
    expect(gameLoop).toContain('const wisRegen = getCpRegen(wisWithGear);');
    expect(gameLoop).toContain('food.flatRegen * 0.5');
    expect(gameLoop).toContain('wisRegen + foodCpRegen + milestoneCpFlat + innFlat + inspireCp');
    expect(gameLoop).not.toContain('getCpRegen(int');
  });
});
