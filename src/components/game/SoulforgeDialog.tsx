import { useState, useMemo } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Character } from '@/hooks/useCharacter';
import { getItemStatBudget, getItemStatCap, calculateItemStatCost, ITEM_STAT_COSTS } from '@/lib/game-data';
import { supabase } from '@/integrations/supabase/client';
import { toast } from '@/hooks/use-toast';
import { Sparkles } from 'lucide-react';

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

type ForgeMode = 'crown' | 'soulforge';

function StatAllocator({ stats, setStats, budget, cost, slot, level }: {
  stats: Record<string, number>;
  setStats: (fn: (prev: Record<string, number>) => Record<string, number>) => void;
  budget: number;
  cost: number;
  slot: string;
  level: number;
}) {
  const remaining = budget - cost;
  const statCount = Object.keys(stats).filter(k => stats[k] > 0).length;

  const addStat = (key: string) => {
    const current = stats[key] || 0;
    const cap = getItemStatCap(key, level);
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

  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <label className="text-xs font-display text-muted-foreground">Allocate Stats</label>
        <span className={`text-xs font-display tabular-nums ${remaining < 0 ? 'text-destructive' : remaining === 0 ? 'text-soulforged' : 'text-muted-foreground'}`}>
          {remaining} / {budget} pts remaining
        </span>
      </div>
      <div className="space-y-1">
        {STAT_KEYS.filter(key => key !== 'potion_slots' || slot === 'belt').map(key => {
          const val = stats[key] || 0;
          const cap = getItemStatCap(key, level);
          const statCost = ITEM_STAT_COSTS[key] || 1;
          const costLabel = statCost !== 1 ? ` (${statCost}pt${statCost !== 1 ? '' : ''})` : '';
          return (
            <div key={key} className="flex items-center justify-between py-0.5 px-1 rounded hover:bg-accent/20">
              <span className="text-xs font-display text-foreground" title={key === 'potion_slots' ? `Determines how many potions you can load into this belt for quick use in combat. Costs ${statCost}pts per slot, max ${cap}.` : undefined}>
                {STAT_LABELS[key]}{costLabel}
                {key === 'potion_slots' && <span className="text-[9px] text-muted-foreground ml-1">max {cap}</span>}
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
  );
}

export default function SoulforgeDialog({ open, onClose, character, onForged }: Props) {
  const [mode, setMode] = useState<ForgeMode | null>(null);
  const [itemName, setItemName] = useState('');
  const [slot, setSlot] = useState('');
  const [hands, setHands] = useState<1 | 2>(1);
  const [stats, setStats] = useState<Record<string, number>>({});
  const [forging, setForging] = useState(false);
  const [aiUsesLeft, setAiUsesLeft] = useState(3);
  const [aiGenerating, setAiGenerating] = useState(false);
  const [aiSuggestion, setAiSuggestion] = useState<string | null>(null);

  const canCrown = character.level >= 40 && !character.crown_item_created;
  const canSoulforge = character.level >= 42 && !character.soulforged_item_created;
  const isNotWorthy = character.level < 40;
  const allDone = !canCrown && !canSoulforge && !isNotWorthy;

  // Crown uses fixed slot/level; soulforge uses user-chosen slot
  const activeSlot = mode === 'crown' ? 'head' : slot;
  const activeLevel = mode === 'crown' ? 40 : 42;
  const effectiveHands = activeSlot === 'main_hand' ? hands : 1;
  const budget = useMemo(() => activeSlot ? getItemStatBudget(activeLevel, 'uncommon', effectiveHands) : 0, [activeSlot, activeLevel, effectiveHands]);
  const cost = useMemo(() => calculateItemStatCost(stats), [stats]);
  const remaining = budget - cost;
  const statCount = Object.keys(stats).filter(k => stats[k] > 0).length;

  const canForge = mode && activeSlot && statCount >= 2 && remaining >= 0 && !forging &&
    (mode === 'crown' || (itemName.trim().length >= 1 && itemName.trim().length <= 30 && /^[\x20-\x7E]+$/.test(itemName)));

  const handleForge = async () => {
    if (!canForge) return;
    setForging(true);
    try {
      const body: any = { character_id: character.id, stats, forge_type: mode };
      if (mode === 'soulforge') {
        body.name = itemName.trim();
        body.slot = slot;
        body.hands = effectiveHands;
      }
      const { data, error } = await supabase.functions.invoke('soulforge-item', { body });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      const label = mode === 'crown' ? 'Crown' : itemName.trim();
      toast({ title: '⚒️ Soulforged!', description: `${label} has been forged into existence.` });
      onForged();
      onClose();
    } catch (e: any) {
      toast({ title: 'Forge Failed', description: e.message || 'Something went wrong.', variant: 'destructive' });
    } finally {
      setForging(false);
    }
  };

  const handleAiName = async () => {
    if (aiUsesLeft <= 0 || !slot || aiGenerating) return;
    setAiGenerating(true);
    try {
      const { data, error } = await supabase.functions.invoke('soulforge-name', {
        body: {
          slot,
          character_name: character.name,
          character_class: character.class,
          character_race: character.race,
        },
      });
      if (error) throw error;
      // data may be a string if content-type isn't detected properly
      const parsed = typeof data === 'string' ? JSON.parse(data) : data;
      if (parsed?.error) throw new Error(parsed.error);
      const name = parsed?.name;
      if (!name) throw new Error('No name returned');
      setAiSuggestion(name);
      setAiUsesLeft(prev => prev - 1);
    } catch (e: any) {
      toast({ title: 'AI Failed', description: e.message || 'Could not generate name.', variant: 'destructive' });
    } finally {
      setAiGenerating(false);
    }
  };

  const reset = () => {
    setMode(null);
    setItemName('');
    setSlot('');
    setHands(1);
    setStats({});
    setAiUsesLeft(3);
    setAiGenerating(false);
    setAiSuggestion(null);
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
              "You are not yet worthy, wayfarer. Return when you have proven your reign."
            </p>
            <p className="text-xs text-muted-foreground">(Reach level 40 to forge your Crown.)</p>
          </div>
        ) : allDone ? (
          <div className="p-4 text-center space-y-2">
            <p className="text-sm text-foreground/80 italic">
              "You have forged all that fate allows. Your legacy is complete."
            </p>
          </div>
        ) : !mode ? (
          /* Mode selection */
          <div className="space-y-3 p-2">
            <p className="text-xs text-muted-foreground text-center">
              "What shall I forge for you today, {character.gender === 'female' ? 'your Majesty' : 'your Majesty'}?"
            </p>
            {canCrown && (
              <Button variant="outline" className="w-full justify-start gap-2 h-auto py-3 border-yellow-500/30 hover:bg-yellow-500/10"
                onClick={() => { setMode('crown'); setStats({}); }}>
                <span className="text-lg">👑</span>
                <div className="text-left">
                  <p className="text-sm font-display text-yellow-400">Forge the Royal Crown</p>
                  <p className="text-[10px] text-muted-foreground">A soulbound crown befitting a {character.gender === 'female' ? 'Queen' : 'King'}. (Level 40)</p>
                </div>
              </Button>
            )}
            {canSoulforge && (
              <Button variant="outline" className="w-full justify-start gap-2 h-auto py-3 border-soulforged/30 hover:bg-soulforged/10"
                onClick={() => { setMode('soulforge'); setStats({}); }}>
                <span className="text-lg">⚒️</span>
                <div className="text-left">
                  <p className="text-sm font-display text-soulforged">Forge a Soulbound Item</p>
                  <p className="text-[10px] text-muted-foreground">A unique creation of your choosing. (Level 42)</p>
                </div>
              </Button>
            )}
          </div>
        ) : (
          /* Forge UI */
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <Button variant="ghost" size="sm" className="text-xs h-6 px-2" onClick={reset}>← Back</Button>
              <span className="text-xs font-display text-muted-foreground">
                {mode === 'crown' ? '👑 Royal Crown' : '⚒️ Soulforge'}
              </span>
            </div>

            <p className="text-xs text-muted-foreground">
              {mode === 'crown'
                ? 'Forge your Royal Crown — a soulbound head piece. Choose its stats wisely; you may only do this once.'
                : 'Forge a unique soulbound item. It cannot be dropped or sold. Choose wisely — you may only do this once.'}
            </p>

            {/* Slot (soulforge only) — pick slot first so AI naming works */}
            {mode === 'soulforge' && (
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
            )}

            {/* Item Name (soulforge only) */}
            {mode === 'soulforge' && (
              <div>
                <label className="text-xs font-display text-muted-foreground">Item Name</label>
                <div className="flex gap-1.5 mt-1">
                  <Input
                    value={itemName}
                    onChange={e => setItemName(e.target.value)}
                    placeholder="Name your creation..."
                    maxLength={30}
                    className="h-8 text-sm font-display flex-1"
                  />
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-8 px-2 text-xs gap-1 border-soulforged/30 hover:bg-soulforged/10 text-soulforged disabled:opacity-40"
                    disabled={!slot || aiUsesLeft <= 0 || aiGenerating}
                    onClick={handleAiName}
                    title={!slot ? 'Pick a slot first' : aiUsesLeft <= 0 ? 'No AI tries left' : 'Generate a name with AI'}
                  >
                    <Sparkles className="h-3.5 w-3.5" />
                    {aiGenerating ? '...' : `AI (${aiUsesLeft})`}
                  </Button>
                </div>
                {aiSuggestion && (
                  <button
                    type="button"
                    className="mt-1.5 w-full text-left px-2 py-1.5 rounded border border-soulforged/30 bg-soulforged/5 hover:bg-soulforged/15 transition-colors group cursor-pointer"
                    onClick={() => { setItemName(aiSuggestion); setAiSuggestion(null); }}
                  >
                    <span className="text-[10px] text-muted-foreground">The spirits whisper…</span>
                    <p className="text-sm font-display text-soulforged group-hover:text-soulforged/80">
                      ✨ {aiSuggestion}
                    </p>
                    <span className="text-[9px] text-muted-foreground/60">Click to use this name</span>
                  </button>
                )}
                <p className="text-[10px] text-muted-foreground mt-0.5">
                  {itemName.length}/30
                  {!slot && aiUsesLeft > 0 && <span className="ml-1 text-soulforged/60">· Pick a slot to use AI naming</span>}
                </p>
              </div>
            )}

            {/* 1H/2H for main_hand */}
            {mode === 'soulforge' && slot === 'main_hand' && (
              <div className="flex gap-2">
                <Button size="sm" variant={hands === 1 ? 'default' : 'outline'} onClick={() => { setHands(1); setStats({}); }}
                  className="flex-1 h-7 text-xs font-display">One-Handed</Button>
                <Button size="sm" variant={hands === 2 ? 'default' : 'outline'} onClick={() => { setHands(2); setStats({}); }}
                  className="flex-1 h-7 text-xs font-display">Two-Handed</Button>
              </div>
            )}

            {/* Stats */}
            {activeSlot && (
              <StatAllocator
                stats={stats}
                setStats={setStats}
                budget={budget}
                cost={cost}
                slot={activeSlot}
                level={activeLevel}
              />
            )}

            {/* Preview */}
            {activeSlot && statCount >= 2 && (
              <div className={`p-2 rounded border ${mode === 'crown' ? 'border-yellow-500/30 bg-yellow-500/5' : 'border-soulforged/30 bg-soulforged/5'}`}>
                <p className={`text-xs font-display ${mode === 'crown' ? 'text-yellow-400' : 'text-soulforged'}`}>
                  {mode === 'crown' ? 'Crown' : (itemName || 'Unnamed')}
                </p>
                <p className="text-[10px] text-muted-foreground">Uncommon · Lvl {activeLevel} · Soulbound</p>
                <p className="text-[10px] text-muted-foreground capitalize">
                  {mode === 'crown' ? 'Head' : SLOTS.find(s => s.value === slot)?.label}
                  {mode === 'soulforge' && slot === 'main_hand' ? ` · ${hands === 2 ? 'Two-Handed' : 'One-Handed'}` : ''}
                </p>
                {Object.entries(stats).filter(([, v]) => v > 0).map(([k, v]) => (
                  <p key={k} className={`text-[10px] ${mode === 'crown' ? 'text-yellow-400' : 'text-soulforged'}`}>+{v} {STAT_LABELS[k]}</p>
                ))}
              </div>
            )}

            {/* Forge button */}
            <Button onClick={handleForge} disabled={!canForge}
              className={`w-full font-display ${mode === 'crown' ? 'bg-yellow-600/80 hover:bg-yellow-600 text-background' : 'bg-elvish/80 hover:bg-elvish text-background'}`}>
              {forging ? 'Forging...' : mode === 'crown' ? '👑 Forge Crown' : '⚒️ Forge Item'}
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
