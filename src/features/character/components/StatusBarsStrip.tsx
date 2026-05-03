import { useState, useEffect } from 'react';
import { Character } from '@/features/character';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { getXpForLevel, getEffectiveMaxHp, getEffectiveMaxCp, getEffectiveMaxMp } from '@/lib/game-data';
import { ARCANE_SURGE_DAMAGE_MULT, ARCANE_SURGE_DAMAGE_BONUS_PCT } from '@/shared/formulas/combat';
import { getCpDisplay } from '@/features/combat/utils/cp-display';

// Duration constants for buff background calculation (in ms).
// `Inspire` is intentionally absent — its duration is variable (INT-scaled), so
// the buff itself carries `durationMs` and the bar uses that.
const BUFF_DURATIONS: Record<string, number> = {
  Food: 300_000, 'Eagle Eye': 30_000, 'Battle Cry': 30_000, Envenom: 30_000, 'Arcane Surge': 25_000, 'Cloak of Shadows': 15_000, Ignite: 30_000, 'Force Shield': 20_000, Crescendo: 25_000, 'Purifying Light': 25_000,
  'Holy Shield': 30_000, 'Shield Wall': 4_000, Consecrate: 6_000, 'Divine Challenge': 30_000,
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
  absorbBuff?: { shieldHp: number; shieldCap?: number; expiresAt: number } | null;
  partyRegenBuff?: { healPerTick: number; expiresAt: number; source?: 'healer' | 'bard' } | null;
  stealthBuff?: { expiresAt: number } | null;
  inspireBuff?: { hpPerTick: number; cpPerTick: number; expiresAt: number; durationMs: number; casterId: string } | null;
  holyShieldBuff?: { wisMod: number; expiresAt: number } | null;
  
  consecrateBuff?: { wisMod: number; expiresAt: number; durationMs?: number } | null;
  divineChallengeBuff?: { reduction: number; expiresAt: number } | null;
  /** CP currently reserved by an in-flight queued ability (display-only; server is authoritative). */
  reservedCp?: number;
  /** CP currently locked by active CP-reservation stances (display-only). */
  stanceReservedCp?: number;
  /** Active stance map keyed by stance key. Used to render stance pips. */
  reservedBuffs?: Record<string, { tier: number; reserved: number; activated_at?: number }> | null;
}

function ActiveBuffs({ isAtInn, foodBuff, critBuff, battleCryBuff, poisonBuff, damageBuff, evasionBuff, igniteBuff, absorbBuff, partyRegenBuff, stealthBuff, inspireBuff, holyShieldBuff, shieldWallBuff, consecrateBuff, divineChallengeBuff, forceShieldStance }: Omit<StatusBarsStripProps, 'character' | 'equipmentBonuses' | 'regenTick' | 'baseRegen' | 'itemHpRegen'> & { forceShieldStance?: { shieldHp: number; shieldCap: number; inCombat: boolean } | null }) {
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
  const inspireActive = inspireBuff && now < inspireBuff.expiresAt;
  const holyShieldActive = holyShieldBuff && now < holyShieldBuff.expiresAt;
  const shieldWallActive = shieldWallBuff && now < shieldWallBuff.expiresAt;
  const consecrateActive = consecrateBuff && now < consecrateBuff.expiresAt;
  const divineChallengeActive = divineChallengeBuff && now < divineChallengeBuff.expiresAt;

  useEffect(() => {
    if (!foodActive && !isAtInn && !critActive && !acActive && !poisonActive && !dmgBuffActive && !evasionActive && !igniteActive && !absorbActive && !partyRegenActive && !stealthActive && !inspireActive && !holyShieldActive && !shieldWallActive && !consecrateActive && !divineChallengeActive) return;
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, [foodActive, isAtInn, critActive, acActive, poisonActive, dmgBuffActive, evasionActive, igniteActive, absorbActive, partyRegenActive, stealthActive, inspireActive, holyShieldActive, shieldWallActive, consecrateActive, divineChallengeActive]);

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
    buffs.push({ emoji: '🐍', label: 'Envenom', detail: '40% poison proc', color: 'text-elvish', bgColor: 'bg-elvish/15', pct });
  }

  if (dmgBuffActive) {
    const dur = BUFF_DURATIONS['Arcane Surge'] || 25_000;
    const pct = Math.max(0, Math.min(100, ((damageBuff!.expiresAt - now) / dur) * 100));
    buffs.push({ emoji: '✨', label: 'Arcane Surge', detail: `${ARCANE_SURGE_DAMAGE_MULT}× dmg (+${ARCANE_SURGE_DAMAGE_BONUS_PCT}%)`, color: 'text-elvish', bgColor: 'bg-elvish/15', pct });
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

  // Force Shield: stance takes precedence over the legacy timed absorb buff so
  // the bar reflects current/cap and the OOC regen is visible.
  if (forceShieldStance) {
    const pct = Math.max(0, Math.min(100, (forceShieldStance.shieldHp / Math.max(1, forceShieldStance.shieldCap)) * 100));
    const detail = forceShieldStance.inCombat
      ? `${forceShieldStance.shieldHp} / ${forceShieldStance.shieldCap} HP`
      : `${forceShieldStance.shieldHp} / ${forceShieldStance.shieldCap} HP · regenerating`;
    buffs.push({ emoji: '🛡️✨', label: 'Force Shield', detail, color: 'text-primary', bgColor: 'bg-primary/15', pct });
  } else if (absorbActive) {
    // Divine Aegis — castable absorb ward, no countdown.
    const cap = Math.max(1, absorbBuff!.shieldCap ?? absorbBuff!.shieldHp);
    const pct = Math.max(0, Math.min(100, (absorbBuff!.shieldHp / cap) * 100));
    buffs.push({ emoji: '🛡️💚', label: 'Divine Aegis', detail: `${absorbBuff!.shieldHp} HP`, color: 'text-elvish', bgColor: 'bg-elvish/15', pct });
  }

  if (partyRegenActive) {
    const isHealer = partyRegenBuff!.source === 'healer';
    const dur = BUFF_DURATIONS[isHealer ? 'Purifying Light' : 'Crescendo'] || 25_000;
    const pct = Math.max(0, Math.min(100, ((partyRegenBuff!.expiresAt - now) / dur) * 100));
    buffs.push({ emoji: isHealer ? '✨💚' : '🎶✨', label: isHealer ? 'Purifying Light' : 'Crescendo', detail: `+${partyRegenBuff!.healPerTick} HP/2s`, color: 'text-elvish', bgColor: 'bg-elvish/15', pct });
  }

  if (inspireActive) {
    const dur = inspireBuff!.durationMs || 90_000;
    const pct = Math.max(0, Math.min(100, ((inspireBuff!.expiresAt - now) / dur) * 100));
    buffs.push({
      emoji: '🎶',
      label: 'Inspire',
      detail: `+${inspireBuff!.hpPerTick} HP & +${inspireBuff!.cpPerTick} CP regen`,
      color: 'text-elvish',
      bgColor: 'bg-elvish/15',
      pct,
    });
  }


  if (stealthActive) {
    const dur = 20_000; // max ~20s duration for Shadowstep
    const pct = Math.max(0, Math.min(100, ((stealthBuff!.expiresAt - now) / dur) * 100));
    buffs.push({ emoji: '🌑', label: 'Shadowstep', detail: 'Stealth + ambush bonus', color: 'text-primary', bgColor: 'bg-primary/15', pct });
  }

  if (holyShieldActive) {
    const dur = BUFF_DURATIONS['Holy Shield'] || 30_000;
    const pct = Math.max(0, Math.min(100, ((holyShieldBuff!.expiresAt - now) / dur) * 100));
    buffs.push({ emoji: '🛡️✝️', label: 'Holy Shield', detail: 'Reflects holy damage on attackers', color: 'text-gold', bgColor: 'bg-gold/15', pct });
  }

  if (shieldWallActive) {
    const dur = BUFF_DURATIONS['Shield Wall'] || 4_000;
    const pct = Math.max(0, Math.min(100, ((shieldWallBuff!.expiresAt - now) / dur) * 100));
    buffs.push({ emoji: '🛡️', label: 'Shield Wall', detail: '100% block (requires shield)', color: 'text-dwarvish', bgColor: 'bg-dwarvish/15', pct });
  }

  if (consecrateActive) {
    const dur = consecrateBuff!.durationMs || BUFF_DURATIONS['Consecrate'] || 6_000;
    const pct = Math.max(0, Math.min(100, ((consecrateBuff!.expiresAt - now) / dur) * 100));
    buffs.push({ emoji: '✨🟡', label: 'Consecrate', detail: 'Heals allies, burns enemies on this node', color: 'text-gold', bgColor: 'bg-gold/15', pct });
  }

  if (divineChallengeActive) {
    const dur = BUFF_DURATIONS['Divine Challenge'] || 30_000;
    const pct = Math.max(0, Math.min(100, ((divineChallengeBuff!.expiresAt - now) / dur) * 100));
    buffs.push({ emoji: '⚜️', label: 'Divine Challenge', detail: `${Math.round(divineChallengeBuff!.reduction * 100)}% damage reduction`, color: 'text-gold', bgColor: 'bg-gold/15', pct });
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
  foodBuff, critBuff, battleCryBuff, poisonBuff, damageBuff, evasionBuff, igniteBuff, absorbBuff, partyRegenBuff, stealthBuff, inspireBuff,
  holyShieldBuff, shieldWallBuff, consecrateBuff, divineChallengeBuff,
  reservedCp = 0,
  stanceReservedCp = 0,
  reservedBuffs = null,
}: StatusBarsStripProps) {
  const effectiveMaxHp = getEffectiveMaxHp(character.class, character.con, character.level, equipmentBonuses);
  const hpPercent = Math.round((character.hp / effectiveMaxHp) * 100);
  const rawCp = character.cp ?? 100;
  const maxCp = getEffectiveMaxCp(character.level, character.wis, equipmentBonuses);
  const cpView = getCpDisplay(rawCp, maxCp, reservedCp, stanceReservedCp);
  const cp = cpView.displayedCp;
  const cpPercent = cpView.cpPercent;
  const reservedPercent = cpView.reservedPercent;
  const mp = character.mp ?? 100;
  const maxMp = getEffectiveMaxMp(character.level, character.dex, equipmentBonuses);
  const mpPercent = Math.round((mp / maxMp) * 100);
  const xpForNext = getXpForLevel(character.level);
  const xpPercent = Math.round((character.xp / xpForNext) * 100);

  // ── Force Shield stance shield (persistent ward) ─────────────────
  // While the Force Shield stance is reserved, derive the bar from the
  // server-persisted ward HP on `characters.stance_state.force_shield_hp`
  // (capped by INT_mod + floor(level/2)). This lets the bar render and
  // visibly fill back up while OOC, instead of being driven by a timed
  // local absorb buff.
  const forceShieldStance: { shieldHp: number; shieldCap: number; inCombat: boolean } | null = (() => {
    if (!reservedBuffs || !reservedBuffs.force_shield) return null;
    const intTotal = (character.int ?? 10) + (equipmentBonuses.int ?? 0);
    const intMod = Math.max(0, Math.floor((intTotal - 10) / 2));
    const shieldCap = Math.max(1, intMod + Math.floor((character.level ?? 1) * 0.5));
    const persisted = ((character as any).stance_state && typeof (character as any).stance_state === 'object')
      ? Number((character as any).stance_state.force_shield_hp)
      : NaN;
    // In combat, prefer the live local buff (combat-tick syncs it via buff_sync);
    // OOC, fall back to the persisted value (which the server's regen RPC ticks up).
    const inCombat = !!(absorbBuff && Date.now() < absorbBuff.expiresAt);
    const liveHp = inCombat ? absorbBuff!.shieldHp : (Number.isFinite(persisted) ? persisted : shieldCap);
    return { shieldHp: Math.max(0, Math.min(shieldCap, Math.floor(liveHp))), shieldCap, inCombat };
  })();

  // ── Divine Aegis ward overlay ─────────────────────────────────────
  // Castable absorb shield with no timer — persists until depleted.
  // Only render when Force Shield isn't already showing on the bar.
  const aegisWard: { shieldHp: number; shieldCap: number } | null = (() => {
    if (forceShieldStance) return null;
    if (!absorbBuff || absorbBuff.shieldHp <= 0) return null;
    if (Date.now() >= absorbBuff.expiresAt) return null;
    const cap = Math.max(1, absorbBuff.shieldCap ?? absorbBuff.shieldHp);
    return { shieldHp: Math.max(0, Math.min(cap, Math.floor(absorbBuff.shieldHp))), shieldCap: cap };
  })();

  // Unified ward overlay — Force Shield wins when both could apply.
  const wardOverlay: { shieldHp: number; shieldCap: number; kind: 'force_shield' | 'aegis'; inCombat?: boolean } | null =
    forceShieldStance
      ? { ...forceShieldStance, kind: 'force_shield' }
      : aegisWard
        ? { ...aegisWard, kind: 'aegis' }
        : null;


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
              {wardOverlay && (() => {
                const isFS = wardOverlay.kind === 'force_shield';
                const colorVar = isFS ? 'var(--primary)' : 'var(--elvish)';
                const label = isFS ? 'Force Shield' : 'Divine Aegis';
                const tooltipDetail = isFS
                  ? 'Absorbs damage before HP. Regenerates 1 + INT_mod/2 every 2s while out of combat. Does not regen during combat.'
                  : 'Absorbs damage before HP. Lasts until depleted.';
                const showRegenPulse = isFS && !wardOverlay.inCombat && wardOverlay.shieldHp < wardOverlay.shieldCap;
                return (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span className="ml-1 tabular-nums cursor-help inline-flex items-center gap-0.5" style={{ color: `hsl(${colorVar})` }}>
                        🛡{wardOverlay.shieldHp}/{wardOverlay.shieldCap}
                        {showRegenPulse && (
                          <span className="text-[9px] animate-pulse font-display" style={{ color: `hsl(${colorVar})` }}>+</span>
                        )}
                      </span>
                    </TooltipTrigger>
                    <TooltipContent side="top" className="text-xs">
                      <div><span className="font-display">{label}</span> — {wardOverlay.shieldHp} / {wardOverlay.shieldCap} ward HP</div>
                      <div className="text-muted-foreground">{tooltipDetail}</div>
                    </TooltipContent>
                  </Tooltip>
                );
              })()}
            </span>
          </div>
          <div className={`relative h-1.5 bg-background rounded-full overflow-hidden border transition-all duration-300 ${regenTick ? 'border-elvish shadow-[0_0_6px_hsl(var(--elvish)/0.5)]' : 'border-border'}`}>
            <div className="absolute inset-y-0 left-0 transition-all duration-500 rounded-full" style={{
              width: `${hpPercent}%`,
              background: hpPercent > 50 ? 'hsl(var(--elvish))' : hpPercent > 25 ? 'hsl(var(--gold))' : 'hsl(var(--blood))',
            }} />
            {/* Ward overlay (Force Shield or Divine Aegis) — anchored to right edge of HP fill */}
            {wardOverlay && (() => {
              const isFS = wardOverlay.kind === 'force_shield';
              const colorVar = isFS ? 'var(--primary)' : 'var(--elvish)';
              const capPct = Math.min(100, (wardOverlay.shieldCap / Math.max(1, effectiveMaxHp)) * 100);
              const livePct = Math.min(100, (wardOverlay.shieldHp / Math.max(1, effectiveMaxHp)) * 100);
              const startPct = Math.min(100 - livePct, hpPercent);
              const ghostStartPct = Math.min(100 - capPct, hpPercent);
              const regenPulse = isFS && !wardOverlay.inCombat && wardOverlay.shieldHp < wardOverlay.shieldCap;
              return (
                <>
                  <div className="absolute inset-y-0 transition-all duration-500" style={{
                    left: `${ghostStartPct}%`,
                    width: `${capPct}%`,
                    background: `hsl(${colorVar} / 0.12)`,
                    borderLeft: `1px dashed hsl(${colorVar} / 0.35)`,
                  }} />
                  <div className={`absolute inset-y-0 transition-all duration-500 ${regenPulse ? 'animate-pulse' : ''}`} style={{
                    left: `${startPct}%`,
                    width: `${livePct}%`,
                    background: `hsl(${colorVar} / 0.55)`,
                    boxShadow: `inset 0 0 4px hsl(${colorVar} / 0.6)`,
                  }} />
                </>
              );
            })()}
          </div>
        </div>

        {/* CP */}
        <div>
          <div className="flex justify-between text-[10px] mb-0.5">
            <span className="text-muted-foreground">CP</span>
            <span className="text-[hsl(var(--primary))] tabular-nums">
              {cp}/{maxCp}
              {cpView.stanceShown > 0 && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span className="ml-1 text-soulforged cursor-help">⚓{cpView.stanceShown}</span>
                  </TooltipTrigger>
                  <TooltipContent side="top" className="text-xs">
                    Stance reserved — locked while these stances are active.
                    Dropping a stance frees the slot but does not refund the CP.
                    {reservedBuffs && Object.keys(reservedBuffs).length > 0 && (
                      <div className="mt-1 font-display">
                        {Object.entries(reservedBuffs).map(([k, v]) => (
                          <div key={k}>• {k} (T{v.tier}): -{v.reserved} CP</div>
                        ))}
                      </div>
                    )}
                  </TooltipContent>
                </Tooltip>
              )}
              {reservedPercent > 0 && (
                <span className="ml-1 text-[hsl(var(--primary)/0.5)]">(-{cpView.reservedShown})</span>
              )}
            </span>
          </div>
          <div className="relative h-1.5 bg-background rounded-full overflow-hidden border border-border">
            {/* Usable fill — left-aligned, scales against full max */}
            <div className="absolute top-0 left-0 h-full transition-all duration-500" style={{
              width: `${cpPercent}%`,
              background: 'linear-gradient(90deg, hsl(var(--primary) / 0.7), hsl(var(--primary)))',
            }} />
            {/* Queued ability segment — sits just to the right of fill, inside usable area */}
            {reservedPercent > 0 && (
              <div className="absolute top-0 h-full transition-all duration-300" style={{
                left: `${cpPercent}%`,
                width: `${reservedPercent}%`,
                background: 'hsl(var(--primary) / 0.25)',
                borderLeft: '1px dashed hsl(var(--primary) / 0.6)',
              }} />
            )}
            {/* Reserved tail — pinned to the RIGHT edge (PoE-style) */}
            {cpView.stancePercent > 0 && (
              <div className="absolute top-0 right-0 h-full transition-all duration-300" style={{
                width: `${cpView.stancePercent}%`,
                background: 'repeating-linear-gradient(45deg, hsl(var(--soulforged) / 0.55) 0 3px, hsl(var(--soulforged) / 0.25) 3px 6px)',
                borderLeft: '1px solid hsl(var(--soulforged) / 0.7)',
              }} />
            )}
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
            {((character.rp_total_earned || 0) > 0 || character.level >= 30) && (
              <span className="text-gold tabular-nums">🏛️ {character.bhp || 0} RP</span>
            )}
            <span className="text-primary tabular-nums">{character.xp}/{xpForNext}</span>
          </div>
        </div>
        <div className="h-1 bg-background rounded-full overflow-hidden border border-border">
          <div className="h-full bg-primary transition-all duration-500 rounded-full" style={{ width: `${xpPercent}%` }} />
        </div>
      </div>

      {/* Buffs (stance pips render inline at the start) */}
      <div className="flex flex-wrap gap-1 justify-center items-center min-h-[22px]">
        {reservedBuffs && Object.entries(reservedBuffs).map(([key, entry]) => (
          <Tooltip key={`stance-${key}`}>
            <TooltipTrigger asChild>
              <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded border border-soulforged/60 bg-soulforged/10 text-[11px] font-display text-soulforged cursor-help">
                <span>⚓</span>
                <span className="capitalize">{key.replace(/_/g, ' ')}</span>
                <span className="opacity-70">−{entry.reserved}</span>
              </span>
            </TooltipTrigger>
            <TooltipContent side="top" className="text-xs">
              <span className="font-display">Stance · T{entry.tier}</span> — Reserves {entry.reserved} CP. Click the ability again to drop (CP not refunded).
            </TooltipContent>
          </Tooltip>
        ))}
        <ActiveBuffs
          isAtInn={isAtInn} foodBuff={foodBuff} critBuff={critBuff}
          battleCryBuff={battleCryBuff} poisonBuff={poisonBuff} damageBuff={damageBuff} evasionBuff={evasionBuff}
          igniteBuff={igniteBuff} absorbBuff={absorbBuff} partyRegenBuff={partyRegenBuff}
          stealthBuff={stealthBuff} inspireBuff={inspireBuff}
          holyShieldBuff={holyShieldBuff} shieldWallBuff={shieldWallBuff}
          consecrateBuff={consecrateBuff} divineChallengeBuff={divineChallengeBuff}
          forceShieldStance={forceShieldStance}
        />
      </div>
    </div>
  );
}
