import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Gift, MapPin, Sparkles, Heart, Trash2, RotateCcw } from 'lucide-react';
import { AdminFormSection, AdminEmptyState } from '../common';
import ItemPicker from '../ItemPicker';
import NodePicker from '../NodePicker';
import CharacterSummaryCard from './CharacterSummaryCard';
import type { AdminCharacter, AdminUser, AdminNode } from './constants';

interface Props {
  selectedUser: AdminUser | null;
  selectedChar: AdminCharacter | null;
  allItems: { id: string; name: string; rarity: string; level: number; slot: string | null }[];
  allNodes: AdminNode[];
  allRegions: { id: string; name: string }[];
  allAreas: { id: string; name: string }[];
  giveItemId: string;
  setGiveItemId: (id: string) => void;
  givingItem: boolean;
  teleportNodeId: string;
  setTeleportNodeId: (id: string) => void;
  grantXpAmount: number;
  setGrantXpAmount: (n: number) => void;
  grantRespecAmount: number;
  setGrantRespecAmount: (n: number) => void;
  grantSalvageAmount: number;
  setGrantSalvageAmount: (n: number) => void;
  removeItemId: string;
  setRemoveItemId: (id: string) => void;
  onGiveItem: (charId: string) => void;
  onTeleport: (charId: string) => void;
  onGrantXp: (charId: string) => void;
  onGrantRespec: (charId: string) => void;
  onGrantSalvage: (charId: string) => void;
  onRevive: (charId: string) => void;
  onResetStats: (charId: string) => void;
  onRemoveItem: () => void;
}

export default function CharacterActionsColumn({
  selectedUser, selectedChar, allItems, allNodes, allRegions, allAreas,
  giveItemId, setGiveItemId, givingItem,
  teleportNodeId, setTeleportNodeId,
  grantXpAmount, setGrantXpAmount,
  grantRespecAmount, setGrantRespecAmount,
  grantSalvageAmount, setGrantSalvageAmount,
  removeItemId, setRemoveItemId,
  onGiveItem, onTeleport, onGrantXp, onGrantRespec, onGrantSalvage,
  onRevive, onResetStats, onRemoveItem,
}: Props) {
  const nodeName = selectedChar?.current_node_id
    ? allNodes.find(n => n.id === selectedChar.current_node_id)?.name
    : undefined;

  const rarityColor = (rarity: string) => {
    if (rarity === 'unique') return 'text-primary';
    if (rarity === 'uncommon') return 'text-elvish';
    return 'text-foreground';
  };

  if (!selectedChar) {
    return (
      <div className="w-[420px] shrink-0 border-r border-border flex flex-col">
        <AdminEmptyState message={!selectedUser ? 'Select a user' : 'Select a character'} />
      </div>
    );
  }

  return (
    <div className="w-[420px] shrink-0 border-r border-border flex flex-col overflow-y-auto">
      <ScrollArea className="flex-1">
        <div className="p-3 space-y-3">
          {/* Character summary at top */}
          <CharacterSummaryCard character={selectedChar} nodeName={nodeName} />

          {/* Items & Inventory */}
          <AdminFormSection title="Items & Inventory">
            <div className="space-y-2">
              {/* Give Item */}
              <div className="flex gap-1">
                <div className="flex-1">
                  <ItemPicker
                    items={allItems}
                    value={giveItemId || null}
                    onChange={v => setGiveItemId(v || '')}
                    placeholder="Item..."
                    className="h-7"
                  />
                </div>
                <Button size="sm" variant="outline" className="h-7 text-[10px] gap-1 shrink-0"
                  disabled={!giveItemId || givingItem} onClick={() => onGiveItem(selectedChar.id)}>
                  <Gift className="w-3 h-3" /> Give
                </Button>
              </div>

              {/* Remove Item */}
              {selectedChar.inventory.length > 0 && (
                <div className="flex gap-1">
                  <Select value={removeItemId} onValueChange={setRemoveItemId}>
                    <SelectTrigger className="h-7 flex-1 text-[10px]">
                      <SelectValue placeholder="Remove item..." />
                    </SelectTrigger>
                    <SelectContent className="bg-popover border-border z-50 max-h-60">
                      {selectedChar.inventory.map(inv => (
                        <SelectItem key={inv.id} value={inv.id} className="text-xs">
                          <span className={rarityColor(inv.item.rarity)}>{inv.item.name}</span>
                          {inv.equipped_slot && <span className="text-muted-foreground ml-1">(eq)</span>}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button size="sm" variant="destructive" className="h-7 text-[10px] gap-1 shrink-0"
                    disabled={!removeItemId} onClick={onRemoveItem}>
                    <Trash2 className="w-3 h-3" /> Rm
                  </Button>
                </div>
              )}
            </div>
          </AdminFormSection>

          {/* Progression */}
          <AdminFormSection title="Progression">
            <div className="space-y-2">
              <div className="flex gap-1">
                <Input type="number" min={1} value={grantXpAmount}
                  onChange={e => setGrantXpAmount(parseInt(e.target.value) || 0)}
                  className="h-7 text-[10px] w-20" placeholder="XP" />
                <Button size="sm" variant="outline" className="h-7 text-[10px] gap-1 flex-1"
                  disabled={grantXpAmount <= 0} onClick={() => onGrantXp(selectedChar.id)}>
                  <Sparkles className="w-3 h-3" /> Grant XP
                </Button>
              </div>

              <div className="flex gap-1">
                <Input type="number" min={1} value={grantRespecAmount}
                  onChange={e => setGrantRespecAmount(parseInt(e.target.value) || 0)}
                  className="h-7 text-[10px] w-20" placeholder="Pts" />
                <Button size="sm" variant="outline" className="h-7 text-[10px] gap-1 flex-1"
                  disabled={grantRespecAmount <= 0} onClick={() => onGrantRespec(selectedChar.id)}>
                  <RotateCcw className="w-3 h-3" /> Grant Respec
                </Button>
              </div>

              <div className="flex gap-1">
                <Input type="number" min={1} value={grantSalvageAmount}
                  onChange={e => setGrantSalvageAmount(parseInt(e.target.value) || 0)}
                  className="h-7 text-[10px] w-20" placeholder="🔩" />
                <Button size="sm" variant="outline" className="h-7 text-[10px] gap-1 flex-1"
                  disabled={grantSalvageAmount <= 0} onClick={() => onGrantSalvage(selectedChar.id)}>
                  🔩 Grant Salvage
                </Button>
              </div>
            </div>
          </AdminFormSection>

          {/* Movement */}
          <AdminFormSection title="Movement">
            <div className="flex gap-1">
              <div className="flex-1">
                <NodePicker
                  nodes={allNodes}
                  regions={allRegions}
                  areas={allAreas}
                  value={teleportNodeId || null}
                  onChange={v => setTeleportNodeId(v || '')}
                  placeholder="Node..."
                  className="h-7"
                />
              </div>
              <Button size="sm" variant="outline" className="h-7 text-[10px] gap-1 shrink-0"
                disabled={!teleportNodeId} onClick={() => onTeleport(selectedChar.id)}>
                <MapPin className="w-3 h-3" /> Tp
              </Button>
            </div>
          </AdminFormSection>

          {/* Character Management */}
          <AdminFormSection title="Character Management">
            <div className="flex flex-wrap gap-1">
              <Button size="sm" variant="outline" className="h-7 text-[10px] gap-1"
                disabled={selectedChar.hp >= selectedChar.max_hp} onClick={() => onRevive(selectedChar.id)}>
                <Heart className="w-3 h-3" /> Revive
                {selectedChar.hp < selectedChar.max_hp && <span className="text-blood">({selectedChar.hp}/{selectedChar.max_hp})</span>}
              </Button>

              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button size="sm" variant="outline" className="h-7 text-[10px] gap-1">
                    <RotateCcw className="w-3 h-3" /> Reset Stats
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent className="bg-popover border-border">
                  <AlertDialogHeader>
                    <AlertDialogTitle>Reset Stats?</AlertDialogTitle>
                    <AlertDialogDescription>
                      This will reset all stat allocations for <span className="font-display text-primary">{selectedChar.name}</span> and refund the points. This action cannot be undone.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction onClick={() => onResetStats(selectedChar.id)}>
                      Reset Stats
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </div>
          </AdminFormSection>
        </div>
      </ScrollArea>
    </div>
  );
}
