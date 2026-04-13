import { useState, useEffect } from 'react';
import { Character } from '@/features/character';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { getXpForLevel, getMaxCp, getMaxMp } from '@/lib/game-data';

// Duration constants for buff background calculation (in ms)
const BUFF_DURATIONS: Record<string, number> = {
  Food: 300_000, 'Eagle Eye': 30_000, 'Battle Cry': 30_000, Envenom: 30_000, 'Arcane Surge': 25_000, 'Cloak of Shadows': 15_000, Ignite: 30_000, 'Force Shield': 20_000, Crescendo: 25_000, 'Purifying Light': 25_000,
};

export interface StatusBarsStripProps {
  character: Character;
  equipmentBonuses: Record<string, number>;
  inventoryCount?: number;
  isAtInn?: boolean;
  
  regenTick?: boolean;
  baseRegen?: number;
  itemHpRegen?: number;
  foodBuff?: { flatRegen: number; expiresAt: number };
  critBuff?: { bonus: number; expiresAt: number };
  battleCryBuff?: { damageReduction: number; critReduction: number; expiresAt: number } | null;
  poisonBuff?: { expiresAt: number } | null;
  damageBuff?: { expiresAt: number } | null;
  evasionBuff?: { dodgeChance: number; expiresAt: number; source?: 'cloak' | 'disengage' } | null;
  igniteBuff?: { expiresAt: number } | null;
  absorbBuff?: { shieldHp: number; expiresAt: number } | null;
  partyRegenBuff?: { healPerTick: number; expiresAt: number; source?: 'healer' | 'bard' } | null;
  focusStrikeBuff?: { bonusDmg: number } | null;
  stealthBuff?: { expiresAt: number } | null;
}

function ActiveBuffs({ isAtInn, foodBuff, critBuff, battleCryBuff, poisonBuff, damageBuff, evasionBuff, igniteBuff, absorbBuff, partyRegenBuff, focusStrikeBuff, stealthBuff }: Omit<StatusBarsStripProps, 'character' | 'equipmentBonuses' | 'regenTick' | 'baseRegen' | 'itemHpRegen'>) {
  const [now, setNow] = useState(Date.now());
  const foodActive = foodBuff && now < foodBuff.expiresAt;
  const critActive = critBuff && now < critBuff.expiresAt;
  const acActive = battleCryBuff && now < battleCryBuff.expiresAt;
  const poisonActive = poisonBuff && now < poisonBuff.expiresAt;
  const dmgBuffActive = damageBuff && now < damageBuff.expiresAt;
  const evasionActive = evasionBuff && now < evasionBuff.expiresAt;
  const igniteActive = igniteBuff && now < igniteBuff.expiresAt;
  const absorbActive = absorbBuff && now < absorbBuff.expiresAt;
  const partyRegenActive = partyRegenBuff && now < partyRegenBuff.expiresAt;
  const stealthActive = stealthBuff && now < stealthBuff.expiresAt;

  useEffect(() => {
    if (!foodActive && !isAtInn && !critActive && !acActive && !poisonActive && !dmgBuffActive && !evasionActive && !igniteActive && !absorbActive && !partyRegenActive && !stealthActive) return;
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, [foodActive, isAtInn, critActive, acActive, poisonActive, dmgBuffActive, evasionActive, igniteActive, absorbActive, partyRegenActive, stealthActive]);

  const buffs: { emoji: string; label: string; detail: string; color: string; bgColor: string; pct: number }[] = [];

  if (isAtInn) buffs.push({ emoji: '🏨', label: 'Inn Rest', detail: '+10 regen', color: 'text-elvish', bgColor: 'bg-elvish/15', pct: 100 });

  if (foodActive) {
    const dur = BUFF_DURATIONS['Food'] || 120_000;
    const pct = Math.max(0, Math.min(100, ((foodBuff!.expiresAt - now) / dur) * 100));
    buffs.push({ emoji: '🍞', label: 'Food', detail: `+${foodBuff!.flatRegen} regen`, color: 'text-elvish', bgColor: 'bg-elvish/15', pct });
  }

  if (critActive) {
    const dur = BUFF_DURATIONS['Eagle Eye'] || 30_000;
    const pct = Math.max(0, Math.min(100, ((critBuff!.expiresAt - now) / dur) * 100));
    buffs.push({ emoji: '🦅', label: 'Eagle Eye', detail: `Crit ${20 - critBuff!.bonus}-20`, color: 'text-primary', bgColor: 'bg-primary/15', pct });
  }

  if (acActive) {
    const dur = BUFF_DURATIONS['Battle Cry'] || 30_000;
    const pct = Math.max(0, Math.min(100, ((battleCryBuff!.expiresAt - now) / dur) * 100));
    buffs.push({ emoji: '📯', label: 'Battle Cry', detail: `DR ${Math.round(battleCryBuff!.damageReduction * 100)}%`, color: 'text-dwarvish', bgColor: 'bg-dwarvish/15', pct });
  }

  if (poisonActive) {
    const dur = BUFF_DURATIONS['Envenom'] || 30_000;
    const pct = Math.max(0, Math.min(100, ((poisonBuff!.expiresAt - now) / dur) * 100));
    buffs.push({ emoji: '🧪', label: 'Envenom', detail: '40% poison proc', color: 'text-elvish', bgColor: 'bg-elvish/15', pct });
  }

  if (dmgBuffActive) {
    const dur = BUFF_DURATIONS['Arcane Surge'] || 25_000;
    const pct = Math.max(0, Math.min(100, ((damageBuff!.expiresAt - now) / dur) * 100));
    buffs.push({ emoji: '✨', label: 'Arcane Surge', detail: '1.5× spell dmg', color: 'text-elvish', bgColor: 'bg-elvish/15', pct });
  }

  if (evasionActive) {
    const isDisengage = evasionBuff!.source === 'disengage';
    const dur = isDisengage ? 8_000 : (BUFF_DURATIONS['Cloak of Shadows'] || 15_000);
    const pct = Math.max(0, Math.min(100, ((evasionBuff!.expiresAt - now) / dur) * 100));
    buffs.push({ emoji: isDisengage ? '🦘' : '🌫️', label: isDisengage ? 'Disengage' : 'Cloak of Shadows', detail: isDisengage ? '100% dodge + next hit bonus' : '50% dodge', color: isDisengage ? 'text-accent' : 'text-primary', bgColor: isDisengage ? 'bg-accent/15' : 'bg-primary/15', pct });
  }

  if (igniteActive) {
    const dur = BUFF_DURATIONS['Ignite'] || 30_000;
    const pct = Math.max(0, Math.min(100, ((igniteBuff!.expiresAt - now) / dur) * 100));
    buffs.push({ emoji: '🔥🔥', label: 'Ignite', detail: '40% burn proc', color: 'text-dwarvish', bgColor: 'bg-dwarvish/15', pct });
  }

  if (absorbActive) {
    const dur = BUFF_DURATIONS['Force Shield'] || 20_000;
    const pct = Math.max(0, Math.min(100, ((absorbBuff!.expiresAt - now) / dur) * 100));
    buffs.push({ emoji: '🛡️✨', label: 'Force Shield', detail: `${absorbBuff!.shieldHp} HP`, color: 'text-primary', bgColor: 'bg-primary/15', pct });
  }

  if (partyRegenActive) {
    const isHealer = partyRegenBuff!.source === 'healer';
    const dur = BUFF_DURATIONS[isHealer ? 'Purifying Light' : 'Crescendo'] || 25_000;
    const pct = Math.max(0, Math.min(100, ((partyRegenBuff!.expiresAt - now) / dur) * 100));
    buffs.push({ emoji: isHealer ? '✨💚' : '🎶✨', label: isHealer ? 'Purifying Light' : 'Crescendo', detail: `+${partyRegenBuff!.healPerTick} HP/2s`, color: 'text-elvish', bgColor: 'bg-elvish/15', pct });
  }

  if (focusStrikeBuff) {
    buffs.push({ emoji: '🎯', label: 'Focus Strike', detail: `+${focusStrikeBuff.bonusDmg} dmg`, color: 'text-primary', bgColor: 'bg-primary/15', pct: 100 });
  }

  if (stealthActive) {
    const dur = 20_000; // max ~20s duration for Shadowstep
    const pct = Math.max(0, Math.min(100, ((stealthBuff!.expiresAt - now) / dur) * 100));
    buffs.push({ emoji: '🌑', label: 'Shadowstep', detail: 'Stealth + ambush bonus', color: 'text-primary', bgColor: 'bg-primary/15', pct });
  }

  return (
    <div className="flex flex-wrap gap-1 justify-center items-center min-h-[22px]">
      {buffs.length === 0 && <span className="text-[9px] text-muted-foreground/40 italic font-display tracking-wide">No active buffs</span>}
      {buffs.map(b => (
        <Tooltip key={b.label}>
          <TooltipTrigger asChild>
            <span className={`relative inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded border border-border overflow-hidden text-xs font-display ${b.color} cursor-default`}>
              <span className={`absolute inset-0 ${b.bgColor} origin-left transition-transform duration-1000 ease-linear`} style={{ transform: `scaleX(${b.pct / 100})` }} />
              <span className="relative z-10">{b.emoji}</span>
            </span>
          </TooltipTrigger>
          <TooltipContent side="top" className="text-xs">
            <span className="font-display">{b.label}</span> — {b.detail}
          </TooltipContent>
        </Tooltip>
      ))}
    </div>
  );
}

export default function StatusBarsStrip({
  character, equipmentBonuses, inventoryCount: _inventoryCount = 0, isAtInn, regenTick, baseRegen: _baseRegen = 1, itemHpRegen: _itemHpRegen = 0,
  foodBuff, critBuff, battleCryBuff, poisonBuff, damageBuff, evasionBuff, igniteBuff, absorbBuff, partyRegenBuff, focusStrikeBuff, stealthBuff,
}: StatusBarsStripProps) {
  // Use authoritative base max from server to avoid display-then-snap-down
  const effectiveMaxHp = character.max_hp;
  const hpPercent = Math.round((character.hp / effectiveMaxHp) * 100);
  const cp = character.cp ?? 100;
  const intWithGear = character.int + (equipmentBonuses.int || 0);
  const wisWithGear = character.wis + (equipmentBonuses.wis || 0);
  const chaWithGear = character.cha + (equipmentBonuses.cha || 0);
  const maxCp = getMaxCp(character.level, intWithGear, wisWithGear, chaWithGear);
  const cpPercent = Math.round((cp / maxCp) * 100);
  const mp = character.mp ?? 100;
  const dexWithGear = character.dex + (equipmentBonuses.dex || 0);
  const maxMp = getMaxMp(character.level, dexWithGear);
  const mpPercent = Math.round((mp / maxMp) * 100);
  const xpForNext = getXpForLevel(character.level);
  const xpPercent = Math.round((character.xp / xpForNext) * 100);


  return (
    <div className="space-y-1">
      {/* HP + CP + Stamina in a compact row */}
      <div className="grid grid-cols-3 gap-2">
        {/* HP */}
        <div>
          <div className="flex justify-between text-[10px] mb-0.5">
            <span className="text-muted-foreground">HP</span>
            <span className="flex items-center gap-0.5">
              {regenTick && <span className="text-[9px] text-elvish animate-fade-in font-display">+</span>}
              <span className="text-blood tabular-nums">{character.hp}/{effectiveMaxHp}</span>
            </span>
          </div>
          <div className={`h-1.5 bg-background rounded-full overflow-hidden border transition-all duration-300 ${regenTick ? 'border-elvish shadow-[0_0_6px_hsl(var(--elvish)/0.5)]' : 'border-border'}`}>
            <div className="h-full transition-all duration-500 rounded-full" style={{
              width: `${hpPercent}%`,
              background: hpPercent > 50 ? 'hsl(var(--elvish))' : hpPercent > 25 ? 'hsl(var(--gold))' : 'hsl(var(--blood))',
            }} />
          </div>
        </div>

        {/* CP */}
        <div>
          <div className="flex justify-between text-[10px] mb-0.5">
            <span className="text-muted-foreground">CP</span>
            <span className="text-[hsl(var(--primary))] tabular-nums">{cp}/{maxCp}</span>
          </div>
          <div className="h-1.5 bg-background rounded-full overflow-hidden border border-border">
            <div className="h-full transition-all duration-500 rounded-full" style={{
              width: `${cpPercent}%`,
              background: 'linear-gradient(90deg, hsl(var(--primary) / 0.7), hsl(var(--primary)))',
            }} />
          </div>
        </div>

        {/* Stamina */}
        <div>
          <div className="flex justify-between text-[10px] mb-0.5">
            <span className="text-muted-foreground">MP</span>
            <span className="text-dwarvish tabular-nums">{mp}/{maxMp}</span>
          </div>
          <div className="h-1.5 bg-background rounded-full overflow-hidden border border-border">
            <div className="h-full transition-all duration-500 rounded-full" style={{
              width: `${mpPercent}%`,
              background: 'linear-gradient(90deg, hsl(var(--dwarvish) / 0.7), hsl(var(--dwarvish)))',
            }} />
          </div>
        </div>
      </div>

      {/* XP bar — thinner */}
      <div>
        <div className="flex justify-between text-[9px] mb-0.5">
          <span className="text-muted-foreground">XP</span>
          <div className="flex items-center gap-2">
            {(character.salvage ?? 0) > 0 && (
              <span className="text-dwarvish tabular-nums">🔩 {character.salvage}</span>
            )}
            {character.level >= 30 && (
              <span className="text-gold tabular-nums">🏋️ {character.bhp || 0} BHP</span>
            )}
            <span className="text-primary tabular-nums">{character.xp}/{xpForNext}</span>
          </div>
        </div>
        <div className="h-1 bg-background rounded-full overflow-hidden border border-border">
          <div className="h-full bg-primary transition-all duration-500 rounded-full" style={{ width: `${xpPercent}%` }} />
        </div>
      </div>

      {/* Buffs */}
      <ActiveBuffs
        isAtInn={isAtInn} foodBuff={foodBuff} critBuff={critBuff}
        battleCryBuff={battleCryBuff} poisonBuff={poisonBuff} damageBuff={damageBuff} evasionBuff={evasionBuff}
        igniteBuff={igniteBuff} absorbBuff={absorbBuff} partyRegenBuff={partyRegenBuff} focusStrikeBuff={focusStrikeBuff}
        stealthBuff={stealthBuff}
      />
    </div>
  );
}
