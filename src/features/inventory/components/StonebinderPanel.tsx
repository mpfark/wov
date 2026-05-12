import { useState, useEffect, useMemo, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { ServicePanelShell, ServicePanelEmpty } from '@/components/ui/ServicePanelShell';
import { supabase } from '@/integrations/supabase/client';
import { Sparkles } from 'lucide-react';
import { InventoryItem } from '@/features/inventory';
import ItemTooltipCard from '@/components/items/ItemTooltipCard';

const PRIMARY_STATS = new Set(['str', 'dex', 'con', 'int', 'wis', 'cha']);
const SECONDARY_STATS = new Set(['hp', 'hp_regen']);

const STONE_GLYPH: Record<string, string> = {
  str: '⚒', dex: '🗡', con: '🌳', int: '✦', wis: '🌊', cha: '🔔',
};

interface Props {
  open: boolean;
  onClose: () => void;
  characterId: string;
  inventory: InventoryItem[];
  onInventoryChange: () => void;
  addLog: (msg: string) => void;
}

/** A primary Turning Stone has rarity=unique, slot=trinket, name starting
 *  with "Turning Stone of " (not "Ascended"), and exactly ONE primary stat
 *  key after dropping hp / hp_regen. Mirrors the server check exactly. */
function isPrimaryTurningStone(inv: InventoryItem): boolean {
  const it = inv.item;
  if (!it) return false;
  if (it.rarity !== 'unique') return false;
  if (it.slot !== 'trinket') return false;
  if (it.item_type !== 'equipment') return false;
  if (!/^Turning Stone of /i.test(it.name)) return false;
  if (/^Ascended/i.test(it.name)) return false;
  const keys = Object.keys(it.stats || {}).filter((k) => !SECONDARY_STATS.has(k));
  return keys.length === 1 && PRIMARY_STATS.has(keys[0]);
}

function primaryStatOf(inv: InventoryItem): string | null {
  const keys = Object.keys(inv.item?.stats || {}).filter((k) => PRIMARY_STATS.has(k));
  return keys[0] ?? null;
}

interface PreviewResult {
  item: {
    id: string;
    name: string;
    description: string;
    rarity: string;
    slot: string | null;
    item_type: string;
    stats: Record<string, number>;
    value: number;
    max_durability: number;
    level: number;
  };
}

export default function StonebinderPanel({
  open, onClose, characterId, inventory, onInventoryChange, addLog,
}: Props) {
  const [stoneA, setStoneA] = useState<string | null>(null);
  const [stoneB, setStoneB] = useState<string | null>(null);
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [binding, setBinding] = useState(false);

  // Reset when reopened
  useEffect(() => {
    if (!open) {
      setStoneA(null); setStoneB(null);
      setPreview(null); setPreviewError(null);
    }
  }, [open]);

  const stones = useMemo(
    () => inventory
      .filter((i) => !i.equipped_slot)
      .filter(isPrimaryTurningStone)
      .sort((a, b) => a.item.name.localeCompare(b.item.name)),
    [inventory],
  );

  const stoneById = useCallback(
    (id: string | null) => (id ? stones.find((s) => s.id === id) : undefined),
    [stones],
  );

  const a = stoneById(stoneA);
  const b = stoneById(stoneB);

  const sameStat = !!(a && b && primaryStatOf(a) === primaryStatOf(b));

  // Fetch preview when both stones are selected and valid
  useEffect(() => {
    if (!open || !a || !b) { setPreview(null); setPreviewError(null); return; }
    if (sameStat) { setPreview(null); setPreviewError('The two stones must carry different essences.'); return; }
    let cancelled = false;
    setPreviewing(true);
    setPreview(null); setPreviewError(null);
    (async () => {
      try {
        const { data, error } = await supabase.functions.invoke('stonebinder-fuse', {
          body: { mode: 'preview', character_id: characterId, stone_a_inv_id: a.id, stone_b_inv_id: b.id },
        });
        if (cancelled) return;
        if (error) throw error;
        if (data?.error) throw new Error(data.error);
        setPreview(data as PreviewResult);
      } catch (e: any) {
        if (cancelled) return;
        setPreviewError(e?.message || 'Could not preview the binding.');
      } finally {
        if (!cancelled) setPreviewing(false);
      }
    })();
    return () => { cancelled = true; };
  }, [open, a, b, sameStat, characterId]);

  const handleSelect = (id: string) => {
    if (stoneA === id) { setStoneA(null); return; }
    if (stoneB === id) { setStoneB(null); return; }
    if (!stoneA) { setStoneA(id); return; }
    if (!stoneB) { setStoneB(id); return; }
    // Both filled — replace B with the new pick.
    setStoneB(id);
  };

  const canBind = !!preview && !previewError && !binding && !!a && !!b;

  const handleBind = async () => {
    if (!canBind || !a || !b) return;
    setBinding(true);
    try {
      const { data, error } = await supabase.functions.invoke('stonebinder-fuse', {
        body: { mode: 'fuse', character_id: characterId, stone_a_inv_id: a.id, stone_b_inv_id: b.id },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      addLog(`⚜ The Stonebinder binds ${a.item.name} and ${b.item.name} into ${data.item.name}.`);
      setStoneA(null); setStoneB(null); setPreview(null);
      onInventoryChange();
    } catch (e: any) {
      addLog(`❌ Binding failed: ${e?.message || 'Unknown error'}`);
    } finally {
      setBinding(false);
    }
  };

  const left = stones.length === 0 ? (
    <ServicePanelEmpty>You carry no primary Turning Stones.</ServicePanelEmpty>
  ) : (
    <div className="space-y-1.5">
      {stones.map((inv) => {
        const stat = primaryStatOf(inv);
        const selected = inv.id === stoneA || inv.id === stoneB;
        const role = inv.id === stoneA ? 'A' : inv.id === stoneB ? 'B' : null;
        return (
          <button
            type="button"
            key={inv.id}
            onClick={() => handleSelect(inv.id)}
            className={`w-full text-left p-2 rounded border transition-colors flex items-center gap-2 ${
              selected
                ? 'border-primary bg-primary/10'
                : 'border-border bg-background/40 hover:bg-background/60'
            }`}
          >
            <span className="text-base shrink-0" aria-hidden>{stat ? STONE_GLYPH[stat] : '◇'}</span>
            <span className="flex-1 min-w-0 font-display text-sm text-primary text-glow truncate">
              {inv.item.name}
            </span>
            {role && (
              <span className="font-display text-[10px] text-primary border border-primary/40 rounded px-1.5 py-0.5">
                {role}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );

  const right = (
    <div className="space-y-3">
      {!a && !b && (
        <ServicePanelEmpty>Choose two stones of different essence to bind.</ServicePanelEmpty>
      )}
      {(a || b) && !preview && !previewError && previewing && (
        <p className="text-xs text-muted-foreground italic animate-pulse">The Stonebinder studies the essences...</p>
      )}
      {(a && !b) && (
        <p className="text-xs text-muted-foreground italic">Choose a second stone to complete the rite.</p>
      )}
      {previewError && (
        <p className="text-xs text-destructive">{previewError}</p>
      )}
      {preview && (
        <>
          <div className="rounded border border-primary/40 bg-primary/5 p-2">
            <ItemTooltipCard
              item={{
                id: preview.item.id,
                name: preview.item.name,
                description: preview.item.description,
                item_type: preview.item.item_type,
                rarity: preview.item.rarity,
                slot: preview.item.slot,
                stats: preview.item.stats,
                value: preview.item.value,
                max_durability: preview.item.max_durability,
                hands: null,
                level: preview.item.level,
              } as any}
            />
          </div>
          <p className="text-xs text-destructive font-display text-center">
            ⚠ The originals will be consumed forever.
          </p>
        </>
      )}
    </div>
  );

  const footer = (
    <div className="flex items-center justify-between gap-2">
      <span className="text-xs text-muted-foreground italic">
        Two stones, one bound essence.
      </span>
      <Button
        size="sm"
        onClick={handleBind}
        disabled={!canBind}
        className="font-display text-xs h-8"
      >
        {binding ? <span className="animate-pulse">Binding...</span> : (<><Sparkles className="w-3 h-3 mr-1" /> Bind Stones</>)}
      </Button>
    </div>
  );

  return (
    <ServicePanelShell
      open={open}
      onClose={onClose}
      icon="⚜"
      title="Stonebinder"
      subtitle={<span>Two stones, one bound essence.</span>}
      left={left}
      leftTitle="Primary Turning Stones"
      right={right}
      rightTitle="The Binding"
      footer={footer}
    />
  );
}
