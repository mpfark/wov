import React, { useState, useMemo, useCallback } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Character } from '@/hooks/useCharacter';
import {
  RACE_STATS, CLASS_STATS, CLASS_LEVEL_BONUSES,
  STAT_LABELS, calculateHP, calculateAC,
  getStatModifier, getMaxCp, getMaxMp, getMpRegenRate,
  getBaseRegen, getCpRegenRate, CLASS_PRIMARY_STAT,
  getIntHitBonus, getDexCritBonus, getWisDodgeChance,
  getStrDamageFloor, getChaBuyDiscount, getChaSellMultiplier,
} from '@/lib/game-data';
import { CLASS_COMBAT } from '@/lib/class-abilities';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { RotateCcw, ArrowRight, Check, Minus, Plus } from 'lucide-react';

const STAT_KEYS = ['str', 'dex', 'con', 'int', 'wis', 'cha'] as const;

const STAT_FULL_NAMES: Record<string, string> = {
  str: 'Strength', dex: 'Dexterity', con: 'Constitution',
  int: 'Intelligence', wis: 'Wisdom', cha: 'Charisma',
};

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  character: Character;
  equipmentBonuses: Record<string, number>;
  onCommit: (allocations: Record<string, number>) => void;
}

export default function StatPlannerDialog({ open, onOpenChange, character, equipmentBonuses, onCommit }: Props) {
  // How many points the user plans to add to each stat (0 = no change)
  const [planned, setPlanned] = useState<Record<string, number>>({});

  // Reset when dialog opens
  const handleOpenChange = useCallback((v: boolean) => {
    if (v) setPlanned({});
    onOpenChange(v);
  }, [onOpenChange]);

  const totalSpent = Object.values(planned).reduce((s, v) => s + v, 0);
  const pointsAvailable = character.unspent_stat_points;
  const pointsRemaining = pointsAvailable - totalSpent;

  const addPoint = (stat: string) => {
    if (pointsRemaining <= 0) return;
    setPlanned(p => ({ ...p, [stat]: (p[stat] || 0) + 1 }));
  };

  const removePoint = (stat: string) => {
    if ((planned[stat] || 0) <= 0) return;
    setPlanned(p => ({ ...p, [stat]: (p[stat] || 0) - 1 }));
  };

  // Current stats (no equipment)
  const currentStats = useMemo(() => {
    const s: Record<string, number> = {};
    for (const stat of STAT_KEYS) s[stat] = (character as any)[stat];
    return s;
  }, [character]);

  // Planned stats (no equipment)
  const plannedStats = useMemo(() => {
    const s: Record<string, number> = {};
    for (const stat of STAT_KEYS) s[stat] = currentStats[stat] + (planned[stat] || 0);
    return s;
  }, [currentStats, planned]);

  // Derived stats comparison
  const derived = useMemo(() => {
    const calc = (stats: Record<string, number>) => {
      const eCon = stats.con + (equipmentBonuses.con || 0);
      const eDex = stats.dex + (equipmentBonuses.dex || 0);
      const eInt = stats.int + (equipmentBonuses.int || 0);
      const eWis = stats.wis + (equipmentBonuses.wis || 0);
      const eCha = stats.cha + (equipmentBonuses.cha || 0);
      const eStr = stats.str + (equipmentBonuses.str || 0);

      const maxHp = calculateHP(character.class, eCon) + (character.level - 1) * 5 + (equipmentBonuses.hp || 0);
      const ac = calculateAC(character.class, eDex) + (equipmentBonuses.ac || 0);
      const maxCp = getMaxCp(character.level, eInt, eWis, eCha);
      const maxMp = getMaxMp(character.level, eDex);
      const hpRegen = getBaseRegen(eCon) + (equipmentBonuses.hp_regen || 0);
      const primaryStat = CLASS_PRIMARY_STAT[character.class] || 'con';
      const cpRegen = getCpRegenRate(stats[primaryStat] + (equipmentBonuses[primaryStat] || 0));
      const mpRegen = getMpRegenRate(eDex);

      const combat = CLASS_COMBAT[character.class];
      const atkStat = combat?.stat || 'str';
      const atkMod = getStatModifier(stats[atkStat] + (equipmentBonuses[atkStat] || 0));
      const intHit = getIntHitBonus(eInt);
      const totalHit = atkMod + intHit;
      const milestoneCrit = character.level >= 28 ? 1 : 0;
      const dexCrit = getDexCritBonus(eDex);
      const critRange = (combat?.critRange || 20) - milestoneCrit - dexCrit;
      const wisAwareness = getWisDodgeChance(eWis);
      const strFloor = getStrDamageFloor(eStr);
      const buyDisc = getChaBuyDiscount(eCha);
      const sellMult = getChaSellMultiplier(eCha);

      const dexMod = Math.max(Math.floor((eDex - 10) / 2), 0);
      const atkSpeed = Math.max(Math.round(3000 - Math.sqrt(dexMod) * 350), 1000) / 1000;

      return {
        maxHp, ac, maxCp, maxMp, hpRegen, cpRegen, mpRegen,
        totalHit, critRange, wisAwareness, strFloor, buyDisc, sellMult, atkSpeed,
      };
    };

    return { current: calc(currentStats), planned: calc(plannedStats) };
  }, [currentStats, plannedStats, equipmentBonuses, character]);

  const handleCommit = () => {
    if (totalSpent === 0) return;
    // Filter out zero allocations
    const allocations: Record<string, number> = {};
    for (const [k, v] of Object.entries(planned)) {
      if (v > 0) allocations[k] = v;
    }
    onCommit(allocations);
    handleOpenChange(false);
  };

  const CompRow = ({ label, currentVal, plannedVal, format, lowerIsBetter }: {
    label: string; currentVal: number; plannedVal: number; format?: (v: number) => string; lowerIsBetter?: boolean;
  }) => {
    const fmt = format || ((v: number) => String(v));
    const diff = plannedVal - currentVal;
    const improved = lowerIsBetter ? diff < 0 : diff > 0;
    const worse = lowerIsBetter ? diff > 0 : diff < 0;
    return (
      <div className="flex items-center justify-between text-xs py-0.5">
        <span className="text-muted-foreground">{label}</span>
        <span className="tabular-nums flex items-center gap-1">
          <span>{fmt(currentVal)}</span>
          {diff !== 0 && (
            <>
              <ArrowRight className="w-3 h-3 text-muted-foreground/60" />
              <span className={improved ? 'text-chart-2 font-semibold' : worse ? 'text-destructive font-semibold' : ''}>
                {fmt(plannedVal)}
              </span>
            </>
          )}
        </span>
      </div>
    );
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="font-display">Stat Planner</DialogTitle>
          <DialogDescription>
            Plan your stat allocations before committing. Preview how changes affect your derived stats.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Points remaining */}
          <div className="text-center font-display text-sm">
            <span className={pointsRemaining === 0 ? 'text-muted-foreground' : 'text-primary'}>
              {pointsRemaining}
            </span>
            <span className="text-muted-foreground"> / {pointsAvailable} points remaining</span>
          </div>

          {/* Stat allocation controls */}
          <div className="space-y-1">
            {STAT_KEYS.map(stat => {
              const current = currentStats[stat];
              const add = planned[stat] || 0;
              const final = current + add;
              const effectiveFinal = final + (equipmentBonuses[stat] || 0);
              const mod = getStatModifier(effectiveFinal);

              return (
                <div key={stat} className="flex items-center gap-2 py-1 px-2 rounded hover:bg-accent/30">
                  <span className="font-display text-xs w-24">{STAT_FULL_NAMES[stat]}</span>
                  <span className="text-xs tabular-nums w-6 text-right text-muted-foreground">{current}</span>
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => removePoint(stat)}
                      disabled={add <= 0}
                      className="w-5 h-5 flex items-center justify-center rounded bg-accent/50 hover:bg-accent disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                    >
                      <Minus className="w-3 h-3" />
                    </button>
                    <span className={`text-xs tabular-nums w-6 text-center font-semibold ${add > 0 ? 'text-chart-2' : 'text-muted-foreground'}`}>
                      {add > 0 ? `+${add}` : '–'}
                    </span>
                    <button
                      onClick={() => addPoint(stat)}
                      disabled={pointsRemaining <= 0}
                      className="w-5 h-5 flex items-center justify-center rounded bg-primary/20 hover:bg-primary/40 text-primary disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                    >
                      <Plus className="w-3 h-3" />
                    </button>
                  </div>
                  <span className="text-xs tabular-nums w-6 text-right">{final}</span>
                  <span className="text-[10px] tabular-nums text-muted-foreground w-8 text-right">
                    ({mod >= 0 ? '+' : ''}{mod})
                  </span>
                </div>
              );
            })}
          </div>

          {/* Derived stats preview */}
          {totalSpent > 0 && (
            <div className="border-t border-border pt-3 space-y-2">
              <h4 className="font-display text-[10px] text-muted-foreground/60 uppercase tracking-wider">Impact Preview</h4>

              <div className="space-y-0.5">
                <CompRow label="Max HP" currentVal={derived.current.maxHp} plannedVal={derived.planned.maxHp} />
                <CompRow label="HP Regen" currentVal={derived.current.hpRegen} plannedVal={derived.planned.hpRegen} format={v => `${v}/tick`} />
                <CompRow label="Max CP" currentVal={derived.current.maxCp} plannedVal={derived.planned.maxCp} />
                <CompRow label="CP Regen" currentVal={derived.current.cpRegen} plannedVal={derived.planned.cpRegen} format={v => `${v}/tick`} />
                <CompRow label="Max Stamina" currentVal={derived.current.maxMp} plannedVal={derived.planned.maxMp} />
                <CompRow label="Stamina Regen" currentVal={derived.current.mpRegen} plannedVal={derived.planned.mpRegen} format={v => `${v}/tick`} />
              </div>

              <div className="space-y-0.5">
                <CompRow label="AC" currentVal={derived.current.ac} plannedVal={derived.planned.ac} />
                <CompRow label="Hit Bonus" currentVal={derived.current.totalHit} plannedVal={derived.planned.totalHit} format={v => `+${v}`} />
                <CompRow label="Crit Range" currentVal={derived.current.critRange} plannedVal={derived.planned.critRange} format={v => v === 20 ? '20' : `${v}–20`} lowerIsBetter />
                <CompRow label="Atk Speed" currentVal={derived.current.atkSpeed} plannedVal={derived.planned.atkSpeed} format={v => `${v.toFixed(1)}s`} lowerIsBetter />
                <CompRow label="Min Damage" currentVal={derived.current.strFloor} plannedVal={derived.planned.strFloor} format={v => v > 0 ? `+${v}` : '–'} />
                <CompRow label="Awareness" currentVal={derived.current.wisAwareness} plannedVal={derived.planned.wisAwareness} format={v => v > 0 ? `${Math.round(v * 100)}%` : '–'} />
                <CompRow label="Vendor Discount" currentVal={derived.current.buyDisc} plannedVal={derived.planned.buyDisc} format={v => v > 0 ? `${Math.round(v * 100)}%` : '–'} />
              </div>
            </div>
          )}
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="ghost" size="sm" onClick={() => setPlanned({})} disabled={totalSpent === 0}>
            <RotateCcw className="w-3 h-3 mr-1" /> Reset
          </Button>
          <Button size="sm" onClick={handleCommit} disabled={totalSpent === 0}>
            <Check className="w-3 h-3 mr-1" /> Commit {totalSpent} Point{totalSpent !== 1 ? 's' : ''}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
