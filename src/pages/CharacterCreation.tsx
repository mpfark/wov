import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { Dices, Loader2 } from 'lucide-react';
import {
  RACE_LABELS, CLASS_LABELS, RACE_DESCRIPTIONS, CLASS_DESCRIPTIONS,
  STAT_LABELS, RACE_STATS, CLASS_STATS, CLASS_BASE_HP, CLASS_BASE_AC,
  calculateStats, calculateHP, calculateAC, getMaxCp,
} from '@/lib/game-data';

interface Props {
  onCreateCharacter: (data: any) => Promise<any>;
  onCharacterReady?: (id: string) => void;
  startingNodeId: string;
  onBack?: () => void;
}

/** Recommended classes per race (stat synergy). 'all' renders as "Any". */
const RACE_RECOMMENDED_CLASSES: Record<string, string[] | 'all'> = {
  human: 'all',
  elf: ['wizard', 'ranger'],
  dwarf: ['warrior', 'templar'],
  halfling: ['rogue', 'ranger'],
  edain: ['warrior', 'templar', 'healer'],
  half_elf: ['bard', 'healer'],
};

function recommendedLabel(raceKey: string): string {
  const rec = RACE_RECOMMENDED_CLASSES[raceKey];
  if (!rec) return '';
  if (rec === 'all') return 'Any';
  return rec.map(c => CLASS_LABELS[c]).join(', ');
}

function isRecommendedFor(raceKey: string, classKey: string): boolean {
  const rec = RACE_RECOMMENDED_CLASSES[raceKey];
  if (!rec) return false;
  if (rec === 'all') return true;
  return rec.includes(classKey);
}

export default function CharacterCreation({ onCreateCharacter, onCharacterReady, startingNodeId, onBack }: Props) {
  const [name, setName] = useState('');
  const [gender, setGender] = useState<'male' | 'female' | ''>('');
  const [race, setRace] = useState('');
  const [charClass, setCharClass] = useState('');
  const [hoverRace, setHoverRace] = useState<string | null>(null);
  const [hoverClass, setHoverClass] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [rolling, setRolling] = useState(false);

  // Effective race/class for the live preview — hover trumps committed.
  const effectiveRace = hoverRace ?? race;
  const effectiveClass = hoverClass ?? charClass;
  const previewStats = effectiveRace && effectiveClass ? calculateStats(effectiveRace, effectiveClass) : null;
  const previewHp = previewStats && effectiveClass ? calculateHP(effectiveClass, previewStats.con) : 0;
  const previewAc = previewStats && effectiveClass ? calculateAC(effectiveClass, previewStats.dex) : 0;

  // Committed (used for create).
  const stats = race && charClass ? calculateStats(race, charClass) : null;

  const canCreate = !!(name.trim() && gender && race && charClass && stats);

  const handleReroll = async () => {
    setRolling(true);
    try {
      const { data, error } = await supabase.functions.invoke('ai-suggest-character-name', {
        body: { race: race || undefined, gender: gender || undefined },
      });
      if (error) throw error;
      if (data?.name) setName(data.name);
      else toast.error('No name returned, try again.');
    } catch (err: any) {
      const msg = err?.context?.error || err?.message || 'Failed to suggest a name';
      toast.error(msg);
    } finally {
      setRolling(false);
    }
  };

  const handleCreate = async () => {
    if (!stats) return;
    setLoading(true);
    try {
      const maxCp = getMaxCp(1, stats.wis);
      const hp = calculateHP(charClass, stats.con);
      const ac = calculateAC(charClass, stats.dex);
      const char = await onCreateCharacter({
        name, gender, race, class: charClass,
        ...stats, hp, max_hp: hp, ac,
        current_node_id: startingNodeId,
        cp: maxCp, max_cp: maxCp,
      });
      if (char?.id) {
        await supabase.rpc('grant_starting_gear' as any, { p_character_id: char.id });
        onCharacterReady?.(char.id);
      }
      toast.success(`${name} has begun their adventure!`);
    } catch (err: any) {
      if (err.message?.includes('characters_name_unique') || err.code === '23505') {
        toast.error(`The name "${name}" is already taken. Choose a different name.`);
      } else {
        toast.error(err.message || 'Failed to create character');
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen items-start justify-center parchment-bg p-4 py-8">
      <Card className="w-full max-w-4xl ornate-border bg-card/90 backdrop-blur">
        <CardHeader className="text-center pb-4">
          {onBack && (
            <div className="flex justify-start">
              <Button variant="ghost" size="sm" onClick={onBack} className="text-xs font-display text-muted-foreground">
                ← Back to Characters
              </Button>
            </div>
          )}
          <h1 className="font-display text-2xl text-primary text-glow">Forge Your Hero</h1>
          <p className="text-sm text-muted-foreground">Choose name, gender, race and class</p>
        </CardHeader>

        <CardContent className="space-y-6">
          {/* Name + Gender row */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <label className="font-display text-sm text-foreground">Name</label>
              <div className="flex gap-2">
                <Input
                  value={name}
                  onChange={(e) => setName(e.target.value.replace(/\s/g, ''))}
                  placeholder="Theron, Mirael, Dunric..."
                  className="bg-input border-border text-base"
                  maxLength={24}
                />
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  onClick={handleReroll}
                  disabled={rolling}
                  title="Suggest a fantasy name"
                  className="shrink-0"
                >
                  {rolling ? <Loader2 className="h-4 w-4 animate-spin" /> : <Dices className="h-4 w-4" />}
                </Button>
              </div>
            </div>

            <div className="space-y-2">
              <label className="font-display text-sm text-foreground">Gender</label>
              <div className="grid grid-cols-2 gap-2">
                {(['male', 'female'] as const).map(g => (
                  <button
                    key={g}
                    type="button"
                    onClick={() => setGender(g)}
                    className={`p-3 rounded-md border text-center transition-all hover:border-primary ${
                      gender === g ? 'border-primary bg-primary/10' : 'border-border bg-card'
                    }`}
                  >
                    <span className="text-xl mr-2">{g === 'male' ? '♂' : '♀'}</span>
                    <span className="font-display text-sm capitalize">{g}</span>
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Race grid */}
          <div className="space-y-2">
            <h2 className="font-display text-lg text-primary text-glow">Race</h2>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
              {Object.entries(RACE_LABELS).map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setRace(key)}
                  onMouseEnter={() => setHoverRace(key)}
                  onMouseLeave={() => setHoverRace(prev => (prev === key ? null : prev))}
                  className={`p-3 rounded-md border text-left transition-all hover:border-primary ${
                    race === key ? 'border-primary bg-primary/10' : 'border-border bg-card'
                  }`}
                >
                  <div className="font-display text-sm text-foreground">{label}</div>
                  <div className="text-xs text-muted-foreground mt-1 leading-snug">{RACE_DESCRIPTIONS[key]}</div>
                  <div className="flex flex-wrap gap-1 mt-1.5">
                    {Object.entries(RACE_STATS[key] || {}).filter(([, v]) => v !== 0).map(([stat, val]) => (
                      <span key={stat} className={`text-[10px] px-1.5 py-0.5 rounded font-display ${
                        (val as number) > 0 ? 'bg-primary/15 text-primary' : 'bg-destructive/15 text-destructive'
                      }`}>
                        {(val as number) > 0 ? '+' : ''}{val as number} {STAT_LABELS[stat]}
                      </span>
                    ))}
                  </div>
                  <div className="text-[11px] italic text-muted-foreground mt-2">
                    Best: {recommendedLabel(key)}
                  </div>
                </button>
              ))}
            </div>
          </div>

          {/* Class grid */}
          <div className="space-y-2">
            <h2 className="font-display text-lg text-primary text-glow">Class</h2>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
              {Object.entries(CLASS_LABELS).map(([key, label]) => {
                const isSelected = charClass === key;
                const isRecommended = race && isRecommendedFor(race, key);
                return (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setCharClass(key)}
                    onMouseEnter={() => setHoverClass(key)}
                    onMouseLeave={() => setHoverClass(prev => (prev === key ? null : prev))}
                    className={`p-3 rounded-md border text-left transition-all hover:border-primary ${
                      isSelected ? 'border-primary bg-primary/10' : 'border-border bg-card'
                    } ${isRecommended && !isSelected ? 'ring-1 ring-primary/40' : ''}`}
                  >
                    <div className="flex items-center justify-between">
                      <div className="font-display text-sm text-foreground">{label}</div>
                      {isRecommended && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded font-display bg-primary/15 text-primary">
                          ★ Synergy
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-muted-foreground mt-1 leading-snug">{CLASS_DESCRIPTIONS[key]}</div>
                    <div className="flex flex-wrap gap-1 mt-1.5">
                      {Object.entries(CLASS_STATS[key] || {}).filter(([, v]) => v !== 0).map(([stat, val]) => (
                        <span key={stat} className={`text-[10px] px-1.5 py-0.5 rounded font-display ${
                          (val as number) > 0 ? 'bg-primary/15 text-primary' : 'bg-destructive/15 text-destructive'
                        }`}>
                          {(val as number) > 0 ? '+' : ''}{val as number} {STAT_LABELS[stat]}
                        </span>
                      ))}
                      <span className="text-[10px] px-1.5 py-0.5 rounded font-display bg-destructive/15 text-blood">
                        HP {CLASS_BASE_HP[key]}
                      </span>
                      <span className="text-[10px] px-1.5 py-0.5 rounded font-display bg-muted text-muted-foreground">
                        AC {CLASS_BASE_AC[key]}
                      </span>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Spacer so sticky bar never overlaps last card on tall screens */}
          <div className="h-2" />

          {/* Sticky live summary */}
          <div className="sticky bottom-0 -mx-6 px-6 py-3 bg-card/95 backdrop-blur border-t border-border">
            {previewStats ? (
              <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
                <div className="flex flex-wrap gap-2">
                  {Object.entries(STAT_LABELS).map(([key, label]) => (
                    <div key={key} className="text-center px-2 py-1 bg-background/60 rounded border border-border min-w-[52px]">
                      <div className="text-[10px] text-muted-foreground leading-none">{label}</div>
                      <div className="text-base font-display text-foreground leading-tight">{previewStats[key]}</div>
                    </div>
                  ))}
                  <div className="flex items-center gap-3 px-2 text-sm">
                    <span className="text-blood font-display">HP {previewHp}</span>
                    <span className="text-muted-foreground font-display">AC {previewAc}</span>
                    <span className="text-primary font-display">Gold 10</span>
                  </div>
                </div>
                <Button
                  onClick={handleCreate}
                  disabled={!canCreate || loading || rolling}
                  className="font-display whitespace-nowrap"
                >
                  {loading ? 'Creating...' : rolling ? 'Suggesting name...' : 'Create Character'}
                </Button>
              </div>
            ) : (
              <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-2">
                <p className="text-sm text-muted-foreground italic">
                  Choose a race and class to preview your hero's stats.
                </p>
                <Button disabled className="font-display whitespace-nowrap">
                  Create Character
                </Button>
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
