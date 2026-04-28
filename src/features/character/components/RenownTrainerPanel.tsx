import { useState, useEffect, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider } from '@/components/ui/tooltip';
import { ServicePanelShell, ServicePanelEmpty } from '@/components/ui/ServicePanelShell';
import { Character } from '@/features/character';
import { getMaxHp, getMaxCp, getMaxMp } from '@/lib/game-data';
import { supabase } from '@/integrations/supabase/client';

// NOTE: `character.bhp` is legacy storage for the current Renown balance.
// `character.bhp_trained` is legacy storage for Renown training ranks.
// Only the player-facing name changed; columns kept their original names.

const STAT_KEYS = ['str', 'dex', 'con', 'int', 'wis', 'cha'] as const;
const STAT_LABELS: Record<string, string> = {
  str: 'Strength', dex: 'Dexterity', con: 'Constitution',
  int: 'Intelligence', wis: 'Wisdom', cha: 'Charisma',
};

function getTrainingCost(rank: number): number {
  return 20 * (rank + 1);
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
  updateCharacter: (updates: Partial<Character>) => Promise<void>;
  addLog: (msg: string) => void;
  /** Optional NPC framing (when opened by talking to a service-role trainer). */
  npcName?: string;
  npcFlavor?: string;
}

type TrainerTab = 'train' | 'leaderboard';

export default function RenownTrainerPanel({
  open, onClose, character, updateCharacter, addLog, npcName, npcFlavor,
}: Props) {
  const [tab, setTab] = useState<TrainerTab>('train');
  const [training, setTraining] = useState(false);
  const trained = (character.bhp_trained || {}) as Record<string, number>;

  const [leaders, setLeaders] = useState<LeaderRow[] | null>(null);
  const [myRank, setMyRank] = useState<number | null>(null);
  const [loadingBoard, setLoadingBoard] = useState(false);

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

  // Reset cache when reopening
  useEffect(() => {
    if (!open) {
      setLeaders(null);
      setMyRank(null);
      setTab('train');
    }
  }, [open]);

  const totalTrained = Object.values(trained).reduce((sum, v) => sum + v, 0);

  // ── Tabs ──
  const tabsRow = (
    <Tabs value={tab} onValueChange={(v) => setTab(v as TrainerTab)} className="w-full">
      <TabsList className="grid grid-cols-2 w-full bg-background/40">
        <TabsTrigger value="train" className="font-display text-xs">Train</TabsTrigger>
        <TabsTrigger value="leaderboard" className="font-display text-xs">Leaderboard</TabsTrigger>
      </TabsList>
    </Tabs>
  );

  // ── Train tab ──
  const trainContent = (
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
                      <span className="font-display text-xs text-foreground cursor-default">
                        {STAT_LABELS[stat]}
                      </span>
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
                  <span className="text-center text-xs text-muted-foreground tabular-nums">
                    {cost}
                  </span>
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
        Cost per attempt: 20 × (rank + 1) RP. Success chance decreases with each rank.
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
    <span className="italic">Spend Renown to permanently raise your attributes.</span>
  );

  return (
    <ServicePanelShell
      open={open}
      onClose={onClose}
      icon="🏛️"
      title="Renown Trainer"
      subtitle={subtitle}
      tabs={tabsRow}
      singleColumn
      left={tab === 'train' ? trainContent : leaderboardContent}
    />
  );
}
