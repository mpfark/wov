import { useState, useEffect, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider } from '@/components/ui/tooltip';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { ServicePanelShell, ServicePanelEmpty } from '@/components/ui/ServicePanelShell';
import { Character } from '@/features/character';
import { getMaxHp, getMaxCp, getMaxMp, calculateStats, CLASS_LEVEL_BONUSES } from '@/lib/game-data';
import { supabase } from '@/integrations/supabase/client';
import { StatPlannerBody } from '@/features/character/components/StatPlannerDialog';

// NOTE: `character.bhp` is legacy storage for the current Renown balance.
// `character.bhp_trained` is legacy storage for Renown training ranks.

const STAT_KEYS = ['str', 'dex', 'con', 'int', 'wis', 'cha'] as const;
const STAT_LABELS: Record<string, string> = {
  str: 'Strength', dex: 'Dexterity', con: 'Constitution',
  int: 'Intelligence', wis: 'Wisdom', cha: 'Charisma',
};

function getTrainingCost(rank: number): number {
  return 10 * (rank + 1);
}
function getSuccessChance(rank: number): number {
  return Math.max(1, 95 - rank * 15);
}

interface LeaderRow {
  id: string;
  name: string;
  level: number;
  class: string;
  rp_total_earned: number;
}

interface Props {
  open: boolean;
  onClose: () => void;
  character: Character;
  equipmentBonuses: Record<string, number>;
  updateCharacter: (updates: Partial<Character>) => Promise<void>;
  addLog: (msg: string) => void;
  /** Called by allocate/respec flows to commit a batch / refund. */
  onBatchAllocateStats: (allocations: Record<string, number>) => void;
  onFullRespec: () => void;
  /** Optional NPC framing (when opened by talking to a service-role trainer). */
  npcName?: string;
  npcFlavor?: string;
}

type TrainerTab = 'allocate' | 'respec' | 'renown' | 'leaderboard';

export default function TrainerPanel({
  open, onClose, character, equipmentBonuses, updateCharacter, addLog,
  onBatchAllocateStats, onFullRespec, npcName, npcFlavor,
}: Props) {
  const [tab, setTab] = useState<TrainerTab>('allocate');
  const [training, setTraining] = useState(false);
  const [showRespecConfirm, setShowRespecConfirm] = useState(false);
  const trained = (character.bhp_trained || {}) as Record<string, number>;

  const [leaders, setLeaders] = useState<LeaderRow[] | null>(null);
  const [myRank, setMyRank] = useState<number | null>(null);
  const [loadingBoard, setLoadingBoard] = useState(false);

  // Default tab: prefer Allocate if points pending, else Respec if respec available, else Renown.
  useEffect(() => {
    if (!open) return;
    if (character.unspent_stat_points > 0) setTab('allocate');
    else if ((character.respec_points || 0) > 0) setTab('respec');
    else setTab('renown');
  }, [open, character.unspent_stat_points, character.respec_points]);

  // ── Renown training ──
  const handleTrain = async (stat: typeof STAT_KEYS[number]) => {
    const rank = trained[stat] || 0;
    const cost = getTrainingCost(rank);
    if (character.bhp < cost) return;
    if (character.level < 30) return;

    setTraining(true);
    const chance = getSuccessChance(rank);
    const roll = Math.random() * 100;
    const success = roll < chance;

    const newRp = character.bhp - cost;
    const newTrained = { ...trained };

    if (success) {
      newTrained[stat] = rank + 1;
      const newStatVal = (character as any)[stat] + 1;
      const updates: Partial<Character> = {
        bhp: newRp,
        bhp_trained: newTrained,
        [stat]: newStatVal,
      };
      if (stat === 'con') updates.max_hp = getMaxHp(character.class, newStatVal, character.level);
      if (stat === 'wis') updates.max_cp = getMaxCp(character.level, newStatVal);
      if (stat === 'dex') updates.max_mp = getMaxMp(character.level, newStatVal);

      await updateCharacter(updates);
      addLog(`🏛️ Training SUCCESS! +1 ${STAT_LABELS[stat]} (rank ${rank + 1}, ${chance}% chance) — ${cost} RP spent.`);
    } else {
      await updateCharacter({ bhp: newRp, bhp_trained: newTrained });
      addLog(`🏛️ Training FAILED. ${STAT_LABELS[stat]} remains unchanged (${chance}% chance) — ${cost} RP spent.`);
    }

    setTraining(false);
  };

  // ── Leaderboard ──
  const fetchLeaderboard = useCallback(async () => {
    setLoadingBoard(true);
    try {
      const { data, error } = await supabase.rpc('get_renown_leaderboard', { _limit: 25 });
      if (error) throw error;
      const rows = (data || []) as LeaderRow[];
      setLeaders(rows);

      const inTop = rows.some(r => r.id === character.id);
      if (!inTop && (character.rp_total_earned || 0) > 0) {
        const { data: rankData } = await supabase.rpc('get_renown_rank', { _character_id: character.id });
        setMyRank(typeof rankData === 'number' ? rankData : null);
      } else {
        setMyRank(null);
      }
    } catch (e: any) {
      addLog(`❌ Failed to load leaderboard: ${e.message || 'Unknown error'}`);
      setLeaders([]);
    }
    setLoadingBoard(false);
  }, [character.id, character.rp_total_earned, addLog]);

  useEffect(() => {
    if (open && tab === 'leaderboard' && leaders === null) {
      fetchLeaderboard();
    }
  }, [open, tab, leaders, fetchLeaderboard]);

  useEffect(() => {
    if (!open) {
      setLeaders(null);
      setMyRank(null);
    }
  }, [open]);

  // ── Tabs ──
  const tabsRow = (
    <Tabs value={tab} onValueChange={(v) => setTab(v as TrainerTab)} className="w-full">
      <TabsList className="grid grid-cols-4 w-full bg-background/40">
        <TabsTrigger value="allocate" className="font-display text-xs relative">
          Allocate
          {character.unspent_stat_points > 0 && (
            <span className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-primary animate-pulse" />
          )}
        </TabsTrigger>
        <TabsTrigger value="respec" className="font-display text-xs relative">
          Respec
          {(character.respec_points || 0) > 0 && (
            <span className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-chart-5 animate-pulse" />
          )}
        </TabsTrigger>
        <TabsTrigger value="renown" className="font-display text-xs">Renown</TabsTrigger>
        <TabsTrigger value="leaderboard" className="font-display text-xs">Board</TabsTrigger>
      </TabsList>
    </Tabs>
  );

  // ── Allocate tab ──
  const allocateContent = (
    character.unspent_stat_points > 0 ? (
      <StatPlannerBody
        character={character}
        equipmentBonuses={equipmentBonuses}
        onCommit={onBatchAllocateStats}
      />
    ) : (
      <ServicePanelEmpty>
        <p className="font-display text-foreground mb-1">The trainer studies your form.</p>
        <p>"You've nothing to refine just yet, wayfarer. Slay foes, gain levels, then return — and we'll forge raw experience into might."</p>
      </ServicePanelEmpty>
    )
  );

  // ── Respec tab ──
  // Show per-stat manual breakdown so player understands what gets refunded.
  const creationStats = calculateStats(character.race, character.class);
  const levelBonuses = CLASS_LEVEL_BONUSES[character.class] || {};
  const respecAvailable = (character.respec_points || 0) > 0;

  const respecContent = (
    <div className="space-y-3">
      <div className="flex items-center justify-between text-sm">
        <span className="text-muted-foreground">Available Respec Points</span>
        <span className="font-display text-chart-5 text-lg">{character.respec_points || 0}</span>
      </div>

      {!respecAvailable ? (
        <ServicePanelEmpty>
          <p className="font-display text-foreground mb-1">"Reshaping the soul is no small task."</p>
          <p>You have no respec points. Earn them through milestones to undo your manual allocations.</p>
        </ServicePanelEmpty>
      ) : (
        <>
          <p className="text-xs text-muted-foreground italic">
            Resets <strong className="text-foreground">all</strong> manually allocated stat points back into your unspent pool.
            Class level bonuses and Renown training are preserved.
          </p>

          <div className="space-y-1">
            <div className="grid grid-cols-[1fr_auto_auto] gap-3 text-[10px] text-muted-foreground font-display px-1">
              <span>Attribute</span>
              <span className="text-right">Current</span>
              <span className="text-right">Manual</span>
            </div>
            {STAT_KEYS.map(stat => {
              const base = (character as any)[stat] as number;
              const levelBonusTotal = Math.floor((character.level - 1) / 3) * (levelBonuses[stat] || 0);
              const renownRank = trained[stat] || 0;
              const nonManualBase = (creationStats[stat] || 8) + levelBonusTotal + renownRank;
              const manualPoints = Math.max(base - nonManualBase, 0);
              return (
                <div key={stat} className="grid grid-cols-[1fr_auto_auto] gap-3 items-center px-1.5 py-1 bg-background/40 rounded border border-border text-xs">
                  <span className="font-display text-foreground">{STAT_LABELS[stat]}</span>
                  <span className="text-right tabular-nums text-muted-foreground">{base}</span>
                  <span className={`text-right tabular-nums w-10 ${manualPoints > 0 ? 'text-chart-5' : 'text-muted-foreground/50'}`}>
                    {manualPoints > 0 ? `+${manualPoints}` : '–'}
                  </span>
                </div>
              );
            })}
          </div>

          <Button
            variant="outline"
            size="sm"
            className="w-full font-display text-chart-5 border-chart-5/40 hover:bg-chart-5/10"
            onClick={() => setShowRespecConfirm(true)}
          >
            Spend 1 Respec Point — Refund All Manual Allocations
          </Button>
        </>
      )}
    </div>
  );

  // ── Renown tab ──
  const totalTrained = Object.values(trained).reduce((sum, v) => sum + v, 0);
  const renownContent = (
    <div className="space-y-3">
      <div className="flex items-center justify-between text-sm">
        <span className="text-muted-foreground">Available Renown</span>
        <span className="font-display text-primary text-lg">{character.bhp} RP</span>
      </div>

      {character.level < 30 ? (
        <ServicePanelEmpty>
          <p className="font-display text-foreground mb-1">The trainer eyes you up and down.</p>
          <p>"Come back when you've proven yourself, wayfarer — reach <span className="text-primary font-display">level 30</span> and I'll teach you to forge Renown into raw might."</p>
          <p className="mt-2 text-[10px] italic">You are level {character.level}. {30 - character.level} more {30 - character.level === 1 ? 'level' : 'levels'} until training unlocks.</p>
        </ServicePanelEmpty>
      ) : (
        <TooltipProvider delayDuration={200}>
          <div className="space-y-1.5">
            <div className="grid grid-cols-[1fr_50px_60px_60px_auto] gap-1 text-[10px] text-muted-foreground font-display px-1">
              <span>Attribute</span>
              <span className="text-center">Rank</span>
              <span className="text-center">Chance</span>
              <span className="text-center">Cost</span>
              <span></span>
            </div>
            {STAT_KEYS.map(stat => {
              const rank = trained[stat] || 0;
              const chance = getSuccessChance(rank);
              const cost = getTrainingCost(rank);
              const canAfford = character.bhp >= cost;

              return (
                <div key={stat} className="grid grid-cols-[1fr_50px_60px_60px_auto] gap-1 items-center p-1.5 bg-background/50 rounded border border-border">
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span className="font-display text-xs text-foreground cursor-default">{STAT_LABELS[stat]}</span>
                    </TooltipTrigger>
                    <TooltipContent side="left" className="text-xs max-w-[180px]">
                      <p>Current: {(character as any)[stat]}</p>
                      <p>Renown trained: +{rank}</p>
                    </TooltipContent>
                  </Tooltip>
                  <span className="text-center text-xs text-muted-foreground tabular-nums">
                    {rank > 0 ? `+${rank}` : '–'}
                  </span>
                  <span className={`text-center text-xs tabular-nums ${chance <= 10 ? 'text-destructive' : chance <= 35 ? 'text-dwarvish' : 'text-elvish'}`}>
                    {chance}%
                  </span>
                  <span className="text-center text-xs text-muted-foreground tabular-nums">{cost}</span>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={training || !canAfford}
                    onClick={() => handleTrain(stat)}
                    className="font-display text-[10px] h-6 px-2 border-primary/50 text-primary"
                  >
                    Train
                  </Button>
                </div>
              );
            })}
          </div>
        </TooltipProvider>
      )}

      {totalTrained > 0 && (
        <p className="text-[10px] text-muted-foreground text-center">
          Total Renown ranks trained: {totalTrained}
        </p>
      )}

      <p className="text-[10px] text-muted-foreground italic leading-relaxed">
        Cost per attempt: 10 × (rank + 1) RP. Success chance decreases with each rank.
        Earn Renown by slaying rare and boss creatures.
      </p>
    </div>
  );

  // ── Leaderboard tab ──
  const renderLeaderRow = (row: LeaderRow, rank: number) => {
    const isMe = row.id === character.id;
    return (
      <div
        key={`${rank}-${row.id}`}
        className={`grid grid-cols-[36px_1fr_auto] gap-2 items-center p-1.5 rounded border ${
          isMe ? 'border-primary bg-primary/10' : 'border-border bg-background/40'
        }`}
      >
        <span className={`font-display text-xs text-center tabular-nums ${rank <= 3 ? 'text-primary text-glow' : 'text-muted-foreground'}`}>
          #{rank}
        </span>
        <div className="min-w-0">
          <div className={`font-display text-sm truncate ${isMe ? 'text-primary' : 'text-foreground'}`}>
            {row.name}
          </div>
          <div className="text-[10px] text-muted-foreground capitalize">
            Lv{row.level} {row.class}
          </div>
        </div>
        <span className="font-display text-xs text-dwarvish tabular-nums whitespace-nowrap">
          {row.rp_total_earned.toLocaleString()} RP
        </span>
      </div>
    );
  };

  const leaderboardContent = (
    <div className="space-y-2">
      <div className="grid grid-cols-[36px_1fr_auto] gap-2 px-1 text-[10px] font-display text-muted-foreground">
        <span className="text-center">Rank</span>
        <span>Wayfarer</span>
        <span className="text-right">Lifetime Renown</span>
      </div>

      {loadingBoard && (
        <p className="text-xs text-muted-foreground italic animate-pulse text-center py-4">
          Consulting the chronicles...
        </p>
      )}

      {!loadingBoard && leaders && leaders.length === 0 && (
        <ServicePanelEmpty>
          No wayfarer has yet earned Renown. The chronicles await.
        </ServicePanelEmpty>
      )}

      {!loadingBoard && leaders && leaders.length > 0 && (
        <div className="space-y-1">
          {leaders.map((row, idx) => renderLeaderRow(row, idx + 1))}
        </div>
      )}

      {!loadingBoard && myRank !== null && (
        <div className="pt-2 mt-2 border-t border-border space-y-1">
          <p className="text-[10px] text-muted-foreground text-center font-display">— Your Rank —</p>
          {renderLeaderRow(
            {
              id: character.id,
              name: character.name,
              level: character.level,
              class: String((character as any).class),
              rp_total_earned: character.rp_total_earned || 0,
            },
            myRank,
          )}
        </div>
      )}
    </div>
  );

  // ── Subtitle ──
  const subtitle = npcName ? (
    <>
      <span className="font-display text-primary">{npcName}</span>
      {npcFlavor && (
        <span className="block italic text-[11px] mt-0.5">"{npcFlavor}"</span>
      )}
    </>
  ) : (
    <span className="italic">Refine your soul: allocate growth, undo past choices, or forge Renown into might.</span>
  );

  const tabContent =
    tab === 'allocate' ? allocateContent
    : tab === 'respec' ? respecContent
    : tab === 'renown' ? renownContent
    : leaderboardContent;

  return (
    <>
      <ServicePanelShell
        open={open}
        onClose={onClose}
        icon="🏛️"
        title="Trainer"
        subtitle={subtitle}
        tabs={tabsRow}
        singleColumn
        left={tabContent}
      />

      {/* Respec confirmation */}
      <AlertDialog open={showRespecConfirm} onOpenChange={setShowRespecConfirm}>
        <AlertDialogContent className="bg-card border-border max-w-xs">
          <AlertDialogHeader>
            <AlertDialogTitle className="font-display text-chart-5 text-sm">Full Respec</AlertDialogTitle>
            <AlertDialogDescription className="text-xs">
              Reset <strong className="text-foreground">all</strong> manually allocated stat points? They will be returned as unspent points for you to reallocate here.
              <span className="block mt-1 text-muted-foreground/70">Uses 1 respec point ({character.respec_points || 0} remaining).</span>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="text-xs h-7">Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="text-xs h-7"
              onClick={() => {
                onFullRespec();
                setShowRespecConfirm(false);
                setTab('allocate');
              }}
            >
              Confirm Respec
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
