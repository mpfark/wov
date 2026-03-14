import { useState, useMemo } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Character } from '@/hooks/useCharacter';
import { getItemStatBudget, getItemStatCap, calculateItemStatCost, ITEM_STAT_COSTS } from '@/lib/game-data';
import { supabase } from '@/integrations/supabase/client';
import { toast } from '@/hooks/use-toast';

interface Props {
  open: boolean;
  onClose: () => void;
  character: Character;
  onForged: () => void;
}

const SLOTS = [
  { value: 'head', label: 'Head' },
  { value: 'amulet', label: 'Amulet' },
  { value: 'shoulders', label: 'Shoulders' },
  { value: 'chest', label: 'Chest' },
  { value: 'gloves', label: 'Gloves' },
  { value: 'belt', label: 'Belt' },
  { value: 'pants', label: 'Pants' },
  { value: 'ring', label: 'Ring' },
  { value: 'trinket', label: 'Trinket' },
  { value: 'main_hand', label: 'Main Hand' },
  { value: 'off_hand', label: 'Off Hand' },
  { value: 'boots', label: 'Boots' },
];

const STAT_LABELS: Record<string, string> = {
  str: 'STR', dex: 'DEX', con: 'CON', int: 'INT', wis: 'WIS', cha: 'CHA',
  ac: 'AC', hp: 'HP', hp_regen: 'Regen', potion_slots: 'Potion Slots',
};

const STAT_KEYS = ['str', 'dex', 'con', 'int', 'wis', 'cha', 'ac', 'hp', 'hp_regen', 'potion_slots'];

export default function SoulforgeDialog({ open, onClose, character, onForged }: Props) {
  const [itemName, setItemName] = useState('');
  const [slot, setSlot] = useState('');
  const [hands, setHands] = useState<1 | 2>(1);
  const [stats, setStats] = useState<Record<string, number>>({});
  const [forging, setForging] = useState(false);

  const effectiveHands = slot === 'main_hand' ? hands : 1;
  const budget = useMemo(() => slot ? getItemStatBudget(42, 'uncommon', effectiveHands) : 0, [slot, effectiveHands]);
  const cost = useMemo(() => calculateItemStatCost(stats), [stats]);
  const remaining = budget - cost;

  const isNotWorthy = character.level < 42;
  const alreadyForged = (character as any).soulforged_item_created === true;

  const addStat = (key: string) => {
    const current = stats[key] || 0;
    const cap = getItemStatCap(key, 42);
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

  const statCount = Object.keys(stats).filter(k => stats[k] > 0).length;
  const canForge = itemName.trim().length >= 1 && itemName.trim().length <= 30 && /^[\x20-\x7E]+$/.test(itemName) &&
    slot && statCount >= 2 && remaining >= 0 && !forging;

  const handleForge = async () => {
    if (!canForge) return;
    setForging(true);
    try {
      const { data, error } = await supabase.functions.invoke('soulforge-item', {
        body: { character_id: character.id, name: itemName.trim(), slot, hands: effectiveHands, stats },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      toast({ title: '⚒️ Soulforged!', description: `${itemName.trim()} has been forged into existence.` });
      onForged();
      onClose();
    } catch (e: any) {
      toast({ title: 'Forge Failed', description: e.message || 'Something went wrong.', variant: 'destructive' });
    } finally {
      setForging(false);
    }
  };

  const reset = () => {
    setItemName('');
    setSlot('');
    setHands(1);
    setStats({});
  };

  return (
    <Dialog open={open} onOpenChange={v => { if (!v) { onClose(); reset(); } }}>
      <DialogContent className="sm:max-w-lg border-soulforged/30 bg-card max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="font-display text-soulforged text-glow flex items-center gap-2">
            ⚒️ The Soulwright
          </DialogTitle>
          <DialogDescription className="text-xs italic text-muted-foreground">
            An ancient artisan wreathed in spectral flame.
          </DialogDescription>
        </DialogHeader>

        {isNotWorthy ? (
          <div className="p-4 text-center space-y-2">
            <p className="text-sm text-foreground/80 italic">
              "You are not yet worthy, wayfarer. Return when you have reached the pinnacle of mortal power."
            </p>
            <p className="text-xs text-muted-foreground">(Reach level 42 to forge your legacy.)</p>
          </div>
        ) : alreadyForged ? (
          <div className="p-4 text-center space-y-2">
            <p className="text-sm text-foreground/80 italic">
              "You have already forged your legacy. One soul, one creation — that is the law of the forge."
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            <p className="text-xs text-muted-foreground">
              Forge a unique soulbound item. It cannot be dropped or sold. Choose wisely — you may only do this once.
            </p>

            {/* Item Name */}
            <div>
              <label className="text-xs font-display text-muted-foreground">Item Name</label>
              <Input
                value={itemName}
                onChange={e => setItemName(e.target.value)}
                placeholder="Name your creation..."
                maxLength={30}
                className="h-8 text-sm font-display mt-1"
              />
              <p className="text-[10px] text-muted-foreground mt-0.5">{itemName.length}/30</p>
            </div>

            {/* Slot */}
            <div>
              <label className="text-xs font-display text-muted-foreground">Equipment Slot</label>
              <Select value={slot} onValueChange={v => { setSlot(v); setStats({}); }}>
                <SelectTrigger className="h-8 text-sm mt-1">
                  <SelectValue placeholder="Choose slot..." />
                </SelectTrigger>
                <SelectContent>
                  {SLOTS.map(s => (
                    <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* 1H/2H for main_hand */}
            {slot === 'main_hand' && (
              <div className="flex gap-2">
                <Button size="sm" variant={hands === 1 ? 'default' : 'outline'} onClick={() => { setHands(1); setStats({}); }}
                  className="flex-1 h-7 text-xs font-display">One-Handed</Button>
                <Button size="sm" variant={hands === 2 ? 'default' : 'outline'} onClick={() => { setHands(2); setStats({}); }}
                  className="flex-1 h-7 text-xs font-display">Two-Handed</Button>
              </div>
            )}

            {/* Stats */}
            {slot && (
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-xs font-display text-muted-foreground">Allocate Stats</label>
                  <span className={`text-xs font-display tabular-nums ${remaining < 0 ? 'text-destructive' : remaining === 0 ? 'text-soulforged' : 'text-muted-foreground'}`}>
                    {remaining} / {budget} pts remaining
                  </span>
                </div>
                <div className="space-y-1">
                  {STAT_KEYS.map(key => {
                    const val = stats[key] || 0;
                    const cap = getItemStatCap(key, 42);
                    const statCost = ITEM_STAT_COSTS[key] || 1;
                    const costLabel = statCost !== 1 ? ` (${statCost}pt${statCost !== 1 ? '' : ''})` : '';
                    return (
                      <div key={key} className="flex items-center justify-between py-0.5 px-1 rounded hover:bg-accent/20">
                        <span className="text-xs font-display text-foreground">
                          {STAT_LABELS[key]}{costLabel}
                        </span>
                        <div className="flex items-center gap-1">
                          <Button size="sm" variant="ghost" className="h-5 w-5 p-0 text-xs"
                            onClick={() => removeStat(key)} disabled={val <= 0}>−</Button>
                          <span className={`w-5 text-center text-xs tabular-nums font-display ${val > 0 ? 'text-soulforged' : 'text-muted-foreground'}`}>
                            {val}
                          </span>
                          <Button size="sm" variant="ghost" className="h-5 w-5 p-0 text-xs"
                            onClick={() => addStat(key)} disabled={val >= cap || cost + statCost > budget}>+</Button>
                          <span className="text-[9px] text-muted-foreground w-8 text-right">/{cap}</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
                {statCount < 2 && (
                  <p className="text-[10px] text-destructive mt-1">Must have at least 2 different stats.</p>
                )}
              </div>
            )}

            {/* Preview */}
            {slot && statCount >= 2 && (
              <div className="p-2 rounded border border-soulforged/30 bg-soulforged/5">
                <p className="text-xs font-display text-soulforged">{itemName || 'Unnamed'}</p>
                <p className="text-[10px] text-muted-foreground">Uncommon · Lvl 42 · Soulbound</p>
                <p className="text-[10px] text-muted-foreground capitalize">{SLOTS.find(s => s.value === slot)?.label}{slot === 'main_hand' ? ` · ${hands === 2 ? 'Two-Handed' : 'One-Handed'}` : ''}</p>
                {Object.entries(stats).filter(([, v]) => v > 0).map(([k, v]) => (
                  <p key={k} className="text-[10px] text-soulforged">+{v} {STAT_LABELS[k]}</p>
                ))}
              </div>
            )}

            {/* Forge button */}
            <Button onClick={handleForge} disabled={!canForge} className="w-full font-display bg-elvish/80 hover:bg-elvish text-background">
              {forging ? 'Forging...' : '⚒️ Forge Item'}
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
