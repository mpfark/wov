import { useState, useEffect } from 'react';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { supabase } from '@/integrations/supabase/client';
import {
  RACE_STATS, CLASS_STATS, CLASS_BASE_HP, CLASS_BASE_AC, CLASS_LEVEL_BONUSES,
  RACE_LABELS, CLASS_LABELS, STAT_LABELS, ITEM_RARITY_MULTIPLIER,
  ITEM_STAT_COSTS, calculateStats, calculateHP, calculateAC, getStatRegen, getItemStatBudget,
  generateCreatureStats, getCreatureDamageDie, getXpForLevel, getCreatureXp,
  XP_RARITY_MULTIPLIER, getMaxCp,
  getMaxMp, getMpRegenRate,
  CLASS_WEAPON_AFFINITY, WEAPON_TAG_LABELS,
} from '@/lib/game-data';
import { CLASS_ABILITIES } from '@/features/combat';

const STAT_KEYS = ['str', 'dex', 'con', 'int', 'wis', 'cha'] as const;
const MAX_LEVEL = 42;

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
    const statGain = '+1 point';
    const classBonus = level > 1 && level % 3 === 0;
    const respec = [10, 20, 30, 40].includes(level);
    return { level, xpRequired, totalXp, statGain, classBonus, respec, players: playerCounts[level] || 0 };
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
                XP per level = <code className="text-primary">floor(level^2.0 × 50)</code>. You gain <strong className="text-foreground">1 stat point per level</strong> to allocate freely. Class bonuses every 3 levels. <strong className="text-foreground">Respec points</strong> at levels 10, 20, 30, 40.
              </p>
              <div className="max-h-[400px] overflow-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="text-xs w-12">Lv</TableHead>
                      <TableHead className="text-xs">XP Req</TableHead>
                      <TableHead className="text-xs">Total XP</TableHead>
                      <TableHead className="text-xs">Stat Point</TableHead>
                      <TableHead className="text-xs">Class Bonus</TableHead>
                      <TableHead className="text-xs">Respec</TableHead>
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
                        <TableCell className="text-xs">{row.respec ? '🔄 +1' : '—'}</TableCell>
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
              <Card className="mt-3 bg-card/30">
                <CardContent className="p-3">
                  <p className="text-xs font-display text-chart-5 mb-1">🔄 Respec Points (Levels 10, 20, 30, 40)</p>
                  <p className="text-xs text-muted-foreground">
                    At each milestone level, you earn <strong className="text-foreground">1 respec point</strong>. 
                    Spending a respec point triggers a <strong className="text-foreground">full reset</strong> of all manually allocated stat points, returning them as unspent points to reallocate freely. 
                    Maximum of <strong className="text-foreground">4 respec points</strong> total across a character's lifetime.
                    Only manually allocated points are reset — base race, class, and level-up bonuses are permanent.
                    Both <strong className="text-foreground">stat allocation</strong> and <strong className="text-foreground">respec</strong> are now performed at <strong className="text-foreground">🏛️ Trainer</strong> nodes.
                  </p>
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

              {/* What Each Attribute Does */}
              <Card className="bg-card/30 border-border">
                <CardContent className="p-3 space-y-2">
                  <p className="text-xs font-display text-primary">📋 Attribute Effects</p>
                  <div className="text-xs text-muted-foreground space-y-1.5">
                    <p><strong className="text-foreground">STR (Strength)</strong> — Increases melee attack bonus, carry capacity, and provides a <strong>minimum damage floor</strong> on all attacks (even spells): <code className="text-primary">min(3, floor(√mod))</code> min damage.</p>
                    <p><strong className="text-foreground">DEX (Dexterity)</strong> — Increases AC (dodge chance), ranged/finesse attack bonus, max Stamina (MP), MP regen rate, and <strong>improves critical hit range</strong>: <code className="text-primary">min(4, floor(√mod))</code> — max crit on 16-20.</p>
                    <p><strong className="text-foreground">CON (Constitution)</strong> — Increases max HP, passive HP regeneration rate, and resistance to DoT effects. Primary stat for Warrior CP regen.</p>
                    <p><strong className="text-foreground">INT (Intelligence)</strong> — Increases max CP (via INT modifier), spell damage bonus, CP regen for Wizards, and <strong>improves hit chance</strong>: <code className="text-primary">min(5, floor(√mod))</code> bonus to attack rolls.</p>
                    <p><strong className="text-foreground">WIS (Wisdom)</strong> — Increases max CP (via WIS modifier), healing power, CP regen for Healers/Rangers, search bonus, and a <strong>chance to reduce incoming damage by 25%</strong>: <code className="text-primary">min(15%, √mod × 3%)</code>.</p>
                    <p><strong className="text-foreground">CHA (Charisma)</strong> — Bard ability effectiveness, CP regen for Bards/Rogues, <strong>vendor prices</strong> (sell up to 80%, buy discount capped at 10%), and <strong>humanoid gold bonus</strong> capped at +25%.</p>
                  </div>
                  <p className="text-[10px] text-muted-foreground/70 mt-1">
                    Stat modifier = <code className="text-primary">floor((stat − 10) / 2)</code>. A stat of 10 gives +0, 12 gives +1, 14 gives +2, etc.
                  </p>
                  <p className="text-[10px] text-muted-foreground/70">
                    ⚖️ <strong className="text-foreground">Diminishing returns:</strong> All cross-stat bonuses scale with <code className="text-primary">√(modifier)</code> instead of linearly, with hard caps. Early investment is impactful; extreme stacking gives sharply reduced returns.
                  </p>
                </CardContent>
              </Card>

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
                            const cp = getMaxCp(1, s.wis);
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
                <p><strong className="text-foreground">Passive HP Regen</strong> (every 4s) = 2 + floor(√(CON − 10)) + gear + food + milestone + inn</p>
                <p className="text-amber-400 mt-1">⚔️ <strong>In Combat:</strong> All passive regen (HP, CP, Stamina) is paused. Server-driven heals (potions, abilities) still apply.</p>
                <p className="mt-1">🏨 <strong>Inn Rest:</strong> +10 flat regen to HP, CP, and Stamina per tick.</p>
                <p className="mt-1">Example: CON 14 → base regen = <code className="text-primary">{getStatRegen(14)}</code> HP/tick, CON 20 → <code className="text-primary">{getStatRegen(20)}</code> HP/tick</p>
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
                <p><strong className="text-foreground">Max CP</strong> = <code className="text-primary">30 + (level − 1) × 3 + (INT_mod + WIS_mod) × 3</code></p>
                <p className="ml-4 text-[10px]"><code>INT_mod = max(floor((INT − 10) / 2), 0)</code>, <code>WIS_mod = max(floor((WIS − 10) / 2), 0)</code></p>
                <p className="mt-1"><strong className="text-foreground">Race Impact:</strong> Caster races like <strong>Elf</strong> (+3 WIS, +2 INT) and <strong>Half-Elf</strong> (+3 CHA, +2 WIS) start with higher CP pools than tank races like <strong>Dwarf</strong> (+4 CON but low mental stats). Investing in both INT and WIS rewards split investment over stacking a single mental stat.</p>
                <p><strong className="text-foreground">CP Regen</strong> = <code className="text-primary">1 CP per 4 seconds</code> + bonus from primary stat</p>
                <p><strong className="text-foreground">Regen Bonus</strong> = +0.5 CP/4s for every 2 points of primary stat modifier</p>
                <p><strong className="text-foreground">🏨 Inn Rest</strong> = +10 flat CP regen per tick</p>
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
                            return getMaxCp(1, s.wis);
                          })
                        );
                        const maxCp = Math.max(...allCp);
                        const minCp = Math.min(...allCp);
                        return Object.keys(RACE_STATS).map(race => (
                          <TableRow key={race}>
                            <TableCell className="text-xs font-display">{RACE_LABELS[race]}</TableCell>
                            {Object.keys(CLASS_STATS).map(cls => {
                              const s = calculateStats(race, cls);
                              const cp = getMaxCp(1, s.wis);
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
                <p className="text-xs font-display text-primary mb-1">Max CP by Level (base, no WIS bonus)</p>
                <div className="grid grid-cols-4 gap-1 text-xs text-muted-foreground">
                  {[1, 5, 10, 15, 20, 25, 30, 40].map(lv => (
                    <div key={lv}>
                      Lv {lv}: <span className="text-primary">{getMaxCp(lv, 10)} CP</span>
                    </div>
                  ))}
                </div>
              </div>

              <div>
                <p className="text-xs font-display text-primary mb-1">CP Regen (scales with INT)</p>
                <p className="text-xs text-muted-foreground mb-1">Uses the same formula as HP regen: 2 + floor(√(INT − 10))</p>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="text-xs">INT</TableHead>
                      <TableHead className="text-xs">Base CP/tick</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {[10, 13, 16, 20, 25, 30].map(v => (
                      <TableRow key={v}>
                        <TableCell className="text-xs">{v}</TableCell>
                        <TableCell className="text-xs">{getStatRegen(v)} CP/4s</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
              <p className="text-amber-400 mt-2 text-xs">⚔️ <strong>In Combat:</strong> CP regen is paused entirely. Pool size depends on <strong>WIS</strong> only; INT drives the regen rate out of combat.</p>

              <Card className="bg-card/30">
                <CardContent className="p-3">
                  <p className="text-xs font-display text-primary mb-1">Tactical Example (Level 20 Wizard, ~87 max CP)</p>
                  <div className="text-xs text-muted-foreground space-y-0.5">
                    <p>• T4 ability (60 CP) + T1 ability (15 CP) = 75 CP spent → 12 CP remaining</p>
                    <p>• A Warrior at level 20 would have ~75 max CP if WIS 10 — CP pool is purely WIS-driven now</p>
                    <p>• WIS pool + INT regen split rewards casters who invest in both — WIS for headroom, INT for sustain</p>
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
                <p><strong className="text-foreground">Attack Speed:</strong> Fixed <code className="text-primary">2.0s</code> heartbeat for all classes. One attack per tick.</p>
                <p><strong className="text-foreground">Autoattack Damage:</strong> Weapon-based — <code className="text-primary">1d{'{'}weaponDie{'}'} + STR mod</code>. Class no longer affects autoattack dice; class identity comes from <strong className="text-foreground">abilities</strong> (Fireball, Power Strike, Aimed Shot, etc.).</p>
                <p><strong className="text-foreground">Two-Handed Weapons:</strong> Benefit is expressed entirely through a larger weapon die — there is no separate damage multiplier.</p>
                <p><strong className="text-foreground">Unarmed:</strong> Falls back to <code className="text-primary">1d3 + STR mod</code> when no weapon is equipped.</p>
                <p><strong className="text-foreground">Weapon Affinity:</strong> When your class matches the equipped weapon, gain <code className="text-primary">+1 hit</code> and <code className="text-primary">×1.10 damage</code>.</p>
                <p><strong className="text-foreground">Attack Roll (To-Hit):</strong> <code className="text-primary">d20 + DEX mod + INT hit bonus + affinity</code> ≥ target AC → hit. <em>DEX governs accuracy for both melee and ranged autoattacks; STR governs damage and the minimum-damage floor — so high-STR / low-DEX builds (Warriors) hit hard but miss more often.</em></p>
                <p><strong className="text-foreground">Min Damage Floor (STR):</strong> All non-crit autoattacks deal at least <code className="text-primary">1 + min(3, floor(√STR_mod))</code> damage</p>
                <p><strong className="text-foreground">Hit Bonus (INT):</strong> <code className="text-primary">min(5, floor(√INT_mod))</code> bonus to attack rolls — diminishing returns</p>
                <p><strong className="text-foreground">Critical Hit:</strong> roll ≥ crit range → <code className="text-primary">×1.5</code> damage. Most classes crit on natural 20; <strong className="text-foreground">rogue</strong> crits on 19-20. <strong>DEX bonus:</strong> <code className="text-primary">min(4, floor(√DEX_mod))</code> widens the range — max crit on 16-20.</p>
                <p><strong className="text-foreground">Crit Resistance (WIS):</strong> <code className="text-primary">min(15%, √WIS_mod × 3%)</code> chance to downgrade an incoming crit to a normal hit. Shield adds +5%.</p>
                <p><strong className="text-foreground">Shield Block:</strong> When a shield is equipped, <code className="text-primary">5% + √DEX_mod × 4.5%</code> chance to block, reducing damage by <code className="text-primary">round(11 + 2.5 × √STR_mod)</code> flat.</p>
                <p><strong className="text-foreground">Creature Counterattack:</strong> d20 + STR mod + <code className="text-primary">floor(level × 0.4)</code> attack bonus vs player AC</p>
                <p><strong className="text-foreground">Creature Damage:</strong> 1d(base_die + floor(level × 0.7)) + STR mod, ×(1 + level_gap × 0.08) if creature out-levels player</p>
                <p><strong className="text-foreground">Party Combat:</strong> Tank absorbs all hits; single counterattack per round</p>
                <p><strong className="text-foreground">Party XP Bonus:</strong> Grouped play grants a scaling XP bonus — 2 players: <code className="text-primary">×1.15</code>, 3 players: <code className="text-primary">×1.30</code>, 4 players: <code className="text-primary">×1.40</code></p>
                <p><strong className="text-foreground">Flee:</strong> All party members suffer opportunity attacks</p>
                <p><strong className="text-foreground">Durability:</strong> Each hit degrades 1 random equipped item by 1 durability</p>
                <p><strong className="text-foreground">XP Penalty:</strong> Graduated: −10%/lvl (Lv1-5), −15%/lvl (Lv6-10), −20%/lvl (Lv11+). Min 10% reward.</p>
              </div>
            </AccordionContent>
          </AccordionItem>

          {/* 4b. XP & Creature Rewards */}
          <AccordionItem value="xp-rewards" className="border border-border rounded-lg bg-card/50">
            <AccordionTrigger className="px-4 py-3 font-display text-sm hover:no-underline">
              🏆 XP & Creature Rewards
            </AccordionTrigger>
            <AccordionContent className="px-4 space-y-3">
              <div className="space-y-1 text-xs text-muted-foreground">
                <p><strong className="text-foreground">XP Curve:</strong> XP to next level = <code className="text-primary">floor(level^2.0 × 50)</code></p>
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
                Each class gets a <strong>Tier 0</strong> class-identity ability from level 1 (Wizard Fireball, Warrior Power Strike, Ranger Aimed Shot, Rogue Backstab, Healer Smite, Bard Cutting Words, Templar Judgment). Higher-tier abilities unlock at Tier 1 (Lv 5), Tier 2 (Lv 10), Tier 3 (Lv 15), Tier 4 (Lv 20). Each ability costs Concentration Points (CP) to use.
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

              <div className="mt-3 space-y-2">
                <p className="text-xs font-display text-primary">Key Ability Formulas</p>
                <div className="p-2 bg-muted/30 rounded border border-border mb-2">
                  <p className="text-[10px] text-muted-foreground"><span className="text-elvish font-display">⚡ Instant</span> — resolves immediately on button press (buffs, auras). <span className="text-dwarvish font-display">⏳ Heartbeat</span> — queued and executes on the next 2s server tick (heals, attacks, DoTs). Heartbeat abilities cannot be spammed — only one can be queued at a time.</p>
                </div>
                <div className="p-2 bg-soulforged/10 rounded border border-soulforged/40 mb-2">
                  <p className="text-[10px] text-foreground"><span className="text-soulforged font-display">⚓ Stance</span> — toggle on/off. Locks a percentage of your max CP for as long as it is active and persists across combat / movement until you drop it or log out. Reservation cost: <strong>T1 = 10%</strong>, <strong>T2 = 15%</strong>, <strong>T3 = 20%</strong> of max CP (min 5). Dropping a stance frees the slot but <strong>does NOT refund the CP</strong> — you must regenerate it. Ignite and Envenom are mutually exclusive. Stances clear on logout, character load, death, and respec. Stances: 🦅 Eagle Eye, 🛡️✨ Force Shield, 🛡️✝️ Holy Shield (T1) · ✨ Arcane Surge, 📯 Battle Cry (T2) · 🔥🔥 Ignite, 🐍 Envenom (T3).</p>
                </div>
                <div className="space-y-1 text-xs text-muted-foreground">
                  <p className="text-[10px] text-muted-foreground/80 mt-1">T0 abilities scale from each class's primary stat: <code className="text-primary">max(1, 5 + 2 × statMod + floor(level / 3))</code>.</p>

                  <p className="text-[10px] font-semibold text-primary/70 mt-2">— Warrior —</p>
                  <p><strong className="text-foreground">💪 Second Wind (T1, 15 CP):</strong> <span className="text-dwarvish">⏳</span> Heal = <code className="text-primary">max(3, CON_mod × 3 + level)</code></p>
                  <p><strong className="text-foreground">📯 Battle Cry (T2 stance, 25 CP):</strong> <span className="text-soulforged">⚓</span> Reserves 15% of max CP. Damage Reduction = <code className="text-primary">15% base (20% with shield)</code>, Crit DR = <code className="text-primary">+15% extra on crits</code>. <em className="text-muted-foreground">Persists until dropped — reserved CP is not refunded.</em></p>
                  <p><strong className="text-foreground">🩸 Rend (T3, 40 CP):</strong> <span className="text-dwarvish">⏳</span> Bleed = <code className="text-primary">floor((STR_mod × 1.5 + 2) × 0.67)</code> per 2s tick, Duration = <code className="text-primary">min(30s, 20s + STR_mod × 1s)</code>. <em className="text-muted-foreground">Multi-target: can bleed multiple creatures simultaneously (tracked per creature).</em></p>
                  <p><strong className="text-foreground">🔨 Sunder Armor (T4, 60 CP):</strong> <span className="text-dwarvish">⏳</span> AC Reduction = <code className="text-primary">max(2, STR_mod)</code>, Duration = <code className="text-primary">min(20s, 12s + STR_mod × 1s)</code></p>

                  <p className="text-[10px] font-semibold text-primary/70 mt-2">— Wizard —</p>
                  <p><strong className="text-foreground">🛡️✨ Force Shield (T1 stance):</strong> <span className="text-soulforged">⚓</span> Reserves 10% of max CP. Maintains an arcane ward with cap ≈ <code className="text-primary">INT_mod + floor(level × 0.5)</code> HP. After taking damage, regenerates <code className="text-primary">1 + floor(INT_mod / 2)</code> HP per combat tick (~2s) up to the cap — does not refill instantly. <em className="text-muted-foreground">Persists until dropped — CP not refunded.</em></p>
                  <p><strong className="text-foreground">✨ Arcane Surge (T2 stance, 25 CP):</strong> <span className="text-soulforged">⚓</span> Reserves 15% of max CP. +15% damage to all your attacks (autoattacks, abilities, DoTs, off-hand, Ignite pulses). <em className="text-muted-foreground">Persists until dropped — CP not refunded.</em></p>
                  <p><strong className="text-foreground">🔥🔥 Ignite (T3 stance, 50 CP):</strong> <span className="text-soulforged">⚓</span> Reserves 20% of max CP. While in combat, each heartbeat an orb has a 40% chance to strike your target — <code className="text-primary">floor(INT_mod × 0.7 × 0.67)</code> damage per stack per 2s tick (max 5 stacks). <em className="text-muted-foreground">Mutually exclusive with Envenom. Persists until dropped — CP not refunded.</em></p>
                  <p><strong className="text-foreground">💥 Conflagrate (T4, 60 CP):</strong> <span className="text-dwarvish">⏳</span> Dmg = <code className="text-primary">(1d8 + INT_mod) × (1 + 0.5 × burn_stacks)</code>, consumes all burn stacks</p>

                  <p className="text-[10px] font-semibold text-primary/70 mt-2">— Ranger —</p>
                  <p><strong className="text-foreground">🦅 Eagle Eye (T1 stance, 15 CP):</strong> <span className="text-soulforged">⚓</span> Reserves 10% of max CP. Crit Range widened by <code className="text-primary">min(DEX_mod, 5)</code>. <em className="text-muted-foreground">Persists until dropped — CP not refunded.</em></p>
                  <p><strong className="text-foreground">🏹🏹 Barrage (T2, 25 CP):</strong> <span className="text-dwarvish">⏳</span> Fire <code className="text-primary">DEX_mod ≥ 3 ? 3 : 2</code> arrows at 70% damage each</p>
                  <p><strong className="text-foreground">🌿 Nature's Snare (T3, 40 CP):</strong> <span className="text-elvish">⚡</span> Target damage −30%, Duration = <code className="text-primary">min(15s, 8s + WIS_mod × 1s)</code></p>
                  <p><strong className="text-foreground">🦘 Disengage (T4, 60 CP):</strong> <span className="text-elvish">⚡</span> 100% dodge for <code className="text-primary">min(8s, 5s + DEX_mod × 0.5s)</code>, next hit +50% damage</p>

                  <p className="text-[10px] font-semibold text-primary/70 mt-2">— Rogue —</p>
                  <p><strong className="text-foreground">🌑 Shadowstep (T1, 15 CP):</strong> <span className="text-elvish">⚡</span> Stealth (2× next hit, dodge while fleeing), Duration = <code className="text-primary">min(25s, 15s + DEX_mod × 1s)</code></p>
                  <p><strong className="text-foreground">🐍 Envenom (T3 stance, 50 CP):</strong> <span className="text-soulforged">⚓</span> Reserves 20% of max CP. Each hit has a 40% chance to apply a stackable poison DoT — <code className="text-primary">floor(DEX_mod × 1.2 × 0.67)</code> per stack per 2s tick (max 5 stacks, stacks last 25s). <em className="text-muted-foreground">Mutually exclusive with Ignite. Persists until dropped — CP not refunded.</em></p>
                  <p><strong className="text-foreground">🔪 Eviscerate (T3, 40 CP):</strong> <span className="text-dwarvish">⏳</span> Dmg = <code className="text-primary">(1d6 + DEX_mod) × (1 + 0.5 × poison_stacks)</code>, consumes all poison stacks</p>
                  <p><strong className="text-foreground">🌫️ Cloak of Shadows (T4, 60 CP):</strong> <span className="text-elvish">⚡</span> 50% dodge chance, Duration = <code className="text-primary">min(15s, 10s + DEX_mod × 0.5s)</code></p>

                  <p className="text-[10px] font-semibold text-primary/70 mt-2">— Healer —</p>
                  <p><strong className="text-foreground">💚 Heal (T1, 15 CP):</strong> <span className="text-dwarvish">⏳</span> Restore = <code className="text-primary">max(3, WIS_mod × 3 + level)</code></p>
                  <p><strong className="text-foreground">💉 Transfer Health (T2, 25 CP):</strong> <span className="text-dwarvish">⏳</span> Sacrifice own HP to heal ally = <code className="text-primary">WIS_mod × 3 + level</code> (capped by own HP − 1)</p>
                  <p><strong className="text-foreground">✨💚 Purifying Light (T3, 40 CP):</strong> <span className="text-elvish">⚡</span> Party heal = <code className="text-primary">max(1, WIS_mod + 2)</code> per 2s tick, Duration = <code className="text-primary">min(25s, 15s + WIS_mod × 1s)</code></p>
                  <p><strong className="text-foreground">🛡️💚 Divine Aegis (T4, 60 CP):</strong> <span className="text-elvish">⚡</span> Shield HP = <code className="text-primary">WIS_mod × 2 + floor(level × 0.7)</code>, Duration = <code className="text-primary">min(18s, 10s + WIS_mod × 1s)</code></p>

                  <p className="text-[10px] font-semibold text-primary/70 mt-2">— Bard —</p>
                  <p><strong className="text-foreground">🎶 Inspire (T1, 15 CP):</strong> <span className="text-elvish">⚡</span> Flat HP & CP regen for self + party, magnitude scales with CHA, duration scales with INT (60–180s). Recast to refresh — keeps the stronger HP/CP regen values.</p>
                  <p><strong className="text-foreground">🎵💢 Dissonance (T2, 25 CP):</strong> <span className="text-elvish">⚡</span> Target damage −30%, Duration = <code className="text-primary">min(15s, 8s + WIS_mod × 1s)</code></p>
                  <p><strong className="text-foreground">🎶✨ Crescendo (T3, 40 CP):</strong> <span className="text-elvish">⚡</span> Party heal = <code className="text-primary">max(1, CHA_mod + 2)</code> per 2s tick, Duration = <code className="text-primary">min(25s, 15s + CHA_mod × 1s)</code></p>
                  <p><strong className="text-foreground">🎵💥 Grand Finale (T4, 60 CP):</strong> <span className="text-dwarvish">⏳</span> Dmg = <code className="text-primary">max(8, CHA_mod × 4 + floor(level × 1.5)) + 1d(CHA_mod × 2)</code></p>

                  <p className="text-[10px] font-semibold text-primary/70 mt-2">— Templar —</p>
                  <p><strong className="text-foreground">✝️ Judgment (T0, 10 CP):</strong> <span className="text-dwarvish">⏳</span> Holy damage = <code className="text-primary">1d8 + WIS_mod + floor(level × 0.5)</code> (crit on 20)</p>
                  <p><strong className="text-foreground">🛡️✝️ Holy Shield (T1 stance, 15 CP):</strong> <span className="text-soulforged">⚓</span> Reserves 10% of max CP. Each attacker that strikes you takes <code className="text-primary">max(1, WIS_mod + 1)</code> holy damage in return (max once per attacker per 2s tick). <em className="text-muted-foreground">Persists until dropped — CP not refunded.</em></p>
                  <p><strong className="text-foreground">🛡️ Shield Wall (T2, 25 CP):</strong> <span className="text-elvish">⚡</span> 100% block chance for ~4s. <strong>Requires a shield equipped.</strong> All physical hits absorbed entirely.</p>
                  <p><strong className="text-foreground">✨🟡 Consecrate (T3, 40 CP):</strong> <span className="text-elvish">⚡</span> Sanctifies your node for ~6s. Each tick: party allies on this node heal <code className="text-primary">max(1, WIS_mod + 1)</code>, engaged creatures take <code className="text-primary">max(1, WIS_mod + 1)</code> holy damage.</p>
                  <p><strong className="text-foreground">⚜️ Divine Challenge (T4, 60 CP):</strong> <span className="text-elvish">⚡</span> 30% flat damage reduction from all sources for 30s. Stacks multiplicatively with Battle Cry / WIS dampen.</p>

                  <p className="ml-4 text-[10px] mt-2">All modifiers include equipment bonuses unless noted. modifier = floor((stat − 10) / 2). INT hit bonus capped at +5. Lv 39+ milestone: all CP costs −10%.</p>
                </div>
              </div>
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
                <p><strong className="text-foreground">AC:</strong> 10 + floor(level × 0.575) + rarity AC bonus (+2 regular/rare, +6 boss)</p>
                <p><strong className="text-foreground">Damage Die:</strong> rarity_base + floor(level × 0.7)</p>
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
                    { r: 'Regular', stat: 1, hp: 1, ac: 2, dmg: 4, gold: 1 },
                    { r: 'Rare', stat: 1.3, hp: 1.5, ac: 2, dmg: 6, gold: 1.5 },
                    { r: 'Boss', stat: 2.5, hp: 6.0, ac: 6, dmg: 10, gold: 3 },
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
                <p><strong className="text-foreground">Durability:</strong> All items have 100 max durability. Common/Uncommon can be repaired; Unique items are destroyed at 0.</p>
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
                      {['common', 'uncommon', 'unique'].map(rarity =>
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

          {/* ── Weapon Affinity ── */}
          <AccordionItem value="weapon-affinity" className="border border-border rounded-lg bg-card/50">
            <AccordionTrigger className="px-4 py-3 font-display text-sm hover:no-underline">
              ⚔️ Weapon Tags & Class Affinity
            </AccordionTrigger>
            <AccordionContent className="px-4 space-y-3">
              <div className="space-y-1 text-xs text-muted-foreground">
                <p>Weapons have a <strong className="text-foreground">weapon tag</strong> (sword, axe, mace, dagger, bow, staff, wand, shield). When your <strong className="text-foreground">main-hand</strong> weapon's tag matches your class affinity, you gain:</p>
                <ul className="list-disc pl-4 space-y-0.5">
                  <li><strong className="text-primary">+1 hit bonus</strong> (flat, stacks with INT hit bonus)</li>
                  <li><strong className="text-primary">×1.10 damage multiplier</strong> (10% boost, applied before other buffs)</li>
                </ul>
                <p className="mt-2">A <Badge variant="outline" className="text-[10px] py-0 px-1">Proficient</Badge> badge appears on matching main-hand weapons in the Character Panel.</p>
              </div>

              <div>
                <p className="text-xs font-display text-primary mb-1">Class Weapon Proficiencies</p>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="text-xs">Class</TableHead>
                      <TableHead className="text-xs">Proficient Weapons</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {Object.entries(CLASS_WEAPON_AFFINITY).map(([cls, tags]) => (
                      <TableRow key={cls}>
                        <TableCell className="text-xs font-medium">{CLASS_LABELS[cls] || cls}</TableCell>
                        <TableCell className="text-xs">
                          {tags.map(t => WEAPON_TAG_LABELS[t] || t).join(', ')}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>

              <div className="space-y-1 text-xs text-muted-foreground">
                <p className="font-display text-primary">Dual Wielding</p>
                <p>Any <strong className="text-foreground">1H weapon</strong> can be equipped in the off-hand using the second equip button (⚔) in the inventory. Off-hand weapons contribute their stats <strong className="text-foreground">and</strong> grant a <strong className="text-primary">bonus attack</strong> each combat tick:</p>
                <ul className="list-disc pl-4 space-y-0.5">
                  <li><strong className="text-primary">30% damage</strong> of main-hand base damage</li>
                  <li><strong className="text-foreground">Separate hit roll</strong> — can miss independently of main-hand</li>
                  <li><strong className="text-foreground">Can crit independently</strong> using the same crit range</li>
                  <li>No affinity bonus from the off-hand weapon tag</li>
                  <li>No stealth/buff multipliers — raw damage only</li>
                  <li>Shields in the off-hand do <em>not</em> trigger a bonus attack</li>
                </ul>

                <p className="font-display text-primary mt-2">Shield Defensive Bonus</p>
                <p>To compensate for losing the off-hand bonus attack, equipping a <strong className="text-foreground">shield</strong> in the off-hand grants unique defensive bonuses:</p>
                <ul className="list-disc pl-4 space-y-0.5">
                  <li><strong className="text-primary">+1 AC</strong> — flat bonus stacking with DEX-based AC and equipment AC</li>
                  <li><strong className="text-primary">+5% Crit Resistance</strong> — additive bonus stacking with WIS-based anti-crit (chance to downgrade incoming crits)</li>
                  <li><strong className="text-primary">Block</strong> — chance to reduce incoming damage by a flat amount (DEX → chance, STR → amount)</li>
                </ul>
                <p className="text-muted-foreground/70 italic mt-1">Trade-off: dual-wield weapons add ~2–4 DPS via bonus attacks; a shield sacrifices that offense for consistent damage mitigation and block.</p>
              </div>
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
                  <p><strong className="text-foreground">Regen Rate:</strong> floor((5 + DEX mod) × 0.67) MP every 2 seconds</p>
                  <p><strong className="text-foreground">Inn Bonus:</strong> Regen rate tripled (×3) while resting at an Inn</p>
                  <p><strong className="text-foreground">Movement Cost:</strong> 10 MP per node traversal (base)</p>
                </div>

                <div className="space-y-1 bg-background/40 p-2 rounded border border-border">
                  <p className="text-foreground font-display text-xs">⚖️ Encumbrance</p>
                  <p>Players have a <strong className="text-foreground">carry capacity</strong> based on Strength:</p>
                  <p><strong className="text-foreground">Carry Capacity</strong> = 12 + STR modifier (minimum 10)</p>
                  <p>Items have different <strong className="text-foreground">weights</strong>: equipment = 1 slot, consumables = ⅓ slot. Equipped items and belted potions don't count.</p>
                  <p>Exceeding capacity doesn't prevent picking up items, but <strong className="text-foreground">increases movement cost</strong>:</p>
                  <p><strong className="text-foreground">Move Cost</strong> = 10 + (weight over capacity × 5) MP</p>
                  <p className="text-muted-foreground">Example: A character with STR 14 (capacity 14) carrying 12 equipment + 9 potions has weight 12 + 3 = 15, paying 10 + (1 × 5) = 15 MP per move.</p>
                </div>

                <p className="text-muted-foreground">DEX-focused classes like Rangers and Rogues naturally gain higher max MP and faster recovery. STR-focused classes like Warriors can carry more items before becoming encumbered.</p>

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
                              {maxMp} <span className="text-muted-foreground/60">({regenRate}/2s)</span>
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
              🏆 Milestone Rewards
            </AccordionTrigger>
            <AccordionContent className="px-4">
              <div className="space-y-3 text-xs text-muted-foreground">
                <p>Character progression includes sustain, utility, and prestige milestones that reduce downtime and improve quality of life.</p>

                <Card className="bg-card/30">
                  <CardContent className="p-3 space-y-2">
                    <p className="text-xs font-display text-primary">💚 HP & CP Regeneration (Level 20+)</p>
                    <p>Starting at level 20, characters gain flat bonus regeneration per tick that scales every 5 levels. This stacks additively with CON regen, equipment regen, food, and inn bonuses.</p>
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="text-xs">Level</TableHead>
                          <TableHead className="text-xs">HP Regen</TableHead>
                          <TableHead className="text-xs">CP Regen</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        <TableRow><TableCell className="text-xs">20</TableCell><TableCell className="text-xs">+2</TableCell><TableCell className="text-xs">+1</TableCell></TableRow>
                        <TableRow><TableCell className="text-xs">25</TableCell><TableCell className="text-xs">+4</TableCell><TableCell className="text-xs">+2</TableCell></TableRow>
                        <TableRow><TableCell className="text-xs">30</TableCell><TableCell className="text-xs">+6</TableCell><TableCell className="text-xs">+3</TableCell></TableRow>
                        <TableRow><TableCell className="text-xs">35</TableCell><TableCell className="text-xs">+8</TableCell><TableCell className="text-xs">+4</TableCell></TableRow>
                        <TableRow><TableCell className="text-xs">40</TableCell><TableCell className="text-xs">+10</TableCell><TableCell className="text-xs">+5</TableCell></TableRow>
                      </TableBody>
                    </Table>
                    <p className="text-[10px] text-muted-foreground/70">This reduces downtime between fights and makes high-level characters more self-sufficient without replacing consumables.</p>
                  </CardContent>
                </Card>

                <Card className="bg-card/30">
                  <CardContent className="p-3 space-y-2">
                    <p className="text-xs font-display text-primary">🌀 Utility Unlocks</p>
                    <p><strong className="text-foreground">Level 22 — Teleport / Arcane Recall:</strong> Travel instantly between visited teleport nodes. When used from a non-teleport node, a temporary waymark is left for a return trip.</p>
                    <p><strong className="text-foreground">Level 26 — Summon Player:</strong> Summon any online player to your location by typing their name. Uses the same distance-based CP cost as teleportation. Does not require party membership — useful for meeting up with friends anywhere in the world.</p>
                  </CardContent>
                </Card>

                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="text-xs">Level</TableHead>
                      <TableHead className="text-xs">Reward</TableHead>
                      <TableHead className="text-xs">Details</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    <TableRow><TableCell className="text-xs">20</TableCell><TableCell className="text-xs">💚 Regen Milestone</TableCell><TableCell className="text-xs">+2 HP / +1 CP regen per tick</TableCell></TableRow>
                    <TableRow><TableCell className="text-xs">22</TableCell><TableCell className="text-xs">🌀 Teleport</TableCell><TableCell className="text-xs">Arcane Recall from any non-combat node</TableCell></TableRow>
                    <TableRow><TableCell className="text-xs">25</TableCell><TableCell className="text-xs">💚 Regen Milestone</TableCell><TableCell className="text-xs">+4 HP / +2 CP regen per tick</TableCell></TableRow>
                    <TableRow><TableCell className="text-xs">26</TableCell><TableCell className="text-xs">🌀 Summon Player</TableCell><TableCell className="text-xs">Summon any online player to your location (CP cost based on distance)</TableCell></TableRow>
                    <TableRow><TableCell className="text-xs">28</TableCell><TableCell className="text-xs">🏅 Title: Lord / Lady</TableCell><TableCell className="text-xs">First nobility title</TableCell></TableRow>
                    <TableRow><TableCell className="text-xs">30</TableCell><TableCell className="text-xs">🏅 Title: Baron / Baroness</TableCell><TableCell className="text-xs">+6 HP / +3 CP regen</TableCell></TableRow>
                    <TableRow><TableCell className="text-xs">32</TableCell><TableCell className="text-xs">🏅 Title: Count / Countess</TableCell><TableCell className="text-xs">Replaces previous title</TableCell></TableRow>
                    <TableRow><TableCell className="text-xs">34</TableCell><TableCell className="text-xs">🏅 Title: Marquis / Marquise</TableCell><TableCell className="text-xs">Replaces previous title</TableCell></TableRow>
                    <TableRow><TableCell className="text-xs">35</TableCell><TableCell className="text-xs">💚 Regen Milestone</TableCell><TableCell className="text-xs">+8 HP / +4 CP regen per tick</TableCell></TableRow>
                    <TableRow><TableCell className="text-xs">36</TableCell><TableCell className="text-xs">🏅 Title: Duke / Duchess</TableCell><TableCell className="text-xs">Replaces previous title</TableCell></TableRow>
                    <TableRow><TableCell className="text-xs">38</TableCell><TableCell className="text-xs">🏅 Title: Prince / Princess</TableCell><TableCell className="text-xs">Replaces previous title</TableCell></TableRow>
                    <TableRow><TableCell className="text-xs">40</TableCell><TableCell className="text-xs">🏅 Title: King / Queen</TableCell><TableCell className="text-xs">+10 HP / +5 CP regen. Crown crafting milestone.</TableCell></TableRow>
                    <TableRow><TableCell className="text-xs">42</TableCell><TableCell className="text-xs">🏅 Title: Emperor / Empress</TableCell><TableCell className="text-xs">Maximum title — Soulforge crafting milestone</TableCell></TableRow>
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

          {/* Renown */}
          <AccordionItem value="renown" className="border border-border rounded-lg bg-card/50">
            <AccordionTrigger className="px-4 py-3 font-display text-sm hover:no-underline">
              🏛️ Renown
            </AccordionTrigger>
            <AccordionContent className="px-4">
              <div className="space-y-3 text-xs text-muted-foreground">
                <p><strong className="text-foreground">Earning Renown:</strong> Available from level 1.</p>
                <p>Kill <Badge variant="outline" className="text-xs">rare</Badge> creatures: <code className="text-primary">max(1, floor(creatureLevel × 0.10))</code> Renown.</p>
                <p>Kill <Badge variant="outline" className="text-xs">boss</Badge> creatures: <code className="text-primary">floor(creatureLevel × 0.50)</code> Renown.</p>
                <p>Renown is split among party members at the same node.</p>
                <p><strong className="text-foreground">Lifetime Renown</strong> is tracked separately from your spendable balance — it never decreases and will be used for the upcoming <strong className="text-foreground">Renown Board</strong>.</p>

                <div>
                  <p className="font-display text-foreground mb-1">Training (Level 30+)</p>
                  <p>Visit a <strong className="text-foreground">🏛️ Trainer</strong> node to spend Renown on permanent attribute ranks beyond the level cap. The same Trainer panel also handles level-up stat allocation and respec.</p>
                  <p><strong className="text-foreground">Cost:</strong> <code className="text-primary">20 × (rank + 1)</code> RP per attempt (success or fail).</p>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="text-xs">Rank</TableHead>
                        <TableHead className="text-xs">0→1</TableHead>
                        <TableHead className="text-xs">1→2</TableHead>
                        <TableHead className="text-xs">2→3</TableHead>
                        <TableHead className="text-xs">3→4</TableHead>
                        <TableHead className="text-xs">4→5</TableHead>
                        <TableHead className="text-xs">5→6</TableHead>
                        <TableHead className="text-xs">6→7</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      <TableRow>
                        <TableCell className="text-xs font-medium">Cost</TableCell>
                        <TableCell className="text-xs">20</TableCell>
                        <TableCell className="text-xs">40</TableCell>
                        <TableCell className="text-xs">60</TableCell>
                        <TableCell className="text-xs">80</TableCell>
                        <TableCell className="text-xs">100</TableCell>
                        <TableCell className="text-xs">120</TableCell>
                        <TableCell className="text-xs text-destructive">140</TableCell>
                      </TableRow>
                    </TableBody>
                  </Table>
                </div>

                <div>
                  <p className="font-display text-foreground mb-1">Success Chance</p>
                  <p>Formula: <code className="text-primary">max(1%, 95% − rank × 15%)</code></p>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="text-xs">Rank</TableHead>
                        <TableHead className="text-xs">0→1</TableHead>
                        <TableHead className="text-xs">1→2</TableHead>
                        <TableHead className="text-xs">2→3</TableHead>
                        <TableHead className="text-xs">3→4</TableHead>
                        <TableHead className="text-xs">4→5</TableHead>
                        <TableHead className="text-xs">5→6</TableHead>
                        <TableHead className="text-xs">6→7</TableHead>
                        <TableHead className="text-xs">7+</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      <TableRow>
                        <TableCell className="text-xs font-medium">Chance</TableCell>
                        <TableCell className="text-xs">95%</TableCell>
                        <TableCell className="text-xs">80%</TableCell>
                        <TableCell className="text-xs">65%</TableCell>
                        <TableCell className="text-xs">50%</TableCell>
                        <TableCell className="text-xs">35%</TableCell>
                        <TableCell className="text-xs">20%</TableCell>
                        <TableCell className="text-xs">5%</TableCell>
                        <TableCell className="text-xs text-destructive">1%</TableCell>
                      </TableRow>
                    </TableBody>
                  </Table>
                </div>

                <p className="text-muted-foreground/80 italic">Each trained rank adds +1 to that attribute permanently. Ranks are tracked per-stat, so spreading points is easier than deep-stacking a single attribute.</p>
              </div>
            </AccordionContent>
          </AccordionItem>

          {/* Economy */}
          <AccordionItem value="economy" className="border border-border rounded-lg bg-card/50">
            <AccordionTrigger className="px-4 py-3 font-display text-sm hover:no-underline">
              💰 Economy — Gold, Salvage & Trading
            </AccordionTrigger>
            <AccordionContent className="px-4 space-y-3">
              <Card className="bg-card/30 border-border">
                <CardContent className="p-3 space-y-2">
                  <p className="text-xs font-display text-primary">🪙 Gold</p>
                  <div className="text-xs text-muted-foreground space-y-1">
                    <p>The primary trade currency. Earned from killing creatures and selling items.</p>
                    <p><strong className="text-foreground">Creature drops:</strong> Gold scales with creature level and rarity. Humanoid creatures give a CHA-based bonus: <code className="text-primary">min(25%, modifier × 5%)</code> extra gold.</p>
                    <p><strong className="text-foreground">Selling items:</strong> Items sell for a percentage of their value. CHA improves sell price up to <strong className="text-foreground">80%</strong> and gives a buy discount capped at <strong className="text-foreground">10%</strong>.</p>
                    <p><strong className="text-foreground">Death penalty:</strong> <span className="text-destructive">10%</span> of current gold is lost on death.</p>
                  </div>
                </CardContent>
              </Card>

              <Card className="bg-card/30 border-border">
                <CardContent className="p-3 space-y-2">
                  <p className="text-xs font-display text-dwarvish">🔩 Salvage</p>
                  <div className="text-xs text-muted-foreground space-y-1">
                    <p>A crafting currency used at the <strong className="text-foreground">Blacksmith Forge</strong>. Dropped only by <strong className="text-foreground">non-humanoid creatures</strong> (beasts, monsters, etc.).</p>
                    <p><strong className="text-foreground">Drop formula:</strong> <code className="text-primary">1 + floor(level / 5)</code></p>
                    <p><strong className="text-foreground">Rarity multiplier:</strong> Regular ×1, <span className="text-elvish">Rare ×2</span>, <span className="text-destructive">Boss ×4</span></p>
                    <p><strong className="text-foreground">Forge cost:</strong> <code className="text-primary">🔩 5 + level×2</code> salvage + <code className="text-primary">level×5</code> gold per forge attempt</p>
                    <p><strong className="text-foreground">Forge output:</strong> Random item for chosen slot — <span className="text-foreground">Common 65%</span> / <span className="text-elvish">Uncommon 35%</span>. Unique items cannot be forged.</p>
                  </div>
                </CardContent>
              </Card>

              <Card className="bg-card/30 border-border">
                <CardContent className="p-3 space-y-2">
                  <p className="text-xs font-display text-primary">🏪 Vendor Trading</p>
                  <div className="text-xs text-muted-foreground space-y-1">
                    <p>Vendors are found at specific nodes and carry a fixed stock of items.</p>
                    <p><strong className="text-foreground">Buying:</strong> Prices are set per item. CHA discount: <code className="text-primary">min(10%, modifier × 2%)</code> off.</p>
                    <p><strong className="text-foreground">Selling:</strong> Base sell price is 50% of item value. CHA bonus: <code className="text-primary">min(80%, 50% + modifier × 5%)</code>.</p>
                    <p><strong className="text-foreground">Stock:</strong> Each vendor item has limited stock. Identical items are grouped in the UI.</p>
                  </div>
                </CardContent>
              </Card>

              <Card className="bg-card/30 border-border">
                <CardContent className="p-3 space-y-2">
                  <p className="text-xs font-display text-primary">👥 Party Loot Splitting</p>
                  <div className="text-xs text-muted-foreground space-y-1">
                    <p>When a creature dies, <strong className="text-foreground">XP, gold, and salvage</strong> are split equally among all party members at the same node.</p>
                    <p><strong className="text-foreground">Item drops:</strong> Loot drops to the ground at the creature's node of death. Any player can pick it up (first come, first served).</p>
                    <p><strong className="text-foreground">Remote kills:</strong> If a creature dies from a DoT while you've moved away, loot drops at the creature's node — not yours.</p>
                  </div>
                </CardContent>
              </Card>

              <Card className="bg-card/30 border-border">
                <CardContent className="p-3 space-y-2">
                  <p className="text-xs font-display text-primary">🔨 Blacksmith — Repairs</p>
                  <div className="text-xs text-muted-foreground space-y-1">
                    <p>Blacksmith nodes allow repairing damaged equipment for gold.</p>
                    <p><strong className="text-foreground">Repair cost:</strong> <code className="text-primary">ceil((100 − durability) × itemValue × rarityMult / 100)</code></p>
                    <p><strong className="text-foreground">Unique items:</strong> <span className="text-destructive">Cannot be repaired</span> — they are permanently destroyed at 0% durability.</p>
                    <p><strong className="text-foreground">Common/Uncommon:</strong> Persist at 0% but become unequipped and unusable until repaired.</p>
                  </div>
                </CardContent>
              </Card>
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
