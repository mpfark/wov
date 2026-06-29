/**
 * ForgeUpgradeView — shared Craft + Upgrade UI for blacksmith / jewelcrafter.
 *
 * The component does NOT enforce station/slot rules itself; it only renders
 * actions the caller routes to the correct edge function. Server-side checks
 * in forge-craft-base / forge-apply-gem / forge-strip are authoritative.
 */
import { useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ServicePanelEmpty } from '@/components/ui/ServicePanelShell';
import { supabase } from '@/integrations/supabase/client';
import { InventoryItem, getEffectiveStats } from '../hooks/useInventory';
import { useMaterials, notifyMaterialsChanged } from '../hooks/useMaterials';
import { GemIcon } from '@/components/icons/GemIcon';
import {
  GEM_CATALOG, PRIMARY_GEM_KEYS, type GemKey, attrForGem,
} from '@/shared/formulas/gems';
import {
  effectiveItemLevel,
  getItemStatBudget,
  getItemStatCap,
  calculateItemStatCost,
} from '@/shared/formulas/items';

const STAT_LABELS: Record<string, string> = {
  str: 'STR', dex: 'DEX', con: 'CON', int: 'INT', wis: 'WIS', cha: 'CHA',
  hp: 'HP', mp: 'MP', cp: 'CP', ac: 'AC', damage: 'DMG', hp_regen: 'HP/turn',
};

interface Props {
  characterId: string;
  characterLevel: number;
  gold: number;
  inventory: InventoryItem[];
  /** Slots the current workstation can serve (subset of equipment slots). */
  slots: { value: string; label: string }[];
  onGoldChange: (g: number) => void;
  onInventoryChange: () => void;
  addLog: (msg: string) => void;
  /** "Plain Blade", "Plain Ring", … — the noun for the craft button. */
  craftNoun?: string;
}

export function ForgeUpgradeView({
  characterId, characterLevel, gold, inventory, slots,
  onGoldChange, onInventoryChange, addLog, craftNoun = 'Base',
}: Props) {
  const { counts, byCategory } = useMaterials(characterId);
  const salvage = counts.salvage ?? 0;
  const ownedGems: Record<string, number> = {};
  for (const e of byCategory('gem')) if (e.count > 0) ownedGems[e.key] = e.count;

  const [craftSlot, setCraftSlot] = useState<string>('');
  const [working, setWorking] = useState<string | null>(null);
  const [selectedInvId, setSelectedInvId] = useState<string | null>(null);

  // Eligible items = matching slot + not soulbound + not unique/soulforged.
  const slotSet = useMemo(() => new Set(slots.map(s => s.value)), [slots]);
  const eligible = useMemo(() => inventory.filter(i => {
    if (!slotSet.has(i.item.slot as string)) return false;
    if (i.item.is_soulbound) return false;
    if (i.item.rarity === 'unique' || i.item.rarity === 'soulforged') return false;
    return true;
  }), [inventory, slotSet]);

  const craftSalvage = 5 + characterLevel * 2;
  const craftGold = characterLevel * 5;
  const canCraft = !!craftSlot && salvage >= craftSalvage && gold >= craftGold && !working;

  const handleCraft = async () => {
    if (!canCraft) return;
    setWorking('craft');
    try {
      const { data, error } = await supabase.functions.invoke('forge-craft-base', {
        body: { character_id: characterId, slot: craftSlot },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      onGoldChange(data.gold_remaining);
      notifyMaterialsChanged(characterId);
      onInventoryChange();
      addLog(`🔨 Crafted ${data.base_name} (Lv${data.crafted_level}). Apply gems to add stats.`);
      setSelectedInvId(data.inventory_id);
    } catch (e: any) {
      addLog(`❌ Craft failed: ${e.message || 'Unknown error'}`);
    }
    setWorking(null);
  };

  const selectedInv = eligible.find(i => i.id === selectedInvId) || null;

  const applyGem = async (gemKey: GemKey) => {
    if (!selectedInv || working) return;
    setWorking(`apply:${gemKey}`);
    try {
      const { data, error } = await supabase.functions.invoke('forge-apply-gem', {
        body: { character_id: characterId, inventory_id: selectedInv.id, gem_key: gemKey },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      onGoldChange(data.gold_remaining);
      notifyMaterialsChanged(characterId);
      onInventoryChange();
      const gemName = GEM_CATALOG[gemKey].name;
      addLog(`💠 Applied ${gemName} to ${selectedInv.item.name} (+1 ${attrForGem(gemKey).toUpperCase()}).`);
    } catch (e: any) {
      addLog(`❌ ${e.message || 'Could not apply gem'}`);
    }
    setWorking(null);
  };

  const stripItem = async () => {
    if (!selectedInv || working) return;
    const level = effectiveItemLevel(selectedInv.item.level, selectedInv.crafted_level);
    const goldCost = level * 10;
    const salvageCost = level * 3;
    if (gold < goldCost || salvage < salvageCost) {
      addLog(`❌ Strip costs ${salvageCost} salvage + ${goldCost} gold.`);
      return;
    }
    setWorking('strip');
    try {
      const { data, error } = await supabase.functions.invoke('forge-strip', {
        body: { character_id: characterId, inventory_id: selectedInv.id },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      onGoldChange(data.gold_remaining);
      notifyMaterialsChanged(characterId);
      onInventoryChange();
      addLog(`🧹 Stripped all gems from ${selectedInv.item.name}. Gems destroyed.`);
    } catch (e: any) {
      addLog(`❌ ${e.message || 'Strip failed'}`);
    }
    setWorking(null);
  };

  // ── Craft column ───────────────────────────────────────────────
  const craftBlock = (
    <div className="gap-section">
      <div>
        <h3 className="t-label text-[11px] mb-1">🔨 Craft a Plain {craftNoun}</h3>
        <p className="text-[10px] text-muted-foreground italic mb-2">
          Plain bases start with no stats. Apply gems to add attributes (subject to per-stat cap and the item's stat budget).
        </p>
      </div>
      <Select value={craftSlot} onValueChange={setCraftSlot}>
        <SelectTrigger className="font-display text-sm h-8">
          <SelectValue placeholder="Choose slot…" />
        </SelectTrigger>
        <SelectContent>
          {slots.map(s => (
            <SelectItem key={s.value} value={s.value} className="font-display text-sm">{s.label}</SelectItem>
          ))}
        </SelectContent>
      </Select>
      <div className="text-[10px] text-muted-foreground flex items-center gap-2">
        <span>Cost:</span>
        <span className={`font-display ${salvage >= craftSalvage ? 'text-dwarvish' : 'text-destructive'}`}>🔩 {craftSalvage}</span>
        <span>+</span>
        <span className={`font-display ${gold >= craftGold ? 'text-primary' : 'text-destructive'}`}>{craftGold}g</span>
      </div>
      <Button size="sm" onClick={handleCraft} disabled={!canCraft}
        className="font-display text-xs h-8 w-full">
        {working === 'craft' ? <span className="animate-pulse">Crafting…</span> : `Craft Plain ${craftNoun}`}
      </Button>
    </div>
  );

  // ── Upgrade column ─────────────────────────────────────────────
  let upgradeBlock: React.ReactNode;
  if (eligible.length === 0) {
    upgradeBlock = (
      <ServicePanelEmpty>
        Nothing to upgrade here — craft a plain base or bring eligible gear.
      </ServicePanelEmpty>
    );
  } else {
    upgradeBlock = (
      <div className="gap-section">
        <div>
          <h3 className="t-label text-[11px] mb-1">💠 Upgrade with Gems</h3>
          <p className="text-[10px] text-muted-foreground italic mb-1">
            Pick an item, then spend gems to add +1 to a stat each. Cost: 1 gem + (2 + level) salvage + (level × 2)g.
          </p>
        </div>

        <div className="gap-row">
          {eligible.map(inv => {
            const eff = getEffectiveStats(inv);
            const level = effectiveItemLevel(inv.item.level, inv.crafted_level);
            const budget = getItemStatBudget(level, inv.item.rarity || 'common', 1, 'equipment');
            const used = calculateItemStatCost(eff);
            const sel = inv.id === selectedInvId;
            const statBits = Object.entries(eff).filter(([, v]) => (v as number) !== 0);
            return (
              <button key={inv.id} type="button"
                onClick={() => setSelectedInvId(sel ? null : inv.id)}
                className={`w-full text-left p-2 rounded border transition-colors ${
                  sel ? 'border-primary bg-primary/10' : 'surface-row hover:bg-background/60'
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="text-sm font-display">{inv.item.name}</span>
                  <span className="text-[10px] text-muted-foreground">
                    Lv{level} · {used}/{budget}pts
                    {inv.equipped_slot && <span className="ml-1 text-elvish">·equipped</span>}
                  </span>
                </div>
                {statBits.length > 0 && (
                  <div className="flex flex-wrap gap-1 mt-0.5">
                    {statBits.map(([k, v]) => (
                      <span key={k} className="text-[10px] font-display text-elvish bg-elvish/10 px-1 rounded">
                        +{v as number} {STAT_LABELS[k] || k.toUpperCase()}
                      </span>
                    ))}
                  </div>
                )}
              </button>
            );
          })}
        </div>

        {selectedInv && (() => {
          const eff = getEffectiveStats(selectedInv);
          const level = effectiveItemLevel(selectedInv.item.level, selectedInv.crafted_level);
          const budget = getItemStatBudget(level, selectedInv.item.rarity || 'common', 1, 'equipment');
          const used = calculateItemStatCost(eff);
          const room = budget - used;
          const applySalvage = 2 + level;
          const applyGold = level * 2;
          const stripGold = level * 10;
          const stripSalvage = level * 3;
          return (
            <div className="gap-group border-t border-border-subtle pt-2">
              <div className="text-[10px] text-muted-foreground">
                Per-gem cost: <span className="font-display">🔩 {applySalvage}</span> + <span className="font-display">{applyGold}g</span> + 1 gem ·
                Room left: <span className="font-display">{room}pts</span>
              </div>
              <div className="grid grid-cols-3 gap-1.5">
                {PRIMARY_GEM_KEYS.map(gk => {
                  const def = GEM_CATALOG[gk];
                  const attr = attrForGem(gk);
                  const cap = getItemStatCap(attr, level, 'equipment');
                  const current = eff[attr] || 0;
                  const owned = ownedGems[gk] || 0;
                  const wouldCost = used + 1;
                  const atCap = current >= cap;
                  const noBudget = wouldCost > budget;
                  const disabled = !!working || owned < 1 || atCap || noBudget || gold < applyGold || salvage < applySalvage;
                  return (
                    <Button key={gk} size="sm" variant="outline"
                      onClick={() => applyGem(gk)} disabled={disabled}
                      className="font-display text-[10px] h-8 justify-between gap-1 px-2"
                      title={atCap ? `${attr.toUpperCase()} at cap (${cap})` : noBudget ? 'No budget left' : owned < 1 ? `Need a ${def.name}` : `+1 ${attr.toUpperCase()} (now ${current}/${cap})`}
                    >
                      <span className="inline-flex items-center gap-1">
                        <GemIcon color={def.color} size={10} />
                        +1 {attr.toUpperCase()}
                      </span>
                      <span className="text-muted-foreground">×{owned}</span>
                    </Button>
                  );
                })}
              </div>
              <Button size="sm" variant="ghost" onClick={stripItem}
                disabled={!!working || Object.values(selectedInv.applied_gems || {}).every(v => !v) || gold < stripGold || salvage < stripSalvage}
                className="font-display text-[10px] h-7 w-full text-destructive hover:text-destructive">
                🧹 Strip all gems ({stripSalvage} salvage + {stripGold}g — gems are destroyed)
              </Button>
            </div>
          );
        })()}
      </div>
    );
  }

  return { craftBlock, upgradeBlock };
}
