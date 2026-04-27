/**
 * useSoulforgeForge — hook providing the Soulforge UI as slot nodes
 * (left/right/footer + titles) for embedding inside a persistent
 * ServicePanelShell. State persists across tab switches because the hook
 * lives in the parent component.
 *
 * Server enforcement (level gates, ownership, "already forged" guards) lives
 * in the `soulforge-item` edge function — this hook is purely UI.
 */
import { useMemo, useState, ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Sparkles } from 'lucide-react';
import { Character } from '@/features/character';
import { ServicePanelEmpty } from '@/components/ui/ServicePanelShell';
import { getItemStatBudget, getItemStatCap, calculateItemStatCost, ITEM_STAT_COSTS } from '@/lib/game-data';
import { supabase } from '@/integrations/supabase/client';
import { toast } from '@/hooks/use-toast';

type ForgeMode = 'crown' | 'soulforge';

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

interface UseSoulforgeForgeOptions {
  character: Character | null;
  onForged: () => void;
}

export interface SoulforgeSlots {
  left: ReactNode;
  right: ReactNode;
  footer: ReactNode;
  leftTitle?: ReactNode;
  rightTitle?: ReactNode;
}

export function useSoulforgeForge({ character, onForged }: UseSoulforgeForgeOptions): SoulforgeSlots {
  const [mode, setMode] = useState<ForgeMode | null>(null);
  const [itemName, setItemName] = useState('');
  const [slot, setSlot] = useState('');
  const [hands, setHands] = useState<1 | 2>(1);
  const [stats, setStats] = useState<Record<string, number>>({});
  const [forging, setForging] = useState(false);
  const [aiUsesLeft, setAiUsesLeft] = useState(3);
  const [aiGenerating, setAiGenerating] = useState(false);
  const [aiSuggestion, setAiSuggestion] = useState<string | null>(null);

  // Guard against placeholder / unloaded character. All hooks above must
  // run unconditionally; this early return lives strictly after them and
  // before any branch that reads character fields, so we never compute
  // the misleading "not worthy" branch for a phantom level-0 character.
  const hasCharacter = !!character && !!character.id && (character.level ?? 0) > 0;

  const activeSlot = mode === 'crown' ? 'head' : slot;
  const activeLevel = mode === 'crown' ? 40 : 42;
  const effectiveHands = activeSlot === 'main_hand' ? hands : 1;
  const budget = useMemo(
    () => activeSlot ? getItemStatBudget(activeLevel, 'uncommon', effectiveHands) : 0,
    [activeSlot, activeLevel, effectiveHands]
  );
  const cost = useMemo(() => calculateItemStatCost(stats), [stats]);
  const remaining = budget - cost;
  const statCount = Object.keys(stats).filter(k => stats[k] > 0).length;

  const canForge = !!mode && !!activeSlot && statCount >= 2 && remaining >= 0 && !forging &&
    (mode === 'crown' || (itemName.trim().length >= 1 && itemName.trim().length <= 30 && /^[\x20-\x7E]+$/.test(itemName)));

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
      const parsed = typeof data === 'string' ? JSON.parse(data) : data;
      if (parsed?.error) throw new Error(parsed.error);
      if (error) throw error;
      const label = mode === 'crown' ? 'Crown' : itemName.trim();
      toast({ title: '⚒️ Soulforged!', description: `${label} has been forged into existence.` });
      onForged();
      reset();
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

  const addStat = (key: string) => {
    const current = stats[key] || 0;
    const cap = getItemStatCap(key, activeLevel);
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

  // ── Empty / not-worthy / done states (single column) ──────────────
  if (isNotWorthy) {
    const empty = (
      <div className="p-4 text-center space-y-2">
        <p className="text-sm text-foreground/80 italic">
          "You are not yet worthy, wayfarer. Return when you have proven your reign."
        </p>
        <p className="text-xs text-muted-foreground">(Reach level 40 to forge your Crown.)</p>
      </div>
    );
    return { left: empty, right: null, footer: null, leftTitle: 'The Soulwright\'s Anvil' };
  }
  if (allDone) {
    const done = (
      <div className="p-4 text-center space-y-2">
        <p className="text-sm text-foreground/80 italic">
          "You have forged all that fate allows. Your legacy is complete."
        </p>
      </div>
    );
    return { left: done, right: null, footer: null, leftTitle: 'The Soulwright\'s Anvil' };
  }

  // ── Mode selection ────────────────────────────────────────────────
  if (!mode) {
    const modePick = (
      <div className="space-y-3">
        <p className="text-xs text-muted-foreground text-center italic">
          "What shall I forge for you today, your Majesty?"
        </p>
        {canCrown && (
          <Button
            variant="outline"
            className="w-full justify-start gap-2 h-auto py-3 border-yellow-500/30 hover:bg-yellow-500/10"
            onClick={() => { setMode('crown'); setStats({}); }}
          >
            <span className="text-lg">👑</span>
            <div className="text-left">
              <p className="text-sm font-display text-yellow-400">Forge the Royal Crown</p>
              <p className="text-[10px] text-muted-foreground">
                A soulbound crown befitting a {character.gender === 'female' ? 'Queen' : 'King'}. (Level 40)
              </p>
            </div>
          </Button>
        )}
        {canSoulforge && (
          <Button
            variant="outline"
            className="w-full justify-start gap-2 h-auto py-3 border-soulforged/30 hover:bg-soulforged/10"
            onClick={() => { setMode('soulforge'); setStats({}); }}
          >
            <span className="text-lg">⚒️</span>
            <div className="text-left">
              <p className="text-sm font-display text-soulforged">Forge a Soulbound Item</p>
              <p className="text-[10px] text-muted-foreground">A unique creation of your choosing. (Level 42)</p>
            </div>
          </Button>
        )}
      </div>
    );
    const intro = (
      <div className="space-y-2 text-[11px] text-muted-foreground">
        <p>The Soulforge binds raw will into a single legacy item.</p>
        <p>Each character may forge a Royal Crown at level 40, and a Soulbound Item at level 42 — once each.</p>
        <p className="text-soulforged">Forged items cannot be dropped, sold, or traded.</p>
      </div>
    );
    return { left: modePick, right: intro, footer: null, leftTitle: 'The Soulwright\'s Anvil', rightTitle: 'About the Soulforge' };
  }

  // ── Active forge flow ────────────────────────────────────────────
  const left = (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <Button variant="ghost" size="sm" className="text-xs h-6 px-2" onClick={reset}>← Back</Button>
        <span className="text-xs font-display text-muted-foreground">
          {mode === 'crown' ? '👑 Royal Crown' : '⚒️ Soulforge'}
        </span>
      </div>

      <p className="text-[11px] text-muted-foreground">
        {mode === 'crown'
          ? 'Choose its stats wisely; you may only do this once.'
          : 'Forge a unique soulbound item. Choose wisely — you may only do this once.'}
      </p>

      {mode === 'soulforge' && (
        <div>
          <label className="text-xs font-display text-muted-foreground">Equipment Slot</label>
          <Select value={slot} onValueChange={v => { setSlot(v); setStats({}); }}>
            <SelectTrigger className="h-8 text-sm mt-1">
              <SelectValue placeholder="Choose slot..." />
            </SelectTrigger>
            <SelectContent>
              {SLOTS.map(s => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      )}

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
              <p className="text-sm font-display text-soulforged group-hover:text-soulforged/80">✨ {aiSuggestion}</p>
              <span className="text-[9px] text-muted-foreground/60">Click to use this name</span>
            </button>
          )}
          <p className="text-[10px] text-muted-foreground mt-0.5">{itemName.length}/30</p>
        </div>
      )}

      {mode === 'soulforge' && slot === 'main_hand' && (
        <div className="flex gap-2">
          <Button size="sm" variant={hands === 1 ? 'default' : 'outline'} onClick={() => { setHands(1); setStats({}); }}
            className="flex-1 h-7 text-xs font-display">One-Handed</Button>
          <Button size="sm" variant={hands === 2 ? 'default' : 'outline'} onClick={() => { setHands(2); setStats({}); }}
            className="flex-1 h-7 text-xs font-display">Two-Handed</Button>
        </div>
      )}
    </div>
  );

  const right = (
    <div className="space-y-3">
      {!activeSlot ? (
        <ServicePanelEmpty>Select a slot to begin allocating stats.</ServicePanelEmpty>
      ) : (
        <>
          <div className="flex items-center justify-between">
            <label className="text-xs font-display text-muted-foreground">Allocate Stats</label>
            <span className={`text-xs font-display tabular-nums ${remaining < 0 ? 'text-destructive' : remaining === 0 ? 'text-soulforged' : 'text-muted-foreground'}`}>
              {remaining} / {budget} pts
            </span>
          </div>
          <div className="space-y-1">
            {STAT_KEYS.filter(key => key !== 'potion_slots' || activeSlot === 'belt').map(key => {
              const val = stats[key] || 0;
              const cap = getItemStatCap(key, activeLevel);
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
        </>
      )}
    </div>
  );

  const footer = (
    <div className="flex items-center justify-between gap-2">
      <span className="text-xs text-muted-foreground italic">
        {forging ? 'Channeling…' : mode === 'crown' ? 'A crown of legacy.' : 'A unique soulbound creation.'}
      </span>
      <Button
        onClick={handleForge}
        disabled={!canForge}
        className={`font-display text-xs h-8 ${mode === 'crown' ? 'bg-yellow-600/80 hover:bg-yellow-600 text-background' : 'bg-elvish/80 hover:bg-elvish text-background'}`}
      >
        {forging ? 'Forging...' : mode === 'crown' ? '👑 Forge Crown' : '⚒️ Forge Item'}
      </Button>
    </div>
  );

  return { left, right, footer, leftTitle: 'The Soulwright\'s Anvil', rightTitle: 'Stat Allocation' };
}

export default useSoulforgeForge;
