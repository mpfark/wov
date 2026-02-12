import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  RACE_STATS, CLASS_STATS, CLASS_BASE_HP, CLASS_BASE_AC,
  RACE_LABELS, CLASS_LABELS, RACE_DESCRIPTIONS, CLASS_DESCRIPTIONS,
  STAT_LABELS, CLASS_LEVEL_BONUSES,
} from '@/lib/game-data';
import { CLASS_COMBAT } from '@/lib/class-abilities';

const STAT_KEYS = ['str', 'dex', 'con', 'int', 'wis', 'cha'] as const;

function StatBadge({ value }: { value: number }) {
  const color = value > 0 ? 'text-green-400' : value < 0 ? 'text-red-400' : 'text-muted-foreground';
  return (
    <span className={`font-mono text-xs ${color}`}>
      {value > 0 ? `+${value}` : value}
    </span>
  );
}

export default function RaceClassManager() {
  const [tab, setTab] = useState('classes');

  return (
    <div className="h-full flex flex-col overflow-hidden">
      <Tabs value={tab} onValueChange={setTab} className="flex-1 flex flex-col min-h-0">
        <div className="px-4 pt-2 shrink-0">
          <TabsList className="h-8">
            <TabsTrigger value="classes" className="font-display text-xs">Classes</TabsTrigger>
            <TabsTrigger value="races" className="font-display text-xs">Races</TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="classes" className="flex-1 min-h-0 mt-0">
          <ScrollArea className="h-full">
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3 p-4">
              {Object.keys(CLASS_LABELS).map(cls => {
                const combat = CLASS_COMBAT[cls];
                const levelBonus = CLASS_LEVEL_BONUSES[cls] || {};
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
      </Tabs>
    </div>
  );
}
