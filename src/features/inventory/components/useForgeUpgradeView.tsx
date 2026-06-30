/**
 * useForgeUpgradeView — shared Craft + Enhance UI for blacksmith / jewelcrafter.
 *
 * - craftBlock: pick a slot, then pick one of the available plain-base variants
 *   (e.g. Iron Helm, Leather Hood, Bronze Circlet for "head").
 * - upgradeBlock: pick an owned item, apply gems to add stats.
 *
 * Server enforces station/slot/ownership in forge-craft-base / forge-apply-gem /
 * forge-strip.
 */
import { useEffect, useMemo, useState } from 'react';
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
  getEffectiveStatCap,
  calculateItemStatCost,
  getCraftableTierForLevel,
  getCraftedLevelForTier,
  GEAR_TIERS,
} from '@/shared/formulas/items';
import { WEAPON_TAG_LABELS } from '@/lib/game-data';

const STAT_LABELS: Record<string, string> = {
  str: 'STR', dex: 'DEX', con: 'CON', int: 'INT', wis: 'WIS', cha: 'CHA',
  hp: 'HP', mp: 'MP', cp: 'CP', ac: 'AC', damage: 'DMG', hp_regen: 'HP/turn',
};

interface PlainBase {
  id: string;
  name: string;
  slot: string;
  hands: number | null;
  weapon_tag: string | null;
  tier: number | null;
}

interface Props {
  characterId: string;
  characterLevel: number;
  gold: number;
  inventory: InventoryItem[];
  slots: { value: string; label: string }[];
  onGoldChange: (g: number) => void;
  onInventoryChange: () => void;
  addLog: (msg: string) => void;
  craftNoun?: string;
}

export function useForgeUpgradeView({
  characterId, characterLevel, gold, inventory, slots,
  onGoldChange, onInventoryChange, addLog, craftNoun = 'Base',
}: Props) {
  const { counts, byCategory } = useMaterials(characterId);
  const salvage = counts.salvage ?? 0;
  const ownedGems: Record<string, number> = {};
  for (const e of byCategory('gem')) if (e.count > 0) ownedGems[e.key] = e.count;

  // Player's highest craftable tier (gates which plain bases appear).
  const playerTier = getCraftableTierForLevel(characterLevel);
  const tierItemLevel = getCraftedLevelForTier(playerTier);

  const [craftSlot, setCraftSlot] = useState<string>('');
  const [bases, setBases] = useState<PlainBase[]>([]);
  const [loadingBases, setLoadingBases] = useState(false);
  const [working, setWorking] = useState<string | null>(null);
  const [selectedInvId, setSelectedInvId] = useState<string | null>(null);

  // Load common plain bases for the player's tier, across the allowed slots.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoadingBases(true);
      const { data } = await supabase.from('items')
        .select('id, name, slot, hands, weapon_tag, tier')
        .eq('origin_type', 'plain_base')
        .eq('rarity', 'common')
        .eq('tier', playerTier)
        .in('slot', slots.map(s => s.value) as any)
        .order('weapon_tag', { nullsFirst: true })
        .order('name');
      if (!cancelled) {
        setBases((data as PlainBase[]) || []);
        setLoadingBases(false);
      }
    })();
    return () => { cancelled = true; };
  }, [slots, playerTier]);

  const basesForSlot = useMemo(
    () => bases.filter(b => b.slot === craftSlot),
    [bases, craftSlot],
  );

  // ── Enhance: eligible items = matching slot + not soulbound + not unique/soulforged.
  const slotSet = useMemo(() => new Set(slots.map(s => s.value)), [slots]);
  const eligible = useMemo(() => inventory.filter(i => {
    if (!slotSet.has(i.item.slot as string)) return false;
    if (i.item.is_soulbound) return false;
    if (i.item.rarity === 'unique' || i.item.rarity === 'soulforged') return false;
    return true;
  }), [inventory, slotSet]);

  // Cost scales with the tier's item level (matches the server).
  const craftSalvage = 5 + tierItemLevel * 2;
  const craftGold = tierItemLevel * 5;
  const canAffordCraft = salvage >= craftSalvage && gold >= craftGold;

  const handleCraft = async (base: PlainBase) => {
    if (!canAffordCraft || working) return;
    setWorking(`craft:${base.id}`);
    try {
      const { data, error } = await supabase.functions.invoke('forge-craft-base', {
        body: { character_id: characterId, item_id: base.id },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      onGoldChange(data.gold_remaining);
      notifyMaterialsChanged(characterId);
      onInventoryChange();
      addLog(`🔨 Crafted ${data.base_name} (Lv${data.crafted_level}). Apply gems via the Enhance tab.`);
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

  // ── Craft: left = slot picker + cost, right = base list under description.
  const craftBlock = (
    <div className="gap-section">
      <div>
        <h3 className="t-label text-[11px] mb-1">
          🔨 Craft a Plain {craftNoun}
          <span className="ml-2 text-[10px] text-muted-foreground font-normal">
            Tier {playerTier} · {GEAR_TIERS.find(t => t.tier === playerTier)?.prefix} (item Lv{tierItemLevel})
          </span>
        </h3>
        <p className="text-[10px] text-muted-foreground italic mb-2">
          Pick a slot, then choose a base style from the right column. All plain bases start without stats — socket gems via the Enhance tab. Uncommon (Fine) gear only drops from creatures.
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
        <span>Cost per craft:</span>
        <span className={`font-display ${salvage >= craftSalvage ? 'text-dwarvish' : 'text-destructive'}`}>🔩 {craftSalvage}</span>
        <span>+</span>
        <span className={`font-display ${gold >= craftGold ? 'text-primary' : 'text-destructive'}`}>{craftGold}g</span>
      </div>
    </div>
  );

  const craftBasesList = (
    <div className="gap-group">
      <div className="t-label text-[10px]">Available bases</div>
      {!craftSlot && (
        <p className="text-[10px] text-muted-foreground italic">Pick a slot on the left to see craftable bases.</p>
      )}
      {craftSlot && loadingBases && (
        <p className="text-[10px] text-muted-foreground italic">Loading bases…</p>
      )}
      {craftSlot && !loadingBases && basesForSlot.length === 0 && (
        <p className="text-[10px] text-muted-foreground italic">No plain bases defined for this slot.</p>
      )}
      {craftSlot && basesForSlot.length > 0 && (
        <div className="gap-row">
          {basesForSlot.map(base => {
            const tagBits: string[] = [];
            if (base.weapon_tag) tagBits.push(WEAPON_TAG_LABELS[base.weapon_tag] || base.weapon_tag);
            if (base.hands === 2) tagBits.push('Two-Handed');
            return (
              <Button key={base.id} size="sm" variant="outline"
                onClick={() => handleCraft(base)}
                disabled={!canAffordCraft || !!working}
                className="font-display text-xs h-auto py-2 w-full justify-between gap-2">
                <span className="text-left">
                  <span className="block">{base.name}</span>
                  {tagBits.length > 0 && (
                    <span className="block text-[9px] text-muted-foreground capitalize">{tagBits.join(' · ')}</span>
                  )}
                </span>
                <span className="text-[10px] text-muted-foreground shrink-0">
                  {working === `craft:${base.id}` ? '…' : 'Craft'}
                </span>
              </Button>
            );
          })}
        </div>
      )}
    </div>
  );

  // ── Enhance column ─────────────────────────────────────────────
  let enhanceLeft: React.ReactNode;
  if (eligible.length === 0) {
    enhanceLeft = (
      <ServicePanelEmpty>
        Nothing to enhance here — craft a plain base or bring eligible gear.
      </ServicePanelEmpty>
    );
  } else {
    enhanceLeft = (
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
    );
  }

  let enhanceRight: React.ReactNode;
  if (!selectedInv) {
    enhanceRight = (
      <ServicePanelEmpty>
        Select an item on the left to view its stats and socket gems.
      </ServicePanelEmpty>
    );
  } else {
    const eff = getEffectiveStats(selectedInv);
    const level = effectiveItemLevel(selectedInv.item.level, selectedInv.crafted_level);
    const budget = getItemStatBudget(level, selectedInv.item.rarity || 'common', 1, 'equipment');
    const used = calculateItemStatCost(eff);
    const room = budget - used;
    const applySalvage = 2 + level;
    const applyGold = level * 2;
    const stripGold = level * 10;
    const stripSalvage = level * 3;
    enhanceRight = (
      <div className="gap-section">
        <div>
          <h3 className="t-label text-[11px] mb-1">{selectedInv.item.name}</h3>
          <p className="text-[10px] text-muted-foreground">
            Lv{level} · Budget {used}/{budget}pts · Room <span className="font-display">{room}</span>
          </p>
        </div>

        <div className="gap-group">
          <div className="t-label text-[10px]">Current stats</div>
          {Object.entries(eff).filter(([, v]) => (v as number) !== 0).length === 0 ? (
            <p className="text-[10px] text-muted-foreground italic">No stats yet — apply gems below.</p>
          ) : (
            <div className="flex flex-wrap gap-1">
              {Object.entries(eff).filter(([, v]) => (v as number) !== 0).map(([k, v]) => (
                <span key={k} className="text-[10px] font-display text-elvish bg-elvish/10 px-1.5 py-0.5 rounded">
                  +{v as number} {STAT_LABELS[k] || k.toUpperCase()}
                </span>
              ))}
            </div>
          )}
        </div>

        <div className="gap-group border-t border-border-subtle pt-2">
          <div className="text-[10px] text-muted-foreground">
            Per-gem cost: <span className="font-display">🔩 {applySalvage}</span> + <span className="font-display">{applyGold}g</span> + 1 gem
          </div>
          <div className="grid grid-cols-2 gap-1.5">
            {PRIMARY_GEM_KEYS.map(gk => {
              const def = GEM_CATALOG[gk];
              const attr = attrForGem(gk);
              const cap = getEffectiveStatCap(attr, level, budget, 'equipment');
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
      </div>
    );
  }

  return { craftBlock, craftBasesList, enhanceLeft, enhanceRight };
}
