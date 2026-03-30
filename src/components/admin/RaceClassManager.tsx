import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ScrollArea } from '@/components/ui/scroll-area';
// Select components imported via line 7 above
import ItemPicker from './ItemPicker';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { Sword, Shield } from 'lucide-react';
import {
  RACE_STATS, CLASS_STATS, CLASS_BASE_HP, CLASS_BASE_AC,
  RACE_LABELS, CLASS_LABELS, RACE_DESCRIPTIONS, CLASS_DESCRIPTIONS,
  STAT_LABELS, CLASS_LEVEL_BONUSES,
} from '@/lib/game-data';
import { CLASS_COMBAT, CLASS_ABILITIES } from '@/features/combat';

const STAT_KEYS = ['str', 'dex', 'con', 'int', 'wis', 'cha'] as const;

function StatBadge({ value }: { value: number }) {
  const color = value > 0 ? 'text-green-400' : value < 0 ? 'text-red-400' : 'text-muted-foreground';
  return (
    <span className={`font-mono text-xs ${color}`}>
      {value > 0 ? `+${value}` : value}
    </span>
  );
}

const EQUIP_SLOTS = [
  { key: 'head', label: 'Head' },
  { key: 'amulet', label: 'Amulet' },
  { key: 'shoulders', label: 'Shoulders' },
  { key: 'chest', label: 'Chest' },
  { key: 'gloves', label: 'Gloves' },
  { key: 'belt', label: 'Belt' },
  { key: 'pants', label: 'Pants' },
  { key: 'boots', label: 'Boots' },
  { key: 'ring', label: 'Ring' },
  { key: 'trinket', label: 'Trinket' },
  { key: 'off_hand', label: 'Off Hand' },
] as const;

export default function RaceClassManager() {
  const [tab, setTab] = useState('classes');
  const [allItems, setAllItems] = useState<any[]>([]);
  const [weapons, setWeapons] = useState<any[]>([]);
  const [startingGear, setStartingGear] = useState<Record<string, string>>({});
  const [universalGear, setUniversalGear] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState<string | null>(null);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    const [itemsRes, gearRes, uGearRes] = await Promise.all([
      supabase.from('items').select('id, name, slot, item_type, rarity').order('name'),
      supabase.from('class_starting_gear').select('*'),
      supabase.from('universal_starting_gear').select('*'),
    ]);
    const items = itemsRes.data || [];
    setAllItems(items);
    setWeapons(items.filter((i: any) => i.slot === 'main_hand'));
    const gearMap: Record<string, string> = {};
    (gearRes.data || []).forEach((g: any) => { gearMap[g.class] = g.item_id; });
    setStartingGear(gearMap);
    const uMap: Record<string, string> = {};
    (uGearRes.data || []).forEach((g: any) => { uMap[g.equipped_slot] = g.item_id; });
    setUniversalGear(uMap);
  };

  const handleSetWeapon = async (cls: string, itemId: string) => {
    setSaving(cls);
    const existing = startingGear[cls];
    let error;
    if (existing) {
      ({ error } = await supabase.from('class_starting_gear').update({ item_id: itemId }).eq('class', cls as any));
    } else {
      ({ error } = await supabase.from('class_starting_gear').insert({ class: cls as any, item_id: itemId }));
    }
    if (error) {
      toast.error(error.message);
    } else {
      setStartingGear(prev => ({ ...prev, [cls]: itemId }));
      toast.success(`Starting weapon set for ${CLASS_LABELS[cls]}`);
    }
    setSaving(null);
  };

  const handleClearWeapon = async (cls: string) => {
    setSaving(cls);
    const { error } = await supabase.from('class_starting_gear').delete().eq('class', cls as any);
    if (error) {
      toast.error(error.message);
    } else {
      setStartingGear(prev => { const n = { ...prev }; delete n[cls]; return n; });
      toast.success(`Starting weapon cleared for ${CLASS_LABELS[cls]}`);
    }
    setSaving(null);
  };

  

  const handleSetUniversalGear = async (slot: string, itemId: string) => {
    setSaving(`u_${slot}`);
    const existing = universalGear[slot];
    let error;
    if (existing) {
      ({ error } = await supabase.from('universal_starting_gear').update({ item_id: itemId }).eq('equipped_slot', slot));
    } else {
      ({ error } = await supabase.from('universal_starting_gear').insert({ item_id: itemId, equipped_slot: slot }));
    }
    if (error) {
      toast.error(error.message);
    } else {
      setUniversalGear(prev => ({ ...prev, [slot]: itemId }));
      toast.success(`Universal ${slot} gear set`);
    }
    setSaving(null);
  };

  const handleClearUniversalGear = async (slot: string) => {
    setSaving(`u_${slot}`);
    const { error } = await supabase.from('universal_starting_gear').delete().eq('equipped_slot', slot);
    if (error) {
      toast.error(error.message);
    } else {
      setUniversalGear(prev => { const n = { ...prev }; delete n[slot]; return n; });
      toast.success(`Universal ${slot} gear cleared`);
    }
    setSaving(null);
  };

  const getItemsForSlot = (slot: string) => allItems.filter(i => i.slot === slot);

  return (
    <div className="h-full flex flex-col overflow-hidden">
      <Tabs value={tab} onValueChange={setTab} className="flex-1 flex flex-col min-h-0">
        <div className="px-4 pt-2 shrink-0">
          <TabsList className="h-8">
            <TabsTrigger value="classes" className="font-display text-xs">Classes</TabsTrigger>
            <TabsTrigger value="races" className="font-display text-xs">Races</TabsTrigger>
            <TabsTrigger value="starter-gear" className="font-display text-xs">Starter Gear</TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="classes" className="flex-1 min-h-0 mt-0">
          <ScrollArea className="h-full">
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3 p-4">
              {Object.keys(CLASS_LABELS).map(cls => {
                const combat = CLASS_COMBAT[cls];
                const levelBonus = CLASS_LEVEL_BONUSES[cls] || {};
                const currentWeaponId = startingGear[cls];
                return (
                  <Card key={cls} className="bg-card/80 border-border">
                    <CardHeader className="pb-2 pt-4 px-4">
                      <CardTitle className="text-sm font-display flex items-center gap-2">
                        <span className="text-lg">{combat?.emoji}</span>
                        {CLASS_LABELS[cls]}
                        <Badge variant="outline" className="ml-auto text-[10px]">
                          HP {CLASS_BASE_HP[cls]} · AC {CLASS_BASE_AC[cls]}
                        </Badge>
                      </CardTitle>
                      <p className="text-xs text-muted-foreground">{CLASS_DESCRIPTIONS[cls]}</p>
                    </CardHeader>
                    <CardContent className="px-4 pb-4 space-y-3">
                      {/* Base stats */}
                      <div>
                        <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1">Base Stat Bonuses</p>
                        <div className="grid grid-cols-6 gap-1">
                          {STAT_KEYS.map(s => (
                            <div key={s} className="text-center">
                              <div className="text-[10px] text-muted-foreground">{STAT_LABELS[s]}</div>
                              <StatBadge value={CLASS_STATS[cls]?.[s] || 0} />
                            </div>
                          ))}
                        </div>
                      </div>

                      {/* Level-up bonuses */}
                      <div>
                        <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1">Every 3 Levels</p>
                        <div className="flex gap-2">
                          {Object.entries(levelBonus).map(([stat, val]) => (
                            <Badge key={stat} variant="secondary" className="text-[10px]">
                              {STAT_LABELS[stat]} +{val}
                            </Badge>
                          ))}
                        </div>
                      </div>

                      {/* Combat ability */}
                      {combat && (
                        <div>
                          <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1">Primary Action</p>
                          <div className="text-xs bg-secondary/50 rounded p-2 space-y-0.5">
                            <div className="font-medium">{combat.emoji} {combat.label}</div>
                            <div className="text-muted-foreground">
                              {STAT_LABELS[combat.stat]} · {combat.diceMin}d{combat.diceMax} damage
                              {combat.critRange < 20 && ` · Crit ${combat.critRange}-20`}
                            </div>
                          </div>
                        </div>
                      )}

                      {/* Class Abilities */}
                      {CLASS_ABILITIES[cls] && CLASS_ABILITIES[cls].length > 0 && (
                        <div>
                          <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1">Class Abilities</p>
                          <div className="space-y-1.5">
                            {CLASS_ABILITIES[cls].map((ability, idx) => (
                              <div key={idx} className="text-xs bg-secondary/50 rounded p-2 space-y-0.5">
                                <div className="font-medium flex items-center gap-1">
                                  {ability.emoji} {ability.label}
                                  <Badge variant="outline" className="text-[9px] ml-auto">
                                    Tier {ability.tier} · Lvl {ability.levelRequired}
                                  </Badge>
                                </div>
                                <div className="text-muted-foreground">
                                  {ability.description} · {ability.cpCost} CP
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Starting weapon */}
                      <div>
                        <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1 flex items-center gap-1">
                          <Sword className="w-3 h-3" /> Starting Weapon
                        </p>
                        <div className="flex items-center gap-2">
                          <div className="flex-1">
                            <ItemPicker
                              items={weapons}
                              value={currentWeaponId || null}
                              onChange={v => { if (v) handleSetWeapon(cls, v); }}
                              placeholder="None assigned"
                              className="h-7"
                            />
                          </div>
                          {currentWeaponId && (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 text-xs text-destructive"
                              onClick={() => handleClearWeapon(cls)}
                              disabled={saving === cls}
                            >
                              Clear
                            </Button>
                          )}
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          </ScrollArea>
        </TabsContent>

        <TabsContent value="races" className="flex-1 min-h-0 mt-0">
          <ScrollArea className="h-full">
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3 p-4">
              {Object.keys(RACE_LABELS).map(race => (
                <Card key={race} className="bg-card/80 border-border">
                  <CardHeader className="pb-2 pt-4 px-4">
                    <CardTitle className="text-sm font-display">{RACE_LABELS[race]}</CardTitle>
                    <p className="text-xs text-muted-foreground">{RACE_DESCRIPTIONS[race]}</p>
                  </CardHeader>
                  <CardContent className="px-4 pb-4">
                    <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1">Stat Modifiers</p>
                    <div className="grid grid-cols-6 gap-1">
                      {STAT_KEYS.map(s => (
                        <div key={s} className="text-center">
                          <div className="text-[10px] text-muted-foreground">{STAT_LABELS[s]}</div>
                          <StatBadge value={RACE_STATS[race]?.[s] || 0} />
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </ScrollArea>
        </TabsContent>

        <TabsContent value="starter-gear" className="flex-1 min-h-0 mt-0">
          <ScrollArea className="h-full">
            <div className="p-4 space-y-3">
              <div className="mb-2">
                <h3 className="font-display text-sm text-foreground flex items-center gap-2">
                  <Shield className="w-4 h-4" /> Universal Starting Gear
                </h3>
                <p className="text-xs text-muted-foreground mt-1">
                  Equipment assigned here is given to ALL new characters regardless of class. Weapons are set per-class on the Classes tab.
                </p>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
                {EQUIP_SLOTS.map(({ key, label }) => {
                  const slotItems = getItemsForSlot(key);
                  const currentItemId = universalGear[key];
                  const currentItem = currentItemId ? allItems.find(i => i.id === currentItemId) : null;
                  return (
                    <Card key={key} className="bg-card/80 border-border">
                      <CardContent className="p-3 space-y-2">
                        <p className="text-xs font-display text-foreground">{label}</p>
                        <div className="flex items-center gap-2">
                          <div className="flex-1">
                            <ItemPicker
                              items={slotItems}
                              value={currentItemId || null}
                              onChange={v => { if (v) handleSetUniversalGear(key, v); }}
                              placeholder="None"
                              className="h-7"
                            />
                          </div>
                          {currentItemId && (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 text-xs text-destructive"
                              onClick={() => handleClearUniversalGear(key)}
                              disabled={saving === `u_${key}`}
                            >
                              Clear
                            </Button>
                          )}
                        </div>
                        {currentItem && (
                          <Badge variant="outline" className="text-[10px]">
                            {currentItem.name} ({currentItem.rarity})
                          </Badge>
                        )}
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            </div>
          </ScrollArea>
        </TabsContent>
      </Tabs>
    </div>
  );
}
