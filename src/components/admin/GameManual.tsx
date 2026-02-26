import { useState, useEffect } from 'react';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { supabase } from '@/integrations/supabase/client';
import {
  RACE_STATS, CLASS_STATS, CLASS_BASE_HP, CLASS_BASE_AC, CLASS_LEVEL_BONUSES,
  RACE_LABELS, CLASS_LABELS, STAT_LABELS, RACE_DESCRIPTIONS, ITEM_RARITY_MULTIPLIER,
  ITEM_STAT_COSTS, calculateStats, calculateHP, calculateAC, getBaseRegen, getItemStatBudget,
  generateCreatureStats, getCreatureDamageDie, getXpForLevel, getCreatureXp,
  XP_RARITY_MULTIPLIER, getMaxCp, getCpRegenRate, getStatModifier,
  CLASS_PRIMARY_STAT, getMaxMp, getMpRegenRate,
} from '@/lib/game-data';
import { CLASS_COMBAT, CLASS_ABILITIES } from '@/lib/class-abilities';

const STAT_KEYS = ['str', 'dex', 'con', 'int', 'wis', 'cha'] as const;
const MAX_LEVEL = 40;

export default function GameManual() {
  const [playerCounts, setPlayerCounts] = useState<Record<number, number>>({});

  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from('characters')
        .select('level');
      if (data) {
        const counts: Record<number, number> = {};
        data.forEach(c => { counts[c.level] = (counts[c.level] || 0) + 1; });
        setPlayerCounts(counts);
      }
    })();
  }, []);

  // Generate level progression data
  const levelData = Array.from({ length: MAX_LEVEL }, (_, i) => {
    const level = i + 1;
    const xpRequired = getXpForLevel(level);
    const totalXp = Array.from({ length: level }, (_, l) => getXpForLevel(l + 1)).reduce((a, b) => a + b, 0);
    const statGain = level % 5 === 0 ? '+1 all stats' : '—';
    const classBonus = level > 1 && level % 3 === 0;
    return { level, xpRequired, totalXp, statGain, classBonus, players: playerCounts[level] || 0 };
  });

  return (
    <ScrollArea className="h-full">
      <div className="p-4 max-w-4xl mx-auto space-y-2">
        <h2 className="font-display text-lg text-primary text-glow mb-3">📖 Game Manual</h2>

        <Accordion type="multiple" className="space-y-1">
          {/* 1. Level Progression */}
          <AccordionItem value="levels" className="border border-border rounded-lg bg-card/50">
            <AccordionTrigger className="px-4 py-3 font-display text-sm hover:no-underline">
              📊 Level Progression (1–{MAX_LEVEL})
            </AccordionTrigger>
            <AccordionContent className="px-4">
              <p className="text-xs text-muted-foreground mb-2">
                XP per level = <code className="text-primary">floor(level^2.0 × 50)</code>. All stats +1 every 5th level (5, 10, 15, 20...). Class bonuses every 3 levels.
              </p>
              <div className="max-h-[400px] overflow-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="text-xs w-12">Lv</TableHead>
                      <TableHead className="text-xs">XP Req</TableHead>
                      <TableHead className="text-xs">Total XP</TableHead>
                      <TableHead className="text-xs">Stats</TableHead>
                      <TableHead className="text-xs">Class Bonus</TableHead>
                      <TableHead className="text-xs">Players</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {levelData.map(row => (
                      <TableRow key={row.level} className={row.players > 0 ? 'bg-primary/5' : ''}>
                        <TableCell className="text-xs font-display">{row.level}</TableCell>
                        <TableCell className="text-xs">{row.xpRequired}</TableCell>
                        <TableCell className="text-xs">{row.totalXp.toLocaleString()}</TableCell>
                        <TableCell className="text-xs">{row.statGain}</TableCell>
                        <TableCell className="text-xs">{row.classBonus ? '✦ Yes' : '—'}</TableCell>
                        <TableCell className="text-xs">
                          {row.players > 0 ? <Badge variant="secondary" className="text-xs">{row.players}</Badge> : '—'}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
              <Card className="mt-3 bg-card/30">
                <CardContent className="p-3">
                  <p className="text-xs font-display text-primary mb-1">Class Level Bonuses (every 3 levels)</p>
                  <div className="grid grid-cols-3 gap-2">
                    {Object.entries(CLASS_LEVEL_BONUSES).map(([cls, bonuses]) => (
                      <div key={cls} className="text-xs">
                        <span className="font-display text-foreground">{CLASS_LABELS[cls]}: </span>
                        <span className="text-muted-foreground">
                          {Object.entries(bonuses).map(([s, v]) => `${STAT_LABELS[s]} +${v}`).join(', ')}
                        </span>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            </AccordionContent>
          </AccordionItem>

          {/* 2. Character Stats & Creation */}
          <AccordionItem value="stats" className="border border-border rounded-lg bg-card/50">
            <AccordionTrigger className="px-4 py-3 font-display text-sm hover:no-underline">
              🎭 Character Stats & Creation
            </AccordionTrigger>
            <AccordionContent className="px-4 space-y-3">
              <p className="text-xs text-muted-foreground">
                Base stats: <code className="text-primary">8</code> in all attributes. Final = Base + Race + Class modifiers.
                Race choice has a <strong className="text-foreground">major impact</strong> on derived stats — tough races (Dwarf, Edain) provide significantly more HP via CON, while wise/mental races (Elf, Half-Elf) provide larger CP pools via INT/WIS/CHA.
              </p>

              {/* Race-Class Synergy Guide */}
              <Card className="bg-primary/5 border-primary/20">
                <CardContent className="p-3 space-y-2">
                  <p className="text-xs font-display text-primary">⚔️ Race-Class Synergy Guide</p>
                  <div className="text-xs text-muted-foreground space-y-1">
                    <p><strong className="text-foreground">Tank Races</strong> (high CON → more HP):</p>
                    <p className="ml-3">🛡️ <strong>Dwarf</strong> (+4 CON) — Best for Warriors, Healers who want to survive the frontline</p>
                    <p className="ml-3">🏰 <strong>Edain</strong> (+3 CON) — Strong for any melee class, good all-rounder</p>
                    <p className="mt-1"><strong className="text-foreground">Caster Races</strong> (high mental stats → more CP):</p>
                    <p className="ml-3">🌿 <strong>Elf</strong> (+3 WIS, +2 INT) — Best for Wizards, Healers, Rangers who use abilities heavily</p>
                    <p className="ml-3">✨ <strong>Half-Elf</strong> (+3 CHA, +2 WIS) — Ideal for Bards, Healers, Rogues with large CP pools</p>
                    <p className="mt-1"><strong className="text-foreground">Balanced / Agile</strong>:</p>
                    <p className="ml-3">🤸 <strong>Halfling</strong> (+3 DEX) — Best for Rogues, Rangers who need high accuracy/evasion</p>
                    <p className="ml-3">⚖️ <strong>Human</strong> (+1 all) — Versatile, no weaknesses, good for any class</p>
                  </div>
                </CardContent>
              </Card>

              {/* HP/CP comparison by race-class combo */}
              <div>
                <p className="text-xs font-display text-primary mb-1">Starting HP & CP by Race-Class Combo</p>
                <div className="max-h-[250px] overflow-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="text-xs">Combo</TableHead>
                        <TableHead className="text-xs">HP</TableHead>
                        <TableHead className="text-xs">AC</TableHead>
                        <TableHead className="text-xs">CP</TableHead>
                        <TableHead className="text-xs">Synergy</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {(() => {
                        const combos = Object.keys(RACE_STATS).flatMap(race =>
                          Object.keys(CLASS_STATS).map(cls => {
                            const s = calculateStats(race, cls);
                            const hp = calculateHP(cls, s.con);
                            const ac = calculateAC(cls, s.dex);
                            const cp = getMaxCp(1, s.int, s.wis, s.cha);
                            return { race, cls, s, hp, ac, cp };
                          })
                        );
                        const maxHp = Math.max(...combos.map(c => c.hp));
                        const maxCp = Math.max(...combos.map(c => c.cp));
                        const minHp = Math.min(...combos.map(c => c.hp));
                        const minCp = Math.min(...combos.map(c => c.cp));
                        return combos.map(({ race, cls, hp, ac, cp }) => {
                          let synergy = '';
                          if (hp >= maxHp - 2 && cp >= maxCp - 5) synergy = '🌟 Excellent';
                          else if (hp >= maxHp - 2) synergy = '🛡️ Tank';
                          else if (cp >= maxCp - 5) synergy = '🔮 Caster';
                          else if (hp <= minHp + 2) synergy = '⚠️ Fragile';
                          else synergy = '⚖️ Balanced';
                          return (
                            <TableRow key={`${race}-${cls}`}>
                              <TableCell className="text-xs font-display">{RACE_LABELS[race]} {CLASS_LABELS[cls]}</TableCell>
                              <TableCell className={`text-xs ${hp >= maxHp - 2 ? 'text-green-400 font-bold' : hp <= minHp + 2 ? 'text-red-400' : ''}`}>{hp}</TableCell>
                              <TableCell className="text-xs">{ac}</TableCell>
                              <TableCell className={`text-xs ${cp >= maxCp - 5 ? 'text-blue-400 font-bold' : cp <= minCp + 5 ? 'text-orange-400' : ''}`}>{cp}</TableCell>
                              <TableCell className="text-xs">{synergy}</TableCell>
                            </TableRow>
                          );
                        });
                      })()}
                    </TableBody>
                  </Table>
                </div>
              </div>

              <div>
                <p className="text-xs font-display text-primary mb-1">Race Modifiers</p>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="text-xs">Race</TableHead>
                      {STAT_KEYS.map(s => <TableHead key={s} className="text-xs">{STAT_LABELS[s]}</TableHead>)}
                      <TableHead className="text-xs">Strength</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {Object.entries(RACE_STATS).map(([race, stats]) => {
                      const totalBonus = Object.values(stats).reduce((a, b) => a + (b as number), 0);
                      const topStat = Object.entries(stats).sort(([,a], [,b]) => (b as number) - (a as number))[0];
                      return (
                        <TableRow key={race}>
                          <TableCell className="text-xs font-display">{RACE_LABELS[race]}</TableCell>
                          {STAT_KEYS.map(s => (
                            <TableCell key={s} className={`text-xs ${stats[s] > 0 ? 'text-green-400' : stats[s] < 0 ? 'text-red-400' : 'text-muted-foreground'}`}>
                              {stats[s] > 0 ? `+${stats[s]}` : stats[s] || '—'}
                            </TableCell>
                          ))}
                          <TableCell className="text-xs text-muted-foreground">
                            {STAT_LABELS[topStat[0]]} focused (+{totalBonus} total)
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
              <div>
                <p className="text-xs font-display text-primary mb-1">Class Modifiers</p>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="text-xs">Class</TableHead>
                      {STAT_KEYS.map(s => <TableHead key={s} className="text-xs">{STAT_LABELS[s]}</TableHead>)}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {Object.entries(CLASS_STATS).map(([cls, stats]) => (
                      <TableRow key={cls}>
                        <TableCell className="text-xs font-display">{CLASS_LABELS[cls]}</TableCell>
                        {STAT_KEYS.map(s => (
                          <TableCell key={s} className={`text-xs ${stats[s] > 0 ? 'text-green-400' : 'text-muted-foreground'}`}>
                            {stats[s] > 0 ? `+${stats[s]}` : '—'}
                          </TableCell>
                        ))}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
              {/* Example combos */}
              <Accordion type="single" collapsible>
                <AccordionItem value="combos" className="border-none">
                  <AccordionTrigger className="py-2 text-xs font-display hover:no-underline">
                    Example Starting Stats (all combos)
                  </AccordionTrigger>
                  <AccordionContent>
                    <div className="grid grid-cols-1 gap-1 max-h-[300px] overflow-auto">
                      {Object.keys(RACE_STATS).map(race =>
                        Object.keys(CLASS_STATS).map(cls => {
                          const s = calculateStats(race, cls);
                          return (
                            <div key={`${race}-${cls}`} className="flex items-center gap-2 text-xs">
                              <span className="font-display w-28 shrink-0">{RACE_LABELS[race]} {CLASS_LABELS[cls]}</span>
                              {STAT_KEYS.map(k => (
                                <span key={k} className="text-muted-foreground w-10 text-center">{STAT_LABELS[k]} {s[k]}</span>
                              ))}
                            </div>
                          );
                        })
                      )}
                    </div>
                  </AccordionContent>
                </AccordionItem>
              </Accordion>
            </AccordionContent>
          </AccordionItem>

          {/* 3. HP, AC & Regen */}
          <AccordionItem value="hp-ac" className="border border-border rounded-lg bg-card/50">
            <AccordionTrigger className="px-4 py-3 font-display text-sm hover:no-underline">
              ❤️ HP, AC & Regeneration
            </AccordionTrigger>
            <AccordionContent className="px-4 space-y-3">
              <div className="space-y-1 text-xs text-muted-foreground">
                <p><strong className="text-foreground">Max HP</strong> = Base Class HP + floor((CON − 10) / 2) + (level − 1) × 5</p>
                <p><strong className="text-foreground">AC</strong> = Base Class AC + floor((DEX − 10) / 2)</p>
                <p><strong className="text-foreground">Passive HP Regen</strong> (every 15s) = 1 + floor((CON − 10) / 4) + gear bonuses</p>
                <p className="mt-1">Example: CON 14 → regen = 1 + floor(4/4) = <code className="text-primary">{getBaseRegen(14)}</code>/tick</p>
              </div>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-xs">Class</TableHead>
                    <TableHead className="text-xs">Base HP</TableHead>
                    <TableHead className="text-xs">Base AC</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {Object.keys(CLASS_BASE_HP).map(cls => (
                    <TableRow key={cls}>
                      <TableCell className="text-xs font-display">{CLASS_LABELS[cls]}</TableCell>
                      <TableCell className="text-xs">{CLASS_BASE_HP[cls]}</TableCell>
                      <TableCell className="text-xs">{CLASS_BASE_AC[cls]}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>

              <div>
                <p className="text-xs font-display text-primary mb-1">Starting HP by Race & Class (Level 1)</p>
                <div className="max-h-[300px] overflow-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="text-xs">Race \ Class</TableHead>
                        {Object.keys(CLASS_STATS).map(cls => (
                          <TableHead key={cls} className="text-xs">{CLASS_LABELS[cls]}</TableHead>
                        ))}
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {(() => {
                        const allHp = Object.keys(RACE_STATS).flatMap(race =>
                          Object.keys(CLASS_STATS).map(cls => {
                            const s = calculateStats(race, cls);
                            return calculateHP(cls, s.con);
                          })
                        );
                        const maxHp = Math.max(...allHp);
                        const minHp = Math.min(...allHp);
                        return Object.keys(RACE_STATS).map(race => (
                          <TableRow key={race}>
                            <TableCell className="text-xs font-display">{RACE_LABELS[race]}</TableCell>
                            {Object.keys(CLASS_STATS).map(cls => {
                              const s = calculateStats(race, cls);
                              const hp = calculateHP(cls, s.con);
                              return (
                                <TableCell key={cls} className={`text-xs ${hp >= maxHp - 2 ? 'text-green-400 font-bold' : hp <= minHp + 2 ? 'text-red-400' : ''}`}>
                                  {hp}
                                </TableCell>
                              );
                            })}
                          </TableRow>
                        ));
                      })()}
                    </TableBody>
                  </Table>
                </div>
                <p className="text-[10px] text-muted-foreground mt-1">
                  <span className="text-green-400">■</span> High HP (tank-optimal) · <span className="text-red-400">■</span> Low HP (fragile combo)
                </p>
              </div>
            </AccordionContent>
          </AccordionItem>

          {/* 3b. Concentration Points (CP) */}
          <AccordionItem value="cp-system" className="border border-border rounded-lg bg-card/50">
            <AccordionTrigger className="px-4 py-3 font-display text-sm hover:no-underline">
              🔮 Concentration Points (CP)
            </AccordionTrigger>
            <AccordionContent className="px-4 space-y-3">
              <div className="space-y-1 text-xs text-muted-foreground">
                <p>CP is the resource that powers class abilities. It replaces cooldown timers — abilities cost CP to use and are disabled when you don't have enough.</p>
                <p><strong className="text-foreground">Max CP</strong> = <code className="text-primary">60 + (level − 1) × 3 + mentalMod × 5</code></p>
                <p className="ml-4 text-[10px]"><code>mentalMod = max(modifier(INT), modifier(WIS), modifier(CHA), 0)</code> where modifier = floor((stat − 10) / 2)</p>
                <p className="mt-1"><strong className="text-foreground">Race Impact:</strong> Caster races like <strong>Elf</strong> (+3 WIS, +2 INT) and <strong>Half-Elf</strong> (+3 CHA, +2 WIS) start with significantly higher CP pools than tank races like <strong>Dwarf</strong> (+4 CON but −2 CHA). Choose a race whose mental stats complement your class's primary resource needs.</p>
                <p><strong className="text-foreground">CP Regen</strong> = <code className="text-primary">1 CP per 6 seconds</code> + bonus from primary stat</p>
                <p><strong className="text-foreground">Regen Bonus</strong> = +0.5 CP/6s for every 2 points of primary stat modifier</p>
                <p><strong className="text-foreground">Inn Rest</strong> = Fully restores CP (alongside HP)</p>
                <p><strong className="text-foreground">🎶 Inspire</strong> = Doubles CP regen rate (alongside HP regen) for 90 seconds</p>
                <p><strong className="text-foreground">🍞 Food Buff</strong> = Adds 50% of food's HP regen value as bonus CP regen for 5 minutes</p>
              </div>

              <div>
                <p className="text-xs font-display text-primary mb-1">Starting CP by Race & Class (Level 1)</p>
                <div className="max-h-[300px] overflow-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="text-xs">Race \ Class</TableHead>
                        {Object.keys(CLASS_STATS).map(cls => (
                          <TableHead key={cls} className="text-xs">{CLASS_LABELS[cls]}</TableHead>
                        ))}
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {(() => {
                        const allCp = Object.keys(RACE_STATS).flatMap(race =>
                          Object.keys(CLASS_STATS).map(cls => {
                            const s = calculateStats(race, cls);
                            return getMaxCp(1, s.int, s.wis, s.cha);
                          })
                        );
                        const maxCp = Math.max(...allCp);
                        const minCp = Math.min(...allCp);
                        return Object.keys(RACE_STATS).map(race => (
                          <TableRow key={race}>
                            <TableCell className="text-xs font-display">{RACE_LABELS[race]}</TableCell>
                            {Object.keys(CLASS_STATS).map(cls => {
                              const s = calculateStats(race, cls);
                              const cp = getMaxCp(1, s.int, s.wis, s.cha);
                              return (
                                <TableCell key={cls} className={`text-xs ${cp >= maxCp - 5 ? 'text-blue-400 font-bold' : cp <= minCp + 5 ? 'text-orange-400' : ''}`}>
                                  {cp}
                                </TableCell>
                              );
                            })}
                          </TableRow>
                        ));
                      })()}
                    </TableBody>
                  </Table>
                </div>
                <p className="text-[10px] text-muted-foreground mt-1">
                  <span className="text-blue-400">■</span> High CP (caster-optimal) · <span className="text-orange-400">■</span> Low CP (tank-focused race)
                </p>
              </div>

              <div>
                <p className="text-xs font-display text-primary mb-1">Ability CP Costs by Tier</p>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="text-xs">Tier</TableHead>
                      <TableHead className="text-xs">Level</TableHead>
                      <TableHead className="text-xs">CP Cost</TableHead>
                      <TableHead className="text-xs">Design Intent</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {[
                      { tier: 1, level: 5, cost: 15, intent: 'Bread-and-butter, usable frequently' },
                      { tier: 2, level: 10, cost: 25, intent: 'Moderate cost, tactical choice' },
                      { tier: 3, level: 15, cost: 40, intent: 'Expensive, meaningful commitment' },
                      { tier: 4, level: 20, cost: 60, intent: 'Very expensive, fight-defining' },
                    ].map(row => (
                      <TableRow key={row.tier}>
                        <TableCell className="text-xs font-display">T{row.tier}</TableCell>
                        <TableCell className="text-xs">{row.level}</TableCell>
                        <TableCell className="text-xs">{row.cost} CP</TableCell>
                        <TableCell className="text-xs text-muted-foreground">{row.intent}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>

              <div>
                <p className="text-xs font-display text-primary mb-1">Max CP by Level (base, no mental bonus)</p>
                <div className="grid grid-cols-4 gap-1 text-xs text-muted-foreground">
                  {[1, 5, 10, 15, 20, 25, 30, 40].map(lv => (
                    <div key={lv}>
                      Lv {lv}: <span className="text-primary">{getMaxCp(lv, 10, 10, 10)} CP</span>
                    </div>
                  ))}
                </div>
              </div>

              <div>
                <p className="text-xs font-display text-primary mb-1">CP Regen by Class (Primary Stat)</p>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="text-xs">Class</TableHead>
                      <TableHead className="text-xs">Primary</TableHead>
                      <TableHead className="text-xs">Regen @ 10</TableHead>
                      <TableHead className="text-xs">Regen @ 14</TableHead>
                      <TableHead className="text-xs">Regen @ 18</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {Object.entries(CLASS_PRIMARY_STAT).map(([cls, stat]) => (
                      <TableRow key={cls}>
                        <TableCell className="text-xs font-display">{CLASS_LABELS[cls]}</TableCell>
                        <TableCell className="text-xs">{STAT_LABELS[stat]}</TableCell>
                        <TableCell className="text-xs">{getCpRegenRate(10)} CP/6s</TableCell>
                        <TableCell className="text-xs">{getCpRegenRate(14)} CP/6s</TableCell>
                        <TableCell className="text-xs">{getCpRegenRate(18)} CP/6s</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>

              <Card className="bg-card/30">
                <CardContent className="p-3">
                  <p className="text-xs font-display text-primary mb-1">Tactical Example (Level 20 Wizard, ~142 max CP)</p>
                  <div className="text-xs text-muted-foreground space-y-0.5">
                    <p>• T4 ability (60 CP) + T2 ability (25 CP) = 85 CP spent → 57 CP remaining</p>
                    <p>• A Warrior at level 20 would have ~122 max CP — 20 less than the Wizard</p>
                    <p>• Mental stat scaling rewards casters with a bigger CP pool to compensate for lower HP/AC</p>
                    <p>• Bard's "Grand Finale" deals massive CHA-scaling burst damage to a single target</p>
                  </div>
                </CardContent>
              </Card>
            </AccordionContent>
          </AccordionItem>

          {/* 4. Combat */}
          <AccordionItem value="combat" className="border border-border rounded-lg bg-card/50">
            <AccordionTrigger className="px-4 py-3 font-display text-sm hover:no-underline">
              ⚔️ Combat
            </AccordionTrigger>
            <AccordionContent className="px-4 space-y-3">
              <div className="space-y-1 text-xs text-muted-foreground">
                <p><strong className="text-foreground">Attack Roll:</strong> d20 + stat modifier ≥ target AC → hit</p>
                <p><strong className="text-foreground">Damage:</strong> class dice (min–max) + stat modifier</p>
                <p><strong className="text-foreground">Critical Hit:</strong> roll ≥ crit range → double damage</p>
                <p><strong className="text-foreground">Creature Counterattack:</strong> d20 + STR mod vs player AC</p>
                <p><strong className="text-foreground">Creature Damage:</strong> 1d(base_die + floor(level/2)) + STR mod</p>
                <p><strong className="text-foreground">Party Combat:</strong> Tank absorbs all hits; single counterattack per round</p>
                <p><strong className="text-foreground">Flee:</strong> All party members suffer opportunity attacks</p>
                <p><strong className="text-foreground">Durability:</strong> Every combat round, 2 random equipped items each lose 1 durability</p>
                <p><strong className="text-foreground">XP Penalty:</strong> Graduated: −10%/lvl (Lv1-5), −15%/lvl (Lv6-10), −20%/lvl (Lv11+). Min 10% reward.</p>
              </div>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-xs">Class</TableHead>
                    <TableHead className="text-xs">Attack</TableHead>
                    <TableHead className="text-xs">Stat</TableHead>
                    <TableHead className="text-xs">Dice</TableHead>
                    <TableHead className="text-xs">Crit</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {Object.entries(CLASS_COMBAT).map(([cls, c]) => (
                    <TableRow key={cls}>
                      <TableCell className="text-xs font-display">{CLASS_LABELS[cls]}</TableCell>
                      <TableCell className="text-xs">{c.emoji} {c.label}</TableCell>
                      <TableCell className="text-xs">{STAT_LABELS[c.stat]}</TableCell>
                      <TableCell className="text-xs">{c.diceMin}–{c.diceMax}</TableCell>
                      <TableCell className="text-xs">{c.critRange}+</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </AccordionContent>
          </AccordionItem>

          {/* 4b. XP & Creature Rewards */}
          <AccordionItem value="xp-rewards" className="border border-border rounded-lg bg-card/50">
            <AccordionTrigger className="px-4 py-3 font-display text-sm hover:no-underline">
              🏆 XP & Creature Rewards
            </AccordionTrigger>
            <AccordionContent className="px-4 space-y-3">
              <div className="space-y-1 text-xs text-muted-foreground">
                <p><strong className="text-foreground">XP Curve:</strong> XP to next level = <code className="text-primary">floor(level^1.5 × 50)</code></p>
                <p><strong className="text-foreground">Creature XP:</strong> <code className="text-primary">creature_level × 10 × rarity_mult</code></p>
                <p><strong className="text-foreground">Level Penalty:</strong> Graduated: −10%/lvl (Lv1-5), −15%/lvl (Lv6-10), −20%/lvl (Lv11+). Min 10% reward.</p>
                <p><strong className="text-foreground">Party Split:</strong> XP divided equally among party members at the node</p>
              </div>

              <div>
                <p className="text-xs font-display text-primary mb-1">Rarity XP Multipliers</p>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="text-xs">Rarity</TableHead>
                      <TableHead className="text-xs">Multiplier</TableHead>
                      <TableHead className="text-xs">Lv 10 XP</TableHead>
                      <TableHead className="text-xs">Lv 20 XP</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {Object.entries(XP_RARITY_MULTIPLIER).map(([r, m]) => (
                      <TableRow key={r}>
                        <TableCell className="text-xs font-display capitalize">{r}</TableCell>
                        <TableCell className="text-xs">{m}×</TableCell>
                        <TableCell className="text-xs">{getCreatureXp(10, r)}</TableCell>
                        <TableCell className="text-xs">{getCreatureXp(20, r)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>

              <Accordion type="single" collapsible>
                <AccordionItem value="kills-to-level" className="border-none">
                  <AccordionTrigger className="py-2 text-xs font-display hover:no-underline">
                    Kills-to-Level Milestones (same-level regular creatures, solo)
                  </AccordionTrigger>
                  <AccordionContent>
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="text-xs">Level</TableHead>
                          <TableHead className="text-xs">XP Needed</TableHead>
                          <TableHead className="text-xs">Regular Kills</TableHead>
                          <TableHead className="text-xs">Rare Kills</TableHead>
                          <TableHead className="text-xs">Boss Kills</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {[1, 5, 10, 15, 20, 25, 30, 35, 40].map(lv => {
                          const xpNeeded = getXpForLevel(lv);
                          const regXp = getCreatureXp(lv, 'regular');
                          const rareXp = getCreatureXp(lv, 'rare');
                          const bossXp = getCreatureXp(lv, 'boss');
                          return (
                            <TableRow key={lv}>
                              <TableCell className="text-xs font-display">{lv}</TableCell>
                              <TableCell className="text-xs">{xpNeeded.toLocaleString()}</TableCell>
                              <TableCell className="text-xs">{Math.ceil(xpNeeded / regXp)}</TableCell>
                              <TableCell className="text-xs">{Math.ceil(xpNeeded / rareXp)}</TableCell>
                              <TableCell className="text-xs">{Math.ceil(xpNeeded / bossXp)}</TableCell>
                            </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table>
                  </AccordionContent>
                </AccordionItem>
              </Accordion>
            </AccordionContent>
          </AccordionItem>

          {/* 5. Class Abilities */}
          <AccordionItem value="abilities" className="border border-border rounded-lg bg-card/50">
            <AccordionTrigger className="px-4 py-3 font-display text-sm hover:no-underline">
              ✨ Class Abilities
            </AccordionTrigger>
            <AccordionContent className="px-4">
              <p className="text-xs text-muted-foreground mb-2">
                All classes have access to <strong>Focus Strike</strong> (Tier 0, 10 CP) from level 1 — channels every ounce of your being to add bonus damage (scaling with the average of all six <em>base</em> stats, unaffected by gear) to your next attack.
                Class abilities unlock at Tier 1 (Lv 5), Tier 2 (Lv 10), Tier 3 (Lv 15), Tier 4 (Lv 20). Each ability costs Concentration Points (CP) to use.
              </p>
              <Accordion type="multiple">
                {Object.entries(CLASS_ABILITIES).map(([cls, abilities]) => (
                  <AccordionItem key={cls} value={`ability-${cls}`} className="border-none">
                    <AccordionTrigger className="py-2 text-xs font-display hover:no-underline">
                      {CLASS_LABELS[cls]}
                    </AccordionTrigger>
                    <AccordionContent>
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead className="text-xs">Ability</TableHead>
                            <TableHead className="text-xs">Tier</TableHead>
                            <TableHead className="text-xs">Level</TableHead>
                            <TableHead className="text-xs">CP Cost</TableHead>
                            <TableHead className="text-xs">Description</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {abilities.map(a => (
                            <TableRow key={a.label}>
                              <TableCell className="text-xs font-display">{a.emoji} {a.label}</TableCell>
                              <TableCell className="text-xs">{a.tier}</TableCell>
                              <TableCell className="text-xs">{a.levelRequired}</TableCell>
                              <TableCell className="text-xs">{a.cpCost} CP</TableCell>
                              <TableCell className="text-xs text-muted-foreground">{a.description}</TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </AccordionContent>
                  </AccordionItem>
                ))}
              </Accordion>
            </AccordionContent>
          </AccordionItem>

          {/* 6. Creature Scaling */}
          <AccordionItem value="creatures" className="border border-border rounded-lg bg-card/50">
            <AccordionTrigger className="px-4 py-3 font-display text-sm hover:no-underline">
              🐉 Creature Scaling
            </AccordionTrigger>
            <AccordionContent className="px-4 space-y-3">
              <div className="space-y-1 text-xs text-muted-foreground">
                <p><strong className="text-foreground">Base Stat:</strong> 8 + floor(level × 0.7), multiplied by rarity</p>
                <p><strong className="text-foreground">HP:</strong> (15 + level × 8) × rarity HP multiplier</p>
                <p><strong className="text-foreground">AC:</strong> 8 + floor(level × 0.6) + rarity AC bonus</p>
                <p><strong className="text-foreground">Damage Die:</strong> rarity_base + floor(level / 2)</p>
                <p><strong className="text-foreground">Humanoid Gold:</strong> min = level × mult, max = level × 3 × mult</p>
              </div>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-xs">Rarity</TableHead>
                    <TableHead className="text-xs">Stat ×</TableHead>
                    <TableHead className="text-xs">HP ×</TableHead>
                    <TableHead className="text-xs">AC +</TableHead>
                    <TableHead className="text-xs">Dmg Base</TableHead>
                    <TableHead className="text-xs">Gold ×</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {[
                    { r: 'Regular', stat: 1, hp: 1, ac: 0, dmg: 4, gold: 1 },
                    { r: 'Rare', stat: 1.3, hp: 1.5, ac: 2, dmg: 6, gold: 1.5 },
                    { r: 'Boss', stat: 1.6, hp: 2.5, ac: 4, dmg: 8, gold: 3 },
                  ].map(row => (
                    <TableRow key={row.r}>
                      <TableCell className="text-xs font-display">{row.r}</TableCell>
                      <TableCell className="text-xs">{row.stat}×</TableCell>
                      <TableCell className="text-xs">{row.hp}×</TableCell>
                      <TableCell className="text-xs">+{row.ac}</TableCell>
                      <TableCell className="text-xs">d{row.dmg}</TableCell>
                      <TableCell className="text-xs">{row.gold}×</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              {/* Example creatures */}
              <Accordion type="single" collapsible>
                <AccordionItem value="creature-examples" className="border-none">
                  <AccordionTrigger className="py-2 text-xs font-display hover:no-underline">
                    Example Creatures (Lv 1, 10, 20, 30)
                  </AccordionTrigger>
                  <AccordionContent>
                    <div className="space-y-2">
                      {[1, 10, 20, 30].map(lv => {
                        const reg = generateCreatureStats(lv, 'regular');
                        const boss = generateCreatureStats(lv, 'boss');
                        return (
                          <div key={lv} className="text-xs">
                            <span className="font-display text-foreground">Level {lv}:</span>{' '}
                            <span className="text-muted-foreground">
                              Regular HP {reg.hp} AC {reg.ac} STR {reg.stats.str} (d{getCreatureDamageDie(lv, 'regular')}) · 
                              Boss HP {boss.hp} AC {boss.ac} STR {boss.stats.str} (d{getCreatureDamageDie(lv, 'boss')})
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  </AccordionContent>
                </AccordionItem>
              </Accordion>
            </AccordionContent>
          </AccordionItem>

          {/* 7. Items & Economy */}
          <AccordionItem value="items" className="border border-border rounded-lg bg-card/50">
            <AccordionTrigger className="px-4 py-3 font-display text-sm hover:no-underline">
              🎒 Items & Economy
            </AccordionTrigger>
            <AccordionContent className="px-4 space-y-3">
              <div className="space-y-1 text-xs text-muted-foreground">
                <p><strong className="text-foreground">Stat Budget:</strong> floor(1 + (level − 1) × 0.3 × rarity_mult × hands_mult)</p>
                <p><strong className="text-foreground">hands_mult:</strong> 1h = 1.0, 2h = 1.5</p>
                <p><strong className="text-foreground">Repair Cost:</strong> ceil((100 − cur_dur) × value × rarity_mult / 100)</p>
                <p><strong className="text-foreground">Durability:</strong> All items have 100 max durability. Common/Uncommon can be repaired; Rare/Unique are destroyed at 0.</p>
                <p><strong className="text-foreground">Gold Value:</strong> round(level × 2.5 × rarity²)</p>
                <p><strong className="text-foreground">Creature Loot:</strong> Drops are resolved via the shared <strong>Loot Table system</strong> — each creature has a <code className="text-primary">drop_chance</code> (0.0–1.0) and a linked <code className="text-primary">loot_table_id</code>. On kill, if the drop roll succeeds, one item is selected from the table using weighted random selection. Gold drops from humanoids use a separate inline configuration.</p>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <p className="text-xs font-display text-primary mb-1">Rarity Multipliers</p>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="text-xs">Rarity</TableHead>
                        <TableHead className="text-xs">Mult</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {Object.entries(ITEM_RARITY_MULTIPLIER).map(([r, m]) => (
                        <TableRow key={r}>
                          <TableCell className="text-xs capitalize">{r}</TableCell>
                          <TableCell className="text-xs">{m}×</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
                <div>
                  <p className="text-xs font-display text-primary mb-1">Stat Costs</p>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="text-xs">Stat</TableHead>
                        <TableHead className="text-xs">Cost</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {Object.entries(ITEM_STAT_COSTS).map(([s, c]) => (
                        <TableRow key={s}>
                          <TableCell className="text-xs uppercase">{s}</TableCell>
                          <TableCell className="text-xs">{c}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </div>
              {/* Budget examples */}
              <Accordion type="single" collapsible>
                <AccordionItem value="budget-examples" className="border-none">
                  <AccordionTrigger className="py-2 text-xs font-display hover:no-underline">
                    Stat Budget Examples
                  </AccordionTrigger>
                  <AccordionContent>
                    <div className="grid grid-cols-2 gap-1 text-xs text-muted-foreground">
                      {['common', 'uncommon', 'rare', 'unique'].map(rarity =>
                        [1, 5, 10, 20].map(lv => (
                          <div key={`${rarity}-${lv}`}>
                            <span className="capitalize">{rarity}</span> Lv{lv} 1h: <span className="text-primary">{getItemStatBudget(lv, rarity, 1)}</span>{' '}
                            2h: <span className="text-primary">{getItemStatBudget(lv, rarity, 2)}</span>
                          </div>
                        ))
                      )}
                    </div>
                  </AccordionContent>
                </AccordionItem>
              </Accordion>
            </AccordionContent>
          </AccordionItem>

          {/* 8. Stamina (MP) */}
          <AccordionItem value="stamina" className="border border-border rounded-lg bg-card/50">
            <AccordionTrigger className="px-4 py-3 font-display text-sm hover:no-underline">
              🏃 Stamina (Move Points)
            </AccordionTrigger>
            <AccordionContent className="px-4">
              <div className="space-y-3 text-xs text-muted-foreground">
                <p>Stamina (MP) limits how far you can travel before needing to rest. Each move between nodes costs <strong className="text-foreground">10 MP</strong>. A 500ms cooldown prevents rapid movement spam.</p>

                <div className="space-y-1">
                  <p><strong className="text-foreground">Max MP Formula:</strong> 100 + (DEX mod × 10) + ((level − 1) × 2)</p>
                  <p><strong className="text-foreground">Regen Rate:</strong> (5 + DEX mod) MP every 3 seconds</p>
                  <p><strong className="text-foreground">Inn Bonus:</strong> Regen rate tripled (×3) while resting at an Inn</p>
                  <p><strong className="text-foreground">Movement Cost:</strong> 10 MP per node traversal</p>
                </div>

                <p className="text-muted-foreground">DEX-focused classes like Rangers and Rogues naturally gain higher max MP and faster recovery.</p>

                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="text-xs">Race</TableHead>
                      {Object.entries(CLASS_LABELS).map(([key, label]) => (
                        <TableHead key={key} className="text-xs text-center">{label}</TableHead>
                      ))}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {Object.entries(RACE_LABELS).map(([raceKey, raceLabel]) => (
                      <TableRow key={raceKey}>
                        <TableCell className="text-xs font-medium">{raceLabel}</TableCell>
                        {Object.keys(CLASS_LABELS).map(classKey => {
                          const stats = calculateStats(raceKey, classKey);
                          const maxMp = getMaxMp(1, stats.dex);
                          const regenRate = getMpRegenRate(stats.dex);
                          return (
                            <TableCell key={classKey} className="text-xs text-center">
                              {maxMp} <span className="text-muted-foreground/60">({regenRate}/3s)</span>
                            </TableCell>
                          );
                        })}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </AccordionContent>
          </AccordionItem>

          {/* 9. Milestone Rewards */}
          <AccordionItem value="milestones" className="border border-border rounded-lg bg-card/50">
            <AccordionTrigger className="px-4 py-3 font-display text-sm hover:no-underline">
              🏆 Milestone Rewards (Levels 28-40)
            </AccordionTrigger>
            <AccordionContent className="px-4">
              <div className="space-y-3 text-xs text-muted-foreground">
                <p>Endgame milestones reward continued progression with permanent bonuses and prestigious titles.</p>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="text-xs">Level</TableHead>
                      <TableHead className="text-xs">Reward</TableHead>
                      <TableHead className="text-xs">Details</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    <TableRow><TableCell className="text-xs">28</TableCell><TableCell className="text-xs">⚔️ Expanded Crit Range</TableCell><TableCell className="text-xs">Permanent +1 to crit range (stacks with Eagle Eye)</TableCell></TableRow>
                    <TableRow><TableCell className="text-xs">30</TableCell><TableCell className="text-xs">🏅 Title: Veteran</TableCell><TableCell className="text-xs">Displayed to all players</TableCell></TableRow>
                    <TableRow><TableCell className="text-xs">32</TableCell><TableCell className="text-xs">🏅 Title: Vanguard</TableCell><TableCell className="text-xs">Replaces previous title</TableCell></TableRow>
                    <TableRow><TableCell className="text-xs">34</TableCell><TableCell className="text-xs">🏅 Title: Champion</TableCell><TableCell className="text-xs">Replaces previous title</TableCell></TableRow>
                    <TableRow><TableCell className="text-xs">35</TableCell><TableCell className="text-xs">💚 HP Regen Boost</TableCell><TableCell className="text-xs">Base HP regen doubled (stacks with inn/potion buffs)</TableCell></TableRow>
                    <TableRow><TableCell className="text-xs">36</TableCell><TableCell className="text-xs">🏅 Title: Warden</TableCell><TableCell className="text-xs">Replaces previous title</TableCell></TableRow>
                    <TableRow><TableCell className="text-xs">38</TableCell><TableCell className="text-xs">🏅 Title: Paragon</TableCell><TableCell className="text-xs">Replaces previous title</TableCell></TableRow>
                    <TableRow><TableCell className="text-xs">39</TableCell><TableCell className="text-xs">🔮 CP Discount</TableCell><TableCell className="text-xs">All ability CP costs reduced by 10%</TableCell></TableRow>
                    <TableRow><TableCell className="text-xs">40</TableCell><TableCell className="text-xs">🏅 Title: Ascendant</TableCell><TableCell className="text-xs">Highest prestige title</TableCell></TableRow>
                  </TableBody>
                </Table>
              </div>
            </AccordionContent>
          </AccordionItem>

          {/* Chat */}
          <AccordionItem value="chat" className="border border-border rounded-lg bg-card/50">
            <AccordionTrigger className="px-4 py-3 font-display text-sm hover:no-underline">
              💬 Chat (Say & Whisper)
            </AccordionTrigger>
            <AccordionContent className="px-4">
              <div className="space-y-2 text-xs text-muted-foreground">
                <p>Press <strong className="text-foreground">Enter</strong> to open the chat input at the bottom of the event log. Press <strong className="text-foreground">Escape</strong> to cancel.</p>
                <div className="space-y-1">
                  <p><strong className="text-foreground">Say</strong> — Type a message and press Enter. All players at your current node will see it.</p>
                  <p className="ml-3 text-muted-foreground/80">Example: <code className="text-primary">Hello everyone!</code></p>
                  <p><strong className="text-foreground">Whisper</strong> — Send a private message to a specific player using <code className="text-primary">/w PlayerName message</code> or <code className="text-primary">/whisper PlayerName message</code>.</p>
                  <p className="ml-3 text-muted-foreground/80">Example: <code className="text-primary">/w Gandalf Want to party up?</code></p>
                </div>
                <p>Chat messages are ephemeral — they are not stored and will disappear when you change nodes or refresh.</p>
              </div>
            </AccordionContent>
          </AccordionItem>

          {/* Death & Respawn */}
          <AccordionItem value="death" className="border border-border rounded-lg bg-card/50">
            <AccordionTrigger className="px-4 py-3 font-display text-sm hover:no-underline">
              💀 Death & Respawn
            </AccordionTrigger>
            <AccordionContent className="px-4">
              <div className="space-y-1 text-xs text-muted-foreground">
                <p><strong className="text-foreground">Incapacitation:</strong> 3 seconds before respawn</p>
                <p><strong className="text-foreground">Respawn Location:</strong> Starting node with 1 HP</p>
                <p><strong className="text-foreground">Gold Penalty:</strong> 10% of current gold lost on death</p>
              </div>
            </AccordionContent>
          </AccordionItem>
        </Accordion>
      </div>
    </ScrollArea>
  );
}
