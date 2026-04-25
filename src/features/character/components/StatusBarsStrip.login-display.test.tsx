import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { TooltipProvider } from '@/components/ui/tooltip';
import StatusBarsStrip from './StatusBarsStrip';
import { getEffectiveMaxHp } from '@/lib/game-data';
import type { Character } from '../hooks/useCharacter';

/**
 * Regression coverage for the "HP snap-back on login" issue.
 *
 * Cithrawiel had base max_hp 233 stored on the row, plus +17 HP from gear,
 * giving an effective max of 250. The display must always show the effective
 * max (gear-boosted) so the bar never momentarily shows "hp/233" while hp is
 * actually 250 — which would clip the rendered bar fill > 100%.
 */

function makeCithrawielLike(): Character {
  return {
    id: 'char-cith',
    user_id: 'user-1',
    name: 'Cithrawiel',
    gender: 'female',
    race: 'elf',
    class: 'warrior',
    level: 20,
    xp: 0,
    hp: 250,
    max_hp: 233,
    gold: 0,
    str: 16, dex: 14, con: 18, int: 10, wis: 10, cha: 10,
    ac: 14,
    current_node_id: null,
    unspent_stat_points: 0,
    cp: 50, max_cp: 100,
    mp: 80, max_mp: 100,
    respec_points: 0,
    salvage: 0,
    bhp: 0,
    bhp_trained: {},
  };
}

function renderBars(character: Character, equipmentBonuses: Record<string, number>) {
  return render(
    <TooltipProvider>
      <StatusBarsStrip character={character} equipmentBonuses={equipmentBonuses} />
    </TooltipProvider>,
  );
}

describe('StatusBarsStrip — login display', () => {
  it('uses gear-boosted effective max HP, not base max_hp', () => {
    const character = makeCithrawielLike(); // hp 250, max_hp 233
    const bonuses = { hp: 17 };              // gear adds +17 HP
    const expectedMax = getEffectiveMaxHp(character.class, character.con, character.level, bonuses);

    renderBars(character, bonuses);

    // Readout must show "<hp>/<effective max>", and effective max >= hp
    expect(expectedMax).toBeGreaterThanOrEqual(character.hp);
    expect(screen.getByText(`${character.hp}/${expectedMax}`)).toBeInTheDocument();
  });

  it('never displays a max lower than current hp (no clipped bar)', () => {
    const character = makeCithrawielLike();
    const bonuses = { hp: 17 };
    const expectedMax = getEffectiveMaxHp(character.class, character.con, character.level, bonuses);

    renderBars(character, bonuses);

    // Specifically: must NOT render the broken "250/233" string the bug produced.
    expect(screen.queryByText(`${character.hp}/${character.max_hp}`)).not.toBeInTheDocument();
    expect(expectedMax).toBeGreaterThanOrEqual(character.hp);
  });

  it('renders without crashing during the brief login frame before inventory loads', () => {
    // Edge case: bonuses object is empty for one frame on login. The component
    // should still render sensibly — using base max_hp as the effective cap.
    const character = makeCithrawielLike();
    // Ensure hp is not above whatever the base effective max would be in this case
    character.hp = character.max_hp; // 233/233 — the cosmetic-but-acceptable frame
    const bonuses = {};
    const expectedMax = getEffectiveMaxHp(character.class, character.con, character.level, bonuses);

    expect(() => renderBars(character, bonuses)).not.toThrow();
    expect(screen.getByText(`${character.hp}/${expectedMax}`)).toBeInTheDocument();
  });
});
