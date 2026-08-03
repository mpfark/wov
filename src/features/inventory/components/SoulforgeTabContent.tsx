/**
 * useSoulforgeForge — hook providing the Soulforged Ring UI as slot nodes
 * (left/right/footer + titles) for embedding inside a persistent
 * ServicePanelShell. State persists across tab switches because the hook
 * lives in the parent component.
 *
 * Server enforcement (level gates, ownership, tier bumps, stat caps) lives in
 * the `forge_soulring` RPC — this hook is purely UI.
 */
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { Character } from '@/features/character';
import { ServicePanelEmpty } from '@/components/ui/ServicePanelShell';
import {
  getItemStatBudget,
  getItemStatCap,
  calculateItemStatCost,
  ITEM_STAT_COSTS,
  SOULRING_TIER_LEVELS,
  SOULRING_TIER_NAMES,
  getNextSoulringStep,
} from '@/lib/game-data';
import { supabase } from '@/integrations/supabase/client';
import { toast } from '@/hooks/use-toast';

const STAT_LABELS: Record<string, string> = {
  str: 'STR', dex: 'DEX', con: 'CON', int: 'INT', wis: 'WIS', cha: 'CHA',
  ac: 'AC', hp: 'HP', hp_regen: 'Regen',
};
const STAT_KEYS = ['str', 'dex', 'con', 'int', 'wis', 'cha', 'ac', 'hp', 'hp_regen'];

interface UseSoulforgeForgeOptions {
  character: Character | null;
  /** Called after a successful forge so caller can refresh inventory. */
  onForged: () => void;
}

export interface SoulforgeSlots {
  left: ReactNode;
  right: ReactNode;
  footer: ReactNode;
  leftTitle?: ReactNode;
  rightTitle?: ReactNode;
}

const PANEL_TITLE = "The Soulwright's Ring";

export function useSoulforgeForge({ character, onForged }: UseSoulforgeForgeOptions): SoulforgeSlots {
  const tier = character?.soulring_tier ?? 0;
  const nextStep = useMemo(
    () => character ? getNextSoulringStep(character.level, tier) : null,
    [character, tier],
  );
  const nextLevel = nextStep?.requiredLevel ?? null;
  const [stats, setStats] = useState<Record<string, number>>({});
  const [forging, setForging] = useState(false);

  // Reset allocator when the player's tier changes (e.g. after a successful forge)
  useEffect(() => {
    setStats({});
  }, [tier, character?.id]);

  const budget = useMemo(
    () => nextLevel ? getItemStatBudget(nextLevel, 'soulforged', 1) : 0,
    [nextLevel],
  );
  const cost = useMemo(() => calculateItemStatCost(stats), [stats]);
  const remaining = budget - cost;
  const statCount = Object.keys(stats).filter(k => stats[k] > 0).length;

  // ── Guard: no character yet ─────────────────────────────────────
  if (!character || !character.id || (character.level ?? 0) <= 0) {
    return {
      left: <ServicePanelEmpty>Awaiting the wayfarer's arrival…</ServicePanelEmpty>,
      right: null, footer: null, leftTitle: PANEL_TITLE,
    };
  }

  // ── Not worthy yet ──────────────────────────────────────────────
  if (character.level < SOULRING_TIER_LEVELS[0]) {
    return {
      left: (
        <div className="p-4 text-center gap-group">
          <p className="text-sm text-foreground/80 italic">
            "Your spirit is not yet bright enough to bind, wayfarer. Return at
            level {SOULRING_TIER_LEVELS[0]}."
          </p>
        </div>
      ),
      right: null, footer: null, leftTitle: PANEL_TITLE,
    };
  }

  // ── Fully Ascended ──────────────────────────────────────────────
  if (tier >= 5) {
    return {
      left: (
        <div className="p-4 text-center gap-group">
          <p className="text-sm text-soulforged italic text-glow-soulforged">
            "Your ring is Ascended. The forge has nothing more to give."
          </p>
        </div>
      ),
      right: null, footer: null, leftTitle: PANEL_TITLE,
    };
  }

  // ── Waiting for the next milestone ──────────────────────────────
  if (!nextStep) {
    const upcomingLevel = SOULRING_TIER_LEVELS[tier]; // next tier index
    const upcomingName = SOULRING_TIER_NAMES[tier];
    return {
      left: (
        <div className="p-4 text-center gap-group">
          <p className="text-sm text-foreground/80 italic">
            "Return at level {upcomingLevel} to refine your ring into the {upcomingName}."
          </p>
          {tier > 0 && (
            <p className="text-xs text-muted-foreground">
              You currently bear the <span className="text-soulforged">{SOULRING_TIER_NAMES[tier - 1]}</span> (Tier {tier}/5).
            </p>
          )}
        </div>
      ),
      right: null, footer: null, leftTitle: PANEL_TITLE,
    };
  }

  // ── Forge / Re-forge flow ───────────────────────────────────────
  const addStat = (key: string) => {
    const current = stats[key] || 0;
    const cap = getItemStatCap(key, nextStep.requiredLevel);
    if (current >= cap) return;
    const statCost = ITEM_STAT_COSTS[key] || 1;
    if (cost + statCost > budget) return;
    setStats(prev => ({ ...prev, [key]: current + 1 }));
  };
  const removeStat = (key: string) => {
    const current = stats[key] || 0;
    if (current <= 0) return;
    setStats(prev => {
      const next = { ...prev, [key]: current - 1 };
      if (next[key] === 0) delete next[key];
      return next;
    });
  };

  const canForge = statCount >= 2 && remaining >= 0 && !forging;

  const handleForge = async () => {
    if (!canForge) return;
    setForging(true);
    try {
      const { data, error } = await supabase.rpc('forge_soulring' as any, {
        p_character_id: character.id,
        p_stats: stats,
      });
      if (error) throw error;
      const parsed = (typeof data === 'string' ? JSON.parse(data) : data) as any;
      toast({
        title: 'Soulforged!',
        description: `${parsed?.name ?? nextStep.name} now hums on your finger.`,
      });
      onForged();
    } catch (e: any) {
      toast({ title: 'Forge Failed', description: e?.message || 'The forge rejected your offering.', variant: 'destructive' });
    } finally {
      setForging(false);
    }
  };

  const isFirstForge = tier === 0;
  const headerText = isFirstForge
    ? 'Forge your Soulforged Ring'
    : `Re-forge as ${nextStep.name}`;

  const left = (
    <div className="gap-section">
      <p className="text-xs text-muted-foreground italic">
        {isFirstForge
          ? '"Your spirit burns bright enough to be bound. Choose what it shall remember."'
          : '"You return stronger. Tell me again what your ring should remember."'}
      </p>
      <div className="rounded border border-soulforged/30 bg-soulforged/5 p-2 gap-row">
        <p className="text-sm font-display text-soulforged text-glow-soulforged">{nextStep.name}</p>
        <p className="text-[10px] text-muted-foreground">
          Tier {nextStep.nextTier}/5 · Soulforged · Lvl {nextStep.requiredLevel} · Ring · Soulbound
        </p>
        {tier > 0 && (
          <p className="text-[10px] text-muted-foreground">
            Replaces your <span className="text-soulforged">{SOULRING_TIER_NAMES[tier - 1]}</span> — stats are rewritten.
          </p>
        )}
      </div>
    </div>
  );

  const right = (
    <div className="gap-section">
      <div className="flex items-center justify-between">
        <label className="text-xs font-display text-muted-foreground">Allocate Stats</label>
        <span className={`text-xs font-display tabular-nums ${remaining < 0 ? 'text-destructive' : remaining === 0 ? 'text-soulforged' : 'text-muted-foreground'}`}>
          {remaining} / {budget} pts
        </span>
      </div>
      <div className="gap-row">
        {STAT_KEYS.map(key => {
          const val = stats[key] || 0;
          const cap = getItemStatCap(key, nextStep.requiredLevel);
          const statCost = ITEM_STAT_COSTS[key] || 1;
          return (
            <div key={key} className="flex items-center justify-between py-0.5 px-1 rounded hover:bg-accent/20">
              <span className="text-xs font-display text-foreground">
                {STAT_LABELS[key]}{statCost !== 1 ? ` (${statCost}pt)` : ''}
              </span>
              <div className="flex items-center gap-1">
                <Button size="sm" variant="ghost" className="h-5 w-5 p-0 text-xs"
                  onClick={() => removeStat(key)} disabled={val <= 0}>−</Button>
                <span className={`w-5 text-center text-xs tabular-nums font-display ${val > 0 ? 'text-soulforged' : 'text-muted-foreground'}`}>{val}</span>
                <Button size="sm" variant="ghost" className="h-5 w-5 p-0 text-xs"
                  onClick={() => addStat(key)} disabled={val >= cap || cost + statCost > budget}>+</Button>
                <span className="text-[9px] text-muted-foreground w-8 text-right">/{cap}</span>
              </div>
            </div>
          );
        })}
      </div>
      {statCount < 2 && <p className="text-[10px] text-destructive">Must allocate at least 2 different stats.</p>}
      {statCount >= 2 && (
        <div className="p-2 rounded border border-soulforged/30 bg-soulforged/5">
          <p className="text-xs font-display text-soulforged">{nextStep.name}</p>
          <p className="text-[10px] text-muted-foreground">Soulforged · Lvl {nextStep.requiredLevel} · Ring · Soulbound</p>
          {Object.entries(stats).filter(([, v]) => v > 0).map(([k, v]) => (
            <p key={k} className="text-[10px] text-soulforged">+{v} {STAT_LABELS[k]}</p>
          ))}
        </div>
      )}
    </div>
  );

  const footer = (
    <div className="flex items-center justify-between gap-2">
      <span className="text-xs text-muted-foreground italic">
        {forging ? 'Channeling…' : isFirstForge ? 'A ring bound to your soul.' : 'Your old ring will be unmade.'}
      </span>
      <Button
        onClick={handleForge}
        disabled={!canForge}
        className="font-display text-xs h-8 bg-elvish/80 hover:bg-elvish text-background"
      >
        {forging ? 'Forging...' : `${headerText}`}
      </Button>
    </div>
  );

  return { left, right, footer, leftTitle: PANEL_TITLE, rightTitle: 'Stat Allocation' };
}
