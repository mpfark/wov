import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Character } from '@/hooks/useCharacter';
import { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider } from '@/components/ui/tooltip';
import { getMaxHp, getMaxCp, getMaxMp } from '@/lib/game-data';

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

interface Props {
  open: boolean;
  onClose: () => void;
  character: Character;
  updateCharacter: (updates: Partial<Character>) => Promise<void>;
  addLog: (msg: string) => void;
}

export default function BossTrainerPanel({ open, onClose, character, updateCharacter, addLog }: Props) {
  const [training, setTraining] = useState(false);
  const trained = (character.bhp_trained || {}) as Record<string, number>;

  const handleTrain = async (stat: typeof STAT_KEYS[number]) => {
    const rank = trainedRef[stat] || 0;
    const cost = getTrainingCost(rank);
    if (character.bhp < cost) return;
    if (character.level < 30) return;

    setTraining(true);
    const chance = getSuccessChance(rank);
    const roll = Math.random() * 100;
    const success = roll < chance;

    const newBhp = character.bhp - cost;
    const newTrained = { ...trained };

    if (success) {
      newTrained[stat] = rank + 1;
      const newStatVal = (character as any)[stat] + 1;
      const updates: Partial<Character> = {
        bhp: newBhp,
        bhp_trained: newTrained,
        [stat]: newStatVal,
      };

      // Recalc derived stats if needed
      if (stat === 'con') {
        updates.max_hp = getMaxHp(character.class, newStatVal, character.level);
      }
      if (stat === 'int' || stat === 'wis' || stat === 'cha') {
        updates.max_cp = getMaxCp(character.level,
          stat === 'int' ? newStatVal : character.int,
          stat === 'wis' ? newStatVal : character.wis,
          stat === 'cha' ? newStatVal : character.cha,
        );
      }
      if (stat === 'dex') {
        updates.max_mp = getMaxMp(character.level, newStatVal);
      }

      await updateCharacter(updates);
      addLog(`🏋️ Training SUCCESS! +1 ${STAT_LABELS[stat]} (rank ${rank + 1}, ${chance}% chance) — ${cost} BHP spent.`);
    } else {
      await updateCharacter({ bhp: newBhp, bhp_trained: newTrained });
      addLog(`🏋️ Training FAILED. ${STAT_LABELS[stat]} remains unchanged (${chance}% chance) — ${cost} BHP spent.`);
    }

    setTraining(false);
  };

  const totalTrained = Object.values(trained).reduce((sum, v) => sum + v, 0);

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-w-md bg-card border-border">
        <DialogHeader>
          <DialogTitle className="font-display text-primary text-glow">🏋️ Boss Hunter Trainer</DialogTitle>
        </DialogHeader>

        <div className="space-y-3">
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">Boss Hunter Points</span>
            <span className="font-display text-primary text-lg">{character.bhp} BHP</span>
          </div>

          {character.level < 30 ? (
            <p className="text-sm text-muted-foreground italic text-center py-4">
              You must be level 30 or higher to train here.
            </p>
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
                  const canAfford = character.bhp >= TRAINING_COST;

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
                          <p>BHP trained: +{rank}</p>
                        </TooltipContent>
                      </Tooltip>
                      <span className="text-center text-xs text-muted-foreground tabular-nums">
                        {rank > 0 ? `+${rank}` : '–'}
                      </span>
                      <span className={`text-center text-xs tabular-nums ${chance <= 10 ? 'text-destructive' : chance <= 35 ? 'text-dwarvish' : 'text-elvish'}`}>
                        {chance}%
                      </span>
                      <span className="text-center text-xs text-muted-foreground tabular-nums">
                        {TRAINING_COST}
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
              Total BHP ranks trained: {totalTrained}
            </p>
          )}

          <p className="text-[10px] text-muted-foreground italic leading-relaxed">
            Spend {TRAINING_COST} BHP per attempt to permanently increase an attribute.
            Success chance decreases with each rank trained in the same stat.
            Earn BHP by slaying boss creatures.
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
