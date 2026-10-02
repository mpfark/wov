import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { TooltipProvider } from '@/components/ui/tooltip';
import StatusBarsStrip from './StatusBarsStrip';
import { getEffectiveMaxHp } from '@/lib/game-data';
import type { Character } from '../hooks/useCharacter';

/**
 * Regression coverage for the "HP snap-back on login" issue.
 *
 * Cithrawiel had a base max_hp stored on the row, plus +17 HP from gear.
 * The display must always show the gear-boosted effective max so the bar
 * never momentarily shows "<gear-boosted hp>/<base max>" — which would
 * clip the rendered fill and (combined with the DB-clamp bug) cause hp
 * to snap back to base every regen tick.
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
    hp: 0,        // filled in per test from the formula
    max_hp: 0,    // filled in per test from the formula
    gold: 0,
    str: 16, dex: 14, con: 18, int: 10, wis: 10, cha: 10,
    ac: 14,
    current_node_id: null,
    unspent_stat_points: 0,
    cp: 50, max_cp: 100,
    mp: 80, max_mp: 100,
    respec_points: 0,
    
    bhp: 0,
    bhp_trained: {},
    rp_total_earned: 0,
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
  it('retains shared food/inn presentation without reviving legacy combat buffs during Combat2 ownership', () => {
    render(<TooltipProvider><StatusBarsStrip character={makeCithrawielLike()} equipmentBonuses={{}}
      isAtInn foodBuff={{ flatRegen: 2, expiresAt: Date.now() + 30_000 }}
      poisonBuff={{ expiresAt: Date.now() + 30_000 }} authoritativeEffects={[]} authoritativeWard={null}
    /></TooltipProvider>);
    expect(screen.getByText('Food')).toBeInTheDocument();
    expect(screen.getByText('Inn Rest')).toBeInTheDocument();
    expect(screen.queryByText('Envenom')).not.toBeInTheDocument();
  });
  it('uses delivered persistent ward and stance identity, never legacy JSON/local absorbs or a fabricated full ward', () => {
    const character = { ...makeCithrawielLike(), stance_state: { force_shield_hp: 99 } } as Character;
    const props = { character, equipmentBonuses: {}, reservedBuffs: { force_shield: { reserved: 10 } },
      absorbBuff: { shieldHp: 88, shieldCap: 88, expiresAt: Date.now() + 30_000 },
      authoritativeEffects: [], authoritativeWard: 3 as number | null,
      authoritativeStances: [{ abilityKey: 'force_shield', reservePct: 0.1, reservedCp: 10, state: { ward_remaining: 3 }, version: 1 }],
    };
    const { rerender } = render(<TooltipProvider><StatusBarsStrip {...props} /></TooltipProvider>);
    expect(screen.getByText('3 ward HP')).toBeInTheDocument();
    expect(screen.getByText('Force Shield')).toBeInTheDocument();
    expect(screen.queryByText(/99|88\/88|regenerating/)).not.toBeInTheDocument();
    rerender(<TooltipProvider><StatusBarsStrip {...props} authoritativeWard={7} /></TooltipProvider>);
    expect(screen.getByText('7 ward HP')).toBeInTheDocument();
    rerender(<TooltipProvider><StatusBarsStrip {...props} authoritativeWard={null} authoritativeStances={[]} /></TooltipProvider>);
    expect(screen.queryByText(/ward HP|Force Shield/)).not.toBeInTheDocument();
  });
  it('uses gear-boosted effective max HP, not base max_hp', () => {
    const character = makeCithrawielLike();
    const baseMax = getEffectiveMaxHp(character.class, character.con, character.level, {});
    const bonuses = { hp: 17 };
    const effectiveMax = getEffectiveMaxHp(character.class, character.con, character.level, bonuses);

    character.max_hp = baseMax;       // what's persisted on the row
    character.hp = effectiveMax;      // regen reached the gear-boosted cap

    expect(effectiveMax).toBeGreaterThan(baseMax); // sanity: gear actually boosted

    renderBars(character, bonuses);

    expect(screen.getByText(`${character.hp}/${effectiveMax}`)).toBeInTheDocument();
  });

  it('never displays a max lower than current hp (no clipped bar)', () => {
    const character = makeCithrawielLike();
    const baseMax = getEffectiveMaxHp(character.class, character.con, character.level, {});
    const bonuses = { hp: 17 };
    const effectiveMax = getEffectiveMaxHp(character.class, character.con, character.level, bonuses);

    character.max_hp = baseMax;
    character.hp = effectiveMax;

    renderBars(character, bonuses);

    // Must NOT render the broken "<effectiveMax>/<baseMax>" string the bug produced.
    expect(screen.queryByText(`${character.hp}/${character.max_hp}`)).not.toBeInTheDocument();
    expect(effectiveMax).toBeGreaterThanOrEqual(character.hp);
  });

  it('renders without crashing during the brief login frame before inventory loads', () => {
    // Edge case: bonuses object is empty for one frame on login. The component
    // falls back to base max_hp as the effective cap and shouldn't crash.
    const character = makeCithrawielLike();
    const baseMax = getEffectiveMaxHp(character.class, character.con, character.level, {});
    character.max_hp = baseMax;
    character.hp = baseMax; // base/base — cosmetic but acceptable
    const bonuses = {};
    const expectedMax = getEffectiveMaxHp(character.class, character.con, character.level, bonuses);

    expect(() => renderBars(character, bonuses)).not.toThrow();
    expect(screen.getByText(`${character.hp}/${expectedMax}`)).toBeInTheDocument();
  });

  it('preserves legacy effects unless an authoritative Combat2 collection owns the seam', () => {
    const character = makeCithrawielLike();
    character.hp = character.max_hp = getEffectiveMaxHp(character.class, character.con, character.level, {});
    const legacy = render(
      <TooltipProvider>
        <StatusBarsStrip character={character} equipmentBonuses={{}} poisonBuff={{ expiresAt: Date.now() + 30_000 }} />
      </TooltipProvider>,
    );
    expect(screen.getByText('Envenom')).toBeInTheDocument();
    legacy.unmount();

    render(
      <TooltipProvider>
        <StatusBarsStrip character={character} equipmentBonuses={{}} poisonBuff={{ expiresAt: Date.now() + 30_000 }} authoritativeEffects={[]} />
      </TooltipProvider>,
    );
    expect(screen.queryByText('Envenom')).not.toBeInTheDocument();
  });
});
