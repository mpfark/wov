import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Character } from '@/hooks/useCharacter';
import { Plus, Minus, Sparkles } from 'lucide-react';

const STAT_KEYS = ['str', 'dex', 'con', 'int', 'wis', 'cha'] as const;
const STAT_LABELS: Record<string, string> = {
  str: 'STR', dex: 'DEX', con: 'CON', int: 'INT', wis: 'WIS', cha: 'CHA',
};
const STAT_MAX = 30;

interface Props {
  character: Character;
  onAllocate: (updates: Partial<Character>) => Promise<void>;
}

export default function StatAllocationDialog({ character, onAllocate }: Props) {
  const points = character.unspent_stat_points || 0;
  const [allocated, setAllocated] = useState<Record<string, number>>({});
  const [saving, setSaving] = useState(false);

  const spent = Object.values(allocated).reduce((sum, v) => sum + v, 0);
  const remaining = points - spent;

  if (points <= 0) return null;

  const increment = (stat: string) => {
    const current = character[stat as keyof Character] as number;
    const added = allocated[stat] || 0;
    if (remaining <= 0 || current + added >= STAT_MAX) return;
    setAllocated(prev => ({ ...prev, [stat]: (prev[stat] || 0) + 1 }));
  };

  const decrement = (stat: string) => {
    if (!allocated[stat] || allocated[stat] <= 0) return;
    setAllocated(prev => ({ ...prev, [stat]: prev[stat] - 1 }));
  };

  const handleConfirm = async () => {
    if (spent === 0) return;
    setSaving(true);
    const updates: Partial<Character> = { unspent_stat_points: remaining };
    for (const stat of STAT_KEYS) {
      if (allocated[stat]) {
        updates[stat] = (character[stat] as number) + allocated[stat];
      }
    }
    await onAllocate(updates);
    setAllocated({});
    setSaving(false);
  };

  return (
    <Dialog open={true}>
      <DialogContent className="max-w-xs ornate-border" onInteractOutside={(e) => e.preventDefault()}>
        <DialogHeader>
          <DialogTitle className="font-display text-primary flex items-center gap-2">
            <Sparkles className="w-4 h-4" /> Level Up!
          </DialogTitle>
        </DialogHeader>
        <p className="text-xs text-muted-foreground">
          You have <span className="text-primary font-display">{remaining}</span> stat point{remaining !== 1 ? 's' : ''} to spend.
        </p>
        <div className="space-y-2">
          {STAT_KEYS.map(stat => {
            const base = character[stat] as number;
            const added = allocated[stat] || 0;
            const atMax = base + added >= STAT_MAX;
            return (
              <div key={stat} className="flex items-center justify-between">
                <span className="font-display text-xs w-10">{STAT_LABELS[stat]}</span>
                <span className="text-xs text-muted-foreground w-8 text-right">{base}</span>
                {added > 0 && (
                  <span className="text-xs text-chart-2 font-bold w-8 text-center">+{added}</span>
                )}
                {added === 0 && <span className="w-8" />}
                <div className="flex gap-1">
                  <Button size="sm" variant="ghost" className="h-6 w-6 p-0"
                    disabled={added <= 0} onClick={() => decrement(stat)}>
                    <Minus className="w-3 h-3" />
                  </Button>
                  <Button size="sm" variant="ghost" className="h-6 w-6 p-0"
                    disabled={remaining <= 0 || atMax} onClick={() => increment(stat)}>
                    <Plus className="w-3 h-3" />
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
        <DialogFooter>
          <Button size="sm" className="w-full font-display" disabled={spent === 0 || saving} onClick={handleConfirm}>
            Confirm ({spent} point{spent !== 1 ? 's' : ''})
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
