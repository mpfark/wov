import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { PartyMember } from '@/hooks/useParty';

export interface LootDrop {
  item_id: string;
  item_name: string;
  item_rarity: string;
}

interface Props {
  open: boolean;
  loot: LootDrop[];
  partyMembers: PartyMember[];
  creatureName: string;
  onConfirm: (assignments: Record<string, string>) => void; // item_id -> character_id
}

const RARITY_COLORS: Record<string, string> = {
  common: 'text-foreground',
  uncommon: 'text-chart-2',
  rare: 'text-dwarvish',
  unique: 'text-primary text-glow',
};

export default function LootShareDialog({ open, loot, partyMembers, creatureName, onConfirm }: Props) {
  // Default all assignments to first member
  const [assignments, setAssignments] = useState<Record<string, string>>(() => {
    const init: Record<string, string> = {};
    for (const item of loot) {
      init[item.item_id] = partyMembers[0]?.character_id || '';
    }
    return init;
  });

  const handleConfirm = () => {
    onConfirm(assignments);
  };

  return (
    <Dialog open={open}>
      <DialogContent className="max-w-md" onInteractOutside={(e) => e.preventDefault()}>
        <DialogHeader>
          <DialogTitle className="font-display text-primary text-glow">
            💎 Loot from {creatureName}
          </DialogTitle>
        </DialogHeader>
        <p className="text-xs text-muted-foreground">Assign each item to a party member.</p>
        <div className="space-y-3 max-h-60 overflow-y-auto">
          {loot.map((item) => (
            <div key={item.item_id} className="flex items-center gap-2">
              <span className={`font-display text-sm flex-1 truncate ${RARITY_COLORS[item.item_rarity] || ''}`}>
                {item.item_name}
              </span>
              <Select
                value={assignments[item.item_id] || ''}
                onValueChange={(val) =>
                  setAssignments(prev => ({ ...prev, [item.item_id]: val }))
                }
              >
                <SelectTrigger className="w-36 h-8 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {partyMembers.map(m => (
                    <SelectItem key={m.character_id} value={m.character_id} className="text-xs">
                      {m.character.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ))}
        </div>
        <DialogFooter>
          <Button onClick={handleConfirm} className="font-display">
            Distribute Loot
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
